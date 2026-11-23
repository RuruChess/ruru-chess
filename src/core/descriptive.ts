/**
 * Περιγραφική σημειογραφία (αγγλικά βιβλία ως τη δεκαετία του '70): «P-K4», «Kt-KB3», «PxP», «BxKt», «Q-R5ch»,
 * «R(Q1)-K1», «KR-Q1», «P-K8(Q)», «Castles». Οι στήλες έχουν όνομα από το κομμάτι της αρχικής θέσης (QR = a, QKt = b,
 * QB = c, Q = d, K = e, KB = f, KKt = g, KR = h) και οι γραμμές μετρούν από τη μεριά αυτού που παίζει (K4 = e4 για τον
 * Λευκό, e5 για τον Μαύρο). Η κίνηση βρίσκεται από τις νόμιμες κινήσεις της θέσης: ταιριάζουν το κομμάτι, ο
 * προορισμός (σε «-») ή το κομμάτι που αιχμαλωτίζεται (σε «x»)· όταν ταιριάζουν πολλές, αποφασίζουν οι διευκρινίσεις
 * («KR», «QBP», «(Q1)»).
 */
import { BISHOP, F_CASTLE, F_EP, KING, KNIGHT, PAWN, Position, QUEEN, ROOK, WHITE, moveFrom, movePromo, moveTo, pieceType } from './chess.ts';

const SIDE = String.raw`(?:K|Q)`;
const KIND = String.raw`(?:R|Kt|N|B)`;
/** κομμάτι με διευκρίνιση: K, Q, R, Kt, B, P, KR, QKt, KBP, QRP, BP… */
const PIECE = String.raw`(?:${SIDE}?${KIND}?P|${SIDE}${KIND}|${KIND}|K|Q)`;
/** τετράγωνο: K4, KB3, QKt5, B3 (QB3 ή KB3) */
const SQUARE = String.raw`(?:${SIDE}${KIND}?|${KIND})[1-8]`;

/** Μια κίνηση σε περιγραφική σημειογραφία (για την αναζήτηση μέσα στο κείμενο). */
export const DESC_SRC = String.raw`(?:${PIECE}(?:\(${SQUARE}\)|\/${SQUARE})?(?:-${SQUARE}|x${PIECE}(?:\(${SQUARE}\)|\/${SQUARE})?)(?:\s?e\.?p\.?)?(?:=?\((?:Q|R|B|Kt|N)\)|=(?:Q|R|B|Kt|N))?|Castles(?:\s?\(?(?:K|Q)R?\)?)?)`;

const FILE_OF: Record<string, number[]> = { QR: [0], QN: [1], QB: [2], Q: [3], K: [4], KB: [5], KN: [6], KR: [7], R: [0, 7], N: [1, 6], B: [2, 5] };
const TYPE: Record<string, number> = { K: KING, Q: QUEEN, R: ROOK, N: KNIGHT, B: BISHOP, P: PAWN };

/** «KB3» → οι στήλες και η γραμμή (από τη μεριά αυτού που παίζει). */
function square(s: string): { files: number[]; rank: number } | null {
  const m = /^([KQ]?[RNB]?)([1-8])$/.exec(s);
  if (!m || !m[1]) return null;
  const files = FILE_OF[m[1]];
  return files ? { files, rank: Number(m[2]) } : null;
}

/** «QBP» → είδος και στήλες (κενό: οποιαδήποτε)· «KR» → πύργος της πλευράς του βασιλιά. */
function piece(s: string): { type: number; files: number[] } | null {
  if (s === 'K' || s === 'Q') return { type: TYPE[s], files: [] };
  if (s.endsWith('P')) {
    const q = s.slice(0, -1);
    return { type: PAWN, files: q ? (FILE_OF[q] ?? []) : [] };
  }
  const m = /^([KQ]?)([RNB])$/.exec(s);
  if (!m) return null;
  return { type: TYPE[m[2]], files: m[1] === 'K' ? [4, 5, 6, 7] : m[1] === 'Q' ? [0, 1, 2, 3] : [] };
}

/** Η κίνηση στη θέση `pos`· 0 όταν δεν υπάρχει ή δεν ξεχωρίζει μία. */
export function descriptiveMove(pos: Position, text: string): number {
  const t = text.replace(/\s+/g, '').replace(/Kt/g, 'N').replace(/[—–−]/g, '-').replace(/×/g, 'x').replace(/(?:ch|\+|†)+$/i, '').replace(/e\.?p\.?$/, '');
  const legal = pos.legalMoves();
  const castle = /^Castles(?:\(?([KQ])R?\)?)?$/i.exec(t);
  if (castle) {
    const cs = legal.filter((m) => m & F_CASTLE);
    const side = castle[1] ? cs.filter((m) => (moveTo(m) & 7) === (castle[1] === 'K' ? 6 : 2) || (castle[1] === 'K' ? (moveTo(m) & 7) > 4 : (moveTo(m) & 7) < 4)) : cs;
    return side.length === 1 ? side[0] : 0;
  }
  const m = /^([KQRNBP]+)(?:\(([KQRNB]*[1-8])\)|\/([KQRNB]*[1-8]))?([-x])([KQRNBP]*[1-8]?)(?:\(([KQRNB]*[1-8])\)|\/([KQRNB]*[1-8]))?(?:=?\(?([QRNB])\)?)?$/.exec(t);
  if (!m) return 0;
  const who = piece(m[1]);
  if (!who) return 0;
  const absRank = (r: number) => (pos.turn === WHITE ? r : 9 - r) - 1;
  const origin = m[2] ?? m[3];
  const capture = m[4] === 'x';
  const promo = m[8] ? TYPE[m[8]] : 0;
  const info = legal.map((mv) => {
    const from = moveFrom(mv);
    const to = moveTo(mv);
    const captured = mv & F_EP ? PAWN : pieceType(pos.board[to]);
    return { mv, from, to, type: pieceType(pos.board[from]), captured, promo: movePromo(mv) };
  });
  let cand = info.filter((x) => x.type === who.type && !(x.mv & F_CASTLE));
  if (origin) {
    // «R(Q1)», «N(5)», «R/Q1»: το τετράγωνο (ή μόνο η γραμμή) από όπου φεύγει
    const o = square(origin) ?? (/^[1-8]$/.test(origin) ? { files: [0, 1, 2, 3, 4, 5, 6, 7], rank: Number(origin) } : null);
    if (o) cand = cand.filter((x) => o.files.includes(x.from & 7) && x.from >> 4 === absRank(o.rank));
  }
  if (capture) {
    const target = m[5] ? piece(m[5].replace(/\d$/, '')) : null;
    const at = m[6] ?? m[7];
    cand = cand.filter((x) => x.captured !== 0 && (!target || x.captured === target.type));
    if (at) {
      const sq = square(at);
      if (sq) cand = cand.filter((x) => sq.files.includes(x.to & 7) && x.to >> 4 === absRank(sq.rank));
    }
    // διευκρίνιση του στόχου («QBP», «KB»): μόνο αν μένει κάτι
    if (target?.files.length) {
      const narrowed = cand.filter((x) => target.files.includes(x.to & 7));
      if (narrowed.length) cand = narrowed;
    }
  } else {
    const sq = square(m[5]);
    if (!sq) return 0;
    cand = cand.filter((x) => sq.files.includes(x.to & 7) && x.to >> 4 === absRank(sq.rank));
    // «-» είναι κίνηση χωρίς αιχμαλωσία· αν όμως το OCR έχασε το «x», δεκτή και αιχμαλωσία
    const quiet = cand.filter((x) => x.captured === 0);
    if (quiet.length) cand = quiet;
  }
  // διευκρίνιση του κομματιού («KR», «QBP», «BP»): μόνο αν μένει κάτι
  if (who.files.length && cand.length > 1) {
    const narrowed = cand.filter((x) => who.files.includes(x.from & 7));
    if (narrowed.length) cand = narrowed;
  }
  if (promo) cand = cand.filter((x) => x.promo === promo);
  else if (cand.some((x) => x.promo)) cand = cand.filter((x) => !x.promo || x.promo === QUEEN);
  return cand.length === 1 ? cand[0].mv : 0;
}

/**
 * Τα κενά και οι παύλες του OCR μέσα σε περιγραφικές κινήσεις («P—K 4», «Kt — K B 3», «Q x P», «P XP», «P——Q 4»,
 * «K—BI»): κολλητά, με «-» και «x».
 */
export function squeezeDescriptive(s: string): string {
  const piece = String.raw`(?:[KQ]\s?(?:R|Kt|N|B)\s?P|[KQ]\s?(?:R|Kt|N|B)|(?:R|Kt|N|B)\s?P|K|Q|R|B|Kt|N|P)`;
  const sq = String.raw`(?:[KQ]\s?(?:R|Kt|N|B)?|R|Kt|N|B)\s?[1-8Il](?![A-Za-z0-9])`;
  const re = new RegExp(String.raw`(^|[\s(\[.…,;:])(${piece})\s?(-{1,2}|[—–]{1,2}|x|X|×)\s?(${sq}|${piece}(?![a-z]))`, 'g');
  return s.replace(re, (_m, pre: string, a: string, op: string, b: string) => {
    const capture = /^[xX×]$/.test(op);
    const target = b.replace(/\s/g, '').replace(/[Il]$/, '1');
    return `${pre}${a.replace(/\s/g, '')}${capture ? 'x' : '-'}${target}`;
  });
}
