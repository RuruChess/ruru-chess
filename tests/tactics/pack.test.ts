/** Τεστ: συμπαγής αποθήκευση (θέση, γραμμή, αναγνωριστικά base-62). */
import { describe, expect, it } from 'vitest';
import { Position } from '../../src/core/chess.ts';
import { validateLine } from '../../src/core/puzzle.ts';
import { decodeLichessId, encodeLichessId, LICHESS_ID_LIMIT, otherId, packedBlackToMove, packLine, packPosition, parsePuzzleKey, puzzleKey, unpackFen, unpackLine } from '../../src/server/tactics/pack.ts';

describe('αναγνωριστικά', () => {
  it('base-62 σε σειρά ASCII (όπως είναι ταξινομημένο το αρχείο του Lichess)', () => {
    expect(decodeLichessId('00000')).toBe(0);
    expect(decodeLichessId('00008')).toBe(8);
    expect(decodeLichessId('0000A')).toBe(10);
    expect(decodeLichessId('0000a')).toBe(36);
    expect(decodeLichessId('zzzzz')).toBe(LICHESS_ID_LIMIT - 1);
    expect(decodeLichessId('0000D')).toBeGreaterThan(decodeLichessId('00008'));
    expect(decodeLichessId('1pCmY')).toBeGreaterThan(decodeLichessId('1pClT'));
    expect(decodeLichessId('abc')).toBe(-1);
    expect(decodeLichessId('ab-cd')).toBe(-1);
    for (const s of ['00008', '1pClT', 'zZ09a', 'A0b1C']) expect(encodeLichessId(decodeLichessId(s))).toBe(s);
  });
  it('δημόσια κλειδιά: Lichess ως base-62, άλλες πηγές ως αριθμός', () => {
    expect(puzzleKey(8)).toBe('00008');
    expect(puzzleKey(otherId(30, 771))).toBe('1300000771');
    expect(parsePuzzleKey('1300000771')).toBe(1_300_000_771);
    expect(parsePuzzleKey('00008')).toBe(8);
    expect(parsePuzzleKey('bad')).toBeNaN();
  });
});

describe('θέση', () => {
  const fens = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24',
    'r3k2r/8/8/8/8/8/8/R3K2R b Kq - 99 300',
    'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
    'rnbqkbnr/pppp1ppp/8/8/3Pp3/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 2',
    '8/8/8/8/8/8/8/K6k w - - 0 70',
  ];
  it('πακετάρισμα → FEN ίδιο με το αρχικό', () => {
    for (const fen of fens) {
      const pos = Position.fromFen(fen);
      const buf = packPosition(pos);
      expect(unpackFen(buf)).toBe(fen);
      expect(packedBlackToMove(buf)).toBe(fen.includes(' b '));
    }
  });
  it('μέγεθος: 8 + κομμάτια/2 + 4 bytes', () => {
    expect(packPosition(Position.start()).length).toBe(8 + 16 + 4);
    expect(packPosition(Position.fromFen(fens[5])).length).toBe(8 + 1 + 4);
  });
});

describe('γραμμή', () => {
  it('u16 ανά κίνηση, με ροκέ, προαγωγές και en passant', () => {
    // Lichess 03kqY (υποπροαγωγή σε ίππο)
    const v =validateLine('8/2Q2ppk/4b2p/8/4P3/2p3P1/4KP1P/2r5 w - - 4 49', ['f2f4', 'e6b3', 'e4e5', 'c3c2', 'e5e6', 'f7e6', 'c7c3', 'c1d1', 'c3b3', 'c2c1n', 'e2d1', 'c1b3'], { pre: true });
    expect(v.ok).toBe(true);
    const buf = packLine(v.moves);
    expect(buf.length).toBe(24);
    expect(unpackLine(buf)).toEqual(['f2f4', 'e6b3', 'e4e5', 'c3c2', 'e5e6', 'f7e6', 'c7c3', 'c1d1', 'c3b3', 'c2c1n', 'e2d1', 'c1b3']);
    const c = validateLine('r3k2r/4bppp/p2p4/2pPp3/4P1n1/2N2P1q/PP1BQP1P/R3K2R b KQkq - 6 15', ['g4h2', 'e1c1', 'h3f3', 'h1h2'], { pre: true });
    expect(unpackLine(packLine(c.moves))).toEqual(['g4h2', 'e1c1', 'h3f3', 'h1h2']);
    // ροκέ γραμμένο ως «βασιλιάς παίρνει πύργο» αποθηκεύεται στην κλασική μορφή
    const k = validateLine('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1h1']);
    expect(unpackLine(packLine(k.moves))).toEqual(['e1g1']);
    const ep = validateLine('8/8/3p4/2kP4/1p4P1/2pK4/P7/8 w - - 1 42', ['g4g5', 'c5d5', 'g5g6', 'd5e6', 'g6g7', 'e6f7', 'a2a4', 'b4a3', 'g7g8r', 'f7g8'], { pre: true });
    expect(ep.ok).toBe(true);
    expect(unpackLine(packLine(ep.moves))[7]).toBe('b4a3');
  });
});
