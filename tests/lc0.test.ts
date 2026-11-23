/** Lc0 (Leela και Maia): οι πιθανότητες της Maia από τα στατιστικά του Lc0, οι διαδρομές των βαρών και η επιλογή επιπέδου. */
import { describe, expect, it } from 'vitest';
import { parseVerboseStats, validHistory } from '../src/server/analysis.ts';
import { LC0, LEELA_NET, MAIA_LEVELS, MAIA_WEIGHTS, lc0Rel, nearestMaia } from '../src/server/lc0.ts';
import { sampleHuman } from '../src/web/play/bots.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('Lc0', () => {
  it('οι γραμμές VerboseMoveStats γίνονται κινήσεις με πιθανότητες, η πιο πιθανή πρώτη', () => {
    const lines = [
      'd2d4  (293 ) N:       0 (+ 0) (P: 31.20%) (WL:  -.-----) (D: -.---) (M:  -.-) (Q: -0.01000) (U: 0.38291) (S: 0.37291) (V:  -.----)',
      'e2e4  (322 ) N:       0 (+ 0) (P: 40.05%) (WL:  -.-----) (D: -.---) (M:  -.-) (Q: -0.01000) (U: 0.49152) (S: 0.48152) (V:  -.----)',
      'g1f3  (159 ) N:       0 (+ 0) (P:  9.10%) (WL:  -.-----) (D: -.---) (M:  -.-) (Q: -0.01000) (U: 0.11169) (S: 0.10169) (V:  -.----)',
      'node  ( 20 ) N:       1 (+ 0) (P: 100.0%) (WL:  0.00000) (D: 1.000) (M:  0.0) (Q:  0.00000) (V:  0.0000)',
    ];
    const m = parseVerboseStats(lines, START);
    expect(m.map((x) => x.san)).toEqual(['e4', 'd4', 'Nf3']);
    expect(m[0].p).toBeCloseTo(0.4005, 4);
    expect(sampleHuman(m, () => 0)).toBe('e2e4');
  });

  it('τα βάρη ως σχετική διαδρομή από τον φάκελο του lc0.exe (χωρίς ελληνικά)', () => {
    expect(lc0Rel('C:/Δοκιμή/engines/Lc0/v0.32.1/lc0.exe', 'C:/Δοκιμή/engines/Lc0/maia/maia-1500.pb.gz')).toBe('../maia/maia-1500.pb.gz');
  });

  it('η Maia με το πιο κοντινό Elo, και τα καρφωμένα αρχεία', () => {
    const e = (elo: number) => ({ id: `maia-${elo}`, name: `Maia ${elo}`, path: 'x', options: {}, human: { elo } });
    expect(nearestMaia([e(1100), e(1500), e(1900)], 1620)?.id).toBe('maia-1500');
    expect(nearestMaia([{ id: 'sf', name: 'SF', path: 'x', options: {} }], 1500)).toBeNull();
    expect(MAIA_LEVELS.every((l) => MAIA_WEIGHTS[l].bytes > 1_000_000 && /^[0-9a-f]{40}$/.test(MAIA_WEIGHTS[l].gitSha1))).toBe(true);
    expect(LC0.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(LEELA_NET.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('η παρτίδα για τη μηχανή μόνο όταν καταλήγει στη θέση που ζητήθηκε', () => {
    const after = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
    expect(validHistory(START, ['e2e4', 'e7e5'], after)).toEqual({ startFen: START, moves: ['e2e4', 'e7e5'] });
    expect(validHistory(START, ['e2e4', 'e7e6'], after)).toBeUndefined();
    expect(validHistory(START, ['e2e5'], after)).toBeUndefined();
    expect(validHistory(START, [], START)).toBeUndefined();
  });
});
