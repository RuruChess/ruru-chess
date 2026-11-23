import { describe, expect, it } from 'vitest';
import { F_CASTLE, Position, START_FEN, chess960Fen } from '../src/core/chess.ts';
import { moveToToken, tokenToMove } from '../src/core/codec.ts';
import { parseGame, writeGame } from '../src/core/pgn.ts';

// Τιμές επαληθευμένες με το Stockfish 11 (UCI_Chess960, go perft 4)
const PERFT960: Array<[string, number[]]> = [
  ['bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9', [21, 528, 12189]],
  ['2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9', [21, 807, 18002]],
  ['b1q1rrkb/pppppppp/3nn3/8/P7/1PPP4/4PPPP/BQNNRKRB w GE - 1 9', [20, 479, 10471]],
  ['qbbnnrkr/2pp2pp/p7/1p2pp2/8/P3PP2/1PPP1KPP/QBBNNR1R w hf - 0 9', [22, 593, 13440]],
  ['1nbbnrkr/p1p1ppp1/3p4/1p3P1p/3Pq2P/8/PPP1P1P1/QNBBNRKR w HFhf - 0 9', [28, 1120, 31058]],
];

describe('Chess960', () => {
  for (const [fen, counts] of PERFT960) {
    it(`perft ${fen}`, () => {
      const p = Position.fromFen(fen);
      expect(p.chess960).toBe(true);
      counts.forEach((c, i) => expect(p.perft(i + 1)).toBe(c));
    });
  }

  it('βασιλιάς που μένει / πάει στον πύργο (επαληθευμένο perft 4)', () => {
    expect(Position.fromFen('r5kr/pppppppp/8/8/8/8/PPPPPPPP/R5KR w HAha - 0 1').perft(4)).toBe(318326);
    expect(Position.fromFen('rk5r/pppppppp/8/8/8/8/PPPPPPPP/RK5R w HAha - 0 1').perft(4)).toBe(317199);
  });

  it('θέσεις εκκίνησης και X-FEN', () => {
    expect(chess960Fen(518)).toBe(START_FEN);
    expect(chess960Fen(0).split(' ')[0]).toBe('bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR');
    expect(Position.fromFen('2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9').fen().split(' ')[2]).toBe('KQkq');
    // εσωτερικός πύργος: γράμμα στήλης
    expect(Position.fromFen('4k3/8/8/8/8/8/8/1RR1K3 w C - 0 1').fen().split(' ')[2]).toBe('C');
    expect(Position.fromFen('4k3/8/8/8/8/8/8/1RR1K3 w B - 0 1').fen().split(' ')[2]).toBe('Q');
    expect(Position.start().chess960).toBe(false);
  });

  it('ροκέ με τον βασιλιά στη θέση του: SAN, UCI, token, αναίρεση', () => {
    const p = Position.fromFen('r5kr/pppppppp/8/8/8/8/PPPPPPPP/R5KR w HAha - 0 1');
    const before = p.fen();
    const hash = [p.hashHi, p.hashLo];
    const m = p.parseSan('O-O');
    expect(m & F_CASTLE).toBeTruthy();
    expect(p.moveToUci(m)).toBe('g1h1');
    expect(p.parseUci('g1h1')).toBe(m);
    expect(tokenToMove(p, moveToToken(m))).toBe(m);
    p.makeMove(m);
    expect(p.fen().split(' ').slice(0, 3).join(' ')).toBe('r5kr/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 b kq');
    p.unmakeMove();
    expect(p.fen()).toBe(before);
    expect([p.hashHi, p.hashLo]).toEqual(hash);
  });

  it('PGN με Variant', () => {
    const fen = 'r5kr/pppppppp/8/8/8/8/PPPPPPPP/R5KR w KQkq - 0 1';
    const { game } = parseGame(`[Variant "Chess960"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n1. O-O O-O 2. Kh1 Kh8 *`);
    expect(game.plyCount()).toBe(4);
    const out = writeGame(game);
    expect(out).toContain('[Variant "Chess960"]');
    expect(out).toContain('1. O-O O-O 2. Kh1 Kh8');
  });
});
