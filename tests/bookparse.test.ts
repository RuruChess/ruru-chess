/** Βιβλίο σε βάση: λεκτικές μονάδες, σύμβολα, βέλη πλάνων και το δέντρο από παραγράφους βιβλίου. */
import { describe, expect, it } from 'vitest';
import { commentShapes, nagsOf, parseBook, tokenize, type BookParagraph } from '../src/core/bookparse.ts';
import { squareName } from '../src/core/chess.ts';
import { writeGame } from '../src/core/pgn.ts';

const shapes = (text: string, fen: string) => commentShapes(text, fen).map((s) => s.color + squareName(s.from) + (s.from === s.to ? '' : squareName(s.to)));

const para = (text: string, main = false, page = 1): BookParagraph => ({ page, indent: 0, heading: false, caption: false, runs: [{ text, main }], text });
const heading = (text: string): BookParagraph => ({ ...para(text), heading: true });

describe('Βιβλίο σε βάση', () => {
  it('οι κινήσεις με αριθμούς, αποσιωπητικά και σύμβολα γίνονται λεκτικές μονάδες', () => {
    const moves = tokenize([{ text: '15.Nxe4 [15.h3N 15...Ne2+ 16.Kh2] 0-0 e8=Q', main: false }]).filter((t) => t.k === 'move');
    expect(moves.map((t) => (t.k === 'move' ? `${t.num ?? ''}${t.black ? 'b' : ''}:${t.san}` : ''))).toEqual(['15:Nxe4', '15:h3', '15b:Ne2', '16:Kh2', ':0-0', ':e8=Q']);
    // «h3N» είναι h3 με καινοτομία, όχι προαγωγή
    const h3 = moves[1];
    expect(h3.k === 'move' && nagsOf(h3.nags, true)).toEqual([146]);
  });

  it('τα σύμβολα αξιολόγησης γίνονται NAG ανάλογα με το χρώμα', () => {
    expect(nagsOf('!?', true)).toEqual([5]);
    expect(nagsOf('²', true)).toEqual([14]);
    expect(nagsOf('+–', false)).toEqual([18]);
    expect(nagsOf('?!μ', false)).toEqual([6, 17]);
  });

  it('«0-0, a4 και Rc1»: βέλη για το ροκέ, το πιόνι και τον πύργο', () => {
    const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQK2R b KQkq - 0 5';
    expect(shapes('The plan is 0-0, a4 and Rc1.', fen)).toEqual(['Ge1g1', 'Ga2a4', 'Ga1c1']);
    expect(shapes('The knight goes Nb1-d2-f1-g3 and the d6-pawn is weak.', fen)).toEqual(['Gb1d2', 'Gd2f1', 'Gf1g3', 'Rd6']);
    // απειλή: κόκκινο βέλος· κίνηση χωρίς αποσιωπητικά που ταιριάζει μόνο στα μαύρα
    expect(shapes('Black threatens Ng4 and the weakness of f2 is obvious.', fen)).toEqual(['Rf6g4', 'Rf2']);
    // «take on c3» δεν είναι κίνηση πιονιού· πιόνι μόνο ένα ή δύο τετράγωνα (c7-c6, όχι c2-c6)
    expect(shapes('Black can take on c3, with the idea of c6.', fen)).toEqual(['Gc7c6']);
    // απλές αναφορές σε κινήσεις μέσα στο κείμενο δεν δίνουν βέλη
    expect(shapes('Black can take on c3 and follow up with c6.', fen)).toEqual([]);
  });

  it('ετικέτες, αγκύλες και αναφορές γίνονται δέντρο με βαριάντες και σχόλια', () => {
    const r = parseBook(
      [
        heading('Chapter 1 – Open Games'),
        para('1.e4 e5 2.Nf3 Nc6 3.Bb5', true),
        para('A) 3.Bc4 Bc5 [3...Nf6 4.Ng5 d5] 4.c3 Nf6 This is the Italian. The plan is 0-0, a4 and Rc1.'),
        para('A1) 5.d4 exd4 6.cxd4 Bb4+'),
        para('A2) 5.d3 d6 transposes to 5.d4.'),
        para('B) 3.Nc3 Nf6 is the Four Knights.'),
        para('3...a6', true),
      ],
      { title: 'Test', author: 'Author', year: 2020, shapes: true },
    );
    expect(r.stats.unplaced).toBe(0);
    expect(r.games).toHaveLength(1);
    expect(r.games[0].headers.White).toBe('1. Open Games');
    expect(r.games[0].headers.Black).toBe('Όλο το κεφάλαιο');
    const pgn = r.pgn.replace(/\s+/g, ' ');
    expect(pgn).toContain(
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5 (3... Nf6 4. Ng5 d5) 4. c3 Nf6 {[%cal Ge1g1,Ga2a4,Ga1c1] This is the Italian. The plan is 0-0, a4 and Rc1.} 5. d4 (5. d3 d6 {transposes to 5.d4.}) 5... exd4 6. cxd4 Bb4+) (3. Nc3 Nf6 {is the Four Knights.}) 3... a6',
    );
  });

  it('ενότητα που ξεκινά από διάγραμμα (θέση-εικόνα) δεν γίνεται άδεια σκακιέρα', () => {
    const r = parseBook(
      [heading('Chapter 3 – Middlegames'), para('1.e4 e5 2.Nf3', true), heading('Test position'), para('White wins with 23.Qxh7+ Kxh7 24.Rh3+ Kg8 25.Rh8#.')],
      { title: 'Test', author: '', shapes: true },
    );
    expect(r.games).toHaveLength(1);
    expect(r.warnings.at(-1)?.text).toMatch(/διάγραμμα/);
  });

  it('το κείμενο πριν από νέα βαριάντα: οι πλήρεις προτάσεις στη γραμμή, η τελευταία πριν από τη βαριάντα', () => {
    const r = parseBook(
      [
        heading('Chapter 2 – Scotch'),
        para('1.e4 e5 2.Nf3 Nc6 3.d4 exd4 4.Nxd4 Bc5 5.Nxc6', true),
        para('I feel this is the most common move. White is trying to reach an endgame if Black plays 5...Qf6 6.Qf3 Qxf3 7.gxf3'),
        para('5...bxc6', true),
      ],
      { title: 'Test', author: '', shapes: false },
    );
    expect(r.pgn.replace(/\s+/g, ' ')).toContain(
      '5. Nxc6 {I feel this is the most common move.} 5... bxc6 ({White is trying to reach an endgame if Black plays} 5... Qf6 6. Qf3 Qxf3 7. gxf3)',
    );
  });
  it('αριθμοί χωρίς τελεία, «Chapter Two», ενότητες, ετικέτες «(b)» και συνέχεια μετά από «:»', () => {
    const main = (text: string) => para(text, true);
    const big = (text: string) => ({ ...para(text, true), heading: true });
    const r = parseBook(
      [
        heading('Chapter Two'),
        big('Ruy Lopez: Introduction and'),
        big('Closed Lines'),
        main('1 e4 e5 2 Nf3 Nc6 3 Bb5'),
        para('The Spanish has been a favourite of strong players for a very long time.'),
        big('3 ... a6'),
        main('2.1 4 Ba4 2.2 4 Bxc6'),
        big('Others:'),
        para('(a) 4 Bc4 Nf6 5 d3 Bc5 is a quiet Italian. (b) 4 Be2 Nf6 5 d3 d5 6 Nbd2 is also seen.'),
        main('2.1 4 Ba4'),
        { page: 1, indent: 0, heading: false, caption: false, runs: [{ text: '4 ... Nf6 5 0-0 Be7', main: true }, { text: ' A solid choice; instead 5 ... Nxe4 is the Open Spanish:', main: false }], text: '' },
        para('6 d4 b5 7 Bb3 d5 with lively play.'),
        main('2.2 4 Bxc6 dxc6 5 0-0'),
        para('5 ... f6 6 d4 exd4 7 Nxd4 c5 8 Nb3 Qxd1 9 Rxd1 Bg4 10 f3 Be6 11 Nc3+/= is the old main line.'),
      ].map((p) => ({ ...p, text: p.text || p.runs.map((x) => x.text).join('') })),
      { title: 'Test', author: '', shapes: false },
    );
    expect(r.stats.unplaced).toBe(0);
    // ο τίτλος σε δύο γραμμές· η εισαγωγή του κεφαλαίου και μία παρτίδα ανά ενότητα («2.1 4 Ba4»), με γύρο τον αριθμό της
    expect(r.games.map((g) => `${g.headers.Round} ${g.headers.White} | ${g.headers.Black}`)).toEqual([
      '2 2. Ruy Lopez: Introduction and Closed Lines | Εισαγωγή',
      '2.1 2. Ruy Lopez: Introduction and Closed Lines | 2.1 4 Ba4',
      '2.2 2. Ruy Lopez: Introduction and Closed Lines | 2.2 4 Bxc6',
    ]);
    const [intro, ba4, bxc6] = r.games.map((g) => writeGame(g).replace(/\s+/g, ' ').replace(/^(\[[^\]]*\] )+/, '').trim());
    // η μεγάλη κίνηση «3 ... a6» είναι κύρια γραμμή· μετά τον κατάλογο των ενοτήτων το «Others:» αφορά την 4η κίνηση·
    // «(a)» στην αρχή και «(b)» μέσα στην παράγραφο: εναλλακτικές της 4ης κίνησης, όχι η μία μέσα στην άλλη
    expect(intro).toBe(
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 {The Spanish has been a favourite of strong players for a very long time.} 3... a6 {Others:} 4. Bc4 (4. Be2 Nf6 5. d3 d5 6. Nbd2 {is also seen.}) 4... Nf6 5. d3 Bc5 {is a quiet Italian.} *',
    );
    // η σημείωση που τελειώνει με «:» συνεχίζει στην επόμενη παράγραφο
    expect(ba4).toBe('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 {A solid choice;} ({instead} 5... Nxe4 {is the Open Spanish:} 6. d4 b5 7. Bb3 d5 {with lively play.}) *');
    // «+/=» = ⩲
    expect(bxc6).toContain('11. Nc3 $14 {is the old main line.}');
  });
});
