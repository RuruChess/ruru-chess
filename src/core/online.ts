/**
 * Παρτίδα με φίλο μέσω link: οι κανόνες του δωματίου (κινήσεις, ρολόι, ισοπαλία, εγκατάλειψη, ρεβάνς) και τα
 * μηνύματα ανάμεσα στους παίκτες και τον server. Ο server (relay/, Cloudflare Durable Object) κρατά την
 * κατάσταση και αποφασίζει· οι σκακιέρες (Ruru και η σελίδα του φίλου) απλώς τη δείχνουν.
 * Χωρίς εξαρτήσεις πέρα από το `chess.ts`, ώστε να τρέχει ίδιο και στον server και στους browsers.
 */
import { Position, START_FEN } from './chess.ts';

export type Color = 'w' | 'b';
export type OnlineEnd = 'checkmate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty' | 'resign' | 'agreement' | 'flag' | 'abort';

export interface OnlineClock {
  /** χιλιοστά που απομένουν σε κάθε πλευρά (της πλευράς που παίζει: τη στιγμή `since`) */
  w: number;
  b: number;
  inc: number;
  /** ποια πλευρά μετρά */
  side: Color;
  /** ώρα του server όταν ξεκίνησε να μετρά η `side` */
  since: number;
  /** το ρολόι ξεκινά όταν έχουν παίξει και οι δύο την πρώτη τους κίνηση */
  running: boolean;
}

/** Η κατάσταση που βλέπουν όλοι (χωρίς τα κλειδιά των παικτών). */
export interface RoomState {
  id: string;
  /** αύξων αριθμός της παρτίδας στο δωμάτιο (ρεβάνς = νέα παρτίδα) */
  game: number;
  /** χρονικός έλεγχος σε δευτερόλεπτα (null: χωρίς ρολόι) */
  tc: { base: number; inc: number } | null;
  /** ποιο χρώμα έχει ο οικοδεσπότης σε αυτή την παρτίδα */
  hostColor: Color;
  names: { host: string; guest: string };
  /** μπήκε ήδη ο φίλος (έχει κλειδί); */
  guestJoined: boolean;
  moves: string[];
  sans: string[];
  /** χιλιοστά που έμειναν μετά από κάθε κίνηση σε αυτόν που την έπαιξε (για το [%clk] του PGN) */
  clk: number[];
  fen: string;
  clock: OnlineClock | null;
  result: string | null;
  reason: OnlineEnd | null;
  drawOffer: Color | null;
  rematch: { host: boolean; guest: boolean };
}

/** Μηνύματα από τον παίκτη προς τον server. */
export type ClientMsg =
  | { t: 'move'; uci: string; ply: number }
  | { t: 'resign' }
  | { t: 'draw' }
  | { t: 'decline' }
  | { t: 'abort' }
  | { t: 'flag' }
  | { t: 'rematch' }
  | { t: 'name'; name: string }
  | { t: 'ping' };

/** Μηνύματα από τον server προς τον παίκτη. */
export type ServerMsg =
  | { t: 'welcome'; role: 'host' | 'guest' | 'spectator'; token?: string }
  | { t: 'state'; state: RoomState; online: { host: boolean; guest: boolean }; now: number }
  | { t: 'error'; msg: string }
  | { t: 'pong'; now: number };

export const MAX_NAME = 24;
export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const guestColor = (s: RoomState): Color => opposite(s.hostColor);
export const colorOf = (s: RoomState, role: 'host' | 'guest'): Color => (role === 'host' ? s.hostColor : guestColor(s));
export const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'b' : 'w');

export function cleanName(name: unknown, fallback: string): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME) : '';
  return s || fallback;
}

/** Χρόνος που απομένει σε μια πλευρά τη στιγμή `now` (ώρα του server). */
export function timeLeft(c: OnlineClock, side: Color, now: number): number {
  return c[side] - (c.running && c.side === side ? now - c.since : 0);
}

export interface NewRoom {
  id: string;
  /** λεπτά + δευτερόλεπτα προσαύξησης, ή null */
  tc: { base: number; inc: number } | null;
  hostColor: Color;
  hostName: string;
}

export function newRoom(o: NewRoom, now: number): RoomState {
  return startGame(
    {
      id: o.id,
      game: 0,
      tc: o.tc,
      hostColor: o.hostColor,
      names: { host: cleanName(o.hostName, 'Host'), guest: '' },
      guestJoined: false,
      moves: [],
      sans: [],
      clk: [],
      fen: START_FEN,
      clock: null,
      result: null,
      reason: null,
      drawOffer: null,
      rematch: { host: false, guest: false },
    },
    now,
  );
}

/** Νέα παρτίδα στο ίδιο δωμάτιο (στην αρχή και σε κάθε ρεβάνς). */
function startGame(s: RoomState, now: number): RoomState {
  const ms = s.tc ? s.tc.base * 1000 : 0;
  return {
    ...s,
    game: s.game + 1,
    moves: [],
    sans: [],
    clk: [],
    fen: START_FEN,
    clock: s.tc ? { w: ms, b: ms, inc: s.tc.inc * 1000, side: 'w', since: now, running: false } : null,
    result: null,
    reason: null,
    drawOffer: null,
    rematch: { host: false, guest: false },
  };
}

/** Τέλος της παρτίδας: το ρολόι σταματά με τον χρόνο της στιγμής. */
function end(s: RoomState, result: string, reason: OnlineEnd, now: number): RoomState {
  const c = s.clock;
  const clock = c ? { ...c, [c.side]: Math.max(0, timeLeft(c, c.side, now)), since: now, running: false } : null;
  return { ...s, result, reason, clock, drawOffer: null };
}

const winFor = (c: Color) => (c === 'w' ? '1-0' : '0-1');

/** Μόνο ο βασιλιάς: όποιος δεν μπορεί πια να κάνει ματ δεν κερδίζει ούτε στον χρόνο. */
function bareKing(fen: string, side: Color): boolean {
  const board = fen.split(' ')[0];
  for (const ch of board) {
    if (!/[a-z]/i.test(ch)) continue;
    const isWhite = ch === ch.toUpperCase();
    if ((side === 'w') === isWhite && ch.toLowerCase() !== 'k') return false;
  }
  return true;
}

export type Outcome = { ok: true; state: RoomState } | { ok: false; error: string };
const fail = (error: string): Outcome => ({ ok: false, error });

/** Η πλευρά που μετρά ξέμεινε από χρόνο; Τότε η παρτίδα τελειώνει (ο server το ελέγχει σε κάθε μήνυμα). */
export function checkFlag(s: RoomState, now: number): RoomState {
  const c = s.clock;
  if (s.result || !c || !c.running || timeLeft(c, c.side, now) > 0) return s;
  const other = opposite(c.side);
  return bareKing(s.fen, other) ? end(s, '1/2-1/2', 'flag', now) : end(s, winFor(other), 'flag', now);
}

function repetitions(s: RoomState, fen: string): number {
  const key = (f: string) => f.split(' ').slice(0, 4).join(' ');
  const last = key(fen);
  const p = Position.fromFen(START_FEN);
  let n = key(p.fen()) === last ? 1 : 0;
  for (const uci of s.moves) {
    p.makeMove(p.parseUci(uci));
    if (key(p.fen()) === last) n++;
  }
  return n;
}

export function applyMove(s0: RoomState, by: Color, uci: string, ply: number, now: number): Outcome {
  const s = checkFlag(s0, now);
  if (s.result) return s === s0 ? fail('over') : { ok: true, state: s };
  if (ply !== s.moves.length) return fail('stale');
  if (turnOf(s.fen) !== by) return fail('turn');
  const p = Position.fromFen(s.fen);
  const m = typeof uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci) ? p.parseUci(uci) : 0;
  if (!m) return fail('illegal');
  const san = p.san(m);
  const canon = p.moveToUci(m);
  p.makeMove(m);
  const fen = p.fen();
  const moves = [...s.moves, canon];

  let clock = s.clock;
  let left = 0;
  if (clock) {
    left = clock.running ? timeLeft(clock, by, now) + clock.inc : clock[by];
    // το ρολόι ξεκινά μόλις παίξουν και οι δύο την πρώτη τους κίνηση
    clock = { ...clock, [by]: left, side: opposite(by), since: now, running: moves.length >= 2 };
  }
  let next: RoomState = { ...s, moves, sans: [...s.sans, san], clk: clock ? [...s.clk, left] : s.clk, fen, clock, drawOffer: null };

  const st = p.status();
  if (st === 'checkmate') next = end(next, winFor(by), 'checkmate', now);
  else if (st === 'stalemate') next = end(next, '1/2-1/2', 'stalemate', now);
  else if (st === 'insufficient') next = end(next, '1/2-1/2', 'insufficient', now);
  else if (st === 'fifty') next = end(next, '1/2-1/2', 'fifty', now);
  else if (repetitions(next, fen) >= 3) next = end(next, '1/2-1/2', 'repetition', now);
  return { ok: true, state: next };
}

export function resign(s0: RoomState, by: Color, now: number): Outcome {
  const s = checkFlag(s0, now);
  if (s.result) return fail('over');
  // πριν παίξουν και οι δύο: ακύρωση χωρίς αποτέλεσμα
  if (s.moves.length < 2) return { ok: true, state: end(s, '*', 'abort', now) };
  return { ok: true, state: end(s, winFor(opposite(by)), 'resign', now) };
}

/** Πρόταση ισοπαλίας· αν την είχε ήδη προτείνει ο αντίπαλος, είναι αποδοχή. */
export function offerDraw(s0: RoomState, by: Color, now: number): Outcome {
  const s = checkFlag(s0, now);
  if (s.result) return fail('over');
  if (s.drawOffer === opposite(by)) return { ok: true, state: end(s, '1/2-1/2', 'agreement', now) };
  if (s.moves.length < 2) return fail('early');
  return { ok: true, state: { ...s, drawOffer: by } };
}

export function declineDraw(s: RoomState, by: Color): Outcome {
  if (s.result || s.drawOffer !== opposite(by)) return fail('none');
  return { ok: true, state: { ...s, drawOffer: null } };
}

/** Ρεβάνς: όταν το ζητήσουν και οι δύο, νέα παρτίδα με αλλαγμένα χρώματα. */
export function requestRematch(s: RoomState, role: 'host' | 'guest', now: number): Outcome {
  if (!s.result) return fail('playing');
  const rematch = { ...s.rematch, [role]: true };
  if (rematch.host && rematch.guest) return { ok: true, state: startGame({ ...s, hostColor: opposite(s.hostColor) }, now) };
  return { ok: true, state: { ...s, rematch } };
}

// ---------------------------------------------------------------------------
// PGN της παρτίδας (για ανάλυση στο Ruru ή για κατέβασμα από τη σελίδα του φίλου)

const pgnDate = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

function clkText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function roomPgn(s: RoomState, event: string, date = new Date()): string {
  const white = s.hostColor === 'w' ? s.names.host : s.names.guest || '?';
  const black = s.hostColor === 'b' ? s.names.host : s.names.guest || '?';
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const result = s.result ?? '*';
  const tags: Array<[string, string]> = [
    ['Event', event],
    ['Site', 'Ruru Chess'],
    ['Date', pgnDate(date)],
    ['Round', String(s.game)],
    ['White', white],
    ['Black', black],
    ['Result', result],
  ];
  if (s.tc) tags.push(['TimeControl', `${s.tc.base}+${s.tc.inc}`]);
  if (s.reason === 'flag') tags.push(['Termination', 'time forfeit']);
  const head = tags.map(([k, v]) => `[${k} "${esc(v)}"]`).join('\n');
  const parts: string[] = [];
  s.sans.forEach((san, i) => {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(san);
    if (s.clk[i] !== undefined) parts.push(`{[%clk ${clkText(s.clk[i])}]}`);
  });
  parts.push(result);
  // γραμμές έως ~80 χαρακτήρες
  const lines: string[] = [];
  let line = '';
  for (const p of parts) {
    if (line && line.length + 1 + p.length > 80) {
      lines.push(line);
      line = p;
    } else line = line ? `${line} ${p}` : p;
  }
  if (line) lines.push(line);
  return `${head}\n\n${lines.join('\n')}\n`;
}

/** Τυχαίο αναγνωριστικό (δωμάτιο, κλειδί) από ασφαλή γεννήτρια. */
export function randomId(len: number): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}
