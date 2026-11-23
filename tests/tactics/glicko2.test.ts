/** Τεστ: Glicko-2 (παράδειγμα του Glickman, ανεξάρτητος υπολογισμός με διχοτόμηση) και οι κανόνες του Lichess για τα puzzles. */
import { describe, expect, it } from 'vitest';
import {
  averageGlicko,
  blitzScore,
  capGlicko,
  expectedScore,
  glicko2Update,
  isProvisional,
  newGlicko,
  ratePuzzleAttempt,
  themeWeight,
  type Glicko,
} from '../../src/core/glicko2.ts';

/**
 * Ανεξάρτητη υλοποίηση για σύγκριση: ίδιοι τύποι του Glickman, αλλά η μεταβλητότητα βρίσκεται με
 * απλή διχοτόμηση της f(x) = 0 (όχι Illinois), σε διάστημα [ln σ² − 20, ln σ² + 20].
 */
function reference(p: Glicko, opp: Array<[number, number, number]>, tau: number): Glicko {
  const S = 173.7178;
  const mu = (p.rating - 1500) / S;
  const phi = p.deviation / S;
  const g = (x: number) => 1 / Math.sqrt(1 + (3 * x * x) / (Math.PI * Math.PI));
  let vInv = 0;
  let sum = 0;
  for (const [r, rd, s] of opp) {
    const mj = (r - 1500) / S;
    const pj = rd / S;
    const E = 1 / (1 + Math.exp(-g(pj) * (mu - mj)));
    vInv += g(pj) ** 2 * E * (1 - E);
    sum += g(pj) * (s - E);
  }
  const v = 1 / vInv;
  const delta = v * sum;
  const a = Math.log(p.volatility ** 2);
  const f = (x: number) => (Math.exp(x) * (delta ** 2 - phi ** 2 - v - Math.exp(x))) / (2 * (phi ** 2 + v + Math.exp(x)) ** 2) - (x - a) / tau ** 2;
  // η f είναι φθίνουσα: διχοτόμηση
  let lo = a - 20;
  let hi = a + 20;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  const sigma = Math.exp((lo + hi) / 4);
  const phiStar = Math.sqrt(phi ** 2 + sigma ** 2);
  const phiNew = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / v);
  const muNew = mu + phiNew ** 2 * sum;
  return { rating: muNew * S + 1500, deviation: phiNew * S, volatility: sigma };
}

describe('Glicko-2', () => {
  it('παράδειγμα του Glickman (τ = 0,5): 1464,06 / 151,52 / 0,05999', () => {
    const r = glicko2Update({ rating: 1500, deviation: 200, volatility: 0.06 }, [
      { rating: 1400, deviation: 30, score: 1 },
      { rating: 1550, deviation: 100, score: 0 },
      { rating: 1700, deviation: 300, score: 0 },
    ], 0.5);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.deviation).toBeCloseTo(151.52, 1);
    expect(r.volatility).toBeCloseTo(0.05999, 4);
  });

  it('συμφωνεί με ανεξάρτητο υπολογισμό (διχοτόμηση) για τ = 0,75', () => {
    const cases: Array<[Glicko, Array<[number, number, number]>]> = [
      [newGlicko(), [[1500, 80, 1]]],
      [newGlicko(), [[1800, 75, 0]]],
      [{ rating: 1720, deviation: 62, volatility: 0.07 }, [[1650, 90, 1]]],
      [{ rating: 2100, deviation: 110, volatility: 0.09 }, [[2400, 300, 0.5]]],
      [{ rating: 1500, deviation: 200, volatility: 0.06 }, [[1400, 30, 1], [1550, 100, 0], [1700, 300, 0]]],
    ];
    for (const [p, opp] of cases) {
      const a = glicko2Update(p, opp.map(([rating, deviation, score]) => ({ rating, deviation, score })), 0.75);
      const b = reference(p, opp, 0.75);
      expect(a.rating).toBeCloseTo(b.rating, 4);
      expect(a.deviation).toBeCloseTo(b.deviation, 4);
      expect(a.volatility).toBeCloseTo(b.volatility, 6);
    }
  });

  it('χωρίς αποτελέσματα: μόνο αύξηση RD', () => {
    const r = glicko2Update({ rating: 1600, deviation: 50, volatility: 0.06 }, [], 0.75, 1);
    expect(r.rating).toBe(1600);
    expect(r.deviation).toBeCloseTo(Math.sqrt((50 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178, 6);
  });

  it('αναμενόμενο σκορ', () => {
    expect(expectedScore(newGlicko(), { rating: 1500, deviation: 80 })).toBeCloseTo(0.5, 10);
    expect(expectedScore({ rating: 1900, deviation: 50, volatility: 0.06 }, { rating: 1500, deviation: 50 })).toBeGreaterThan(0.85);
  });
});

describe('κανόνες Lichess', () => {
  it('όρια: βαθμός ≥ 400, RD στο [45, 500], μεταβλητότητα ≤ 0,1', () => {
    expect(capGlicko({ rating: 300, deviation: 20, volatility: 0.5 })).toEqual({ rating: 400, deviation: 45, volatility: 0.1 });
    expect(capGlicko({ rating: 1500, deviation: 900, volatility: 0.05 })).toEqual({ rating: 1500, deviation: 500, volatility: 0.05 });
  });

  it('βάρη θεμάτων (ponder)', () => {
    expect(themeWeight('mix', true)).toBe(1);
    expect(themeWeight('obvious', true)).toBe(0.1);
    expect(themeWeight('obvious', false)).toBe(0.4);
    expect(themeWeight('hinting', true)).toBe(0.2);
    expect(themeWeight('hinting', false)).toBe(0.7);
    expect(themeWeight('neutral', true)).toBe(0.7);
    expect(themeWeight('neutral', false)).toBe(0.8);
    const a = { rating: 1500, deviation: 100, volatility: 0.06 };
    const b = { rating: 1600, deviation: 80, volatility: 0.08 };
    expect(averageGlicko(a, b, 0.25)).toEqual({ rating: 1525, deviation: 95, volatility: 0.065 });
    expect(averageGlicko(a, b, 1)).toBe(b);
    expect(averageGlicko(a, b, 0)).toBe(a);
  });

  it('νέος παίκτης: «mix» = πλήρης αλλαγή, ίδια με τον ανεξάρτητο υπολογισμό', () => {
    const p = newGlicko();
    const r = ratePuzzleAttempt(p, { rating: 1500, deviation: 80 }, true, 'mix');
    const ref = capGlicko(reference(p, [[1500, 80, 1]], 0.75));
    expect(r.rating).toBeCloseTo(ref.rating, 6);
    expect(r.deviation).toBeCloseTo(ref.deviation, 6);
    expect(r.rating).toBeGreaterThan(1700);
    expect(isProvisional(r)).toBe(true);
  });

  it('θέμα «προφανές»: μόνο 10% της αλλαγής σε νίκη· puzzle με προσωρινό βαθμό: ελάχιστο βάρος 0,1', () => {
    const p = { rating: 1800, deviation: 70, volatility: 0.06 };
    const full = capGlicko(reference(p, [[1700, 80, 1]], 0.75));
    const obvious = ratePuzzleAttempt(p, { rating: 1700, deviation: 80 }, true, 'obvious');
    expect(obvious.rating).toBeCloseTo(p.rating + 0.1 * (full.rating - p.rating), 6);
    // hinting νίκη (0,2) − 0,2 για puzzle με RD ≥ 110 → 0 → ελάχιστο 0,1
    const prov = ratePuzzleAttempt(p, { rating: 1700, deviation: 120 }, true, 'hinting');
    const fullProv = capGlicko(reference(p, [[1700, 120, 1]], 0.75));
    expect(prov.rating).toBeCloseTo(p.rating + 0.1 * (fullProv.rating - p.rating), 6);
    // ήττα: ο βαθμός πέφτει
    expect(ratePuzzleAttempt(p, { rating: 1700, deviation: 80 }, false).rating).toBeLessThan(p.rating);
  });

  it('Blitz: αργή λύση = λιγότερο από 1, το πολύ ως 0,5· ήττα = 0', () => {
    expect(blitzScore(true, 5000, 10_000)).toBe(1);
    expect(blitzScore(true, 15_000, 10_000)).toBeCloseTo(0.75, 10);
    expect(blitzScore(true, 60_000, 10_000)).toBe(0.5);
    expect(blitzScore(false, 1000, 10_000)).toBe(0);
    expect(blitzScore(true, 1000, 0)).toBe(1);
    const p = { rating: 1600, deviation: 80, volatility: 0.06 };
    const fast = ratePuzzleAttempt(p, { rating: 1600, deviation: 80 }, true, 'mix', 1);
    const slow = ratePuzzleAttempt(p, { rating: 1600, deviation: 80 }, true, 'mix', 0.5);
    expect(fast.rating).toBeGreaterThan(slow.rating);
  });
});
