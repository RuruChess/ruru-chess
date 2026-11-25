/**
 * Κοινή ανάλυση από το παράθυρο μιας παρτίδας: φτιάχνει το δωμάτιο με την παρτίδα όπως είναι (κινήσεις,
 * βαριάντες, σχόλια, βέλη), δίνει το link και κρατά το δέντρο συγχρονισμένο. Οι αλλαγές του άλλου μπαίνουν
 * στην ίδια την παρτίδα, άρα αποθηκεύονται κανονικά στη βάση με την «Αποθήκευση».
 */
import { useEffect, useRef, useState } from 'react';
import { LogOut, Power } from 'lucide-react';
import type { PvLine } from '../api.ts';
import type { GameController } from '../gameModel.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { Dialog } from '../components/ui.tsx';
import { playServer, serverBusy, serverDown } from '../online/server.ts';
import { ShareChat, ShareHead } from './SharePanel.tsx';
import { sharePgn, useShare } from './useShare.ts';
import { accountOf, setActivity } from '../social/social.ts';
import { ShareInvite } from '../social/FriendPick.tsx';
import { SHARE_CHAT } from '../../core/features.ts';
import type { Pid, ShareLiveInfo } from '../../core/share.ts';
import { liveRemaining, type LiveState } from '../watch/useLive.ts';
import type { ShareVideoControl } from './ShareMembers.tsx';

export interface ShareRoom {
  server: string;
  id: string;
  /** '' για καλεσμένο που μπαίνει πρώτη φορά (από πρόσκληση των Φίλων) */
  token: string;
  /** το όνομα του καλεσμένου */
  name?: string;
}
export type ShareStart = 'new' | ShareRoom;

export const SHARE_LAST_KEY = 'kb.share.last';
export const shareLink = (r: ShareRoom) => `${r.server.replace(/\/+$/, '')}/a/${r.id}`;

/** Η τελευταία κοινή ανάλυση που φτιάξαμε (για το «Συνέχισε»), αν δεν έχει λήξει. */
export function lastShare(): (ShareRoom & { title: string; at: number }) | null {
  try {
    const r = JSON.parse(localStorage.getItem(SHARE_LAST_KEY) ?? 'null') as (ShareRoom & { title: string; at: number }) | null;
    // τα δωμάτια σβήνουν μία μέρα μετά την τελευταία αλλαγή
    return r && r.id && r.token && Date.now() - r.at < 20 * 3600 * 1000 ? r : null;
  } catch {
    return null;
  }
}

export function rememberShare(r: ShareRoom & { title: string }): void {
  try {
    localStorage.setItem(SHARE_LAST_KEY, JSON.stringify({ ...r, at: Date.now() }));
  } catch {
    // χωρίς αποθήκευση: απλώς δεν θα υπάρχει «Συνέχισε»
  }
}

export function forgetShare(id: string): void {
  try {
    const r = JSON.parse(localStorage.getItem(SHARE_LAST_KEY) ?? 'null') as { id?: string } | null;
    if (r?.id === id) localStorage.removeItem(SHARE_LAST_KEY);
  } catch {
    // αγνοούμε
  }
}

function toShareLive(st: LiveState | null | undefined): ShareLiveInfo | null {
  if (!st) return null;
  const now = Date.now();
  return { status: st.status, w: liveRemaining(st, 'w', now), b: liveRemaining(st, 'b', now), turn: st.clocks?.turn ?? 'w', at: now, plies: st.plies };
}

export function ShareHost({
  ctrl,
  start,
  fen,
  lines,
  title,
  tabId,
  live,
  onLive,
  video,
  leaveSignal,
  onRoom,
  onStop,
  onEnded,
}: {
  ctrl: GameController;
  start: ShareStart;
  fen: string;
  lines?: PvLine[];
  title: string;
  tabId?: string;
  live?: LiveState | null;
  onLive?: (info: ShareLiveInfo | null) => void;
  video?: ShareVideoControl;
  /** αύξων αριθμός όταν ο χρήστης πατάει «Έξοδος» από τη μπάρα του ShareWindow */
  leaveSignal?: number;
  onRoom: (r: ShareRoom) => void;
  onStop: () => void;
  onEnded?: () => void;
}) {
  const settings = useApp((s) => s.settings);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);
  const [waitExpired, setWaitExpired] = useState(false);

  // αν ανοίξαμε live παρτίδα κατευθείαν σε κοινή ανάλυση, περιμένουμε λίγο (έως 2,5″) να έρθουν οι κινήσεις από το Lichess
  const waitingLive = start === 'new' && live?.status === 'connecting' && !ctrl.game.root.children.length && !waitExpired;
  useEffect(() => {
    if (!waitingLive) return;
    const t = setTimeout(() => setWaitExpired(true), 2500);
    return () => clearTimeout(t);
  }, [waitingLive]);

  useEffect(() => {
    if (start !== 'new' || creating.current || waitingLive) return;
    creating.current = true;
    const server = playServer(ui);
    const name = accountOf(ui)?.name || (((ui.friend as { name?: string } | undefined)?.name ?? '') as string).trim() || L('Οικοδεσπότης', 'Host');
    fetch(`${server}/api/analysis/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // rules: ο οικοδεσπότης αποφασίζει ποιος αλλάζει την ανάλυση (οι καλεσμένοι μπαίνουν μόνο για να βλέπουν)
      body: JSON.stringify({ name, pgn: sharePgn(ctrl.game), rules: true }),
    })
      .then(async (r) => {
        if (r.status === 429) return setError(serverBusy());
        if (!r.ok) throw new Error(r.status === 413 ? 'large' : `HTTP ${r.status}`);
        const j = (await r.json()) as { id: string; token: string };
        const room = { server, id: j.id, token: j.token };
        rememberShare({ ...room, title });
        onRoom(room);
      })
      .catch((e: unknown) => setError(e instanceof Error && e.message === 'large' ? L('Η παρτίδα είναι πολύ μεγάλη για κοινή ανάλυση.', 'The game is too large to share.') : serverDown(server)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, waitingLive]);

  const initLeaveSignal = useRef(leaveSignal ?? 0);
  useEffect(() => {
    if (start !== 'new' || !leaveSignal || leaveSignal === initLeaveSignal.current) return;
    initLeaveSignal.current = leaveSignal;
    onStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, leaveSignal]);

  if (start === 'new') {
    return (
      <div className="sa-panel">
        <div className="sa-head">
          {error ? (
            <div className="sa-row">
              <span className="sa-status is-error">{error}</span>
              <span className="sa-spacer" />
              <button type="button" className="sa-btn" onClick={onStop}>
                {L('Κλείσιμο', 'Close')}
              </button>
            </div>
          ) : (
            <div className="sa-status">{L('Ετοιμάζεται η κοινή ανάλυση…', 'Preparing the shared analysis…')}</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <ShareLive
      ctrl={ctrl}
      room={start}
      fen={fen}
      lines={lines}
      title={title}
      tabId={tabId}
      live={live}
      onLive={onLive}
      video={video}
      leaveSignal={leaveSignal}
      onStop={onStop}
      onEnded={onEnded}
    />
  );
}

function ShareLive({
  ctrl,
  room,
  fen,
  lines,
  title,
  tabId,
  live,
  onLive,
  video,
  leaveSignal,
  onStop,
  onEnded,
}: {
  ctrl: GameController;
  room: ShareRoom;
  fen: string;
  lines?: PvLine[];
  title: string;
  tabId?: string;
  live?: LiveState | null;
  onLive?: (info: ShareLiveInfo | null) => void;
  video?: ShareVideoControl;
  leaveSignal?: number;
  onStop: () => void;
  onEnded?: () => void;
}) {
  const conn = useShare(ctrl, room.server, room.id, room.token || null, { name: room.name });
  const [chatOpen, setChatOpen] = useState(true);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const toast = useApp((s) => s.toast);

  // κάποιος μπήκε (π.χ. ο φίλος που δέχτηκε την πρόσκληση): μήνυμα
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const online = conn.presence.online;
    if (!conn.pid || !online.includes(conn.pid)) return;
    if (seen.current) {
      for (const p of online) if (!seen.current.has(p)) toast(L(`Ο/Η ${conn.presence.names[p] ?? p} μπήκε στην κοινή ανάλυση.`, `${conn.presence.names[p] ?? p} joined the shared analysis.`), 'ok');
    }
    seen.current = new Set([...(seen.current ?? []), ...online]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.presence, conn.pid]);

  // αλλαγή host: ειδοποίηση στους συμμετέχοντες
  const prevHost = useRef<Pid | null>(null);
  useEffect(() => {
    if (!conn.pid || conn.status !== 'open') return;
    if (prevHost.current && prevHost.current !== conn.host) {
      if (conn.host === conn.pid) toast(L('Έγινες host της κοινής ανάλυσης.', 'You are now the host of the shared analysis.'), 'ok');
      else {
        const who = conn.presence.names[conn.host] ?? conn.host;
        toast(L(`Ο/Η ${who} είναι πλέον host της κοινής ανάλυσης.`, `${who} is now the host of the shared analysis.`), 'info');
      }
    }
    prevHost.current = conn.host;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.host, conn.pid, conn.status]);

  // ο host τερμάτισε τη συνεδρία για όλους: έξοδος στην αρχική οθόνη της Κοινής ανάλυσης
  const endedHandled = useRef(false);
  useEffect(() => {
    if (conn.status !== 'ended' || endedHandled.current) return;
    endedHandled.current = true;
    forgetShare(room.id);
    toast(L('Ο οικοδεσπότης τερμάτισε την κοινή ανάλυση.', 'The host ended the shared analysis.'), 'info');
    (onEnded ?? onStop)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.status]);

  // Φίλοι: «σε κοινή ανάλυση» (με το δωμάτιο, για να μπορούν να μπουν)
  useEffect(() => {
    const source = `share:${room.id}`;
    // ο τίτλος (π.χ. «Banikas – Vysochin») φεύγει με τις προσκλήσεις· όχι το γενικό «Κοινή ανάλυση»
    const generic = title === 'Κοινή ανάλυση' || title === 'Shared analysis';
    setActivity(source, { s: 'analysis', room: room.id, server: room.server, ...(title && !generic ? { info: { title } } : {}), ...(tabId ? { tab: tabId } : {}) });
    return () => setActivity(source, null);
  }, [room.id, room.server, title, tabId]);

  // η μηχανή μας και για τους άλλους (λίγο αραιά, για να μη φορτώνεται η σύνδεση)
  const sent = useRef('');
  const open = conn.status === 'open';
  useEffect(() => {
    if (!open || conn.role !== 'host') return;
    const t = setTimeout(() => {
      const info = lines?.length ? { fen, depth: lines[0].depth, lines: lines.slice(0, 3).map((l) => ({ cp: l.cp, mate: l.mate, san: l.san.slice(0, 10) })) } : null;
      const key = JSON.stringify(info);
      if (key === sent.current) return;
      sent.current = key;
      conn.send({ t: 'engine', info });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, fen, open, conn.role]);

  // κατάσταση Watch Live: ο οικοδεσπότης τη στέλνει στο δωμάτιο, οι καλεσμένοι τη λαμβάνουν για live ρολόγια
  const sentLive = useRef('');
  useEffect(() => {
    if (!open || conn.role !== 'host') return;
    const info = toShareLive(live);
    const key = JSON.stringify(info);
    if (key === sentLive.current) return;
    sentLive.current = key;
    conn.send({ t: 'live', info });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, open, conn.role]);

  useEffect(() => {
    onLive?.(conn.role === 'host' ? null : conn.live);
    return () => onLive?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.live, conn.role]);

  const stop = () => {
    if (conn.role === 'host' && conn.status === 'open') {
      setLeaveDialog(true);
      return;
    }
    if (!onEnded && !window.confirm(L('Να βγεις από την κοινή ανάλυση; Η παρτίδα με όλες τις αλλαγές μένει σε αυτό το παράθυρο.', 'Leave the shared analysis? The game with all changes stays in this window.'))) return;
    onStop();
  };

  // «Έξοδος από την ανάλυση» από την πάνω μπάρα του ShareWindow
  const lastLeaveSignal = useRef(leaveSignal ?? 0);
  useEffect(() => {
    if (!leaveSignal || leaveSignal === lastLeaveSignal.current) return;
    lastLeaveSignal.current = leaveSignal;
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveSignal]);

  const leaveAsHost = () => {
    setLeaveDialog(false);
    conn.send({ t: 'leave' });
    (onEnded ?? onStop)();
  };

  const endForEveryone = () => {
    setLeaveDialog(false);
    conn.send({ t: 'end' });
    forgetShare(room.id);
    (onEnded ?? onStop)();
  };

  const othersOnline = conn.presence.online.filter((p) => p !== conn.pid).length;

  return (
    <div className="sa-panel">
      <ShareHead conn={conn} link={shareLink(room)} video={video} onStop={stop} />
      <ShareInvite server={room.server} room={room.id} info={title && title !== 'Κοινή ανάλυση' && title !== 'Shared analysis' ? { title } : undefined} />
      {SHARE_CHAT && <button type="button" className="sa-toggle faint small" onClick={() => setChatOpen((o) => !o)}>
        {chatOpen ? '▾' : '▸'} {L('Συνομιλία', 'Chat')}{conn.chat.length ? ` (${conn.chat.length})` : ''}
      </button>}
      {SHARE_CHAT && chatOpen && <ShareChat conn={conn} />}
      {leaveDialog && (
        <Dialog
          title={L('Αποχώρηση από την κοινή ανάλυση', 'Leave shared analysis')}
          onClose={() => setLeaveDialog(false)}
          width={440}
          footer={
            <button type="button" onClick={() => setLeaveDialog(false)}>
              {L('Άκυρο', 'Cancel')}
            </button>
          }
        >
          <div className="sa-leave-dlg">
            <p className="sa-leave-intro">
              {L('Είσαι host σε αυτή τη συνεδρία. Διάλεξε τι θέλεις να γίνει:', 'You are the host of this session. Choose what you want to do:')}
            </p>
            <button type="button" className="sa-leave-opt" onClick={leaveAsHost}>
              <span className="sa-leave-ic">
                <LogOut size={18} aria-hidden />
              </span>
              <span className="sa-leave-txt">
                <b>{L('Αποχώρηση (Leave session)', 'Leave session')}</b>
                <span className="faint small">
                  {othersOnline > 0
                    ? L('Φεύγεις εσύ και ο ρόλος του host μεταφέρεται αυτόματα στον παλαιότερο συμμετέχοντα.', 'You leave and the host role automatically transfers to the oldest remaining participant.')
                    : L('Φεύγεις από το δωμάτιο· η ανάλυση μένει ανοιχτή αν μπουν άλλοι.', 'You leave the room; the analysis stays open if others join.')}
                </span>
              </span>
            </button>
            <button type="button" className="sa-leave-opt danger" onClick={endForEveryone}>
              <span className="sa-leave-ic">
                <Power size={18} aria-hidden />
              </span>
              <span className="sa-leave-txt">
                <b>{L('Τερματισμός για όλους', 'End session for everyone')}</b>
                <span className="faint small">
                  {L('Κλείνει το δωμάτιο για όλους τους συμμετέχοντες και τους επιστρέφει στην αρχική οθόνη.', 'Closes the room for all participants and returns them to the start screen.')}
                </span>
              </span>
            </button>
            {ctrl.dirty && (
              <p className="faint small" style={{ margin: 0 }}>
                {L('Σημείωση: η παρτίδα έχει μη αποθηκευμένες αλλαγές (Ctrl+S για αποθήκευση σε βάση).', 'Note: the game has unsaved changes (Ctrl+S to save to a database).')}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
