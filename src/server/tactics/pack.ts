/** Συμπαγής αποθήκευση puzzles: θέση σε ~22 bytes, γραμμή σε u16 ανά κίνηση, αναγνωριστικά base-62. */
import { type Position, to88 } from '../../core/chess.ts';
import { moveToToken, tokenToUci } from '../../core/codec.ts';

// ---------------------------------------------------------------------------
// Αναγνωριστικά

/** Αλφάβητο base-62 σε σειρά ASCII (ίδια σειρά με το αρχείο του Lichess → εισαγωγή σε αύξουσα σειρά). */
const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ALPHA_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) ALPHA_INDEX[ALPHA.charCodeAt(i)] = i;

/** Όριο των αναγνωριστικών του Lichess (62⁵)· οι άλλες πηγές ξεκινούν από 1e9. */
export const LICHESS_ID_LIMIT = 62 ** 5;
export const OTHER_ID_BASE = 1_000_000_000;
/** Θέσεις ανά πηγή στον χώρο αναγνωριστικών των άλλων πηγών. */
export const OTHER_ID_STRIDE = 10_000_000;

/** «00008» → αριθμός (−1 αν δεν είναι αναγνωριστικό 5 χαρακτήρων base-62). */
export function decodeLichessId(s: string): number {
  if (s.length !== 5) return -1;
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? ALPHA_INDEX[c] : -1;
    if (v < 0) return -1;
    n = n * 62 + v;
  }
  return n;
}

export function encodeLichessId(n: number): string {
  let s = '';
  for (let i = 0; i < 5; i++) {
    s = ALPHA[n % 62] + s;
    n = Math.floor(n / 62);
  }
  return s;
}

/** Αναγνωριστικό άλλης πηγής: 1e9 + πηγή·1e7 + αύξων αριθμός (σταθερός για κάθε καρφωμένη έκδοση αρχείου). */
export const otherId = (sourceId: number, seq: number): number => OTHER_ID_BASE + sourceId * OTHER_ID_STRIDE + seq;

/** Δημόσιο κλειδί: «00008» για Lichess, ο αριθμός ως κείμενο για τις άλλες πηγές. */
export const puzzleKey = (id: number): string => (id < LICHESS_ID_LIMIT ? encodeLichessId(id) : String(id));

/** Από δημόσιο κλειδί σε αριθμό (NaN αν δεν είναι έγκυρο). */
export function parsePuzzleKey(s: string): number {
  if (/^\d{10,16}$/.test(s)) return Number(s);
  const n = decodeLichessId(s);
  return n < 0 ? NaN : n;
}

// ---------------------------------------------------------------------------
// Θέση

/**
 * Πακετάρισμα θέσης: 8 bytes κατάληψη (a1 = bit 0), κωδικός 4 bit ανά κομμάτι στη σειρά των
 * τετραγώνων, και 4 bytes σημαίες: bit 0 σειρά (1 = μαύρα), 1–4 ροκέ (K Q k q), 5–8 στήλη en passant + 1,
 * 9–15 μετρητής 50 κινήσεων (έως 127), 16–31 αριθμός κίνησης.
 */
export function packPosition(pos: Position): Uint8Array {
  const b = pos.board;
  let n = 0;
  for (let i = 0; i < 64; i++) if (b[to88(i)]) n++;
  const out = new Uint8Array(8 + ((n + 1) >> 1) + 4);
  let k = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[to88(i)];
    if (!p) continue;
    out[i >> 3] |= 1 << (i & 7);
    out[8 + (k >> 1)] |= (p & 15) << ((k & 1) * 4);
    k++;
  }
  const epFile = pos.ep >= 0 ? (pos.ep & 7) + 1 : 0;
  const flags = (pos.turn & 1) | ((pos.castling & 15) << 1) | (epFile << 5) | (Math.min(127, pos.halfmove) << 9) | (Math.min(65535, pos.fullmove) << 16);
  const o = out.length - 4;
  out[o] = flags & 255;
  out[o + 1] = (flags >>> 8) & 255;
  out[o + 2] = (flags >>> 16) & 255;
  out[o + 3] = (flags >>> 24) & 255;
  return out;
}

const FEN_CHARS = ' PNBRQK  pnbrqk';

/** FEN από πακεταρισμένη θέση. */
export function unpackFen(buf: Uint8Array): string {
  const pieces = new Int8Array(64);
  let k = 0;
  for (let i = 0; i < 64; i++) {
    if (!(buf[i >> 3] & (1 << (i & 7)))) continue;
    pieces[i] = (buf[8 + (k >> 1)] >> ((k & 1) * 4)) & 15;
    k++;
  }
  const o = buf.length - 4;
  const flags = (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
  let s = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pieces[rank * 8 + file];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) s += empty;
      empty = 0;
      s += FEN_CHARS[p];
    }
    if (empty) s += empty;
    if (rank) s += '/';
  }
  const black = flags & 1;
  const castling = (flags >> 1) & 15;
  const epFile = (flags >> 5) & 15;
  let c = '';
  for (let r = 0; r < 4; r++) if (castling & (1 << r)) c += 'KQkq'[r];
  const ep = epFile ? 'abcdefgh'[epFile - 1] + (black ? '3' : '6') : '-';
  return `${s} ${black ? 'b' : 'w'} ${c || '-'} ${ep} ${(flags >> 9) & 127} ${Math.max(1, flags >>> 16)}`;
}

/** Αν παίζουν τα μαύρα στην πακεταρισμένη θέση. */
export const packedBlackToMove = (buf: Uint8Array): boolean => (buf[buf.length - 4] & 1) === 1;

// ---------------------------------------------------------------------------
// Γραμμή κινήσεων (tokens του codec: from | to<<6 | προαγωγή<<12)

export function packLine(moves: readonly number[]): Uint8Array {
  const out = new Uint8Array(moves.length * 2);
  for (let i = 0; i < moves.length; i++) {
    const t = moveToToken(moves[i]);
    out[i * 2] = t & 255;
    out[i * 2 + 1] = t >> 8;
  }
  return out;
}

/** Γραμμή σε UCI (ροκέ ως e1g1). */
export function unpackLine(buf: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < buf.length; i += 2) out.push(tokenToUci(buf[i] | (buf[i + 1] << 8)));
  return out;
}
