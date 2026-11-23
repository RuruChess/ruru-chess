/** Τεστ: FSRS, προσπάθειες και βαθμοί, τράπουλα «Αποτυχημένα», Woodpecker, γρήγοροι γύροι, πίνακας επιδόσεων, puzzle της ημέρας. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Tactics } from '../../src/server/tactics/context.ts';
import { dashboard, results, weakStrong } from '../../src/server/tactics/dashboard.ts';
import { scheduleCard } from '../../src/server/tactics/fsrs.ts';
import { puzzleKey } from '../../src/server/tactics/pack.ts';
import { TacticsService } from '../../src/server/tactics/service.ts';
import { addPuzzles, tempTactics } from './helpers.ts';

const DAY = 86_400_000;

describe('FSRS', () => {
  it('νέα κάρτα: Again ≤ Hard ≤ Good < Easy, διαστήματα σε ημέρες', () => {
    const now = Date.UTC(2026, 9, 24, 12);
    const days = (g: 1 | 2 | 3 | 4) => (scheduleCard(null, g, now).due - now) / DAY;
    expect(days(1)).toBeGreaterThanOrEqual(1);
    expect(days(1)).toBeLessThanOrEqual(days(2));
    expect(days(2)).toBeLessThanOrEqual(days(3));
    expect(days(3)).toBeLessThan(days(4));
    expect(Number.isInteger(days(3))).toBe(true);
  });
  it('επιτυχημένη επανάληψη μεγαλώνει το διάστημα, αποτυχία το μικραίνει', () => {
    const now = Date.UTC(2026, 9, 24, 12);
    const first = scheduleCard(null, 3, now);
    const row = { deck_id: 1, puzzle_id: 1, added: now, ord: 0, ...first };
    const later = first.due;
    const good = scheduleCard(row, 3, later);
    const again = scheduleCard(row, 1, later);
    expect(good.due - later).toBeGreaterThan(first.due - now);
    expect(again.due - later).toBeLessThan(good.due - later);
    expect(again.lapses).toBe(first.lapses + 1);
    expect(good.reps).toBe(2);
  });
});

describe('πίνακας επιδόσεων (μαθηματικά Lichess)', () => {
  it('επίδοση = μέσος βαθμός − 500 + 1000 × πρώτες νίκες / πλήθος', () => {
    const r = results(10, 6, 2, 15_000);
    expect(r).toMatchObject({ nb: 10, firstWins: 6, fixed: 2, failed: 4, unfixed: 2, puzzleRatingAvg: 1500, performance: 1600, firstWinPercent: 60, clear: true });
    expect(results(0, 0, 0, 0).performance).toBe(0);
  });
  it('αδύναμα / δυνατά θέματα', () => {
    const global = results(100, 50, 0, 150_000);
    const th = (key: string, nb: number, fw: number, avg: number) => ({ key, results: results(nb, fw, 0, nb * avg) });
    const themes = [th('fork', 10, 2, 1500), th('pin', 2, 0, 1500), th('skewer', 10, 8, 1600), th('sacrifice', 10, 9, 1400)];
    const { weak, strong } = weakStrong(themes, global);
    expect(weak.map((x) => x.key)).toEqual(['fork']);
    // το pin έχει nb ≤ global.nb / 40 και δεν μετρά
    expect(strong.map((x) => x.key)).toEqual(['skewer', 'sacrifice']);
  });
});

describe('υπηρεσίες', () => {
  let env: ReturnType<typeof tempTactics>;
  let svc: TacticsService;
  beforeEach(() => {
    env = tempTactics();
    svc = new TacticsService(env.t);
    addPuzzles(
      env.t,
      Array.from({ length: 40 }, (_, i) => ({ id: i + 1, rating: 1300 + i * 10, themes: i % 2 ? ['fork', 'middlegame'] : ['pin', 'endgame'] })),
    );
  });
  afterEach(() => env.cleanup());

  it('βαθμολογημένος τρόπος: μετρά μόνο η πρώτη προσπάθεια', () => {
    const a = svc.attempt({ id: puzzleKey(5), mode: 'rated', win: true, ms: 8000 });
    const std = (a.rating as { standard: { before: number; after: number } }).standard;
    expect(std.before).toBe(1500);
    expect(std.after).toBeGreaterThan(1500);
    expect(a.firstTry).toBe(true);
    const r1 = svc.rating('standard');
    const b = svc.attempt({ id: puzzleKey(5), mode: 'rated', win: false, ms: 8000 });
    expect(b.rating).toBeUndefined();
    expect(b.firstTry).toBe(false);
    expect(svc.rating('standard').rating).toBe(r1.rating);
    expect(svc.rating('blitz').n).toBe(1);
    // ο βαθμολογημένος τρόπος δεν ξαναδίνει το ίδιο puzzle
    for (let k = 0; k < 20; k++) expect(svc.nextPuzzle({ mode: 'rated', diff: 0 })!.row.id).not.toBe(5);
  });

  it('αποτυχία → «Αποτυχημένα» (επανάληψη αύριο)· επανάληψη ενημερώνει την κάρτα', () => {
    const now = Date.now();
    const a = svc.attempt({ id: puzzleKey(7), mode: 'casual', win: false, ms: 20_000, wrong: 'e2e4' });
    expect(a.addedToFailed).toBe(true);
    const failed = svc.failedDeck();
    const deck = svc.deck(failed) as { cards: Array<{ id: string; due: number }> };
    expect(deck.cards.map((c) => c.id)).toEqual([puzzleKey(7)]);
    expect(deck.cards[0].due - now).toBeGreaterThanOrEqual(DAY - 5000);
    expect(svc.nextDue()).toBeNull();
    // μετά από δύο μέρες είναι προς επανάληψη
    env.t.user.db.exec(`UPDATE card SET due = ${now - 1000}`);
    const due = svc.nextDue()!;
    expect(due.row.id).toBe(7);
    const r = svc.attempt({ id: puzzleKey(7), mode: 'review', win: true, ms: 5000, deck: failed });
    expect((r.card as { grade: number }).grade).toBe(3);
    expect((r.card as { due: number }).due).toBeGreaterThan(Date.now() + DAY);
  });

  it('τράπουλες: δημιουργία, κάρτες, διαγραφή (όχι της «Αποτυχημένα»)', () => {
    const d = svc.createDeck('Δική μου', 'custom', null, [puzzleKey(1), puzzleKey(2)]) as { id: number; total: number };
    expect(d.total).toBe(2);
    expect(svc.editCards(d.id, [puzzleKey(3), puzzleKey(1)], [puzzleKey(2)])).toEqual({ added: 1, removed: 1 });
    expect(svc.decks().length).toBe(2);
    svc.deleteDeck(d.id);
    expect(() => svc.deleteDeck(svc.failedDeck())).toThrow();
  });

  it('Woodpecker: σετ, σειρά, κύκλοι με στόχο το μισό χρόνο', () => {
    const w = svc.createWoodpecker({ size: 10, min: 1300, max: 1700 }) as { id: number; total: number; current: { id: number; next: string } };
    expect(w.total).toBe(10);
    const deck = w.id;
    const cycle = w.current.id;
    // ο πρώτος κύκλος κράτησε 28 ημέρες
    env.t.user.db.exec(`UPDATE cycle SET started = ${Date.now() - 28 * DAY + 3600_000} WHERE id = ${cycle}`);
    const seen = new Set<number>();
    for (let k = 0; k < 10; k++) {
      const id = svc.woodpeckerNextId(deck, cycle)!;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      const r = svc.attempt({ id: puzzleKey(id), mode: 'woodpecker', win: k !== 3, ms: 4000, cycle });
      expect((r.cycle as { solved: number }).solved).toBe(k + 1);
    }
    expect(svc.woodpeckerNextId(deck, cycle)).toBeNull();
    const done = svc.woodpecker(deck) as { cycles: Array<{ finished: number | null; correct: number; accuracy: number; days: number }>; recommendation: { nextTargetDays: number } };
    expect(done.cycles[0].finished).not.toBeNull();
    expect(done.cycles[0].correct).toBe(9);
    expect(done.cycles[0].days).toBe(28);
    expect(done.recommendation.nextTargetDays).toBe(14);
    const next = svc.startCycle(deck) as { cycles: Array<{ n: number; target_days: number }> };
    expect(next.cycles[1]).toMatchObject({ n: 2, target_days: 14 });
  });

  it('Woodpecker: η πρόοδος του κύκλου μετρά και όταν ο client στέλνει και την τράπουλα (ή μόνο την τράπουλα)', () => {
    // μια άλλη τράπουλα πρώτα, ώστε τα ids τράπουλας και κύκλου να διαφέρουν (όπως σε πραγματική χρήση)
    svc.failedDeck();
    const w = svc.createWoodpecker({ size: 6, min: 1300, max: 1700 }) as { id: number; current: { id: number } };
    const deck = w.id;
    const cycle = w.current.id;
    expect(deck).not.toBe(cycle);
    const first = svc.woodpeckerNextId(deck, cycle)!;
    const r = svc.attempt({ id: puzzleKey(first), mode: 'woodpecker', win: true, ms: 3000, deck, cycle });
    expect((r.cycle as { solved: number }).solved).toBe(1);
    // το επόμενο puzzle του κύκλου προχωρά (πριν: το ctx γινόταν η τράπουλα και ο κύκλος έμενε στο ίδιο puzzle)
    const second = svc.woodpeckerNextId(deck, cycle)!;
    expect(second).not.toBe(first);
    // δεύτερη προσπάθεια στο ίδιο puzzle: δεν ξαναμετρά
    expect(((svc.attempt({ id: puzzleKey(first), mode: 'woodpecker', win: true, ms: 3000, deck, cycle }).cycle) as { solved: number }).solved).toBe(1);
    // μόνο η τράπουλα: ο τρέχων κύκλος της
    const r2 = svc.attempt({ id: puzzleKey(second), mode: 'woodpecker', win: false, ms: 3000, deck });
    expect((r2.cycle as { cycle: number; solved: number })).toMatchObject({ cycle, solved: 2 });
    expect(svc.woodpeckerNextId(deck, cycle)).not.toBe(second);
  });

  it('γρήγοροι γύροι: αποθήκευση και ρεκόρ· τα χαμένα puzzles πάνε για επανάληψη', () => {
    const r1 = svc.saveRun({ mode: 'storm', score: 23, bestCombo: 9, errors: 3, puzzles: [{ id: puzzleKey(1), win: true }, { id: puzzleKey(2), win: false }] }) as { best: { score: number }; failed: string[] };
    expect(r1.best.score).toBe(23);
    expect(r1.failed).toEqual([puzzleKey(2)]);
    const r2 = svc.saveRun({ mode: 'storm', score: 31 }) as { best: { score: number }; count: number };
    expect(r2.best.score).toBe(31);
    expect(r2.count).toBe(2);
    expect(() => svc.saveRun({ mode: 'blitz', score: 1 })).toThrow();
  });

  it('πίνακας επιδόσεων από προσπάθειες: πρώτες νίκες, διορθωμένα, επανάληψη ανά θέμα', () => {
    for (let i = 1; i <= 12; i++) svc.attempt({ id: puzzleKey(i), mode: 'casual', win: i % 3 !== 0, ms: 1000 * i });
    // το 3 λύθηκε στη δεύτερη προσπάθεια (διορθώθηκε)
    svc.attempt({ id: puzzleKey(3), mode: 'casual', win: true, ms: 3000 });
    const d = dashboard(svc, 30) as { global: ReturnType<typeof results>; themes: Array<{ key: string; replay: string[]; results: ReturnType<typeof results> }>; solveTime: { count: number } };
    expect(d.global.nb).toBe(12);
    expect(d.global.firstWins).toBe(8);
    expect(d.global.fixed).toBe(1);
    expect(d.global.unfixed).toBe(3);
    const pin = d.themes.find((x) => x.key === 'pin')!;
    expect(pin.results.nb).toBe(6);
    expect(pin.replay.length).toBeGreaterThan(0);
    expect(d.themes.some((x) => x.key === 'middlegame')).toBe(true);
    expect(d.solveTime.count).toBe(9);
  });

  it('puzzle της ημέρας: σταθερό για την ίδια μέρα, προτιμά παλιό daily ίδιας ημερομηνίας', () => {
    const a = svc.daily('2026-10-24')!;
    const b = svc.daily('2026-10-24')!;
    expect(a.row.id).toBe(b.row.id);
    expect(a.origin).toBe('seed');
    env.t.puzzles.db.exec("INSERT INTO daily(day, puzzle_id) VALUES ('2021-10-24', 9)");
    const c = svc.daily('2026-10-24')!;
    expect(c.row.id).toBe(9);
    expect(c.origin).toBe('lichess-daily:2021-10-24');
  });
});

describe('puzzle της ημέρας: ντετερμινιστικό', () => {
  let env: ReturnType<typeof tempTactics>;
  beforeEach(() => {
    env = tempTactics();
    // ζεύγη puzzles με ίδιο βαθμό· τα θέματα (th1) σε αντίθετη σειρά από τα ids, ώστε η σειρά του
    // ευρετηρίου (βαθμός, th1, …) να διαφέρει από τη σειρά μιας σάρωσης του πίνακα
    const themes = ['fork', 'pin', 'skewer', 'sacrifice', 'deflection', 'attraction', 'clearance', 'interference'];
    addPuzzles(env.t, Array.from({ length: 400 }, (_, i) => ({ id: 1000 + i * 997, rating: 1500 + Math.floor(i / 2) * 2, themes: [themes[(400 - i) % themes.length]] })));
  });
  afterEach(() => env.cleanup());

  it('ίδιο με ή χωρίς ευρετήρια (π.χ. στη διάρκεια μιας εισαγωγής) και από άλλη σύνδεση', () => {
    const days = ['2026-01-01', '2026-03-17', '2026-07-04', '2026-10-25', '2026-12-31'];
    const svc = new TacticsService(env.t);
    const withIndex = days.map((d) => svc.daily(d)!.row.id);
    env.t.puzzles.db.exec('DROP INDEX ix_puzzle_rating; DROP INDEX ix_puzzle_opening; DROP INDEX ix_puzzle_source;');
    const without = days.map((d) => svc.daily(d)!.row.id);
    expect(without).toEqual(withIndex);
    // και αφού ξαναφτιαχτούν (με ANALYZE) σε νέα σύνδεση
    env.t.close();
    const t2 = new Tactics(env.dir);
    t2.puzzles.db.exec('CREATE INDEX IF NOT EXISTS ix_puzzle_rating ON puzzle(rating, th1, th2, flags); ANALYZE;');
    expect(days.map((d) => new TacticsService(t2).daily(d)!.row.id)).toEqual(withIndex);
    t2.close();
    expect(new Set(withIndex).size).toBeGreaterThan(1);
  });
});
