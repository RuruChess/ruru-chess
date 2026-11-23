// Διάταξη σελίδων που διαβάστηκαν από την εικόνα τους (λέξη-λέξη), με συνθετικά δεδομένα: στήλες με στενό κενό,
// σελίδες με ζώνες (κείμενο σε όλο το πλάτος ανάμεσα σε ζώνες δύο στηλών), κεφαλίδες σελίδας με κείμενο που αλλάζει,
// και τα βιβλία με μία κίνηση ανά γραμμή («3 … f5»), όπου η κύρια γραμμή σώζεται από τη θέση των κινήσεων.
import { describe, expect, it } from 'vitest';
import { pageLines, toParagraphs } from '../src/server/books/pdf.ts';

const word = (str: string, x: number, y: number, w = 47, font = 'ocr') => ({ str, x, y, w, size: 10, font });
/** τέσσερις λέξεις μιας γραμμής στήλης, από το `x0` (λέξη 47, κενό 3) */
const colRow = (tag: string, x0: number, y: number) => [0, 1, 2, 3].map((k) => word(`${tag}${k}`, x0 + k * 50, y));
/** γραμμή σε όλο το πλάτος: οκτώ λέξεις, η πέμπτη πάνω στο κενό των στηλών */
const fullRow = (tag: string, y: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => word(`${tag}${k}`, 50 + k * 50.6, y));
const first = (lines: Array<{ segs: Array<{ text: string }> }>) => lines.map((l) => l.segs[0].text);

describe('στήλες σε σελίδες από εικόνα', () => {
  // αριστερή στήλη 50–247, δεξιά 257–454: κενό 10 σε γράμματα 10... και στενό, 7, πιο κάτω
  it('σελίδα με ζώνες: δύο στήλες, κείμενο σε όλο το πλάτος, πάλι δύο στήλες', () => {
    const items = [];
    let y = 700;
    for (let r = 0; r < 14; r++, y -= 12) items.push(...colRow(`a${r}L`, 50, y), ...colRow(`a${r}R`, 257, y));
    for (let r = 0; r < 6; r++, y -= 12) items.push(...fullRow(`f${r}w`, y));
    for (let r = 0; r < 14; r++, y -= 12) items.push(...colRow(`b${r}L`, 50, y), ...colRow(`b${r}R`, 257, y));
    const order = first(pageLines(items as never, 1));
    const col = (z: string, side: string) => Array.from({ length: 14 }, (_, r) => `${z}${r}${side}0`);
    expect(order).toEqual([...col('a', 'L'), ...col('a', 'R'), ...Array.from({ length: 6 }, (_, r) => `f${r}w0`), ...col('b', 'L'), ...col('b', 'R')]);
  });

  it('στενό κενό (0,7 του μεγέθους των γραμμάτων): στήλες όταν η δεξιά αρχίζει πάντα στο ίδιο x', () => {
    const items = [];
    let y = 700;
    // (κενό 9 σε γράμματα 13)
    for (let r = 0; r < 20; r++, y -= 15) items.push(...colRow(`${r}L`, 51, y), ...colRow(`${r}R`, 257, y));
    const order = first(pageLines(items.map((it) => ({ ...it, size: 13 })) as never, 1));
    expect(order.slice(0, 3)).toEqual(['0L0', '1L0', '2L0']);
    expect(order.slice(20, 22)).toEqual(['0R0', '1R0']);
  });

  it('κεφαλίδα σε χωριστές λέξεις, μία πάνω στο κενό: μία γραμμή σε όλο το πλάτος', () => {
    const items = [word('GAME', 150, 730, 24), word('2:', 178, 730, 10), word('KHALIFMAN', 222, 730, 56), word('SVESHNIKOV', 300, 730, 60), word('17', 440, 730, 12)];
    let y = 700;
    for (let r = 0; r < 20; r++, y -= 12) items.push(...colRow(`${r}L`, 50, y), ...colRow(`${r}R`, 260, y));
    const lines = pageLines(items as never, 1);
    expect(lines[0].segs.map((s) => s.text).join(' ')).toBe('GAME 2: KHALIFMAN SVESHNIKOV 17');
    expect(first(lines).slice(1, 3)).toEqual(['0L0', '1L0']);
  });

  it('το κενό των στηλών του βιβλίου σε σελίδα όπου δεν βρίσκεται μόνο του (λίγες γραμμές σε στήλες στο τέλος)', () => {
    const items = [];
    let y = 700;
    for (let r = 0; r < 20; r++, y -= 12) items.push(...fullRow(`f${r}w`, y));
    for (let r = 0; r < 5; r++, y -= 12) items.push(...colRow(`${r}L`, 50, y), ...colRow(`${r}R`, 257, y));
    // μόνη της: οι στήλες ενώνονται
    expect(first(pageLines(items as never, 1)).slice(20)).toEqual(['0L0', '1L0', '2L0', '3L0', '4L0']);
    const order = first(pageLines(items as never, 1, 0, { left: 247, right: 257 }));
    expect(order.slice(20)).toEqual(['0L0', '1L0', '2L0', '3L0', '4L0', '0R0', '1R0', '2R0', '3R0', '4R0']);
    // σελίδα μίας στήλης: η υπόδειξη δεν αλλάζει τίποτα
    const plain = [];
    for (let r = 0, yy = 700; r < 20; r++, yy -= 12) plain.push(...fullRow(`f${r}w`, yy));
    expect(pageLines(plain as never, 1, 0, { left: 247, right: 257 }).every((l) => l.segs.length === 8)).toBe(true);
  });
});

const seg = (text: string, x: number, font = 'ocr') => ({ text, font, x, end: x + text.length * 5 });
const row = (page: number, y: number, segs: Array<ReturnType<typeof seg>>) => ({ page, x: segs[0].x, y, size: 10, segs });

describe('κεφαλίδες σελίδας', () => {
  it('κεφαλίδα με κείμενο που αλλάζει φεύγει όταν ο αριθμός της απέχει πάντα το ίδιο από τη σελίδα· και η μισή της', () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Foxtrot', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];
    const lines: ReturnType<typeof row>[] = [];
    names.forEach((n, i) => {
      const page = i + 1;
      // (σελίδα 6: ο αναγνώστης βρήκε μόνο το πρώτο μισό της κεφαλίδας)
      lines.push(row(page, 730, [seg(page === 6 ? `GAME ${page}: ${n}` : `GAME ${page}: ${n} – Other${n} ${page + 5}`, 120, 'f1')]));
      lines.push(row(page, 700, [seg(`Body text of page ${page} goes here and continues`, 50, 'f1')]));
      lines.push(row(page, 688, [seg('with a second line that ends the paragraph.', 50, 'f1')]));
    });
    const text = toParagraphs(lines as never, {}).map((p) => p.text).join('\n');
    expect(text).not.toMatch(/GAME/);
    expect(text).toMatch(/Body text of page 6/);
  });
});

describe('βιβλία με μία κίνηση ανά γραμμή, από εικόνα', () => {
  const ROLES = { ocr: 'prose', 'ocr-b': 'main' } as const;
  /** σελίδες με οκτώ ζεύγη «N κίνηση» / «N … κίνηση» ανάμεσα σε γραμμές κειμένου· ο αριθμός στο x 95 */
  function book(extra: (page: number, y: number) => ReturnType<typeof row>[]) {
    const lines: ReturnType<typeof row>[] = [];
    for (let page = 1; page <= 3; page++) {
      let y = 720;
      for (let k = 1; k <= 8; k++) {
        const n = String((page - 1) * 8 + k);
        const end = 95 + n.length * 5;
        lines.push(row(page, y, [seg(n, 95, 'ocr-b'), seg('e4', end + 16, 'ocr-b')]));
        lines.push(row(page, (y -= 12), [seg('White plays a natural developing move here,', 50)]));
        lines.push(row(page, (y -= 12), [seg('and the comment goes on for a second line.', 50)]));
        lines.push(row(page, (y -= 12), [seg(n, 95, 'ocr-b'), seg('…', end + 22), seg('e5', end + 70, 'ocr-b')]));
        lines.push(row(page, (y -= 12), [seg('Black answers in the centre, as expected.', 50)]));
        y -= 12;
      }
      lines.push(...extra(page, y));
    }
    return toParagraphs(lines as never, ROLES as never);
  }
  const mainText = (paras: ReturnType<typeof toParagraphs>) => paras.flatMap((p) => p.runs.filter((r) => r.main).map((r) => r.text.trim()));

  it('κίνηση του Μαύρου που έμεινε μόνη της παίρνει αριθμό και κουκκίδες', () => {
    const paras = book((page, y) =>
      page === 3 ? [row(3, y, [seg('25', 95, 'ocr-b'), seg('d4', 121, 'ocr-b')]), row(3, y - 12, [seg('See the notes to this move in the last game.', 50)]), row(3, y - 24, [seg('c5', 175, 'ocr-b')])] : [],
    );
    expect(mainText(paras)).toContain('25 … c5');
  });

  it('«σημάδι, κίνηση» και «αριθμός, σκουπίδι, κίνηση»: οι κουκκίδες που διαβάστηκαν λάθος', () => {
    const paras = book((page, y) =>
      page === 3
        ? [
            row(3, y, [seg('25', 95, 'ocr-b'), seg('d4', 121, 'ocr-b')]),
            row(3, y - 12, [seg('A comment about the move just played by White.', 50)]),
            row(3, y - 24, [seg('*', 127), seg('exd4', 175, 'ocr-b')]),
            row(3, y - 36, [seg('Another comment follows the capture on d4.', 50)]),
            row(3, y - 48, [seg('26', 95, 'ocr-b'), seg('●1', 127), seg('Nxd4', 175, 'ocr-b')]),
          ]
        : [],
    );
    const main = mainText(paras);
    expect(main).toContain('25 … exd4');
    expect(main).toContain('26 … Nxd4');
  });

  it('γραμμή-κίνηση που δεν βγήκε έντονη αλλά έχει την εσοχή των κινήσεων είναι κύρια γραμμή· στο περιθώριο όχι', () => {
    const paras = book((page, y) =>
      page === 3
        ? [row(3, y, [seg('25', 95), seg('Re1', 121)]), row(3, y - 12, [seg('White defends the pawn. The alternative is', 50)]), row(3, y - 24, [seg('26', 50), seg('Nc3', 66)])]
        : [],
    );
    const main = mainText(paras);
    expect(main).toContain('25 Re1');
    expect(main.join(' ')).not.toMatch(/26/);
  });

  it('ο αριθμός κίνησης που δεν βγήκε έντονος μένει με την κίνησή του', () => {
    const paras = book((page, y) => (page === 3 ? [row(3, y, [seg('25', 95), seg('Nd4', 121, 'ocr-b'), seg('d5', 175, 'ocr-b')])] : []));
    expect(mainText(paras)).toContain('25 Nd4 d5');
  });
});

describe('σελίδες από εικόνα: κεφαλίδα μέρους χωρίς αριθμό σελίδας και τίτλος ενότητας με κεφαλαία', () => {
  const ROLES = { ocr: 'prose', 'ocr-h': 'main' } as const;
  const body = (page: number) => [row(page, 700, [seg(`Body text of page ${page} goes here and continues`, 50)]), row(page, 688, [seg('with a second line that ends the paragraph.', 50)])];

  it('η ίδια πάνω γραμμή σε τρεις σελίδες φεύγει (όποια ομάδα σχήματος κι αν έχει το σύμβολο)· πιο χαμηλά μένει', () => {
    const lines: ReturnType<typeof row>[] = [];
    for (let page = 1; page <= 6; page++) {
      // (το σύμβολο του ίππου άλλης ομάδας σε κάθε σελίδα)
      if (page !== 4) lines.push(row(page, 730, [seg(`1.e4 c5 2.${String.fromCharCode(0xe000 + page)}f3 e6`, 50)]));
      // (σελίδα 4, αρχή ενότητας: η ίδια γραμμή πιο χαμηλά είναι κείμενο του βιβλίου)
      else lines.push(row(page, 712, [seg('1.e4 c5 2.f3 e6', 50, 'ocr-h')]));
      lines.push(...body(page));
    }
    const paras = toParagraphs(lines as never, ROLES as never);
    expect(paras.filter((p) => /1\.e4 c5/.test(p.text)).map((p) => p.page)).toEqual([4]);
    expect(paras.filter((p) => /Body text/.test(p.text))).toHaveLength(6);
  });

  it('ο τίτλος της ενότητας (κινήσεις και από κάτω κεφαλαία) πάει στην αρχή της σελίδας, τα κεφαλαία πρώτα', () => {
    const lines = [
      ...body(1),
      // η δεξιά στήλη αρχίζει με τον τίτλο
      row(1, 730, [seg('1.e4 c5 2.Nf3 e6 3.d4 cd4', 50, 'ocr-h')]),
      row(1, 718, [seg('4.Nd4 Nc6 5.Nb5 d6', 50, 'ocr-h')]),
      row(1, 694, [seg('QUICK REPERTOIRE', 50, 'ocr-h')]),
      row(1, 660, [seg('The right column goes on with its own text.', 50)]),
    ];
    const paras = toParagraphs(lines as never, ROLES as never);
    expect(paras.map((p) => `${p.heading ? 'H ' : ''}${p.text.trim().slice(0, 16)}`)).toEqual(['H QUICK REPERTOIRE', '1.e4 c5 2.Nf3 e6', 'Body text of pag', 'The right column']);
    expect(paras[1].text.replace(/\s+/g, ' ').trim()).toBe('1.e4 c5 2.Nf3 e6 3.d4 cd4 4.Nd4 Nc6 5.Nb5 d6');
    expect(paras[1].runs.every((r) => r.main)).toBe(true);
  });
});

describe('σελίδα με ζώνες όπου οι γραμμές σε όλο το πλάτος είναι πάνω από το 30% (Nunn, πρώτη σελίδα παρτίδας)', () => {
  it('οι στήλες βρίσκονται από το κοινό κενό τους, και η μεγάλη επικεφαλίδα στο αριστερό μισό είναι σε όλο το πλάτος', () => {
    const items = [];
    let y = 700;
    for (let r = 0; r < 5; r++, y -= 12) items.push(...colRow(`a${r}L`, 50, y), ...colRow(`a${r}R`, 257, y));
    items.push({ str: 'Heading', x: 50, y: (y -= 6), w: 120, size: 15, font: 'ocr' });
    y -= 18;
    for (let r = 0; r < 10; r++, y -= 12) items.push(...fullRow(`f${r}w`, y));
    for (let r = 0; r < 5; r++, y -= 12) items.push(...colRow(`b${r}L`, 50, y), ...colRow(`b${r}R`, 257, y));
    const order = first(pageLines(items as never, 1));
    const col = (z: string, side: string) => Array.from({ length: 5 }, (_, r) => `${z}${r}${side}0`);
    expect(order).toEqual([...col('a', 'L'), ...col('a', 'R'), 'Heading', ...Array.from({ length: 10 }, (_, r) => `f${r}w0`), ...col('b', 'L'), ...col('b', 'R')]);
  });
});
