import { describe, expect, it } from 'vitest';
import { addLine, lineText, mainLine, nameMatches, newRoot, prepSource, prepSpeed, pruneTree, renameInPgn, sameName, scorePct, speedOfTimeControl, weakLines } from '../src/core/prep.ts';
import { parseGames } from '../src/core/pgn.ts';

describe('ρυθμός και πηγή', () => {
  it('TimeControl με τα όρια του Lichess (βάση + 40 × προσθήκη)', () => {
    expect(speedOfTimeControl('60+0')).toBe('bullet');
    expect(speedOfTimeControl('120+1')).toBe('bullet');
    expect(speedOfTimeControl('180+2')).toBe('blitz');
    expect(speedOfTimeControl('600+0')).toBe('rapid');
    expect(speedOfTimeControl('900+10')).toBe('rapid');
    expect(speedOfTimeControl('1800+0')).toBe('classical');
    expect(speedOfTimeControl('1/86400')).toBe('daily');
    expect(speedOfTimeControl('-')).toBe('daily');
    expect(speedOfTimeControl('')).toBe(null);
  });
  it('χωρίς TimeControl: από το τουρνουά (OTB κλασικό)', () => {
    expect(prepSpeed({ Event: 'Tata Steel Masters' })).toBe('classical');
    expect(prepSpeed({ Event: 'World Blitz 2025' })).toBe('blitz');
    expect(prepSpeed({ Event: 'Greek Rapid Ch' })).toBe('rapid');
  });
  it('πηγή από το Site', () => {
    expect(prepSource({ Site: 'https://lichess.org/abcd1234' })).toBe('lichess');
    expect(prepSource({ Site: 'Chess.com', Event: 'Live Chess' })).toBe('chesscom');
    expect(prepSource({ Site: 'Wijk aan Zee NED' })).toBe('otb');
  });
});

describe('όνομα αντιπάλου', () => {
  it('το username γίνεται το όνομα, και μένει ως WhiteAccount / BlackAccount', () => {
    const pgn = '[Event "Rated blitz game"]\n[White "DrNykterstein"]\n[Black "someone"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
    const out = renameInPgn(pgn, 'drnykterstein', 'Carlsen, Magnus');
    const g = parseGames(out)[0].game;
    expect(g.headers.White).toBe('Carlsen, Magnus');
    expect(g.headers.WhiteAccount).toBe('DrNykterstein');
    expect(g.headers.Black).toBe('someone');
  });
  it('ονόματα με οποιαδήποτε σειρά, χωρίς τόνους', () => {
    expect(nameMatches('Magnus Carlsen', 'Carlsen, Magnus')).toBe(true);
    expect(nameMatches('Carlsen M', 'Carlsen, Magnus')).toBe(true);
    expect(nameMatches('Carlsen, Magnus', 'Carlsen, Henrik')).toBe(false);
    expect(nameMatches('Μπανίκας', 'Μπανικας, Χρήστος')).toBe(true);
    expect(sameName('carlsen,  magnus', 'Carlsen, Magnus')).toBe(true);
    expect(sameName('Carlsen, M', 'Carlsen, Magnus')).toBe(false);
  });
});

describe('δέντρο ρεπερτορίου', () => {
  const tree = () => {
    const root = newRoot();
    addLine(root, ['e4', 'c5', 'Nf3'], 1, 20250101);
    addLine(root, ['e4', 'c5', 'Nf3'], 0, 20250201);
    addLine(root, ['e4', 'c5', 'Nf3'], 0, 20250301);
    addLine(root, ['e4', 'c5', 'Nc3'], 0.5, 20250401);
    addLine(root, ['d4', 'Nf6'], 1, 20240101);
    return root;
  };
  it('μετρά παρτίδες, σκορ και τελευταία ημερομηνία', () => {
    const r = tree();
    expect(r.n).toBe(5);
    const e4 = r.c!.find((x) => x.m === 'e4')!;
    expect([e4.n, e4.w, e4.d, e4.l, e4.last]).toEqual([4, 1, 1, 2, 20250401]);
    expect(scorePct(e4)).toBe(38);
  });
  it('κλάδεμα: βαθιά μόνο όσα παίχτηκαν ≥ 2 φορές, οι συχνότερες πρώτες', () => {
    const r = pruneTree(tree(), 2);
    expect(r.c!.map((x) => x.m)).toEqual(['e4', 'd4']);
    const c5 = r.c![0].c![0];
    expect(c5.c!.map((x) => x.m)).toEqual(['Nf3']);
  });
  it('κύρια γραμμή, αδύνατα σημεία και κείμενο γραμμής', () => {
    const r = tree();
    expect(mainLine(r)).toEqual(['e4', 'c5', 'Nf3']);
    const weak = weakLines(r, 3, 40);
    expect(weak.map((x) => x.sans.join(' '))).toEqual(['e4 c5 Nf3']);
    expect(lineText(['e4', 'c5', 'Nf3'])).toBe('1.e4 c5 2.Nf3');
  });
});
