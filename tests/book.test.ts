import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Position, playSan, START_FEN } from '../src/core/chess.ts';
import { bookMoves, polyglotKey, polyglotMove, writeBook } from '../src/server/book.ts';

// Τα επίσημα παραδείγματα της μορφής βιβλίων Polyglot
const CASES: Array<[string[], string]> = [
  [[], '463b96181691fc9c'],
  [['e4'], '823c9b50fd114196'],
  [['e4', 'd5'], '0756b94461c50fb0'],
  [['e4', 'd5', 'e5'], '662fafb965db29d4'],
  [['e4', 'd5', 'e5', 'f5'], '22a48b5a8e47ff78'],
  [['e4', 'd5', 'e5', 'f5', 'Ke2'], '652a607ca3f242c1'],
  [['e4', 'd5', 'e5', 'f5', 'Ke2', 'Kf7'], '00fdd303c946bdd9'],
  [['a4', 'b5', 'h4', 'b4', 'c4'], '3c8123ea7b067637'],
  [['a4', 'b5', 'h4', 'b4', 'c4', 'bxc3', 'Ra3'], '5c3f9b829b279560'],
];

describe('Polyglot', () => {
  for (const [moves, want] of CASES) {
    it(moves.join(' ') || 'αρχική θέση', () => {
      const pos = moves.length ? playSan(START_FEN, moves) : Position.start();
      expect(polyglotKey(pos).toString(16).padStart(16, '0')).toBe(want);
    });
  }
});

describe('Polyglot: εγγραφή βιβλίου', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-book-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('κωδικοποίηση κινήσεων όπως η μορφή Polyglot', () => {
    const start = Position.start();
    expect(polyglotMove(start.parseUci('e2e4'))).toBe((4 | (3 << 3)) | ((4 | (1 << 3)) << 6));
    const castle = playSan(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    // O-O ως e1h1
    expect(polyglotMove(castle.parseSan('O-O'))).toBe(7 | (4 << 6));
    const promo = Position.fromFen('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1');
    // e7e8=N: προαγωγή 1
    expect(polyglotMove(promo.parseUci('e7e8n')) >> 12).toBe(1);
  });

  it('γράφει και ξαναδιαβάζει (με ροκέ και κλιμάκωση βαρών)', () => {
    const start = Position.start();
    const castle = playSan(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
    const file = path.join(dir, 'test.bin');
    const n = writeBook(file, [
      { key: polyglotKey(start), move: polyglotMove(start.parseUci('d2d4')), weight: 100_000 },
      { key: polyglotKey(start), move: polyglotMove(start.parseUci('e2e4')), weight: 200_000 },
      { key: polyglotKey(castle), move: polyglotMove(castle.parseSan('O-O')), weight: 7 },
    ]);
    expect(n).toBe(3);
    expect(fs.statSync(file).size).toBe(48);
    const a = bookMoves(file, START_FEN);
    expect(a.map((m) => [m.san, m.weight])).toEqual([
      ['e4', 65535],
      ['d4', 32768],
    ]);
    expect(bookMoves(file, castle.fen()).map((m) => m.san)).toEqual(['O-O']);
  });
});
