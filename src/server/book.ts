/**
 * Βιβλία ανοιγμάτων Polyglot (.bin): κλειδί θέσης (Zobrist Polyglot) και
 * ανάγνωση κινήσεων με βάρη. Μορφή: εγγραφές 16 bytes ταξινομημένες κατά κλειδί.
 */
import fs from 'node:fs';
import { F_CASTLE, Position, WHITE, castleRookSquare } from '../core/chess.ts';

const RANDOM: bigint[] = (JSON.parse(fs.readFileSync(new URL('../data/polyglot-random.json', import.meta.url), 'utf8')) as string[]).map((h) => BigInt('0x' + h));

export function polyglotKey(pos: Position): bigint {
  let k = 0n;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = pos.board[sq];
    if (!p) continue;
    const kind = ((p & 7) - 1) * 2 + (p & 8 ? 0 : 1);
    k ^= RANDOM[64 * kind + 8 * (sq >> 4) + (sq & 7)];
  }
  if (pos.castling & 1) k ^= RANDOM[768];
  if (pos.castling & 2) k ^= RANDOM[769];
  if (pos.castling & 4) k ^= RANDOM[770];
  if (pos.castling & 8) k ^= RANDOM[771];
  if (pos.ep >= 0 && pos.epCapturable()) k ^= RANDOM[772 + (pos.ep & 7)];
  if (pos.turn === WHITE) k ^= RANDOM[780];
  return k;
}

export interface BookMove {
  uci: string;
  san: string;
  weight: number;
  pct: number;
}

export function bookMoves(file: string, fen: string): BookMove[] {
  const pos = Position.fromFen(fen);
  const key = polyglotKey(pos);
  const fd = fs.openSync(file, 'r');
  try {
    const n = Math.floor(fs.fstatSync(fd).size / 16);
    const buf = Buffer.allocUnsafe(16);
    const keyAt = (i: number) => {
      fs.readSync(fd, buf, 0, 16, i * 16);
      return buf.readBigUInt64BE(0);
    };
    let a = 0;
    let b = n;
    while (a < b) {
      const m = Math.floor((a + b) / 2);
      if (keyAt(m) < key) a = m + 1;
      else b = m;
    }
    const raw: Array<{ move: number; weight: number }> = [];
    for (let i = a; i < n && raw.length < 64; i++) {
      if (keyAt(i) !== key) break;
      raw.push({ move: buf.readUInt16BE(8), weight: buf.readUInt16BE(10) });
    }
    const total = raw.reduce((s, r) => s + r.weight, 0) || 1;
    const out: BookMove[] = [];
    for (const r of raw) {
      const m = r.move;
      const files = 'abcdefgh';
      const promo = ' nbrq'[(m >> 12) & 7]?.trim() ?? '';
      const uci = `${files[(m >> 6) & 7]}${((m >> 9) & 7) + 1}${files[m & 7]}${((m >> 3) & 7) + 1}${promo}`;
      const mv = pos.parseUci(uci);
      if (!mv) continue;
      out.push({ uci: pos.moveToUci(mv), san: pos.san(mv), weight: r.weight, pct: r.weight / total });
    }
    return out.sort((x, y) => y.weight - x.weight);
  } finally {
    fs.closeSync(fd);
  }
}

/** Κίνηση σε μορφή Polyglot: to/from (στήλη, γραμμή), προαγωγή 1–4 (N B R Q), ροκέ ως «βασιλιάς πάνω στον πύργο». */
export function polyglotMove(m: number): number {
  const from = m & 0x7f;
  let to = (m >> 7) & 0x7f;
  if (m & F_CASTLE) to = castleRookSquare(m);
  const pr = (m >> 14) & 7;
  return (to & 7) | ((to >> 4) << 3) | ((from & 7) << 6) | ((from >> 4) << 9) | ((pr ? pr - 1 : 0) << 12);
}

/**
 * Γράφει βιβλίο Polyglot. Τα βάρη κάθε θέσης κλιμακώνονται ώστε να χωρούν σε 16 bit
 * (ελάχιστο 1)· εγγραφές ταξινομημένες κατά κλειδί και φθίνον βάρος.
 */
export function writeBook(file: string, entries: Array<{ key: bigint; move: number; weight: number }>): number {
  const max = new Map<bigint, number>();
  for (const e of entries) max.set(e.key, Math.max(max.get(e.key) ?? 0, e.weight));
  const out = entries.map((e) => {
    const m = max.get(e.key)!;
    return { key: e.key, move: e.move, weight: Math.max(1, Math.round(m > 0xffff ? (e.weight * 0xffff) / m : e.weight)) };
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : b.weight - a.weight));
  const buf = Buffer.alloc(out.length * 16);
  out.forEach((e, i) => {
    buf.writeBigUInt64BE(e.key, i * 16);
    buf.writeUInt16BE(e.move, i * 16 + 8);
    buf.writeUInt16BE(e.weight, i * 16 + 10);
  });
  fs.writeFileSync(file, buf);
  return out.length;
}
