// Σύμβολα κομματιών από το σχήμα (`src/server/books/figurines.ts`), με συνθετικές γραμμές: ορθογώνια για γράμματα,
// γεμάτα σχήματα για κομμάτια. Χωρίς μοντέλο ανάγνωσης: οι «χαρακτήρες του μοντέλου» δίνονται με το χέρι.
import { describe, expect, it } from 'vitest';
import { analyseLine, decideFigurines, figChar, glyphsOf, isDotLine, lineText, lineWords, moveDots, FIG_LONE, LONE, type Cand, type PLine, type RecChar } from '../src/server/books/figurines.ts';
import type { Gray } from '../src/server/books/vision.ts';

const H = 48;
const BASE = 37; // γραμμή βάσης
const LAG = (0.35 * 8 * H) / 48; // όσο δεξιότερα δίνει το μοντέλο κάθε χαρακτήρα

type Kind = 'tall' | 'low' | 'dot' | 'wide' | 'knight' | 'bishop' | 'bold';
const SIZE: Record<Kind, [number, number]> = { tall: [12, 28], low: [14, 19], dot: [4, 4], wide: [24, 28], knight: [28, 30], bishop: [28, 30], bold: [14, 28] };

/** Γραμμή από σχήματα· `gap` το κενό πριν από το καθένα. Επιστρέφει την εικόνα και το κέντρο κάθε σχήματος. */
function drawLine(items: Array<[Kind, number]>): { c: Gray; mid: number[]; x0: number[]; x1: number[] } {
  const w = items.reduce((s, [k, gap]) => s + gap + SIZE[k][0], 0) + 6;
  const c: Gray = { w, h: H, px: new Uint8Array(w * H).fill(255) };
  const set = (x: number, y: number) => (c.px[y * w + x] = 0);
  const mid: number[] = [];
  const x0s: number[] = [];
  const x1s: number[] = [];
  let x = 0;
  for (const [k, gap] of items) {
    x += gap;
    const [gw, gh] = SIZE[k];
    const top = BASE - gh + 1;
    for (let dy = 0; dy < gh; dy++)
      for (let dx = 0; dx < gw; dx++) {
        const t = k === 'bold' ? 6 : k === 'wide' ? 4 : 3;
        let ink: boolean;
        if (k === 'dot') ink = true;
        else if (k === 'knight') ink = !(dx < 10 && dy < 10) && !(dx >= 12 && dx < 20 && dy >= 14 && dy < 22);
        else if (k === 'bishop') ink = Math.abs(dx - 13.5) * (gh / 14) <= dy + 1;
        else ink = dx < t || dx >= gw - t || dy < t || dy >= gh - t; // κούφιο πλαίσιο με πάχος t
        if (ink) set(x + dx, top + dy);
      }
    mid.push(x + (gw - 1) / 2);
    x0s.push(x);
    x1s.push(x + gw - 1);
    x += gw;
  }
  return { c, mid, x0: x0s, x1: x1s };
}

/** οι χαρακτήρες του μοντέλου: [χαρακτήρας, δείκτης σχήματος ή -1 για κενό, σιγουριά] */
function chars(c: Gray, mid: number[], spec: Array<[string, number, number?]>): RecChar[] {
  let lastX = 0;
  return spec.map(([ch, i, p]) => {
    if (i >= 0) lastX = (mid[i] + LAG) / c.w;
    return { ch, x: i >= 0 ? lastX : lastX + 6 / c.w, p: p ?? 0.99 };
  });
}

// «1.♘f3 d5»: 0 '1', 1 '.', 2 ίππος, 3 'f', 4 '3', 5 'd', 6 '5'
const MOVE_LINE: Array<[Kind, number]> = [['tall', 4], ['dot', 3], ['knight', 5], ['tall', 4], ['tall', 3], ['tall', 16], ['tall', 3]];
const BOX = { x0: 100, y0: 200, x1: 0, y1: 0 };

function moveLine(piece: Kind, read: [string, number] | null, page = 1, line = 0, after = 'f3') {
  const items = MOVE_LINE.map((it, i) => (i === 2 ? ([piece, it[1]] as [Kind, number]) : it));
  const { c, mid, x0, x1 } = drawLine(items);
  const spec: Array<[string, number, number?]> = [['1', 0], ['.', 1]];
  if (read) spec.push([read[0], 2, read[1]]);
  spec.push([after[0], 3], [after[1], 4], [' ', -1], ['d', 5], ['5', 6]);
  return { ...analyseLine(c, chars(c, mid, spec), { ...BOX, x1: BOX.x0 + c.w, y1: BOX.y0 + H }, 44, page, line), x0, x1 };
}

describe('figurines: γλύφοι και στοίχιση', () => {
  it('χωρίζει τη γραμμή σε γλύφους, ενώνει την τελεία του i και μετρά το πάχος γραμμής', () => {
    // 'tall', 'low' με τελεία από πάνω (i), έντονο
    const { c } = drawLine([['tall', 4], ['low', 4], ['bold', 4], ['tall', 4]]);
    for (let y = 8; y < 12; y++) for (let x = 25; x < 29; x++) c.px[y * c.w + x] = 0; // τελεία πάνω από το δεύτερο
    const { glyphs, em } = glyphsOf(c, 44);
    expect(glyphs).toHaveLength(4);
    expect(glyphs[1].y0).toBe(8); // η τελεία έγινε μέρος του γλύφου
    expect(em).toBeCloseTo(1.25 * 28, 5);
    expect(glyphs[0].sw).toBeGreaterThan(2);
    expect(glyphs[0].sw).toBeLessThan(4);
    expect(glyphs[2].sw).toBeGreaterThan(5);
  });

  it('ομοιόμορφο απόκομμα: κανένας γλύφος', () => {
    expect(glyphsOf({ w: 60, h: H, px: new Uint8Array(60 * H).fill(250) }, 44).glyphs).toHaveLength(0);
  });

  it('το σύμβολο που το μοντέλο παρέλειψε μένει χωρίς χαρακτήρα και γίνεται υποψήφιος-σπόρος', () => {
    const { l, cands } = moveLine('knight', null);
    expect(Array.from(l.assign)).toEqual([0, 1, 3, 4, -1, 5, 6]);
    expect(l.glyphs[2].chars).toEqual([]);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ glyph: 2, span: 1, ch: '', p: 0, move: true });
  });

  it('ψεύτικος χαρακτήρας πάνω στο σύμβολο: υποψήφιος με τη σιγουριά του', () => {
    const { cands } = moveLine('knight', ['2', 0.4]);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ glyph: 2, ch: '2', move: true });
    expect(cands[0].p).toBeCloseTo(0.4, 5);
  });

  it('γλύφος που δεν ακολουθείται από κίνηση δεν είναι υποψήφιος', () => {
    expect(moveLine('knight', null, 1, 0, 'or').cands).toHaveLength(0);
  });
});

describe('figurines: απόφαση σε όλο το βιβλίο', () => {
  const book = (): Cand[] => [
    ...moveLine('knight', null, 1, 0).cands, // 0 σπόρος
    ...moveLine('knight', ['2', 0.4], 1, 1).cands, // 1 σπόρος
    ...moveLine('knight', ['2', 0.97], 1, 2).cands, // 2 «διαβασμένος» αλλά ίδιο σχήμα
    ...moveLine('bishop', null, 2, 0).cands, // 3
    ...moveLine('bishop', null, 2, 1).cands, // 4
    // γράμμα («N» σε βιβλίο με γράμματα) που δύο φορές βγήκε αβέβαιο: ομάδα από σπόρους, αλλά σχεδόν πάντα διαβασμένη ίδια
    ...moveLine('wide', ['N', 0.5], 3, 0).cands, // 5
    ...moveLine('wide', ['N', 0.6], 3, 1).cands, // 6
    ...[2, 3, 4, 5].flatMap((ln) => moveLine('wide', ['N', 0.99], 3, ln).cands), // 7–10
  ];

  it('ομάδες σχήματος: ίδιο σύμβολο ίδια ομάδα, γράμμα έξω', () => {
    const cands = book();
    expect(cands).toHaveLength(11);
    const { cluster, clusters } = decideFigurines(cands);
    expect(clusters).toBe(2);
    expect(Array.from(cluster)).toEqual([0, 0, 0, 1, 1, -1, -1, -1, -1, -1, -1]);
  });

  it('μοναχικός σπόρος: σύμβολο χωρίς ομάδα', () => {
    const cands = [...moveLine('knight', null, 1, 0).cands, ...moveLine('knight', null, 1, 1).cands, ...moveLine('bishop', null, 2, 0).cands];
    const { cluster, clusters } = decideFigurines(cands);
    expect(clusters).toBe(1);
    expect(Array.from(cluster)).toEqual([0, 0, LONE]);
    expect(figChar(LONE)).toBe(FIG_LONE);
  });
});

describe('figurines: κείμενο και λέξεις', () => {
  const N = figChar(0);

  it('γράφει το σύμβολο στη θέση του, με την τελεία του αριθμού πριν', () => {
    const { l } = moveLine('knight', ['2', 0.4]);
    expect(lineText(l)).toBe('1.2f3 d5');
    expect(lineText(l, new Map([[2, N]]))).toBe(`1.${N}f3 d5`);
    // το μοντέλο το παρέλειψε εντελώς
    expect(lineText(moveLine('knight', null).l, new Map([[2, N]]))).toBe(`1.${N}f3 d5`);
  });

  it('η τελεία που η στοίχιση έδωσε στο σύμβολο μένει πριν από αυτό', () => {
    // «1♘f3»: χωρίς γλύφο τελείας, το μοντέλο γράφει «1.f3» με την τελεία πάνω στο σύμβολο
    const { c, mid } = drawLine([['tall', 4], ['knight', 8], ['tall', 4], ['tall', 3]]);
    const { l } = analyseLine(c, chars(c, mid, [['1', 0], ['.', 1], ['f', 2], ['3', 3]]), BOX, 44, 1, 0);
    expect(lineText(l, new Map([[1, N]]))).toBe(`1.${N}f3`);
  });

  it('διορθώσεις γύρω από το σύμβολο: κενό πριν από την κίνηση, «cl» = c1', () => {
    const items: Array<[Kind, number]> = [['knight', 4], ['low', 4], ['tall', 3]];
    const { c, mid } = drawLine(items);
    const spaced = analyseLine(c, chars(c, mid, [['2', 0, 0.4], [' ', -1], ['c', 1], ['7', 2]]), BOX, 44, 1, 0).l;
    expect(lineText(spaced, new Map([[0, N]]))).toBe(`${N}c7`);
    const ell = analyseLine(c, chars(c, mid, [['c', 1], ['l', 2]]), BOX, 44, 1, 0).l;
    expect(lineText(ell, new Map([[0, N]]))).toBe(`${N}c1`);
  });

  it('το κενό ανάμεσα στον αριθμό κίνησης και το σύμβολο φεύγει', () => {
    // «7. ♘f3»: το μοντέλο γράφει κενό εκεί που δεν διάβασε το σύμβολο
    const { c, mid } = drawLine(MOVE_LINE);
    const { l } = analyseLine(c, chars(c, mid, [['7', 0], ['.', 1], [' ', -1], ['f', 3], ['3', 4], [' ', -1], ['d', 5], ['5', 6]]), BOX, 44, 1, 0);
    expect(lineText(l, new Map([[2, N]]))).toBe(`7.${N}f3 d5`);
  });

  it('λέξεις με τη θέση τους στη σελίδα και το πάχος των γραμμάτων', () => {
    const { l, x0, x1 } = moveLine('knight', null);
    const words = lineWords(l, new Map([[2, N]]));
    expect(words.map((w) => w.text)).toEqual([`1.${N}f3`, 'd5']);
    expect(words[0].x0).toBe(BOX.x0 + x0[0]);
    expect(words[0].x1).toBe(BOX.x0 + x1[4] + 1);
    expect(words[0].y0).toBe(BOX.y0 + BASE - 30 + 1); // το ύψος του συμβόλου
    expect(words[1].x0).toBe(BOX.x0 + x0[5]);
    expect(words[1].sw).toBeGreaterThan(2);
    expect(words[1].sw).toBeLessThan(4);
  });
});

describe('figurines: τα αποσιωπητικά της κίνησης του Μαύρου («3 … f5»)', () => {
  /** Σελίδα με γραμμές (αποκόμματα του `drawLine`) σε δοσμένες θέσεις, και κουκκίδες 5×5 στη γραμμή βάσης. */
  function page(parts: Array<{ items: Array<[Kind, number]>; x: number; text: string }>, dots: number[]): { img: Gray; lines: PLine[] } {
    const img: Gray = { w: 420, h: 100, px: new Uint8Array(420 * 100).fill(255) };
    const Y = 20;
    const lines: PLine[] = [];
    for (const part of parts) {
      const { c, mid } = drawLine(part.items);
      for (let y = 0; y < c.h; y++) img.px.set(c.px.subarray(y * c.w, (y + 1) * c.w), (Y + y) * img.w + part.x);
      const spec = [...part.text].map((ch, i) => [ch, i] as [string, number]);
      lines.push(analyseLine(c, chars(c, mid, spec), { x0: part.x, y0: Y, x1: part.x + c.w, y1: Y + c.h }, 44, 1, lines.length).l);
    }
    for (const x of dots) for (let y = Y + BASE - 4; y <= Y + BASE; y++) for (let k = 0; k < 5; k++) img.px[y * img.w + x + k] = 0;
    return { img, lines };
  }
  const NUM = { items: [['tall', 4]] as Array<[Kind, number]>, x: 10, text: '3' };
  const MOVE = { items: [['tall', 4], ['tall', 3]] as Array<[Kind, number]>, x: 300, text: 'f5' };

  it('βρίσκει τις κουκκίδες στο κενό ανάμεσα στον αριθμό και την κίνηση', () => {
    const { img, lines } = page([NUM, MOVE], [120, 135, 150]);
    const found = moveDots(img, lines, 1);
    expect(found).toHaveLength(1);
    expect(lineText(found[0])).toBe('…');
    expect(found[0].em).toBe(lines[0].em);
    expect(found[0].box.x0).toBeGreaterThanOrEqual(116);
    expect(found[0].box.x1).toBeLessThanOrEqual(160);
    const [w] = lineWords(found[0]);
    expect(w.text).toBe('…');
    expect(w.y1).toBe(20 + BASE + 1); // πάνω στη γραμμή βάσης, όπως ο αριθμός
  });

  it('χωρίς κουκκίδες, με άλλο κείμενο δεξιά ή με λεκέ στο κενό: τίποτα', () => {
    const plain = page([NUM, MOVE], []);
    expect(moveDots(plain.img, plain.lines, 1)).toHaveLength(0);
    const prose = page([NUM, { ...MOVE, text: 'or' }], [120, 135, 150]);
    expect(moveDots(prose.img, prose.lines, 1)).toHaveLength(0);
    const stain = page([NUM, MOVE], [120, 135, 150]);
    for (let y = 30; y < 50; y++) for (let x = 200; x < 220; x++) stain.img.px[y * stain.img.w + x] = 0;
    expect(moveDots(stain.img, stain.lines, 1)).toHaveLength(0);
  });

  it('κουκκίδες που βρήκε ο εντοπισμός: γραμμή «…» ό,τι κι αν διάβασε το μοντέλο', () => {
    const { img } = page([], [120, 135, 150]);
    const box = { x0: 114, y0: 44, x1: 162, y1: 64 };
    const c: Gray = { w: 48, h: 20, px: new Uint8Array(48 * 20) };
    for (let y = 0; y < 20; y++) c.px.set(img.px.subarray((44 + y) * img.w + 114, (44 + y) * img.w + 162), y * 48);
    expect(isDotLine(analyseLine(c, [{ ch: '●', x: 0.5, p: 0.4 }], box, 19, 1, 0).l)).toBe(true);
    // από το σχήμα, ό,τι κι αν γράφει το κείμενο
    expect(isDotLine(analyseLine(c, [{ ch: '0', x: 0.3, p: 0.9 }, { ch: '香', x: 0.7, p: 0.5 }], box, 19, 1, 0).l)).toBe(true);
    // δύο γράμματα («oo») δεν είναι κουκκίδες
    const oo = drawLine([['low', 4], ['low', 3]]);
    expect(isDotLine(analyseLine(oo.c, chars(oo.c, oo.mid, [['o', 0], ['o', 1]]), BOX, 44, 1, 0).l)).toBe(false);
  });
});
