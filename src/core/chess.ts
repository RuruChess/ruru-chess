/**
 * Ruru — κανόνες σκακιού.
 *
 * Αναπαράσταση 0x88 (128 τετράγωνα, a1 = 0x00, h8 = 0x77), γρήγορη γεννήτρια
 * κινήσεων με make/unmake χωρίς δέσμευση μνήμης, FEN, SAN (παραγωγή και
 * ανάγνωση), UCI και Zobrist hashing 64-bit (δύο ακέραιοι των 32-bit).
 *
 * Ο κώδικας χρησιμοποιείται και από τον server (εισαγωγή εκατομμυρίων
 * παρτίδων) και από τον browser, γι' αυτό δεν έχει εξαρτήσεις.
 */

export const WHITE = 0;
export const BLACK = 1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const BLACK_BIT = 8;

// Κωδικοποίηση κίνησης σε έναν ακέραιο:
// bits 0-6 από, 7-13 προς, 14-16 κομμάτι προαγωγής, 17+ σημαίες.
export const F_CAPTURE = 1 << 17;
export const F_EP = 1 << 18;
export const F_CASTLE = 1 << 19;
export const F_DOUBLE = 1 << 20;
export const F_NULL = 1 << 21;
/** Ροκέ Chess960 (πύργος όχι στη γωνία ή βασιλιάς όχι στη στήλη e): η στήλη του πύργου στα bits 23–25. */
export const F_C960 = 1 << 22;
export const NULL_MOVE = F_NULL;

export const moveFrom = (m: number): number => m & 0x7f;
export const moveTo = (m: number): number => (m >> 7) & 0x7f;

/** Τετράγωνο του πύργου σε κίνηση ροκέ (ο προορισμός του βασιλιά είναι πάντα g ή c). */
export function castleRookSquare(m: number): number {
  const to = (m >> 7) & 0x7f;
  if (m & F_C960) return (to & 0x70) | ((m >> 23) & 7);
  return (to & 0x70) | ((to & 7) === 6 ? 7 : 0);
}
export const movePromo = (m: number): number => (m >> 14) & 7;
export const pieceType = (p: number): number => p & 7;
export const pieceColor = (p: number): number => p >> 3;

export const FILES = 'abcdefgh';
export const PIECE_LETTERS = ' PNBRQK';
const FEN_PIECES = ' PNBRQK  pnbrqk';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function squareName(sq: number): string {
  return FILES[sq & 7] + String((sq >> 4) + 1);
}

/** Διαβάζει τετράγωνο ("e4") από τη θέση i του s· επιστρέφει -1 αν δεν είναι έγκυρο. */
export function parseSquare(s: string, i = 0): number {
  const f = s.charCodeAt(i) - 97;
  const r = s.charCodeAt(i + 1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7 || Number.isNaN(f) || Number.isNaN(r)) return -1;
  return r * 16 + f;
}

export const to64 = (sq: number): number => ((sq >> 4) << 3) | (sq & 7);
export const to88 = (i: number): number => ((i >> 3) << 4) | (i & 7);

export function makeMoveCode(from: number, to: number, promo = 0, flags = 0): number {
  return from | (to << 7) | (promo << 14) | flags;
}

const KNIGHT_OFFSETS = [33, 31, 18, 14, -14, -18, -31, -33];
const KING_OFFSETS = [17, 16, 15, 1, -1, -15, -16, -17];
const DIAG_OFFSETS = [17, 15, -15, -17];
const ORTH_OFFSETS = [16, -16, 1, -1];

// Δικαιώματα ροκέ: 1 = K, 2 = Q, 4 = k, 8 = q
const CASTLE_MASK = new Int32Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~2;
CASTLE_MASK[0x07] = 15 & ~1;
CASTLE_MASK[0x04] = 15 & ~3;
CASTLE_MASK[0x70] = 15 & ~8;
CASTLE_MASK[0x77] = 15 & ~4;
CASTLE_MASK[0x74] = 15 & ~12;

// ---------------------------------------------------------------------------
// Zobrist: σταθερή γεννήτρια (ΜΗΝ αλλάξει — τα ευρετήρια στον δίσκο εξαρτώνται από αυτήν)

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) | 0;
  };
}

export const Z_PIECE_HI = new Int32Array(16 * 128);
export const Z_PIECE_LO = new Int32Array(16 * 128);
export const Z_CASTLE_HI = new Int32Array(16);
export const Z_CASTLE_LO = new Int32Array(16);
export const Z_EP_HI = new Int32Array(8);
export const Z_EP_LO = new Int32Array(8);
export let Z_SIDE_HI = 0;
export let Z_SIDE_LO = 0;
{
  const rnd = splitmix32(0x5ca1ab1e);
  for (let p = 1; p < 16; p++) {
    if ((p & 7) === 0 || (p & 7) === 7) continue;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      Z_PIECE_HI[p * 128 + sq] = rnd();
      Z_PIECE_LO[p * 128 + sq] = rnd();
    }
  }
  const rightHi: number[] = [];
  const rightLo: number[] = [];
  for (let i = 0; i < 4; i++) {
    rightHi.push(rnd());
    rightLo.push(rnd());
  }
  for (let mask = 0; mask < 16; mask++) {
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < 4; i++) {
      if (mask & (1 << i)) {
        hi ^= rightHi[i];
        lo ^= rightLo[i];
      }
    }
    Z_CASTLE_HI[mask] = hi;
    Z_CASTLE_LO[mask] = lo;
  }
  for (let f = 0; f < 8; f++) {
    Z_EP_HI[f] = rnd();
    Z_EP_LO[f] = rnd();
  }
  Z_SIDE_HI = rnd();
  Z_SIDE_LO = rnd();
}

/** Κλειδί θέσης ως string 16 δεκαεξαδικών ψηφίων (για Map/JSON). */
export function hashKey(hi: number, lo: number): string {
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

const UNDO_SIZE = 7;

export type GameStatus = 'ongoing' | 'checkmate' | 'stalemate' | 'insufficient' | 'fifty';

export class Position {
  board = new Int8Array(128);
  turn = WHITE;
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  kingSq = new Int32Array(2);
  hashHi = 0;
  hashLo = 0;
  /** τετράγωνα των πύργων του ροκέ για K, Q, k, q (στο Chess960 σε οποιαδήποτε στήλη) */
  castleRook = Int32Array.from([0x07, 0x00, 0x77, 0x70]);
  /** Chess960: FEN με X-FEN, UCI με «βασιλιάς πάνω στον πύργο» */
  chess960 = false;
  /** ποια δικαιώματα ροκέ χάνονται όταν κινείται κάτι από/προς κάθε τετράγωνο */
  private cmask = Int32Array.from(CASTLE_MASK);
  private undo = new Int32Array(UNDO_SIZE * 512);
  private sp = 0;

  static fromFen(fen: string): Position {
    const p = new Position();
    p.setFen(fen);
    return p;
  }

  static start(): Position {
    return Position.fromFen(START_FEN);
  }

  clone(): Position {
    const p = new Position();
    p.copyFrom(this);
    return p;
  }

  copyFrom(o: Position): void {
    this.board.set(o.board);
    this.turn = o.turn;
    this.castling = o.castling;
    this.ep = o.ep;
    this.halfmove = o.halfmove;
    this.fullmove = o.fullmove;
    this.kingSq[0] = o.kingSq[0];
    this.kingSq[1] = o.kingSq[1];
    this.hashHi = o.hashHi;
    this.hashLo = o.hashLo;
    this.castleRook.set(o.castleRook);
    this.chess960 = o.chess960;
    this.cmask.set(o.cmask);
    this.sp = 0;
  }

  /** Φορτώνει FEN. Πετάει σφάλμα αν το FEN είναι άκυρο. */
  setFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 1 || !parts[0]) throw new Error('Κενό FEN');
    this.board.fill(0);
    this.sp = 0;
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('Άκυρο FEN: χρειάζονται 8 γραμμές');
    const kings = [-1, -1];
    for (let r = 0; r < 8; r++) {
      const row = rows[r];
      let file = 0;
      const rank = 7 - r;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') {
          file += ch.charCodeAt(0) - 48;
          continue;
        }
        const idx = FEN_PIECES.indexOf(ch);
        if (idx <= 0 || file > 7) throw new Error(`Άκυρο FEN: «${ch}»`);
        const sq = rank * 16 + file;
        this.board[sq] = idx;
        if ((idx & 7) === KING) kings[idx >> 3] = sq;
        file++;
      }
      if (file !== 8) throw new Error('Άκυρο FEN: λάθος πλήθος τετραγώνων σε γραμμή');
    }
    if (kings[0] < 0 || kings[1] < 0) throw new Error('Άκυρο FEN: λείπει βασιλιάς');
    this.kingSq[0] = kings[0];
    this.kingSq[1] = kings[1];
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    this.castling = 0;
    this.castleRook.set([0x07, 0x00, 0x77, 0x70]);
    this.chess960 = false;
    const c = parts[2] ?? '-';
    for (const ch of c === '-' ? '' : c) {
      const color = ch >= 'a' && ch <= 'z' ? BLACK : WHITE;
      const rank = color === WHITE ? 0 : 0x70;
      const king = kings[color];
      if (king >> 4 !== rank >> 4) continue;
      const rook = ROOK | (color << 3);
      const up = ch.toUpperCase();
      let rf = -1;
      if (up === 'K' || up === 'Q') {
        // X-FEN: ο πιο εξωτερικός πύργος προς εκείνη την πλευρά του βασιλιά
        const step = up === 'K' ? 1 : -1;
        for (let sq = king + step; sq >= rank && sq <= rank + 7; sq += step) if (this.board[sq] === rook) rf = sq;
      } else if (up >= 'A' && up <= 'H') {
        const sq = rank | (up.charCodeAt(0) - 65);
        if (this.board[sq] === rook) rf = sq;
      }
      if (rf < 0) continue;
      const kingside = rf > king;
      const right = (color === WHITE ? 0 : 2) + (kingside ? 0 : 1);
      this.castling |= 1 << right;
      this.castleRook[right] = rf;
      if ((king & 7) !== 4 || (rf & 7) !== (kingside ? 7 : 0)) this.chess960 = true;
    }
    this.cmask.fill(15);
    for (const color of [WHITE, BLACK]) {
      const bits = color === WHITE ? 3 : 12;
      if (!(this.castling & bits)) continue;
      this.cmask[kings[color]] &= 15 & ~bits;
      for (const right of color === WHITE ? [0, 1] : [2, 3]) if (this.castling & (1 << right)) this.cmask[this.castleRook[right]] &= 15 & ~(1 << right);
    }
    const ep = parts[3] && parts[3] !== '-' ? parseSquare(parts[3]) : -1;
    this.ep = ep >= 0 && ((ep >> 4) === 2 || (ep >> 4) === 5) ? ep : -1;
    this.halfmove = Math.max(0, parseInt(parts[4] ?? '0', 10) || 0);
    this.fullmove = Math.max(1, parseInt(parts[5] ?? '1', 10) || 1);
    this.computeHash();
  }

  fen(): string {
    let s = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[rank * 16 + file];
        if (p === 0) {
          empty++;
          continue;
        }
        if (empty) {
          s += empty;
          empty = 0;
        }
        s += FEN_PIECES[p];
      }
      if (empty) s += empty;
      if (rank) s += '/';
    }
    s += this.turn === WHITE ? ' w ' : ' b ';
    let c = '';
    for (let right = 0; right < 4; right++) {
      if (!(this.castling & (1 << right))) continue;
      let ch = 'KQkq'[right];
      if (this.chess960) {
        // X-FEN: γράμμα στήλης όταν ο πύργος δεν είναι ο πιο εξωτερικός της πλευράς του
        const color = right >> 1;
        const rank = color ? 0x70 : 0;
        const rook = ROOK | (color << 3);
        const rf = this.castleRook[right];
        const step = (right & 1) === 0 ? 1 : -1;
        for (let sq = rf + step; sq >= rank && sq <= rank + 7; sq += step) if (this.board[sq] === rook) ch = String.fromCharCode((color ? 97 : 65) + (rf & 7));
      }
      c += ch;
    }
    s += (c || '-') + ' ';
    s += (this.ep >= 0 && this.epCapturable() ? squareName(this.ep) : '-') + ' ';
    s += this.halfmove + ' ' + this.fullmove;
    return s;
  }

  /** FEN χωρίς μετρητές κινήσεων (για σύγκριση θέσεων). */
  epd(): string {
    return this.fen().split(' ').slice(0, 4).join(' ');
  }

  /** Αν το ep είναι πρακτικά δυνατό (κανόνας Polyglot για το hash). */
  epCapturable(): boolean {
    const ep = this.ep;
    if (ep < 0) return false;
    const b = this.board;
    if (this.turn === WHITE) {
      const a = ep - 17;
      const c = ep - 15;
      return (!(a & 0x88) && b[a] === PAWN) || (!(c & 0x88) && b[c] === PAWN);
    }
    const a = ep + 17;
    const c = ep + 15;
    return (!(a & 0x88) && b[a] === (PAWN | BLACK_BIT)) || (!(c & 0x88) && b[c] === (PAWN | BLACK_BIT));
  }

  computeHash(): void {
    let hi = 0;
    let lo = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = this.board[sq];
      if (p) {
        hi ^= Z_PIECE_HI[p * 128 + sq];
        lo ^= Z_PIECE_LO[p * 128 + sq];
      }
    }
    hi ^= Z_CASTLE_HI[this.castling];
    lo ^= Z_CASTLE_LO[this.castling];
    if (this.epCapturable()) {
      hi ^= Z_EP_HI[this.ep & 7];
      lo ^= Z_EP_LO[this.ep & 7];
    }
    if (this.turn === BLACK) {
      hi ^= Z_SIDE_HI;
      lo ^= Z_SIDE_LO;
    }
    this.hashHi = hi;
    this.hashLo = lo;
  }

  hashKey(): string {
    return hashKey(this.hashHi, this.hashLo);
  }

  // -------------------------------------------------------------------------
  // Επιθέσεις

  isAttacked(sq: number, by: number): boolean {
    const b = this.board;
    const bit = by << 3;
    if (by === WHITE) {
      const a = sq - 15;
      const c = sq - 17;
      if ((!(a & 0x88) && b[a] === PAWN) || (!(c & 0x88) && b[c] === PAWN)) return true;
    } else {
      const a = sq + 15;
      const c = sq + 17;
      if ((!(a & 0x88) && b[a] === (PAWN | BLACK_BIT)) || (!(c & 0x88) && b[c] === (PAWN | BLACK_BIT))) return true;
    }
    const kn = KNIGHT | bit;
    for (let i = 0; i < 8; i++) {
      const t = sq + KNIGHT_OFFSETS[i];
      if (!(t & 0x88) && b[t] === kn) return true;
    }
    const kg = KING | bit;
    for (let i = 0; i < 8; i++) {
      const t = sq + KING_OFFSETS[i];
      if (!(t & 0x88) && b[t] === kg) return true;
    }
    const bq = BISHOP | bit;
    const rq = ROOK | bit;
    const qq = QUEEN | bit;
    for (let i = 0; i < 4; i++) {
      const off = DIAG_OFFSETS[i];
      let t = sq + off;
      while (!(t & 0x88)) {
        const p = b[t];
        if (p) {
          if (p === bq || p === qq) return true;
          break;
        }
        t += off;
      }
    }
    for (let i = 0; i < 4; i++) {
      const off = ORTH_OFFSETS[i];
      let t = sq + off;
      while (!(t & 0x88)) {
        const p = b[t];
        if (p) {
          if (p === rq || p === qq) return true;
          break;
        }
        t += off;
      }
    }
    return false;
  }

  inCheck(): boolean {
    return this.isAttacked(this.kingSq[this.turn], this.turn ^ 1);
  }

  /** Τετράγωνα των κομματιών που κάνουν σαχ στον παίκτη που παίζει. */
  checkers(): number[] {
    const out: number[] = [];
    const king = this.kingSq[this.turn];
    const by = this.turn ^ 1;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = this.board[sq];
      if (!p || p >> 3 !== by) continue;
      if (this.pieceAttacks(sq, king)) out.push(sq);
    }
    return out;
  }

  /** Αν το κομμάτι στο from «βλέπει» το to (ψευδο-νόμιμα, χωρίς καρφώματα). */
  pieceAttacks(from: number, to: number): boolean {
    const p = this.board[from];
    const t = p & 7;
    const diff = to - from;
    if (t === PAWN) {
      return p >> 3 === WHITE ? diff === 15 || diff === 17 : diff === -15 || diff === -17;
    }
    if (t === KNIGHT) return KNIGHT_OFFSETS.includes(diff);
    if (t === KING) return KING_OFFSETS.includes(diff);
    const offs = t === BISHOP ? DIAG_OFFSETS : t === ROOK ? ORTH_OFFSETS : KING_OFFSETS;
    for (const off of offs) {
      let s = from + off;
      while (!(s & 0x88)) {
        if (s === to) return true;
        if (this.board[s]) break;
        s += off;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Εκτέλεση / αναίρεση

  makeMove(m: number): void {
    if (this.sp + UNDO_SIZE > this.undo.length) {
      const n = new Int32Array(this.undo.length * 2);
      n.set(this.undo);
      this.undo = n;
    }
    const u = this.undo;
    let sp = this.sp;
    const b = this.board;
    const us = this.turn;
    let hi = this.hashHi;
    let lo = this.hashLo;

    u[sp] = m;
    u[sp + 2] = this.castling;
    u[sp + 3] = this.ep;
    u[sp + 4] = this.halfmove;
    u[sp + 5] = hi;
    u[sp + 6] = lo;

    // αφαίρεση παλιών κλειδιών ροκέ / ep / σειράς
    hi ^= Z_CASTLE_HI[this.castling];
    lo ^= Z_CASTLE_LO[this.castling];
    if (this.epCapturable()) {
      hi ^= Z_EP_HI[this.ep & 7];
      lo ^= Z_EP_LO[this.ep & 7];
    }
    hi ^= Z_SIDE_HI;
    lo ^= Z_SIDE_LO;

    if (m & F_NULL) {
      u[sp + 1] = 0;
      this.sp = sp + UNDO_SIZE;
      this.ep = -1;
      this.halfmove++;
      if (us === BLACK) this.fullmove++;
      this.turn = us ^ 1;
      hi ^= Z_CASTLE_HI[this.castling];
      lo ^= Z_CASTLE_LO[this.castling];
      this.hashHi = hi;
      this.hashLo = lo;
      return;
    }

    const from = m & 0x7f;
    const to = (m >> 7) & 0x7f;
    const piece = b[from];
    let captured = 0;

    if (m & F_CASTLE) {
      // πρώτα φεύγουν βασιλιάς και πύργος: στο Chess960 τα τετράγωνα μπορεί να επικαλύπτονται
      const rf = castleRookSquare(m);
      const rt = (to & 0x70) | ((to & 7) === 6 ? 5 : 3);
      const rook = b[rf];
      b[from] = 0;
      b[rf] = 0;
      b[to] = piece;
      b[rt] = rook;
      hi ^= Z_PIECE_HI[piece * 128 + from] ^ Z_PIECE_HI[piece * 128 + to] ^ Z_PIECE_HI[rook * 128 + rf] ^ Z_PIECE_HI[rook * 128 + rt];
      lo ^= Z_PIECE_LO[piece * 128 + from] ^ Z_PIECE_LO[piece * 128 + to] ^ Z_PIECE_LO[rook * 128 + rf] ^ Z_PIECE_LO[rook * 128 + rt];
      u[sp + 1] = 0;
      this.castling &= this.cmask[from] & this.cmask[rf];
    } else {
      captured = b[to];
      if (m & F_EP) {
        const capSq = us === WHITE ? to - 16 : to + 16;
        captured = b[capSq];
        b[capSq] = 0;
        hi ^= Z_PIECE_HI[captured * 128 + capSq];
        lo ^= Z_PIECE_LO[captured * 128 + capSq];
      } else if (captured) {
        hi ^= Z_PIECE_HI[captured * 128 + to];
        lo ^= Z_PIECE_LO[captured * 128 + to];
      }
      u[sp + 1] = captured;

      const promo = (m >> 14) & 7;
      const placed = promo ? promo | (us << 3) : piece;
      b[from] = 0;
      b[to] = placed;
      hi ^= Z_PIECE_HI[piece * 128 + from] ^ Z_PIECE_HI[placed * 128 + to];
      lo ^= Z_PIECE_LO[piece * 128 + from] ^ Z_PIECE_LO[placed * 128 + to];
      this.castling &= this.cmask[from] & this.cmask[to];
    }
    if ((piece & 7) === KING) this.kingSq[us] = to;

    this.ep = m & F_DOUBLE ? (from + to) >> 1 : -1;
    this.halfmove = (piece & 7) === PAWN || captured ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.turn = us ^ 1;

    hi ^= Z_CASTLE_HI[this.castling];
    lo ^= Z_CASTLE_LO[this.castling];
    if (this.ep >= 0 && this.epCapturable()) {
      hi ^= Z_EP_HI[this.ep & 7];
      lo ^= Z_EP_LO[this.ep & 7];
    }
    this.hashHi = hi;
    this.hashLo = lo;
    sp += UNDO_SIZE;
    this.sp = sp;
  }

  unmakeMove(): void {
    if (this.sp === 0) throw new Error('Δεν υπάρχει κίνηση για αναίρεση');
    const u = this.undo;
    const sp = (this.sp -= UNDO_SIZE);
    const m = u[sp];
    const captured = u[sp + 1];
    this.castling = u[sp + 2];
    this.ep = u[sp + 3];
    this.halfmove = u[sp + 4];
    this.hashHi = u[sp + 5];
    this.hashLo = u[sp + 6];
    const us = this.turn ^ 1;
    this.turn = us;
    if (us === BLACK) this.fullmove--;
    if (m & F_NULL) return;
    const b = this.board;
    const from = m & 0x7f;
    const to = (m >> 7) & 0x7f;
    if (m & F_CASTLE) {
      const rf = castleRookSquare(m);
      const rt = (to & 0x70) | ((to & 7) === 6 ? 5 : 3);
      const king = b[to];
      const rook = b[rt];
      b[to] = 0;
      b[rt] = 0;
      b[from] = king;
      b[rf] = rook;
      this.kingSq[us] = from;
      return;
    }
    let piece = b[to];
    if ((m >> 14) & 7) piece = PAWN | (us << 3);
    b[from] = piece;
    if (m & F_EP) {
      b[to] = 0;
      b[us === WHITE ? to - 16 : to + 16] = captured;
    } else {
      b[to] = captured;
    }
    if ((piece & 7) === KING) this.kingSq[us] = from;
  }

  /** Πλήθος κινήσεων στη στοίβα αναίρεσης. */
  get depth(): number {
    return this.sp / UNDO_SIZE;
  }

  /** Ξεχνά τη στοίβα αναίρεσης (η θέση μένει ίδια). */
  resetUndo(): void {
    this.sp = 0;
  }

  // -------------------------------------------------------------------------
  // Γεννήτρια κινήσεων

  /** Ψευδο-νόμιμες κινήσεις στο out από τη θέση start· επιστρέφει το νέο πλήθος. */
  generatePseudo(out: Int32Array, start = 0): number {
    let n = start;
    const b = this.board;
    const us = this.turn;
    const them = us ^ 1;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = b[sq];
      if (p === 0 || p >> 3 !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const dir = us === WHITE ? 16 : -16;
        const rank = sq >> 4;
        const promoRank = us === WHITE ? 6 : 1;
        const to1 = sq + dir;
        if (b[to1] === 0) {
          if (rank === promoRank) {
            for (let pr = QUEEN; pr >= KNIGHT; pr--) out[n++] = sq | (to1 << 7) | (pr << 14);
          } else {
            out[n++] = sq | (to1 << 7);
            const startRank = us === WHITE ? 1 : 6;
            if (rank === startRank && b[to1 + dir] === 0) out[n++] = sq | ((to1 + dir) << 7) | F_DOUBLE;
          }
        }
        for (let k = 0; k < 2; k++) {
          const to = to1 + (k ? 1 : -1);
          if (to & 0x88) continue;
          const q = b[to];
          if (q !== 0 && q >> 3 === them) {
            if (rank === promoRank) {
              for (let pr = QUEEN; pr >= KNIGHT; pr--) out[n++] = sq | (to << 7) | (pr << 14) | F_CAPTURE;
            } else {
              out[n++] = sq | (to << 7) | F_CAPTURE;
            }
          } else if (q === 0 && to === this.ep) {
            out[n++] = sq | (to << 7) | F_CAPTURE | F_EP;
          }
        }
      } else if (t === KNIGHT || t === KING) {
        const offs = t === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (let i = 0; i < 8; i++) {
          const to = sq + offs[i];
          if (to & 0x88) continue;
          const q = b[to];
          if (q === 0) out[n++] = sq | (to << 7);
          else if (q >> 3 === them) out[n++] = sq | (to << 7) | F_CAPTURE;
        }
      } else {
        const offs = t === BISHOP ? DIAG_OFFSETS : t === ROOK ? ORTH_OFFSETS : KING_OFFSETS;
        const len = offs.length;
        for (let i = 0; i < len; i++) {
          const off = offs[i];
          let to = sq + off;
          while (!(to & 0x88)) {
            const q = b[to];
            if (q === 0) {
              out[n++] = sq | (to << 7);
            } else {
              if (q >> 3 === them) out[n++] = sq | (to << 7) | F_CAPTURE;
              break;
            }
            to += off;
          }
        }
      }
    }
    // ροκέ (και Chess960): ο βασιλιάς πάει στο g/c, ο πύργος στο f/d
    if (this.castling & (us === WHITE ? 3 : 12)) {
      const kf = this.kingSq[us];
      const rank = us === WHITE ? 0 : 0x70;
      for (let side = 0; side < 2; side++) {
        const right = (us === WHITE ? 0 : 2) + side;
        if (!(this.castling & (1 << right))) continue;
        const rf = this.castleRook[right];
        if (b[rf] !== (ROOK | (us << 3)) || kf >> 4 !== rank >> 4) continue;
        const kt = rank | (side === 0 ? 6 : 2);
        const rt = rank | (side === 0 ? 5 : 3);
        // άδεια όλα τα τετράγωνα που διασχίζουν βασιλιάς και πύργος, εκτός από τα δικά τους
        let ok = true;
        for (let sq = Math.min(kf, kt, rf, rt), last = Math.max(kf, kt, rf, rt); sq <= last && ok; sq++) if (sq !== kf && sq !== rf && b[sq]) ok = false;
        // ο βασιλιάς δεν ξεκινά, δεν περνά και δεν καταλήγει σε απειλούμενο τετράγωνο
        for (let sq = kf, step = kt >= kf ? 1 : -1; ok; sq += step) {
          if (this.isAttacked(sq, them)) ok = false;
          if (sq === kt) break;
        }
        if (ok) out[n++] = this.castleCode(kf, side === 0);
      }
    }
    return n;
  }

  /** Αν η ψευδο-νόμιμη κίνηση αφήνει τον βασιλιά ασφαλή. */
  isLegalPseudo(m: number): boolean {
    const us = this.turn;
    this.makeMove(m);
    const ok = !this.isAttacked(this.kingSq[us], us ^ 1);
    this.unmakeMove();
    return ok;
  }

  /** Νόμιμες κινήσεις στο out· επιστρέφει πλήθος. */
  generateLegal(out: Int32Array): number {
    const tmp = new Int32Array(256);
    const n = this.generatePseudo(tmp, 0);
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (this.isLegalPseudo(tmp[i])) out[k++] = tmp[i];
    }
    return k;
  }

  legalMoves(): number[] {
    const out = new Int32Array(256);
    const n = this.generateLegal(out);
    return Array.from(out.subarray(0, n));
  }

  hasLegalMove(): boolean {
    const tmp = new Int32Array(256);
    const n = this.generatePseudo(tmp, 0);
    for (let i = 0; i < n; i++) if (this.isLegalPseudo(tmp[i])) return true;
    return false;
  }

  isCheckmate(): boolean {
    return this.inCheck() && !this.hasLegalMove();
  }

  isStalemate(): boolean {
    return !this.inCheck() && !this.hasLegalMove();
  }

  /** Ανεπαρκές υλικό για ματ (K vs K, K+N/B vs K, K+B vs K+B ίδιου χρώματος). */
  insufficientMaterial(): boolean {
    let minors = 0;
    const bishopColors: number[] = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const t = this.board[sq] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === BISHOP) bishopColors.push(((sq >> 4) + (sq & 7)) & 1);
    }
    if (minors <= 1) return true;
    return bishopColors.length === minors && bishopColors.every((c) => c === bishopColors[0]);
  }

  status(): GameStatus {
    if (!this.hasLegalMove()) return this.inCheck() ? 'checkmate' : 'stalemate';
    if (this.insufficientMaterial()) return 'insufficient';
    if (this.halfmove >= 100) return 'fifty';
    return 'ongoing';
  }

  perft(depth: number): number {
    if (depth === 0) return 1;
    const moves = new Int32Array(256);
    const n = this.generatePseudo(moves, 0);
    let total = 0;
    const us = this.turn;
    for (let i = 0; i < n; i++) {
      this.makeMove(moves[i]);
      if (!this.isAttacked(this.kingSq[us], us ^ 1)) total += depth === 1 ? 1 : this.perft(depth - 1);
      this.unmakeMove();
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Δημιουργία κίνησης από τετράγωνα (UI, UCI, κωδικοποίηση βάσης)

  /** Φτιάχνει τον κωδικό κίνησης from→to με τις σωστές σημαίες (χωρίς έλεγχο νομιμότητας). */
  buildMove(from: number, to: number, promo = 0): number {
    const b = this.board;
    const p = b[from];
    const t = p & 7;
    let flags = 0;
    if (b[to] !== 0) flags |= F_CAPTURE;
    if (t === PAWN) {
      if (to === this.ep && b[to] === 0 && ((to - from) & 15) !== 0) flags |= F_CAPTURE | F_EP;
      if (to - from === 32 || from - to === 32) flags |= F_DOUBLE;
      const lastRank = p >> 3 === WHITE ? 7 : 0;
      if (to >> 4 === lastRank && !promo) promo = QUEEN;
      if (to >> 4 !== lastRank) promo = 0;
    } else {
      promo = 0;
    }
    // ροκέ: «βασιλιάς πάνω στον πύργο» (ChessBase / Chess960) ή κλασικό «δύο τετράγωνα»
    if (t === KING && (b[to] === (ROOK | (p & BLACK_BIT)) || to - from === 2 || from - to === 2)) return this.castleCode(from, to > from);
    return from | (to << 7) | (promo << 14) | flags;
  }

  /** Κωδικός ροκέ του βασιλιά from προς μία πλευρά, με τον πύργο του δικαιώματος (κλασικό ή Chess960). */
  private castleCode(from: number, kingside: boolean): number {
    const right = (this.board[from] >> 3 === WHITE ? 0 : 2) + (kingside ? 0 : 1);
    const rf = this.castleRook[right];
    let m = from | (((from & 0x70) | (kingside ? 6 : 2)) << 7) | F_CASTLE;
    if ((from & 7) !== 4 || (rf & 7) !== (kingside ? 7 : 0)) m |= F_C960 | ((rf & 7) << 23);
    return m;
  }

  /** Επιστρέφει τη νόμιμη κίνηση from→to (με προαγωγή) ή 0. */
  findMove(from: number, to: number, promo = 0): number {
    const moves = this.legalMoves();
    // ροκέ «βασιλιάς πάνω στον πύργο» (μορφή ChessBase / Chess960)
    const p = this.board[from];
    if ((p & 7) === KING && this.board[to] === (ROOK | (p & BLACK_BIT))) {
      for (const m of moves) if (m & F_CASTLE && (m & 0x7f) === from && castleRookSquare(m) === to) return m;
      return 0;
    }
    for (const m of moves) {
      if ((m & 0x7f) !== from || ((m >> 7) & 0x7f) !== to) continue;
      const mp = (m >> 14) & 7;
      if (mp && mp !== (promo || QUEEN)) continue;
      return m;
    }
    return 0;
  }

  parseUci(s: string): number {
    if (s === '0000') return this.inCheck() ? 0 : NULL_MOVE;
    const from = parseSquare(s, 0);
    const to = parseSquare(s, 2);
    if (from < 0 || to < 0) return 0;
    const pr = s.length > 4 ? ' pnbrqk'.indexOf(s[4].toLowerCase()) : 0;
    return this.findMove(from, to, pr > 0 ? pr : 0);
  }

  moveToUci(m: number): string {
    if (m & F_NULL) return '0000';
    // Chess960 (UCI_Chess960): το ροκέ ως «βασιλιάς πάνω στον πύργο»
    if (m & F_CASTLE && (this.chess960 || m & F_C960)) return squareName(m & 0x7f) + squareName(castleRookSquare(m));
    const pr = (m >> 14) & 7;
    return squareName(m & 0x7f) + squareName((m >> 7) & 0x7f) + (pr ? ' pnbrqk'[pr] : '');
  }

  // -------------------------------------------------------------------------
  // SAN

  /** Από ποια τετράγωνα μπορεί κομμάτι τύπου t του παίκτη να πάει στο to (ψευδο-νόμιμα). */
  private sources(t: number, to: number, out: number[]): void {
    const b = this.board;
    const want = t | (this.turn << 3);
    if (t === KNIGHT || t === KING) {
      const offs = t === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
      for (let i = 0; i < 8; i++) {
        const s = to + offs[i];
        if (!(s & 0x88) && b[s] === want) out.push(s);
      }
      return;
    }
    const offs = t === BISHOP ? DIAG_OFFSETS : t === ROOK ? ORTH_OFFSETS : KING_OFFSETS;
    for (let i = 0; i < offs.length; i++) {
      const off = offs[i];
      let s = to + off;
      while (!(s & 0x88)) {
        const p = b[s];
        if (p) {
          if (p === want) out.push(s);
          break;
        }
        s += off;
      }
    }
  }

  san(m: number): string {
    if (m & F_NULL) return '--';
    const from = m & 0x7f;
    const to = (m >> 7) & 0x7f;
    const t = this.board[from] & 7;
    let s: string;
    if (m & F_CASTLE) {
      s = (to & 7) === 6 ? 'O-O' : 'O-O-O';
    } else if (t === PAWN) {
      s = m & F_CAPTURE ? FILES[from & 7] + 'x' + squareName(to) : squareName(to);
      const pr = (m >> 14) & 7;
      if (pr) s += '=' + PIECE_LETTERS[pr];
    } else {
      s = PIECE_LETTERS[t];
      const src: number[] = [];
      this.sources(t, to, src);
      let ambiguous = false;
      let sameFile = false;
      let sameRank = false;
      for (const o of src) {
        if (o === from) continue;
        const om = this.buildMove(o, to);
        if (!this.isLegalPseudo(om)) continue;
        ambiguous = true;
        if ((o & 7) === (from & 7)) sameFile = true;
        if (o >> 4 === from >> 4) sameRank = true;
      }
      if (ambiguous) {
        if (!sameFile) s += FILES[from & 7];
        else if (!sameRank) s += String((from >> 4) + 1);
        else s += squareName(from);
      }
      if (m & F_CAPTURE) s += 'x';
      s += squareName(to);
    }
    this.makeMove(m);
    if (this.inCheck()) s += this.hasLegalMove() ? '+' : '#';
    this.unmakeMove();
    return s;
  }

  /**
   * Διαβάζει κίνηση SAN (ανεκτικά: «Nf3», «Ng1f3», «exd6e.p.», «e8=Q», «e8Q»,
   * «0-0», «--»). Επιστρέφει τον κωδικό της νόμιμης κίνησης ή 0.
   */
  parseSan(input: string): number {
    let s = input;
    let end = s.length;
    while (end > 0) {
      const c = s.charCodeAt(end - 1);
      // + # ! ?
      if (c === 43 || c === 35 || c === 33 || c === 63) end--;
      else break;
    }
    if (end !== s.length) s = s.slice(0, end);
    if (s.length < 2) return 0;
    const c0 = s.charCodeAt(0);
    if (c0 === 79 || c0 === 48) {
      // O-O / 0-0
      const norm = s.replace(/0/g, 'O').replace(/-/g, '');
      if (norm === 'OO' || norm === 'OOO') return this.castleMove(norm.length === 3);
    }
    if (s === '--' || s === 'Z0' || s === '@@@@' || s === '0000') return this.inCheck() ? 0 : NULL_MOVE;
    if (s.endsWith('e.p.')) s = s.slice(0, -4);
    else if (s.endsWith('ep')) s = s.slice(0, -2);

    let type = PAWN;
    let i = 0;
    if (c0 >= 65 && c0 <= 90) {
      const idx = 'PNBRQK'.indexOf(s[0]);
      if (idx < 0) return 0;
      type = idx + 1;
      i = 1;
    }
    let promo = 0;
    if (type === PAWN) {
      // προαγωγή: «e8=Q», «e8Q», «e8(Q)», «e8/Q» (και με πεζά)
      const last = s.charCodeAt(s.length - 1);
      if (last > 57) {
        const pm = /^(.*[18])[=/(]?([NBRQnbrq])\)?$/.exec(s);
        if (!pm) return 0;
        promo = 'NBRQ'.indexOf(pm[2].toUpperCase()) + 2;
        s = pm[1];
      }
    }
    const j = s.length;
    if (j - i < 2) return 0;
    const to = parseSquare(s, j - 2);
    if (to < 0) return 0;
    let fromFile = -1;
    let fromRank = -1;
    for (let k = i; k < j - 2; k++) {
      const c = s.charCodeAt(k);
      if (c >= 97 && c <= 104) fromFile = c - 97;
      else if (c >= 49 && c <= 56) fromRank = c - 49;
      // 'x', '-', ':' αγνοούνται
    }
    const b = this.board;
    const us = this.turn;
    if (type === PAWN) {
      const dir = us === WHITE ? 16 : -16;
      const lastRank = us === WHITE ? 7 : 0;
      if (to >> 4 === lastRank && !promo) promo = QUEEN;
      if (to >> 4 !== lastRank) promo = 0;
      let from = -1;
      if (fromFile >= 0 && fromFile !== (to & 7)) {
        from = to - dir + (fromFile - (to & 7));
        if (from & 0x88 || b[from] !== (PAWN | (us << 3))) return 0;
        const capture = b[to] !== 0 ? b[to] >> 3 === (us ^ 1) : to === this.ep;
        if (!capture) return 0;
      } else {
        const one = to - dir;
        if (one & 0x88) return 0;
        if (b[one] === (PAWN | (us << 3))) from = one;
        else if (b[one] === 0) {
          const two = one - dir;
          if (!(two & 0x88) && b[two] === (PAWN | (us << 3)) && (two >> 4) === (us === WHITE ? 1 : 6)) from = two;
        }
        if (from < 0 || b[to] !== 0) return 0;
      }
      const m = this.buildMove(from, to, promo);
      return this.isLegalPseudo(m) ? m : 0;
    }
    if (b[to] !== 0 && b[to] >> 3 === us) return 0;
    const src: number[] = [];
    this.sources(type, to, src);
    let found = 0;
    for (const from of src) {
      if (fromFile >= 0 && (from & 7) !== fromFile) continue;
      if (fromRank >= 0 && from >> 4 !== fromRank) continue;
      const m = this.buildMove(from, to);
      if (type === KING && m & F_CASTLE) continue;
      if (!this.isLegalPseudo(m)) continue;
      if (found) return found; // αμφίσημο: κρατάμε την πρώτη (όπως πολλά προγράμματα)
      found = m;
    }
    if (!found && type === KING) {
      // «Kg1» ως ροκέ σε παλιά PGN
      const king = this.kingSq[us];
      if (king === (us === WHITE ? 4 : 0x74) && (to === king + 2 || to === king - 2)) return this.castleMove(to < king);
    }
    return found;
  }

  private castleMove(long: boolean): number {
    const target = (this.kingSq[this.turn] & 0x70) | (long ? 2 : 6);
    const moves = new Int32Array(256);
    const n = this.generatePseudo(moves, 0);
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if (m & F_CASTLE && ((m >> 7) & 0x7f) === target) return this.isLegalPseudo(m) ? m : 0;
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // Βοηθητικά

  pieceAt(sq: number): number {
    return this.board[sq];
  }

  /** Υλικό ως string, π.χ. «KQRRBBNNPPPPPPPP/kqrrbbnnpppppppp» (για αναζήτηση υλικού). */
  materialKey(): string {
    const counts = new Int32Array(16);
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      counts[this.board[sq]]++;
    }
    let w = '';
    let bl = '';
    for (const t of [KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN]) {
      w += PIECE_LETTERS[t].repeat(counts[t]);
      bl += PIECE_LETTERS[t].toLowerCase().repeat(counts[t | BLACK_BIT]);
    }
    return w + '/' + bl;
  }
}

/** Αρχική θέση Chess960 με αριθμό n (0–959, αρίθμηση Scharnagl· 518 = η κλασική). */
export function chess960Fen(n: number): string {
  const r: string[] = new Array(8).fill('');
  const empty = () => r.flatMap((x, i) => (x ? [] : [i]));
  r[(n % 4) * 2 + 1] = 'B';
  n = Math.floor(n / 4);
  r[(n % 4) * 2] = 'B';
  n = Math.floor(n / 4);
  r[empty()[n % 6]] = 'Q';
  n = Math.floor(n / 6);
  const kn = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]][n % 10];
  const e = empty();
  r[e[kn[0]]] = 'N';
  r[e[kn[1]]] = 'N';
  const rest = empty();
  r[rest[0]] = 'R';
  r[rest[1]] = 'K';
  r[rest[2]] = 'R';
  const white = r.join('');
  return `${white.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${white} w KQkq - 0 1`;
}

/** Εκτελεί κινήσεις SAN από μια θέση· επιστρέφει τη νέα θέση (ή πετά σφάλμα). */
export function playSan(fen: string, sans: string[]): Position {
  const p = Position.fromFen(fen);
  for (const s of sans) {
    const m = p.parseSan(s);
    if (!m) throw new Error(`Άκυρη κίνηση: ${s}`);
    p.makeMove(m);
  }
  return p;
}
