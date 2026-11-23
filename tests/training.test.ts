import { describe, expect, it } from 'vitest';
import { Position, START_FEN } from '../src/core/chess.ts';
import { encodeGame } from '../src/core/codec.ts';
import { parseGame } from '../src/core/pgn.ts';
import { BOX_DAYS, TrainTreeBuilder, answers, cardState, isBadMove, needIn, pickOpponentMove, pruneByChance, review, summarize, type TrainMove, type TrainTree } from '../src/core/training.ts';

const DAY = 86_400_000;

function build(pgns: string[], maxPly = 40): TrainTreeBuilder {
  const b = new TrainTreeBuilder();
  for (const pgn of pgns) {
    const enc = encodeGame(parseGame(pgn).game);
    b.addGame(enc.tokens, enc.comments, null, maxPly);
  }
  return b;
}

const keyAfter = (sans: string[]) => {
  const p = Position.fromFen(START_FEN);
  for (const s of sans) p.makeMove(p.parseSan(s));
  return p.hashKey();
};

describe('δέντρο εκπαίδευσης', () => {
  const games = [
    '1. d4 d5 2. c4 (2. Nf3 Nf6 3. c4) 2... e6 (2... c6 {Σλαβική}) 3. Nc3 Nf6 4. Bg5? (4. cxd5!) *',
    '1. d4 d5 2. c4 Nf6 3. Nf3 *',
  ];
  const tree = build(games).extract(START_FEN, 40, 10_000);

  it('κύρια γραμμή και βαριάντες, πρώτη η κύρια', () => {
    expect(tree.games).toBe(2);
    expect(tree.nodes[tree.root].map((m) => [m.san, m.n, m.main])).toEqual([['d4', 2, 2]]);
    expect(tree.nodes[keyAfter(['d4', 'd5'])].map((m) => [m.san, m.n, m.main])).toEqual([
      ['c4', 2, 2],
      ['Nf3', 1, 0],
    ]);
    expect(tree.nodes[keyAfter(['d4', 'd5', 'c4'])].map((m) => m.san)).toEqual(['e6', 'Nf6', 'c6']);
  });

  it('μεταθέσεις: ίδια θέση από άλλη σειρά κινήσεων', () => {
    const viaNf3 = tree.nodes[keyAfter(['d4', 'd5', 'Nf3', 'Nf6'])].find((m) => m.san === 'c4')!;
    const viaC4 = tree.nodes[keyAfter(['d4', 'd5', 'c4', 'Nf6'])].find((m) => m.san === 'Nf3')!;
    expect(viaNf3.to).toBe(viaC4.to);
  });

  it('σχόλια και κινήσεις με ?', () => {
    expect(tree.nodes[keyAfter(['d4', 'd5', 'c4'])].find((m) => m.san === 'c6')!.c).toBe('Σλαβική');
    const k = keyAfter(['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6']);
    const bg5 = tree.nodes[k].find((m) => m.san === 'Bg5')!;
    expect(isBadMove(bg5)).toBe(true);
    expect(answers(tree, k).map((m) => m.san)).toEqual(['cxd5']);
  });

  it('όρια βάθους', () => {
    const shallow = build(games, 2).extract(START_FEN, 40, 10_000);
    expect(Object.keys(shallow.nodes).length).toBe(2);
    const cut = build(games).extract(START_FEN, 1, 10_000);
    expect(Object.keys(cut.nodes)).toEqual([cut.root]);
    const capped = build(games).extract(START_FEN, 40, 3);
    expect(Object.keys(capped.nodes).length).toBe(3);
    expect(capped.truncated).toBe(true);
  });

  it('μεγάλα δέντρα: γραμμές με πιθανότητα', () => {
    const mk = (san: string, n: number, q = 0): TrainMove => ({ uci: san, san, n, main: n, q, to: san });
    const pr = (list: TrainMove[], p: number, user: boolean) => pruneByChance(list, p, user, 0.005).map((k) => [k.e.san, +k.p.toFixed(4)]);
    const list = [mk('a', 90), mk('b', 9), mk('c', 1)];
    expect(pr(list, 1, false)).toEqual([['a', 0.9], ['b', 0.09], ['c', 0.01]]);
    expect(pr(list, 0.1, false)).toEqual([['a', 0.09], ['b', 0.009]]);
    // του χρήστη: η κύρια απάντηση (όχι η σημειωμένη με ?) κρατά την πιθανότητα της θέσης
    expect(pr(list, 0.1, true)).toEqual([['a', 0.1], ['b', 0.009]]);
    expect(pr([mk('x', 50, 50), mk('y', 50)], 0.2, true)).toEqual([['x', 0.1], ['y', 0.2]]);
    // βάση με ολόκληρες παρτίδες: η δεύτερη προσπάθεια κρατά μόνο τις πιθανές γραμμές
    const many = Array.from({ length: 300 }, (_, i) => `1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 ${['Nb8', 'Na5', 'Bb7', 'Re8', 'h6', 'Be6'][i % 6]} 10. d4 *`);
    many.push('1. a3 a6 2. b3 b6 *');
    const t = build(many).extract(START_FEN, 30, 25, true);
    expect(t.pruned).toBe(true);
    expect(t.nodes[t.root].map((m) => m.san)).toEqual(['e4', 'a3']);
    expect(t.nodes[keyAfter(['a3'])]).toBeUndefined();
    expect(t.nodes[keyAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8'])]![0].san).toBe('d4');
  });

  it('αρχή από άλλη θέση', () => {
    const p = Position.fromFen(START_FEN);
    for (const s of ['d4', 'd5']) p.makeMove(p.parseSan(s));
    const sub = build(games).extract(p.fen(), 40, 10_000);
    expect(sub.root).toBe(keyAfter(['d4', 'd5']));
    expect(sub.nodes[keyAfter([])]).toBeUndefined();
    expect(sub.nodes[sub.root][0].san).toBe('c4');
  });
});

describe('επανάληψη σε διαστήματα', () => {
  const now = 1_000 * DAY;

  it('κουτιά Leitner', () => {
    const a = review(undefined, true, now);
    expect(a).toMatchObject({ box: 1, due: now + DAY, ok: 1, bad: 0 });
    // σωστή πριν τη λήξη: ίδιο κουτί
    expect(review(a, true, now + 1000)).toMatchObject({ box: 1, due: now + DAY, ok: 2 });
    const b = review(a, true, now + 2 * DAY);
    expect(b).toMatchObject({ box: 2, due: now + 2 * DAY + BOX_DAYS[2] * DAY });
    const c = review(b, false, now + 3 * DAY);
    expect(c).toMatchObject({ box: 0, due: now + 3 * DAY, bad: 1 });
  });

  it('καταστάσεις', () => {
    expect(cardState(undefined, now)).toBe('new');
    expect(cardState({ box: 0, due: now, ok: 0, bad: 1, last: now }, now)).toBe('due');
    expect(cardState({ box: 2, due: now + DAY, ok: 2, bad: 0, last: now }, now)).toBe('learning');
    expect(cardState({ box: 4, due: now + DAY, ok: 4, bad: 0, last: now }, now)).toBe('learned');
  });
});

describe('επιλογή κίνησης αντιπάλου', () => {
  // ο χρήστης έχει τα μαύρα: ο αντίπαλος (λευκά) παίζει d4 (9) ή e4 (1)
  const games = [...Array(9).fill('1. d4 d5 2. c4 e6 *'), '1. e4 c6 2. d4 d5 *'];
  const tree: TrainTree = build(games).extract(START_FEN, 40, 10_000);
  const now = 1_000 * DAY;
  const learned = { box: 5, due: now + 30 * DAY, ok: 5, bad: 0, last: now };

  it('με βάρη συχνότητας', () => {
    const pick = (r: number) => pickOpponentMove(tree, tree.root, { stats: {}, now, depth: 10, mode: 'random', rand: () => r })!.san;
    expect(pick(0.5)).toBe('d4');
    expect(pick(0.95)).toBe('e4');
  });

  it('η επανάληψη προτιμά τις γραμμές που δεν έχουν μάθει', () => {
    const stats = { [keyAfter(['d4'])]: learned, [keyAfter(['d4', 'd5', 'c4'])]: learned };
    expect(needIn(tree, keyAfter(['d4']), true, 10, stats, now)).toBe(0);
    expect(needIn(tree, keyAfter(['e4']), true, 10, stats, now)).toBe(2);
    // βάρη: d4 9·0,1 = 0,9 · e4 1·(1 + log2 3) ≈ 2,58
    const pick = (r: number) => pickOpponentMove(tree, tree.root, { stats, now, depth: 10, mode: 'review', rand: () => r })!.san;
    expect(pick(0.2)).toBe('d4');
    expect(pick(0.5)).toBe('e4');
  });

  it('σύνοψη', () => {
    const stats = { [keyAfter(['d4'])]: learned };
    expect(summarize(tree, false, 10, stats, now)).toEqual({ total: 4, fresh: 3, due: 0, learning: 0, learned: 1 });
    expect(pickOpponentMove(tree, keyAfter(['d4', 'd5', 'c4', 'e6']), { stats, now, depth: 10, mode: 'review' })).toBeNull();
  });
});
