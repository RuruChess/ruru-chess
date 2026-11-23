/**
 * Watch Live: κοινά κομμάτια για τον server και το περιβάλλον.
 * - Το stream μιας παρτίδας του Lichess (ndjson: περιγραφή, θέσεις με «lm», wc/bc) γίνεται PGN με [%clk].
 * - Το stream PGN ενός γύρου broadcast χωρίζεται σε παρτίδες.
 * - Οι κινήσεις που έρχονται μπαίνουν στην κύρια γραμμή μιας παρτίδας χωρίς να χάνονται οι βαριάντες του χρήστη.
 * - Τα ρολόγια βγαίνουν από τα [%clk] της κύριας γραμμής.
 */
import { Position, START_FEN } from './chess.ts';
import type { Game, GameNode } from './game.ts';
import { writeHeaders } from './pgn.ts';

/** Ρολόι PGN («h:mm:ss») από δευτερόλεπτα. */
export function fmtClk(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** «1:02:03», «2:03» ή «0:00:05.3» σε ms (null αν δεν διαβάζεται). */
export function parseClk(s: string | undefined | null): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)\s*$/.exec(s ?? '');
  if (!m) return null;
  return Math.round(((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000);
}

/** Αρχικός χρόνος από το TimeControl («180+2», «5400+30», «40/7200:1800») σε ms. */
function baseOf(tc: string | undefined): number | null {
  const m = /^(?:\d+\/)?(\d+)(?:\+\d+)?/.exec(tc ?? '');
  return m ? Number(m[1]) * 1000 : null;
}

export interface LiveMove {
  san: string;
  /** ρολόι (δευτερόλεπτα) αυτού που έπαιξε, μετά την κίνηση */
  clock?: number;
}

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/** PGN από κεφαλίδες και κινήσεις (με [%clk]). */
export function livePgn(headers: Record<string, string>, startFen: string, moves: LiveMove[], result = '*'): string {
  const h: Record<string, string> = { ...headers, Result: RESULTS.has(result) ? result : '*' };
  if (startFen !== START_FEN) {
    h.SetUp = '1';
    h.FEN = startFen;
  }
  const parts = startFen.split(' ');
  const black = parts[1] === 'b';
  const first = Number(parts[5]) || 1;
  const out: string[] = [];
  moves.forEach((m, i) => {
    const ply = i + (black ? 1 : 0);
    const no = first + Math.floor(ply / 2);
    if (ply % 2 === 0) out.push(`${no}.`);
    else if (i === 0 || moves[i - 1].clock !== undefined) out.push(`${no}...`);
    out.push(m.san);
    if (m.clock !== undefined) out.push(`{ [%clk ${fmtClk(m.clock)}] }`);
  });
  out.push(h.Result);
  return `${writeHeaders(h)}\n\n${out.join(' ')}\n`;
}

/** Η πλευρά που κερδίζει / το αποτέλεσμα από την περιγραφή του Lichess (status.name, winner). */
function resultOf(status: string, winner: unknown): string {
  if (winner === 'white') return '1-0';
  if (winner === 'black') return '0-1';
  if (['draw', 'stalemate', 'outoftime', 'timeout', 'insufficientMaterialClaim'].includes(status)) return '1/2-1/2';
  return '*';
}

const board = (fen: string) => fen.split(' ').slice(0, 2).join(' ');

/**
 * Το stream `GET /api/stream/game/{id}` του Lichess: πρώτα η περιγραφή της παρτίδας, μετά όλες οι θέσεις από
 * την αρχή (με «lm» = τελευταία κίνηση σε UCI και wc/bc = ρολόγια σε δευτερόλεπτα) και στο τέλος ξανά η
 * περιγραφή με το status. Οι παρτίδες σε εξέλιξη έρχονται με καθυστέρηση 3 κινήσεων (κανόνας του Lichess).
 */
export class LichessGameFeed {
  headers: Record<string, string>;
  startFen = START_FEN;
  moves: LiveMove[] = [];
  result = '*';
  ended = false;
  private pos = Position.fromFen(START_FEN);

  constructor(headers: Record<string, string> = {}) {
    this.headers = { ...headers };
    delete this.headers.Result;
    delete this.headers.SetUp;
    delete this.headers.FEN;
    // το export μιας παρτίδας σε εξέλιξη γράφει «Unterminated»
    if (this.headers.Termination === 'Unterminated') delete this.headers.Termination;
  }

  /** Ένα μήνυμα του ndjson: true αν άλλαξε κάτι, 'resync' αν χάθηκε ο συγχρονισμός (π.χ. λείπει κίνηση). */
  push(msg: Record<string, any>): boolean | 'resync' {
    if (msg && typeof msg === 'object' && msg.players) {
      const h = this.headers;
      for (const side of ['white', 'black'] as const) {
        const p = msg.players[side] ?? {};
        const key = side === 'white' ? 'White' : 'Black';
        const name = p.user?.name ?? (p.aiLevel ? `Stockfish ${p.aiLevel}` : undefined);
        if (name && (!h[key] || h[key] === '?')) h[key] = name;
        if (p.rating && !h[`${key}Elo`]) h[`${key}Elo`] = String(p.rating);
        if (p.user?.title && !h[`${key}Title`]) h[`${key}Title`] = p.user.title;
      }
      if (typeof msg.initialFen === 'string' && msg.initialFen !== 'startpos' && !this.moves.length) this.setStart(msg.initialFen);
      const status = String(msg.status?.name ?? msg.status ?? '');
      if (status && status !== 'created' && status !== 'started') {
        this.ended = true;
        this.result = resultOf(status, msg.winner);
      }
      return true;
    }
    if (typeof msg?.fen !== 'string') return false;
    if (!msg.lm) {
      // η αρχική θέση (ή, σε παρτίδα από θέση, η θέση εκκίνησης)
      if (!this.moves.length && board(msg.fen) !== board(this.startFen)) this.setStart(msg.fen);
      return false;
    }
    const m = this.pos.parseUci(String(msg.lm));
    if (!m) return 'resync';
    const mover = this.pos.turn;
    const san = this.pos.san(m);
    this.pos.makeMove(m);
    // η θέση του Lichess δεν έχει πάντα πλήρη FEN: συγκρίνεται η διάταξη και ποιος παίζει
    if (board(this.pos.fen()) !== board(msg.fen)) return 'resync';
    const clock = mover === 0 ? msg.wc : msg.bc;
    this.moves.push({ san, ...(typeof clock === 'number' ? { clock } : {}) });
    return true;
  }

  /** Από την αρχή (π.χ. μετά από «resync»): κινήσεις σε SAN και ρολόγια σε εκατοστά (όπως το export του Lichess). */
  reset(startFen: string, sans: string[], centis: number[] = []): void {
    this.setStart(startFen);
    for (let i = 0; i < sans.length; i++) {
      const m = this.pos.parseSan(sans[i]);
      if (!m) break;
      this.moves.push({ san: this.pos.san(m), ...(centis[i] !== undefined ? { clock: centis[i] / 100 } : {}) });
      this.pos.makeMove(m);
    }
  }

  pgn(): string {
    return livePgn(this.headers, this.startFen, this.moves, this.result);
  }

  private setStart(fen: string): void {
    const full = fen.split(' ').length >= 4 ? fen : `${fen} w - - 0 1`;
    this.startFen = full;
    this.pos = Position.fromFen(full);
    this.moves = [];
  }
}

/**
 * Το stream PGN ενός γύρου broadcast: κάθε φορά που αλλάζει μια παρτίδα έρχεται ολόκληρο το PGN της.
 * Επιστρέφει τις ολόκληρες παρτίδες και ό,τι περισσεύει (μισή παρτίδα που περιμένει τη συνέχειά της).
 */
export function splitPgnStream(buf: string): { games: string[]; rest: string } {
  const starts: number[] = [];
  const re = /(^|\n)\[Event /g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) starts.push(m.index + m[1].length);
  if (!starts.length) return { games: [], rest: buf.length > 1_000_000 ? '' : buf };
  const games: string[] = [];
  for (let i = 0; i < starts.length - 1; i++) games.push(buf.slice(starts[i], starts[i + 1]).trim());
  const last = buf.slice(starts[starts.length - 1]);
  // ολόκληρη: έχει κινήσεις μετά τις κεφαλίδες και τελειώνει με αποτέλεσμα (όχι μέσα σε κεφαλίδα, π.χ. «[Result "*»)
  if (/\n\s*\n[^[]/.test(last) && /(^|\s)(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(last)) return { games: [...games, last.trim()], rest: '' };
  return { games, rest: last };
}

/** Το id της παρτίδας ενός broadcast από το [GameURL ".../{roundId}/{gameId}"]. */
export function broadcastGameId(pgn: string): string | null {
  return /\[GameURL "[^"]*\/([A-Za-z0-9]{8})"\]/.exec(pgn)?.[1] ?? null;
}

/**
 * Βάζει την κύρια γραμμή της `src` στην κύρια γραμμή της `target`: ίδιες κινήσεις μένουν (με τις βαριάντες
 * τους), νέες προστίθενται και γίνονται κύρια γραμμή (μια βαριάντα του χρήστη στο ίδιο σημείο γίνεται δευτερεύουσα).
 * Επιστρέφει αν άλλαξε κάτι και τον τελευταίο κόμβο της live γραμμής.
 */
export function mergeLive(target: Game, src: Game): { changed: boolean; end: GameNode } {
  let changed = false;
  for (const [k, v] of Object.entries(src.headers)) {
    if (target.headers[k] !== v) {
      target.headers[k] = v;
      changed = true;
    }
  }
  let t = target.root;
  let s = src.root;
  while (s.children.length) {
    const sc = s.children[0];
    let i = t.children.findIndex((c) => c.move === sc.move);
    let tc: GameNode;
    if (i < 0) {
      tc = target.addMove(t, sc.move);
      i = t.children.indexOf(tc);
      changed = true;
    } else tc = t.children[i];
    if (i > 0) {
      t.children.splice(i, 1);
      t.children.unshift(tc);
      changed = true;
    }
    if (sc.clock && tc.clock !== sc.clock) {
      tc.clock = sc.clock;
      changed = true;
    }
    t = tc;
    s = sc;
  }
  return { changed, end: t };
}

/**
 * Οι κόμβοι από τον `from` (χωρίς αυτόν) ως τον `to`, με τη σειρά· κενός πίνακας όταν είναι ο ίδιος κόμβος,
 * null όταν ο `from` δεν είναι πρόγονος του `to` (άλλη βαριάντα, ή ο `to` είναι πιο πίσω).
 */
export function pathBetween(from: GameNode, to: GameNode): GameNode[] | null {
  const path: GameNode[] = [];
  for (let n: GameNode | null = to; n; n = n.parent) {
    if (n === from) return path.reverse();
    path.push(n);
  }
  return null;
}

export interface LiveClocks {
  w: number | null;
  b: number | null;
  turn: 'w' | 'b';
}

/** Τα ρολόγια στο τέλος της live γραμμής: το τελευταίο [%clk] κάθε πλευράς, αλλιώς WhiteClock/BlackClock ή ο αρχικός χρόνος. */
export function liveClocks(end: GameNode, headers: Record<string, string>): LiveClocks {
  let w: number | null = null;
  let b: number | null = null;
  for (let n: GameNode | null = end; n?.parent && (w === null || b === null); n = n.parent) {
    // η κίνηση του κόμβου την έπαιξε η πλευρά που ΔΕΝ παίζει στη θέση του
    const mover = n.fen.split(' ')[1] === 'b' ? 'w' : 'b';
    const ms = parseClk(n.clock);
    if (ms === null) continue;
    if (mover === 'w' && w === null) w = ms;
    if (mover === 'b' && b === null) b = ms;
  }
  const base = baseOf(headers.TimeControl);
  w ??= parseClk(headers.WhiteClock) ?? base;
  b ??= parseClk(headers.BlackClock) ?? base;
  return { w, b, turn: end.fen.split(' ')[1] === 'b' ? 'b' : 'w' };
}
