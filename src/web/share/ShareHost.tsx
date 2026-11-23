/**
 * Κοινή ανάλυση από το παράθυρο μιας παρτίδας: φτιάχνει το δωμάτιο με την παρτίδα όπως είναι (κινήσεις,
 * βαριάντες, σχόλια, βέλη), δίνει το link και κρατά το δέντρο συγχρονισμένο. Οι αλλαγές του άλλου μπαίνουν
 * στην ίδια την παρτίδα, άρα αποθηκεύονται κανονικά στη βάση με την «Αποθήκευση».
 */
import { useEffect, useRef, useState } from 'react';
import type { PvLine } from '../api.ts';
import type { GameController } from '../gameModel.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { playServer, serverBusy, serverDown } from '../online/server.ts';
import { ShareChat, ShareHead } from './SharePanel.tsx';
import { sharePgn, useShare } from './useShare.ts';
import { accountOf, setActivity } from '../social/social.ts';
import { ShareInvite } from '../social/FriendPick.tsx';
import { SHARE_CHAT } from '../../core/features.ts';
import type { ShareLiveInfo } from '../../core/share.ts';
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
  onRoom,
  onStop,
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
  onRoom: (r: ShareRoom) => void;
  onStop: () => void;
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
      onStop={onStop}
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
  onStop,
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
  onStop: () => void;
}) {
  const conn = useShare(ctrl, room.server, room.id, room.token || null, { name: room.name });
  const [chatOpen, setChatOpen] = useState(true);
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
    if (!open) return;
    const t = setTimeout(() => {
      const info = lines?.length ? { fen, depth: lines[0].depth, lines: lines.slice(0, 3).map((l) => ({ cp: l.cp, mate: l.mate, san: l.san.slice(0, 10) })) } : null;
      const key = JSON.stringify(info);
      if (key === sent.current) return;
      sent.current = key;
      conn.send({ t: 'engine', info });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, fen, open]);

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
    if (!window.confirm(L('Να τελειώσει η κοινή ανάλυση; Η παρτίδα με όλες τις αλλαγές μένει σε αυτό το παράθυρο.', 'Stop sharing? The game with all changes stays in this window.'))) return;
    if (conn.role === 'host') {
      conn.send({ t: 'engine', info: null });
      conn.send({ t: 'live', info: null });
      conn.send({ t: 'video', id: null });
    }
    onStop();
  };

  return (
    <div className="sa-panel">
      <ShareHead conn={conn} link={shareLink(room)} video={video} onStop={stop} />
      <ShareInvite server={room.server} room={room.id} info={title && title !== 'Κοινή ανάλυση' && title !== 'Shared analysis' ? { title } : undefined} />
      {SHARE_CHAT && <button type="button" className="sa-toggle faint small" onClick={() => setChatOpen((o) => !o)}>
        {chatOpen ? '▾' : '▸'} {L('Συνομιλία', 'Chat')}{conn.chat.length ? ` (${conn.chat.length})` : ''}
      </button>}
      {SHARE_CHAT && chatOpen && <ShareChat conn={conn} />}
    </div>
  );
}
