import { describe, expect, it } from 'vitest';
import { tiebreaks } from '../src/core/tiebreak.ts';

describe('tie-breaks', () => {
  it('Buchholz, Cut-1, Sonneborn-Berger και νίκες', () => {
    // πουλ 4 παικτών: A 2½, B 2, C 1, D ½
    const g = (opp: string, score: number) => ({ opp, score });
    const tb = tiebreaks([
      { name: 'A', points: 2.5, games: [g('B', 0.5), g('C', 1), g('D', 1)] },
      { name: 'B', points: 2, games: [g('A', 0.5), g('C', 0.5), g('D', 1)] },
      { name: 'C', points: 1, games: [g('A', 0), g('B', 0.5), g('D', 0.5)] },
      { name: 'D', points: 0.5, games: [g('A', 0), g('B', 0), g('C', 0.5)] },
    ]);
    expect(tb.get('A')).toEqual({ bh: 3.5, bhc1: 3, sb: 1 + 1 + 0.5, wins: 2 });
    expect(tb.get('B')).toEqual({ bh: 4, bhc1: 3.5, sb: 1.25 + 0.5 + 0.5, wins: 1 });
    expect(tb.get('C')!.sb).toBe(1 + 0.25);
    expect(tb.get('D')).toEqual({ bh: 5.5, bhc1: 4.5, sb: 0.5, wins: 0 });
  });
});
