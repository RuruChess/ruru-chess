/**
 * Κοινή ανάλυση live: συνδέει ένα GameController με ένα δωμάτιο του relay/. Ό,τι αλλάζει εδώ (κινήσεις,
 * βαριάντες, σχόλια, σύμβολα, βέλη, στοιχεία) φεύγει ως PGN· ό,τι αλλάζει ο άλλος έρχεται και μπαίνει στο δέντρο.
 * Με το «ίδια θέση» βλέπετε και οι δύο την ίδια κίνηση. Χωρίς εξαρτήσεις από το υπόλοιπο Ruru (store, api),
 * ώστε να τη χρησιμοποιεί και η σελίδα του φίλου.
 */
import { useEffect, useRef, useState } from 'react';
import type { Game } from '../../core/game.ts';
import { parseGames, writeGame } from '../../core/pgn.ts';
import { canEdit, nodeAt, pathOf, samePath, SHARE_ENDED, SHARE_KICKED, SHARE_LOCKED, type ChatMsg, type EngineInfo, type Pid, type Presence, type RtcSignal, type ShareClientMsg, type ShareLiveInfo, type ShareRules, type ShareServerMsg, type VideoSyncState, type VoiceState } from '../../core/share.ts';
import type { GameController } from '../gameModel.ts';
import { socketUrl } from '../online/useRoom.ts';
import { useVoice, type VoiceConn } from './useVoice.ts';

export interface ShareConn {
  status: 'connecting' | 'open' | 'retrying' | 'gone' | 'full' | 'kicked' | 'locked' | 'ended';
  pid: Pid | null;
  host: Pid;
  role: 'host' | 'guest' | null;
  presence: Presence;
  chat: ChatMsg[];
  engine: EngineInfo | null;
  live: ShareLiveInfo | null;
  video: string | null;
  videoSync: VideoSyncState | null;
  cursors: Record<Pid, string[]>;
  follow: boolean;
  setFollow: (on: boolean) => void;
  send: (m: ShareClientMsg) => void;
  /** το relay ξέρει φωνή και δικαιώματα (έκδοση 2) */
  v: number;
  /** null: παλιό δωμάτιο, αλλάζουν όλοι */
  rules: ShareRules | null;
  canEdit: boolean;
  /** πότε προσπάθησε τελευταία φορά να αλλάξει κάτι χωρίς άδεια */
  blockedAt: number;
  /** ποιοι είναι μέσα στη φωνή */
  voices: Record<Pid, VoiceState>;
  voice: VoiceConn;
}

/** Το PGN όπως το γράφουμε εμείς (μία γραμμή): ίδια μορφή παντού, ώστε να συγκρίνεται. */
export const sharePgn = (g: Game) => writeGame(g, { maxLine: 0 });

export function useShare(ctrl: GameController, server: string, id: string, token: string | null, opts: { name?: string; onToken?: (t: string) => void } = {}): ShareConn {
  const [status, setStatus] = useState<ShareConn['status']>('connecting');
  const [pid, setPid] = useState<Pid | null>(null);
  const pidRef = useRef<Pid | null>(null);
  const [host, setHost] = useState<Pid>('h');
  const hostRef = useRef<Pid>('h');
  const role: 'host' | 'guest' | null = pid ? (pid === host ? 'host' : 'guest') : null;
  const [presence, setPresence] = useState<Presence>({ online: [], names: {} });
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [live, setLive] = useState<ShareLiveInfo | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [videoSync, setVideoSync] = useState<VideoSyncState | null>(null);
  const [cursors, setCursors] = useState<Record<Pid, string[]>>({});
  const [follow, setFollowState] = useState(true);
  const [v, setV] = useState(0);
  const [rules, setRules] = useState<ShareRules | null>(null);
  const [voices, setVoices] = useState<Record<Pid, VoiceState>>({});
  const [blockedAt, setBlockedAt] = useState(0);
  /** τα σήματα WebRTC πάνε κατευθείαν στη φωνή (όχι μέσα από το React) */
  const rtcRef = useRef<((by: Pid, data: RtcSignal) => void) | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef(token);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  /** το τελευταίο PGN που ξέρουμε ότι έχει και ο server (για να μη στέλνουμε ό,τι ήρθε από εκεί) */
  const synced = useRef<string | null>(null);
  /** η τελευταία θέση που στείλαμε ή που ήρθε (για να μη γυρίζει πίσω η ίδια) */
  const lastPath = useRef<string[]>([]);
  /** θέση άλλου που περιμένει (π.χ. ήρθε πριν από το PGN με τη νέα κίνηση) */
  const pendingPath = useRef<string[] | null>(null);

  const send = (m: ShareClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const goPath = (path: string[]) => {
    const n = nodeAt(ctrl.game, path);
    lastPath.current = pathOf(n);
    pendingPath.current = samePath(lastPath.current, path) ? null : path;
    ctrl.goTo(n);
  };

  const applyPgn = (pgn: string) => {
    if (!pgn.trim()) return;
    const parsed = parseGames(pgn)[0];
    if (!parsed) return;
    const text = sharePgn(parsed.game);
    // πρώτα ενημερώνουμε τι ξέρει ο server και πού είμαστε, ώστε η αλλαγή να μη σταλεί πίσω
    synced.current = text;
    if (text === sharePgn(ctrl.game)) return;
    const want = followRef.current && pendingPath.current ? pendingPath.current : pathOf(ctrl.node);
    const target = nodeAt(parsed.game, want);
    lastPath.current = pathOf(target);
    if (pendingPath.current && samePath(lastPath.current, pendingPath.current)) pendingPath.current = null;
    ctrl.applyRemote(parsed.game, () => target);
  };

  // σύνδεση
  useEffect(() => {
    let alive = true;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const base = server.replace(/\/+$/, '');
    const connect = () => {
      if (!alive) return;
      const url = socketUrl(base, id, tokenRef.current, optsRef.current.name).replace(`/ws/${id}`, `/wa/${id}`);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 25_000);
      };
      ws.onmessage = (ev) => {
        let m: ShareServerMsg;
        try {
          m = JSON.parse(String(ev.data)) as ShareServerMsg;
        } catch {
          return;
        }
        switch (m.t) {
          case 'welcome':
            pidRef.current = m.pid;
            setPid(m.pid);
            if (m.role === 'host') {
              hostRef.current = m.pid;
              setHost(m.pid);
            }
            setV(m.v ?? 0);
            if (m.token) {
              tokenRef.current = m.token;
              optsRef.current.onToken?.(m.token);
            }
            break;
          case 'init': {
            const initHost = m.host ?? 'h';
            hostRef.current = initHost;
            setHost(initHost);
            const mine = sharePgn(ctrl.game);
            // αν ο οικοδεσπότης έχει ήδη κινήσεις (π.χ. ήρθαν από Watch Live) ενώ το δωμάτιο φτιάχτηκε άδειο, κρατάμε τις δικές του
            const serverEmpty = !m.pgn || !parseGames(m.pgn)[0]?.game.root.children.length;
            const hostHasLive = pidRef.current === initHost && ctrl.game.root.children.length > 0 && serverEmpty;
            if (m.pgn && m.pgn !== mine && !hostHasLive) applyPgn(m.pgn);
            else synced.current = hostHasLive ? '' : m.pgn || mine;
            // ξανασύνδεση με αλλαγές που δεν έφυγαν: τις στέλνουμε τώρα
            if (sharePgn(ctrl.game) !== synced.current) {
              synced.current = sharePgn(ctrl.game);
              sendRef.current({ t: 'pgn', pgn: synced.current });
            }
            setChat(m.chat);
            setPresence(m.presence);
            setCursors(m.cursors);
            setEngine(m.engine);
            setLive(m.live ? { ...m.live, at: Date.now() } : null);
            setVideo(m.video ?? null);
            setVideoSync(m.videoSync ? { ...m.videoSync, at: Date.now() } : null);
            setRules(m.rules ?? null);
            setVoices(m.voice ?? {});
            // μπαίνουμε στη θέση όπου βρίσκεται ήδη ο άλλος
            const other = leader(m.cursors);
            if (other && followRef.current) goPath(other);
            else sendRef.current({ t: 'cursor', path: pathOf(ctrl.node) });
            break;
          }
          case 'pgn':
            applyPgn(m.pgn);
            break;
          case 'cursor':
            setCursors((c) => ({ ...c, [m.by]: m.path }));
            if (followRef.current) goPath(m.path);
            break;
          case 'chat':
            setChat((c) => [...c, m.msg].slice(-200));
            break;
          case 'presence':
            setPresence(m.presence);
            break;
          case 'engine':
            setEngine(m.info);
            break;
          case 'live':
            setLive(m.info ? { ...m.info, at: Date.now() } : null);
            break;
          case 'video':
            setVideo(m.id);
            setVideoSync(null);
            break;
          case 'videoSync':
            setVideoSync(m.sync ? { ...m.sync, at: Date.now() } : null);
            break;
          case 'host':
            hostRef.current = m.pid;
            setHost(m.pid);
            break;
          case 'rules':
            setRules(m.rules);
            break;
          case 'voice':
            setVoices((all) => {
              const next = { ...all };
              if (m.state) next[m.by] = m.state;
              else delete next[m.by];
              return next;
            });
            break;
          case 'rtc':
            rtcRef.current?.(m.by, m.data);
            break;
        }
      };
      ws.onclose = (ev) => {
        clearInterval(ping);
        if (wsRef.current === ws) wsRef.current = null;
        if (!alive) return;
        if (ev.code === 4404) return setStatus('gone');
        if (ev.code === 4429) return setStatus('full');
        if (ev.code === SHARE_KICKED) return setStatus('kicked');
        if (ev.code === SHARE_ENDED) return setStatus('ended');
        if (ev.code === SHARE_LOCKED) return setStatus('locked');
        setStatus('retrying');
        timer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(ping);
      wsRef.current?.close(1000);
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl, server, id]);

  // οι δικές μας αλλαγές: το PGN (λίγο μετά, για να μαζεύονται) και η θέση (αμέσως)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (synced.current === null) return;
      const pgn = sharePgn(ctrl.game);
      if (pgn === synced.current) return;
      synced.current = pgn;
      sendRef.current({ t: 'pgn', pgn });
    };
    const off = ctrl.subscribe(() => {
      if (!timer) timer = setTimeout(flush, 60);
      const path = pathOf(ctrl.node);
      if (!samePath(path, lastPath.current)) {
        lastPath.current = path;
        pendingPath.current = null;
        // η νέα κίνηση πρέπει να φτάσει πριν από τη θέση που τη χρειάζεται
        if (timer) {
          clearTimeout(timer);
          flush();
        }
        sendRef.current({ t: 'cursor', path });
      }
    });
    return () => {
      off();
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    };
  }, [ctrl]);

  // χωρίς άδεια: η παρτίδα εδώ κλειδώνει (μόνο πλοήγηση)· τα ίδια ελέγχει και το relay
  const editable = canEdit(rules, pid, host);
  useEffect(() => {
    ctrl.locked = !editable;
    ctrl.onLocked = () => setBlockedAt(Date.now());
    ctrl.emit();
    return () => {
      ctrl.locked = false;
      ctrl.onLocked = null;
    };
  }, [ctrl, editable]);

  const setFollow = (on: boolean) => {
    setFollowState(on);
    followRef.current = on;
    if (on) {
      // πάμε εκεί όπου είναι ο άλλος
      const other = leader(cursors);
      if (other) goPath(other);
    }
  };

  /** Ποιον ακολουθούμε: πρώτα τον οικοδεσπότη, μετά όποιον άλλον αλλάζει την ανάλυση. */
  function leader(all: Record<Pid, string[]>): string[] | undefined {
    const h = hostRef.current;
    if (pidRef.current !== h && all[h]) return all[h];
    return Object.entries(all).find(([p]) => p !== pidRef.current)?.[1];
  }

  const fetchIceServers = async (): Promise<RTCIceServer[] | null> => {
    const t = tokenRef.current;
    if (!t) return null;
    try {
      const base = server.replace(/\/+$/, '');
      const r = await fetch(`${base}/api/analysis/${encodeURIComponent(id)}/ice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t }),
        signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(4000) : undefined,
      });
      if (!r.ok) return null;
      const d = (await r.json()) as { iceServers?: RTCIceServer[] };
      return Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : null;
    } catch {
      return null;
    }
  };

  const voice = useVoice({ id, pid, host, v, status, voices, rules, send, rtcRef, fetchIceServers });

  return { status, pid, host, role, presence, chat, engine, live, video, videoSync, cursors, follow, setFollow, send, v, rules, canEdit: editable, blockedAt, voices, voice };
}
