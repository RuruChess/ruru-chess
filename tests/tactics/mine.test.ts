/** Τεστ: η πηγή «Τα λάθη μου» και η τράπουλα FSRS της Τράπεζας λαθών μέσα από την υπηρεσία της Τακτικής. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mistakePuzzleId, storeOwnMistakes, type OwnMistake } from '../../src/server/tactics/mine.ts';
import { puzzleJson } from '../../src/server/tactics/format.ts';
import { puzzleKey } from '../../src/server/tactics/pack.ts';
import { TacticsService } from '../../src/server/tactics/service.ts';
import { SOURCE_BY_KEY, resolveSources } from '../../src/server/tactics/sources.ts';
import { F_OWN } from '../../src/server/tactics/store.ts';
import { tempTactics } from './helpers.ts';

/** 1.e4 e5 2.Qh5 Nc6 3.Bc4: η κάρτα ξεκινά πριν από το 3.Bc4 και η λύση είναι το 3…g6 (όχι 3…Nf6??). */
const CARD: OwnMistake = {
  id: 1,
  fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3',
  line: ['f1c4', 'g7g6'],
  pre: true,
  themes: ['opening', 'defensiveMove'],
  rating: 1586,
  meta: { kind: 'mistake', white: 'kostas_thess', black: 'lazaros1', playedSan: 'Nf6', cls: 'blunder' },
};

describe('Τα λάθη μου', () => {
  let env: ReturnType<typeof tempTactics>;
  let svc: TacticsService;
  beforeEach(() => {
    env = tempTactics();
    svc = new TacticsService(env.t);
  });
  afterEach(() => env.cleanup());

  it('η πηγή υπάρχει αλλά δεν εισάγεται ποτέ από τις εισαγωγές', () => {
    expect(SOURCE_BY_KEY.get('mine')?.id).toBe(60);
    expect(resolveSources('mine')).toEqual([]);
    expect(resolveSources('all').some((s) => s.key === 'mine')).toBe(false);
    expect(resolveSources('extras').some((s) => s.key === 'mine')).toBe(false);
  });

  it('οι κάρτες γίνονται puzzles της πηγής και κάρτες της τράπουλας «Τα λάθη μου» (για σήμερα)', async () => {
    const second: OwnMistake = { ...CARD, id: 2, meta: { ...CARD.meta, cls: 'mistake' } };
    const res = await storeOwnMistakes(env.t, svc, [CARD, second]);
    expect(res.report.imported).toBe(2);
    expect(res.added).toBe(2);
    const row = env.t.puzzles.get(mistakePuzzleId(1))!;
    expect(row.source_id).toBe(60);
    expect(row.flags & F_OWN).toBeTruthy();
    const pj = puzzleJson(env.t, row);
    expect(pj.source).toBe('mine');
    expect(pj.pre).toBe(true);
    expect(pj.color).toBe('black');
    expect(pj.themes.map((t) => t.key)).toContain('opening');
    expect((pj.meta as { black: string }).black).toBe('lazaros1');
    // η τράπουλα: δεν σβήνεται, και δίνει τις κάρτες για επανάληψη
    const deck = svc.mistakesDeck();
    expect(res.deck).toBe(deck);
    expect(() => svc.deleteDeck(deck)).toThrow();
    const next = svc.nextDue(deck);
    expect(next?.deck).toBe(deck);
    expect([mistakePuzzleId(1), mistakePuzzleId(2)]).toContain(next?.row.id);
    // ξανά με τα ίδια: τίποτα νέο
    expect((await storeOwnMistakes(env.t, svc, [CARD, second])).added).toBe(0);
  });

  it('επανάληψη: το FSRS κρατιέται στις νέες εγγραφές, η αποτυχία δεν πάει στα «Αποτυχημένα»', async () => {
    await storeOwnMistakes(env.t, svc, [CARD]);
    const deck = svc.mistakesDeck();
    const id = puzzleKey(mistakePuzzleId(1));
    const ok = svc.attempt({ id, mode: 'review', win: true, ms: 4000, deck });
    expect((ok.card as { scheduledDays: number }).scheduledDays).toBeGreaterThanOrEqual(1);
    const after = svc.deckCardStates(deck).get(mistakePuzzleId(1))!;
    expect(after.reps).toBe(1);
    await storeOwnMistakes(env.t, svc, [CARD]);
    expect(svc.deckCardStates(deck).get(mistakePuzzleId(1))?.reps).toBe(1);
    const bad = svc.attempt({ id, mode: 'review', win: false, ms: 4000, deck });
    expect(bad.addedToFailed).toBeUndefined();
    const failed = svc.failedDeck();
    expect(svc.deckCardStates(failed).size).toBe(0);
  });

  it('ένα λάθος που δεν ισχύει πια φεύγει από την τράπουλα· με ιστορικό μένει ανενεργό puzzle', async () => {
    const second: OwnMistake = { ...CARD, id: 2 };
    await storeOwnMistakes(env.t, svc, [CARD, second]);
    const deck = svc.mistakesDeck();
    svc.attempt({ id: puzzleKey(mistakePuzzleId(2)), mode: 'review', win: true, ms: 1000, deck });
    const res = await storeOwnMistakes(env.t, svc, [CARD]);
    expect(res.removed).toBe(1);
    expect(res.report.deactivated).toBe(1);
    expect(svc.deckCardStates(deck).has(mistakePuzzleId(2))).toBe(false);
    expect(env.t.puzzles.get(mistakePuzzleId(2))).toBeDefined();
  });
});
