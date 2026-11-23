/** Τεστ: επικύρωση puzzles, έλεγχος απάντησης (εναλλακτικά ματ, μορφές ροκέ), υποδείξεις, τεστ EPD, στόχοι εξάσκησης, θέματα. */
import { describe, expect, it } from 'vitest';
import { Position } from '../../src/core/chess.ts';
import {
  checkAnswer,
  deriveThemes,
  fenProblem,
  hint,
  legalUci,
  parsePracticeGoal,
  practiceOutcome,
  reviewGrade,
  scoreTestAnswer,
  solverColor,
  standardCastling,
  validateLine,
} from '../../src/core/puzzle.ts';

// Lichess 00008 (το πρώτο puzzle του αρχείου)
const P8_FEN = 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24';
const P8_LINE = ['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1'];

// Ματ στην τελευταία γραμμή με δύο πύργους: και το Ra8# και το Rb8# είναι ματ
const BACKRANK_PRE = '6k1/6pp/8/8/8/8/8/RR4K1 b - - 0 1';
const BACKRANK_LINE = ['g8h8', 'a1a8'];

const CASTLE_FEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

describe('επικύρωση', () => {
  it('puzzle του Lichess: πρώτα η κίνηση του αντιπάλου, μετά η λύση', () => {
    const v = validateLine(P8_FEN, P8_LINE, { pre: true });
    expect(v.ok).toBe(true);
    expect(v.solverWhite).toBe(true);
    expect(v.mate).toBe(false);
    expect(v.moves.length).toBe(6);
    expect(solverColor(P8_FEN, true)).toBe('white');
  });
  it('ματ όπου δηλώνεται, αλλιώς απόρριψη', () => {
    expect(validateLine(BACKRANK_PRE, BACKRANK_LINE, { pre: true, requireMate: true }).ok).toBe(true);
    const bad = validateLine(BACKRANK_PRE, ['g8h8', 'a1a7'], { pre: true, requireMate: true });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('notMate');
  });
  it('παράνομη κίνηση και κενή γραμμή', () => {
    const v = validateLine(P8_FEN, ['f2g3', 'e6e8'], { pre: true });
    expect(v.error).toBe('illegal');
    expect(v.detail).toContain('e6e8');
    expect(validateLine(P8_FEN, [], { pre: true }).error).toBe('empty');
    expect(validateLine(P8_FEN, [], { allowEmpty: true }).ok).toBe(true);
  });
  it('άκυρα FEN: δύο βασιλιάδες, πιόνι στην 8η, σαχ στον παίκτη που δεν παίζει', () => {
    expect(validateLine('K6k/8/8/8/8/8/8/K7 w - - 0 1', ['a1a2']).error).toBe('fen');
    expect(validateLine('P6k/8/8/8/8/8/8/K7 w - - 0 1', ['a1a2']).error).toBe('fen');
    expect(validateLine('8/8/8/8/8/8/8/Kk6 w - - 0 1', ['a1a2']).detail).toMatch(/σαχ/);
    expect(validateLine('not a fen', ['a1a2']).error).toBe('fen');
  });
  it('άκυρο en passant σβήνεται, ροκέ εκτός κλασικής διάταξης καθαρίζεται', () => {
    const pos = Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1');
    expect(fenProblem(pos, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e3 0 1')).toBeNull();
    expect(pos.ep).toBe(-1);
    expect(standardCastling('r3k2r/8/8/8/8/8/8/R4K1R w KQkq - 0 1')).toBe('r3k2r/8/8/8/8/8/8/R4K1R w kq - 0 1');
    expect(validateLine('r3k2r/8/8/8/8/8/8/R4K1R w KQkq - 0 1', ['f1g1']).ok).toBe(true);
  });
  it('legalUci: απορρίπτει ξένα κομμάτια και προαγωγή σε μη πιόνι', () => {
    const pos = Position.fromFen(CASTLE_FEN);
    expect(legalUci(pos, 'e8g8')).toBe(0);
    expect(legalUci(pos, 'a1a8q')).toBe(0);
    expect(legalUci(pos, 'e1h1')).not.toBe(0);
    expect(legalUci(pos, 'e1h1')).toBe(legalUci(pos, 'e1g1'));
    expect(legalUci(pos, 'zz')).toBe(0);
  });
});

describe('έλεγχος απάντησης', () => {
  it('σωστή κίνηση → απάντηση αντιπάλου· τελευταία κίνηση → λυμένο', () => {
    const a = checkAnswer(P8_FEN, P8_LINE, 1, 'e6e7');
    expect(a.result).toBe('correct');
    expect(a.reply).toBe('b2b1');
    expect(a.replySan).toBe('Qb1+');
    expect(a.next).toBe(3);
    expect(checkAnswer(P8_FEN, P8_LINE, 3, 'b3c1').result).toBe('correct');
    const end = checkAnswer(P8_FEN, P8_LINE, 5, 'h6c1');
    expect(end.result).toBe('solved');
  });
  it('λάθος κίνηση: η σωστή στο expected', () => {
    const a = checkAnswer(P8_FEN, P8_LINE, 1, 'h6h7');
    expect(a.result).toBe('incorrect');
    expect(a.expected).toBe('e6e7');
    expect(a.expectedSan).toBe('Rxe7');
    expect(a.san).toBe('Qxh7+');
    const illegal = checkAnswer(P8_FEN, P8_LINE, 1, 'a1a8');
    expect(illegal.illegal).toBe(true);
    expect(illegal.result).toBe('incorrect');
  });
  it('κάθε ματ γίνεται δεκτό, όχι μόνο της λύσης', () => {
    expect(checkAnswer(BACKRANK_PRE, BACKRANK_LINE, 1, 'a1a8').result).toBe('solved');
    const alt = checkAnswer(BACKRANK_PRE, BACKRANK_LINE, 1, 'b1b8');
    expect(alt.result).toBe('solved');
    expect(alt.mate).toBe(true);
    expect(checkAnswer(BACKRANK_PRE, BACKRANK_LINE, 1, 'a1a7').result).toBe('incorrect');
  });
  it('ματ στη μέση της λύσης λύνει το puzzle', () => {
    // λύση δύο κινήσεων με σαχ πρώτα, αλλά υπάρχει ματ με την πρώτη κίνηση
    const fen = '6k1/6pp/8/8/8/8/8/RR4K1 w - - 0 1';
    const line = ['a1a7', 'g8h8', 'b1b8'];
    expect(checkAnswer(fen, line, 0, 'b1b8').result).toBe('incorrect'); // ο βασιλιάς στο g8 έχει διαφυγή στο f7; όχι ματ
    const mateFen = '7k/6pp/8/8/8/8/8/RR4K1 w - - 0 1';
    const r = checkAnswer(mateFen, ['a1a7', 'h7h6', 'a7a8'], 0, 'b1b8');
    expect(r.result).toBe('solved');
  });
  it('ροκέ: και ως «βασιλιάς παίρνει πύργο», προς τις δύο κατευθύνσεις', () => {
    expect(checkAnswer(CASTLE_FEN, ['e1g1', 'e8c8', 'a1d1'], 0, 'e1h1').result).toBe('correct');
    expect(checkAnswer(CASTLE_FEN, ['e1h1', 'e8c8', 'a1d1'], 0, 'e1g1').result).toBe('correct');
    const c = checkAnswer(CASTLE_FEN, ['e1g1', 'e8c8', 'a1d1'], 0, 'e1g1');
    expect(c.san).toBe('O-O');
    expect(c.reply).toBe('e8c8');
    expect(c.replySan).toBe('O-O-O');
    // ο λύτης με τα μαύρα (μορφή Lichess): ροκέ e8a8
    expect(checkAnswer(CASTLE_FEN, ['e1g1', 'e8c8'], 1, 'e8a8').result).toBe('solved');
  });
});

describe('υποδείξεις', () => {
  it('κομμάτι → τετράγωνο → κίνηση', () => {
    const h1 = hint(P8_FEN, P8_LINE, 1, 1)!;
    expect(h1.piece.letter).toBe('R');
    expect(h1.piece.el).toBe('Πύργος');
    expect(h1.from).toBe('e6');
    expect(h1.to).toBeUndefined();
    const h2 = hint(P8_FEN, P8_LINE, 1, 2)!;
    expect(h2.to).toBe('e7');
    expect(h2.san).toBeUndefined();
    const h3 = hint(P8_FEN, P8_LINE, 1, 3)!;
    expect(h3.uci).toBe('e6e7');
    expect(h3.san).toBe('Rxe7');
    expect(hint(P8_FEN, P8_LINE, 6, 1)).toBeNull();
  });
});

describe('τεστ EPD', () => {
  it('bm, am και βαθμοί STS', () => {
    const wac = '2rr3k/pp3pp1/1nnqbN1p/3pN3/2pP4/2P3Q1/PPB4P/R4RK1 w - - 0 1';
    expect(scoreTestAnswer(wac, { kind: 'test', bm: ['g3g6'] }, 'g3g6').correct).toBe(true);
    expect(scoreTestAnswer(wac, { kind: 'test', bm: ['g3g6'] }, 'g3h3').correct).toBe(false);
    const sts = '1kr5/3n4/q3p2p/p2n2p1/PppB1P2/5BP1/1P2Q2P/3R2K1 w - - 0 1';
    const goal = { kind: 'test' as const, bm: ['f4f5'], points: { f4f5: 10, d4e5: 2, d4f2: 3, f3g4: 2 } };
    expect(scoreTestAnswer(sts, goal, 'f4f5')).toMatchObject({ correct: true, points: 10, max: 10 });
    expect(scoreTestAnswer(sts, goal, 'd4f2')).toMatchObject({ correct: false, points: 3 });
    expect(scoreTestAnswer(sts, goal, 'e2e4')).toMatchObject({ correct: false, points: 0 });
    const am = scoreTestAnswer(wac, { kind: 'test', bm: [], am: ['g3g6'] }, 'g3g6');
    expect(am.correct).toBe(false);
  });
});

describe('στόχοι εξάσκησης (Lichess Practice)', () => {
  it('γραμματική του [Termination]', () => {
    expect(parsePracticeGoal('mate in 2')).toEqual({ kind: 'mateIn', moves: 2 });
    expect(parsePracticeGoal('Checkmate in 3')).toEqual({ kind: 'mateIn', moves: 3 });
    expect(parsePracticeGoal('mate')).toEqual({ kind: 'mate' });
    expect(parsePracticeGoal('+200cp in 2')).toEqual({ kind: 'evalIn', cp: 200, moves: 2 });
    expect(parsePracticeGoal('-500cp  in 3')).toEqual({ kind: 'evalIn', cp: -500, moves: 3 });
    expect(parsePracticeGoal('promotion with +100cp')).toEqual({ kind: 'promotion', cp: 100 });
    expect(parsePracticeGoal('equalize in 30')).toEqual({ kind: 'equalIn', moves: 30 });
    expect(parsePracticeGoal('Draw in 10')).toEqual({ kind: 'drawIn', moves: 10 });
    expect(parsePracticeGoal('κάτι άλλο')).toEqual({ kind: 'mate' });
    expect(parsePracticeGoal(undefined)).toEqual({ kind: 'mate' });
  });
  it('πότε πέτυχε ή απέτυχε', () => {
    const m2 = { kind: 'mateIn' as const, moves: 2 };
    expect(practiceOutcome(m2, { solverMoves: 1, status: 'ongoing' })).toBeNull();
    expect(practiceOutcome(m2, { solverMoves: 2, status: 'checkmate' })).toBe(true);
    expect(practiceOutcome(m2, { solverMoves: 2, status: 'ongoing' })).toBe(false);
    expect(practiceOutcome(m2, { solverMoves: 1, status: 'checkmate', matedSolver: true })).toBe(false);
    const ev = { kind: 'evalIn' as const, cp: 200, moves: 2 };
    expect(practiceOutcome(ev, { solverMoves: 2, status: 'ongoing', cp: 250 })).toBe(true);
    expect(practiceOutcome(ev, { solverMoves: 2, status: 'ongoing', cp: 100 })).toBe(false);
    expect(practiceOutcome(ev, { solverMoves: 2, status: 'ongoing', mate: 3 })).toBe(true);
    const dr = { kind: 'drawIn' as const, moves: 10 };
    expect(practiceOutcome(dr, { solverMoves: 10, status: 'ongoing', cp: 40 })).toBe(true);
    expect(practiceOutcome(dr, { solverMoves: 10, status: 'ongoing', cp: 400 })).toBe(false);
    expect(practiceOutcome(dr, { solverMoves: 3, status: 'stalemate' })).toBe(true);
    const pr = { kind: 'promotion' as const, cp: 100 };
    expect(practiceOutcome(pr, { solverMoves: 3, status: 'ongoing', cp: 150, promoted: true })).toBe(true);
    expect(practiceOutcome(pr, { solverMoves: 3, status: 'ongoing', cp: 150 })).toBeNull();
  });
});

describe('θέματα από τη γραμμή', () => {
  const codes = (fen: string, line: string[]) => {
    const v = validateLine(fen, line);
    expect(v.ok).toBe(true);
    return { start: v.start!, moves: v.moves };
  };
  it('ματ σε 2 (σύνθεση του Sadier)', () => {
    const { start, moves } = codes('8/8/8/8/1Q6/1K6/8/2Nk4 w - - 0 1', ['b4a5', 'd1c1', 'a5e1']);
    const tags = deriveThemes(start, moves, false);
    expect(tags).toEqual(expect.arrayContaining(['mate', 'mateIn2', 'short', 'endgame']));
  });
  it('en passant και φινάλε πιονιών', () => {
    const { start, moves } = codes('k7/8/8/3pP3/8/8/8/K7 w - d6 0 1', ['e5d6']);
    expect(deriveThemes(start, moves, false)).toEqual(expect.arrayContaining(['enPassant', 'oneMove', 'pawnEndgame', 'endgame']));
  });
  it('ροκέ, υποπροαγωγή', () => {
    const c = codes(CASTLE_FEN, ['e1g1']);
    expect(deriveThemes(c.start, c.moves, false)).toContain('castling');
    const p = codes('8/5P1k/8/8/8/8/8/K7 w - - 0 1', ['f7f8n']);
    expect(deriveThemes(p.start, p.moves, false)).toEqual(expect.arrayContaining(['promotion', 'underPromotion']));
  });
  it('μορφή Lichess: μήκος από τις κινήσεις του λύτη', () => {
    const v = validateLine(P8_FEN, P8_LINE, { pre: true });
    expect(deriveThemes(v.start!, v.moves, true)).toContain('long');
  });
});

describe('βαθμός FSRS από την προσπάθεια', () => {
  it('αποτυχία → Again, υπόδειξη/αργή → Hard, κανονική → Good, γρήγορη → Easy', () => {
    expect(reviewGrade({ win: false, hints: 0, ms: 1000, medianMs: 10_000 })).toBe(1);
    expect(reviewGrade({ win: true, hints: 1, ms: 1000, medianMs: 10_000 })).toBe(2);
    expect(reviewGrade({ win: true, hints: 0, ms: 25_000, medianMs: 10_000 })).toBe(2);
    expect(reviewGrade({ win: true, hints: 0, ms: 9000, medianMs: 10_000 })).toBe(3);
    expect(reviewGrade({ win: true, hints: 0, ms: 4000, medianMs: 10_000 })).toBe(4);
    expect(reviewGrade({ win: true, hints: 0, ms: 4000, medianMs: null })).toBe(3);
  });
});
