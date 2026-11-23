/** Τεστ: διαχωρισμός αρχείων zstd σε frames (συνθετικά frames τύπου pzstd και πραγματικό κομμάτι του αρχείου του Lichess). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fileFrames, frameLength, readFrame, splitFrames } from '../../src/server/tactics/zstd.ts';

/** Skippable frame όπως του pzstd: μαγικός 0x184D2A50, μήκος 4, μέγεθος του επόμενου frame. */
function skippable(next: number): Buffer {
  const b = Buffer.alloc(12);
  b.writeUInt32LE(0x184d2a50, 0);
  b.writeUInt32LE(4, 4);
  b.writeUInt32LE(next, 8);
  return b;
}

function text(n: number, seed: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += `line ${seed}-${i},${(i * 7919 + seed) % 3000},${'abcdefghij'.repeat((i % 7) + 1)}\n`;
  return s;
}

describe('splitFrames', () => {
  it('βρίσκει frames με και χωρίς skippable ανάμεσα και η αποσυμπίεση δίνει το αρχικό κείμενο', () => {
    const parts = [text(3000, 1), text(5000, 2), text(10, 3)];
    const frames = parts.map((p) => zlib.zstdCompressSync(Buffer.from(p)));
    const buf = Buffer.concat([skippable(frames[0].length), frames[0], skippable(frames[1].length), frames[1], frames[2]]);
    const found = splitFrames(buf);
    expect(found.map((f) => f.skippable)).toEqual([true, false, true, false, false]);
    const data = found.filter((f) => !f.skippable).map((f) => zlib.zstdDecompressSync(buf.subarray(f.offset, f.offset + f.length)).toString());
    expect(data).toEqual(parts);
    // τα μεγέθη ταιριάζουν με το πεδίο του pzstd
    expect(found[1].length).toBe(frames[0].length);
    expect(found[3].length).toBe(frames[1].length);
  });

  it('frames με checksum και μεγάλο περιεχόμενο (πολλά blocks)', () => {
    const big = Buffer.from(text(60_000, 9));
    const f = zlib.zstdCompressSync(big, { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } });
    expect(f[4] & 4).toBe(4);
    const found = splitFrames(Buffer.concat([f, f]));
    expect(found.length).toBe(2);
    expect(found[0].length).toBe(f.length);
  });

  it('κομμένο frame: −1 από το frameLength και σφάλμα από το splitFrames', () => {
    const f = zlib.zstdCompressSync(Buffer.from(text(2000, 4)));
    const cut = f.subarray(0, f.length - 10);
    const read = (pos: number, len: number) => cut.subarray(pos, Math.min(cut.length, pos + len));
    expect(frameLength(read, 0, cut.length).length).toBe(-1);
    expect(() => splitFrames(cut)).toThrow(/Κομμένο/);
    expect(() => splitFrames(Buffer.from('not a zstd file'))).toThrow(/zstd/);
  });

  it('fileFrames: από αρχείο, με συνέχιση από θέση frame, χωρίς τα skippable', () => {
    const parts = [text(1000, 5), text(1500, 6), text(800, 7)];
    const frames = parts.map((p) => zlib.zstdCompressSync(Buffer.from(p)));
    const buf = Buffer.concat(frames.flatMap((f) => [skippable(f.length), f]));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rcb-zstd-')), 'x.zst');
    fs.writeFileSync(file, buf);
    const all = [...fileFrames(file)];
    expect(all.length).toBe(3);
    expect(zlib.zstdDecompressSync(readFrame(file, all[2])).toString()).toBe(parts[2]);
    const rest = [...fileFrames(file, all[1].offset + all[1].length)];
    expect(rest.map((f) => f.offset)).toEqual([all[2].offset]);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('fileFrames: λάθος μέγεθος στο skippable του pzstd → ανάγνωση των blocks (ίδιο αποτέλεσμα)', () => {
    const parts = [text(1000, 8), text(1200, 9)];
    const frames = parts.map((p) => zlib.zstdCompressSync(Buffer.from(p)));
    const good = Buffer.concat(frames.flatMap((f) => [skippable(f.length), f]));
    // το πρώτο skippable δείχνει 7 bytes λιγότερα: το άλμα θα έπεφτε σε σκουπίδια
    const bad = Buffer.concat([skippable(frames[0].length - 7), frames[0], skippable(frames[1].length), frames[1]]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcb-zstd-'));
    const fg = path.join(dir, 'good.zst');
    const fb = path.join(dir, 'bad.zst');
    fs.writeFileSync(fg, good);
    fs.writeFileSync(fb, bad);
    const a = [...fileFrames(fg)];
    const b = [...fileFrames(fb)];
    expect(b).toEqual(a);
    expect(b.map((f) => zlib.zstdDecompressSync(readFrame(fb, f)).toString())).toEqual(parts);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Πραγματικό κομμάτι του lichess_db_puzzle.csv.zst (τα πρώτα 2 frames): μόνο αν υπάρχει στον φάκελο δοκιμών.
const SLICE = process.env.RCB_PUZZLE_SLICE ?? '';
describe.skipIf(!SLICE || !fs.existsSync(SLICE))('πραγματικό αρχείο Lichess', () => {
  it('pzstd: frames 32 MiB, κεφαλίδα 11 στηλών, γραμμές που κόβονται ανάμεσα σε frames', () => {
    const frames = [...fileFrames(SLICE)];
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const ra = zlib.zstdDecompressSync(readFrame(SLICE, frames[0]));
    expect(ra.length).toBe(32 * 1024 * 1024);
    const a = ra.toString();
    const b = zlib.zstdDecompressSync(readFrame(SLICE, frames[1])).toString();
    expect(a.slice(0, a.indexOf('\n'))).toBe('PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate');
    // η τελευταία γραμμή του πρώτου frame συνεχίζει στο δεύτερο
    const joined = a.slice(a.lastIndexOf('\n') + 1) + b.slice(0, b.indexOf('\n'));
    expect(joined.split(',').length).toBe(11);
  });
});
