import { describe, expect, it } from 'vitest';
import { Position, START_FEN, playSan, NULL_MOVE } from '../src/core/chess.ts';

// Κλασικές θέσεις perft (chessprogramming.org)
const PERFT: Array<[string, number[]]> = [
  [START_FEN, [20, 400, 8902, 197281, 4865609]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890, 3894594]],
];

describe('perft', () => {
  for (const [fen, counts] of PERFT) {
    it(fen, () => {
      const p = Position.fromFen(fen);
      counts.forEach((c, i) => expect(p.perft(i + 1)).toBe(c));
      expect(p.fen().split(' ').slice(0, 3)).toEqual(fen.split(' ').slice(0, 3));
    });
  }
});

describe('hash', () => {
  it('το σταδιακό hash ταιριάζει με τον πλήρη υπολογισμό', () => {
    const p = Position.fromFen(PERFT[1][0]);
    const walk = (d: number) => {
      if (!d) return;
      for (const m of p.legalMoves()) {
        p.makeMove(m);
        const hi = p.hashHi;
        const lo = p.hashLo;
        p.computeHash();
        expect([p.hashHi, p.hashLo]).toEqual([hi, lo]);
        walk(d - 1);
        p.unmakeMove();
      }
    };
    walk(3);
  });

  it('μεταθέσεις δίνουν ίδιο hash', () => {
    const a = playSan(START_FEN, ['Nf3', 'Nf6', 'g3', 'g6']);
    const b = playSan(START_FEN, ['g3', 'g6', 'Nf3', 'Nf6']);
    expect(a.hashKey()).toBe(b.hashKey());
    // e4 χωρίς δυνατό ep = ίδια θέση με e3-e4 σε δύο βήματα
    const c = playSan(START_FEN, ['e4', 'Nf6', 'Nc3', 'Ng8', 'Nb1']);
    const d = playSan(START_FEN, ['e3', 'Nf6', 'e4', 'Ng8']);
    expect(c.board).toEqual(d.board);
  });
});

describe('SAN', () => {
  it('παράγει και διαβάζει SAN', () => {
    const p = Position.start();
    const line = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7'];
    for (const s of line) {
      const m = p.parseSan(s);
      expect(m, s).not.toBe(0);
      expect(p.san(m)).toBe(s);
      p.makeMove(m);
    }
  });

  it('αποσαφήνιση, προαγωγές, ep, ματ', () => {
    const p = Position.fromFen('4k3/1P6/8/3pP3/8/8/8/R3K2R w KQ d6 0 1');
    expect(p.san(p.parseSan('exd6'))).toBe('exd6');
    expect(p.parseSan('exd6') & (1 << 18)).toBeTruthy();
    expect(p.san(p.parseSan('b8=Q'))).toBe('b8=Q+');
    expect(p.san(p.parseSan('b8N'))).toBe('b8=N');
    expect(p.san(p.parseSan('O-O-O'))).toBe('O-O-O');
    const q = Position.fromFen('7k/8/8/8/8/8/8/R4RK1 w - - 0 1');
    expect(q.san(q.parseSan('Rad1'))).toBe('Rad1');
    expect(q.san(q.parseSan('Rfd1'))).toBe('Rfd1');
    const mate = Position.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(mate.san(mate.parseSan('Ra8'))).toBe('Ra8#');
    const r = Position.fromFen('7k/8/8/8/R7/8/8/R3K3 w - - 0 1');
    expect(r.san(r.parseSan('R1a2'))).toBe('R1a2');
    expect(r.parseSan('Ra2')).not.toBe(0);
  });

  it('ανεκτική ανάγνωση', () => {
    const p = Position.start();
    expect(p.parseSan('Ng1f3')).toBe(p.parseSan('Nf3'));
    expect(p.parseSan('0-0')).toBe(0);
    expect(p.parseSan('e5')).toBe(0);
    expect(p.parseSan('--')).toBe(NULL_MOVE);
    expect(p.parseSan('Nf3!?')).toBe(p.parseSan('Nf3'));
  });

  it('καρφωμένο κομμάτι δεν χρειάζεται αποσαφήνιση', () => {
    // ο ίππος στο e2 είναι καρφωμένος, άρα «Nc3» είναι μοναδικό
    const p = Position.fromFen('4k3/4r3/8/8/8/8/4N3/1N2K3 w - - 0 1');
    expect(p.san(p.parseSan('Nc3'))).toBe('Nc3');
  });
});

describe('FEN', () => {
  it('στρογγυλό ταξίδι', () => {
    for (const [fen] of PERFT) expect(Position.fromFen(fen).fen()).toBe(fen);
  });
  it('απορρίπτει άκυρο FEN', () => {
    expect(() => Position.fromFen('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow();
  });
});
