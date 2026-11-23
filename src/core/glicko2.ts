// SPDX-License-Identifier: AGPL-3.0-or-later AND GPL-3.0-or-later AND MIT AND BSD-2-Clause
// Copyright (c) 2012-2026 the lila authors (AGPL-3.0-or-later), https://github.com/lichess-org/lila
//   from lila: PuzzleFinisher, rating limits
// Copyright (c) 2012-2014 Thibault Duplessis (MIT), https://github.com/lichess-org/scalachess: rating calculation,
//   itself based on https://github.com/goochjs/glicko2, Copyright (c) 2013, Jeremy Gooch (BSD-2-Clause)
// Adapted through RealChessBase by Lazaros Batsis (GPL-3.0-or-later).
// Translated to TypeScript and modified for Ruru Chess: 2026-10-27.
// License texts: LICENSE, licenses/AGPL-3.0.txt, licenses/NOTICES.txt
/** Glicko-2 με τις παραμέτρους του Lichess (scalachess/lila) για τον βαθμό του παίκτη στα puzzles. */

export interface Glicko {
  rating: number;
  deviation: number;
  volatility: number;
}

/** Αντίπαλος σε μία «παρτίδα» της περιόδου βαθμολόγησης. */
export interface GlickoResult {
  rating: number;
  deviation: number;
  /** 1 νίκη, 0 ήττα, ενδιάμεσες τιμές επιτρέπονται (π.χ. βαθμός Blitz) */
  score: number;
}

/** Κλίμακα Glicko → Glicko-2 (Glickman). */
export const GLICKO_SCALE = 173.7178;
/** τ του Lichess (scalachess `Tau.default`). */
export const LICHESS_TAU = 0.75;
export const DEFAULT_RATING = 1500;
export const DEFAULT_DEVIATION = 500;
export const DEFAULT_VOLATILITY = 0.09;
export const MIN_RATING = 400;
export const MIN_DEVIATION = 45;
export const MAX_DEVIATION = 500;
export const MAX_VOLATILITY = 0.1;
/** «Προσωρινός» βαθμός (το «?» του Lichess) όσο RD ≥ 110. */
export const PROVISIONAL_DEVIATION = 110;
/** «Clueless»: RD ≥ 230 (το Lichess τότε δεν αλλάζει τον βαθμό του puzzle). */
export const CLUELESS_DEVIATION = 230;
/** Μέγιστη αλλαγή του βαθμού ενός puzzle σε μία λύση (στο Lichess· εδώ τα puzzles μένουν σταθερά). */
export const MAX_RATING_DELTA = 700;

const CONVERGENCE_TOLERANCE = 0.000001;
const ITERATION_MAX = 1000;

export const newGlicko = (): Glicko => ({ rating: DEFAULT_RATING, deviation: DEFAULT_DEVIATION, volatility: DEFAULT_VOLATILITY });

const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muj: number, phij: number): number => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/** Αναμενόμενο σκορ του παίκτη απέναντι στον αντίπαλο (0..1). */
export function expectedScore(player: Glicko, opponent: { rating: number; deviation: number }): number {
  return expected((player.rating - DEFAULT_RATING) / GLICKO_SCALE, (opponent.rating - DEFAULT_RATING) / GLICKO_SCALE, opponent.deviation / GLICKO_SCALE);
}

/**
 * Μία περίοδος Glicko-2 (Glickman 2012, βήματα 2–8), όπως στο `RatingCalculator` του scalachess:
 * νέα μεταβλητότητα με τη μέθοδο Illinois (ανοχή 1e-6, έως 1000 επαναλήψεις).
 * `elapsedPeriods`: πόσες περίοδοι πέρασαν (1 για μία παρτίδα· 0 χωρίς αύξηση RD).
 */
export function glicko2Update(player: Glicko, results: GlickoResult[], tau = LICHESS_TAU, elapsedPeriods = 1): Glicko {
  const mu = (player.rating - DEFAULT_RATING) / GLICKO_SCALE;
  const phi = player.deviation / GLICKO_SCALE;
  const sigma = player.volatility;
  if (!results.length) {
    // χωρίς αποτελέσματα: μόνο το βήμα 6 (το RD μεγαλώνει)
    return { rating: player.rating, deviation: Math.sqrt(phi * phi + sigma * sigma * elapsedPeriods) * GLICKO_SCALE, volatility: sigma };
  }
  let vInv = 0;
  let outcome = 0;
  for (const r of results) {
    const muj = (r.rating - DEFAULT_RATING) / GLICKO_SCALE;
    const phij = r.deviation / GLICKO_SCALE;
    const e = expected(mu, muj, phij);
    const gj = g(phij);
    vInv += gj * gj * e * (1 - e);
    outcome += gj * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * outcome;
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  // βήμα 5.2: αρχικά όρια
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    B = a - k * Math.abs(tau);
    while (f(B) < 0) {
      k++;
      B = a - k * Math.abs(tau);
    }
  }
  // βήματα 5.3–5.4: Illinois
  let fA = f(A);
  let fB = f(B);
  let it = 0;
  while (Math.abs(B - A) > CONVERGENCE_TOLERANCE && it < ITERATION_MAX) {
    it++;
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  if (it >= ITERATION_MAX) throw new Error('Glicko-2: δεν συγκλίνει η μεταβλητότητα');
  const newSigma = Math.exp(A / 2);
  // βήματα 6–7
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma * elapsedPeriods);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * outcome;
  return { rating: newMu * GLICKO_SCALE + DEFAULT_RATING, deviation: newPhi * GLICKO_SCALE, volatility: newSigma };
}

/** Όρια του lila (`GlickoExt.cap`): βαθμός ≥ 400, RD στο [45, 500], μεταβλητότητα ≤ 0,1. */
export function capGlicko(x: Glicko): Glicko {
  return {
    rating: Math.max(MIN_RATING, x.rating),
    deviation: Math.min(MAX_DEVIATION, Math.max(MIN_DEVIATION, x.deviation)),
    volatility: Math.min(MAX_VOLATILITY, x.volatility),
  };
}

/** `sanityCheck` του lila. */
export function saneGlicko(x: Glicko): boolean {
  return x.rating > 0 && x.rating < 4000 && x.deviation > 0 && x.deviation < 1000 && x.volatility > 0 && x.volatility < MAX_VOLATILITY * 2;
}

/** Σταθμισμένη μετακίνηση από το `a` προς το `b` (`Glicko.average` του scalachess). */
export function averageGlicko(a: Glicko, b: Glicko, weight: number): Glicko {
  if (weight >= 1) return b;
  if (weight <= 0) return a;
  return {
    rating: a.rating * (1 - weight) + b.rating * weight,
    deviation: a.deviation * (1 - weight) + b.deviation * weight,
    volatility: a.volatility * (1 - weight) + b.volatility * weight,
  };
}

export const isProvisional = (x: { deviation: number }): boolean => x.deviation >= PROVISIONAL_DEVIATION;
export const isClueless = (x: { deviation: number }): boolean => x.deviation >= CLUELESS_DEVIATION;

/**
 * Κατηγορία βάρους του θέματος που διάλεξε ο παίκτης (PuzzleFinisher.ponder):
 * `mix` χωρίς θέμα, `obvious` θέματα που φανερώνουν τη λύση (ματ σε 1, en passant, μοτίβα ματ…),
 * `hinting` τα υπόλοιπα μοτίβα, `neutral` όσα δεν προδίδουν τίποτα (φάση, τύπος φινάλε, προέλευση).
 */
export type WeightClass = 'mix' | 'obvious' | 'hinting' | 'neutral';

/** Βάρος της αλλαγής βαθμού ανά θέμα (Lichess): mix 1, obvious 0,1/0,4, hinting 0,2/0,7, neutral 0,7/0,8. */
export function themeWeight(cls: WeightClass, win: boolean): number {
  if (cls === 'mix') return 1;
  if (cls === 'obvious') return win ? 0.1 : 0.4;
  if (cls === 'hinting') return win ? 0.2 : 0.7;
  return win ? 0.7 : 0.8;
}

/**
 * Νέος βαθμός του παίκτη μετά από μία λύση (ο παίκτης είναι «λευκός», το puzzle «μαύρος»).
 * Ο βαθμός του puzzle μένει σταθερός (ένας χρήστης δεν μπορεί να βαθμονομήσει εκατομμύρια puzzles).
 * `score`: 1/0 στο Standard· στο Blitz ενδιάμεση τιμή από τον χρόνο (βλ. `blitzScore`).
 */
export function ratePuzzleAttempt(player: Glicko, puzzle: { rating: number; deviation: number }, win: boolean, cls: WeightClass = 'mix', score = win ? 1 : 0): Glicko {
  const opp = capGlicko({ rating: puzzle.rating, deviation: puzzle.deviation, volatility: DEFAULT_VOLATILITY });
  let next: Glicko;
  try {
    next = glicko2Update(player, [{ rating: opp.rating, deviation: opp.deviation, score }], LICHESS_TAU, 1);
  } catch {
    return player;
  }
  if (!saneGlicko(next)) return player;
  next = capGlicko(next);
  // puzzle με προσωρινό βαθμό: μικρότερη επίδραση (ελάχιστο βάρος 0,1)
  const provisional = isProvisional(puzzle) ? (win ? -0.2 : -0.7) : 0;
  return averageGlicko(player, next, Math.max(0.1, themeWeight(cls, win) + provisional));
}

/**
 * Σκορ για τον βαθμό Blitz (πρόταση της έρευνας, όχι του Chess Tempo): η αργή λύση παίρνει
 * λιγότερο, έως το μισό. `t0` = διάμεσος χρόνος λύσης του χρήστη για παρόμοια puzzles.
 */
export function blitzScore(win: boolean, ms: number, t0: number): number {
  if (!win) return 0;
  if (!(t0 > 0) || !(ms >= 0)) return 1;
  return Math.min(1, Math.max(0.5, 1 - (0.5 * Math.max(0, ms - t0)) / t0));
}
