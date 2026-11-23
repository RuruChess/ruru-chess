/**
 * Ανάγνωση βάσεων ChessBase (κλασική μορφή .cbh / .cbg / .cba / .cbp / .cbt / .cbc / .cbs).
 *
 * Η μορφή τεκμηριώνεται ανοιχτά (MIT): Dominik Klein, «cbh2pgn» και
 * itshak, «cbvault» (docs/format-spec.md). Εδώ υπάρχει ανεξάρτητη υλοποίηση σε
 * TypeScript που παράγει τα tokens του Ruru (βλ. core/codec.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BLACK, KING, NULL_MOVE, PAWN, Position, ROOK, START_FEN, squareName } from '../../core/chess.ts';
import { TK_COMMENT, TK_NAG, TK_PRE, TK_VEND, TK_VSTART, GF_COMMENTS, GF_NAGS, GF_SETUP, GF_SHAPES, GF_VARIATIONS, GF_ERROR, moveToToken } from '../../core/codec.ts';
import { medalsToText } from '../../core/medals.ts';

// ---------------------------------------------------------------------------
// Αρχεία με τυχαία πρόσβαση (μικρά: ολόκληρα στη μνήμη, μεγάλα: ανάγνωση κατά απαίτηση)

const WHOLE_FILE_LIMIT = 256 * 1024 * 1024;

class RandomFile {
  readonly file: string;
  readonly size: number;
  private buf: Buffer | null = null;
  private fd: number | null = null;

  constructor(file: string) {
    this.file = file;
    this.size = fs.statSync(file).size;
    if (this.size <= WHOLE_FILE_LIMIT) this.buf = fs.readFileSync(file);
    else this.fd = fs.openSync(file, 'r');
  }

  read(offset: number, length: number): Buffer {
    if (offset < 0 || offset >= this.size) return Buffer.alloc(0);
    const len = Math.min(length, this.size - offset);
    if (this.buf) return this.buf.subarray(offset, offset + len);
    const out = Buffer.allocUnsafe(len);
    fs.readSync(this.fd!, out, 0, len, offset);
    return out;
  }

  close(): void {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
    this.buf = null;
  }
}

// ---------------------------------------------------------------------------
// Κωδικοποιήσεις κειμένου

const DEC_UTF8 = new TextDecoder('utf-8', { fatal: true });
const DEC_1252 = new TextDecoder('windows-1252');
const DEC_1253 = new TextDecoder('windows-1253');

/**
 * Κείμενο ChessBase: UTF-8 αν είναι έγκυρο, αλλιώς Windows-1253 (ελληνικά) ή
 * 1252 (δυτικά). Τα ελληνικά έχουν συνήθως τα περισσότερα γράμματα πάνω από 0x80.
 */
export function decodeCbText(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  const b = bytes.subarray(0, end);
  let high = 0;
  let letters = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x80) high++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) letters++;
  }
  if (!high) return String.fromCharCode(...b).trim();
  try {
    return DEC_UTF8.decode(b).trim();
  } catch {
    // όχι UTF-8
  }
  const greek = high >= letters * 0.5;
  return (greek ? DEC_1253 : DEC_1252).decode(b).trim();
}

// ---------------------------------------------------------------------------
// Αρχεία οντοτήτων (παίκτες, τουρνουά, σχολιαστές, πηγές)

const ENTITY_MAGIC = 1234567890;
const ENTITY_DELETED = -999;

class EntityFile {
  private header = 28;
  private record = 0;
  count = 0;
  private cache = new Map<number, Buffer | null>();
  private f: RandomFile | null;

  constructor(f: RandomFile | null) {
    this.f = f;
    if (!f || f.size < 28) {
      this.f = null;
      return;
    }
    const h = f.read(0, 28);
    if (h.readInt32LE(8) !== ENTITY_MAGIC) {
      this.f = null;
      return;
    }
    const data = h.readInt32LE(12);
    const extra = h.readInt32LE(0x18);
    this.header = 28 + (extra === 4 ? 4 : 0);
    this.record = 9 + data;
    this.count = Math.max(0, Math.floor((f.size - this.header) / this.record));
  }

  data(id: number): Buffer | null {
    if (!this.f || id < 0 || id >= this.count) return null;
    const c = this.cache.get(id);
    if (c !== undefined) return c;
    const r = this.f.read(this.header + id * this.record, this.record);
    const out = r.length === this.record && r.readInt32LE(0) !== ENTITY_DELETED ? Buffer.from(r.subarray(9)) : null;
    if (this.cache.size > 200000) this.cache.clear();
    this.cache.set(id, out);
    return out;
  }
}

export interface CbTournament {
  title: string;
  place: string;
  date: number;
}

// ---------------------------------------------------------------------------
// Κεφαλίδες παρτίδων (.cbh)

export interface CbhRecord {
  id: number;
  kind: 'game' | 'text' | 'unknown';
  deleted: boolean;
  gameOffset: number;
  annoOffset: number;
  white: number;
  black: number;
  tournament: number;
  annotator: number;
  source: number;
  date: number;
  result: number;
  lineEval: number;
  round: number;
  subround: number;
  whiteElo: number;
  blackElo: number;
  eco: string;
  ecoSub: number;
  medals: number;
  moveCount: number;
}

const RESULTS = ['0-1', '1/2-1/2', '1-0', '*', '0-1', '1/2-1/2', '1-0', '0-0'];

export function packedDateToPgn(d: number): string {
  const y = (d >> 9) & 0xfff;
  const m = (d >> 5) & 15;
  const day = d & 31;
  return `${y ? String(y).padStart(4, '0') : '????'}.${m ? String(m).padStart(2, '0') : '??'}.${day ? String(day).padStart(2, '0') : '??'}`;
}

function ecoFromField(v: number): { eco: string; sub: number } {
  if (v < 128 || v > 64127) return { eco: '', sub: 0 };
  const code = Math.floor(v / 128) - 1;
  if (code < 0 || code >= 500) return { eco: '', sub: 0 };
  return { eco: 'ABCDE'[Math.floor(code / 100)] + String(code % 100).padStart(2, '0'), sub: v % 128 };
}

// ---------------------------------------------------------------------------
// Πίνακες κωδικοποίησης κινήσεων (.cbg)

/** [τύπος CB, αριθμός κομματιού, dx, dy] ανά byte (μετά την αφαίρεση του μετρητή). */
const ONE_BYTE: Array<[number, number, number, number] | undefined> = new Array(256);
// τύποι CB: 1 Q, 2 N, 3 B, 4 R, 9 K, 11 P (χρώμα από τη σειρά)
const CB_Q = 1;
const CB_N = 2;
const CB_B = 3;
const CB_R = 4;
const CB_K = 9;
const CB_P = 11;
function defTable(type: number, nr: number, entries: Record<number, [number, number]>): void {
  for (const [k, [dx, dy]] of Object.entries(entries)) ONE_BYTE[Number(k)] = [type, nr, dx, dy];
}
defTable(CB_K, 0, { 0x49: [0, 1], 0x39: [1, 1], 0xd8: [1, 0], 0x5d: [1, 7], 0xc2: [0, 7], 0xb1: [7, 7], 0xb2: [7, 0], 0x47: [7, 1], 0x76: [2, 0], 0xb5: [-2, 0] });
defTable(CB_Q, 0, { 0xa5: [0, 1], 0xb8: [0, 2], 0xcb: [0, 3], 0x53: [0, 4], 0x7f: [0, 5], 0x6b: [0, 6], 0x8d: [0, 7], 0x79: [1, 0], 0xbe: [2, 0], 0xeb: [3, 0], 0x21: [4, 0], 0x99: [5, 0], 0xd2: [6, 0], 0x57: [7, 0], 0x4d: [1, 1], 0xb4: [2, 2], 0xbf: [3, 3], 0x62: [4, 4], 0xbd: [5, 5], 0x24: [6, 6], 0x96: [7, 7], 0xa7: [1, 7], 0x48: [2, 6], 0x28: [3, 5], 0x6e: [4, 4], 0x2f: [5, 3], 0x5a: [6, 2], 0x18: [7, 1] });
defTable(CB_Q, 1, { 0xe5: [0, 1], 0x94: [0, 2], 0x50: [0, 3], 0x11: [0, 4], 0xea: [0, 5], 0x31: [0, 6], 0x01: [0, 7], 0x5c: [1, 0], 0x95: [2, 0], 0xca: [3, 0], 0xd3: [4, 0], 0x1d: [5, 0], 0x7e: [6, 0], 0xef: [7, 0], 0x44: [1, 1], 0x80: [2, 2], 0xa0: [3, 3], 0x1f: [4, 4], 0x83: [5, 5], 0x00: [6, 6], 0x4b: [7, 7], 0x67: [1, 7], 0x20: [2, 6], 0x5b: [3, 5], 0x2a: [4, 4], 0x92: [5, 3], 0xb6: [6, 2], 0x60: [7, 1] });
defTable(CB_Q, 2, { 0x1a: [0, 1], 0x42: [0, 2], 0x0f: [0, 3], 0x0d: [0, 4], 0xb0: [0, 5], 0xd1: [0, 6], 0x23: [0, 7], 0xf0: [1, 0], 0x7a: [2, 0], 0x54: [3, 0], 0x4f: [4, 0], 0xf4: [5, 0], 0xa8: [6, 0], 0x72: [7, 0], 0xe7: [1, 1], 0x40: [2, 2], 0x38: [3, 3], 0x59: [4, 4], 0x87: [5, 5], 0xe8: [6, 6], 0x6c: [7, 7], 0x86: [1, 7], 0x04: [2, 6], 0xf1: [3, 5], 0x8c: [4, 4], 0xce: [5, 3], 0x6a: [6, 2], 0xdb: [7, 1] });
defTable(CB_R, 0, { 0x4e: [0, 1], 0xf8: [0, 2], 0x43: [0, 3], 0xd7: [0, 4], 0x63: [0, 5], 0x9c: [0, 6], 0xe6: [0, 7], 0x2e: [1, 0], 0xc6: [2, 0], 0x26: [3, 0], 0x88: [4, 0], 0x30: [5, 0], 0x61: [6, 0], 0x6f: [7, 0] });
defTable(CB_R, 1, { 0x14: [0, 1], 0xa9: [0, 2], 0x68: [0, 3], 0xee: [0, 4], 0xfb: [0, 5], 0x77: [0, 6], 0xe2: [0, 7], 0xa6: [1, 0], 0x05: [2, 0], 0x8b: [3, 0], 0xa1: [4, 0], 0x98: [5, 0], 0x32: [6, 0], 0x52: [7, 0] });
defTable(CB_R, 2, { 0x81: [0, 1], 0x82: [0, 2], 0x9a: [0, 3], 0x1b: [0, 4], 0x9d: [0, 5], 0x0a: [0, 6], 0x2b: [0, 7], 0x8f: [1, 0], 0xcd: [2, 0], 0xed: [3, 0], 0x10: [4, 0], 0x74: [5, 0], 0x69: [6, 0], 0xd6: [7, 0] });
defTable(CB_B, 0, { 0x02: [1, 1], 0x97: [2, 2], 0xe1: [3, 3], 0x41: [4, 4], 0xc3: [5, 5], 0x7c: [6, 6], 0xe4: [7, 7], 0x06: [1, 7], 0xb7: [2, 6], 0x55: [3, 5], 0xd9: [4, 4], 0x2c: [5, 3], 0xae: [6, 2], 0x37: [7, 1] });
defTable(CB_B, 1, { 0xf6: [1, 1], 0x3f: [2, 2], 0x08: [3, 3], 0x93: [4, 4], 0x73: [5, 5], 0x5e: [6, 6], 0x78: [7, 7], 0x35: [1, 7], 0xf2: [2, 6], 0x6d: [3, 5], 0x71: [4, 4], 0xa2: [5, 3], 0xf3: [6, 2], 0x16: [7, 1] });
defTable(CB_B, 2, { 0x51: [1, 1], 0xb9: [2, 2], 0x45: [3, 3], 0x3b: [4, 4], 0x56: [5, 5], 0x91: [6, 6], 0xfd: [7, 7], 0xab: [1, 7], 0x66: [2, 6], 0x3e: [3, 5], 0x46: [4, 4], 0xb3: [5, 3], 0xfc: [6, 2], 0xc8: [7, 1] });
defTable(CB_N, 0, { 0x58: [2, 1], 0x3d: [1, 2], 0xfa: [-1, 2], 0xe9: [-2, 1], 0xba: [-2, -1], 0xd4: [-1, -2], 0xdd: [1, -2], 0x4a: [2, -1] });
defTable(CB_N, 1, { 0xc4: [2, 1], 0x0e: [1, 2], 0xfe: [-1, 2], 0x5f: [-2, 1], 0x75: [-2, -1], 0x07: [-1, -2], 0x89: [1, -2], 0x34: [2, -1] });
defTable(CB_N, 2, { 0x9b: [2, 1], 0xc0: [1, 2], 0xe3: [-1, 2], 0xa3: [-2, 1], 0xac: [-2, -1], 0xc9: [-1, -2], 0xec: [1, -2], 0x27: [2, -1] });
const PAWN_TABLES: Array<Record<number, [number, number]>> = [
  { 0x2d: [0, 1], 0xc1: [0, 2], 0x8e: [1, 1], 0xf5: [-1, 1] },
  { 0x64: [0, 1], 0x17: [0, 2], 0x70: [1, 1], 0xa4: [-1, 1] },
  { 0x7b: [0, 1], 0xda: [0, 2], 0xe0: [1, 1], 0x85: [-1, 1] },
  { 0xc5: [0, 1], 0x0b: [0, 2], 0x90: [1, 1], 0xf9: [-1, 1] },
  { 0x84: [0, 1], 0xff: [0, 2], 0x15: [1, 1], 0x36: [-1, 1] },
  { 0x09: [0, 1], 0x9e: [0, 2], 0x7d: [1, 1], 0xde: [-1, 1] },
  { 0xbb: [0, 1], 0xdf: [0, 2], 0xbc: [1, 1], 0x3a: [-1, 1] },
  { 0x12: [0, 1], 0x33: [0, 2], 0x13: [1, 1], 0x19: [-1, 1] },
];
PAWN_TABLES.forEach((t, nr) => defTable(CB_P, nr, t));

const DEOBFUSCATE_2B = [
  0xa2, 0x95, 0x43, 0xf5, 0xc1, 0x3d, 0x4a, 0x6c, 0x53, 0x83, 0xcc, 0x7c, 0xff, 0xae, 0x68, 0xad,
  0xd1, 0x92, 0x8b, 0x8d, 0x35, 0x81, 0x5e, 0x74, 0x26, 0x8e, 0xab, 0xca, 0xfd, 0x9a, 0xf3, 0xa0,
  0xa5, 0x15, 0xfc, 0xb1, 0x1e, 0xed, 0x30, 0xea, 0x22, 0xeb, 0xa7, 0xcd, 0x4e, 0x6f, 0x2e, 0x24,
  0x32, 0x94, 0x41, 0x8c, 0x6e, 0x58, 0x82, 0x50, 0xbb, 0x02, 0x8a, 0xd8, 0xfa, 0x60, 0xde, 0x52,
  0xba, 0x46, 0xac, 0x29, 0x9d, 0xd7, 0xdf, 0x08, 0x21, 0x01, 0x66, 0xa3, 0xf1, 0x19, 0x27, 0xb5,
  0x91, 0xd5, 0x42, 0x0e, 0xb4, 0x4c, 0xd9, 0x18, 0x5f, 0xbc, 0x25, 0xa6, 0x96, 0x04, 0x56, 0x6a,
  0xaa, 0x33, 0x1c, 0x2b, 0x73, 0xf0, 0xdd, 0xa4, 0x37, 0xd3, 0xc5, 0x10, 0xbf, 0x5a, 0x23, 0x34,
  0x75, 0x5b, 0xb8, 0x55, 0xd2, 0x6b, 0x09, 0x3a, 0x57, 0x12, 0xb3, 0x77, 0x48, 0x85, 0x9b, 0x0f,
  0x9e, 0xc7, 0xc8, 0xa1, 0x7f, 0x7a, 0xc0, 0xbd, 0x31, 0x6d, 0xf6, 0x3e, 0xc3, 0x11, 0x71, 0xce,
  0x7d, 0xda, 0xa8, 0x54, 0x90, 0x97, 0x1f, 0x44, 0x40, 0x16, 0xc9, 0xe3, 0x2c, 0xcb, 0x84, 0xec,
  0x9f, 0x3f, 0x5c, 0xe6, 0x76, 0x0b, 0x3c, 0x20, 0xb7, 0x36, 0x00, 0xdc, 0xe7, 0xf9, 0x4f, 0xf7,
  0xaf, 0x06, 0x07, 0xe0, 0x1a, 0x0a, 0xa9, 0x4b, 0x0c, 0xd6, 0x63, 0x87, 0x89, 0x1d, 0x13, 0x1b,
  0xe4, 0x70, 0x05, 0x47, 0x67, 0x7b, 0x2f, 0xee, 0xe2, 0xe8, 0x98, 0x0d, 0xef, 0xcf, 0xc4, 0xf4,
  0xfb, 0xb0, 0x17, 0x99, 0x64, 0xf2, 0xd4, 0x2a, 0x03, 0x4d, 0x78, 0xc6, 0xfe, 0x65, 0x86, 0x88,
  0x79, 0x45, 0x3b, 0xe5, 0x49, 0x8f, 0x2d, 0xb9, 0xbe, 0x62, 0x93, 0x14, 0xe9, 0xd0, 0x38, 0x9c,
  0xb2, 0xc2, 0x59, 0x5d, 0xb6, 0x72, 0x51, 0xf8, 0x28, 0x7e, 0x61, 0x39, 0xe1, 0xdb, 0x69, 0x80,
];

/** Τύπος CB → κωδικός κομματιού Ruru (λευκά). */
const CB_TO_TYPE: Record<number, number> = { [CB_Q]: 5, [CB_N]: 2, [CB_B]: 3, [CB_R]: 4, [CB_K]: KING, [CB_P]: PAWN };

// Αποκωδικοποίηση θέσης εκκίνησης (28 bytes)
const SETUP_CODES: Record<string, string> = {
  '10001': 'K', '10010': 'Q', '10011': 'N', '10100': 'B', '10101': 'R', '10110': 'P',
  '11001': 'k', '11010': 'q', '11011': 'n', '11100': 'b', '11101': 'r', '11110': 'p',
};

function decodeSetup(b: Buffer): string {
  const epFile = b[1] & 0x0f;
  const black = (b[1] & 0x10) !== 0;
  const castle = b[2];
  const moveNo = b[3] || 1;
  let bits = '';
  for (let i = 4; i < 28; i++) bits += b[i].toString(2).padStart(8, '0');
  const board: string[] = new Array(64).fill('');
  let s = 0;
  let sq = 0;
  while (s < bits.length && sq < 64) {
    if (bits[s] === '0') {
      s++;
      sq++;
      continue;
    }
    const code = bits.slice(s, s + 5);
    const p = SETUP_CODES[code];
    if (!p) throw new Error('άκυρη θέση εκκίνησης');
    // σειρά CB: a1, a2, ..., a8, b1, ...
    const file = sq >> 3;
    const rank = sq & 7;
    board[rank * 8 + file] = p;
    s += 5;
    sq++;
  }
  let fen = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = board[rank * 8 + file];
      if (!p) empty++;
      else {
        if (empty) fen += empty;
        empty = 0;
        fen += p;
      }
    }
    if (empty) fen += empty;
    if (rank) fen += '/';
  }
  let c = '';
  if (castle & 2) c += 'K';
  if (castle & 1) c += 'Q';
  if (castle & 8) c += 'k';
  if (castle & 4) c += 'q';
  const ep = epFile >= 1 && epFile <= 8 ? 'abcdefgh'[epFile - 1] + (black ? '3' : '6') : '-';
  return `${fen} ${black ? 'b' : 'w'} ${c || '-'} ${ep} 0 ${moveNo}`;
}

// ---------------------------------------------------------------------------
// Ελαφρύ δέντρο κινήσεων για τη μετατροπή σε tokens

interface Annotation {
  pos: number;
  type: number;
  data: Buffer;
}

export interface DecodedCbGame {
  startFen: string | null;
  tokens: Uint16Array;
  comments: string[] | null;
  flags: number;
  plies: number;
  error: string | null;
}

const COLORS: Record<number, string> = { 2: 'G', 3: 'Y', 4: 'R' };

function cbSquare(n: number): number {
  // 1..64, a1 = 1, a2 = 2, ..., b1 = 9
  const i = n - 1;
  return (i & 7) * 16 + (i >> 3);
}

function hms(h: number, m: number, s: number): string {
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Μετατρέπει τις σημειώσεις μιας θέσης σε σχόλια/NAG του Ruru. */
function annotationsToParts(list: Annotation[]): { pre: string; post: string; nags: number[]; shapes: boolean } {
  let pre = '';
  let post = '';
  const nags: number[] = [];
  const cmds: string[] = [];
  let shapes = false;
  for (const a of list) {
    const d = a.data;
    switch (a.type) {
      case 0x02:
      case 0x82: {
        const text = decodeCbText(d.subarray(2)).replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')).replace(/\s+/g, ' ').trim();
        if (!text) break;
        if (a.type === 0x82) pre = pre ? pre + ' ' + text : text;
        else post = post ? post + ' ' + text : text;
        break;
      }
      case 0x03:
        for (let k = 0; k < d.length && k < 3; k++) if (d[k] && !nags.includes(d[k])) nags.push(d[k]);
        break;
      case 0x04: {
        const items: string[] = [];
        for (let k = 0; k + 1 < d.length; k += 2) {
          const col = COLORS[d[k]];
          if (col && d[k + 1] >= 1 && d[k + 1] <= 64) items.push(col + squareName(cbSquare(d[k + 1])));
        }
        if (items.length) {
          cmds.push(`[%csl ${items.join(',')}]`);
          shapes = true;
        }
        break;
      }
      case 0x05: {
        const items: string[] = [];
        for (let k = 0; k + 2 < d.length; k += 3) {
          const col = COLORS[d[k]];
          if (col && d[k + 1] >= 1 && d[k + 1] <= 64 && d[k + 2] >= 1 && d[k + 2] <= 64) {
            items.push(col + squareName(cbSquare(d[k + 1])) + squareName(cbSquare(d[k + 2])));
          }
        }
        if (items.length) {
          cmds.push(`[%cal ${items.join(',')}]`);
          shapes = true;
        }
        break;
      }
      case 0x07:
        if (d.length >= 3) cmds.push(`[%emt ${hms(d[0], d[1], d[2])}]`);
        break;
      case 0x21:
        if (d.length >= 6) {
          const value = d.readInt16BE(0);
          const kind = d.readInt16BE(2);
          if (kind === 0 && Math.abs(value) < 30000) cmds.push(`[%eval ${(value / 100).toFixed(2)}]`);
        }
        break;
      default:
        break;
    }
  }
  if (cmds.length) post = cmds.join(' ') + (post ? ' ' + post : '');
  return { pre, post, nags, shapes };
}

// ---------------------------------------------------------------------------

export class CbhDatabase {
  readonly base: string;
  readonly count: number;
  readonly missing: string[] = [];
  private cbh: RandomFile;
  private cbg: RandomFile | null;
  private cba: RandomFile | null;
  private players: EntityFile;
  private tournaments: EntityFile;
  private annotators: EntityFile;
  private sources: EntityFile;
  private pos = new Position();

  constructor(file: string) {
    this.base = file.replace(/\.cbh$/i, '');
    const open = (ext: string, required: boolean): RandomFile | null => {
      const candidates = [this.base + ext, this.base + ext.toUpperCase()];
      for (const c of candidates) if (fs.existsSync(c)) return new RandomFile(c);
      if (required) this.missing.push(path.basename(this.base) + ext);
      return null;
    };
    const cbh = open('.cbh', true);
    if (!cbh) throw new Error(`Δεν βρέθηκε το ${this.base}.cbh`);
    this.cbh = cbh;
    this.cbg = open('.cbg', true);
    this.cba = open('.cba', false);
    this.players = new EntityFile(open('.cbp', true));
    this.tournaments = new EntityFile(open('.cbt', false));
    this.annotators = new EntityFile(open('.cbc', false));
    this.sources = new EntityFile(open('.cbs', false));
    this.count = Math.max(0, Math.floor(this.cbh.size / 46) - 1);
  }

  close(): void {
    for (const f of [this.cbh, this.cbg, this.cba]) f?.close();
  }

  /** Εγγραφή i (1..count). */
  record(i: number): CbhRecord {
    const b = this.cbh.read(i * 46, 46);
    const t = b[0];
    const kind = !(t & 1) ? 'unknown' : t & 2 ? 'text' : 'game';
    const eco = ecoFromField(b.readUInt16BE(0x23));
    return {
      id: i,
      kind,
      deleted: (t & 0x80) !== 0,
      gameOffset: b.readUInt32BE(1),
      annoOffset: b.readUInt32BE(5),
      white: b.readUIntBE(9, 3),
      black: b.readUIntBE(12, 3),
      tournament: b.readUIntBE(15, 3),
      annotator: b.readUIntBE(18, 3),
      source: b.readUIntBE(21, 3),
      date: b.readUIntBE(24, 3),
      result: b[27],
      lineEval: b[28],
      round: b[29],
      subround: b[30],
      whiteElo: b.readUInt16BE(31),
      blackElo: b.readUInt16BE(33),
      eco: eco.eco,
      ecoSub: eco.sub,
      medals: b.readUInt16BE(37),
      moveCount: b[45],
    };
  }

  player(id: number): string {
    const d = this.players.data(id);
    if (!d) return '';
    const last = decodeCbText(d.subarray(0, 30));
    const first = decodeCbText(d.subarray(30, 50));
    return first ? `${last}, ${first}` : last;
  }

  tournament(id: number): CbTournament {
    const d = this.tournaments.data(id);
    if (!d) return { title: '', place: '', date: 0 };
    return { title: decodeCbText(d.subarray(0, 40)), place: decodeCbText(d.subarray(40, 70)), date: d.length >= 74 ? d.readInt32LE(70) & 0xffffff : 0 };
  }

  annotator(id: number): string {
    const d = this.annotators.data(id);
    return d ? decodeCbText(d.subarray(0, 45)) : '';
  }

  source(id: number): string {
    const d = this.sources.data(id);
    return d ? decodeCbText(d.subarray(0, 25)) : '';
  }

  /** Κεφαλίδες PGN για την εγγραφή. */
  headers(r: CbhRecord): Record<string, string> {
    const h: Record<string, string> = {};
    const t = this.tournament(r.tournament);
    h.Event = t.title || '?';
    h.Site = t.place || '?';
    h.Date = packedDateToPgn(r.date);
    h.Round = r.round ? (r.subround ? `${r.round}.${r.subround}` : String(r.round)) : '?';
    h.White = this.player(r.white) || '?';
    h.Black = this.player(r.black) || '?';
    h.Result = RESULTS[r.result] ?? '*';
    if (r.whiteElo) h.WhiteElo = String(r.whiteElo);
    if (r.blackElo) h.BlackElo = String(r.blackElo);
    if (r.eco) h.ECO = r.eco;
    const ann = r.annotator ? this.annotator(r.annotator).replace(/^,\s*/, '') : '';
    if (ann) h.Annotator = ann;
    if (r.medals) h.Medals = medalsToText(r.medals);
    const src = r.source ? this.source(r.source) : '';
    if (src) h.Source = src;
    if (t.date) h.EventDate = packedDateToPgn(t.date);
    if (r.result === 3) h.Result = '*';
    return h;
  }

  /** Σημειώσεις της παρτίδας (.cba), ταξινομημένες κατά θέση. */
  private annotations(r: CbhRecord): Annotation[] {
    if (!this.cba || !r.annoOffset) return [];
    const head = this.cba.read(r.annoOffset, 14);
    if (head.length < 14) return [];
    const size = head.readUInt32BE(10);
    if (size < 14 || size > 16 * 1024 * 1024) return [];
    const rec = this.cba.read(r.annoOffset, size);
    const out: Annotation[] = [];
    let at = 14;
    while (at + 6 <= rec.length) {
      let p = rec.readUIntBE(at, 3);
      if (p & 0x800000) p -= 0x1000000;
      const type = rec[at + 3];
      const len = rec.readUInt16BE(at + 4);
      if (len < 6 || at + len > rec.length) break;
      out.push({ pos: p, type, data: rec.subarray(at + 6, at + len) });
      at += len;
    }
    out.sort((a, b) => a.pos - b.pos);
    return out;
  }

  /** Αποκωδικοποιεί τις κινήσεις και τα σχόλια μιας παρτίδας σε tokens του Ruru. */
  decodeGame(r: CbhRecord): DecodedCbGame {
    if (!this.cbg) return { startFen: null, tokens: new Uint16Array(0), comments: null, flags: GF_ERROR, plies: 0, error: 'Λείπει το αρχείο κινήσεων (.cbg)' };
    const head = this.cbg.read(r.gameOffset, 4);
    if (head.length < 4) return { startFen: null, tokens: new Uint16Array(0), comments: null, flags: GF_ERROR, plies: 0, error: 'Κατεστραμμένη εγγραφή κινήσεων' };
    const flagsByte = head[0];
    const size = head.readUIntBE(1, 3);
    const rec = this.cbg.read(r.gameOffset, size);
    const mode = flagsByte & 0x3f;
    let at = 4;
    let startFen: string | null = null;
    if (flagsByte & 0x80) return { startFen: null, tokens: new Uint16Array(0), comments: null, flags: 0, plies: 0, error: 'Εγγραφή κειμένου' };
    if (flagsByte & 0x40) {
      try {
        startFen = decodeSetup(rec.subarray(4, 32));
      } catch (e) {
        return { startFen: null, tokens: new Uint16Array(0), comments: null, flags: GF_ERROR, plies: 0, error: (e as Error).message };
      }
      at = 32;
    }
    if (mode !== 0) {
      return { startFen, tokens: new Uint16Array(0), comments: null, flags: GF_ERROR | (startFen ? GF_SETUP : 0), plies: 0, error: mode === 10 || mode === 11 ? 'Chess960 (δεν υποστηρίζεται ακόμη)' : `Άγνωστη κωδικοποίηση ${mode}` };
    }
    const stream = rec.subarray(at);
    return this.decodeStream(stream, startFen, this.annotations(r));
  }

  private decodeStream(stream: Buffer, startFen: string | null, annos: Annotation[]): DecodedCbGame {
    const pos = this.pos;
    try {
      pos.setFen(startFen ?? START_FEN);
    } catch (e) {
      return { startFen, tokens: new Uint16Array(0), comments: null, flags: GF_ERROR, plies: 0, error: (e as Error).message };
    }
    // λίστες κομματιών: θέση (0x88) για [κωδικός*8 + αριθμός]
    let list: Int16Array = new Int16Array(16 * 8).fill(-1);
    let slot: Int8Array = new Int8Array(128).fill(-1);
    {
      const counts = new Int8Array(16);
      for (let file = 0; file < 8; file++) {
        for (let rank = 0; rank < 8; rank++) {
          const sq = rank * 16 + file;
          const p = pos.board[sq];
          if (!p) continue;
          const nr = counts[p]++;
          if (nr < 8) {
            list[p * 8 + nr] = sq;
            slot[sq] = nr;
          }
        }
      }
    }
    // ελαφρύ δέντρο
    const moves: number[] = [0];
    const firstChild: number[] = [-1];
    const lastChild: number[] = [-1];
    const nextSibling: number[] = [-1];
    let node = 0;
    const stack: Array<{ node: number; pos: Position; list: Int16Array; slot: Int8Array }> = [];
    let processed = 0;
    let error: string | null = null;
    let mainPlies = 0;
    let onMain = true;
    const mainStack: boolean[] = [];

    const addNode = (m: number) => {
      const id = moves.length;
      moves.push(m);
      firstChild.push(-1);
      lastChild.push(-1);
      nextSibling.push(-1);
      if (firstChild[node] < 0) firstChild[node] = id;
      else nextSibling[lastChild[node]] = id;
      if (firstChild[node] !== id) onMain = false;
      lastChild[node] = id;
      node = id;
      if (onMain) mainPlies++;
    };

    const removeFromList = (sq: number) => {
      const p = pos.board[sq];
      const nr = slot[sq];
      if (!p || nr < 0) return;
      const t = p & 7;
      slot[sq] = -1;
      if (t === PAWN || t === KING) {
        list[p * 8 + nr] = -1;
        return;
      }
      // τα επόμενα κομμάτια του ίδιου είδους μετακινούνται μία θέση πάνω
      for (let k = nr; k < 7; k++) {
        const s = list[p * 8 + k + 1];
        list[p * 8 + k] = s;
        if (s >= 0) slot[s] = k;
      }
      list[p * 8 + 7] = -1;
    };

    const applyMove = (m: number) => {
      const from = m & 0x7f;
      const to = (m >> 7) & 0x7f;
      const piece = pos.board[from];
      const nr = slot[from];
      // αιχμαλωσία
      if (m & (1 << 18)) removeFromList(pos.turn === 0 ? to - 16 : to + 16);
      else if (pos.board[to]) removeFromList(to);
      const promo = (m >> 14) & 7;
      slot[from] = -1;
      if (promo) {
        list[piece * 8 + nr] = -1;
        const np = promo | (pos.turn << 3);
        let k = 0;
        while (k < 8 && list[np * 8 + k] >= 0) k++;
        if (k < 8) {
          list[np * 8 + k] = to;
          slot[to] = k;
        }
      } else {
        list[piece * 8 + nr] = to;
        slot[to] = nr;
      }
      if (m & (1 << 19)) {
        const rf = to > from ? from + 3 : from - 4;
        const rt = to > from ? from + 1 : from - 1;
        const rnr = slot[rf];
        const rook = pos.board[rf];
        if (rnr >= 0 && (rook & 7) === ROOK) {
          list[rook * 8 + rnr] = rt;
          slot[rt] = rnr;
          slot[rf] = -1;
        }
      }
      pos.makeMove(m);
      addNode(m);
    };

    let i = 0;
    const n = stream.length;
    while (i < n) {
      const tk = (stream[i] - processed) & 0xff;
      if (tk === 0x0c) {
        // τέλος βαριάντας / παρτίδας
        const back = stack.pop();
        if (!back) break;
        node = back.node;
        pos.copyFrom(back.pos);
        list = back.list;
        slot = back.slot;
        onMain = mainStack.pop()!;
        i++;
        continue;
      }
      if (tk === 0xdc) {
        stack.push({ node, pos: pos.clone(), list: list.slice(), slot: slot.slice() });
        mainStack.push(onMain);
        i++;
        continue;
      }
      if (tk === 0x9f) {
        i++;
        continue;
      }
      if (tk === 0x29) {
        if (i + 2 >= n) {
          error = 'Κομμένη κίνηση δύο bytes';
          break;
        }
        const d1 = DEOBFUSCATE_2B[(stream[i + 1] - processed) & 0xff];
        const d2 = DEOBFUSCATE_2B[(stream[i + 2] - processed) & 0xff];
        const v = (d1 << 8) | d2;
        const src = v & 63;
        const dst = (v >> 6) & 63;
        const pc = (v >> 12) & 3;
        const from = (src & 7) * 16 + (src >> 3);
        const to = (dst & 7) * 16 + (dst >> 3);
        const piece = pos.board[from];
        if (!piece || piece >> 3 !== pos.turn) {
          error = `Άκυρη κίνηση (${squareName(from)}${squareName(to)})`;
          break;
        }
        const lastRank = pos.turn === BLACK ? 0 : 7;
        const promo = (piece & 7) === PAWN && to >> 4 === lastRank ? [5, 4, 3, 2][pc] : 0;
        const m = pos.buildMove(from, to, promo);
        if (!pos.isLegalPseudo(m)) {
          error = `Άκυρη κίνηση ${squareName(from)}${squareName(to)}`;
          break;
        }
        applyMove(m);
        processed = (processed + 1) & 0xff;
        i += 3;
        continue;
      }
      processed = (processed + 1) & 0xff;
      i++;
      if (tk === 0xaa) {
        pos.makeMove(NULL_MOVE);
        addNode(NULL_MOVE);
        continue;
      }
      const def = ONE_BYTE[tk];
      if (!def) {
        error = `Άγνωστος κωδικός κίνησης 0x${tk.toString(16)}`;
        break;
      }
      const [cbType, nr, dx0, dy0] = def;
      const us = pos.turn;
      const code = CB_TO_TYPE[cbType] | (us << 3);
      const from = list[code * 8 + nr];
      if (from === undefined || from < 0) {
        error = 'Αναφορά σε κομμάτι που δεν υπάρχει';
        break;
      }
      let dx = dx0;
      let dy = dy0;
      if (cbType === CB_P && us === BLACK) {
        dx = -dx;
        dy = -dy;
      }
      let to: number;
      if (cbType === CB_K && (dx === 2 || dx === -2)) {
        to = from + dx;
      } else {
        const f = (((from & 7) + dx) % 8 + 8) % 8;
        const rk = (((from >> 4) + dy) % 8 + 8) % 8;
        to = rk * 16 + f;
      }
      const m = pos.buildMove(from, to);
      if (pos.board[to] && pos.board[to] >> 3 === us) {
        error = `Άκυρη κίνηση ${squareName(from)}${squareName(to)}`;
        break;
      }
      if (!pos.isLegalPseudo(m)) {
        error = `Άκυρη κίνηση ${squareName(from)}${squareName(to)}`;
        break;
      }
      applyMove(m);
    }

    // σημειώσεις ανά κόμβο (θέση p → κίνηση p+1 με σειρά αποθήκευσης)
    const total = moves.length - 1;
    const byNode = new Map<number, Annotation[]>();
    let mainEnd = 0;
    while (firstChild[mainEnd] >= 0) mainEnd = firstChild[mainEnd];
    for (const a of annos) {
      const target = a.pos < 0 ? 0 : a.pos + 1 <= total ? a.pos + 1 : mainEnd;
      let l = byNode.get(target);
      if (!l) byNode.set(target, (l = []));
      l.push(a);
    }

    // εκπομπή tokens με σειρά PGN
    const out: number[] = [];
    const comments: string[] = [];
    let flags = startFen ? GF_SETUP : 0;
    if (error) flags |= GF_ERROR;
    const addComment = (text: string, pre: boolean) => {
      if (!text || comments.length >= 0x1fff) return;
      out.push((pre ? TK_PRE : TK_COMMENT) | comments.length);
      comments.push(text);
      flags |= GF_COMMENTS;
    };
    const rootParts = byNode.get(0);
    if (rootParts) {
      const p = annotationsToParts(rootParts);
      const text = [p.pre, p.post].filter(Boolean).join(' ');
      addComment(text, false);
      if (p.shapes) flags |= GF_SHAPES;
    }
    const emitNode = (id: number) => {
      const parts = byNode.get(id);
      const p = parts ? annotationsToParts(parts) : null;
      if (p?.pre) addComment(p.pre, true);
      out.push(moveToToken(moves[id]));
      if (p) {
        for (const g of p.nags) {
          out.push(TK_NAG | g);
          flags |= GF_NAGS;
        }
        if (p.post) addComment(p.post, false);
        if (p.shapes) flags |= GF_SHAPES;
      }
    };
    const emitLine = (parent: number, depth: number) => {
      let cur = parent;
      while (firstChild[cur] >= 0) {
        const main = firstChild[cur];
        emitNode(main);
        for (let alt = nextSibling[main]; alt >= 0; alt = nextSibling[alt]) {
          flags |= GF_VARIATIONS;
          out.push(TK_VSTART);
          emitNode(alt);
          if (depth < 200) emitLine(alt, depth + 1);
          out.push(TK_VEND);
        }
        cur = main;
      }
    };
    emitLine(0, 0);
    return {
      startFen,
      tokens: Uint16Array.from(out),
      comments: comments.length ? comments : null,
      flags,
      plies: mainPlies,
      error,
    };
  }
}
