/**
 * Καρτέλα «Παίξε με φίλο»: φτιάχνεις ένα link, το στέλνεις στον φίλο σου και παίζετε. Ο φίλος ανοίγει το link
 * στον browser του (δεν χρειάζεται Ruru). Οι κινήσεις περνούν από τον μικρό server του relay/ (Cloudflare).
 */
import { useEffect, useRef, useState } from 'react';
import { Activity, Check, Copy, Dices, Eye, Link2, LogOut, RotateCcw, Send, SlidersHorizontal, Users, X, type LucideIcon } from 'lucide-react';
import { START_FEN } from '../../core/chess.ts';
import { Board } from '../components/Board.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { L } from '../i18n.ts';
import { newTabId, useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { useBoardSettings } from '../tactics/common.tsx';
import { OnlineGame } from '../online/OnlineGame.tsx';
import { useOnlineRoom } from '../online/useRoom.ts';
import '../tactics/tactics.css';
import '../play/play.css';
import '../online/online.css';
import '../online/friend.css';
import { accountOf, activityOf, setActivity, useSocial } from '../social/social.ts';
import { GameFriendList } from '../social/FriendPick.tsx';
import { randomId } from '../../core/online.ts';

import { DEFAULT_PLAY_SERVER, playServer, serverBusy, serverDown } from '../online/server.ts';

export const TIME_CONTROLS = ['1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10', '30+0'];
const ROOM_KEY = 'kb.friend.room';

interface Remembered {
  name?: string;
  color?: 'white' | 'black' | 'random';
  tc?: string;
}

interface Room {
  server: string;
  id: string;
  /** '' για καλεσμένο που δεν μπήκε ακόμη */
  token: string;
  /** μπήκα με πρόσκληση των Φίλων (ή για να δω την παρτίδα ενός φίλου) */
  guest?: boolean;
  name?: string;
  /** μόνο για να δω την παρτίδα ενός φίλου */
  watch?: boolean;
  /** την έφτιαξα για να καλέσω αυτόν τον φίλο (όνομα) */
  invited?: string;
}

function loadRoom(): Room | null {
  try {
    const r = JSON.parse(localStorage.getItem(ROOM_KEY) ?? 'null') as Room | null;
    return r && r.server && r.id && (r.token || r.guest) ? r : null;
  } catch {
    return null;
  }
}

function saveRoom(r: Room | null): void {
  try {
    if (r) localStorage.setItem(ROOM_KEY, JSON.stringify(r));
    else localStorage.removeItem(ROOM_KEY);
  } catch {
    // χωρίς αποθήκευση: η παρτίδα συνεχίζει όσο μένει ανοιχτή η καρτέλα
  }
}

export const linkOf = (r: Room) => `${r.server.replace(/\/+$/, '')}/g/${r.id}`;

export function FriendWindow({ active }: { active: boolean }) {
  const [room, setRoom] = useState<Room | null>(loadRoom);
  const open = (r: Room | null) => {
    saveRoom(r);
    setRoom(r);
  };
  // πρόσκληση από τους Φίλους: μπαίνουμε ως αντίπαλος (ή θεατής, αν η θέση έχει πιαστεί)
  const join = useSocial((s) => s.joinGame);
  useEffect(() => {
    if (!join) return;
    useSocial.setState({ joinGame: null });
    // είμαστε ήδη μέσα (π.χ. δεύτερο κλικ στο «Μπες»): μένουμε στην ίδια θέση
    if (room?.id === join.id) return;
    const cur = activityOf('friend');
    if (room && cur && !cur.open && !window.confirm(L('Η τωρινή παρτίδα σου δεν τελείωσε. Να την αφήσεις για τη νέα;', 'Your current game is not over. Leave it for the new one?'))) return;
    open({ server: join.server, id: join.id, token: randomId(24), guest: true, name: join.name, ...(join.watch ? { watch: true } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join]);
  // πρόσκληση σε φίλο από τη στήλη «Φίλοι»: η νέα παρτίδα, ως οικοδεσπότης
  const host = useSocial((s) => s.hostGame);
  useEffect(() => {
    if (!host) return;
    useSocial.setState({ hostGame: null });
    open({ server: host.server, id: host.id, token: host.token, invited: host.invited });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);
  return room ? (
    <div className="tx bots friend">
      <FriendGame key={room.id} room={room} active={active} onLobby={() => open(null)} />
    </div>
  ) : (
    <div className="kb-wrap">
      <Lobby onCreate={open} />
    </div>
  );
}

/** «5+3» → 5:00 και +3 */
function ClockPreview({ tc }: { tc: string }) {
  if (!tc) return null;
  const [m, inc] = tc.split('+').map(Number);
  return (
    <span className="friend-clk tnum">
      {m}:00{inc > 0 && <small>+{inc}</small>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// νέα πρόσκληση

function Lobby({ onCreate }: { onCreate: (r: Room) => void }) {
  const settings = useApp((s) => s.settings);
  const bs = useBoardSettings();
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const mem = (ui.friend ?? {}) as Remembered;
  // με λογαριασμό στους Φίλους: το όνομά του εκεί, ώστε ο φίλος να βλέπει ποιος είναι
  const [name, setName] = useState(accountOf(ui)?.name ?? mem.name ?? '');
  const [color, setColor] = useState<'white' | 'black' | 'random'>(mem.color ?? 'random');
  const [tc, setTc] = useState(mem.tc ?? '5+3');
  const [server, setServer] = useState(playServer(ui));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const srv = server.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/.test(srv)) {
      setError(L('Η διεύθυνση του server δεν είναι σωστή.', 'The server address is not valid.'));
      return;
    }
    setBusy(true);
    setError(null);
    setUiLater({ friend: { name: name.trim(), color, tc } satisfies Remembered, ...(srv !== DEFAULT_PLAY_SERVER ? { playServer: srv } : { playServer: '' }) });
    try {
      const res = await fetch(`${srv}/api/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || L('Παίκτης', 'Player'),
          color,
          tc: tc ? { base: Number(tc.split('+')[0]) * 60, inc: Number(tc.split('+')[1]) } : null,
        }),
      });
      if (res.status === 429) return setError(serverBusy());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as { id: string; token: string };
      onCreate({ server: srv, id: r.id, token: r.token });
    } catch {
      setError(serverDown(srv));
    } finally {
      setBusy(false);
    }
  };

  // προεπισκόπηση: η σκακιέρα γυρίζει με το χρώμα, το ρολόι δείχνει τον χρόνο
  const me = name.trim() || L('Παίκτης', 'Player');
  const mine = color === 'white' ? L('λευκά', 'White') : color === 'black' ? L('μαύρα', 'Black') : L('τυχαίο χρώμα', 'random colour');
  const theirs = color === 'white' ? L('μαύρα', 'Black') : color === 'black' ? L('λευκά', 'White') : L('τυχαίο χρώμα', 'random colour');
  const steps: [LucideIcon, string][] = [
    [SlidersHorizontal, L('Διάλεξε χρώμα και ρολόι.', 'Choose a colour and a clock.')],
    [Link2, L('Πάτα «Φτιάξε link» και αντίγραψέ το.', 'Press “Create link” and copy it.')],
    [Send, L('Στείλ’ το στον φίλο σου (Viber, Messenger, email…). Μόλις το ανοίξει, ξεκινάτε.', 'Send it to your friend (WhatsApp, Messenger, email…). As soon as they open it, you start.')],
    [RotateCcw, L('Στο τέλος: ρεβάνς ή ανάλυση της παρτίδας στο Ruru.', 'At the end: a rematch, or analyse the game in Ruru.')],
  ];

  return (
    <div className="kb-page">
      <header className="kb-head with-ic">
        <span className="kb-head-ic" aria-hidden>
          <Users size={28} />
        </span>
        <div>
          <h1 className="kb-title" data-guide="friend">
            {L('Παίξε με φίλο', 'Play a friend')}
          </h1>
          <p className="kb-sub">
            {L(
              'Φτιάξε ένα link και στείλ’ το. Ο φίλος σου παίζει από τον browser, στον υπολογιστή ή στο κινητό, χωρίς Ruru και χωρίς λογαριασμό.',
              'Create a link and send it. Your friend plays in the browser, on a computer or a phone, with no Ruru and no account.',
            )}
          </p>
        </div>
      </header>

      <div className="friend-grid">
        <section className="kb-card friend-prev" aria-label={L('Προεπισκόπηση', 'Preview')}>
          <div className="friend-pbar">
            <span className="friend-pav ghost" aria-hidden>
              ?
            </span>
            <div className="friend-pwho">
              <b>{L('Φίλος σου', 'Your friend')}</b>
              <span>{theirs}</span>
            </div>
            <ClockPreview tc={tc} />
          </div>
          <div className="friend-pboard">
            <Board fen={START_FEN} orientation={color === 'black' ? 'black' : 'white'} movable="none" theme={bs.theme} pieceSet={bs.pieceSet} coordinates={bs.coordinates} animationMs={0} />
          </div>
          <div className="friend-pbar">
            <span className="friend-pav" aria-hidden>
              {me.slice(0, 1).toUpperCase()}
            </span>
            <div className="friend-pwho">
              <b>
                {me} <span className="friend-you">({L('εσύ', 'you')})</span>
              </b>
              <span>{mine}</span>
            </div>
            <ClockPreview tc={tc} />
          </div>
        </section>

        <div className="friend-side">
          <section className="kb-card" aria-label={L('Ρυθμίσεις της παρτίδας', 'Game settings')}>
            <div className="kb-card-head">
              <span className="kb-card-av" aria-hidden>
                <Users size={22} />
              </span>
              <div>
                <b>{L('Νέα πρόσκληση', 'New invitation')}</b>
                <span>{L('Ρυθμίσεις της παρτίδας', 'Game settings')}</span>
              </div>
            </div>
            <div className="kb-card-body">
              <label className="kb-field">
                {L('Το όνομά σου (το βλέπει ο φίλος σου)', 'Your name (your friend sees it)')}
                <input className="kb-input" value={name} maxLength={24} placeholder={L('Παίκτης', 'Player')} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="friend-two">
                <div className="kb-field">
                  {L('Παίζω με', 'I play')}
                  <Segmented
                    kb
                    label={L('Παίζω με', 'I play')}
                    value={color}
                    onChange={setColor}
                    options={[
                      { value: 'white', label: L('Λευκά', 'White') },
                      { value: 'black', label: L('Μαύρα', 'Black') },
                      { value: 'random', label: L('Τυχαία', 'Random'), icon: Dices },
                    ]}
                  />
                </div>
                <label className="kb-field">
                  {L('Ρολόι', 'Clock')}
                  <select className="kb-input" value={tc} onChange={(e) => setTc(e.target.value)}>
                    <option value="">{L('Χωρίς ρολόι', 'No clock')}</option>
                    {TIME_CONTROLS.map((t) => {
                      const m = Number(t.split('+')[0]);
                      return (
                        <option key={t} value={t}>
                          {t.replace('+', ' + ')} {m < 3 ? '(bullet)' : m < 10 ? '(blitz)' : '(rapid)'}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
              <details className="kb-more">
                <summary>{L('Για προχωρημένους', 'Advanced')}</summary>
                <label className="kb-field">
                  {L('Server των παρτίδων', 'Game server')}
                  <input className="kb-input" value={server} spellCheck={false} onChange={(e) => setServer(e.target.value)} />
                </label>
              </details>
              {error && <div className="kb-callout danger">{error}</div>}
            </div>
            <div className="kb-card-foot">
              <button type="button" className="kb-btn primary lg" disabled={busy} onClick={() => void create()}>
                <Link2 aria-hidden />
                {busy ? L('Δημιουργία…', 'Creating…') : L('Φτιάξε link', 'Create link')}
              </button>
              <span className="faint small">{L('Το όνομα που γράφεις και οι κινήσεις περνούν από server (Cloudflare) και σβήνουν περίπου μία μέρα μετά.', 'The name you type and the moves pass through a server (Cloudflare) and are deleted about a day later.')}</span>
            </div>
          </section>
          <GameFriendList color={color} tc={tc} onSend={() => setUiLater({ friend: { name: name.trim(), color, tc } satisfies Remembered })} />
        </div>
      </div>

      <ol className="kb-steps four">
        {steps.map(([Icon, text]) => (
          <li key={text} className="kb-step">
            <span className="kb-step-ic">
              <Icon size={18} aria-hidden />
            </span>
            <div>
              <span>{text}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// η παρτίδα

function FriendGame({ room, active, onLobby }: { room: Room; active: boolean; onLobby: () => void }) {
  const openTab = useApp((s) => s.openTab);
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const bs = useBoardSettings();
  const conn = useOnlineRoom(room.server, room.id, room.token || null, {
    name: room.name,
    // ο καλεσμένος κρατά το κλειδί του, για να ξαναμπεί στην ίδια θέση
    onToken: (t) => room.guest && saveRoom({ ...room, token: t }),
  });
  const s = conn.state;

  // Φίλοι: «σε παρτίδα» (ή «περιμένει αντίπαλο») όσο τρέχει η παρτίδα
  // (όχι για τον θεατή)
  const live = s && !s.result && (conn.role === 'host' || conn.role === 'guest');
  useEffect(() => {
    // με την πρόσκληση από τους Φίλους φεύγουν και το ρολόι και το χρώμα του καλεσμένου
    const tc = !s?.tc ? '' : s.tc.base % 60 === 0 ? `${s.tc.base / 60}+${s.tc.inc}` : undefined;
    const info = s ? { ...(tc !== undefined ? { tc } : {}), color: s.hostColor === 'w' ? ('black' as const) : ('white' as const) } : undefined;
    setActivity('friend', live ? { s: 'game', room: room.id, open: !s.guestJoined, server: room.server, info } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, s?.guestJoined, room.id, room.server]);
  useEffect(() => () => setActivity('friend', null), []);

  // ο φίλος μπήκε: μήνυμα, και η καρτέλα της παρτίδας μπροστά (το ρολόι μπορεί να τρέχει)
  const joined = s ? s.guestJoined : null;
  const seen = useRef<boolean | null>(null);
  useEffect(() => {
    if (joined === null) return;
    if (seen.current === false && joined && conn.role === 'host') {
      toast(L(`Ο/Η ${s?.names.guest || 'φίλος σου'} μπήκε στην παρτίδα.`, `${s?.names.guest || 'Your friend'} joined the game.`), 'ok');
      if (!active) useApp.getState().activate('friend');
    }
    seen.current = joined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  const link = linkOf(room);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // το δωμάτιο έληξε στον server: πίσω στη νέα πρόσκληση
  useEffect(() => {
    if (conn.status === 'gone') {
      toast(room.guest ? L('Αυτή η παρτίδα δεν υπάρχει πια (η πρόσκληση έληξε).', 'This game no longer exists (the invitation has expired).') : L('Η παρτίδα έληξε· φτιάξε νέο link.', 'The game has expired; create a new link.'), 'info');
      onLobby();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.status]);

  // με πρόσκληση, αλλά η θέση του αντιπάλου είχε ήδη πιαστεί
  useEffect(() => {
    if (conn.role === 'spectator' && room.guest && !room.watch) toast(L('Η θέση του αντιπάλου έχει ήδη πιαστεί· βλέπεις την παρτίδα ως θεατής.', 'The opponent’s seat is already taken; you are watching as a spectator.'), 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.role]);

  const copy = () => {
    void navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => toast(link, 'info'),
    );
  };

  // ο θεατής απλώς φεύγει· ο παίκτης εγκαταλείπει (ή ακυρώνει, πριν από την 2η κίνηση) μια παρτίδα σε εξέλιξη
  const player = conn.role === 'host' || conn.role === 'guest';
  const inGame = Boolean(player && s && !s.result && s.guestJoined);
  const leave = () => {
    if (inGame && s && s.moves.length >= 2) {
      if (!window.confirm(L('Η παρτίδα δεν τελείωσε. Να την εγκαταλείψεις και να φύγεις;', 'The game is not over. Resign and leave?'))) return;
      conn.send({ t: 'resign' });
    } else if (inGame) conn.send({ t: 'abort' });
    onLobby();
  };

  const waiting = s && !s.guestJoined;
  const watching = conn.role === 'spectator' || room.watch;
  const exitLabel = waiting && !room.guest ? L('Ακύρωση πρόσκλησης', 'Cancel invitation') : inGame && s && s.moves.length >= 2 ? L('Εγκατάλειψη και έξοδος', 'Resign and leave') : L('Έξοδος', 'Leave');
  const head = (
    <>
      <div className="friend-exit-bar">
        <h2 className="friend-exit-title">
          {watching ? <Eye size={18} aria-hidden /> : <Users size={18} aria-hidden />}
          {watching ? L('Παρακολούθηση', 'Watching') : L('Παρτίδα με φίλο', 'Game with a friend')}
        </h2>
        <button type="button" className="kb-btn sm" onClick={leave} title={L('Έξοδος από την παρτίδα (πίσω στη νέα πρόσκληση)', 'Leave the game (back to a new invitation)')}>
          {waiting && !room.guest ? <X aria-hidden /> : <LogOut aria-hidden />}
          {exitLabel}
        </button>
      </div>
      {waiting && room.invited && (
        <div className="friend-invited" role="status">
          <Send size={16} aria-hidden />
          {L(`Στάλθηκε πρόσκληση στον/στην ${room.invited}. Μόλις πατήσει ✓, ξεκινάτε.`, `Invitation sent to ${room.invited}. As soon as they press ✓, you start.`)}
        </div>
      )}
      <div className={`friend-link${waiting && !room.invited ? ' is-waiting' : ''}`}>
        <span className="friend-link-lbl">
          {waiting
            ? room.invited
              ? L('Ή στείλε το link σε όποιον θέλεις', 'Or send the link to anyone')
              : L('Στείλε αυτό το link στον φίλο σου', 'Send this link to your friend')
            : L('Link της παρτίδας (και για θεατές)', 'Game link (spectators too)')}
        </span>
        <div className="friend-link-row">
          <input className="kb-input tnum" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
          <button type="button" className={`kb-btn${waiting && !room.invited ? ' primary' : ''}`} onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? L('Αντιγράφηκε', 'Copied') : L('Αντιγραφή', 'Copy')}
          </button>
        </div>
        {waiting && room.server.startsWith('http://localhost') && (
          <span className="friend-link-note">{L('Τοπική δοκιμή: το link ανοίγει μόνο σε αυτόν τον υπολογιστή.', 'Local test: the link only opens on this computer.')}</span>
        )}
      </div>
    </>
  );

  return (
    <OnlineGame
      conn={conn}
      active={active}
      event={L('Παρτίδα με φίλο', 'Game with a friend')}
      look={{ ...bs, figurines: (ui.notation ?? 'figurine') === 'figurine' }}
      head={head}
      endActions={(pgn) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const w = /\[White "([^"]*)"\]/.exec(pgn)?.[1] ?? '';
            const b = /\[Black "([^"]*)"\]/.exec(pgn)?.[1] ?? '';
            openTab({ id: newTabId('game'), kind: 'game', title: `${w} – ${b}`, pgn });
          }}
        >
          <Activity className="ic ic-sm" aria-hidden />
          {L('Ανάλυση της παρτίδας', 'Analyse the game')}
        </button>
      )}
    />
  );
}
