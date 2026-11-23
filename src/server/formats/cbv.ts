/**
 * Αρχειοθήκες ChessBase (.cbv): κατάλογος μελών και αποσυμπίεση των μπλοκ τους.
 * Υλοποίηση από την ανοιχτή περιγραφή της μορφής του cbvault (itshak, MIT) — όχι
 * κώδικας της ChessBase.
 *
 * - Κεφαλίδα 8 B: u16 8, u16 πλήθος μελών, u16 μέγεθος εγγραφής (149 στα παλιά
 *   αρχεία, 173 στα νέα), u16 3.
 * - Εγγραφή μέλους: όνομα 128 B (τελειώνει με \0), u32 θέση, u32 συμπιεσμένο και
 *   u32 αρχικό μέγεθος (οι νέες εγγραφές έχουν και 64-bit αντίγραφα).
 * - Δεδομένα μέλους: μπλοκ [u16 μήκος][u16 άγνωστο][μέθοδος u8][σώμα]· η μέθοδος
 *   είναι ανά μπλοκ: 0 αποθηκευμένο, 1 LZ, 2 Huffman, 3 Huffman και μετά LZ.
 * - LZ: ομάδες με λέξη ελέγχου u16 LE και ως 16 tokens (από το bit 15· 0 = byte,
 *   1 = κωδικός). Κωδικός: tag με high / low nibble — 0: low+3 φορές το επόμενο
 *   byte· 1: low + (b1<<4) + 0x13 φορές το b2· 2: b2 + 0x10 bytes από απόσταση
 *   (b1<<4) + low + 3· 3–15: high bytes από την ίδια απόσταση. Οι αποστάσεις
 *   φτάνουν και σε προηγούμενα μπλοκ του ίδιου μέλους.
 * - Huffman: [16 bit μέγεθος εξόδου, big-endian][256 × (4 bit μήκος n, n bit
 *   διαδρομή)][κωδικοί], όλα από το σημαντικότερο bit, χωρίς ευθυγράμμιση.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFileName } from '../text.ts';

export interface CbvMember {
  name: string;
  offset: number;
  packed: number;
  size: number;
}

/** Έξοδος που μεγαλώνει (το δηλωμένο μέγεθος δεν είναι πάντα ακριβές). */
class Out {
  buf: Uint8Array;
  len = 0;
  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(16, capacity));
  }
  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  push(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b;
  }
  append(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }
  run(b: number, n: number): void {
    this.ensure(n);
    this.buf.fill(b, this.len, this.len + n);
    this.len += n;
  }
  /** `n` bytes από `dist` πίσω (με επικάλυψη: επανάληψη με περίοδο `dist`). */
  copyBack(dist: number, n: number): void {
    const from = this.len - dist;
    if (from < 0) throw new Error('Αναφορά πριν από την αρχή της εξόδου');
    this.ensure(n);
    const b = this.buf;
    for (let i = 0; i < n; i++) b[this.len + i] = b[from + i];
    this.len += n;
  }
  view(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

/** Αποκωδικοποίηση ροής LZ, με προσθήκη στο `out`. */
function lzDecode(input: Uint8Array, out: Out): void {
  let at = 0;
  while (at < input.length) {
    // ένα μόνο byte στο τέλος: τελευταίο κυριολεκτικό
    if (at + 1 >= input.length) {
      out.push(input[at]);
      return;
    }
    const control = input[at] | (input[at + 1] << 8);
    at += 2;
    for (let bit = 15; bit >= 0; bit--) {
      // η ροή τελειώνει όταν τελειώσει η είσοδος (τα υπόλοιπα bits δεν σημαίνουν τίποτα)
      if (at >= input.length) return;
      const t = input[at++];
      if (!(control & (1 << bit))) {
        out.push(t);
        continue;
      }
      const high = t >> 4;
      const low = t & 15;
      if (high === 0) {
        if (at >= input.length) return;
        out.run(input[at++], low + 3);
      } else if (high === 1) {
        if (at + 1 >= input.length) return;
        out.run(input[at + 1], low + (input[at] << 4) + 0x13);
        at += 2;
      } else if (high === 2) {
        if (at + 1 >= input.length) return;
        out.copyBack((input[at] << 4) + low + 3, input[at + 1] + 0x10);
        at += 2;
      } else {
        if (at >= input.length) return;
        out.copyBack((input[at++] << 4) + low + 3, high);
      }
    }
  }
}

/** Αποκωδικοποίηση μπλοκ Huffman (πίνακας με ρητές διαδρομές ανά byte). */
function huffmanDecode(input: Uint8Array, out: Out): void {
  let pos = 0;
  const total = input.length * 8;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v = (v << 1) | (pos < total ? (input[pos >> 3] >> (7 - (pos & 7))) & 1 : 0);
    return v;
  };
  const want = read(16);
  if (!want) return;
  // δέντρο: κόμβος → [αριστερά, δεξιά]· θετικό = κόμβος, αρνητικό = φύλλο −(σύμβολο + 1)
  const kids = new Int32Array(2 * 512);
  let nodes = 1;
  let kraft = 0;
  for (let sym = 0; sym < 256; sym++) {
    const n = read(4);
    if (!n) continue;
    kraft += 1 << (16 - n);
    const code = read(n);
    let node = 0;
    for (let i = n - 1; i > 0; i--) {
      const slot = node * 2 + ((code >> i) & 1);
      if (kids[slot] < 0) throw new Error('Άκυρος πίνακας Huffman');
      if (!kids[slot]) {
        if (nodes >= 512) throw new Error('Άκυρος πίνακας Huffman');
        kids[slot] = nodes++;
      }
      node = kids[slot];
    }
    kids[node * 2 + (code & 1)] = -(sym + 1);
  }
  if (kraft !== 1 << 16) throw new Error('Ο πίνακας Huffman δεν είναι πλήρης');
  for (let k = 0; k < want; k++) {
    let node = 0;
    for (;;) {
      if (pos >= total) return;
      const next = kids[node * 2 + ((input[pos >> 3] >> (7 - (pos & 7))) & 1)];
      pos++;
      if (next < 0) {
        out.push(-next - 1);
        break;
      }
      if (!next) throw new Error('Κωδικός Huffman εκτός πίνακα');
      node = next;
    }
  }
}

/** Αποσυμπίεση της ροής ενός μέλους (όλα τα μπλοκ με τη σειρά). */
export function decodeMember(stream: Uint8Array, size: number): Uint8Array {
  const out = new Out(size);
  let at = 0;
  while (at + 4 <= stream.length) {
    const len = stream[at] | (stream[at + 1] << 8);
    at += 4;
    if (at + len > stream.length) throw new Error('Κομμένο μπλοκ');
    if (!len) continue;
    const mode = stream[at];
    const body = stream.subarray(at + 1, at + len);
    at += len;
    if (mode === 0) out.append(body);
    else if (mode === 1) lzDecode(body, out);
    else if (mode === 2) huffmanDecode(body, out);
    else if (mode === 3) {
      const stage = new Out(1 << 16);
      huffmanDecode(body, stage);
      lzDecode(stage.view(), out);
    } else throw new Error(`Άγνωστη μέθοδος συμπίεσης ${mode}`);
  }
  return out.view();
}

const decodeName = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1253').decode(bytes);
  }
};

/** Ο κατάλογος των μελών. */
export function readCbvDirectory(fd: number, fileSize: number): CbvMember[] {
  const head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  const count = head.readUInt16LE(2);
  const rec = head.readUInt16LE(4);
  if (head.readUInt16LE(0) !== 8 || head.readUInt16LE(6) !== 3 || rec < 140) throw new Error('Δεν είναι αρχείο .cbv της ChessBase');
  const dir = Buffer.alloc(count * rec);
  if (fs.readSync(fd, dir, 0, dir.length, 8) !== dir.length) throw new Error('Κομμένος κατάλογος .cbv');
  const out: CbvMember[] = [];
  for (let i = 0; i < count; i++) {
    const at = i * rec;
    let end = at;
    while (end < at + 128 && dir[end] !== 0) end++;
    const m = { name: decodeName(dir.subarray(at, end)), offset: dir.readUInt32LE(at + 128), packed: dir.readUInt32LE(at + 132), size: dir.readUInt32LE(at + 136) };
    if (m.offset + m.packed > fileSize) throw new Error(`Το μέλος «${m.name}» βγαίνει έξω από το αρχείο`);
    out.push(m);
  }
  return out;
}

/** Αποσυμπιέζει όλα τα μέλη ενός .cbv στον φάκελο `dir`· επιστρέφει τις διαδρομές. */
export function extractCbv(file: string, dir: string): string[] {
  const fd = fs.openSync(file, 'r');
  try {
    const members = readCbvDirectory(fd, fs.fstatSync(fd).size);
    fs.mkdirSync(dir, { recursive: true });
    const out: string[] = [];
    for (const m of members) {
      const stream = Buffer.alloc(m.packed);
      fs.readSync(fd, stream, 0, m.packed, m.offset);
      let data: Uint8Array;
      try {
        data = decodeMember(stream, m.size);
      } catch (e) {
        throw new Error(`${path.basename(file)} → ${m.name}: ${(e as Error).message}`);
      }
      const target = path.join(dir, safeFileName(path.win32.basename(m.name)));
      fs.writeFileSync(target, data);
      out.push(target);
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}
