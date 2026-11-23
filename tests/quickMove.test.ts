/** Γρήγορο παιχνίδι στη σκακιέρα: κίνηση με ένα κλικ (ποιο κομμάτι) και στόχοι της προ-κίνησης. */
import { describe, expect, it } from 'vitest';
import { Position, START_FEN, moveTo, parseSquare, playSan, squareName } from '../src/core/chess.ts';
import { oneClickFroms, premoveTargets } from '../src/web/components/quickMove.ts';

/** Από πού ξεκινά η κίνηση με ένα κλικ στο `to` (ονόματα τετραγώνων, ταξινομημένα). */
function froms(pos: Position, to: string): string[] {
  const sq = parseSquare(to);
  const cands = pos.legalMoves().filter((m) => moveTo(m) === sq);
  return oneClickFroms(cands, pos.board).map(squareName).sort();
}

const targets = (fen: string, from: string) => [...premoveTargets(Position.fromFen(fen), parseSquare(from))].map(squareName).sort();

describe('κίνηση με ένα κλικ', () => {
  it('ένα μόνο κομμάτι: αυτό', () => {
    expect(froms(Position.fromFen(START_FEN), 'e4')).toEqual(['e2']);
  });

  it('απλή κίνηση με πιόνι ή ίππο (f3, c6): δεν μαντεύει, διαλέγει ο χρήστης', () => {
    expect(froms(Position.fromFen(START_FEN), 'f3')).toEqual(['f2', 'g1']);
    expect(froms(playSan(START_FEN, ['e4']), 'c6')).toEqual(['b8', 'c7']);
  });

  it('φάγωμα: το φθηνότερο κομμάτι (πιόνι πριν από ίππο)', () => {
    // 1.e4 d5 2.Nc3 Nf6 3.Qf3 Bg4: στο d5 τρώνε το e4 και ο Nc3
    const pos = playSan(START_FEN, ['e4', 'd5', 'Nc3', 'Nf6', 'Qf3', 'Bg4']);
    expect(froms(pos, 'd5')).toEqual(['e4']);
  });

  it('φάγωμα: πύργος πριν από βασίλισσα', () => {
    // Rd1xd8 ή Qa5xd8
    expect(froms(Position.fromFen('3r2k1/5ppp/8/Q7/8/8/5PPP/3R2K1 w - - 0 1'), 'd8')).toEqual(['d1']);
  });

  it('ισοπαλία: ίππος ή αξιωματικός, δύο ίδια κομμάτια (Rad1 / Rfd1, Nbd2 / Nfd2): διαλέγει ο χρήστης', () => {
    // Bb3xd5 ή Nc3xd5
    expect(froms(Position.fromFen('6k1/8/8/3p4/8/1BN5/8/6K1 w - - 0 1'), 'd5')).toEqual(['b3', 'c3']);
    // Ra8xd8 ή Rd1xd8
    expect(froms(Position.fromFen('R2r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'), 'd8')).toEqual(['a8', 'd1']);
    expect(froms(Position.fromFen('k7/8/8/8/8/8/5PPP/R4RK1 w - - 0 1'), 'd1')).toEqual(['a1', 'f1']);
    expect(froms(Position.fromFen('k7/8/8/8/8/5N2/8/1N4K1 w - - 0 1'), 'd2')).toEqual(['b1', 'f3']);
  });

  it('en passant: το πιόνι πριν από κομμάτι που πάει στο ίδιο τετράγωνο', () => {
    // exd6 e.p. ή Nc4-d6
    const pos = Position.fromFen('rnbqkbnr/1pp1pppp/p7/3pP3/2N5/8/PPPP1PPP/R1BQKBNR w KQkq d6 0 4');
    expect(froms(pos, 'd6')).toEqual(['e5']);
  });
});

describe('στόχοι της προ-κίνησης', () => {
  it('ίππος: και πάνω σε δικό μας κομμάτι (ξαναπαίρνω αν φαγωθεί)', () => {
    expect(targets(START_FEN, 'g1')).toEqual(['e2', 'f3', 'h3']);
  });

  it('πιόνι: μπροστά (δύο από τη 2η) και διαγώνια, όχι πάνω σε δικό μας κομμάτι', () => {
    expect(targets(START_FEN, 'e2')).toEqual(['d3', 'e3', 'e4', 'f3']);
    expect(targets(START_FEN, 'a2')).toEqual(['a3', 'a4', 'b3']);
    expect(targets(START_FEN, 'e7')).toEqual(['d6', 'e5', 'e6', 'f6']);
    // δικό μας κομμάτι μπροστά: μόνο τα διαγώνια
    expect(targets('4k3/8/8/8/8/4N3/4P3/4K3 w - - 0 1', 'e2')).toEqual(['d3', 'f3']);
    // κομμάτι του αντιπάλου μπροστά: μπορεί να φύγει
    expect(targets('4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1', 'e2')).toEqual(['d3', 'e3', 'e4', 'f3']);
  });

  it('γραμμές: περνούν από κομμάτια του αντιπάλου, σταματούν σε δικό μας', () => {
    expect(targets(START_FEN, 'a1')).toEqual(['a2', 'b1']);
    expect(targets(START_FEN, 'c1')).toEqual(['b2', 'd2']);
    // πύργος a1 με πιόνι του αντιπάλου στο a5: ως το a8
    expect(targets('4k3/8/8/p7/8/8/8/R3K3 w - - 0 1', 'a1').filter((s) => s[0] === 'a')).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
  });

  it('βασιλιάς: γύρω του και ροκέ όσο υπάρχει το δικαίωμα', () => {
    expect(targets('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1')).toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1']);
    expect(targets('r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1', 'e1')).toEqual(['d1', 'd2', 'e2', 'f1', 'f2', 'g1']);
    expect(targets('r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1', 'e8')).toEqual(['c8', 'd7', 'd8', 'e7', 'f7', 'f8']);
  });

  it('η προ-κίνηση κρίνεται μόλις έρθει η σειρά μας', () => {
    // 1.e4 e5 2.Nf3, προ-κίνηση των μαύρων Nb8-c6: νόμιμη
    const pos = playSan(START_FEN, ['e4', 'e5', 'Nf3']);
    expect(pos.findMove(parseSquare('b8'), parseSquare('c6'))).not.toBe(0);
    // προ-κίνηση των λευκών Ng1-e2 με το πιόνι ακόμη στο e2: άκυρη, σβήνει
    expect(Position.fromFen(START_FEN).findMove(parseSquare('g1'), parseSquare('e2'))).toBe(0);
  });
});
