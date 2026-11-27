/**
 * Τεστ: η δομή ενός βιβλίου ανοιγμάτων με συνθετικά δεδομένα (καμία σελίδα από βιβλίο): εκθέτες,
 * παύλες στο τέλος γραμμής, κεφαλίδες παρτίδων σε γραμμές, τίτλοι σε δύο γραμμές, ενότητες χωρίς κινήσεις, αριθμοί
 * κινήσεων που τους κόβει η αλλαγή γραμματοσειράς, βαριάντες μετά από «:».
 */
import { describe, expect, it } from 'vitest';
import { pageLines, toParagraphs } from '../src/server/books/pdf.ts';
import { gameHeadOf, parseBook, tokenize, type BookParagraph } from '../src/core/bookparse.ts';

const item = (str: string, x: number, y: number, w: number, size = 10) => ({ str, x, y, w, size, font: 'f1' });
const para = (text: string, main = false, page = 1): BookParagraph => ({ page, indent: 0, heading: false, caption: false, runs: [{ text, main }], text });
const heading = (text: string): BookParagraph => ({ ...para(text), heading: true });
const line = (y: number, text: string, x = 50, page = 1) => ({ page, x, y, size: 10, segs: [{ text, font: 'f1', x, end: x + text.length * 5 }] });

describe('γραμμές και παράγραφοι', () => {
  it('εκθέτες («2nd») μένουν στη γραμμή τους', () => {
    const items = [item('on the 2', 50, 500, 60, 16), item('nd', 111, 506, 8, 8), item(', 3', 120, 500, 14, 16), item('rd', 135, 506, 8, 8), item(' move', 144, 500, 40, 16)];
    const lines = pageLines(items as never, 1);
    expect(lines.length).toBe(1);
    expect(lines[0].segs.map((s) => s.text).join('')).toBe('on the 2nd, 3rd move');
  });

  it('παύλα στο τέλος γραμμής: συλλαβισμός, όνομα, ροκέ, τετράγωνο', () => {
    const text = (a: string, b: string) => toParagraphs([line(600, a), line(588, b)] as never, {})[0].text;
    expect(text('a very inter-', 'esting move')).toBe('a very interesting move');
    expect(text('the game Vasiukov-', 'Gheorghiu was')).toBe('the game Vasiukov-Gheorghiu was');
    expect(text('and 10.0-', '0+– wins')).toBe('and 10.0-0+– wins');
    expect(text('the d-', 'pawn is weak')).toBe('the d-pawn is weak');
    expect(text('the f1-', 'bishop')).toBe('the f1-bishop');
  });

  it('συνέχεια παραγράφου στην επόμενη σελίδα: με την εσοχή της τελευταίας γραμμής', () => {
    const lines = [line(600, 'B) 11.cxd4 with an', 64), line(588, 'edge for White in the game', 50), { ...line(700, 'Zelcic-Krnic and more', 50), page: 2 }];
    const paras = toParagraphs(lines as never, {});
    expect(paras.length).toBe(1);
    expect(paras[0].lineStarts?.length).toBe(2);
  });
});

describe('δομή του βιβλίου', () => {
  it('αριθμός κίνησης κομμένος από αλλαγή γραμματοσειράς: «reaction 1» + «2.d4!» = 12.d4', () => {
    const moves = tokenize([
      { text: 'the typical reaction 1', main: false },
      { text: '2.d4! e5', main: true },
    ]).filter((t) => t.k === 'move');
    expect(moves.map((t) => (t.k === 'move' ? `${t.num}:${t.san}` : ''))).toEqual(['12:d4', 'null:e5']);
  });

  it('κεφαλίδα παρτίδας σε γραμμές: παίκτες, Elo, τόπος, χρονιά', () => {
    const text = 'Guillaume Devaure 1580 Tristan Nicolas 1878 Saint-Lô jr 2006 1.e4 c5';
    const p: BookParagraph = { ...para(text), lineStarts: [23, 44, 61] };
    expect(gameHeadOf(p)).toEqual({ white: 'Guillaume Devaure', black: 'Tristan Nicolas', whiteElo: '1580', blackElo: '1878', site: 'Saint-Lô jr', year: '2006', end: 61 });
    // πρόζα στην πρώτη γραμμή: όχι κεφαλίδα
    expect(gameHeadOf({ ...para('This is a game that was played in 2006 1.e4'), lineStarts: [10, 30] })).toBeNull();
    const res = parseBook([heading('Game 4'), { ...para(text, true), lineStarts: [23, 44, 61] }], { title: 'T', author: '' });
    const h = res.games[0].headers;
    expect([h.White, h.Black, h.Site, h.Date, h.WhiteElo]).toEqual(['Devaure, Guillaume', 'Nicolas, Tristan', 'Saint-Lô jr', '2006.??.??', '1580']);
  });

  it('τίτλος σε δύο γραμμές και ενότητες χωρίς κινήσεις: όχι κενές παρτίδες', () => {
    const res = parseBook(
      [
        heading('Chapter 4'),
        heading('Ready for the pole position:'),
        heading('The Grand Prix Attack'),
        para('1.e4 c5 2.Nc3', true),
        para('The Sicilian is popular.'),
        heading('II. Black develops his bishop to e7 and adopts the structure'),
        heading('known as the little centre'),
        para('In this system the bishop goes to c4.'),
        heading('A. Black plays Nf6'),
        para('1.e4 c5 2.Nc3 Nc6 3.f4', true),
      ],
      { title: 'T', author: '' },
    );
    expect(res.games.map((g) => g.headers.White)).toEqual(['4. Ready for the pole position: The Grand Prix Attack', '4. Ready for the pole position: The Grand Prix Attack']);
    expect(res.games[1].headers.Black).toBe('A. Black plays Nf6');
    // η ενότητα II (μόνο κείμενο) αμέσως μετά την εισαγωγή του κεφαλαίου: το τέλος της εισαγωγής, με τον τίτλο της σε
    // μία γραμμή (όχι μέσα στην παρτίδα της ενότητας A.)
    let end = res.games[0].root;
    while (end.children[0]) end = end.children[0];
    expect(end.comment).toBe('The Sicilian is popular. II. Black develops his bishop to e7 and adopts the structure known as the little centre: In this system the bishop goes to c4.');
    expect(res.games[1].root.comment).toBe('');
  });

  it('κίνηση που παρουσιάζεται μετά από «:» είναι βαριάντα, και ας είναι μακριά από τη γραμμή', () => {
    const res = parseBook(
      [
        heading('Chapter 1'),
        para('1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5', true),
        para('Also possible is 3...Nf6 4.Ng5 d5 5.exd5 Na5 6.Bb5+ c6. But White had a better try in the main line: 3.Bb5!.'),
      ],
      { title: 'T', author: '' },
    );
    const pgn = res.pgn.replace(/\s+/g, ' ');
    expect(pgn).toContain('3. Bb5 $1)');
  });

  it('«♗xe6» δεν μπαίνει ως «♗e6» όταν στο e6 δεν υπάρχει κομμάτι', () => {
    const res = parseBook([heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6 3.Bc4', true), para('3...Bxe6 4.d4')], { title: 'T', author: '' });
    expect(res.pgn).not.toContain('Be6');
  });
});

describe('κεφάλαια με παρτίδες «GAME N» στη μέση', () => {
  const sans = (g: { root: { children: unknown[] } }): string[] => {
    const out: string[] = [];
    const walk = (n: { san?: string; children: unknown[] }) => {
      if (n.san) out.push(n.san);
      for (const c of n.children) walk(c as never);
    };
    walk(g.root as never);
    return out;
  };

  it('το «Conclusion» του κεφαλαίου τελειώνει στο «GAME 1»: η παρτίδα έχει κινήσεις, όχι μόνο σχόλιο', () => {
    const res = parseBook(
      [heading('Chapter 1'), para('1.e4 c5 2.Nf3 d6', true), para('Conclusion'), para('White has a pleasant game.'), para('GAME 1'), { ...para('Alpha Beta – Gamma Delta'), indent: 180 }, { ...para('Somewhere 2020'), indent: 200 }, para('1.d4 d5 2.c4 e6 3.Nc3 Nf6', true)],
      { title: 'T', author: '' },
    );
    const game = res.games.find((g) => /Beta/.test(g.headers.White ?? ''))!;
    expect(sans(game)).toContain('c4');
  });

  it('ευρετήριο βαριαντών με αριθμούς σελίδων: όχι κινήσεις', () => {
    const res = parseBook(
      [heading('Chapter 1'), para('1.e4 c6 2.d4 d5 3.exd5 cxd5 4.c4 Nf6 5.Nc3 Nc6', true), para('A) 6.Nf3 Bg4 12'), para('B) 6.Bg5 dxc4 21'), para('A) 6.Nf3 Bg4', true), para('7.cxd5 Nxd5', true)],
      { title: 'T', author: '' },
    );
    const all = res.games.flatMap((g) => sans(g));
    expect(all).toContain('cxd5');
    expect(all).not.toContain('Bg5');
  });

  it('η ενότητα «B)» μετά από την παρτίδα συνεχίζει το κεφάλαιο, όχι την παρτίδα (εκεί ο ♘ είναι ήδη στο f3)', () => {
    const res = parseBook(
      [
        heading('Chapter 1'),
        para('1.e4 c6 2.d4 d5 3.exd5 cxd5 4.c4 Nf6 5.Nc3 Nc6', true),
        para('A) 6.Nf3 Bg4', true),
        para('7.cxd5 Nxd5', true),
        para('GAME 1'),
        heading('Alpha Beta – Gamma Delta'),
        para('1.c4 c5 2.Nf3 Nc6 3.e3 Nf6 4.d4 cxd4 5.exd4 d5 6.Nc3', true),
        para('Here we are.'),
        para('6...Bg4 7.cxd5 Nxd5', true),
        para('B) 6.Bg5 dxc4', true),
        para('7.d5 Ne5', true),
        para('Just protecting the pawn with 7.Nf3 is possible too.'),
      ],
      { title: 'T', author: '' },
    );
    expect(res.warnings).toEqual([]);
    const chapter = res.games.findIndex((g) => sans(g).includes('Bg5'));
    const game = res.games.findIndex((g) => /Beta/.test(g.headers.White ?? ''));
    expect(chapter).toBeGreaterThanOrEqual(0);
    expect(chapter).toBeLessThan(game);
    expect(sans(res.games[game])).not.toContain('Bg5');
  });
});
