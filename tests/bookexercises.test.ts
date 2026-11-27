import { describe, expect, it } from 'vitest';
import { findDiagrams, type Item } from '../src/server/books/diagrams.ts';
import { parseBook, type BookDiagram, type BookParagraph } from '../src/core/bookparse.ts';

// Σκακιέρα σε γραμματοσειρά Alpha/Merida όπως τη δίνει το pdf.js: χαρακτήρες U+F0xx, χωρίς τα κενά (λευκά τετράγωνα)
const pua = (s: string) => [...s].map((c) => String.fromCharCode(0xf000 + c.charCodeAt(0))).join('');
function boardItems(rows: string[], x: number, top: number, cell = 18): Item[] {
  const items: Item[] = [];
  rows.forEach((r, i) => {
    for (const m of r.matchAll(/\S+/g)) items.push({ str: pua(m[0]), x: x + m.index * cell, y: top - i * cell, w: m[0].length * cell, size: cell, font: 'diagram' });
  });
  return items;
}
// 6k1/5ppp/8/8/8/8/8/R5K1: πλαίσιο, συντεταγμένες (À…Ç, È…Ï), κομμάτια σε λευκά (πεζά) και μαύρα (κεφαλαία) τετράγωνα
const ROWS = ['1222222223', 'Ç + + +l+5', 'Æ+ + +oOo5', 'Å + + + +5', 'Ä+ + + + 5', 'Ã + + + +5', 'Â+ + + + 5', 'Á + + + +5', 'ÀR + + K 5', '7ÈÉÊËÌÍÎÏ9'];

const text = (t: string, x: number, y: number): Item => ({ str: t, x, y, w: t.length * 5, size: 10, font: 'text' });
const para = (t: string, extra: Partial<BookParagraph> = {}): BookParagraph => ({ page: 2, indent: 0, heading: false, caption: false, runs: [{ text: t, main: false }], text: t, ...extra });
const diagram = (d: Partial<BookDiagram> & { placement: string }, page = 1): BookParagraph => ({ ...para('', { page }), diagram: { turn: null, label: null, caption: '', ...d } });

describe('Βιβλία ασκήσεων', () => {
  it('διάγραμμα σε γραμματοσειρά σκακιού: θέση, αριθμός, επικεφαλίδα, ποιος παίζει', () => {
    const items = [...boardItems(ROWS, 40, 600), text('1', 20, 584), text('Smith – Jones, London 1900', 40, 620), { str: pua('r'), x: 202, y: 456, w: 12, size: 15, font: 'marker' }, text('Some prose under the board.', 40, 380)];
    const { diagrams, rest } = findDiagrams(items);
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].diagram).toMatchObject({ placement: '6k1/5ppp/8/8/8/8/8/R5K1', label: '1', caption: 'Smith – Jones, London 1900', turn: 'w' });
    expect(rest.map((i) => i.str)).toEqual(['Some prose under the board.']);
  });

  it('οι λύσεις στο τέλος του βιβλίου ενώνονται με τις ασκήσεις τους (FEN, κινήσεις, αποτέλεσμα)', () => {
    const res = parseBook(
      [
        diagram({ placement: '6k1/5ppp/8/8/8/8/8/R5K1', label: '1', caption: 'Smith – Jones, London 1900', turn: 'w' }),
        diagram({ placement: '6k1/8/8/8/8/8/r4PPP/6K1', label: '2', caption: 'Brown – Green, Paris 1910', turn: 'b' }),
        para('Solutions', { heading: true }),
        para('1. John Smith – Bill Jones, London 1900 30.Ra8 mate 1–0'),
        para('2. Tom Brown – Joe Green, Paris 1910 Black mates on the back rank: 25...Ra1 mate'),
      ],
      { title: 'Test', author: '' },
    );
    const ex = res.games.filter((g) => g.headers.Exercise);
    expect(ex.map((g) => [g.headers.Exercise, g.headers.White, g.headers.Black, g.headers.Site, g.headers.Date, g.headers.Result])).toEqual([
      ['1', 'Smith, John', 'Jones, Bill', 'London', '1900.??.??', '1-0'],
      ['2', 'Brown, Tom', 'Green, Joe', 'Paris', '1910.??.??', '*'],
    ]);
    expect(res.pgn).toContain('[FEN "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 30"]');
    expect(res.pgn).toContain('30. Ra8# 1-0');
    expect(res.pgn).toContain('[FEN "6k1/8/8/8/8/8/r4PPP/6K1 b - - 0 25"]');
    expect(res.pgn).toContain('{Black mates on the back rank:} 25... Ra1#');
  });

  it('η λύση βρίσκει την άσκησή της και από τους παίκτες της λεζάντας (αριθμοί που πήγαν στη διπλανή σκακιέρα)', () => {
    const res = parseBook(
      [
        diagram({ placement: '6k1/5ppp/8/8/8/8/8/R5K1', label: '2', caption: 'Smith – Jones, London 1900', turn: 'w' }),
        diagram({ placement: '6k1/8/8/8/8/8/r4PPP/6K1', label: '1', caption: 'Brown – Green, Paris 1910', turn: 'b' }),
        para('Solutions', { heading: true }),
        para('1. John Smith – Bill Jones, London 1900 30.Ra8 mate 1–0'),
        para('2. Tom Brown – Joe Green, Paris 1910 Black mates on the back rank: 25...Ra1 mate'),
      ],
      { title: 'Test', author: '' },
    );
    expect(res.pgn).toContain('30. Ra8# 1-0');
    expect(res.pgn).toContain('25... Ra1#');
  });

  it('διάγραμμα-εικόνα χωρίς αριθμό και λεζάντα: η λύση το βρίσκει από τους παίκτες της γραμμής από πάνω του', () => {
    const res = parseBook(
      [
        diagram({ placement: '6k1/8/8/8/8/8/r4PPP/6K1', label: '1', caption: 'Brown – Green, Paris 1910', turn: 'b', id: 0 }),
        para('Smith – Jones, London 1900', { page: 1 }),
        diagram({ placement: '6k1/5ppp/8/8/8/8/8/R5K1', turn: 'w', id: 1 }),
        diagram({ placement: '6k1/5ppp/8/8/8/8/8/R5K1', label: '3', caption: 'White – Black, Rome 1950', turn: 'w', id: 2 }),
        para('Solutions', { heading: true }),
        para('1. Tom Brown – Joe Green, Paris 1910 Black mates on the back rank: 25...Ra1 mate'),
        para('2. John Smith – Bill Jones, London 1900 30.Ra8 mate 1–0'),
      ],
      { title: 'Test', author: '' },
    );
    expect(res.pgn).toContain('25... Ra1#');
    expect(res.pgn).toContain('30. Ra8# 1-0');
  });

  it('κωδικοί ασκήσεων κάτω από το διάγραμμα («W», «E3.01 **/»): οι λύσεις στο τέλος με τον ίδιο κωδικό', () => {
    const ex = (placement: string, code: string, id: number) => [diagram({ placement, id }), para('W', { page: 1 }), para(`${code} **/`, { page: 1 }), para('How does White win?', { page: 1 })];
    const res = parseBook(
      [
        ...ex('6k1/5ppp/8/8/8/8/8/R5K1', 'E3.01', 0),
        ...ex('7k/8/6K1/8/8/8/8/1Q6', 'E3.02', 1),
        ...ex('7k/8/6K1/8/8/8/8/R7', 'E3.03', 2),
        para('Solutions', { heading: true }),
        para('E3.01 A. Smith – B. Jones, London 1900 1 Ra8 mate'),
        para('E3.02 1 Qb8 mate'),
      ],
      { title: 'Test', author: '' },
    );
    expect(res.pgn).toContain('1. Ra8#');
    expect(res.pgn).toContain('1. Qb8#');
  });

  it('αριθμοί με τυπογραφικό λάθος στη σελίδα (625, 262, 267, 628…) διορθώνονται από τη σειρά· οι ασκήσεις με αριθμητική σειρά', () => {
    const p = '6k1/5ppp/8/8/8/8/8/R5K1';
    const at = (label: string, x: number, y: number) => diagram({ placement: p, label, x, y });
    const res = parseBook([at('625', 60, 600), at('628', 280, 600), at('262', 60, 400), at('629', 280, 400), at('267', 60, 200), at('630', 280, 200)], { title: 'T', author: '' });
    expect(res.games.map((g) => g.headers.Exercise)).toEqual(['625', '626', '627', '628', '629', '630']);
  });

  it('οι βαριάντες της λύσης (κύρια γραμμή σε έντονα): «x» στη σωστή θέση, κίνηση πιο πίσω που ξεκινά γραμμή, «a)/b)» μέσα στην παράγραφο', () => {
    // κομμάτια με εναλλάξ απλά / έντονα γράμματα
    const sol = (...parts: string[]): BookParagraph => ({ ...para(''), runs: parts.map((text, i) => ({ text, main: i % 2 === 1 })), text: parts.join('') });
    const res = parseBook(
      [
        diagram({ placement: '6k1/5ppp/5q2/8/8/5N2/5PPP/3Q2K1', label: '1', caption: 'Example – Sample, Athens 2001', turn: 'b' }),
        diagram({ placement: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR', label: '2', caption: 'Test – Trial, Volos 2002', turn: 'w' }),
        para('Solutions', { heading: true }),
        // «2.Nxh4» μετά το 1...Qh4 (κομμάτι στο h4), όχι μετά το 1...Qh6 που διαβάστηκε πιο πρόσφατα
        sol('1. Ann Example – Bob Sample, Athens 2001 ', '1...Qh4!', ' 1...Qh6 defends the h-pawn. However, Black should avoid: 1...Qa1? 2.Qxa1', ' 2.Qe2', ' Simple. 2.Nxh4 wins the queen.', ' 2...Qe4'),
        sol(
          '2. Carl Test – Dan Trial, Volos 2002 ',
          '2.Nf3! Nc6 3.Bc4',
          ' 3.Bb5 a6 4.Ba4 Nf6 5.O-O is the Ruy Lopez. Relatively best is 2...d6 when White plays 3.d4 exd4 4.Qxd4 or 3...Nf6 4.dxe5. But 2...f5 is trickier. White has two options: a) 3.exf5 e4 is messy. b) 3.Nxe5 (or 3.d3) 3...Qf6 4.d4 d6 5.Nc4 wins.',
          ' 3...Bc5',
        ),
      ],
      { title: 'T', author: '' },
    );
    const bare = (g: number) => res.pgn.split(/\n(?=\[Event )/)[g].replace(/^\[.*\n/gm, '').replace(/\{[^}]*\}\s*/g, '').replace(/\s+/g, ' ').replace(/ \)/g, ')').trim();
    expect(bare(0)).toBe('1... Qh4 $1 (1... Qh6) (1... Qa1 $2 2. Qxa1) 2. Qe2 (2. Nxh4) 2... Qe4 *');
    expect(bare(1)).toBe('2. Nf3 $1 Nc6 (2... d6 3. d4 exd4 (3... Nf6 4. dxe5) 4. Qxd4) (2... f5 3. exf5 (3. Nxe5 Qf6 4. d4 d6 5. Nc4) (3. d3) 3... e4) 3. Bc4 (3. Bb5 a6 4. Ba4 Nf6 5. O-O) 3... Bc5 *');
    expect(res.stats.unplaced).toBe(0);
  });
});

describe('βιβλία ασκήσεων: διαγράμματα δίπλα δίπλα, λύσεις με επικεφαλίδα, διάγραμμα βαριάντας', () => {
  const sol = (...parts: string[]): BookParagraph => ({ ...para(''), runs: parts.map((text, i) => ({ text, main: i % 2 === 1 })), text: parts.join('') });

  it('δύο σκακιέρες στην ίδια σειρά, με ~2 κελιά ανάμεσα στα πλαίσια, διαβάζονται χωριστά', () => {
    const right = 40 + 9 * 18 + 39;
    const { diagrams } = findDiagrams([...boardItems(ROWS, 40, 600), ...boardItems(ROWS, right, 600)]);
    expect(diagrams.map((d) => d.diagram!.placement)).toEqual(['6k1/5ppp/8/8/8/8/8/R5K1', '6k1/5ppp/8/8/8/8/8/R5K1']);
  });

  it('δύο σκακιέρες της ίδιας γραμματοσειράς με άλλο μέγεθος κελιού (15 και 18pt) στην ίδια σελίδα', () => {
    const { diagrams } = findDiagrams([...boardItems(ROWS, 40, 700, 15), ...boardItems(ROWS, 40, 400, 18)]);
    expect(diagrams).toHaveLength(2);
  });

  it('λύση με επικεφαλίδα που επαναλαμβάνει τον τίτλο της άσκησης· το πλαίσιο στο περιθώριο γίνεται σχόλιο', () => {
    const res = parseBook(
      [
        para('Anna Bell 1950 Carl Dean 1960', { heading: true, page: 1 }),
        diagram({ placement: '6k1/5ppp/8/8/8/8/8/R5K1', label: '1', turn: 'w' }),
        diagram({ placement: '6k1/5ppp/8/8/8/8/8/R5K1', label: '2', turn: 'w' }),
        para('Solutions', { heading: true }),
        para('1. Anna Bell 1950', { heading: true }),
        // το πλαίσιο του περιθωρίου ενωμένο με την πρώτη παράγραφο της λύσης
        { ...sol('There is 1 extra exercise. 1) After ', '1.Kf1?', ' h5: go to Exercise 9. ', '1.Ra8#', ' The back rank.'), indent: 150 },
        // αριθμημένη επικεφαλίδα που δεν είναι τίτλος άσκησης: όχι λύση
        para('2. Rook endgames', { heading: true }),
        sol('', '1.Kf1', ' A quiet move.'),
      ],
      { title: 'T', author: '' },
    );
    const ex = res.games.filter((g) => g.headers.Exercise);
    expect(ex.map((g) => g.headers.Exercise)).toEqual(['1', '2']);
    const first = res.pgn.split(/\n(?=\[Event )/).find((g) => g.includes('[Exercise "1"]'))!.replace(/\s+/g, ' ');
    expect(first).toContain('There is 1 extra exercise. 1) After 1.Kf1? h5: go to Exercise 9.}');
    expect(first).toContain('1. Ra8#');
    expect(first).not.toContain('1. Kf1');
  });

  it('διάγραμμα με τη θέση στο τέλος μιας βαριάντας: η παρτίδα συνεχίζει (όχι νέο απόσπασμα) και η επόμενη παράγραφος συνεχίζει τη βαριάντα', () => {
    const res = parseBook(
      [
        para('Chapter 1', { heading: true, page: 1 }),
        sol('', '1.e4 e5 2.Nf3', ' A study-like alternative is 2.Nc3 Nf6 3.f4'),
        diagram({ placement: 'rnbqkb1r/pppp1ppp/5n2/4p3/4PP2/2N5/PPPP2PP/R1BQKBNR', turn: 'b' }),
        sol('3...d5 4.fxe5 is also fine.'),
        sol('', '2...Nc6', ' Natural.'),
      ],
      { title: 'T', author: '' },
    );
    expect(res.games).toHaveLength(1);
    const moves = res.pgn.replace(/^\[.*\n/gm, '').replace(/\{[^}]*\}\s*/g, '').replace(/\s+/g, ' ').replace(/ \)/g, ')').trim();
    expect(moves).toBe('1. e4 e5 2. Nf3 (2. Nc3 Nf6 3. f4 d5 4. fxe5) 2... Nc6 *');
  });
});
