// Κανόνες του αναλυτή που χρειάστηκαν για τα σκαναρισμένα βιβλία (συνθετικά δεδομένα): αιχμαλωσίες πιονιών χωρίς «x»,
// αριθμημένες ολόκληρες παρτίδες μέσα σε κεφάλαιο θεωρίας, σύμβολο κομματιού που χάθηκε σε κείμενο από εικόνα, και το
// «W» / «B» αριστερά από τη σκακιέρα.
import { describe, expect, it } from 'vitest';
import { numberedGameHead, parseBook, swapColors, type BookParagraph } from '../src/core/bookparse.ts';
import { annotateDiagrams } from '../src/server/books/diagrams.ts';
import { dropStrayLabels } from '../src/server/books/pdf.ts';

const para = (text: string, main = false, page = 1): BookParagraph => ({ page, indent: 0, heading: false, caption: false, runs: [{ text, main }], text });
const heading = (text: string): BookParagraph => ({ ...para(text), heading: true });
const games = (pgn: string) => pgn.split(/\n(?=\[Event )/);
const moves = (game: string) =>
  game
    .replace(/\[[^\]]*\]\s*/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('αιχμαλωσίες πιονιών χωρίς «x»', () => {
  // 20 τέτοιες αιχμαλωσίες στο βιβλίο, καμία με «x»
  const filler = para(Array.from({ length: 10 }, (_, k) => `${20 + k}.cd5 ed5`).join(' '));

  it('«3.d4 cd4 4.Nd4» = 3.d4 cxd4 4.Nxd4', () => {
    const res = parseBook([heading('Chapter 1'), para('1.e4 c5 2.Nf3 e6 3.d4 cd4 4.Nd4 Nc6 5.Nb5 d6 6.c4 Nf6', true), filler], { title: 'T', author: '' });
    expect(moves(games(res.pgn)[0])).toMatch(/3\. d4 cxd4 4\. Nxd4 Nc6 5\. Nb5 d6 6\. c4 Nf6/);
  });

  it('και τα κομμάτια παίρνουν χωρίς «x»: «16...Ra8» = Rxa8 στην κύρια γραμμή, όχι στη βαριάντα όπου το a8 είναι άδειο', () => {
    const line = '1.e4 c5 2.Nf3 e6 3.d4 cd4 4.Nd4 Nc6 5.Nb5 d6 6.Bf4 e5 7.Be3 a6 8.N5c3 Nf6 9.Bc4 Be6 10.Nd5 Ne4 11.Bb6 Qg5 12.Nc7 Kd7 13.Be6 fe6 14.Na8 Qg2 15.Rf1 Be7 16.Nd2 ';
    const p: BookParagraph = {
      ...para(''),
      runs: [
        { text: line, main: true },
        { text: 'White can try to repeat moves by 16.Nc7 Bd8 17.Na8, but it does not work. ', main: false },
        { text: '16...Ra8 17.c3 Nd2 18.Qd2 Qh2', main: true },
      ],
    };
    p.text = p.runs.map((r) => r.text).join('');
    const res = parseBook([heading('Chapter 1'), p, filler], { title: 'T', author: '' });
    let main = moves(games(res.pgn)[0]);
    for (let prev = ''; prev !== main; ) {
      prev = main;
      main = main.replace(/\([^()]*\)/g, '');
    }
    expect(main.replace(/\d+\.\.\. /g, '').replace(/\s+/g, ' ')).toMatch(/16\. Nd2 Rxa8 17\. c3 Nxd2 18\. Qxd2 Qxh2/);
  });
});

describe('αριθμημένες ολόκληρες παρτίδες μέσα σε κεφάλαιο', () => {
  const head = '1. Enklaar - Andersson ';
  const site = 'Amsterdam 1973 ';
  const game: BookParagraph = { ...para(`${head}${site}1.e4 e5 2.Nf3 Nc6 3.Bb5 a6`, true), lineStarts: [head.length, head.length + site.length] };

  it('η κεφαλίδα σε γραμμές: παίκτες, τόπος, χρονιά και πού αρχίζουν οι κινήσεις', () => {
    expect(numberedGameHead(game)).toEqual({ white: 'Enklaar', black: 'Andersson', site: 'Amsterdam', year: '1973', end: head.length + site.length, skip: 0 });
    // σε τρεις παραγράφους
    expect(numberedGameHead(para('2. Ivanchuk - Granda Zuniga', true), para('Biel 1993', true), para('1.e4 c5 2.Nf3', true))).toMatchObject({ white: 'Ivanchuk', black: 'Granda Zuniga', site: 'Biel', year: '1993', skip: 1 });
    // όχι: κίνηση με αριθμό, ή χωρίς κινήσεις από την αρχή μετά
    expect(numberedGameHead(para('12. Nf3 - an idea', true), para('Biel 1993'), para('1.e4'))).toBeNull();
    expect(numberedGameHead(para('2. Ivanchuk - Granda Zuniga', true), para('Biel 1993', true), para('White is better here.'))).toBeNull();
  });

  it('νέα παρτίδα με τους παίκτες της· το κείμενο που ξαναρχίζει από την πρώτη κίνηση γυρίζει στη θεωρία', () => {
    const res = parseBook(
      [heading('Chapter 1'), para('1.e4 c5 2.Nf3 e6 3.d4 cxd4 4.Nxd4 Nc6', true), game, para('1.e4 c5 2.Nf3 e6 3.d4 cxd4 4.Nxd4 Nc6 5.Nb5 d6', true)],
      { title: 'T', author: '' },
    );
    const all = games(res.pgn);
    const played = all.find((g) => /\[White "Enklaar"\]/.test(g))!;
    expect(played).toMatch(/\[Black "Andersson"\]/);
    expect(played).toMatch(/\[Site "Amsterdam"\]/);
    expect(played).toMatch(/\[Date "1973\.\?\?\.\?\?"\]/);
    expect(moves(played)).toMatch(/1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6/);
    expect(moves(played)).not.toMatch(/Nb5/);
    const theory = all.find((g) => !/Enklaar/.test(g))!;
    expect(moves(theory)).toMatch(/4\. Nxd4 Nc6 5\. Nb5 d6/);
  });
});

describe('κείμενο από τον αναγνώστη εικόνας', () => {
  const line = '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.0-0 Be7 6.e1 b5';

  it('σύμβολο κομματιού που χάθηκε εντελώς («6.e1»): κάποιο κομμάτι που μπορεί να πάει εκεί, και η γραμμή συνεχίζει', () => {
    // (ο χαρακτήρας U+E005 δείχνει ότι το βιβλίο διαβάστηκε από εικόνα)
    const res = parseBook([heading('Chapter 1'), para(line, true), para('The bishop  is strong.')], { title: 'T', author: '' });
    expect(moves(games(res.pgn)[0])).toMatch(/6\. [NRQ]e1 b5/);
  });

  it('σε ψηφιακό βιβλίο όχι', () => {
    const res = parseBook([heading('Chapter 1'), para(line, true)], { title: 'T', author: '' });
    expect(moves(games(res.pgn)[0])).not.toMatch(/[NRQ]e1/);
  });
});

describe('«W» / «B» αριστερά από τη σκακιέρα', () => {
  const board = () => ({ str: '\u0001', x: 100, y: 500, w: 160, size: 20, font: '#diagram', diagram: { placement: '8/8/8/8/8/8/8/8', turn: null as 'w' | 'b' | null, label: null, caption: '', x: 100, y: 500, id: 0 } });
  const text = (str: string, x: number, y: number) => ({ str, x, y, w: 8, size: 10, font: 'ocr' });

  it('ορίζει ποιος παίζει και φεύγει από το κείμενο', () => {
    for (const [mark, turn] of [['B', 'b'], ['W', 'w']] as const) {
      const d = board();
      const items = [text(mark, 82, 420), text('Black', 50, 300)];
      const rest = annotateDiagrams([d] as never, items as never);
      expect(d.diagram.turn).toBe(turn);
      expect(rest.map((it) => it.str)).toEqual(['Black']);
    }
  });

  it('όχι μακριά από τη σκακιέρα, ούτε άλλο γράμμα', () => {
    const d = board();
    const items = [text('B', 20, 420), text('A', 82, 420), text('W', 82, 250)];
    expect(annotateDiagrams([d] as never, items as never)).toHaveLength(3);
    expect(d.diagram.turn).toBeNull();
  });
});

describe('κείμενο από τον αναγνώστη εικόνας: κολλημένες κινήσεις, ξένοι χαρακτήρες, έντονα που χάθηκαν', () => {
  // σύμβολα κομματιών όπως τα γράφει ο αναγνώστης εικόνας (ομάδες σχήματος): ίππος, αξιωματικός
  const N = '';
  const B = '';
  const run = (text: string, main: boolean) => ({ text, main });
  const paraOf = (...runs: Array<{ text: string; main: boolean }>): BookParagraph => ({ page: 1, indent: 0, heading: false, caption: false, runs, text: runs.map((r) => r.text).join('') });
  /** η κύρια γραμμή: χωρίς σχόλια και χωρίς βαριάντες */
  const mainLine = (game: string) => {
    let t = moves(game);
    for (let prev = ''; prev !== t; ) {
      prev = t;
      t = t.replace(/\([^()]*\)/g, '');
    }
    return t.replace(/\d+\.\.\. /g, '').replace(/\s+/g, ' ').trim();
  };
  const parse = (...paras: BookParagraph[]) => games(parseBook([heading('Chapter 1'), ...paras], { title: 'T', author: '' }).pgn)[0];

  it('αριθμός με τελείες στο τέλος ενός κομματιού και η κίνηση στο επόμενο («[[14...]][[Rc8 15 h4!]]»)', () => {
    const g = parse(
      para('1.e4 e5 2.Nf3 Nc6 3.Bb5', true),
      para('Instead 3.Bc4 Bc5 is the Italian.'),
      paraOf(run('3...', true), run('a6 4.Ba4 Nf6', true)),
    );
    expect(mainLine(g)).toMatch(/3\. Bb5 a6 4\. Ba4 Nf6/);
  });

  it('αιχμαλωσία όπου χάθηκε όλο το σύμβολο του κομματιού («4.xc6»): το κομμάτι από τη νομιμότητα', () => {
    expect(mainLine(parse(para(`1.e4 e5 2.${N}f3 ${N}c6 3.${B}b5 a6 4.xc6 dxc6 5.0-0`, true)))).toMatch(/4\. Bxc6 dxc6 5\. O-O/);
  });

  it('«Game 2 K.Dolzhikova ■ A.Janovsky» σε μία γραμμή ξεκινά νέα παρτίδα· «1 e4e5» είναι δύο κινήσεις', () => {
    const res = parseBook(
      [heading('Chapter 1'), para('Game 1'), para(`1 e4 e5 2 ${N}f3 ${N}c6 3 ${B}b5 a6`, true), para('Game 2 K.Dolzhikova ■ A.Janovsky'), para('Kiev 2005'), para(`1 e4e5 2 ${N}f3 d5 3 exd5`, true), para(Array.from({ length: 22 }, (_, k) => `${30 + k} h3`).join(', '))],
      { title: 'T', author: '' },
    );
    expect(games(res.pgn).map(moves).join(' | ')).toMatch(/1\. e4 e5 2\. Nf3 d5 3\. exd5/);
  });

  it('τετράγωνο κολλημένο στον επόμενο αριθμό χωρίς τελεία («♘c63 ♗b5 a64 ♗a4»)', () => {
    // (βιβλίο με αριθμούς χωρίς τελεία: ≥ 20 τέτοιοι)
    const fill = para(Array.from({ length: 22 }, (_, k) => `${30 + k} h3`).join(', '));
    expect(mainLine(parse(para(`1 e4 e5 2 ${N}f3 ${N}c63 ${B}b5 a64 ${B}a4 ${N}f6`, true), fill))).toMatch(/2\. Nf3 Nc6 3\. Bb5 a6 4\. Ba4 Nf6/);
  });

  it('κινήσεις κολλημένες χωρίς κενό («1.e4e52.♘f3♘c63.♗b5a6»)', () => {
    expect(mainLine(parse(para(`1.e4e52.${N}f3${N}c63.${B}b5a6 4.${B}a4${N}f6`, true)))).toMatch(/1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6 4\. Ba4 Nf6/);
  });

  it('ιδεόγραμμα πριν από τετράγωνο είναι σύμβολο κομματιού, μετά από κίνηση σύμβολο αξιολόγησης', () => {
    const g = parse(para(`1.e4 e5 2.${N}f3 ${N}c6 3.盒c4 ${N}f6 4.d3 d5!干`, true));
    expect(mainLine(g)).toMatch(/3\. Bc4 Nf6 4\. d3 d5/);
    expect(g).not.toMatch(/[㐀-鿿]/);
    // ∓
    expect(g).toMatch(/d5 \$1 \$17/);
  });

  it('κινήσεις χωρίς έντονα που γεμίζουν ακριβώς το κενό της κύριας γραμμής είναι κι αυτές κύρια γραμμή', () => {
    // («1...c5» τραβά την ανάγνωση σε άλλη βαριάντα: χωρίς τον κανόνα οι «2.♘f3 ♘c6 3.♗b5» πήγαιναν εκεί)
    const g = parse(paraOf(run('1.e4 e5 ', true), run(`A move like 1...c5 leads elsewhere. 2.${N}f3 ${N}c6 3.${B}b5 (3.${B}c4 ${B}c5) `, false), run(`3...a6 4.${B}a4 ${N}f6`, true)));
    expect(mainLine(g)).toMatch(/1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6 4\. Ba4 Nf6/);
  });

  it('«3.♘d2» με δύο ίππους που πάνε εκεί: αυτός που αφήνει να παιχτεί η συνέχεια της κύριας γραμμής', () => {
    const line = (next: string) => mainLine(parse(paraOf(run(`1.${N}f3 d5 2.d3 ${N}f6 3.${N}d2 `, true), run('A flexible move. ', false), run(`3...e6 4.${next}`, true))));
    // (ο ίππος του f3 πρέπει να είναι ακόμη εκεί για το ♘e5· ο ίππος του b1 για το ♘c3)
    expect(line(`${N}e5`)).toMatch(/3\. Nbd2 e6 4\. Ne5/);
    expect(line(`${N}c3`)).toMatch(/3\. Nfd2 e6 4\. Nc3/);
  });

  it('η απάντηση της κύριας γραμμής χωρίς αριθμό μετά από βαριάντα σε παρένθεση', () => {
    const g = parse(paraOf(run(`1.e4 e5 2.${N}f3 `, true), run('(2.f4 exf4) ', false), run(`${N}c6 3.${B}b5 a6`, true)));
    expect(mainLine(g)).toMatch(/1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6/);
    expect(moves(g)).toMatch(/\(2\. f4 exf4\)/);
  });

  it('ψηφίο κολλημένο μετά την κίνηση αντί για σύμβολο αξιολόγησης («3...a67 White is better»)', () => {
    const g = parse(paraOf(run(`1.e4 e5 2.${N}f3 ${N}c6 3.${B}b5 a67 `, true), run('White is still better. ', false), run(`4.${B}a4 ${N}f63 5.0-0`, true)));
    expect(mainLine(g)).toMatch(/3\. Bb5 a6 4\. Ba4 Nf6 5\. O-O/);
  });

  it('«3..♘f6»: η τελεία που χάθηκε· «3♗b5»: ο αριθμός που κόλλησε στην κίνηση (βιβλίο με αριθμούς χωρίς τελεία)', () => {
    const g = parse(para(`1.e4 e5 2.${N}f3 ${N}c6 3.${B}b5 a6`, true), para(`Or 3..${N}f6 4.0-0 with a good game.`));
    expect(moves(g)).toMatch(/\(.*3\.\.\. Nf6 4\. O-O/);
    const bare = parse(para(`1 e4 e5 2 ${N}f3 ${N}c6 3${B}b5 a6 4 ${B}a4 ${N}f6 5 0-0 ${B}e7 6 ${B}b3 b5 7d3 d6`, true), para(Array.from({ length: 22 }, (_, k) => `${30 + k} h3`).join(', ')));
    expect(mainLine(bare)).toMatch(/2\. Nf3 Nc6 3\. Bb5 a6 4\. Ba4 Nf6 5\. O-O Be7 6\. Bb3 b5 7\. d3 d6/);
  });

  it('αριθμοί χωρίς τελεία: ο αριθμός στο τέλος ενός κομματιού και η κίνησή του στο επόμενο («…a6 4» + « ♗a4»)', () => {
    const p = paraOf(run(`1 e4 e5 2 ${N}f3 ${N}c6 3 ${B}b5 a6 4`, true), run(` ${B}a4 ${N}f6 5 0-0 ${B}e7`, true));
    p.runs[1] = { ...p.runs[1], top: true };
    const g = parse(p, para(Array.from({ length: 22 }, (_, k) => `${30 + k} h3`).join(', ')));
    expect(mainLine(g)).toMatch(/3\. Bb5 a6 4\. Ba4 Nf6 5\. O-O Be7/);
  });

  it('οι κουκκίδες του Μαύρου διαβάστηκαν ως ψηφία («3 022 ♗g7»): η κίνηση μπαίνει εκεί όπου τελειώνει η κύρια γραμμή', () => {
    const g = parse(
      para(`1 d4 ${N}f6 2 ${N}f3 g6 3 g3 022 ${B}g7 4 ${B}g2 0-0 5 0-0 d6`, true),
      para(Array.from({ length: 22 }, (_, k) => `${30 + k} h3`).join(', ')),
    );
    expect(mainLine(g)).toMatch(/3\. g3 Bg7 4\. Bg2 O-O 5\. O-O d6/);
  });

  it('έντονη εναλλακτική μέσα στο σχόλιο («… than the alternative 3.♗c4 which allows 3...♘f6») είναι βαριάντα', () => {
    const g = parse(
      paraOf(run(`1.e4 e5 2.${N}f3 ${N}c6 3.${B}b5 `, true), run('This is more flexible than the alternative ', false), run(`3.${B}c4`, true), run(' which allows ', false), run(`3...${N}f6`, true), run('. ', false)),
      para(`3...a6 4.${B}a4 ${N}f6`, true),
    );
    expect(mainLine(g)).toMatch(/2\. Nf3 Nc6 3\. Bb5 a6 4\. Ba4 Nf6/);
    expect(moves(g)).toMatch(/\(.*3\. Bc4 .*Nf6.*\)/);
  });

  it('ετικέτες με τελεία («A. 3...a6», «B. 3...♘f6»): η δεύτερη ξεκινά δίπλα στην πρώτη', () => {
    const g = parse(para(`1.e4 e5 2.${N}f3 ${N}c6 3.${B}b5`, true), para(`A. 3...a6 4.${B}a4`, true), para(`B. 3...${N}f6 4.0-0`, true));
    expect(moves(g)).toMatch(/3\. Bb5 a6 \(3\.\.\. Nf6 4\. O-O\) 4\. Ba4/);
  });
});

describe('αριθμός άσκησης δίπλα σε διάγραμμα-εικόνα', () => {
  // σκακιέρα 160×160 με πάνω άκρη στο y 500 (κελί 20), κείμενο μεγέθους 10
  const board = (x: number) => ({ str: '\u0001', x, y: 500, w: 160, size: 20, font: '#diagram', diagram: { placement: '8/8/8/8/8/8/8/8', turn: null as 'w' | 'b' | null, label: null as string | null, caption: '', x, y: 500, id: 0 } });
  const text = (str: string, x: number, y: number, size = 10) => ({ str, x, y, w: str.length * size * 0.6, size, font: 'ocr' });
  const body = Array.from({ length: 12 }, (_, k) => text('some words of the page', 300, 700 - k * 12));

  it('μεγάλος σκέτος αριθμός στο περιθώριο, αριστερά ή δεξιά, δίπλα στην πάνω άκρη· η γραμμή από πάνω γίνεται λεζάντα', () => {
    const left = board(100);
    annotateDiagrams([left], [...body, text('25', 60, 478, 20), text('Oleksienko – Gupta, New Delhi 2011', 110, 515)]);
    expect(left.diagram.label).toBe('25');
    expect(left.diagram.caption).toBe('Oleksienko – Gupta, New Delhi 2011');
    const right = board(100);
    annotateDiagrams([right], [...body, text('28', 270, 478, 20)]);
    expect(right.diagram.label).toBe('28');
  });

  it('και αριθμός με βαριά γραφή σε μέγεθος κειμένου (το μέγεθος δύο ψηφίων από τον αναγνώστη είναι αναξιόπιστο)', () => {
    const d = board(100);
    annotateDiagrams([d], [...body, { ...text('21', 264, 485), font: 'ocr-h' }]);
    expect(d.diagram.label).toBe('21');
  });

  it('όχι μικρός αριθμός (κίνηση ή συντεταγμένη)', () => {
    const d = board(100);
    annotateDiagrams([d], [...body, text('25', 75, 478)]);
    expect(d.diagram.label).toBeNull();
  });

  it('όχι παραπομπή του κειμένου «(Diagram 7)» ακριβώς πάνω από τη σκακιέρα· η λεζάντα «Diagram 7 (B)» δίνει τη σειρά', () => {
    const d = board(100);
    annotateDiagrams([d], [...body, text('3 exd5 (Diagram', 100, 524), text('7)', 100, 512), text('Diagram 7 (B)', 120, 325)]);
    expect(d.diagram.label).toBeNull();
    expect(d.diagram.turn).toBe('b');
  });

  it('η αρίθμηση που ξαναρχίζει σε κάθε κεφάλαιο μένει (διαγράμματα-εικόνες)· σκόρπιοι αριθμοί φεύγουν', () => {
    const ds = (labels: string[], id: number | undefined) => labels.map((label) => ({ placement: '8/8/8/8/8/8/8/8', turn: null, label, caption: '', ...(id === undefined ? {} : { id }) }));
    const chapters = ds(['1', '2', '3', '4', '5', '1', '2', '3', '4', '5'], 0);
    dropStrayLabels(chapters as never, true);
    expect(chapters.every((d) => d.label)).toBe(true);
    // (σε ψηφιακές σελίδες ο παλιός κανόνας: χωρίς επαναλήψεις)
    const digital = ds(['1', '2', '3', '4', '5', '1', '2', '3', '4', '5'], 0);
    dropStrayLabels(digital as never);
    expect(digital.every((d) => d.label === null)).toBe(true);
    const stray = ds(['12', '40', '7', '33', '21'], 0);
    dropStrayLabels(stray as never, true);
    expect(stray.every((d) => d.label === null)).toBe(true);
  });
});

describe('διάγραμμα-εικόνα με θέση από το πακέτο διαγραμμάτων', () => {
  // παράδειγμα μέσα σε κεφάλαιο: «παίκτες, διάγραμμα, 32.h6!»· η θέση: λευκός βασιλιάς e1, πιόνι e2, μαύρος βασιλιάς e8
  const img: BookParagraph = { page: 1, indent: 0, heading: false, caption: false, runs: [], text: '', diagram: { placement: '4k3/8/8/8/8/8/4P3/4K3', turn: 'w', label: null, caption: '', id: 0 } };
  const paras = [heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6', true), img, para('40.e4 Kd7 41.Kd2', true)];

  it('ξεκινά απόσπασμα από τη θέση του, όπως ένα ψηφιακό διάγραμμα', () => {
    const res = parseBook(paras, { title: 'T', author: '', trusted: () => true, fixed: () => true });
    expect(res.pgn).toMatch(/\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 w/);
    expect(res.pgn).toMatch(/40\. e4 Kd7 41\. Kd2/);
  });

  it('όχι όταν το κείμενο μετά το διάγραμμα συνεχίζει την παρτίδα (θέση βαριάντας ή κομμάτι που διαβάστηκε λάθος)', () => {
    const goesOn = [heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6', true), img, para('3.Bb5 a6 4.Ba4 Nf6', true)];
    const res = parseBook(goesOn, { title: 'T', author: '', trusted: () => true, fixed: () => true });
    expect(res.pgn).not.toMatch(/\[FEN /);
    expect(res.pgn).toMatch(/2\. Nf3 Nc6 3\. Bb5 a6 4\. Ba4 Nf6/);
  });

  it('η θέση ορίζεται από την πρώτη κίνηση με αριθμό, όχι από κίνηση της πρόζας πριν από αυτήν («Black threatens ...Kc5»)', () => {
    const study: BookParagraph = { ...img, diagram: { ...img.diagram!, placement: '8/8/8/1N1k4/1p6/8/7K/8', turn: null } };
    const text: BookParagraph = { ...para(''), runs: [{ text: 'Black threatens ...Kc5, so the first move is forced: ', main: false }, { text: '1.Nc7+! Kc4 2.Ne8', main: true }] };
    text.text = text.runs.map((r) => r.text).join('');
    const res = parseBook([heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6', true), study, text], { title: 'T', author: '', trusted: () => true, fixed: () => true });
    expect(res.pgn).toMatch(/\[FEN "8\/8\/8\/1N1k4\/1p6\/8\/7K\/8 w/);
    expect(res.pgn).toMatch(/1\. Nc7\+ \$1 Kc4 2\. Ne8/);
  });

  it('η πρώτη κίνηση με αριθμό ορίζει τη θέση και όταν είναι στην επόμενη παράγραφο («weakness on b3…», «19...d4!»)', () => {
    const ex: BookParagraph = { ...img, diagram: { ...img.diagram!, placement: '5rk1/pb2q1pp/1r1bpn2/2ppNp2/2P5/PP2P1P1/1BQ2PBP/2R2RK1', turn: null } };
    // (σύμβολο κομματιού από εικόνα κάπου στο βιβλίο: κείμενο από τον αναγνώστη εικόνας)
    const res = parseBook(
      [heading('Chapter 1'), para('1.e4 e5 2.f3', true), para('12. Razuvaev – Klinger', true), ex, para('White has a weakness on b3 and Black in the centre.'), para('19...d4! 20.exd4 Bxg2', true)],
      { title: 'T', author: '', trusted: () => true, fixed: () => true },
    );
    expect(res.pgn).toMatch(/19\.\.\. d4 \$1 20\. exd4 Bxg2/);
  });

  it('παράκαμψη: η βαριάντα ενός διαγράμματος σε απόσπασμα, και μετά η κύρια γραμμή συνεχίζει την παρτίδα', () => {
    // διάγραμμα: η θέση μετά από 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 (βαριάντα που δεν γράφτηκε), η κύρια γραμμή είναι 3.Bb5
    const side: BookParagraph = { ...img, diagram: { ...img.diagram!, placement: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R', turn: null } };
    const res = parseBook(
      [heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6 3.Bb5', true), side, para('4.c3 Nf6 5.d4 exd4 6.cxd4 Bb4+'), para('3...a6 4.Ba4 Nf6', true)],
      { title: 'T', author: '', trusted: () => true, fixed: () => true },
    );
    expect(res.pgn).toMatch(/3\. Bb5 a6 4\. Ba4 Nf6/);
    expect(res.pgn).toMatch(/\[FEN "r1bqk1nr\/pppp1ppp\/2n5\/2b1p3\/2B1P3\/5N2\/PPPP1PPP\/RNBQK2R w[^\]]*\]\s+4\. c3 Nf6 5\. d4 exd4 6\. cxd4 Bb4\+/);
  });

  it('θέση «W/B»: η γραμμή «If Black is to move… 1...» γίνεται δεύτερη παρτίδα από την ίδια θέση', () => {
    const wb: BookParagraph = { ...img, diagram: { ...img.diagram!, placement: 'n7/P7/2K5/8/3k4/8/8/8', turn: null } };
    const text = para('With White to move, Black is too late: 1.Kb7! Kc5 2.Kxa8! Kc6 3.Kb8. If Black is to move, he draws: 1...Ke5! 2.Kb7 Kd6! 3.Kxa8 Kc7! stalemate.');
    const res = parseBook([heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6', true), wb, text], { title: 'T', author: '', trusted: () => true, fixed: () => true });
    expect(res.pgn).toMatch(/\[FEN "n7\/P7\/2K5\/8\/3k4\/8\/8\/8 w[^\]]*\]\s+(?:\{[^}]*\}\s*)?1\. Kb7 \$1 Kc5 2\. Kxa8 \$1 Kc6 3\. Kb8/);
    expect(res.pgn).toMatch(/\[FEN "n7\/P7\/2K5\/8\/3k4\/8\/8\/8 b[^\]]*\]\s+(?:\{[^}]*\}\s*)?1\.\.\. Ke5 \$1 2\. Kb7 Kd6 \$1 3\. Kxa8 Kc7/);
  });

  it('όχι σε βιβλίο με διαγράμματα που «αιωρούνται» (το κείμενο τα καλεί «(Diagram 7)»)', () => {
    // η θέση μετά το 2...♘c6 χωρίς τα πιόνια h2, g2, h7 (3 τετράγωνα): το «3.Bb5 a6 4.Ba4 Nf6» παίζεται και από τις δύο
    const off: BookParagraph = { ...img, diagram: { ...img.diagram!, placement: 'r1bqkbnr/pppp1pp1/2n5/4p3/4P3/5N2/PPPP1P2/RNBQKB1R', turn: null } };
    const flow = [heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6', true), off, para('3.Bb5 a6 4.Ba4 Nf6', true)];
    const opts = { title: 'T', author: '', trusted: () => true, fixed: () => true };
    expect(parseBook(flow, opts).pgn).toMatch(/\[FEN "r1bqkbnr\/pppp1pp1/);
    const refs = [1, 2, 3].map((k) => para(`An idea (Diagram ${k}) for later.`));
    const res = parseBook([...refs, ...flow], opts);
    expect(res.pgn).not.toMatch(/\[FEN /);
    expect(res.pgn).toMatch(/2\. Nf3 Nc6 3\. Bb5 a6 4\. Ba4 Nf6/);
  });

  it('χωρίς το πακέτο (θέση μόνο από το σχήμα) όχι', () => {
    const res = parseBook(paras, { title: 'T', author: '', trusted: () => true });
    expect(res.pgn).not.toMatch(/40\. e4 Kd7/);
  });
});

describe('παρτίδες «Game N» μέσα στα κεφάλαια (αριθμοί χωρίς τελεία, από εικόνα)', () => {
  const mixed = (...runs: Array<[string, boolean]>): BookParagraph => {
    const p = para('');
    p.runs = runs.map(([text, main]) => ({ text, main }));
    p.text = p.runs.map((r) => r.text).join('');
    return p;
  };
  const book = [
    para('Chapter One', true),
    heading('1 e4 e5'),
    // (ο κατάλογος του κεφαλαίου στην πρώτη του σελίδα)
    para('Introduction Latvian Gambit Elephant Gambit Petroff Defence', true),
    heading('Introduction'),
    mixed(['You have played', false], [' 1 e4', true], [' and your opponent has replied', false], [' 1...e5', true], ['. Now', false], [' 2 Nf3', true], [' is best.', false]),
    para('Game 1'),
    para('G.Lane ■ M.Wojnar', true),
    para('Queenstown 2006'),
    para('1 e4 e5 2 Nf3 f5 3 Nxe5 Qf6 4 d4 d6 5 Nc4 fxe4 6 Be2 Nc6 7 d5 Nd4 8 Nc3 Bf5 9 Ne3 Nxe2 10 Qxe2 0-0-0 11 Qc4 a6 12 b4 1-0', true),
    heading('The Elephant Gambit'),
    mixed(["Now let's look at the second scariest move after 2 Nf3, which is", false], [' 2...d5.', true], [' This time we grab the pawn with', false], [' 3 exd5', true]),
    mixed(['If 3...Qxd5? 4 Nc3 Qa5, we have a type of Scandinavian (1 e4 d5 2 exd5 Qxd5 3 Nc3 Qa5 4 Nf3 e5?).', false]),
    mixed(['But he has the quixotic move', false], [' 3...Bd6!?', true], [' – the Elephant Gambit.', false]),
    para('Game 2'),
    para('G.Greco anonymous', true),
    para('Europe 1620'),
    para('1 e4 e5 2 Nf3 d6 3 Bc4 Bg4 4 h3 Bxf3 5 Qxf3 Qf6 6 Qb3 b6 7 Nc3 c6 8 Nd5 1-0', true),
    heading('Petroff Defence'),
    para('The Petroff, 1 e4 e5 3 Nf3 Nf6, is a boring, turgid opening line.'),
    para('Game 3'),
    mixed(['A.Timofeev L.Nisipeanu ', true], ['Skanderborg 2005', false]),
    para('1 e4 e5 2 Nf3 Nf6 3 Nxe5 d6 4 Nf3 Nxe4 5 Nc3 Nxc3 6 dxc3 Be7 1-0', true),
  ];
  const res = parseBook(book, { title: 'T', author: '' });
  const all = games(res.pgn);
  const byBlack = (b: string) => all.find((g) => g.includes(`[Black "${b}"]`)) ?? '';

  it('οι παίκτες από «G.Lane ■ M.Wojnar» και χωρίς τετράγωνα («G.Greco anonymous»), με τόπο και χρονιά', () => {
    expect(byBlack('Wojnar, M.')).toContain('[White "Lane, G."]');
    expect(byBlack('Wojnar, M.')).toContain('[Site "Queenstown"]');
    expect(byBlack('Wojnar, M.')).toContain('[Date "2006.??.??"]');
    expect(byBlack('anonymous')).toContain('[White "Greco, G."]');
    expect(byBlack('anonymous')).toContain('[Site "Europe"]');
    expect(byBlack('Nisipeanu, L.')).toContain('[Site "Skanderborg"]');
  });

  it('«Chapter One» σε έντονα είναι κεφάλαιο, και η εισαγωγή του δεν λέγεται «Όλο το κεφάλαιο»', () => {
    const intro = byBlack('Εισαγωγή');
    expect(intro).toContain('[White "1. 1 e4 e5"]');
    expect(moves(intro)).toMatch(/^1\. e4 (?:1\.\.\. )?e5 2\. Nf3/);
    expect(res.pgn).not.toContain('Όλο το κεφάλαιο');
  });

  it('η ενότητα μετά από παρτίδα είναι δική της παρτίδα, και αρχίζει από τη γραμμή της προηγούμενης («2...d5»)', () => {
    const elephant = byBlack('The Elephant Gambit');
    expect(elephant).toContain('[White "1. 1 e4 e5"]');
    expect(moves(elephant)).toMatch(/^1\. e4 e5 .*2\. Nf3 (?:2\.\.\. )?d5 3\. exd5 (?:3\.\.\. )?Bd6/);
    // (η παρένθεση «(1 e4 d5 …)» δεν γίνεται κύρια γραμμή)
    expect(moves(elephant)).not.toMatch(/^1\. e4 d5/);
    expect(moves(byBlack('Wojnar, M.'))).not.toContain('Bd6');
  });

  it('λάθος αριθμός μέσα σε σειρά κινήσεων: «1 e4 e5 3 Nf3 Nf6» = 1.e4 e5 2.Nf3 Nf6', () => {
    expect(moves(byBlack('Petroff Defence'))).toBe('1. e4 e5 2. Nf3 Nf6 *');
  });
});

describe('διαγράμματα-εικόνες με επεξήγηση, χωρίς κινήσεις', () => {
  const diag = (id: number, placement: string): BookParagraph => ({ page: 1, indent: 0, heading: false, caption: false, runs: [], text: '', diagram: { placement, turn: null, label: null, caption: '', id } });
  const ruy = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R';
  const sicilian = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR';
  const paras = [
    heading('Chapter 1'),
    para('Alternatively, White may choose to develop their bishop to b5 instead of c4:'),
    diag(0, ruy),
    para('This is called the Ruy López or the Spanish Opening.'),
    diag(1, sicilian),
    para('Here Black has pushed their c pawn to c5. This is another way of preventing White from pushing the d pawn to d4.'),
  ];
  const res = parseBook(paras, { title: 'T', author: '', trusted: () => true, fixed: () => true });
  const all = games(res.pgn);

  it('το κείμενο μένει στο δικό του διάγραμμα, όχι στο επόμενο', () => {
    const r = all.find((g) => g.includes(ruy)) ?? '';
    const s = all.find((g) => g.includes(sicilian)) ?? '';
    expect(r).toContain('Ruy López');
    expect(s).not.toContain('Ruy López');
    expect(s).toContain('pushed their c pawn');
  });

  it('«to b5», «to d4» στην πρόζα είναι τετράγωνα, όχι κινήσεις', () => {
    for (const g of all) expect(moves(g)).not.toMatch(/\b(?:b5|d4|c5)\b/);
  });
});

describe('θέσεις διαγραμμάτων που δεν γίνονται, και ροκέ με μεγάλη παύλα', () => {
  const diagram = (placement: string): BookParagraph => ({ page: 1, indent: 0, heading: false, caption: false, runs: [], text: '', diagram: { placement, turn: null, label: null, caption: '', id: 0 } });

  it('βασίλισσες με ανάποδα χρώματα, σε σαχ αυτός που δεν παίζει: αλλάζουν χρώμα', () => {
    // μετά το 7...♘b6 8.♗d3 της Αλιέχιν, με τη λευκή βασίλισσα στο d8 και τη μαύρη στο d1
    const res = parseBook([heading('Chapter 1'), diagram('rnbQkb1r/pp3ppp/1n1pp3/4P3/3P4/3B1N2/PP3PPP/RNBqK2R'), para('8...Nc6 9.O-O dxe5 10.dxe5', true)], { title: 'T', author: '', trusted: () => true, fixed: () => true });
    expect(res.pgn).toMatch(/\[FEN "rnbqkb1r\/pp3ppp\/1n1pp3\/4P3\/3P4\/3B1N2\/PP3PPP\/RNBQK2R b/);
    expect(res.pgn).toMatch(/8\.\.\. Nc6 9\. O-O dxe5 10\. dxe5/);
    expect(swapColors('rnbQkb1r/pp3ppp/1n1pp3/4P3/3P4/3B1N2/PP3PPP/RNBqK2R')).toBe('rnbqkb1r/pp3ppp/1n1pp3/4P3/3P4/3B1N2/PP3PPP/RNBQK2R');
    // (θέση με σαχ σε αυτόν που παίζει: μένει)
    expect(swapColors('4k3/8/8/8/8/8/8/R3K2q', 'w')).toBe('4k3/8/8/8/8/8/8/R3K2q');
  });

  it('«0–0–0» και «0–0» με μεγάλη παύλα είναι ροκέ', () => {
    const res = parseBook([heading('Chapter 1'), para('1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.0–0 Nf6 5.d3 0–0', true)], { title: 'T', author: '' });
    expect(moves(games(res.pgn)[0])).toMatch(/4\. O-O Nf6 5\. d3 O-O/);
  });
});

describe('λάθη του OCR που έσπαγαν ολόκληρες παρτίδες', () => {
  // (ένα σύμβολο κομματιού ως εικόνα κάπου στο βιβλίο: κείμενο από εικόνα)
  const image = para('');
  // (βιβλίο με αριθμούς χωρίς τελεία: ≥ 20 τέτοιοι)
  const fill = para(Array.from({ length: 22 }, (_, k) => `${30 + k} h3`).join(', '));
  const played = (pgn: string) => games(pgn).map(moves).find((m) => /\d\./.test(m)) ?? pgn;

  it('«5 N b5», «19 Of4», «80-0»: κενό στο κομμάτι, O για Q, αριθμός κολλημένος στο ροκέ', () => {
    const res = parseBook([heading('Chapter 1'), para('Game 1'), para('1 e4 c5 2 Nf3 Nc6 3 d4 cxd4 4 Nxd4 e5 5 N b5 d6 6 N1c3 a6 7 Na3 b5 8 Nd5 Nf6 9 Bd3 Be7 100-0 0-0 11 Oe2 Oc7', true), fill], { title: 'T', author: '' });
    expect(played(res.pgn)).toMatch(/5\. Nb5 d6 6\. N1c3 a6 7\. Na3 b5 8\. Nd5 Nf6 9\. Bd3 Be7 10\. O-O O-O 11\. Qe2 Qc7/);
  });

  it('αριθμός στο τέλος ενός έντονου κομματιού και η κίνηση στο επόμενο («9 » + «Nd5», «9...» + « Bd7»)', () => {
    const p: BookParagraph = { ...para(''), runs: [{ text: '1 e4 c5 2 Nf3 d6 3 d4 cxd4 4 Nxd4 Nf6 5 Nc3 a6 6 ', main: true }, { text: 'Be2 e5 7 Nb3', main: true }, { text: ' A quiet move. ', main: false }, { text: '7...', main: true }, { text: ' Be7 8 O-O', main: true }] };
    p.text = p.runs.map((r) => r.text).join('');
    const res = parseBook([heading('Chapter 1'), para('Game 1'), p, fill], { title: 'T', author: '' });
    expect(played(res.pgn)).toMatch(/6\. Be2 e5 7\. Nb3 .*7\.\.\. Be7 8\. O-O/);
  });

  it('κίνηση του Μαύρου χωρίς τα αποσιωπητικά μετά από σχόλιο («2 Nf3 For comments… 2 e6»)', () => {
    const p: BookParagraph = { ...para(''), runs: [{ text: '1 e4 c5 2 Nf3 ', main: true }, { text: 'For comments see Game 8. ', main: false }, { text: '2 e6 ', main: true }, { text: 'In earlier games we have seen 2...d6. ', main: false }, { text: '3 d4 ', main: true }, { text: 'The most active. ', main: false }, { text: '3 … cxd4 4 Nxd4', main: true }] };
    p.text = p.runs.map((r) => r.text).join('');
    const res = parseBook([heading('Chapter 1'), para('Game 1'), p, image, fill], { title: 'T', author: '' });
    expect(played(res.pgn)).toMatch(/^1\. e4 c5 2\. Nf3 2\.\.\. e6 .*3\. d4 .*3\.\.\. cxd4 4\. Nxd4/);
  });

  it('αποσιωπητικά ως ιδεογράμματα σε δικό τους κομμάτι («16» + « 电电申» + « Qf8»)', () => {
    const p: BookParagraph = { ...para(''), runs: [{ text: '1 e4 e5 2 Nf3 Nc6 3 Bb5 a6 4 Ba4 Nf6 5 O-O Be7 6 Re1 b5 7 Bb3 d6 8 c3 O-O 9 h3 Nb8 10 d4 Nbd7 11 Nbd2 Bb7 12 Bc2 Re8 13 Nf1 Bf8 14 Ng3 g6 15 a4 c5 16 d5 ', main: true }, { text: 'Natural. ', main: false }, { text: '16', main: true }, { text: ' 电电申', main: false }, { text: ' Nb6 17 Qe2', main: true }] };
    p.text = p.runs.map((r) => r.text).join('');
    const res = parseBook([heading('Chapter 1'), para('Game 1'), p, image, fill], { title: 'T', author: '' });
    expect(played(res.pgn)).toMatch(/16\. d5 .*16\.\.\. Nb6 17\. Qe2/);
  });

  it('«W» κάτω από το διάγραμμα: η σειρά του διαγράμματος, όχι σχόλιο', () => {
    const d: BookParagraph = { page: 1, indent: 0, heading: false, caption: false, runs: [], text: '', diagram: { placement: '6k1/5ppp/8/8/8/8/5PPP/R5K1', turn: 'b', label: null, caption: '', id: 0 } };
    const res = parseBook([heading('Chapter 1'), d, para('W'), para('1.Ra8#', true)], { title: 'T', author: '', trusted: () => true, fixed: () => true });
    expect(res.pgn).toMatch(/\[FEN "6k1\/5ppp\/8\/8\/8\/8\/5PPP\/R5K1 w/);
    expect(res.pgn).toMatch(/1\. Ra8#/);
    expect(res.pgn).not.toMatch(/\{W\}/);
  });

  it('η πρώτη κίνηση χωρίς το «1» στην αρχή της παρτίδας («d4 Nf6 2 Nf3 g6»)', () => {
    const res = parseBook([heading('Chapter 1'), para('Game 1'), para('d4 Nf6 2 Nf3 g6 3 c4 Bg7 4 Nc3 O-O 5 e4 d6', true), image, fill], { title: 'T', author: '' });
    expect(played(res.pgn)).toMatch(/^1\. d4 Nf6 2\. Nf3 g6 3\. c4 Bg7/);
  });
});
