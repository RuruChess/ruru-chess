// SPDX-License-Identifier: AGPL-3.0-or-later AND GPL-3.0-or-later
// Copyright (c) 2012-2026 the lila authors (AGPL-3.0-or-later), https://github.com/lichess-org/lila
//   from lila: PuzzlePath, puzzle selection and Storm / Streak sets
// Adapted through RealChessBase by Lazaros Batsis (GPL-3.0-or-later).
// Translated to TypeScript and modified for Ruru Chess: 2026-10-27.
// License texts: LICENSE, licenses/AGPL-3.0.txt, licenses/NOTICES.txt
/** Επιλογή puzzles: παράθυρο βαθμού που ανοίγει (Lichess PuzzlePath), μάσκα θεμάτων, χρώμα, άνοιγμα, πηγή, σετ Storm/Streak/Rush. */
import { OTHER_SOURCE } from './catalog.ts';
import type { Tactics } from './context.ts';
import { SOURCES } from './sources.ts';
import { F_INACTIVE, F_PRACTICE, F_TEST, F_UNRATED, F_WHITE, LICHESS_SOURCE_ID, type PuzzleRow } from './store.ts';
import { BY_KEY, maskOf } from './themes.ts';

/**
 * Οι πηγές εκτός Lichess (εξάσκηση και τεστ υπάρχουν μόνο εκεί): «source_id IN (…)» για να
 * χρησιμοποιηθεί το μερικό ευρετήριο ix_puzzle_source αντί για σάρωση όλων των βαθμών (~0,5 s).
 */
const OTHER_SOURCES_IN = `source_id IN (${SOURCES.filter((s) => s.id !== LICHESS_SOURCE_ID).map((s) => s.id).join(',')}) AND source_id <> 1`;

export interface SelectParams {
  /** βαθμός-στόχος (βαθμός χρήστη + δυσκολία) */
  target: number;
  themes?: string[];
  /** any: οποιοδήποτε από τα θέματα· all: όλα */
  match?: 'any' | 'all';
  /** οικογένεια ανοίγματος («Sicilian Defense»), ετικέτες ή id */
  opening?: string;
  color?: 'white' | 'black';
  /** κλειδί πηγής· προεπιλογή: Lichess */
  sourceId?: number;
  /** τι puzzles: λύσης (προεπιλογή), εξάσκησης, τεστ ή όλα */
  kind?: 'solve' | 'practice' | 'test' | 'any';
  /** ρητά όρια βαθμού (αντί για το παράθυρο) */
  min?: number;
  max?: number;
  /** puzzles που δεν πρέπει να δοθούν */
  exclude?: (id: number) => boolean;
}

/** Όρια διαδρομών του Lichess (PuzzlePath): οι κάδοι του Storm/Streak είναι τα διαστήματα ανάμεσα. */
export const PATH_BOUNDS = [800, 900, 1000, 1100, 1200, 1270, 1340, 1410, 1480, 1550, 1620, 1690, 1760, 1830, 1900, 2000, 2100, 2200, 2350, 2500, 2650, 2800];

/** Κάδοι του Puzzle Storm (StormSelector.scala): 137 puzzles, RD ≤ 85, ένα χρώμα. */
export const STORM_BUCKETS: Array<[number, number]> = [
  [1050, 7],
  [1150, 7],
  [1300, 8],
  [1450, 9],
  [1600, 10],
  [1750, 11],
  [1900, 13],
  [2050, 15],
  [2199, 17],
  [2349, 19],
  [2499, 21],
];

/** Κάδοι του Puzzle Streak (PuzzleStreak.scala): 149 puzzles, RD ≤ 85 (≤ 110 πάνω από 2300). */
export const STREAK_BUCKETS: Array<[number, number]> = [
  [1050, 3],
  [1150, 4],
  [1300, 5],
  [1450, 6],
  [1600, 7],
  [1750, 8],
  [1900, 10],
  [2050, 13],
  [2199, 15],
  [2349, 17],
  [2499, 19],
  [2649, 21],
  [2799, 21],
];

/** Κάδοι του Rush (σαν το Puzzle Rush του chess.com: ξεκινά πολύ εύκολα και ανεβαίνει), ~200 puzzles. */
export const RUSH_BUCKETS: Array<[number, number]> = [
  [650, 4],
  [750, 4],
  [850, 5],
  [950, 5],
  [1050, 6],
  [1150, 6],
  [1250, 7],
  [1350, 7],
  [1450, 8],
  [1550, 8],
  [1650, 9],
  [1750, 9],
  [1850, 10],
  [1950, 10],
  [2050, 11],
  [2150, 11],
  [2250, 12],
  [2350, 12],
  [2450, 12],
  [2550, 12],
  [2650, 12],
  [2750, 12],
];

/** Διάστημα [lo, hi) της διαδρομής που περιέχει τον βαθμό. */
export function pathRange(r: number): [number, number] {
  let lo = 0;
  let hi = PATH_BOUNDS[0];
  for (let i = 0; i < PATH_BOUNDS.length; i++) {
    if (r >= PATH_BOUNDS[i]) {
      lo = PATH_BOUNDS[i];
      hi = PATH_BOUNDS[i + 1] ?? 3500;
    }
  }
  return [lo, hi];
}

/** Μισό πλάτος του παραθύρου για συμβιβασμό c (Lichess: (100 + |1500 − r|/4)·c). */
export const ratingFlex = (target: number, c: number): number => (100 + Math.abs(1500 - target) / 4) * c;

/** Κρυφή λίστα για σπάνια θέματα (λιγότερα από 60.000 puzzles): ταξινομημένη ανά βαθμό στη μνήμη. */
interface ThemeList {
  rating: Int16Array;
  id: Float64Array;
  flags: Uint16Array;
  th1: Float64Array;
  th2: Float64Array;
}

const RARE_LIMIT = 60_000;

export class Selector {
  private t: Tactics;
  private lists = new Map<string, ThemeList>();
  private familyIds = new Map<string, number[]>();
  /** φίλτρα χωρίς κανένα puzzle σε όλους τους βαθμούς (π.χ. «all» με θέματα που δεν συνυπάρχουν): χωρίς νέα σάρωση */
  private emptyFilters = new Set<string>();

  constructor(t: Tactics) {
    this.t = t;
    t.onPuzzlesChanged(() => {
      this.lists.clear();
      this.familyIds.clear();
      this.emptyFilters.clear();
    });
  }

  /** Κλειδί των σταθερών κριτηρίων (χωρίς βαθμό και εξαιρέσεις). */
  private filterKey(p: SelectParams): string {
    return JSON.stringify([p.kind ?? 'solve', p.color ?? '', p.sourceId ?? LICHESS_SOURCE_ID, p.opening ?? '', [...(p.themes ?? [])].sort(), p.match ?? 'any']);
  }

  /** Σημαίες που πρέπει να είναι σβηστές/αναμμένες για τα κριτήρια. */
  private flagFilter(p: SelectParams): { mask: number; want: number } {
    let mask = F_INACTIVE;
    let want = 0;
    const kind = p.kind ?? 'solve';
    if (kind === 'solve') mask |= F_TEST | F_PRACTICE;
    else if (kind === 'practice') {
      mask |= F_PRACTICE;
      want |= F_PRACTICE;
    } else if (kind === 'test') {
      mask |= F_TEST;
      want |= F_TEST;
    }
    if (p.color) {
      mask |= F_WHITE;
      if (p.color === 'white') want |= F_WHITE;
    }
    // puzzles λύσης χωρίς άλλη πηγή: μόνο με πραγματικό βαθμό (Lichess)· εξάσκηση/τεστ από όλες τις πηγές
    if (kind === 'solve' && (p.sourceId ?? LICHESS_SOURCE_ID) === LICHESS_SOURCE_ID) mask |= F_UNRATED;
    return { mask, want };
  }

  private openingIds(opening: string): number[] {
    let ids = this.familyIds.get(opening);
    if (!ids) {
      const db = this.t.puzzles;
      const n = Number(opening);
      const rows = Number.isInteger(n) && n > 0 ? [{ id: n }] : (db.prep("SELECT id FROM opening WHERE family = ? OR tags = ? OR tags LIKE ? || ' %' OR tags LIKE '% ' || ?").all(opening, opening, opening.replace(/ /g, '_'), opening) as Array<{ id: number }>);
      ids = rows.map((r) => r.id);
      this.familyIds.set(opening, ids);
    }
    return ids;
  }

  /** Λίστα στη μνήμη για ένα σπάνιο θέμα (null αν το θέμα είναι συχνό). */
  private themeList(key: string): ThemeList | null {
    const def = BY_KEY.get(key);
    if (!def || def.bit === null) return null;
    const cached = this.lists.get(key);
    if (cached) return cached;
    const n = (this.t.puzzles.prep('SELECT n FROM theme WHERE id = ?').get(def.bit) as { n: number } | undefined)?.n ?? 0;
    if (n > RARE_LIMIT || n === 0) return null;
    const { m1, m2 } = maskOf([key]);
    const st = this.t.puzzles.db.prepare(`SELECT rating, id, flags, th1, th2 FROM puzzle WHERE ${m1 ? '(th1 & ?) != 0' : '(th2 & ?) != 0'} ORDER BY rating`);
    st.setReturnArrays(true);
    const rows = st.all(m1 || m2) as unknown as Array<[number, number, number, number, number]>;
    const list: ThemeList = { rating: new Int16Array(rows.length), id: new Float64Array(rows.length), flags: new Uint16Array(rows.length), th1: new Float64Array(rows.length), th2: new Float64Array(rows.length) };
    rows.forEach((r, i) => {
      list.rating[i] = r[0];
      list.id[i] = r[1];
      list.flags[i] = r[2];
      list.th1[i] = r[3];
      list.th2[i] = r[4];
    });
    this.lists.set(key, list);
    return list;
  }

  /**
   * Υποψήφια ids σε ένα διάστημα βαθμού (έως `limit`, ξεκινώντας από τυχαίο σημείο). Στο `seen.raw`
   * μετρά όσα ταίριαξαν στα κριτήρια πριν από τις εξαιρέσεις (0 = κανένα puzzle στο διάστημα).
   */
  candidates(p: SelectParams, lo: number, hi: number, limit = 64, seen: { raw: number } = { raw: 0 }): number[] {
    const db = this.t.puzzles;
    const { mask, want } = this.flagFilter(p);
    const themes = p.themes?.filter((k) => BY_KEY.get(k)?.bit != null) ?? [];
    const match = p.match ?? 'any';
    const kind = p.kind ?? 'solve';
    const r = Math.floor(lo + Math.random() * Math.max(1, hi - lo));
    const out: number[] = [];
    const accept = (id: number) => {
      seen.raw++;
      return !p.exclude?.(id);
    };

    // σπάνια θέματα: από τη μνήμη
    if (themes.length && !p.opening && (p.sourceId ?? LICHESS_SOURCE_ID) === LICHESS_SOURCE_ID) {
      const lists = themes.map((k) => this.themeList(k));
      const usable = match === 'all' ? lists.some((l) => l) : lists.every((l) => l);
      if (usable) {
        const { m1, m2 } = maskOf(themes);
        const sources = match === 'all' ? [lists.filter((l): l is ThemeList => !!l).sort((a, b) => a.id.length - b.id.length)[0]] : (lists as ThemeList[]);
        for (const L of sources) {
          const a = lowerBound(L.rating, lo);
          const end = lowerBound(L.rating, hi + 1);
          const n = end - a;
          if (n <= 0) continue;
          // τυχαία αρχή μέσα στο διάστημα, κυκλικά
          const start = a + Math.floor(Math.random() * n);
          for (let k = 0; k < n && out.length < limit; k++) {
            const i = start + k < end ? start + k : start + k - n;
            if ((L.flags[i] & mask) !== want) continue;
            if (match === 'all' && !(hasAll(L.th1[i], m1) && hasAll(L.th2[i], m2))) continue;
            const id = L.id[i];
            if (accept(id) && !out.includes(id)) out.push(id);
          }
        }
        return out;
      }
    }

    const args: Array<number | string> = [];
    let where = `(flags & ${mask}) = ${want}`;
    if (themes.length) {
      const { m1, m2 } = maskOf(themes);
      if (match === 'all') where += ` AND (th1 & ${m1}) = ${m1} AND (th2 & ${m2}) = ${m2}`;
      else where += ` AND ((th1 & ${m1}) != 0 OR (th2 & ${m2}) != 0)`;
    }
    if (p.opening) {
      const ids = this.openingIds(p.opening);
      if (!ids.length) return [];
      where += ` AND opening_id IN (${ids.join(',')})`;
    } else if ((p.sourceId ?? LICHESS_SOURCE_ID) !== LICHESS_SOURCE_ID) {
      // το «<> 1» ενεργοποιεί το μερικό ευρετήριο ix_puzzle_source
      where += ` AND ${OTHER_SOURCE}`;
      args.push(p.sourceId!);
    } else if (kind === 'practice' || kind === 'test') {
      // εξάσκηση και τεστ χωρίς πηγή: μόνο οι άλλες πηγές τα έχουν
      where += ` AND ${OTHER_SOURCES_IN}`;
    }
    // πάνω από το r και μετά κάτω από αυτό (για να μη μένει άδειο το άνω άκρο)
    const up = db.prep(`SELECT id FROM puzzle WHERE rating >= ? AND rating <= ? AND ${where} ORDER BY rating LIMIT ${limit}`).all(r, hi, ...args) as Array<{ id: number }>;
    for (const x of up) if (accept(x.id)) out.push(x.id);
    if (out.length < limit) {
      const down = db.prep(`SELECT id FROM puzzle WHERE rating >= ? AND rating < ? AND ${where} ORDER BY rating DESC LIMIT ${limit}`).all(lo, r, ...args) as Array<{ id: number }>;
      for (const x of down) if (accept(x.id)) out.push(x.id);
    }
    return out;
  }

  /**
   * Επόμενο puzzle: τυχαίο μέσα σε παράθυρο γύρω από τον στόχο· αν δεν βρεθεί, το παράθυρο
   * μεγαλώνει ×2, ×3, ×4 και στο τέλος καλύπτει όλους τους βαθμούς.
   */
  next(p: SelectParams): { row: PuzzleRow; window: [number, number]; compromise: number } | null {
    const fixed = p.min !== undefined || p.max !== undefined;
    const key = this.filterKey(p);
    if (this.emptyFilters.has(key)) return null;
    for (let c = 1; c <= 5; c++) {
      let lo: number;
      let hi: number;
      if (fixed) {
        lo = p.min ?? 0;
        hi = p.max ?? 4000;
        if (c > 1) {
          lo = 0;
          hi = 4000;
          if (c > 2) break;
        }
      } else if (c === 5) {
        lo = 0;
        hi = 4000;
      } else {
        const flex = ratingFlex(p.target, c);
        lo = Math.round(p.target - flex);
        hi = Math.round(p.target + flex);
      }
      const seen = { raw: 0 };
      const ids = this.candidates(p, lo, hi, 64, seen);
      if (ids.length) {
        const id = ids[Math.floor(Math.random() * ids.length)];
        const row = this.t.puzzles.get(id);
        if (row) return { row, window: [lo, hi], compromise: c };
      }
      // κανένα puzzle σε όλους τους βαθμούς (όχι απλώς όλα παιγμένα): το φίλτρο είναι άδειο ως την επόμενη εισαγωγή
      if (lo <= 0 && hi >= 4000 && seen.raw === 0) this.emptyFilters.add(key);
    }
    return null;
  }

  /** Σετ από κάδους βαθμού (Storm/Streak/Rush): ν puzzles ανά κάδο, RD ≤ όριο, ταξινομημένα ανά βαθμό. */
  bucketSet(buckets: Array<[number, number]>, opts: { color?: 'white' | 'black'; maxRd: (rating: number) => number; ranges?: 'path' | 'centered'; exclude?: (id: number) => boolean }): PuzzleRow[] {
    const db = this.t.puzzles;
    const chosen = new Set<number>();
    const out: PuzzleRow[] = [];
    let mask = F_INACTIVE | F_UNRATED | F_TEST | F_PRACTICE;
    let want = 0;
    if (opts.color) {
      mask |= F_WHITE;
      if (opts.color === 'white') want |= F_WHITE;
    }
    const st = db.prep(`SELECT id, rd FROM puzzle WHERE rating >= ? AND rating < ? AND (flags & ${mask}) = ${want} ORDER BY rating LIMIT 24`);
    for (const [rating, n] of buckets) {
      const [lo, hi] = opts.ranges === 'centered' ? [rating - 50, rating + 50] : pathRange(rating);
      const maxRd = opts.maxRd(rating);
      let got = 0;
      for (let tries = 0; got < n && tries < n * 8; tries++) {
        const r = Math.floor(lo + Math.random() * (hi - lo));
        const rows = st.all(r, hi) as Array<{ id: number; rd: number }>;
        const pick = rows.filter((x) => (x.rd ?? 999) <= maxRd && !chosen.has(x.id) && !opts.exclude?.(x.id));
        if (!pick.length) continue;
        const x = pick[Math.floor(Math.random() * pick.length)];
        chosen.add(x.id);
        got++;
      }
    }
    const rows = db.getMany([...chosen]);
    for (const id of chosen) {
      const r = rows.get(id);
      if (r) out.push(r);
    }
    out.sort((a, b) => a.rating - b.rating);
    return out;
  }

  /** Τυχαίο δείγμα `size` puzzles μέσα σε ζώνη βαθμού (για σετ Woodpecker). */
  sample(p: SelectParams, size: number): number[] {
    const lo = p.min ?? 0;
    const hi = p.max ?? 4000;
    const out = new Set<number>();
    for (let tries = 0; out.size < size && tries < size * 6; tries++) {
      const ids = this.candidates({ ...p, exclude: (id) => out.has(id) || !!p.exclude?.(id) }, lo, hi, 16);
      if (!ids.length) {
        if (tries > 20 && out.size === 0) break;
        continue;
      }
      out.add(ids[Math.floor(Math.random() * ids.length)]);
    }
    return [...out];
  }
}

function lowerBound(a: Int16Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Αν όλα τα bits της μάσκας `m` είναι αναμμένα στο `x` (αριθμοί έως 2^52). */
function hasAll(x: number, m: number): boolean {
  if (!m) return true;
  const P = 2 ** 26;
  const xl = x % P;
  const xh = Math.floor(x / P);
  const ml = m % P;
  const mh = Math.floor(m / P);
  return (xl & ml) === ml && (xh & mh) === mh;
}
