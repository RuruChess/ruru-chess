/**
 * Γρήγορο παιχνίδι στη σκακιέρα, χωρίς μηχανή: ποιο κομμάτι εννοεί ένα κλικ στον προορισμό («κίνηση με ένα
 * κλικ») και πού μπορεί να πάει ένα κομμάτι σε προ-κίνηση (premove), όσο παίζει ακόμη ο αντίπαλος.
 */
import { BISHOP, BLACK_BIT, F_CAPTURE, KING, KNIGHT, PAWN, ROOK, moveFrom, type Position } from '../../core/chess.ts';

/** Η προ-κίνηση που περιμένει τη σειρά μας (προαγωγή πάντα σε βασίλισσα). */
export interface Premove {
  from: number;
  to: number;
}

/** Βαθμίδα ανά είδος κομματιού: πιόνι, ίππος = αξιωματικός, πύργος, βασίλισσα, βασιλιάς. */
const TIER = [9, 0, 1, 1, 2, 3, 4];

/**
 * Κίνηση με ένα κλικ: από πού ξεκινά η κίνηση προς το τετράγωνο που πατήθηκε. Στο φάγωμα παίρνει το φθηνότερο
 * κομμάτι (π.χ. exd5 πριν από Nxd5)· στην απλή κίνηση δεν μαντεύει (το f3 μπορεί να είναι f2-f3 ή Nf3). Ένα
 * τετράγωνο = παίζεται· περισσότερα = ισοπαλία (Nbd2 / Nfd2, ίππος / αξιωματικός) και διαλέγει ο χρήστης.
 */
export function oneClickFroms(cands: number[], board: ArrayLike<number>): number[] {
  const froms = [...new Set(cands.map(moveFrom))];
  if (froms.length < 2 || !cands.some((m) => m & F_CAPTURE)) return froms;
  const tier = (sq: number) => TIER[board[sq] & 7];
  const best = Math.min(...froms.map(tier));
  return froms.filter((sq) => tier(sq) === best);
}

const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_D = [1, -1, 16, -16, 17, 15, -17, -15];
const BISHOP_D = [17, 15, -17, -15];
const ROOK_D = [1, -1, 16, -16];

/**
 * Πού μπορεί να πάει το κομμάτι του `from` σε προ-κίνηση. Πρώτα παίζει ο αντίπαλος, άρα τα δικά του κομμάτια
 * μπορεί να φύγουν (οι δρόμοι περνούν από πάνω τους) και τα δικά μας να φαγωθούν (ξαναπαίρνω εκεί που είναι τώρα
 * δικό μου κομμάτι)· πίσω από δικό μας κομμάτι όμως δεν πάει τίποτα. Αν είναι νόμιμη το κρίνει η θέση μόλις
 * έρθει η σειρά μας.
 */
export function premoveTargets(pos: Position, from: number): Set<number> {
  const b = pos.board;
  const p = b[from];
  const out = new Set<number>();
  if (!p) return out;
  const black = (p & BLACK_BIT) !== 0;
  const own = (sq: number) => b[sq] !== 0 && ((b[sq] & BLACK_BIT) !== 0) === black;
  const add = (sq: number) => {
    if (!(sq & 0x88)) out.add(sq);
  };
  const type = p & 7;
  if (type === PAWN) {
    const up = black ? -16 : 16;
    const one = from + up;
    if (!(one & 0x88) && !own(one)) {
      out.add(one);
      if (from >> 4 === (black ? 6 : 1) && !own(one + up)) out.add(one + up);
    }
    add(one - 1);
    add(one + 1);
  } else if (type === KNIGHT || type === KING) {
    for (const d of type === KNIGHT ? KNIGHT_D : KING_D) add(from + d);
    if (type === KING) {
      // ροκέ όσο υπάρχει το δικαίωμα: κλασικό στο g1/c1, Chess960 «πάνω στον πύργο»
      for (const right of black ? [2, 3] : [0, 1]) {
        if (pos.castling & (1 << right)) out.add(pos.chess960 ? pos.castleRook[right] : from + (right % 2 === 0 ? 2 : -2));
      }
    }
  } else {
    for (const d of type === BISHOP ? BISHOP_D : type === ROOK ? ROOK_D : KING_D) {
      for (let sq = from + d; !(sq & 0x88); sq += d) {
        out.add(sq);
        if (own(sq)) break;
      }
    }
  }
  return out;
}
