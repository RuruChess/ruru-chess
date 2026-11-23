/** Καθαρή λογική του εκπαιδευτή τακτικής: θέσεις της γραμμής, κινήσεις από το πληκτρολόγιο, αρίθμηση, σερί ημερών, μπόνους του Storm. */
import { Position } from '../../core/chess.ts';
import { legalUci, positionAt, standardUci } from '../../core/puzzle.ts';
import type { Color, CompactPuzzle } from './api.ts';

/** Ό,τι χρειάζεται ο λύτης από ένα puzzle (πλήρες ή μικρό). */
export interface LinePuzzle {
  id: string;
  fen: string;
  moves: string[];
  pre: boolean;
  color: Color;
  rating: number;
}

export const sideToMove = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

/** Μικρό puzzle των γρήγορων τρόπων → puzzle του λύτη (`pre`: παίζει πρώτα ο αντίπαλος). */
export function fromCompact(c: CompactPuzzle): LinePuzzle {
  return { id: c.id, fen: c.fen, moves: c.moves, pre: sideToMove(c.fen) !== c.color, color: c.color, rating: c.rating };
}

/** Η πρώτη ημικίνηση του λύτη στη γραμμή. */
export const firstSolverPly = (p: Pick<LinePuzzle, 'pre'>): number => (p.pre ? 1 : 0);

/** FEN μετά από `ply` κινήσεις της γραμμής. */
export function fenAt(p: Pick<LinePuzzle, 'fen' | 'moves'>, ply: number): string {
  return positionAt(p.fen, p.moves, ply).fen();
}

/** Κωδικός της κίνησης `uci` στη θέση `fen` (0 αν δεν είναι νόμιμη)· δέχεται και ροκέ ως «βασιλιάς παίρνει πύργο». */
export function moveCode(fen: string, uci: string): number {
  try {
    return legalUci(Position.fromFen(fen), uci);
  } catch {
    return 0;
  }
}

/** Η θέση μετά από μια κίνηση (null αν η κίνηση δεν είναι νόμιμη). */
export function playUci(fen: string, uci: string): { fen: string; move: number; san: string } | null {
  const pos = Position.fromFen(fen);
  const m = legalUci(pos, uci);
  if (!m) return null;
  const san = pos.san(m);
  pos.makeMove(m);
  return { fen: pos.fen(), move: m, san };
}

/** Κίνηση της σκακιέρας (από, προς, προαγωγή) σε κλασικό UCI. */
export function boardUci(fen: string, from: number, to: number, promo: number): string | null {
  const pos = Position.fromFen(fen);
  const m = pos.findMove(from, to, promo);
  return m ? standardUci(m) : null;
}

/** Ελληνικά γράμματα κομματιών (Ρ βασιλιάς, Β βασίλισσα, Π πύργος, Α αξιωματικός, Ι ίππος) → αγγλικά του SAN. */
const GREEK_PIECES: Record<string, string> = { Ρ: 'K', Β: 'Q', Π: 'R', Α: 'B', Ι: 'N' };

/**
 * Κίνηση που γράφτηκε με το πληκτρολόγιο: SAN (Nf3, exd5, O-O, 0-0, με ελληνικά γράμματα κομματιών)
 * ή UCI (g1f3, e7e8q). Επιστρέφει κλασικό UCI ή null αν δεν είναι νόμιμη / είναι αμφίσημη.
 */
export function parseTypedMove(fen: string, text: string): string | null {
  let t = text.trim().replace(/[!?+#]+$/, '');
  if (!t) return null;
  t = t.replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O').replace(/^o-o-o$/i, 'O-O-O').replace(/^o-o$/i, 'O-O');
  if (GREEK_PIECES[t[0]]) t = GREEK_PIECES[t[0]] + t.slice(1);
  let pos: Position;
  try {
    pos = Position.fromFen(fen);
  } catch {
    return null;
  }
  if (/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(t)) {
    const m = legalUci(pos, t.toLowerCase());
    if (m) return standardUci(m);
  }
  // προαγωγή χωρίς «=» (e8Q) και πεζό γράμμα κομματιού στην αρχή (nf3) γίνονται δεκτά
  const variants = [t, t.replace(/([a-h][18])([QRBN])$/i, (_, s: string, p: string) => `${s}=${p.toUpperCase()}`)];
  // (πρώτα ως πιόνι: «bxc3» είναι πιόνι όταν μπορεί να πάρει το πιόνι b, αλλιώς αξιωματικός)
  if (/^[nbrqk][a-h1-8x]/.test(t)) variants.push(t[0].toUpperCase() + t.slice(1));
  for (const v of variants) {
    const m = pos.parseSan(v);
    if (m) return standardUci(m);
  }
  return null;
}

export interface MoveLabel {
  /** «9.» για τα λευκά, «9…» για την πρώτη κίνηση των μαύρων, κενό για τις υπόλοιπες των μαύρων */
  num: string;
  san: string;
}

/** Αρίθμηση κινήσεων SAN από μια θέση (FEN). */
export function moveLabels(fen: string, sans: readonly string[]): MoveLabel[] {
  const parts = fen.split(' ');
  let white = parts[1] !== 'b';
  let num = Number(parts[5]) || 1;
  return sans.map((san, i) => {
    const label: MoveLabel = { num: white ? `${num}.` : i === 0 ? `${num}…` : '', san };
    if (!white) num++;
    white = !white;
    return label;
  });
}

/** «8…O-O» ή «9.Bxh7+»: μία κίνηση με τον αριθμό της. */
export function moveText(fen: string, san: string): string {
  const [l] = moveLabels(fen, [san]);
  return `${l.num}${l.san}`;
}

/** ΕΕΕΕ-ΜΜ-ΗΗ (τοπική ώρα), όπως το `localDay` του server. */
export function localDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Συνεχόμενες μέρες με puzzles ως σήμερα. Αν σήμερα δεν έχει λυθεί ακόμη κανένα, το σερί μετρά ως
 * χθες (δεν «χάνεται» πριν τελειώσει η μέρα).
 */
export function dayStreak(days: Iterable<string>, now: number): number {
  const set = new Set(days);
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  if (!set.has(localDay(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(localDay(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/**
 * Δευτερόλεπτα που κερδίζει ο χρήστης στο Storm όταν το σερί σωστών φτάνει το `combo` (Lichess:
 * 5 → 3″, 12 → 5″, 20 → 7″, 30 → 10″ και μετά κάθε 10 σωστά άλλα 10″).
 */
export function stormBonus(combo: number, levels: ReadonlyArray<readonly [number, number]>): number {
  if (!levels.length || combo <= 0) return 0;
  for (const [at, s] of levels) if (combo === at) return s;
  const [lastAt, lastS] = levels[levels.length - 1];
  return combo > lastAt && (combo - lastAt) % 10 === 0 ? lastS : 0;
}

/** Πρόοδος του σερί σωστών ως το επόμενο μπόνους (0…1) και πόσα δευτερόλεπτα δίνει. */
export function comboProgress(combo: number, levels: ReadonlyArray<readonly [number, number]>): { value: number; next: number; bonus: number } {
  if (!levels.length) return { value: 0, next: 0, bonus: 0 };
  let prev = 0;
  for (const [at, s] of levels) {
    if (combo < at) return { value: (combo - prev) / (at - prev), next: at, bonus: s };
    prev = at;
  }
  const [lastAt, lastS] = levels[levels.length - 1];
  const step = (combo - lastAt) % 10;
  return { value: step / 10, next: combo - step + 10, bonus: lastS };
}

/** «2:05» / «0:09». */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Χρόνος λύσης για εμφάνιση: «12 δευτ.» / «1:05». */
export function duration(ms: number, el: boolean): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return el ? `${s} δευτ.` : `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
