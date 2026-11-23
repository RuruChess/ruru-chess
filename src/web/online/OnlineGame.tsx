/**
 * Η σκακιέρα της «Παρτίδας με φίλο»: την ίδια βλέπουν ο οικοδεσπότης μέσα στο Ruru και ο φίλος στη σελίδα
 * του link. Δείχνει ό,τι στέλνει ο server (κινήσεις, ρολόγια, προτάσεις ισοπαλίας, ρεβάνς) και στέλνει πίσω τις
 * κινήσεις μας. Χωρίς βοήθειες μηχανής: είναι παρτίδα ανάμεσα σε ανθρώπους.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Flag, FlipVertical2, Handshake, RotateCcw, Wifi, WifiOff, X } from 'lucide-react';
import { Position, START_FEN } from '../../core/chess.ts';
import { colorOf, opposite, roomPgn, timeLeft, turnOf, type Color, type OnlineEnd } from '../../core/online.ts';
import { Board } from '../components/Board.tsx';
import { useDrawnShapes } from '../components/drawnShapes.ts';
import type { Premove } from '../components/quickMove.ts';
import { L } from '../i18n.ts';
import { playMoveSound, playSound } from '../sounds.ts';
import type { RoomConn } from './useRoom.ts';

export interface BoardLook {
  theme?: string;
  pieceSet?: string;
  coordinates?: boolean;
  animationMs?: number;
  oneClick?: boolean;
  sounds?: boolean;
  /** «♘f3» ή «Nf3» */
  figurines?: boolean;
}

export interface OnlineGameProps {
  conn: RoomConn;
  look: BoardLook;
  /** δέχεται πλήκτρα (← → Home End F) */
  active: boolean;
  /** «Event» του PGN */
  event: string;
  /** πάνω στο πλάι: π.χ. το link για τον φίλο */
  head?: ReactNode;
  /** κουμπιά στο τέλος της παρτίδας (ανάλυση, κατέβασμα PGN…) */
  endActions?: (pgn: string) => ReactNode;
}

const FIG: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const sanText = (san: string, fig: boolean) => (fig ? san.replace(/[KQRBN]/g, (c) => FIG[c] ?? c) : san);

/** m:ss (δέκατα κάτω από 10 δευτ.) */
function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return s.toFixed(1);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function materialDiff(fen: string): number {
  const v: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let d = 0;
  for (const ch of fen.split(' ')[0]) {
    const x = v[ch.toLowerCase()];
    if (x) d += ch === ch.toUpperCase() ? x : -x;
  }
  return d;
}

const moveCount = (n: number) => (n === 1 ? L('1 κίνηση', '1 move') : L(`${n} κινήσεις`, `${n} moves`));

export function endText(r: OnlineEnd, loser: string): string {
  switch (r) {
    case 'checkmate':
      return L('Ματ', 'Checkmate');
    case 'stalemate':
      return L('Πατ', 'Stalemate');
    case 'insufficient':
      return L('Ανεπαρκές υλικό', 'Insufficient material');
    case 'repetition':
      return L('Τριπλή επανάληψη', 'Threefold repetition');
    case 'fifty':
      return L('Κανόνας των 50 κινήσεων', 'Fifty-move rule');
    case 'resign':
      return L(`Εγκατέλειψε: ${loser}`, `${loser} resigned`);
    case 'agreement':
      return L('Ισοπαλία με συμφωνία', 'Draw by agreement');
    case 'flag':
      return L(`Τελείωσε ο χρόνος: ${loser}`, `${loser} ran out of time`);
    case 'abort':
      return L('Η παρτίδα ακυρώθηκε πριν παίξουν και οι δύο', 'The game was aborted before both sides moved');
  }
}

/** Οι θέσεις και οι κωδικοί των κινήσεων της παρτίδας (για τη σκακιέρα και την πλοήγηση). */
function replay(moves: string[]): { fens: string[]; codes: number[] } {
  const p = Position.fromFen(START_FEN);
  const fens = [p.fen()];
  const codes: number[] = [];
  for (const uci of moves) {
    const m = p.parseUci(uci);
    if (!m) break;
    codes.push(m);
    p.makeMove(m);
    fens.push(p.fen());
  }
  return { fens, codes };
}

export function OnlineGame({ conn, look, active, event, head, endActions }: OnlineGameProps) {
  const s = conn.state;
  const role = conn.role;
  const me: Color | null = s && (role === 'host' || role === 'guest') ? colorOf(s, role) : null;
  const opp: 'host' | 'guest' | null = role === 'host' ? 'guest' : role === 'guest' ? 'host' : null;

  // η κίνησή μας φαίνεται αμέσως, πριν απαντήσει ο server
  const [pending, setPending] = useState<{ uci: string; ply: number; game: number } | null>(null);
  // προ-κίνηση όσο παίζει ο αντίπαλος (μόνο για εμάς, δεν τη βλέπει)
  const [premove, setPremove] = useState<Premove | null>(null);
  const shown = s ? (pending && pending.game === s.game && pending.ply === s.moves.length && !s.result ? [...s.moves, pending.uci] : s.moves) : [];
  const key = `${s?.game ?? 0}:${shown.join(' ')}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { fens, codes } = useMemo(() => replay(shown), [key]);
  const tipPly = fens.length - 1;

  const [view, setView] = useState<number | null>(null);
  const ply = view === null ? tipPly : Math.min(view, tipPly);
  const atTip = ply === tipPly;
  const fen = fens[ply];
  // βέλη και κύκλοι (δεξί κλικ): μόνο για εμάς, δεν τα βλέπει ο αντίπαλος· μένουν όσο μένει η θέση
  const drawn = useDrawnShapes(fen);

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const oriented = useRef<string>('');
  useEffect(() => {
    // σε κάθε νέα παρτίδα (και στο ρεβάνς με αλλαγμένα χρώματα) η σκακιέρα γυρίζει από τη μεριά μας
    const k = `${s?.game}:${me}`;
    if (!s || oriented.current === k) return;
    oriented.current = k;
    setOrientation(me === 'b' ? 'black' : 'white');
    setView(null);
  }, [s, me]);

  // καθάρισμα της κίνησης σε αναμονή όταν τη δει ο server (ή την απορρίψει)
  useEffect(() => {
    if (!pending || !s) return;
    if (s.game !== pending.game || s.moves.length > pending.ply || s.result) setPending(null);
  }, [s, pending]);
  useEffect(() => {
    if (conn.error) {
      setPending(null);
      setPremove(null);
    }
  }, [conn.error]);

  const sendMove = (p: Position, m: number) => {
    if (!s) return;
    const uci = p.moveToUci(m);
    setPending({ uci, ply: s.moves.length, game: s.game });
    setView(null);
    if (look.sounds) playMoveSound(p.san(m));
    conn.send({ t: 'move', uci, ply: s.moves.length });
  };

  // προ-κίνηση: μόλις παίξει ο αντίπαλος στέλνεται αμέσως, αν είναι νόμιμη (αλλιώς σβήνει αθόρυβα)·
  // σβήνει και στο τέλος της παρτίδας ή αν φύγουμε από την τελευταία θέση
  useEffect(() => {
    if (!premove) return;
    if (!s || s.result || me === null || !atTip) {
      setPremove(null);
      return;
    }
    const tipFen = fens[tipPly];
    if (pending || turnOf(tipFen) !== me) return;
    setPremove(null);
    if (conn.status !== 'open') return;
    const p = Position.fromFen(tipFen);
    const m = p.findMove(premove.from, premove.to);
    if (m) sendMove(p, m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premove, s, pending, atTip]);

  // ήχοι: σε κάθε νέα κίνηση (όχι στο πρώτο φόρτωμα)
  const heard = useRef<{ game: number; n: number } | null>(null);
  useEffect(() => {
    if (!s) return;
    const prev = heard.current;
    heard.current = { game: s.game, n: s.moves.length };
    if (!prev || prev.game !== s.game || s.moves.length <= prev.n || !look.sounds) return;
    // τη δική μας κίνηση την ακούσαμε ήδη όταν την παίξαμε
    const last = s.moves.length - 1;
    if (turnOf(s.fen) !== me) playMoveSound(s.sans[last]);
  }, [s, me, look.sounds]);
  const ended = useRef<string>('');
  useEffect(() => {
    if (!s?.result || !look.sounds) return;
    const k = `${s.game}:${s.result}`;
    if (ended.current === k) return;
    const first = ended.current === '';
    ended.current = k;
    if (!first || s.moves.length) playSound('notify');
  }, [s, look.sounds]);

  // ρολόι: ανανέωση της εμφάνισης και ειδοποίηση του server όταν πέσει μια σημαία
  const [, setTick] = useState(0);
  const flagged = useRef('');
  const sendRef = useRef(conn.send);
  sendRef.current = conn.send;
  const offset = conn.offset;
  useEffect(() => {
    if (!s?.clock?.running || s.result) return;
    const t = setInterval(() => {
      setTick((x) => x + 1);
      const c = s.clock!;
      if (timeLeft(c, c.side, Date.now() + offset) <= 0) {
        const k = `${s.game}:${s.moves.length}:${Math.floor(Date.now() / 1000)}`;
        if (flagged.current !== k) {
          flagged.current = k;
          sendRef.current({ t: 'flag' });
        }
      }
    }, 100);
    return () => clearInterval(t);
  }, [s, offset]);

  // πλήκτρα
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowLeft') setView((v) => Math.max(0, (v ?? tipPly) - 1));
      else if (e.key === 'ArrowRight') setView((v) => (v === null || v + 1 >= tipPly ? null : v + 1));
      else if (e.key === 'Home') setView(0);
      else if (e.key === 'End') setView(null);
      else if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, tipPly]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [ply]);

  if (!s) {
    return (
      <div className="tx-center ol-wait">
        <div className="play-status">{conn.status === 'gone' ? L('Η παρτίδα δεν υπάρχει πια (το link έληξε).', 'This game no longer exists (the link has expired).') : L('Σύνδεση…', 'Connecting…')}</div>
      </div>
    );
  }

  const over = Boolean(s.result);
  const turn = turnOf(fens[tipPly]);
  const myTurn = me !== null && turn === me;
  const connected = conn.status === 'open';
  const canMove = connected && !over && atTip && myTurn && !pending && s.guestJoined;
  const nameOf = (c: Color) => {
    const isHost = c === s.hostColor;
    const n = isHost ? s.names.host : s.names.guest;
    return n || (isHost ? L('Οικοδεσπότης', 'Host') : L('Φίλος', 'Friend'));
  };
  const roleOf = (c: Color): 'host' | 'guest' => (c === s.hostColor ? 'host' : 'guest');

  const onMove = (from: number, to: number, promo: number) => {
    if (!canMove) return;
    const p = Position.fromFen(fens[tipPly]);
    const m = p.findMove(from, to, promo);
    if (m) sendMove(p, m);
  };

  const now = Date.now() + conn.offset;
  const diff = materialDiff(fen);
  const bar = (side: Color) => {
    const c = s.clock;
    const t = c ? timeLeft(c, side, now) : 0;
    const running = Boolean(c && c.running && !over && c.side === side);
    const isOnline = s.guestJoined || roleOf(side) === 'host' ? conn.online[roleOf(side)] : false;
    const d = side === 'w' ? diff : -diff;
    const name = nameOf(side);
    return (
      <div className={`play-bar${running ? ' is-running' : ''}`}>
        <span className="bot-av bot-av-you" aria-hidden>
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="play-bar-name">
          <span className="ol-name">{name}</span>
          {side === me && <span className="faint small">({L('εσύ', 'you')})</span>}
          <span className={`ol-dot${isOnline ? ' is-on' : ''}`} title={isOnline ? L('Συνδεδεμένος', 'Online') : L('Εκτός σύνδεσης', 'Offline')} />
          <span className="faint small">{side === 'w' ? L('λευκά', 'White') : L('μαύρα', 'Black')}</span>
          <span className="play-bar-mat tnum">{d > 0 ? `+${d}` : ''}</span>
        </span>
        {c && <span className={`play-clock tnum${running ? ' on' : ''}${running && t < 10_000 ? ' low' : ''}`}>{fmtClock(t)}</span>}
      </div>
    );
  };
  const top: Color = orientation === 'white' ? 'b' : 'w';
  const bottom: Color = opposite(top);

  // κατάσταση
  let status: ReactNode;
  if (conn.status === 'retrying') status = <span className="ol-warn">{L('Χάθηκε η σύνδεση· ξαναπροσπαθώ…', 'Connection lost; reconnecting…')}</span>;
  else if (conn.status === 'gone') status = <span className="ol-warn">{L('Η παρτίδα δεν υπάρχει πια.', 'This game no longer exists.')}</span>;
  else if (!connected) status = <span>{L('Σύνδεση…', 'Connecting…')}</span>;
  else if (!s.guestJoined) status = <span className="play-turn">{L('Περιμένουμε τον φίλο σου να ανοίξει το link…', 'Waiting for your friend to open the link…')}</span>;
  else if (me === null) status = <span>{turn === 'w' ? L('Θεατής · παίζουν τα λευκά', 'Spectating · White to move') : L('Θεατής · παίζουν τα μαύρα', 'Spectating · Black to move')}</span>;
  else if (opp && !conn.online[opp]) status = <span className="ol-warn">{L(`${nameOf(opposite(me))}: αποσυνδέθηκε· περιμένουμε να επιστρέψει…`, `${nameOf(opposite(me))} disconnected; waiting for them to return…`)}</span>;
  else if (myTurn) status = <span className="play-turn">{atTip ? L('Σειρά σου', 'Your move') : L('Σειρά σου· γύρνα στην τελευταία θέση (End) για να παίξεις.', 'Your move; go to the last position (End) to play.')}</span>;
  else status = <span className="muted">{L(`Σειρά του αντιπάλου: ${nameOf(opposite(me))}`, `${nameOf(opposite(me))} to move`)}</span>;

  // τέλος
  const score = s.result ? (s.result === '*' ? '–' : s.result.replace('1/2-1/2', '½–½').replace('-', '–')) : '';
  let overTitle = '';
  let overClass = 'is-draw';
  if (s.result) {
    const winner: Color | null = s.result === '1-0' ? 'w' : s.result === '0-1' ? 'b' : null;
    if (s.result === '*') overTitle = L('Ακυρώθηκε', 'Aborted');
    else if (!winner) overTitle = L('Ισοπαλία', 'Draw');
    else if (me === null) overTitle = L(`Νίκη: ${nameOf(winner)}`, `${nameOf(winner)} won`);
    else if (winner === me) {
      overTitle = L('Κέρδισες!', 'You won!');
      overClass = 'is-win';
    } else {
      overTitle = L('Έχασες', 'You lost');
      overClass = 'is-loss';
    }
  }
  const loser = s.result === '1-0' ? nameOf('b') : s.result === '0-1' ? nameOf('w') : '';
  const myRematch = role === 'host' || role === 'guest' ? s.rematch[role] : false;
  const oppRematch = opp ? s.rematch[opp] : false;

  const rows: Array<{ num: number; w?: number; b?: number }> = [];
  for (let i = 0; i < tipPly; i++) {
    if (i % 2 === 0) rows.push({ num: i / 2 + 1, w: i + 1 });
    else rows[rows.length - 1].b = i + 1;
  }
  const sans = s.sans.length === tipPly ? s.sans : [...s.sans, ...(pending ? [Position.fromFen(fens[tipPly - 1]).san(codes[tipPly - 1])] : [])];

  const resign = () => {
    if (over || me === null) return;
    if (s.moves.length < 2) {
      if (window.confirm(L('Να ακυρωθεί η παρτίδα;', 'Abort the game?'))) conn.send({ t: 'abort' });
      return;
    }
    if (window.confirm(L('Να εγκαταλείψεις την παρτίδα;', 'Resign the game?'))) conn.send({ t: 'resign' });
  };
  const drawOffered = s.drawOffer !== null && s.drawOffer === (me ? opposite(me) : null);
  const iOffered = me !== null && s.drawOffer === me;

  return (
    <div className="tx-main bots-main ol-main">
      <section className="tx-board bots-board" aria-label={L('Σκακιέρα', 'Board')}>
        {bar(top)}
        <div className="bots-boardwrap">
          <div className="bots-boardbox">
            <Board
              fen={fen}
              orientation={orientation}
              movable={canMove && me ? (me === 'w' ? 'white' : 'black') : 'none'}
              lastMove={ply > 0 ? codes[ply - 1] : undefined}
              shapes={drawn.shapes}
              onShape={drawn.onShape}
              premovable={connected && !over && atTip && me && s.guestJoined ? (me === 'w' ? 'white' : 'black') : undefined}
              premove={atTip ? premove : null}
              onPremove={setPremove}
              theme={look.theme}
              pieceSet={look.pieceSet}
              coordinates={look.coordinates ?? true}
              animationMs={look.animationMs ?? 200}
              oneClick={look.oneClick ?? true}
              onMove={onMove}
            />
          </div>
        </div>
        {bar(bottom)}
      </section>

      <aside className="tx-side bots-side">
        {head}

        {!over && (
          <div className={`play-status${conn.status === 'retrying' || conn.status === 'gone' ? ' is-error' : ''}`} role="status" aria-live="polite">
            {connected ? <Wifi className="ic ic-sm ol-conn" aria-hidden /> : <WifiOff className="ic ic-sm ol-conn" aria-hidden />}
            {status}
          </div>
        )}

        {!over && drawOffered && (
          <div className="ol-offer" role="alert">
            <Handshake className="ic" aria-hidden />
            <span>{L(`${nameOf(opposite(me!))} προτείνει ισοπαλία.`, `${nameOf(opposite(me!))} offers a draw.`)}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => conn.send({ t: 'draw' })}>
              {L('Αποδοχή', 'Accept')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => conn.send({ t: 'decline' })}>
              {L('Όχι', 'Decline')}
            </button>
          </div>
        )}

        {over && (
          <div className={`play-over ${overClass}`} role="status">
            <div className="play-over-head">
              <span className="play-over-score tnum">{score}</span>
              <span className="play-over-title">{overTitle}</span>
            </div>
            <div className="muted small">
              {s.reason ? endText(s.reason, loser) : ''}
              {s.moves.length ? ` · ${moveCount(Math.ceil(s.moves.length / 2))}` : ''}
            </div>
            <div className="play-over-actions">
              {me !== null && (
                <button type="button" className={`btn btn-sm ${oppRematch && !myRematch ? 'btn-primary' : 'btn-secondary'}`} disabled={myRematch || !connected} onClick={() => conn.send({ t: 'rematch' })}>
                  <RotateCcw className="ic ic-sm" aria-hidden />
                  {myRematch ? L('Περιμένουμε τον φίλο σου…', 'Waiting for your friend…') : oppRematch ? L('Δέξου το ρεβάνς', 'Accept the rematch') : L('Ρεβάνς', 'Rematch')}
                </button>
              )}
              {endActions?.(roomPgn(s, event))}
            </div>
          </div>
        )}

        <div className="bots-moves" ref={listRef} aria-label={L('Κινήσεις', 'Moves')}>
          {rows.length === 0 && <span className="faint small">{L('Δεν έχουν παιχτεί κινήσεις ακόμη.', 'No moves yet.')}</span>}
          {rows.map((r) => (
            <div key={r.num} className="bots-move-row tnum">
              <span className="bots-move-num">{r.num}.</span>
              <button type="button" className={`bots-move${r.w === ply ? ' on' : ''}`} onClick={() => setView(r.w! === tipPly ? null : r.w!)}>
                {sanText(sans[r.w! - 1] ?? '', look.figurines ?? true)}
              </button>
              {r.b && (
                <button type="button" className={`bots-move${r.b === ply ? ' on' : ''}`} onClick={() => setView(r.b! === tipPly ? null : r.b!)}>
                  {sanText(sans[r.b - 1] ?? '', look.figurines ?? true)}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="bots-nav" role="group" aria-label={L('Πλοήγηση', 'Navigation')}>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Αρχή (Home)', 'Start (Home)')} onClick={() => setView(0)}>
            <ChevronsLeft className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Πίσω (←)', 'Back (←)')} onClick={() => setView(Math.max(0, ply - 1))}>
            <ChevronLeft className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Μπροστά (→)', 'Forward (→)')} onClick={() => setView(ply + 1 >= tipPly ? null : ply + 1)}>
            <ChevronRight className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Τελευταία θέση (End)', 'Last position (End)')} onClick={() => setView(null)}>
            <ChevronsRight className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Αναστροφή σκακιέρας (F)', 'Flip board (F)')} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <FlipVertical2 className="ic" aria-hidden />
          </button>
        </div>

        {!over && me !== null && s.guestJoined && (
          <div className="play-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={!connected || iOffered || drawOffered || s.moves.length < 2} onClick={() => conn.send({ t: 'draw' })} title={L('Πρόταση ισοπαλίας', 'Offer a draw')}>
              <Handshake className="ic ic-sm" aria-hidden />
              {iOffered ? L('Προτάθηκε ισοπαλία', 'Draw offered') : L('Ισοπαλία;', 'Offer draw')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm btn-danger" disabled={!connected} onClick={resign}>
              {s.moves.length < 2 ? <X className="ic ic-sm" aria-hidden /> : <Flag className="ic ic-sm" aria-hidden />}
              {s.moves.length < 2 ? L('Ακύρωση', 'Abort') : L('Εγκατάλειψη', 'Resign')}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
