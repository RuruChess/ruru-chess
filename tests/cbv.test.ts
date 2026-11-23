import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeMember, extractCbv } from '../src/server/formats/cbv.ts';

// Συνθετικές ροές από την περιγραφή της μορφής (όχι δεδομένα της ChessBase)
const block = (mode: number, body: number[]) => [(body.length + 1) & 0xff, (body.length + 1) >> 8, 0xa5, 0xa5, mode, ...body];
const bytes = (s: string) => [...Buffer.from(s, 'latin1')];
const decode = (stream: number[], size = 0) => Buffer.from(decodeMember(Uint8Array.from(stream), size)).toString('latin1');

/** Μπλοκ Huffman με κωδικούς σταθερού μήκους 8 (πλήρης κώδικας: όλα τα 256 σύμβολα). */
function huffman8(text: string): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
  };
  put(text.length, 16);
  for (let s = 0; s < 256; s++) {
    put(8, 4);
    put(s, 8);
  }
  for (const c of Buffer.from(text, 'latin1')) put(c, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b, k) => a | (b << (7 - k)), 0));
  return out;
}

describe('αρχεία .cbv', () => {
  it('αποθηκευμένο και LZ με κυριολεκτικά', () => {
    expect(decode(block(0, bytes('abc')))).toBe('abc');
    // 16 κυριολεκτικά ανά ομάδα (λέξη ελέγχου 0)
    expect(decode(block(1, [0, 0, ...bytes('hello')]))).toBe('hello');
  });

  it('LZ: αναφορές πίσω και επαναλήψεις', () => {
    // λέξη ελέγχου 0x0800: τέσσερα κυριολεκτικά (bits 15–12) και κωδικός στο bit 11·
    // tag 0x41 = μήκος 4, low 1 → απόσταση (0<<4) + 1 + 3 = 4
    expect(decode(block(1, [0x00, 0x08, ...bytes('abcd'), 0x41, 0x00]))).toBe('abcdabcd');
    // short run: tag 0x02 → 5 φορές το «x»· long run: tag 0x10, b1 1, b2 «y» → 0 + 16 + 19 = 35
    expect(decode(block(1, [0x00, 0xc0, 0x02, 0x78, 0x10, 0x01, 0x79]))).toBe('xxxxx' + 'y'.repeat(35));
    // long back-reference: tag 0x20 (low 0), b1 0, b2 4 → 20 bytes από απόσταση 3 (επικάλυψη)
    expect(decode(block(1, [0x00, 0x10, ...bytes('xyz'), 0x20, 0x00, 0x04]))).toBe('xyz' + 'xyzxyzxyzxyzxyzxyzxy');
    // οι αναφορές φτάνουν και στο προηγούμενο μπλοκ
    expect(decode([...block(0, bytes('abc')), ...block(1, [0x00, 0x80, 0x30, 0x00])])).toBe('abcabc');
  });

  it('Huffman και Huffman + LZ', () => {
    expect(decode(block(2, huffman8('Huffman!')))).toBe('Huffman!');
    const lz = [0x00, 0x08, ...bytes('abcd'), 0x41, 0x00].map((b) => String.fromCharCode(b)).join('');
    expect(decode(block(3, huffman8(lz)))).toBe('abcdabcd');
    // μη πλήρης πίνακας: σφάλμα
    expect(() => decode(block(2, [0x00, 0x01, 0x10]))).toThrow();
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-cbv-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('κατάλογος και εξαγωγή (εγγραφές 149 B)', () => {
    const members = [
      { name: 'Test.cbh', data: block(0, bytes('HEAD')) },
      { name: 'Test.cbg', data: block(1, [0, 0, ...bytes('moves')]) },
    ];
    const rec = 149;
    const head = [8, 0, members.length, 0, rec, 0, 3, 0];
    let offset = 8 + members.length * rec;
    const dirBytes: number[] = [];
    const body: number[] = [];
    for (const m of members) {
      const r = new Array(rec).fill(0);
      bytes(m.name).forEach((b, i) => (r[i] = b));
      const size = m.name.endsWith('cbh') ? 4 : 5;
      [offset, m.data.length, size].forEach((v, k) => [0, 1, 2, 3].forEach((i) => (r[128 + k * 4 + i] = (v >> (8 * i)) & 0xff)));
      dirBytes.push(...r);
      body.push(...m.data);
      offset += m.data.length;
    }
    const file = path.join(dir, 'Test.cbv');
    fs.writeFileSync(file, Uint8Array.from([...head, ...dirBytes, ...body]));
    const out = extractCbv(file, path.join(dir, 'out'));
    expect(out.map((p) => path.basename(p))).toEqual(['Test.cbh', 'Test.cbg']);
    expect(fs.readFileSync(out[1], 'latin1')).toBe('moves');
  });
});
