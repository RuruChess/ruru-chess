import { describe, expect, it } from 'vitest';
import { decodeScidGame, scidDateToPgn, scidEcoToString } from '../src/server/formats/scid.ts';
import { decodeGame } from '../src/core/codec.ts';
import { writeMovetext } from '../src/core/pgn.ts';

/** Εγγραφή .sg4: tags, σημαίες, κινήσεις (κομμάτι << 4 | κωδικός) και στο τέλος τα σχόλια. */
const record = (...bytes: Array<number | string>) =>
  Buffer.concat(bytes.map((b) => (typeof b === 'string' ? Buffer.from(`${b}\0`, 'utf8') : Buffer.from([b]))));

const pgnOf = (buf: Buffer) => {
  const g = decodeScidGame(buf);
  expect(g.error).toBeNull();
  return { g, text: writeMovetext(decodeGame(g.tokens, g.comments, g.startFen ?? undefined)).replace(/\s+/g, ' ').replace(/ \*$/, '').trim() };
};

describe('βάσεις Scid (.sg4)', () => {
  it('κινήσεις, NAG, σχόλιο και βαριάντα με τη σειρά της PGN', () => {
    // 1.e4 e5 $1 {καλό} (1...c5) 2.Nf3 — πιόνι e2 = νούμερο 12, διπλό βήμα = 15· ίππος g1 = 6, +15 = κωδικός 7
    const { g, text } = pgnOf(record(0, 0, 0xcf, 0xcf, 11, 1, 12, 13, 0xaf, 14, 0x67, 15, 'καλό'));
    expect(text).toBe('1. e4 e5 $1 {καλό} (1... c5) 2. Nf3');
    expect(g.plies).toBe(3);
  });

  it('ροκέ, αιχμαλωσία (το τελευταίο κομμάτι παίρνει τη θέση) και διαγώνια κίνηση βασίλισσας σε δύο bytes', () => {
    const { text } = pgnOf(
      record(
        0, 0,
        0xcf, // 1.e4 (πιόνι 12, διπλό βήμα)
        0xbf, // 1...d5 (πιόνι d7 = 11)
        0xc0, // 2.exd5 (+7) — το πιόνι h7 (15) παίρνει τη θέση 11
        0x4c, // 2...Qxd5 (βασίλισσα 4, κάθετα στη σειρά 5: 8 + 4) — το πιόνι h2 (15) παίρνει τη θέση 12
        0x28, // 3.Nc3 (ίππος 2, +17)
        0x40, // 3...Qa5 (οριζόντια στη στήλη a)
        0x67, // 4.Nf3
        0x61, // 4...Nf6 (−17)
        0x5a, // 5.Bc4 (διαγώνια προς τα πάνω-αριστερά: 8 + στήλη c)
        0x3e, // 5...Bg4 (κάτω-δεξιά: 8 + στήλη g)
        0x0a, // 6.O-O (βασιλιάς 0, κωδικός 10)
        0xc1, // 6...e6
        0x74, // 7.Re1 (ο πύργος 7 είναι πια στο f1)
        0x22, // 7...Nc6 (−15)
        0xc1, // 8.h3 (θέση 12 = το πιόνι h2)
        0x35, // 8...Bxf3 (κάτω-αριστερά) — το πιόνι g2 (14) παίρνει τη θέση 6
        0x43, 64 + 21, // 9.Qxf3 (διαγώνια: κωδικός = η στήλη της, δεύτερο byte 64 + f3)
        0xb1, // 9...h6 (θέση 11 = το πιόνι h7)
        0x6f, // 10.g4 (θέση 6 = το πιόνι g2)
        15,
      ),
    );
    expect(text).toBe('1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. Nf3 Nf6 5. Bc4 Bg4 6. O-O e6 7. Re1 Nc6 8. h3 Bxf3 9. Qxf3 h6 10. g4');
  });

  it('ημερομηνίες και ECO όπως στο Scid', () => {
    expect(scidDateToPgn((2013 << 9) | (6 << 5) | 8)).toBe('2013.06.08');
    expect(scidDateToPgn(2013 << 9)).toBe('2013.??.??');
    expect(scidDateToPgn(0)).toBe('????.??.??');
    expect(scidEcoToString(0)).toBe('');
    expect(scidEcoToString(1)).toBe('A00');
    expect(scidEcoToString(132)).toBe('A01');
    expect(scidEcoToString((1 * 100 + 12) * 131 + 1)).toBe('B12');
  });

  it('χαλασμένη εγγραφή: σφάλμα, όχι εξαίρεση', () => {
    expect(decodeScidGame(record(0, 0, 0x5f)).error).toBeTruthy();
    expect(decodeScidGame(Buffer.from([0, 0, 0xcf])).error).toBe('Λείπει το τέλος της παρτίδας');
  });
});
