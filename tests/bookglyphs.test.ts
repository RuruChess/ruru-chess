/**
 * Τεστ: βιβλία σε δύο στήλες με σύμβολα κομματιών που το PDF δεν μεταφράζει σε γράμματα. Συνθετικά
 * δεδομένα (καμία σελίδα από βιβλίο): οι στήλες διαβάζονται χωριστά, τα «σκουπίδια» γίνονται κομμάτια από τη νομιμότητα,
 * και το «Game 1» ξεκινά παρτίδα με τους παίκτες της.
 */
import { describe, expect, it } from 'vitest';
import { pageLines, toParagraphs } from '../src/server/books/pdf.ts';
import { normalizeBookText, parseBook, type BookParagraph } from '../src/core/bookparse.ts';

const item = (str: string, x: number, y: number, w = 110) => ({ str, x, y, w, size: 9, font: 'f1' });

describe('βιβλία σε δύο στήλες', () => {
  it('πρώτα όλη η αριστερή στήλη, μετά η δεξιά· ο τίτλος σε όλο το πλάτος πρώτος', () => {
    const items = [item('Game Title Across The Page', 20, 600, 300)];
    for (let k = 0; k < 12; k++) {
      items.push(item(`left ${k}`, 20, 580 - k * 12));
      items.push(item(`right ${k}`, 180, 580 - k * 12));
    }
    const text = pageLines(items as never, 1).map((l) => l.segs.map((s) => s.text).join(' '));
    expect(text[0]).toBe('Game Title Across The Page');
    expect(text.slice(1, 13)).toEqual(Array.from({ length: 12 }, (_, k) => `left ${k}`));
    expect(text.slice(13)).toEqual(Array.from({ length: 12 }, (_, k) => `right ${k}`));
  });

  it('μία στήλη: όπως πριν', () => {
    const items = Array.from({ length: 24 }, (_, k) => item(`line ${k} with words across the whole width`, 20, 600 - k * 12, 300));
    expect(pageLines(items as never, 1).map((l) => l.segs[0].text)).toEqual(items.map((i) => i.str));
  });

  it('μία στήλη σε πολλά μικρά κομμάτια (σύμβολα κομματιών χωριστά) με κοντές γραμμές: όχι στήλες', () => {
    const items = [];
    for (let k = 0; k < 30; k++) {
      // λέξεις 12–40 μονάδων με κενό 3· κάθε τρίτη γραμμή τελειώνει νωρίς (τέλος παραγράφου)
      const end = k % 3 === 2 ? 200 : 440;
      for (let x = 50, j = 0; x < end; j++) {
        const w = 12 + ((k * 7 + j * 13) % 29);
        items.push(item(`r${k}w${j}`, x, 600 - k * 12, w));
        x += w + 3;
      }
    }
    const lines = pageLines(items as never, 1);
    expect(lines.map((l) => l.segs[0].text)).toEqual(Array.from({ length: 30 }, (_, k) => `r${k}w0`));
  });

  it('κεφαλίδα με τον αριθμό της σελίδας, και σε λίγες σελίδες («Solutions to Exercises 11»): φεύγει', () => {
    const line = (page: number, y: number, text: string) => ({ page, x: 50, y, size: 10, segs: [{ text, font: 'f1', x: 50, end: 50 + text.length * 5 }] });
    const lines = [];
    for (let p = 1; p <= 3; p++) lines.push(line(p, 700, `Solutions to Exercises ${p + 10}`), line(p, 680, `Text of page ${p} goes on`), line(p, 100, `and ends here.`));
    const text = toParagraphs(lines as never, {}).map((q) => q.text).join(' ');
    expect(text).not.toContain('Solutions');
    expect(text).toContain('Text of page 1 goes on');
  });
});

describe('σύμβολα κομματιών χωρίς γράμματα', () => {
  it('κανονικοποίηση: «•••», αριθμοί σπασμένοι στο «1», κείμενο χωρίς αλλαγές', () => {
    expect(normalizeBookText('9 ••• dxe4')).toBe('9 ... dxe4');
    expect(normalizeBookText('1 1 ... d5')).toBe('11 ... d5');
    expect(normalizeBookText('1.e4 e5, the real deal')).toBe('1.e4 e5, the real deal');
  });

  it('η παρτίδα διαβάζεται, με τα κομμάτια από τη νομιμότητα και τους παίκτες από τον τίτλο', () => {
    const para = (text: string, heading = false): BookParagraph => ({ page: 1, indent: 0, heading, caption: false, runs: [{ text, main: false }], text });
    const res = parseBook(
      [
        para('Game 1'),
        para('Alpha - Beta', true),
        para("1.e4 e5 2.liJf3 tLlc6 3.i..b5 a6 4.'ii'e2 liJf6 5.0-0 J.e7 6.1:.e1 b6 7.'itth1 d6 1-0"),
      ],
      { title: 'x', author: '' },
    );
    expect(res.games).toHaveLength(1);
    const g = res.games[0];
    expect([g.headers.White, g.headers.Black]).toEqual(['Alpha', 'Beta']);
    const sans: string[] = [];
    for (let n = g.root; n.children.length; n = n.children[0]) sans.push(n.children[0].san);
    expect(sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Qe2', 'Nf6', 'O-O', 'Be7', 'Re1', 'b6', 'Kh1', 'd6']);
  });
});
