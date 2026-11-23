/** Μορφή των puzzles στις απαντήσεις του API (FEN, κινήσεις UCI, θέματα σε ελληνικά/αγγλικά, άνοιγμα, πηγή). */
import { lineSan, solverMoveCount } from '../../core/puzzle.ts';
import type { Tactics } from './context.ts';
import { puzzleKey, unpackFen, unpackLine } from './pack.ts';
import { SOURCE_BY_ID } from './sources.ts';
import { F_INACTIVE, F_MATE, F_PRACTICE, F_PRE, F_TEST, F_UNRATED, F_WHITE, type PuzzleRow } from './store.ts';
import { keysOf, themeNames, type ThemeName } from './themes.ts';

export interface PuzzleJson {
  /** «00008» (Lichess) ή αριθμός ως κείμενο (άλλες πηγές) */
  id: string;
  source: string;
  sourceName: { el: string; en: string };
  /** θέση πριν από την πρώτη κίνηση της γραμμής */
  fen: string;
  /** όλη η γραμμή σε UCI (ροκέ e1g1)· με `pre` η πρώτη είναι του αντιπάλου */
  moves: string[];
  pre: boolean;
  /** χρώμα του λύτη */
  color: 'white' | 'black';
  solverMoves: number;
  rating: number;
  rd: number | null;
  popularity: number | null;
  plays: number | null;
  /** ο βαθμός είναι κατά προσέγγιση (όχι Lichess) */
  approximate: boolean;
  themes: ThemeName[];
  opening: { id: number; family: string; variation: string | null; tags: string } | null;
  gameUrl: string | null;
  ply: number | null;
  mate: boolean;
  inactive: boolean;
  kind: 'solve' | 'test' | 'practice';
  goal: unknown;
  meta: unknown;
  /** λύση σε SAN (μόνο όταν ζητηθεί πλήρης μορφή) */
  san?: string[];
}

/** Κρυφή μνήμη ανοιγμάτων (id → οικογένεια/ετικέτες). */
const openingCache = new WeakMap<Tactics, Map<number, { family: string; tags: string }>>();

function opening(t: Tactics, id: number | null): PuzzleJson['opening'] {
  if (id === null) return null;
  let m = openingCache.get(t);
  if (!m) {
    m = new Map();
    openingCache.set(t, m);
    t.onPuzzlesChanged(() => m!.clear());
  }
  let o = m.get(id);
  if (!o) {
    o = t.puzzles.prep('SELECT family, tags FROM opening WHERE id = ?').get(id) as { family: string; tags: string } | undefined;
    if (!o) return null;
    m.set(id, o);
  }
  const parts = o.tags.split(' ');
  return { id, family: o.family, variation: parts[1] ? parts[1].replace(/_/g, ' ') : null, tags: o.tags };
}

export function gameUrl(row: Pick<PuzzleRow, 'game' | 'ply' | 'flags'>): string | null {
  if (!row.game) return null;
  const path = row.game.includes('/') ? row.game : `${row.game}${row.flags & F_WHITE ? '/black' : ''}`;
  return `https://lichess.org/${path}${row.ply ? `#${row.ply}` : ''}`;
}

const parseJson = (s: string | null): unknown => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export function puzzleJson(t: Tactics, row: PuzzleRow, opts: { san?: boolean } = {}): PuzzleJson {
  const src = SOURCE_BY_ID.get(row.source_id);
  const fen = unpackFen(row.pos);
  const moves = unpackLine(row.line);
  const pre = (row.flags & F_PRE) !== 0;
  const out: PuzzleJson = {
    id: puzzleKey(row.id),
    source: src?.key ?? String(row.source_id),
    sourceName: src?.name ?? { el: String(row.source_id), en: String(row.source_id) },
    fen,
    moves,
    pre,
    color: row.flags & F_WHITE ? 'white' : 'black',
    solverMoves: solverMoveCount(moves.length, pre),
    rating: row.rating,
    rd: row.rd,
    popularity: row.pop,
    plays: row.plays,
    approximate: (row.flags & F_UNRATED) !== 0,
    themes: themeNames(keysOf(row.th1, row.th2)),
    opening: opening(t, row.opening_id),
    gameUrl: gameUrl(row),
    ply: row.ply,
    mate: (row.flags & F_MATE) !== 0,
    inactive: (row.flags & F_INACTIVE) !== 0,
    kind: row.flags & F_TEST ? 'test' : row.flags & F_PRACTICE ? 'practice' : 'solve',
    goal: parseJson(row.goal),
    meta: parseJson(row.meta),
  };
  if (opts.san) out.san = lineSan(fen, moves);
  return out;
}

/** Μικρή μορφή για σετ γρήγορων τρόπων (Storm/Streak/Rush): ό,τι χρειάζεται για να παιχτεί. */
export function compactJson(row: PuzzleRow): { id: string; fen: string; moves: string[]; rating: number; color: 'white' | 'black'; themes: string[] } {
  return { id: puzzleKey(row.id), fen: unpackFen(row.pos), moves: unpackLine(row.line), rating: row.rating, color: row.flags & F_WHITE ? 'white' : 'black', themes: keysOf(row.th1, row.th2) };
}
