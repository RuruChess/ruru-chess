/**
 * Tie-breaks για πίνακα τουρνουά (όπως στους κανονισμούς της FIDE), από τις παιγμένες
 * παρτίδες: Buchholz (άθροισμα βαθμών αντιπάλων), Buchholz Cut-1 (χωρίς τον χαμηλότερο),
 * Sonneborn-Berger (βαθμοί αντιπάλου × αποτέλεσμα) και νίκες.
 */
export interface TbPlayer {
  name: string;
  points: number;
  /** μία εγγραφή ανά παιγμένη παρτίδα: αντίπαλος και βαθμοί (1, ½, 0) */
  games: Array<{ opp: string; score: number }>;
}

export interface Tiebreaks {
  bh: number;
  bhc1: number;
  sb: number;
  wins: number;
}

export type TiebreakKey = keyof Tiebreaks;

/** Σειρά tie-breaks: στο πουλ SB και νίκες, στο ελβετικό Buchholz Cut-1, Buchholz, SB. */
export function tiebreakOrder(roundRobin: boolean): TiebreakKey[] {
  return roundRobin ? ['sb', 'wins'] : ['bhc1', 'bh', 'sb'];
}

export function tiebreaks(players: TbPlayer[]): Map<string, Tiebreaks> {
  const pts = new Map(players.map((p) => [p.name, p.points]));
  const out = new Map<string, Tiebreaks>();
  for (const p of players) {
    const opp = p.games.map((g) => pts.get(g.opp) ?? 0);
    const bh = opp.reduce((a, x) => a + x, 0);
    out.set(p.name, {
      bh,
      bhc1: opp.length > 1 ? bh - Math.min(...opp) : bh,
      sb: p.games.reduce((a, g) => a + g.score * (pts.get(g.opp) ?? 0), 0),
      wins: p.games.filter((g) => g.score === 1).length,
    });
  }
  return out;
}
