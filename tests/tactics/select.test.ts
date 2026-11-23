/** Τεστ: επιλογή puzzles (παράθυρο που ανοίγει, μάσκες θεμάτων, χρώμα, άνοιγμα, σπάνια θέματα) και σύνθεση σετ Storm/Streak. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshCounts } from '../../src/server/tactics/catalog.ts';
import type { Tactics } from '../../src/server/tactics/context.ts';
import { pathRange, ratingFlex, Selector, STORM_BUCKETS, STREAK_BUCKETS } from '../../src/server/tactics/select.ts';
import { F_PRE, F_TEST, F_UNRATED, F_WHITE } from '../../src/server/tactics/store.ts';
import { keysOf } from '../../src/server/tactics/themes.ts';
import { addPuzzles, tempTactics } from './helpers.ts';

let env: ReturnType<typeof tempTactics>;
let t: Tactics;
beforeEach(() => {
  env = tempTactics();
  t = env.t;
});
afterEach(() => env.cleanup());

describe('παράθυρο βαθμού', () => {
  it('πλάτος όπως στο Lichess: (100 + |1500 − r|/4) × συμβιβασμός', () => {
    expect(ratingFlex(1500, 1)).toBe(100);
    expect(ratingFlex(2300, 1)).toBe(300);
    expect(ratingFlex(700, 2)).toBe(600);
  });
  it('διαδρομές του Lichess για τους κάδους', () => {
    expect(pathRange(1050)).toEqual([1000, 1100]);
    expect(pathRange(1300)).toEqual([1270, 1340]);
    expect(pathRange(1900)).toEqual([1900, 2000]);
    expect(pathRange(2199)).toEqual([2100, 2200]);
    expect(pathRange(2799)).toEqual([2650, 2800]);
  });
  it('διαλέγει μέσα στο παράθυρο όταν υπάρχουν puzzles', () => {
    addPuzzles(t, Array.from({ length: 161 }, (_, i) => ({ id: i + 1, rating: 1000 + i * 10 })));
    const s = new Selector(t);
    for (let k = 0; k < 40; k++) {
      const r = s.next({ target: 1500 })!;
      expect(r.compromise).toBe(1);
      expect(r.row.rating).toBeGreaterThanOrEqual(1400);
      expect(r.row.rating).toBeLessThanOrEqual(1600);
    }
  });
  it('ανοίγει ×2, ×3, ×4 και στο τέλος όλους τους βαθμούς', () => {
    addPuzzles(t, [{ id: 1, rating: 1750 }]);
    const s = new Selector(t);
    const r = s.next({ target: 1500 })!;
    expect(r.compromise).toBe(3);
    expect(r.window).toEqual([1200, 1800]);
    addPuzzles(t, [{ id: 1, rating: 2600 }]);
    expect(s.next({ target: 1500 })!.compromise).toBe(5);
  });
  it('αποκλείει όσα έχουν παιχτεί και επιστρέφει null όταν δεν μένει τίποτα', () => {
    addPuzzles(t, [
      { id: 1, rating: 1500 },
      { id: 2, rating: 1510 },
    ]);
    const s = new Selector(t);
    const r = s.next({ target: 1500, exclude: (id) => id === 1 })!;
    expect(r.row.id).toBe(2);
    expect(s.next({ target: 1500, exclude: () => true })).toBeNull();
  });
});

describe('φίλτρα', () => {
  it('μάσκα θεμάτων: any / all', () => {
    addPuzzles(t, [
      { id: 1, rating: 1500, themes: ['fork'] },
      { id: 2, rating: 1500, themes: ['pin'] },
      { id: 3, rating: 1500, themes: ['fork', 'pin', 'zugzwang'] },
      { id: 4, rating: 1500, themes: ['endgame'] },
    ]);
    const s = new Selector(t);
    const any = new Set<number>();
    for (let k = 0; k < 60; k++) any.add(s.next({ target: 1500, themes: ['fork', 'pin'] })!.row.id);
    expect([...any].sort()).toEqual([1, 2, 3]);
    for (let k = 0; k < 10; k++) expect(s.next({ target: 1500, themes: ['fork', 'pin'], match: 'all' })!.row.id).toBe(3);
    // θέμα στο th2 (bit ≥ 52)
    expect(keysOf(t.puzzles.get(3)!.th1, t.puzzles.get(3)!.th2)).toContain('zugzwang');
    expect(s.next({ target: 1500, themes: ['zugzwang'] })!.row.id).toBe(3);
  });
  it('σπάνιο θέμα από λίστα στη μνήμη (μετά τις μετρήσεις)', () => {
    addPuzzles(t, [
      ...Array.from({ length: 50 }, (_, i) => ({ id: i + 1, rating: 1200 + i * 20, themes: ['fork'] })),
      { id: 100, rating: 1490, themes: ['underPromotion'] },
      { id: 101, rating: 2500, themes: ['underPromotion'], white: false },
    ]);
    refreshCounts(t.puzzles);
    const s = new Selector(t);
    expect(s.next({ target: 1500, themes: ['underPromotion'] })!.row.id).toBe(100);
    expect(s.next({ target: 1500, themes: ['underPromotion'], color: 'black' })!.row.id).toBe(101);
    expect(s.next({ target: 1500, themes: ['underPromotion', 'fork'], match: 'all' })).toBeNull();
  });
  it('χρώμα, άνοιγμα, πηγή και μη βαθμολογημένα', () => {
    t.puzzles.db.exec("INSERT INTO opening(id, family, tags) VALUES (7, 'Sicilian Defense', 'Sicilian_Defense Sicilian_Defense_Najdorf_Variation')");
    addPuzzles(t, [
      { id: 1, rating: 1500, white: true },
      { id: 2, rating: 1500, white: false },
      { id: 3, rating: 1520, opening: 7 },
      { id: 1_000_000_001 + 400_000_000, rating: 1500, source: 40, flags: F_UNRATED | F_WHITE },
    ]);
    const s = new Selector(t);
    for (let k = 0; k < 10; k++) expect(s.next({ target: 1500, color: 'black' })!.row.id).toBe(2);
    expect(s.next({ target: 1500, opening: 'Sicilian Defense' })!.row.id).toBe(3);
    expect(s.next({ target: 1500, opening: 'Sicilian_Defense_Najdorf_Variation' })!.row.id).toBe(3);
    // τα μη βαθμολογημένα (άλλες πηγές) δεν μπαίνουν στον βαθμολογημένο τρόπο
    for (let k = 0; k < 20; k++) expect(s.next({ target: 1500 })!.row.source_id).toBe(1);
    expect(s.next({ target: 1500, sourceId: 40 })!.row.source_id).toBe(40);
  });
  it('τεστ: από όλες τις πηγές, χωρίς τα puzzles λύσης', () => {
    addPuzzles(t, [
      { id: 1, rating: 1500 },
      { id: 1_420_000_001, rating: 2300, source: 42, flags: F_UNRATED | F_TEST | F_WHITE },
    ]);
    const s = new Selector(t);
    expect(s.next({ target: 1500, kind: 'test' })!.row.id).toBe(1_420_000_001);
    expect(s.next({ target: 1500, kind: 'test', sourceId: 43 })).toBeNull();
    for (let k = 0; k < 10; k++) expect(s.next({ target: 1500 })!.row.id).toBe(1);
  });
  it('εξάσκηση/τεστ χωρίς πηγή: ευρετήριο των άλλων πηγών, όχι σάρωση όλων των βαθμών του Lichess', () => {
    addPuzzles(t, [
      ...Array.from({ length: 3000 }, (_, i) => ({ id: i + 1, rating: 800 + (i % 2000) })),
      { id: 1_420_000_001, rating: 2300, source: 42, flags: F_UNRATED | F_TEST | F_WHITE },
    ]);
    t.puzzles.db.exec('ANALYZE');
    const s = new Selector(t);
    const sqls: string[] = [];
    const prep = t.puzzles.prep.bind(t.puzzles);
    const spy = vi.spyOn(t.puzzles, 'prep').mockImplementation((sql: string) => {
      sqls.push(sql);
      return prep(sql);
    });
    expect(s.next({ target: 1500, kind: 'test' })!.row.id).toBe(1_420_000_001);
    spy.mockRestore();
    const selects = sqls.filter((x) => x.startsWith('SELECT id FROM puzzle WHERE rating'));
    expect(selects.length).toBeGreaterThan(0);
    for (const sql of selects) {
      const plan = (t.puzzles.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(1000, 2000) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
      expect(plan).toContain('ix_puzzle_source');
    }
  });
  it('φίλτρο χωρίς κανένα puzzle: δεν ξανασαρώνει όλους τους βαθμούς ως την επόμενη αλλαγή των puzzles', () => {
    addPuzzles(t, [
      { id: 1, rating: 1500, themes: ['fork'] },
      { id: 2, rating: 1600, themes: ['endgame'] },
    ]);
    const s = new Selector(t);
    const calls = vi.spyOn(s, 'candidates');
    expect(s.next({ target: 1500, themes: ['fork', 'endgame'], match: 'all' })).toBeNull();
    const n = calls.mock.calls.length;
    expect(n).toBe(5);
    expect(s.next({ target: 1800, themes: ['endgame', 'fork'], match: 'all' })).toBeNull();
    expect(calls.mock.calls.length).toBe(n);
    // «όλα παιγμένα» δεν είναι άδειο φίλτρο
    expect(s.next({ target: 1500, themes: ['fork'], exclude: () => true })).toBeNull();
    expect(s.next({ target: 1500, themes: ['fork'] })!.row.id).toBe(1);
    // νέα puzzles (μετά από εισαγωγή): ξανά κανονικά
    addPuzzles(t, [{ id: 3, rating: 1550, themes: ['fork', 'endgame'] }]);
    t.puzzlesChanged();
    expect(s.next({ target: 1500, themes: ['fork', 'endgame'], match: 'all' })!.row.id).toBe(3);
  });
});

describe('σετ γρήγορων τρόπων', () => {
  beforeEach(() => {
    // κάθε βαθμός 1000–2799: λευκά/μαύρα × RD 70/100
    const rows = [];
    let id = 1;
    for (let r = 1000; r < 2800; r++) for (const white of [true, false]) for (const rd of [70, 100]) rows.push({ id: id++, rating: r, rd, white, flags: F_PRE | (white ? F_WHITE : 0) });
    addPuzzles(t, rows);
  });
  it('Storm: 137 puzzles, ένα χρώμα, RD ≤ 85, σωστό πλήθος ανά κάδο, αύξουσα σειρά', () => {
    const s = new Selector(t);
    const set = s.bucketSet(STORM_BUCKETS, { color: 'white', maxRd: () => 85 });
    expect(set.length).toBe(137);
    expect(new Set(set.map((p) => p.id)).size).toBe(137);
    expect(set.every((p) => (p.flags & F_WHITE) !== 0 && (p.rd ?? 999) <= 85)).toBe(true);
    for (let i = 1; i < set.length; i++) expect(set[i].rating).toBeGreaterThanOrEqual(set[i - 1].rating);
    for (const [r, n] of STORM_BUCKETS) {
      const [lo, hi] = pathRange(r);
      expect(set.filter((p) => p.rating >= lo && p.rating < hi).length).toBe(n);
    }
  });
  it('Streak: 149 puzzles, RD ≤ 110 πάνω από 2300, και τα δύο χρώματα', () => {
    const s = new Selector(t);
    const set = s.bucketSet(STREAK_BUCKETS, { maxRd: (r) => (r > 2300 ? 110 : 85) });
    expect(set.length).toBe(STREAK_BUCKETS.reduce((a, [, n]) => a + n, 0));
    // το όριο RD ορίζεται ανά κάδο: έως και τον κάδο 2199 (διαδρομή 2100–2200) RD ≤ 85
    expect(set.filter((p) => p.rating < 2200).every((p) => (p.rd ?? 999) <= 85)).toBe(true);
    expect(set.every((p) => (p.rd ?? 999) <= 110)).toBe(true);
    expect(new Set(set.map((p) => p.flags & F_WHITE)).size).toBe(2);
  });
});
