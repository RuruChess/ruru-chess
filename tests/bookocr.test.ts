/**
 * Τεστ: βιβλία με κείμενο από OCR (σκαναρισμένο βιβλίο με στρώμα κειμένου, π.χ. «_compress» PDF). Συνθετικά δεδομένα
 * (καμία σελίδα από βιβλίο): σύμβολα κομματιών με πολλές μορφές («lLl» = ♘, «i.» = ♗, «l"!:» = ♖), αριθμοί κινήσεων
 * με κενά και γράμματα («1 0.», «1 l .»), «• • •», αξιολογήσεις («00» = ∞), και σύμβολο που χωρά σε πολλά κομμάτια («�»).
 */
import { describe, expect, it } from 'vitest';
import { parseBook, type BookParagraph } from '../src/core/bookparse.ts';

const para = (text: string, main = false, heading = false): BookParagraph => ({ page: 1, indent: 0, heading, caption: false, runs: [{ text, main }], text });
const flat = (pgn: string) => pgn.replace(/\s+/g, ' ');

describe('βιβλία με κείμενο από OCR', () => {
  // King's Indian, Mar del Plata: η κύρια γραμμή έντονη, οι βαριάντες σε δικές τους παραγράφους
  const book = [
    para('l .d4 lLlf6 2.c4 g6 3.lLlc3 i.g7 4.e4 d6 5.lLlf3 0-0 6.i.e2 e5 7.0-0 lLlc6 8.d5 lLle7 9.lLle1 lLld7 1 0.i.e3 f5 1 l .f3 f4 1 2.i.f2 g5', true),
    para('1 3.lLld3 lLlf6 1 4.c5 lLlg6 1 5.l"!:c1 l"!:f7 is the main line.'),
    para("Black's idea is . . .lLlh4 with an attack."),
    para('1 6.cxd6 cxd6 1 7.lLlb5 a6 1 8.lLla3 b500'),
    para('1 6.lLlb5 a6 1 7.lLla3 h5 1 8.c6 b6'),
    para('1 6.i.e1 h5 1 7.cxd6 cxd6 1 8.lLlb5 a6'),
    para('1 6.h3 h5 1 7.i.e1 lLlh7 1 8.cxd6 cxd6'),
    para('1 6.a4 h5 1 7.a5 a6 1 8.lLlb5 axb5'),
  ];

  it('οι κινήσεις διαβάζονται όλες, με τα σωστά κομμάτια', () => {
    const res = parseBook(book, { title: 'OCR', author: '' });
    const pgn = flat(res.pgn);
    expect(res.stats.unplaced).toBe(0);
    expect(pgn).toContain('9. Ne1 Nd7 10. Be3 f5 11. f3 f4 12. Bf2 g5');
    expect(pgn).toContain('13. Nd3 Nf6 14. c5 Ng6 15. Rc1 Rf7');
    expect(pgn).toContain('17. Nb5 a6 18. Na3 b5 $13');
    expect(pgn).toContain('18. Nb5 axb5');
  });

  it('στα σχόλια τα σύμβολα γίνονται τα γράμματα που έμαθε το βιβλίο', () => {
    const pgn = flat(parseBook(book, { title: 'OCR', author: '' }).pgn);
    expect(pgn).toContain("Black's idea is ...Nh4 with an attack.");
    expect(pgn).not.toMatch(/lLl|i\.[a-h]/);
  });

  it('σύμβολο που χωρά σε δύο κομμάτια: αυτό που κρατά νόμιμες τις επόμενες κινήσεις', () => {
    // «�» = ♕ εδώ, αν και και ο ♘ πηγαίνει στο f3· μόνο η βασίλισσα παίρνει μετά στο f7
    const res = parseBook([para('1.e4 e5 2.�f3 lLlc6 3.�xf7+ Kxf7', true)], { title: 'OCR', author: '' });
    expect(res.stats.unplaced).toBe(0);
    expect(flat(res.pgn)).toContain('2. Qf3 Nc6 3. Qxf7+ Kxf7');
  });

  it('κείμενο χωρίς OCR: χωρίς αλλαγές', () => {
    const res = parseBook([para('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 and it is 1 0 times better', true)], { title: 'Clean', author: '' });
    expect(flat(res.pgn)).toContain('3. Bb5 a6 {and it is 1 0 times better}');
  });
});

describe('βιβλία με παρτίδες μέσα σε ενότητες («Trap N»), από OCR των Windows', () => {
  // τα σύμβολα ως άλλα γράμματα (♗ = «A», ♕ = «V», ♘ = «Q»), αριθμοί χωρίς τελεία, γραμμή που σπάει μέσα στην παρτίδα
  const book: BookParagraph[] = [];
  for (let n = 1; n <= 8; n++) {
    book.push(para(`Trap ${n} - Lullaby ${n}`, false, true), para('Intro text about the trap.'), para('Kochiev — Ivanov USSR 1976'));
    book.push(para('1 Qf3 Qf6 2 g3 b6 3 Ag2 Ab7 4 0-0 e6 5 d3 d5 6 Qbd2 Ae7 7 e4 dxe4 8 dxe4 (2a)'), para('Qc6 9 Ve2 2b: after 9 Ve2 and Black is fine.'));
  }
  book.push(para('Trap 9 - Pawns', false, true), para('Stone — Giddins'), para(''), para('Club Match 1988'), para('1 c4 b6 2 Qc3 Ab7 3 e4 e6 4 Qf3 Ab4'));

  it('κάθε παρτίδα του βιβλίου γίνεται παρτίδα, με παίκτες, τόπο, χρονιά και την ενότητα', () => {
    const res = parseBook(book, { title: 'Traps', author: '' });
    const games = res.pgn.split(/\n(?=\[Event )/);
    const kochiev = games.filter((g) => g.includes('[White "Kochiev"]'));
    expect(kochiev).toHaveLength(8);
    expect(kochiev[0]).toContain('[Event "Trap 1 - Lullaby 1"]');
    expect(kochiev[0]).toContain('[Site "USSR"]');
    expect(kochiev[0]).toContain('[Date "1976.??.??"]');
    // η εισαγωγή της ενότητας είναι το πρώτο σχόλιο, όχι χωριστή παρτίδα χωρίς κινήσεις
    expect(flat(kochiev[0])).toContain('{Intro text about the trap.} 1. Nf3 Nf6 2. g3 b6 3. Bg2 Bb7 4. O-O e6 5. d3 d5 6. Nbd2 Be7 7. e4 dxe4 8. dxe4 Nc6 9. Qe2');
    expect(res.pgn).not.toMatch(/\(2a\)|2b:/);
    const stone = flat(games.find((g) => g.includes('[White "Stone"]')) ?? '');
    expect(stone).toContain('[Site "Club Match"] [Date "1988.??.??"]');
    expect(stone).toContain('1. c4 b6 2. Nc3 Bb7 3. e4 e6 4. Nf3 Bb4');
    expect(games.some((g) => !/\d\.\s/.test(g.replace(/^\[.*\]$/gm, '')))).toBe(false);
  });
});

describe('δεύτερο πέρασμα OCR σε σκαναρισμένες σελίδες', () => {
  it('όπου λείπουν κινήσεις («5 6»), οι λέξεις του δεύτερου περάσματος συμπληρώνουν το πρώτο', async () => {
    const { mergeWords, missingMoves } = await import('../src/server/books/pdf.ts');
    const word = (text: string, x: number) => ({ x, y: 0, w: 10, h: 10, text });
    expect(missingMoves({ page: 1, w: 100, h: 100, lines: [[word('4', 0), word('Qf6', 10), word('5', 20), word('6', 30), word('ag5', 40)]] })).toBe(true);
    expect(missingMoves({ page: 1, w: 100, h: 100, lines: [[word('1', 0), word('e4', 10), word('e5', 20), word('2', 30), word('Nf3', 40)]] })).toBe(false);
    const item = (str: string, x: number) => ({ str, x, y: 100, w: 20, size: 10, font: 'ocr' });
    const merged = mergeWords([item('4', 0), item('Qf6', 60)], [item('4', 0), item('Oxd4', 25), item('Qf6', 60)]);
    expect(merged.map((i) => i.str)).toEqual(['4', 'Qf6', 'Oxd4']);
  });
});

describe('OCR στα κενά των γραμμών', () => {
  it('βρίσκει σημείο με μελάνι ανάμεσα στις λέξεις μιας γραμμής με κινήσεις (λέξη που παρέλειψε το OCR)', async () => {
    const { inkGaps } = await import('../src/server/books/pdf.ts');
    const W = 400;
    const H = 60;
    const px = new Uint8Array(W * H).fill(255);
    const blot = (x0: number, x1: number) => {
      for (let y = 20; y < 40; y++) for (let x = x0; x < x1; x++) px[y * W + x] = 0;
    };
    // «5», μια λέξη που δεν διαβάστηκε, «6»
    blot(10, 30);
    blot(60, 120);
    blot(150, 170);
    const w = (text: string, x: number) => ({ text, x, y: 20, w: 20, h: 20 });
    expect(inkGaps({ w: W, h: H, px }, [[w('5', 10), w('6', 150)]])).toEqual([{ x0: 30, y0: 18, x1: 150, y1: 42 }]);
    // κενό χωρίς μελάνι, ή γραμμή χωρίς κινήσεις: τίποτα
    expect(inkGaps({ w: W, h: H, px: new Uint8Array(W * H).fill(255) }, [[w('5', 10), w('6', 150)]])).toEqual([]);
    expect(inkGaps({ w: W, h: H, px }, [[w('and', 10), w('then', 150)]])).toEqual([]);
  });
});

describe('χαμένη κίνηση που ξεχωρίζει μόνο από διάγραμμα', () => {
  it('«9 ♘e5» χάθηκε στο OCR: όποια κίνηση του ♘f3 ταιριάζει με τη συνέχεια, αλλά το διάγραμμα δείχνει ♘ στο e5', async () => {
    const { Position } = await import('../src/core/chess.ts');
    const pos = Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (const s of 'Nf3 Nf6 g3 b6 Bg2 Bb7 O-O e6 d3 d5 Nbd2 Be7 e4 dxe4 dxe4 Nxe4 Ne5 Nd6 Bxb7 Nxb7 Qf3'.split(' ')) pos.makeMove(pos.parseSan(s));
    const placement = pos.fen().split(' ')[0];
    const book: BookParagraph[] = [];
    for (let n = 1; n <= 8; n++) {
      book.push(para(`Trap ${n} - Lullaby ${n}`, false, true), para('Kochiev — Ivanov USSR 1976'));
      book.push(para('1 Qf3 Qf6 2 g3 b6 3 Ag2 Ab7 4 0-0 e6 5 d3 d5 6 Qbd2 Ae7 7 e4 dxe4 8 dxe4 Qc6 9 Ve2'));
    }
    book.push(para('Trap 9 - The Gap', false, true), para('Kochiev — Ivanov USSR 1976'));
    book.push(para('1 Qf3 Qf6 2 g3 b6 3 Ag2 Ab7 4 0-0 e6 5 d3 d5 6 Qbd2 Ae7 7 e4 dxe4 8 dxe4 Qxe4?? 9 1-0 After 9...Qd6 10 Axb7 Qxb7 11 Vf3 Black loses a piece.'));
    book.push({ ...para(''), diagram: { placement, turn: null, label: null, caption: '', id: 1 } });
    const games = parseBook(book, { title: 'Traps', author: '' }).pgn.split(/\n(?=\[Event )/);
    const gap = flat((games.find((g) => g.includes('[Event "Trap 9 - The Gap"]')) ?? '').replace(/{[^}]*}s*/g, ''));
    expect(gap).toContain('8. dxe4 Nxe4 $4 9. Ne5 Nd6 10. Bxb7 Nxb7 11. Qf3');
  });
});
