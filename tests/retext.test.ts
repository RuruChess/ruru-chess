/**
 * Τεστ: σκαναρισμένες σελίδες με δύο αναγνώσεις (OCR των Windows με θέσεις, μοντέλο εικόνας-κειμένου με σωστό
 * κείμενο), και η διάταξη των βιβλίων με μία κίνηση ανά γραμμή (Gambit). Συνθετικά δεδομένα, καμία σελίδα από βιβλίο.
 */
import { describe, expect, it } from 'vitest';
import { pageLines, toParagraphs } from '../src/server/books/pdf.ts';
import { retext, vlmTokens } from '../src/server/books/retext.ts';

const word = (str: string, x: number, y: number, w = str.length * 5) => ({ str, x, y, w, size: 10, font: 'ocr' });
/** μια γραμμή του OCR: λέξεις με κενό 4 μονάδων */
const line = (text: string, x: number, y: number) => {
  const out = [];
  for (const s of text.split(' ')) {
    out.push(word(s, x, y));
    x += s.length * 5 + 4;
  }
  return out;
};
const NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
const texts = (items: ReturnType<typeof word>[]) =>
  pageLines(items as never, 1).map((l) => l.segs.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim());

describe('ένωση OCR των Windows και μοντέλου', () => {
  it('το κείμενο του μοντέλου στις θέσεις του OCR· το σύμβολο του κομματιού από το OCR («Oxb3»), τα ψηφία από το μοντέλο', () => {
    const ocr = [...line('After l7 Oxb3 Af6 l8 Acl Zb4 Black regains', 50, 600), ...line('the pawn with an equal position.', 50, 588)];
    const out = retext(ocr, 'After 17 ⚓xb3 ⚩f6 18 ⚓c1 ⚩b4 Black regains the pawn with an equal position.');
    expect(texts(out)).toEqual(['After 17 Oxb3 Af6 18 Ac1 Zb4 Black regains', 'the pawn with an equal position.']);
  });

  it('γραμμή που το OCR δεν διάβασε καθόλου («4 ... cxd4») μπαίνει ως δική της γραμμή στο κενό, όχι κολλημένη σε άλλη', () => {
    const ocr = [...line('White decides to transpose into', 50, 600), ...line('a standard Open Sicilian.', 50, 588), ...line('The exchange of pawns', 50, 550)];
    const out = retext(ocr, 'White decides to transpose into a standard Open Sicilian.\n4 ... cxd4\nThe exchange of pawns');
    expect(texts(out)).toEqual(['White decides to transpose into', 'a standard Open Sicilian.', '4 ... cxd4', 'The exchange of pawns']);
  });

  it('λέξεις χωρίς ζευγάρι δεν περνούν στην άλλη στήλη', () => {
    const ocr: ReturnType<typeof word>[] = [];
    for (let k = 0; k < 10; k++) {
      ocr.push(...line(`left column ${NAMES[k]} line`, 20, 600 - k * 12));
      ocr.push(...line(`right column ${NAMES[k]}x row`, 260, 600 - k * 12));
    }
    // το μοντέλο διαβάζει μια λέξη παραπάνω στο τέλος της αριστερής γραμμής 3 («extra»)
    const left = NAMES.map((n, k) => `left column ${n} line${k === 3 ? ' extra' : ''}`).join('\n');
    const right = NAMES.map((n) => `right column ${n}x row`).join('\n');
    const t = texts(retext(ocr, `${left}\n${right}`));
    expect(t).toContain('left column delta line extra');
    expect(t).toContain('right column deltax row');
  });

  it('χωρίς κείμενο από το μοντέλο: οι λέξεις του OCR όπως ήταν', () => {
    const ocr = line('just some words here', 50, 600);
    expect(retext(ocr, '')).toBe(ocr);
    expect(vlmTokens('# Title\n**17 cxb3** <br> x').map((t) => t.s)).toEqual(['Title', '17', 'cxb3', 'x']);
  });
});

describe('σκαναρισμένες σελίδες σε δύο στήλες', () => {
  it('επικεφαλίδα σε όλο το πλάτος σε χωριστές λέξεις («Wijk aan | Zee 1999») μένει μία γραμμή, πριν από τις στήλες', () => {
    // (κεντραρισμένη πάνω από το κενό των στηλών, 240–260· το κενό ανάμεσα στο «aan» και στο «Zee» είναι ένα διάστημα)
    const items = [...line('Wijk aan Zee 1999', 212, 640)];
    for (let k = 0; k < 12; k++) {
      items.push(word(`left text ${k}`, 20, 620 - k * 12, 220));
      items.push(word(`right text ${k}`, 260, 620 - k * 12, 220));
    }
    const t = texts(items);
    expect(t[0]).toBe('Wijk aan Zee 1999');
    expect(t.slice(1, 13)).toEqual(Array.from({ length: 12 }, (_, k) => `left text ${k}`));
  });

  it('γραμμή του OCR μόνο με αριθμό και κίνηση («17 cxb3», «17 ... Af6») είναι κύρια γραμμή, σε δική της παράγραφο', () => {
    const items = [...line('is not so effective with the rook', 20, 600), ...line('17 cxb3', 80, 588), ...line('After 17 Oxb3 Black regains', 20, 576), ...line('17 ... Af6', 80, 564)];
    const paras = toParagraphs(pageLines(items as never, 1), {});
    expect(paras.map((p) => p.runs.map((r) => (r.main ? `[[${r.text.trim()}]]` : r.text.trim())).join(''))).toEqual([
      'is not so effective with the rook',
      '[[17 cxb3]]',
      'After 17 Oxb3 Black regains',
      '[[17 ... Af6]]',
    ]);
  });
});
