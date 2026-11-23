/** Γραμμές του CSV του Lichess → πακεταρισμένα puzzles: φίλτρο ποιότητας, επικύρωση με τον πυρήνα (κοινό για worker και κύριο νήμα). */
import { Position } from '../../core/chess.ts';
import { validateLine } from '../../core/puzzle.ts';
import { type ColumnMap, type QualityFilter, parseGameUrl, parseLichessLine, passesQuality } from './csv.ts';
import { decodeLichessId, packLine, packPosition } from './pack.ts';
import { F_MATE, F_PRE, F_WHITE } from './store.ts';

const BITS_PER_MASK = 52;

/** Κολόνες ενός πακέτου puzzles (μεταφέρονται από τον worker χωρίς αντιγραφή). */
export interface FrameBatch {
  n: number;
  ids: Int32Array;
  rating: Int16Array;
  rd: Int16Array;
  pop: Int16Array;
  plays: Int32Array;
  th1: Float64Array;
  th2: Float64Array;
  flags: Uint16Array;
  ply: Int16Array;
  pos: Uint8Array;
  posOff: Int32Array;
  line: Uint8Array;
  lineOff: Int32Array;
  daily: Float64Array;
  /** id παρτίδας (ASCII) ανά γραμμή: bytes και αρχές (όχι πίνακες από strings: λιγότερη δουλειά για τον GC του server) */
  game: Uint8Array;
  gameOff: Int32Array;
  /** ετικέτες ανοίγματος: δείκτης στο λεξικό του πακέτου (−1: καμία) */
  openingIdx: Int32Array;
  openingDict: string[];
}

export interface FrameStats {
  lines: number;
  /** πέρασαν το φίλτρο ποιότητας και την επικύρωση */
  accepted: number;
  /** εκτός φίλτρου ποιότητας */
  filtered: number;
  /** απορρίψεις ανά λόγο */
  rejected: Record<string, number>;
  /** παραδείγματα απορρίψεων (έως 5 ανά λόγο) */
  samples: Array<{ id: string; reason: string; detail?: string }>;
  unknownThemes: Record<string, number>;
  /** ετικέτα mateInN που δεν ταιριάζει με το μήκος της λύσης (κρατιούνται) */
  mateLengthMismatch: number;
  /** URL παρτίδας με προσανατολισμό που δεν ταιριάζει με το FEN (κρατιέται όλο) */
  urlOrientation: number;
}

export const emptyStats = (): FrameStats => ({ lines: 0, accepted: 0, filtered: 0, rejected: {}, samples: [], unknownThemes: {}, mateLengthMismatch: 0, urlOrientation: 0 });

/** Κατάσταση εισαγωγής σε εξέλιξη (στο meta της βάσης· επιτρέπει συνέχιση μετά από διακοπή). */
export interface ImportState {
  version: string;
  quality: string;
  filter: QualityFilter;
  archiveSize: number;
  /** θέση του επόμενου frame στο αρχείο */
  nextOffset: number;
  /** πόσα frames έχουν μπει */
  frames: number;
  /** κείμενο μετά την τελευταία αλλαγή γραμμής του προηγούμενου frame */
  carry: string;
  /** η βάση δεν είχε puzzles του Lichess πριν (καμία σήμανση «stale») */
  fresh: boolean;
  stats: FrameStats;
  started: number;
  /** χρόνος εργασίας μέχρι τώρα (χωρίς τις διακοπές) */
  workMs: number;
}

/** Κλειδί της κατάστασης εισαγωγής στο meta της puzzles.sqlite. */
export const IMPORT_STATE_KEY = 'lichess.import';

/** Αποτέλεσμα ενός frame από τον worker ανάγνωσης. */
export interface FrameResult {
  index: number;
  /** κείμενο πριν από την πρώτη αλλαγή γραμμής (τέλος της γραμμής του προηγούμενου frame) */
  head?: string;
  /** κείμενο μετά την τελευταία αλλαγή γραμμής (αρχή γραμμής που συνεχίζει στο επόμενο frame) */
  tail?: string;
  /** false: το frame δεν έχει καμία αλλαγή γραμμής (όλο είναι μέσα σε μία γραμμή) */
  newline?: boolean;
  batch?: FrameBatch;
  stats?: FrameStats;
  bytes?: number;
  msDecompress?: number;
  msProcess?: number;
  error?: string;
}

export function sumRejected(s: FrameStats): number {
  let n = 0;
  for (const v of Object.values(s.rejected)) n += v;
  return n;
}

export function mergeStats(a: FrameStats, b: FrameStats): void {
  a.lines += b.lines;
  a.accepted += b.accepted;
  a.filtered += b.filtered;
  a.mateLengthMismatch += b.mateLengthMismatch;
  a.urlOrientation += b.urlOrientation;
  for (const [k, v] of Object.entries(b.rejected)) a.rejected[k] = (a.rejected[k] ?? 0) + v;
  for (const [k, v] of Object.entries(b.unknownThemes)) a.unknownThemes[k] = (a.unknownThemes[k] ?? 0) + v;
  for (const s of b.samples) if (a.samples.filter((x) => x.reason === s.reason).length < 5) a.samples.push(s);
}

/** Συσσωρευτής πακέτου με αυξανόμενους πίνακες. */
export class BatchBuilder {
  private cap: number;
  n = 0;
  ids: Int32Array;
  rating: Int16Array;
  rd: Int16Array;
  pop: Int16Array;
  plays: Int32Array;
  th1: Float64Array;
  th2: Float64Array;
  flags: Uint16Array;
  ply: Int16Array;
  daily: Float64Array;
  posOff: Int32Array;
  lineOff: Int32Array;
  pos: Uint8Array;
  line: Uint8Array;
  posLen = 0;
  lineLen = 0;
  gameLen = 0;
  game: Uint8Array;
  gameOff: Int32Array;
  openingIdx: Int32Array;
  private openingDict: string[] = [];
  private openingMap = new Map<string, number>();

  constructor(cap = 4096) {
    this.cap = cap;
    this.ids = new Int32Array(cap);
    this.rating = new Int16Array(cap);
    this.rd = new Int16Array(cap);
    this.pop = new Int16Array(cap);
    this.plays = new Int32Array(cap);
    this.th1 = new Float64Array(cap);
    this.th2 = new Float64Array(cap);
    this.flags = new Uint16Array(cap);
    this.ply = new Int16Array(cap);
    this.daily = new Float64Array(cap);
    this.posOff = new Int32Array(cap + 1);
    this.lineOff = new Int32Array(cap + 1);
    this.pos = new Uint8Array(cap * 24);
    this.line = new Uint8Array(cap * 12);
    this.game = new Uint8Array(cap * 8);
    this.gameOff = new Int32Array(cap + 1);
    this.openingIdx = new Int32Array(cap);
  }

  private grow(): void {
    const cap = this.cap * 2;
    const g = <T extends Int32Array | Int16Array | Uint16Array | Float64Array>(a: T, n: number): T => {
      const b = new (a.constructor as new (n: number) => T)(n);
      b.set(a);
      return b;
    };
    this.ids = g(this.ids, cap);
    this.rating = g(this.rating, cap);
    this.rd = g(this.rd, cap);
    this.pop = g(this.pop, cap);
    this.plays = g(this.plays, cap);
    this.th1 = g(this.th1, cap);
    this.th2 = g(this.th2, cap);
    this.flags = g(this.flags, cap);
    this.ply = g(this.ply, cap);
    this.daily = g(this.daily, cap);
    this.posOff = g(this.posOff, cap + 1);
    this.lineOff = g(this.lineOff, cap + 1);
    this.gameOff = g(this.gameOff, cap + 1);
    this.openingIdx = g(this.openingIdx, cap);
    this.cap = cap;
  }

  private bytes(which: 'pos' | 'line' | 'game', data: Uint8Array): void {
    let buf = this[which];
    const len = which === 'pos' ? this.posLen : which === 'line' ? this.lineLen : this.gameLen;
    if (len + data.length > buf.length) {
      const b = new Uint8Array(Math.max(buf.length * 2, len + data.length));
      b.set(buf.subarray(0, len));
      buf = b;
      this[which] = b;
    }
    buf.set(data, len);
    if (which === 'pos') this.posLen += data.length;
    else if (which === 'line') this.lineLen += data.length;
    else this.gameLen += data.length;
  }

  push(r: { id: number; rating: number; rd: number; pop: number; plays: number; th1: number; th2: number; flags: number; ply: number; daily: number; game: string; opening: string; pos: Uint8Array; line: Uint8Array }): void {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    this.ids[i] = r.id;
    this.rating[i] = r.rating;
    this.rd[i] = r.rd;
    this.pop[i] = r.pop;
    this.plays[i] = r.plays;
    this.th1[i] = r.th1;
    this.th2[i] = r.th2;
    this.flags[i] = r.flags;
    this.ply[i] = r.ply;
    this.daily[i] = r.daily;
    this.posOff[i] = this.posLen;
    this.lineOff[i] = this.lineLen;
    this.bytes('pos', r.pos);
    this.bytes('line', r.line);
    this.posOff[i + 1] = this.posLen;
    this.lineOff[i + 1] = this.lineLen;
    this.gameOff[i] = this.gameLen;
    if (r.game) this.bytes('game', ascii(r.game));
    this.gameOff[i + 1] = this.gameLen;
    let k = -1;
    if (r.opening) {
      k = this.openingMap.get(r.opening) ?? -1;
      if (k < 0) {
        k = this.openingDict.push(r.opening) - 1;
        this.openingMap.set(r.opening, k);
      }
    }
    this.openingIdx[i] = k;
  }

  finish(): FrameBatch {
    const n = this.n;
    return {
      n,
      ids: this.ids.slice(0, n),
      rating: this.rating.slice(0, n),
      rd: this.rd.slice(0, n),
      pop: this.pop.slice(0, n),
      plays: this.plays.slice(0, n),
      th1: this.th1.slice(0, n),
      th2: this.th2.slice(0, n),
      flags: this.flags.slice(0, n),
      ply: this.ply.slice(0, n),
      daily: this.daily.slice(0, n),
      posOff: this.posOff.slice(0, n + 1),
      lineOff: this.lineOff.slice(0, n + 1),
      pos: this.pos.slice(0, this.posLen),
      line: this.line.slice(0, this.lineLen),
      game: this.game.slice(0, this.gameLen),
      gameOff: this.gameOff.slice(0, n + 1),
      openingIdx: this.openingIdx.slice(0, n),
      openingDict: this.openingDict,
    };
  }
}

/** Αντικείμενα που μεταφέρονται χωρίς αντιγραφή (postMessage). */
export function batchTransfer(b: FrameBatch): ArrayBuffer[] {
  return [b.ids, b.rating, b.rd, b.pop, b.plays, b.th1, b.th2, b.flags, b.ply, b.daily, b.posOff, b.lineOff, b.pos, b.line, b.game, b.gameOff, b.openingIdx].map((a) => a.buffer as ArrayBuffer);
}

/** Κείμενο ASCII σε bytes (id παρτίδας του Lichess). */
function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}

/** Το id παρτίδας της γραμμής i ενός πακέτου (null αν λείπει). */
export function batchGame(b: FrameBatch, i: number): string | null {
  const s = b.gameOff[i];
  const e = b.gameOff[i + 1];
  return e > s ? String.fromCharCode(...b.game.subarray(s, e)) : null;
}

function reject(stats: FrameStats, id: string, reason: string, detail?: string): void {
  stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  if (stats.samples.filter((s) => s.reason === reason).length < 5) stats.samples.push({ id, reason, detail });
}

/** Επεξεργάζεται μία γραμμή: φίλτρο, επικύρωση (πρώτα η κίνηση του αντιπάλου, μετά η λύση· ματ όπου δηλώνεται), πακετάρισμα. */
export function processLine(raw: string, cols: ColumnMap, quality: QualityFilter, bits: Record<string, number>, pos: Position, out: BatchBuilder, stats: FrameStats): void {
  const { row, why } = parseLichessLine(raw, cols);
  if (!row) {
    if (why === 'empty' || why === 'header') return;
    stats.lines++;
    reject(stats, raw.slice(0, 5), 'format', why);
    return;
  }
  stats.lines++;
  if (!passesQuality(row, quality)) {
    stats.filtered++;
    return;
  }
  const id = decodeLichessId(row.id);
  if (id < 0) return reject(stats, row.id, 'id');
  if (row.moves.length < 2 || row.moves.length % 2 !== 0) return reject(stats, row.id, 'length', String(row.moves.length));
  let th1 = 0;
  let th2 = 0;
  let mate = false;
  let mateIn = 0;
  for (const t of row.themes) {
    const b = bits[t];
    if (b === undefined) {
      stats.unknownThemes[t] = (stats.unknownThemes[t] ?? 0) + 1;
      continue;
    }
    if (t === 'mate') mate = true;
    else if (t.startsWith('mateIn')) mateIn = Number(t.slice(6));
    if (b < BITS_PER_MASK) {
      const v = 2 ** b;
      if (Math.floor(th1 / v) % 2 === 0) th1 += v;
    } else {
      const v = 2 ** (b - BITS_PER_MASK);
      if (Math.floor(th2 / v) % 2 === 0) th2 += v;
    }
  }
  const hold: { packed: Uint8Array | null } = { packed: null };
  const v = validateLine(row.fen, row.moves, { pre: true, requireMate: mate || mateIn > 0, pos, onStart: (p) => (hold.packed = packPosition(p)) });
  const packed = hold.packed;
  if (!v.ok || !packed) return reject(stats, row.id, v.error ?? 'fen', v.detail);
  if (mateIn) {
    const solver = row.moves.length / 2;
    if (Math.min(5, solver) !== mateIn) stats.mateLengthMismatch++;
  }
  // το URL δείχνει τη θέση με τον προσανατολισμό του παίκτη που μόλις έπαιξε (= μαύρα όταν παίζει ο λύτης με τα λευκά)
  const g = parseGameUrl(row.gameUrl);
  let game = '';
  let ply = 0;
  if (g) {
    ply = g.ply;
    game = g.black === v.solverWhite ? g.game : row.gameUrl.replace(/^https?:\/\/lichess\.org\//, '').replace(/#.*$/, '');
    if (g.black !== v.solverWhite) stats.urlOrientation++;
  }
  stats.accepted++;
  out.push({
    id,
    rating: row.rating,
    rd: row.rd,
    pop: row.popularity,
    plays: row.plays,
    th1,
    th2,
    flags: F_PRE | (v.solverWhite ? F_WHITE : 0) | (v.mate ? F_MATE : 0),
    ply,
    daily: row.dailyDate,
    game,
    opening: row.openingTags,
    pos: packed,
    line: packLine(v.moves),
  });
}

/**
 * Επεξεργασία ολόκληρου frame (κείμενο): επιστρέφει το κομμάτι πριν από την πρώτη αλλαγή γραμμής
 * και μετά την τελευταία (ενώνονται με τα γειτονικά frames στον worker εγγραφής). Frame χωρίς
 * καμία αλλαγή γραμμής (`newline: false`) είναι ολόκληρο μέση μιας γραμμής.
 */
export function processText(text: string, cols: ColumnMap, quality: QualityFilter, bits: Record<string, number>): { head: string; tail: string; newline: boolean; batch: FrameBatch; stats: FrameStats } {
  const stats = emptyStats();
  const out = new BatchBuilder(1 << 16);
  const pos = new Position();
  const first = text.indexOf('\n');
  const last = text.lastIndexOf('\n');
  if (first < 0) return { head: text, tail: '', newline: false, batch: out.finish(), stats };
  let start = first + 1;
  while (start <= last) {
    const nl = text.indexOf('\n', start);
    processLine(text.slice(start, nl), cols, quality, bits, pos, out, stats);
    start = nl + 1;
  }
  return { head: text.slice(0, first), tail: text.slice(last + 1), newline: true, batch: out.finish(), stats };
}

/**
 * Ένωση ενός frame με το υπόλοιπο του προηγουμένου: η γραμμή που μοιράζονται (`carry + head`)
 * επεξεργάζεται εδώ· επιστρέφει το νέο υπόλοιπο. Χωρίς αλλαγή γραμμής όλο το frame μπαίνει στο υπόλοιπο.
 * `first`: το πρώτο frame (το `head` του είναι η κεφαλίδα του CSV).
 */
export function joinFrame(carry: string, r: Pick<FrameResult, 'head' | 'tail' | 'newline'>, first: boolean, cols: ColumnMap, quality: QualityFilter, bits: Record<string, number>, pos: Position, out: BatchBuilder, stats: FrameStats): string {
  if (r.newline === false) return carry + (r.head ?? '');
  if (!first) processLine(carry + (r.head ?? ''), cols, quality, bits, pos, out, stats);
  return r.tail ?? '';
}
