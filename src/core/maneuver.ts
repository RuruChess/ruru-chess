/**
 * Αναζήτηση ελιγμών: το ίδιο κομμάτι κάνει με τη σειρά
 * τις κινήσεις προς τα τετράγωνα, π.χ. «Nd2 Nf1 Ng3» ή «N d2-f1-g3» (στο μεταξύ μπορούν να
 * κινηθούν άλλα κομμάτια). Χωρίς γράμμα: πιόνι. Δέχεται και ελληνικά γράμματα (Ι Α Π Β Ρ).
 */
import { type Position, parseSquare } from './chess.ts';
import { replayMainline, tokenToMove } from './codec.ts';

export interface ManeuverSpec {
  /** τύπος κομματιού 1–6 (πιόνι … βασιλιάς) */
  piece: number;
  /** 0 λευκά, 1 μαύρα, −1 οποιοδήποτε χρώμα */
  color: number;
  /** τετράγωνα (0x88) με τη σειρά */
  squares: number[];
}

const LETTERS: Record<string, number> = { N: 2, B: 3, R: 4, Q: 5, K: 6, Ι: 2, Α: 3, Π: 4, Β: 5, Ρ: 6 };

export function parseManeuver(text: string, color = -1): ManeuverSpec | null {
  const t = text.trim();
  const first = t.match(/[NBRQKΙΑΠΒΡ]/u);
  const squares = [...t.toLowerCase().matchAll(/[a-h][1-8]/g)].map((m) => parseSquare(m[0]));
  if (!squares.length || squares.length > 16) return null;
  return { piece: first ? LETTERS[first[0]] : 1, color, squares };
}

/** Αν στην κύρια γραμμή το ίδιο κομμάτι κάνει τον ελιγμό. */
export function gameHasManeuver(tokens: Uint16Array, fen: string | null, spec: ManeuverSpec, pos: Position): boolean {
  // υποψήφια κομμάτια: πού βρίσκονται και πόσα τετράγωνα της διαδρομής έχουν κάνει
  let cands: Array<{ sq: number; i: number }> = [];
  let found = false;
  replayMainline(tokens, pos, fen, (p, _ply, tk) => {
    if (tk === 0xffff || tk === 0x7fff) return false;
    const m = tokenToMove(p, tk);
    const from = m & 0x7f;
    const to = (m >> 7) & 0x7f;
    const pc = p.board[from];
    // αιχμαλωτισμένο υποψήφιο κομμάτι
    if (cands.length) cands = cands.filter((c) => c.sq !== to || c.sq === from);
    if ((pc & 7) !== spec.piece || (spec.color >= 0 && pc >> 3 !== spec.color)) return false;
    const c = cands.find((x) => x.sq === from);
    if (c) {
      if (to === spec.squares[c.i]) {
        c.i++;
        c.sq = to;
        if (c.i === spec.squares.length) return (found = true);
        return false;
      }
      cands = cands.filter((x) => x !== c);
    }
    if (to === spec.squares[0]) {
      if (spec.squares.length === 1) return (found = true);
      cands.push({ sq: to, i: 1 });
    }
    return false;
  });
  return found;
}
