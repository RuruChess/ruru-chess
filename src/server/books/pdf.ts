/**
 * Κείμενο από PDF σκακιστικού βιβλίου (pdf.js της Mozilla, Apache-2.0): γραμμές και παράγραφοι με τη
 * γραμματοσειρά κάθε κομματιού, ώστε να ξεχωρίζουν η κύρια γραμμή (συνήθως έντονα), τα σχόλια και οι
 * βαριάντες, τα γράμματα των κομματιών (συχνά σε δική τους γραμματοσειρά), οι επικεφαλίδες (μεγαλύτερα
 * γράμματα), οι λεζάντες των διαγραμμάτων και οι αριθμοί των σελίδων. Ο ρόλος κάθε γραμματοσειράς βγαίνει
 * από τη χρήση της σε όλο το βιβλίο, όχι από το όνομά της.
 *
 * Σελίδες χωρίς κείμενο (σκαναρισμένες) ή με κείμενο-«σκουπίδια» (γραμματοσειρές χωρίς ToUnicode) διαβάζονται από την
 * εικόνα τους: με τον αναγνώστη `ppocr.ts` αν είναι εγκατεστημένος (τότε και ολόκληρο το βιβλίο, όταν το κείμενό του έχει
 * χαλασμένες κινήσεις), αλλιώς με το OCR των Windows (`ocr.ts`)· τα διαγράμματα που είναι εικόνες γίνονται θέσεις (`vision.ts`, `pieces.ts`). Όλες
 * οι συντεταγμένες είναι της σελίδας όπως φαίνεται (με την περιστροφή της), με το y προς τα πάνω.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseBook, type BookDiagram } from '../../core/bookparse.ts';
import { moveTokens, textWarning, type TextScan } from '../../core/bookquality.ts';
import { annotateDiagrams, findDiagrams, type Item } from './diagrams.ts';
import { decideFigurines, figChar, lineWords, type Cand, type PLine, type PWord } from './figurines.ts';
import { WinOcr, type OcrPage, type OcrWord } from './ocr.ts';
import { findPpocr, PpOcr, type PpPack } from './ppocr.ts';
import { findDiagramNet, readDiagrams } from './diagramnet.ts';
import { retext } from './retext.ts';
import { findVlm, VlmOcr, type VlmPack } from './vlm.ts';
import { placements, readBoards, type BookBoards } from './pieces.ts';
import { symbolOf } from './symbols.ts';
import { boardCells, findBoards, readBmp, resize, writeBmp, type BoardBox, type Cell, type Gray } from './vision.ts';

/** 'top': η κύρια γραμμή του κεφαλαίου, όταν το βιβλίο έχει και δεύτερη (των ενοτήτων) σε άλλη γραμματοσειρά */
export type FontRole = 'prose' | 'main' | 'top' | 'piece' | 'caption' | 'other';

export interface Seg {
  text: string;
  font: string;
  x: number;
  end: number;
}

export interface Line {
  page: number;
  x: number;
  y: number;
  size: number;
  segs: Seg[];
  /** διάγραμμα (γραμματοσειρά σκακιού ή εικόνα) στη θέση αυτής της «γραμμής» */
  diagram?: BookDiagram;
}

/** Κομμάτι παραγράφου με τον ρόλο του (η κύρια γραμμή ή κείμενο/βαριάντες). */
export interface Run {
  text: string;
  main: boolean;
  /** η κύρια γραμμή του κεφαλαίου (βλ. FontRole 'top'): πάντα και `main` */
  top?: boolean;
}

export interface Paragraph {
  page: number;
  /** εσοχή σε σχέση με το αριστερό περιθώριο της σελίδας */
  indent: number;
  /** επικεφαλίδα (μεγαλύτερα γράμματα) */
  heading: boolean;
  /** λεζάντα διαγράμματος («Position after: …») */
  caption: boolean;
  runs: Run[];
  text: string;
  diagram?: BookDiagram;
  /** γραμμή στο κέντρο της σελίδας (π.χ. όνομα ενότητας, ρητό) */
  centered?: boolean;
  /** πού αρχίζει κάθε γραμμή του PDF μετά την πρώτη (θέσεις στο `text`): οι κεφαλίδες παρτίδων σε γραμμές */
  lineStarts?: number[];
}

export interface PdfBook {
  title: string;
  author: string;
  pages: number;
  paragraphs: Paragraph[];
  /** οι ρόλοι των γραμματοσειρών (για το τι αναγνωρίστηκε) */
  fonts: Record<string, FontRole>;
  /** σελίδες που διαβάστηκαν με OCR */
  ocrPages: number;
  /** τα διαγράμματα-εικόνες (ο δείκτης είναι το `diagram.id`), για τη διόρθωση από το κείμενο */
  boards: BookBoards | null;
}

export interface ReadOptions {
  signal?: AbortSignal;
  /** πρόοδος της ανάγνωσης (pdf.js) */
  onPage?: (page: number, pages: number) => void;
  /** πρόοδος του OCR: σελίδες που έγιναν από όσες χρειάζονται */
  onOcr?: (done: number, total: number) => void;
  /** κατά την ανάγνωση, ανά σελίδα: πόσο καλό είναι ως τώρα το κείμενο του βιβλίου (βλ. `TextScan`) */
  onText?: (scan: TextScan) => void;
  /** OCR και διαγράμματα-εικόνες (προεπιλογή: ναι) */
  images?: boolean;
  /** μόνο αυτές οι σελίδες (για δοκιμές) */
  range?: [number, number];
  /** μοντέλο ανάγνωσης για τις σκαναρισμένες σελίδες (`vlm.ts`): προεπιλογή όποιο είναι εγκατεστημένο, `null` κανένα */
  vlm?: VlmPack | null;
  /** ο αναγνώστης σελίδων από την εικόνα τους (`ppocr.ts`): προεπιλογή όποιος είναι εγκατεστημένος, `null` κανένας */
  ppocr?: PpPack | null;
  /**
   * Δοκιμές («ψηφιακό δίδυμο»): κάθε σελίδα διαβάζεται από την εικόνα της όπως τη ζωγραφίζουν τα Windows, σαν να ήταν
   * σκαναρισμένη, και το κείμενο του PDF αγνοείται. Έτσι ένα ψηφιακό βιβλίο δείχνει πόσο σωστά διαβάζει ο αναγνώστης.
   */
  asScan?: boolean;
  /** το πακέτο θέσεων διαγραμμάτων (`diagramnet.ts`, η διαδρομή του `recognize.js`): προεπιλογή όποιο είναι εγκατεστημένο, `null` κανένα */
  diagramNet?: string | null;
}

const MOVE_RE = /^(?:\d{1,3}\.(?:\.\.|…)?)?(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?)[+#]?[!?]*$/;
/** κίνηση από OCR με το σύμβολο του κομματιού «σκουπίδι» («.ig7», «l.d4», «2.�f3», «6..ig5») */
const OCR_MOVE_RE = /^(?:[\dlIOS]{1,3}\.(?:\.\.?)?)?[^\s\d]{0,5}?[a-h]?x?[a-h][1-8][+#]?[!?]*$/;

let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;

/** Το pdf.js φορτώνεται μόνο όταν χρειαστεί· οι προειδοποιήσεις του για το canvas (δεν το χρειαζόμαστε) σιωπούν. */
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const log = console.log;
  const warn = console.warn;
  const quiet = (f: (...a: unknown[]) => void) => (...a: unknown[]) => {
    if (typeof a[0] === 'string' && /^Warning: Cannot (load|polyfill)/.test(a[0])) return;
    f(...a);
  };
  console.log = quiet(log);
  console.warn = quiet(warn);
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return pdfjs;
}

const toSlash = (p: string) => p.split(path.sep).join('/');

/** Οι φάκελοι του pdf.js με τους χάρτες χαρακτήρων, τις βασικές γραμματοσειρές και τους αποκωδικοποιητές JPX/JBIG2. */
function pdfjsDir(): string {
  const req = createRequire(import.meta.url);
  return path.dirname(req.resolve('pdfjs-dist/package.json'));
}

/** Τα σφάλματα του pdf.js στο άνοιγμα του αρχείου, με λόγια για τον χρήστη. */
function openError(e: unknown): Error {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'PasswordException') return new Error('Το PDF έχει κωδικό. Άνοιξέ το, αποθήκευσέ το χωρίς κωδικό και δοκίμασε ξανά.');
  if (name === 'InvalidPDFException') return new Error('Το αρχείο δεν είναι έγκυρο PDF ή είναι κατεστραμμένο.');
  return new Error(`Το PDF δεν άνοιξε: ${(e as Error | null)?.message ?? String(e)}`);
}

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** Εικόνα στη σελίδα: σε pixel, ευθυγραμμισμένη με τη σελίδα όπως φαίνεται, και το ορθογώνιό της (y προς τα κάτω). */
interface OcrJob {
  page: number;
  view: Mat;
  pw: number;
  ph: number;
  scanned: boolean | 'auto';
  boards?: { items: Item[]; areas: Array<[number, number, number, number]> };
}

interface Frame {
  img: Gray;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/**
 * Ένδειξη βιβλίου ασκήσεων: λεζάντα διαγράμματος «19. White to move», «Black to play», «Παίζει ο Λευκός» (σύντομο
 * κομμάτι που αρχίζει έτσι· όχι μέσα σε πρόταση, «…allows White to play f4»).
 */
const CUE_RE = /^\s*(?:\(?\d{1,4}[.)]?\s*)?(?:(?:white|black)\s+to\s+(?:move|play)\b|(?:παίζει|παίζουν)\s+(?:ο\s+|τα\s+)?(?:λευκ|μαύρ))[^.]{0,25}$/i;

/** Ποιότητα του κειμένου μιας σελίδας: κανονικό, «σκουπίδια» (γραμματοσειρές χωρίς ToUnicode) ή σχεδόν τίποτα. */
export function textQuality(items: Item[]): 'good' | 'garbage' | 'none' {
  const text = items.map((it) => it.str).join(' ').replace(/[\uE000-\uF8FF]/g, '');
  const chars = text.replace(/\s/g, '').length;
  if (chars < 30) return 'none';
  const control = (text.match(/[\u0000-\u0008\u000e-\u001f\uFFFD]/g) ?? []).length;
  const words = text.split(/\s+/).filter((w) => w.length > 1);
  const good = words.filter((w) => /^[("'“‘[]?(?:[A-Za-zÀ-ÿΑ-Ωα-ωά-ώ][a-zà-ÿα-ωά-ώ'’-]+|\d{1,4}[.,)]?|[KQRBN]?[a-h]?x?[a-h][1-8][+#!?]*)[)"'”’\].,;:!?]*$/.test(w)).length;
  return control > chars * 0.05 || good < words.length * 0.3 ? 'garbage' : 'good';
}

/** Μια εικόνα του pdf.js (αποκωδικοποιημένη) σε γκρι. */
function grayOf(o: { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray }): Gray | null {
  const { width: w, height: h, data } = o;
  if (!data || !w || !h) return null;
  const px = new Uint8Array(w * h);
  if (o.kind === 1) {
    // 1 bit ανά pixel, 1 = λευκό
    const stride = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
  } else {
    const ch = Math.round(data.length / (w * h));
    if (ch < 1) return null;
    for (let k = 0; k < w * h; k++) px[k] = ch >= 3 ? (data[k * ch] * 77 + data[k * ch + 1] * 150 + data[k * ch + 2] * 29) >> 8 : data[k * ch];
  }
  return { w, h, px };
}

/**
 * Η εικόνα στη σελίδα όπως φαίνεται: οι άξονές της (από τον πίνακα μετασχηματισμού και την περιστροφή της σελίδας)
 * γίνονται ξανά οριζόντιος/κάθετος, με αναστροφή ή στροφή 90° όπου χρειάζεται.
 */
function frameOf(img: Gray, ctm: Mat, view: Mat): Frame {
  const vec = (x: number, y: number): [number, number] => [view[0] * x + view[2] * y, view[1] * x + view[3] * y];
  const pt = (s: number, t: number): [number, number] => {
    const x = ctm[0] * s + ctm[2] * t + ctm[4];
    const y = ctm[1] * s + ctm[3] * t + ctm[5];
    return [view[0] * x + view[2] * y + view[4], view[1] * x + view[3] * y + view[5]];
  };
  const du = vec(ctm[0], ctm[1]);
  const dv = vec(-ctm[2], -ctm[3]);
  const corners = [pt(0, 0), pt(1, 0), pt(0, 1), pt(1, 1)];
  const x0 = Math.min(...corners.map((c) => c[0]));
  const y0 = Math.min(...corners.map((c) => c[1]));
  const w = Math.max(...corners.map((c) => c[0])) - x0;
  const h = Math.max(...corners.map((c) => c[1])) - y0;
  const horizontal = Math.abs(du[0]) >= Math.abs(du[1]);
  if (horizontal && du[0] > 0 && dv[1] > 0) return { img, x0, y0, w, h };
  const W = horizontal ? img.w : img.h;
  const H = horizontal ? img.h : img.w;
  const px = new Uint8Array(W * H);
  for (let v = 0; v < img.h; v++)
    for (let u = 0; u < img.w; u++) {
      let X: number;
      let Y: number;
      if (horizontal) {
        X = du[0] > 0 ? u : img.w - 1 - u;
        Y = dv[1] > 0 ? v : img.h - 1 - v;
      } else {
        Y = du[1] > 0 ? u : img.w - 1 - u;
        X = dv[0] > 0 ? v : img.h - 1 - v;
      }
      px[Y * W + X] = img.px[v * img.w + u];
    }
  return { img: { w: W, h: H, px }, x0, y0, w, h };
}

/** Οι εικόνες μιας σελίδας (pdf.js) με τον πίνακα μετασχηματισμού τους· οι εικόνες μέσα σε φόρμες (XObject) επίσης. */
async function pageImages(lib: NonNullable<typeof pdfjs>, page: Awaited<ReturnType<Awaited<ReturnType<NonNullable<typeof pdfjs>['getDocument']>['promise']>['getPage']>>): Promise<Array<{ ctm: Mat; get: () => Promise<Gray | null> }>> {
  const ops = await page.getOperatorList();
  const { OPS } = lib;
  const out: Array<{ ctm: Mat; get: () => Promise<Gray | null> }> = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: Mat[] = [];
  const obj = (id: string) =>
    new Promise<Gray | null>((resolve) => {
      const store = id.startsWith('g_') ? page.commonObjs : page.objs;
      try {
        store.get(id, (o: unknown) => resolve(o ? grayOf(o as never) : null));
      } catch {
        resolve(null);
      }
      setTimeout(() => resolve(null), 20000).unref();
    });
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    const a = ops.argsArray[i] as unknown[];
    if (f === OPS.save) stack.push(ctm);
    else if (f === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (f === OPS.transform) ctm = mul(ctm, a as Mat);
    else if (f === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(a[0]) && a[0].length === 6) ctm = mul(ctm, a[0] as Mat);
    } else if (f === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (f === OPS.paintImageXObject) {
      const id = String(a[0]);
      out.push({ ctm, get: () => obj(id) });
    } else if (f === OPS.paintInlineImageXObject) {
      const o = a[0] as never;
      out.push({ ctm, get: async () => grayOf(o) });
    }
  }
  return out;
}

/** Η «γραμματοσειρά» των συμβόλων-εικόνων: ρόλος κομματιού, παίρνουν τον ρόλο της κίνησης δίπλα τους. */
export const SYMBOL_FONT = '#symbol';

/**
 * Τα σύμβολα αξιολόγησης μιας σελίδας που είναι μικρές εικόνες μέσα στο κείμενο (βλ. symbols.ts), ως κομμάτια
 * κειμένου στη θέση τους (η βάση της εικόνας στη γραμμή βάσης του κειμένου).
 */
async function symbolItems(lib: NonNullable<typeof pdfjs>, page: Parameters<typeof pageImages>[1], view: Mat, pageH: number): Promise<Item[]> {
  const out: Item[] = [];
  const cache = new Map<string, string | null>();
  for (const im of await pageImages(lib, page)) {
    const m = im.ctm;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    // στο μέγεθος γράμματος (όχι διαγράμματα, γραμμές ή φόντο)
    if (sx < 3 || sy < 3 || sx > 30 || sy > 30) continue;
    const g = await im.get();
    if (!g) continue;
    const fr = frameOf(g, m, view);
    const key = `${fr.img.w}x${fr.img.h}:${Buffer.from(fr.img.px).toString('base64')}`;
    let sym = cache.get(key);
    if (sym === undefined) cache.set(key, (sym = symbolOf(fr.img)));
    if (!sym) continue;
    out.push({ str: sym, x: fr.x0, y: pageH - (fr.y0 + fr.h), w: fr.w, size: fr.h, font: SYMBOL_FONT });
  }
  return out;
}

/** Κινήσεις που έλειψαν στο OCR: διαδοχικοί αριθμοί κινήσεων χωρίς τίποτα ανάμεσα («5 6 Bg5», «8 9 h6»). */
export function missingMoves(o: OcrPage): boolean {
  for (const l of o.lines) {
    const t = l.map((w) => w.text).join(' ');
    for (const m of t.matchAll(/(?:^|\s)(\d{1,3})\s+(\d{1,3})(?=\s|$)/g)) if (Number(m[2]) === Number(m[1]) + 1) return true;
  }
  return false;
}

/** Οι λέξεις του δεύτερου περάσματος OCR που λείπουν από το πρώτο (καμία επικάλυψη στην ίδια γραμμή). */
export function mergeWords(a: Item[], b: Item[]): Item[] {
  const out = [...a];
  for (const w of b) if (!a.some((o) => Math.abs(o.y - w.y) < 0.6 * Math.max(o.size, w.size) && o.x < w.x + w.w && w.x < o.x + o.w)) out.push(w);
  return out;
}

/** κίνηση (ή αριθμός κίνησης) όπως τη δίνει το OCR, για τις λέξεις που ξαναδιαβάζονται στα κενά */
const OCR_MOVE_WORD_RE = /^(?:\d{1,3}\.{0,3}|[^\s\d]{0,3}[a-h]?x?[a-h][1-8lIS?][+#!?]*|[0O]-[0O](?:-[0O])?[+#!?]*)$/;

/**
 * Σημεία με μελάνι που το OCR δεν διάβασε, σε γραμμές με κινήσεις: τα κενά ανάμεσα στις λέξεις (και λίγο πριν από την
 * πρώτη, ως το άκρο της στήλης), στις συντεταγμένες της εικόνας.
 */
export function inkGaps(img: Gray, lines: OcrWord[][]): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x++) if (img.px[y * img.w + x] < 110) n++;
    return n / Math.max(1, (x1 - x0) * (y1 - y0));
  };
  const firsts = lines.map((l) => Math.min(...l.map((w) => w.x)));
  const gaps: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  lines.forEach((l, i) => {
    const ws = [...l].sort((a, b) => a.x - b.x);
    if (!ws.length || !/\d|[a-h][1-8]/.test(ws.map((w) => w.text).join(' '))) return;
    const top = Math.min(...ws.map((w) => w.y));
    const bot = Math.max(...ws.map((w) => w.y + w.h));
    const h = bot - top;
    if (h < 4) return;
    const near = firsts.slice(Math.max(0, i - 3), i + 4).filter((x) => x < ws[0].x && ws[0].x - x < 8 * h);
    const spans: Array<[number, number]> = [[near.length ? Math.min(...near) : ws[0].x, ws[0].x]];
    for (let k = 0; k + 1 < ws.length; k++) spans.push([ws[k].x + ws[k].w, ws[k + 1].x]);
    for (const [a, b] of spans) if (b - a >= 0.9 * h && ink(a + 2, top, b - 2, bot) >= 0.04) gaps.push({ x0: Math.round(a), y0: Math.max(0, Math.round(top) - 2), x1: Math.round(b), y1: Math.min(img.h, Math.round(bot) + 2) });
  });
  return gaps;
}

/**
 * Το OCR των Windows παραλείπει ολόκληρες λέξεις (κινήσεις με σύμβολο, ακόμη και «f4», «0-0-0»), αλλά μόνες τους τις
 * διαβάζει συχνά: κάθε κενό με μελάνι (`inkGaps`) κομμένο, μεγεθυμένο ×3, σε δικό του OCR («♘c3 ♘c6», «0-0-0 ♗d7»·
 * στοιβαγμένα σε μία εικόνα το OCR χάνει τα περισσότερα). Κρατιούνται μόνο κινήσεις, στις συντεταγμένες της εικόνας.
 */
async function gapWords(ocr: WinOcr, page: number, img: Gray, lines: OcrWord[][], prefix: string): Promise<OcrWord[]> {
  const pad = 16;
  const out: OcrWord[] = [];
  const gaps = inkGaps(img, lines).slice(0, 60);
  let n = 0;
  for (const g of gaps) {
    const cw = g.x1 - g.x0;
    const ch = g.y1 - g.y0;
    const c: Gray = { w: cw, h: ch, px: new Uint8Array(cw * ch) };
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) c.px[y * cw + x] = img.px[(g.y0 + y) * img.w + g.x0 + x];
    // σε άλλη μεγέθυνση, αν δεν βγει τίποτα (το OCR είναι ευαίσθητο στο μέγεθος των γραμμάτων)
    // (και ασπρόμαυρο με κατώφλι, όταν δεν βγει τίποτα: θολά σύμβολα σε σκαναρισμένες σελίδες)
    for (const [k, bin] of [[3, false], [2, false], [4, false], [3, true]] as const) {
      let big = resize(c, cw * k, ch * k);
      if (bin) big = { ...big, px: big.px.map((v) => (v < 150 ? 0 : 255)) };
      const sheet: Gray = { w: big.w + 2 * pad, h: big.h + 2 * pad, px: new Uint8Array((big.w + 2 * pad) * (big.h + 2 * pad)).fill(255) };
      for (let y = 0; y < big.h; y++) sheet.px.set(big.px.subarray(y * big.w, (y + 1) * big.w), (y + pad) * sheet.w + pad);
      // (δικό του αρχείο: το PowerShell μπορεί να κρατά ακόμη ανοιχτό το προηγούμενο)
      const bmp = `${prefix}${n++}.bmp`;
      fs.writeFileSync(bmp, writeBmp(sheet));
      const res = await ocr.ocr(page, bmp);
      fs.rmSync(bmp, { force: true });
      const found = (res.lines ?? []).flat().filter((w) => OCR_MOVE_WORD_RE.test(w.text.replace(/[.,;:)]+$/, '')));
      for (const w of found) out.push({ text: w.text, x: g.x0 + (w.x - pad) / k, y: g.y0 + (w.y - pad) / k, w: w.w / k, h: w.h / k });
      if (found.length) break;
    }
  }
  return out;
}

/** Λέξεις του OCR σε κομμάτια κειμένου: μία γραμμή κοινή βάση, μέγεθος από το ύψος των λέξεων της. */
function ocrItems(o: OcrPage, fr: Frame, pageH: number, skip: (x: number, y: number) => boolean): Item[] {
  const sx = fr.w / o.w;
  const sy = fr.h / o.h;
  const items: Item[] = [];
  for (const line of o.lines) {
    if (!line.length) continue;
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    const base = med(line.map((w) => w.y + w.h));
    // μέγεθος γραμμάτων: το ύψος της γραμμής (από την κορυφή του ψηλότερου ως τη βάση του χαμηλότερου γράμματος)
    const size = (Math.max(...line.map((w) => w.y + w.h)) - Math.min(...line.map((w) => w.y))) * 0.8 * sy;
    for (const w of line) {
      const x = fr.x0 + w.x * sx;
      const top = fr.y0 + w.y * sy;
      if (skip(x + (w.w * sx) / 2, top + (w.h * sy) / 2)) continue;
      items.push({ str: w.text, x, y: pageH - (fr.y0 + base * sy), w: w.w * sx, size, font: 'ocr' });
    }
  }
  return items;
}

/** Μια σελίδα του αναγνώστη εικόνας που περιμένει την απόφαση για τα σύμβολα των κομματιών (όλου του βιβλίου). */
export interface PpHeld {
  job: OcrJob;
  /** η εικόνα της σελίδας στις συντεταγμένες της σελίδας, και οι διαστάσεις της σε pixel */
  fr: { x0: number; y0: number; w: number; h: number };
  iw: number;
  ih: number;
  boards: { items: Item[]; areas: Array<[number, number, number, number]> };
  /** ανά γραμμή: οι λέξεις της και το μέγεθος των γραμμάτων της (pixel) */
  words: PWord[][];
  ems: number[];
  /** γραμμές με υποψήφια σύμβολα κομματιών */
  pending: Array<{ li: number; l: PLine }>;
}

/** Το μέγεθος των γραμμάτων κάθε γραμμής μιας σελίδας του αναγνώστη εικόνας (pixel) και το συνηθισμένο της σελίδας. */
function ppSizes(h: PpHeld): { em: number[]; body: number } {
  // το μέγεθος κάθε γραμμής βγαίνει χονδρικά (από το ύψος των γλύφων της): οι γραμμές κοντά στο συνηθισμένο μέγεθος της
  // σελίδας παίρνουν όλες το ίδιο
  const sizes = h.ems.filter((_, i) => h.words[i].length).sort((p, q) => p - q);
  const body = sizes.length ? sizes[sizes.length >> 1] : 0;
  // (γραμμή με λίγα γράμματα, π.χ. «e4?!» ή «3»: το μέγεθός της δεν μετριέται καλά, άρα πιο χαλαρά)
  const few = (i: number) => h.words[i].reduce((n, w) => n + w.text.length, 0) <= 12;
  return { em: h.ems.map((e, i) => (e >= (few(i) ? 0.55 : 0.78) * body && e <= 1.28 * body) ? body : e), body };
}

/**
 * Το πάχος γραμμής των κανονικών (όχι έντονων) γραμμάτων του βιβλίου, ως μέρος του μεγέθους τους: η διάμεσος όλων των
 * λέξεων (τα κανονικά είναι τα περισσότερα). Τυπικές τιμές: κανονικά 0,076–0,092, έντονα 0,121–0,156, «βαριά» 0,188.
 */
export function ppWeight(pages: PpHeld[]): number {
  const r: number[] = [];
  for (const h of pages) {
    const { em } = ppSizes(h);
    h.words.forEach((line, li) => {
      for (const w of line) if (w.sw > 0 && w.text.length >= 3 && em[li] > 0) r.push(w.sw / em[li]);
    });
  }
  r.sort((p, q) => p - q);
  return r.length ? r[r.length >> 1] : 0;
}

/** κανονικά / έντονα / βαριά, από το πάχος γραμμής σε σχέση με το κανονικό του βιβλίου (0: άγνωστο) */
const weightOf = (rho: number): 0 | 1 | 2 => (rho >= 1.8 ? 2 : rho >= 1.22 ? 1 : 0);

/**
 * Οι λέξεις του αναγνώστη εικόνας σε κομμάτια κειμένου. Η «γραμματοσειρά» κάθε λέξης βγαίνει από την εικόνα: `ocr`
 * (κανονικά), `ocr-b` (έντονα), `ocr-h` (βαριά), και `-s`/`-l` για γραμμές καθαρά μικρότερες ή μεγαλύτερες από το
 * συνηθισμένο μέγεθος της σελίδας. Από αυτές η `fontRoles` βρίσκει την κύρια γραμμή, όπως στα ψηφιακά βιβλία.
 * `weight`: το κανονικό πάχος του βιβλίου (`ppWeight`).
 */
export function ppItems(h: PpHeld, weight: number): Item[] {
  const sx = h.fr.w / h.iw;
  const sy = h.fr.h / h.ih;
  // (η περιοχή κάθε σκακιέρας έχει περιθώριο για τις συντεταγμένες της: εκεί φεύγουν μόνο σύντομες λέξεις και σειρές
  // συντεταγμένων. Μια γραμμή κινήσεων κολλητά κάτω από το διάγραμμα, «16.♘f3 ♘e3 17.♕e3 ♘f3», είναι κείμενο: όταν
  // χανόταν, η παρτίδα έμενε χωρίς δύο κινήσεις και σταματούσε εκεί)
  const inBoard = (x: number, y: number, text: string) =>
    h.boards.areas.some(([x0, y0, x1, y1]) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const mx = (x1 - x0) * 0.065;
      const my = (y1 - y0) * 0.065;
      return (x >= x0 + mx && x <= x1 - mx && y >= y0 + my && y <= y1 - my) || text.length <= 2 || /^(?:[a-h]+|[1-8]+)$/i.test(text);
    });
  const { em, body } = ppSizes(h);
  const items: Item[] = [];
  h.words.forEach((line, li) => {
    if (!line.length) return;
    const bottoms = line.map((w) => w.y1).sort((p, q) => p - q);
    const base = bottoms[bottoms.length >> 1];
    // πάχος κάθε λέξης σε σχέση με το κανονικό· όπου είναι στο όριο (ή δεν μετρήθηκε), ό,τι λένε οι διπλανές της γραμμής
    const rho = line.map((w) => (weight > 0 && w.sw > 0 && em[li] > 0 ? w.sw / em[li] / weight : 0));
    const sure = (r: number) => r > 0 && (r < 1.1 || r >= 1.36);
    // (αριθμός κίνησης: το πάχος ενός-δύο ψηφίων δεν μετριέται καλά· «6» κανονικό πριν από έντονο «♘d4 d5» έκοβε την
    // κύρια γραμμή. Όπου έχει διπλανές λέξεις, παίρνει το είδος τους)
    // (το ίδιο κάθε λέξη ως δύο γράμματα: «If», «It» στην αρχή παραγράφου έβγαιναν έντονα)
    const digits = line.map((w) => /^\d{1,3}\.?$/.test(w.text) || w.text.length <= 2);
    const cls = rho.map((r, i) => {
      if (sure(r) && !(digits[i] && line.length > 1)) return weightOf(r);
      let left = -1;
      let right = -1;
      for (let k = i - 1; k >= 0 && left < 0; k--) if (sure(rho[k])) left = weightOf(rho[k]);
      for (let k = i + 1; k < line.length && right < 0; k++) if (sure(rho[k])) right = weightOf(rho[k]);
      if (left >= 0 && right >= 0) return left === right ? left : weightOf(r);
      return left >= 0 ? left : right >= 0 ? right : weightOf(r);
    });
    const scale = body > 0 && em[li] < 0.7 * body ? '-s' : body > 0 && em[li] > 1.4 * body ? '-l' : '';
    line.forEach((w, i) => {
      const x = h.fr.x0 + w.x0 * sx;
      const top = h.fr.y0 + w.y0 * sy;
      if (inBoard(x + ((w.x1 - w.x0) * sx) / 2, top + ((w.y1 - w.y0) * sy) / 2, w.text)) return;
      items.push({ str: w.text, x, y: h.job.ph - (h.fr.y0 + base * sy), w: (w.x1 - w.x0) * sx, size: em[li] * sy, font: `ocr${['', '-b', '-h'][cls[i]]}${scale}` });
    });
  });
  return items;
}

/**
 * Οι σκακιέρες μιας εικόνας της σελίδας: «γραμμές» διαγράμματος (με τα τετράγωνα στο `cells`) και η περιοχή τους.
 * `soft`: στις περιοχές μπαίνουν και όσες μοιάζουν με σκακιέρα χωρίς να αναγνωριστούν (χωρίς διάγραμμα): ο αναγνώστης
 * εικόνας διαβάζει τα κομμάτια τους ως «κείμενο» («Q 8», «皇»), που γίνεται και επικεφαλίδα και κόβει τις παρτίδες.
 */
function imageBoards(fr: Frame, pageH: number, cells: Cell[][], pageW = Infinity, target = 800, soft = false, crops?: Array<Gray | null>): { items: Item[]; areas: Array<[number, number, number, number]> } {
  // πολύ μικρές εικόνες (π.χ. συμπιεσμένα σκαναρίσματα): μεγέθυνση, ώστε κάθε τετράγωνο να έχει αρκετά pixel
  let img = fr.img;
  // (μόνο όταν χρειάζεται: η μεγέθυνση μιας μεγάλης εικόνας κοστίζει πολύ χρόνο χωρίς όφελος)
  const k = Math.min(3, Math.max(1, target / Math.max(img.w, img.h)));
  if (k > 1.3) img = resize(img, Math.round(img.w * k), Math.round(img.h * k));
  const sx = fr.w / img.w;
  const sy = fr.h / img.h;
  const items: Item[] = [];
  const areas: Array<[number, number, number, number]> = [];
  const weak: BoardBox[] = [];
  for (const b of findBoards(img, Math.max(48, Math.min(img.w, img.h) * 0.08), soft ? weak : undefined)) {
    const x = fr.x0 + b.x * sx;
    const top = fr.y0 + b.y * sy;
    const side = b.side * sx;
    // έξω από την ορατή σελίδα (περικοπή): δεν είναι διάγραμμα αυτής της σελίδας
    const high = (b.h ?? b.side) * sy;
    if (x + side / 2 < 0 || x + side / 2 > pageW || top + high / 2 < 0 || top + high / 2 > pageH) continue;
    const id = cells.length;
    cells.push(boardCells(img, b));
    // (το απόκομμα για το πακέτο διαγραμμάτων, με περιθώριο 10% όπως στις δοκιμές του)
    if (crops) crops[id] = cropGray(img, b.x - b.side * 0.1, b.y - b.side * 0.1, b.x + b.side * 1.1, b.y + (b.h ?? b.side) + b.side * 0.1);
    // ως 0,6 τετραγώνου γύρω: οι συντεταγμένες (a–h, 1–8), που δεν είναι κείμενο της σελίδας
    areas.push([x - side * 0.075, top - side * 0.075, x + side * 1.075, top + high * 1.075]);
    const y = pageH - top;
    items.push({ str: '\u0001', x, y, w: side, size: side / 8, font: '#diagram', diagram: { placement: '8/8/8/8/8/8/8/8', turn: null, label: null, caption: '', x, y, id } });
  }
  for (const b of weak) {
    const x = fr.x0 + b.x * sx;
    const top = fr.y0 + b.y * sy;
    const side = b.side * sx;
    const high = (b.h ?? b.side) * sy;
    if (!areas.some(([x0, y0, x1, y1]) => x + side / 2 > x0 && x + side / 2 < x1 && top + high / 2 > y0 && top + high / 2 < y1)) areas.push([x - side * 0.03, top - high * 0.03, x + side * 1.03, top + high * 1.03]);
  }
  return { items, areas };
}

/**
 * Αριθμοί ασκήσεων στα διαγράμματα-εικόνες μόνο σε βιβλίο ασκήσεων: εκεί συνεχίζουν ο ένας τον άλλο (19, 20, 21…, σε
 * κάθε σελίδα με όποια σειρά). Σε βιβλίο παρτίδων, ό,τι μοιάζει με αριθμό δίπλα στο διάγραμμα είναι αριθμός κίνησης.
 */
export function dropStrayLabels(diagrams: BookDiagram[], scanned = false): void {
  const labelled = diagrams.filter((d) => d.label);
  if (!labelled.length) return;
  const nums = labelled.map((d) => Number(d.label));
  const sorted = [...nums].sort((a, b) => a - b);
  let next = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] === 1) next++;
  // συνεχόμενοι αριθμοί και (σχεδόν) χωρίς επαναλήψεις
  if (labelled.length >= 4 && next >= (labelled.length - 1) * 0.6 && new Set(nums).size >= labelled.length * 0.8) return;
  // σελίδες από εικόνα (`scanned`: όλα τα διαγράμματα με αριθμό είναι σε τέτοιες): η αρίθμηση των ασκήσεων ξαναρχίζει σε κάθε κεφάλαιο (άρα επαναλήψεις) και σε δύο στήλες πάει
  // «25, 28, 26, 29…»· αρκεί με τη σειρά του βιβλίου κάθε αριθμός να είναι κοντά στον προηγούμενο
  if (scanned && labelled.length >= 4 && labelled.every((d) => d.id !== undefined)) {
    let close = 0;
    for (let i = 1; i < nums.length; i++) if (Math.abs(nums[i] - nums[i - 1]) <= 4) close++;
    if (close >= (labelled.length - 1) * 0.6) return;
  }
  for (const d of labelled) d.label = null;
}

/** Τα κομμάτια κειμένου μιας σελίδας στις συντεταγμένες της σελίδας όπως φαίνεται (μόνο οριζόντιο κείμενο). */
function textItems(lib: NonNullable<typeof pdfjs>, tc: { items: unknown[] } | null, view: Mat, pageH: number): Item[] {
  const items: Item[] = [];
  for (const it of (tc?.items ?? []) as Array<{ str: string; transform: number[]; width: number; fontName: string }>) {
    if (!it.str || !it.str.trim()) continue;
    const m = lib.Util.transform(view, it.transform) as Mat;
    // κάθετο ή περιστραμμένο κείμενο (π.χ. στη ράχη): έξω
    if (Math.abs(m[1]) > Math.abs(m[0]) * 0.2 || m[0] <= 0) continue;
    const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 10;
    const scale = Math.hypot(view[0], view[1]) || 1;
    items.push({ str: it.str, x: m[4], y: pageH - m[5], w: it.width * scale, size, font: it.fontName });
  }
  return items;
}

/** Διαβάζει όλες τις σελίδες σε γραμμές. */
export async function readPdfLines(file: string, opts: ReadOptions = {}): Promise<{ title: string; author: string; pages: number; lines: Line[]; ocrPages: number; boards: BookBoards | null }> {
  const { signal, onPage, onOcr } = opts;
  const images = opts.images !== false;
  const lib = await loadPdfjs();
  const dir = pdfjsDir();
  const buf = fs.readFileSync(file);
  const task = lib.getDocument({
    // όψη πάνω στα ίδια bytes, όχι αντίγραφο (ένα μεγάλο PDF δεν χρειάζεται διπλή μνήμη)
    data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    // οι εικόνες έρχονται ως pixel (χωρίς canvas)· JPX και JBIG2 με τους αποκωδικοποιητές wasm του pdf.js
    isOffscreenCanvasSupported: false,
    // το pdf.js θέλει «/» στο τέλος (όχι την ανάποδη κάθετο των Windows)
    cMapUrl: `${toSlash(path.join(dir, 'cmaps'))}/`,
    cMapPacked: true,
    standardFontDataUrl: `${toSlash(path.join(dir, 'standard_fonts'))}/`,
    wasmUrl: `${toSlash(path.join(dir, 'wasm'))}/`,
  });
  const byPage = new Map<number, Line[]>();
  const cells: Cell[][] = [];
  // με το πακέτο διαγραμμάτων: το απόκομμα κάθε σκακιέρας-εικόνας (ίδια θέση με το `cells`)
  const net = images ? (opts.diagramNet === undefined ? findDiagramNet() : opts.diagramNet) : null;
  const crops: Array<Gray | null> | undefined = net ? [] : undefined;
  // σύμβολα αξιολόγησης ως μικρές εικόνες μέσα στο κείμενο (±, ⩲…): δοκιμή στις πρώτες σελίδες
  // με κείμενο, και αν υπάρχουν, σε όλο το βιβλίο (η λίστα εντολών κάθε σελίδας κοστίζει, ~7″ για 300 σελίδες)
  let symbolPages: 'probe' | 'yes' | 'no' = 'probe';
  let probed = 0;
  let symbolsSeen = 0;
  // σελίδες για OCR: από την εικόνα του pdf.js (σκαναρισμένη σελίδα) ή με απόδοση από τα Windows
  // (σελίδα με κείμενο-«σκουπίδια»: τα διαγράμματα-εικόνες της από το pdf.js, στην ανάλυσή τους, όχι από την απόδοση)
  // (της σκαναρισμένης κρατιέται μόνο ο αριθμός: η εικόνα της, ~25 MB, ξαναδιαβάζεται τη στιγμή του OCR· κρατημένες
  // όλες μαζί, 300 σελίδες γέμιζαν ~7 GB μνήμης και η ανάγνωση έσκαγε)
  // (`scanned` 'auto': σελίδα με κείμενο που ξαναδιαβάζεται από την εικόνα της· από τη μεγάλη εικόνα του PDF αν καλύπτει
  // τη σελίδα, αλλιώς όπως τη ζωγραφίζουν τα Windows)
  const ocrJobs: OcrJob[] = [];
  const pack = images ? (opts.ppocr === undefined ? findPpocr() : opts.ppocr) : null;
  const geo = new Map<number, { view: Mat; pw: number; ph: number }>();
  let ocrPages = 0;
  try {
    const doc = await task.promise.catch((e: unknown) => {
      throw openError(e);
    });
    const meta = (await doc.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
    const [first, last] = opts.range ?? [1, doc.numPages];
    // σελίδες με κανονικό κείμενο που ίσως έχουν διαγράμματα-εικόνες, και ενδείξεις βιβλίου ασκήσεων στο κείμενο
    const later: number[] = [];
    let cues = 0;
    // σελίδες με τις συντεταγμένες διαγράμματος στο κείμενο («a b c d e f g h»: σκαναρισμένο βιβλίο με κείμενο OCR, όπου
    // τα διαγράμματα είναι μέσα στην εικόνα της σελίδας)
    const coords = new Set<number>();
    const scan: TextScan = { read: 0, ocr: 0, squares: 0, clean: 0 };
    for (let p = Math.max(1, first); p <= Math.min(doc.numPages, last); p++) {
      if (signal?.aborted) throw new Error('aborted');
      // μια χαλασμένη σελίδα δεν σταματά το βιβλίο: μένει έξω και η ανάγνωση συνεχίζει
      const page = await doc.getPage(p).catch(() => null);
      if (!page) continue;
      const vp = page.getViewport({ scale: 1 });
      const view = vp.transform as Mat;
      const tc = await page.getTextContent().catch(() => null);
      const items = textItems(lib, tc, view, vp.height);
      const { diagrams, rest } = findDiagrams(items);
      const quality = opts.asScan ? 'garbage' : textQuality(rest);
      const lines: Line[] = [];
      geo.set(p, { view, pw: vp.width, ph: vp.height });
      // οι εικόνες (λίστα εντολών του pdf.js) μόνο όπου χρειάζονται: σελίδα χωρίς κανονικό κείμενο, ή το δεύτερο
      // πέρασμα πιο κάτω· αλλιώς ένα βιβλίο θεωρίας θα αργούσε πολύ χωρίς λόγο
      let imgs: Array<{ ctm: Mat; get: () => Promise<Gray | null> }> = [];
      if (images && quality !== 'good' && !opts.asScan) imgs = await pageImages(lib, page).catch(() => []);
      // η μεγαλύτερη εικόνα: αν καλύπτει τη σελίδα, η σελίδα είναι σκαναρισμένη
      const area = (m: Mat) => Math.abs(m[0] * m[3] - m[1] * m[2]);
      const big = imgs.length ? imgs.reduce((a, b) => (area(b.ctm) > area(a.ctm) ? b : a)) : null;
      const scanned = big !== null && area(big.ctm) > vp.width * vp.height * 0.5;
      // τα διαγράμματα-εικόνες της σελίδας (όχι μιας σκαναρισμένης: εκεί βρίσκονται στην ίδια τη σελίδα)
      const pageBoards = async () => {
        const out = { items: [] as Item[], areas: [] as Array<[number, number, number, number]> };
        for (const im of imgs) {
          const m = im.ctm;
          // μόνο εικόνες στο μέγεθος διαγράμματος (όχι εικονίδια ή γραμμές)
          if (Math.min(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])) < 50) continue;
          const g = await im.get();
          if (!g || Math.min(g.w, g.h) < 64) continue;
          const fr = frameOf(g, m, view);
          // εικόνα έξω από την ορατή σελίδα (π.χ. PDF με δύο σελίδες του βιβλίου ανά σελίδα και περικοπή): έξω
          if (fr.x0 > vp.width || fr.y0 > vp.height || fr.x0 + fr.w < 0 || fr.y0 + fr.h < 0) continue;
          const found = imageBoards(fr, vp.height, cells, vp.width, 800, false, crops);
          found.items.forEach((it, i) => {
            // η ίδια εικόνα ζωγραφισμένη δύο φορές (π.χ. με μάσκα): μία σκακιέρα
            if (out.items.some((o) => Math.abs(o.x - it.x) < it.w / 4 && Math.abs(o.y - it.y) < it.w / 4)) return;
            out.items.push(it);
            out.areas.push(found.areas[i]);
          });
        }
        return out;
      };
      if (images && quality !== 'good' && (scanned || quality === 'garbage')) {
        // OCR αργότερα, όλες μαζί
        ocrJobs.push({ page: p, view, pw: vp.width, ph: vp.height, scanned, ...(scanned || opts.asScan ? {} : { boards: await pageBoards() }) });
      } else {
        let syms: Item[] = [];
        if (symbolPages !== 'no' && quality === 'good' && rest.length) {
          syms = await symbolItems(lib, page, view, vp.height).catch(() => []);
          symbolsSeen += syms.length;
          if (symbolPages === 'probe' && (symbolsSeen >= 3 ? (symbolPages = 'yes') : ++probed >= 40)) symbolPages = symbolsSeen >= 3 ? 'yes' : 'no';
        }
        lines.push(...pageLines([...rest, ...diagrams, ...syms], p));
        // (σελίδα με διαγράμματα σε γραμματοσειρά σκακιού: τα διαγράμματά της είναι αυτά, όχι εικόνες)
        if (images && !diagrams.length) later.push(p);
        if (/\ba ?b ?c ?d ?e ?f ?g ?h\b/.test(rest.map((it) => it.str).join(' ').replace(/\s+/g, ' '))) coords.add(p);
        for (const it of rest) if (CUE_RE.test(it.str)) cues++;
        const mt = moveTokens(rest.map((it) => it.str).join(' '));
        scan.squares += mt.squares;
        scan.clean += mt.clean;
      }
      page.cleanup();
      byPage.set(p, lines);
      scan.read++;
      scan.ocr = ocrJobs.length;
      opts.onText?.({ ...scan });
      onPage?.(p, doc.numPages);
    }
    // δεύτερο πέρασμα: διαγράμματα-εικόνες σε σελίδες με κείμενο, σε βιβλίο ασκήσεων («White to move»)· σε βιβλίο
    // θεωρίας ή παρτίδων οι θέσεις βγαίνουν από τις κινήσεις του κειμένου, εκτός από σελίδες με συντεταγμένες στο κείμενο
    // (σκαναρισμένο βιβλίο με κείμενο OCR: οι γραμμές μετά από διάγραμμα ξεκινούν από τη θέση του)
    // βιβλίο με κείμενο αλλά χαλασμένες κινήσεις (σκαναρισμένο με κρυφό κείμενο OCR, σύμβολα κομματιών χωρίς ToUnicode):
    // με τον αναγνώστη εικόνας διαβάζεται όλο από τις εικόνες των σελίδων· το κείμενο του PDF μένει εφεδρεία ανά σελίδα
    // (και βιβλίο με κείμενο χωρίς καθόλου έντονα από μετατροπή σκαναρίσματος: το κείμενο δεν ξεχωρίζει την κύρια
    // γραμμή, ενώ ο αναγνώστης εικόνας τη βρίσκει από το πάχος)
    const boldless = () => scan.squares >= 300 && !Object.values(fontRoles([...byPage.values()].flat())).some((r) => r === 'main' || r === 'top');
    // (όχι όταν το κείμενο του PDF είναι ήδη καλό: ≥ 10 κινήσεις ανά σελίδα και το 80% στο δέντρο)
    const textGood = () => {
      const all = [...byPage.values()].flat();
      if (!all.length) return false;
      const st = parseBook(toParagraphs(all, fontRoles(all)).filter((q) => !q.diagram), { title: '', author: '' }).stats;
      const found = st.moves + st.unplaced;
      return found >= 10 * byPage.size && st.moves >= 0.8 * found;
    };
    if (pack && !opts.asScan && (textWarning(scan) === 'garbled' || boldless()) && !textGood()) {
      const queued = new Set(ocrJobs.map((j) => j.page));
      for (const [p, g] of geo) if (!queued.has(p)) ocrJobs.push({ page: p, ...g, scanned: 'auto' });
      ocrJobs.sort((a, b) => a.page - b.page);
      later.length = 0;
    }
    const second = cues >= 3 ? later : later.filter((p) => coords.has(p));
    if (second.length) {
      for (const p of second) {
        if (signal?.aborted) throw new Error('aborted');
        const page = await doc.getPage(p).catch(() => null);
        if (!page) continue;
        const vp = page.getViewport({ scale: 1 });
        const view = vp.transform as Mat;
        const imgs = await pageImages(lib, page).catch(() => []);
        const boards: Item[] = [];
        for (const im of imgs) {
          const m = im.ctm;
          if (Math.min(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])) < 50) continue;
          const g = await im.get();
          if (!g || Math.min(g.w, g.h) < 64) continue;
          const fr = frameOf(g, m, view);
          if (fr.x0 > vp.width || fr.y0 > vp.height || fr.x0 + fr.w < 0 || fr.y0 + fr.h < 0) continue;
          for (const it of imageBoards(fr, vp.height, cells, vp.width, 800, false, crops).items) if (!boards.some((o) => Math.abs(o.x - it.x) < it.w / 4 && Math.abs(o.y - it.y) < it.w / 4)) boards.push(it);
        }
        if (boards.length) {
          const tc = await page.getTextContent().catch(() => null);
          const { diagrams, rest } = findDiagrams(textItems(lib, tc, view, vp.height));
          byPage.set(p, pageLines([...annotateDiagrams(boards, rest), ...diagrams, ...boards], p));
        }
        page.cleanup();
      }
    }
    /** η εικόνα μιας σκαναρισμένης σελίδας (η μεγαλύτερη του pdf.js), ξανά από το PDF */
    const scanFrame = async (p: number): Promise<Frame | null> => {
      const page = await doc.getPage(p).catch(() => null);
      if (!page) return null;
      try {
        const imgs = await pageImages(lib, page).catch(() => []);
        const area = (m: Mat) => Math.abs(m[0] * m[3] - m[1] * m[2]);
        const big = imgs.length ? imgs.reduce((a, b) => (area(b.ctm) > area(a.ctm) ? b : a)) : null;
        const g = big ? await big.get() : null;
        return g ? frameOf(g, big!.ctm, page.getViewport({ scale: 1 }).transform as Mat) : null;
      } finally {
        page.cleanup();
      }
    };
    // ο αναγνώστης εικόνας (αν είναι εγκατεστημένος) διαβάζει όλες τις σελίδες που χρειάζονται OCR· τα σύμβολα των
    // κομματιών κρίνονται στο τέλος, από όλο το βιβλίο. Αν δεν ξεκινήσει, μένει το OCR των Windows πιο κάτω.
    if (ocrJobs.length && pack) {
      const pp = new PpOcr(pack);
      const started = await pp.ready.then(
        () => true,
        () => false,
      );
      if (!started) pp.close();
      else {
        const win = ocrJobs.some((j) => j.scanned !== true) ? new WinOcr(path.resolve(file)) : null;
        // (αν τα Windows δεν ανοίγουν το PDF, οι σελίδες που θα ζωγράφιζαν μένουν με το κείμενό τους)
        win?.ready.catch(() => {});
        // πολλές σελίδες ταυτόχρονα σε περισσότερες διεργασίες αναγνώστη: η εικόνα της σελίδας και η ανάλυση των γλύφων
        // τρέχουν σε έναν πυρήνα, άρα περισσότερα νήματα στο μοντέλο δεν βοηθούν (2–3 διεργασίες επιταχύνουν σημαντικά)
        const cpus = os.cpus().length;
        const lanes = Math.max(1, Math.min(3, Number(process.env.KNIGHTBASE_PPOCR_LANES) || (cpus >= 12 ? 3 : cpus >= 8 ? 2 : 1)));
        const pps = [pp];
        for (let k = 1; k < lanes; k++) {
          const extra = new PpOcr(pack);
          if (await extra.ready.then(() => true, () => false)) pps.push(extra);
          else extra.close();
        }
        const abort = () => {
          for (const x of pps) x.close();
          win?.kill();
        };
        signal?.addEventListener('abort', abort);
        const root = path.join(os.tmpdir(), 'knightbase-book');
        fs.mkdirSync(root, { recursive: true });
        const tmp = fs.mkdtempSync(path.join(root, 'ocr-'));
        const held: PpHeld[] = [];
        const cands: Cand[] = [];
        // (τα Windows ζωγραφίζουν μία σελίδα κάθε φορά)
        let winQueue: Promise<unknown> = Promise.resolve();
        const render = (page: number, width: number, bmp: string) => {
          const r = winQueue.then(() => win!.render(page, width, bmp, false));
          winQueue = r.catch(() => null);
          return r;
        };
        /** η εικόνα μιας σελίδας και η ανάγνωσή της */
        const readJob = async (job: OcrJob, reader: PpOcr): Promise<{ frame: Frame | null; res: Awaited<ReturnType<PpOcr['read']>> | null }> => {
            let frame: Frame | null = null;
            if (job.scanned !== false) {
              frame = await scanFrame(job.page);
              // (σελίδα με κείμενο: μόνο αν η εικόνα της είναι όλη η σελίδα, δηλαδή σκαναρισμένη με κρυφό κείμενο)
              if (frame && job.scanned === 'auto' && frame.w * frame.h < 0.5 * job.pw * job.ph) frame = null;
              // μικρή εικόνα: μεγέθυνση, ώστε τα γράμματα να έχουν αρκετά pixel για τους γλύφους (ως ×3)
              const k = frame ? Math.min(3, (frame.w > frame.h ? 4000 : 2400) / Math.max(frame.img.w, 1)) : 1;
              if (frame && k > 1.15) frame = { ...frame, img: resize(frame.img, Math.round(frame.img.w * k), Math.round(frame.img.h * k)) };
            }
            if (!frame && win && job.scanned !== true) {
              // όπως τη ζωγραφίζουν τα Windows (2400 pixel η στενή πλευρά μιας κανονικής σελίδας)
              const bmp = path.join(tmp, `p${job.page}.bmp`);
              const width = Math.min(4800, Math.max(2400, Math.round((job.pw / Math.max(1, Math.min(job.pw, job.ph))) * 2400)));
              const r = await render(job.page, width, bmp).catch(() => null);
              if (r && !r.error && fs.existsSync(bmp)) frame = { img: readBmp(fs.readFileSync(bmp)), x0: 0, y0: 0, w: job.pw, h: job.ph };
              fs.rmSync(bmp, { force: true });
            }
            const res = frame ? await reader.read(job.page, frame.img).catch(() => null) : null;
            return { frame, res };
        };
        // κάθε διεργασία παίρνει τις σελίδες της με τη σειρά· τα αποτελέσματα επεξεργάζονται με τη σειρά των σελίδων
        const slots = ocrJobs.map(() => {
          let resolve!: (v: Awaited<ReturnType<typeof readJob>>) => void;
          const p = new Promise<Awaited<ReturnType<typeof readJob>>>((r) => (resolve = r));
          return { p, resolve };
        });
        const laneRuns = pps.map(async (reader, lane) => {
          for (let i = lane; i < ocrJobs.length; i += pps.length) {
            if (signal?.aborted) {
              slots[i].resolve({ frame: null, res: null });
              continue;
            }
            slots[i].resolve(await readJob(ocrJobs[i], reader).catch(() => ({ frame: null, res: null })));
          }
        });
        try {
          let done = 0;
          for (let i = 0; i < ocrJobs.length; i++) {
            const job = ocrJobs[i];
            const { frame, res } = await slots[i].p;
            if (signal?.aborted) throw new Error('aborted');
            if (frame && res) {
              const boards = job.boards?.items.length ? job.boards : imageBoards(frame, job.ph, cells, job.pw, 1400, true, crops);
              const h: PpHeld = { job, fr: { x0: frame.x0, y0: frame.y0, w: frame.w, h: frame.h }, iw: frame.img.w, ih: frame.img.h, boards, words: [], ems: [], pending: [] };
              const withCand = new Set(res.cands.map((c) => c.line));
              res.lines.forEach((l, li) => {
                h.ems.push(l.em);
                // οι γραμμές χωρίς υποψήφια σύμβολα γίνονται αμέσως λέξεις· οι άλλες περιμένουν την απόφαση
                if (withCand.has(li)) {
                  h.words.push([]);
                  h.pending.push({ li, l });
                } else h.words.push(lineWords(l));
              });
              for (const c of res.cands) cands.push({ ...c, page: held.length });
              held.push(h);
            }
            onOcr?.(++done, ocrJobs.length);
          }
        } finally {
          signal?.removeEventListener('abort', abort);
          await Promise.all(laneRuns).catch(() => {});
          for (const x of pps) x.close();
          win?.close();
          fs.rmSync(tmp, { recursive: true, force: true });
        }
        // ποιοι υποψήφιοι είναι σύμβολα κομματιών, σε όλο το βιβλίο
        const { cluster } = decideFigurines(cands);
        const figs = new Map<string, { figs: Map<number, string>; spans: Map<number, number> }>();
        cands.forEach((c, i) => {
          if (cluster[i] < 0) return;
          const key = `${c.page}:${c.line}`;
          const m = figs.get(key) ?? { figs: new Map<number, string>(), spans: new Map<number, number>() };
          m.figs.set(c.glyph, figChar(cluster[i]));
          if (c.span > 1) m.spans.set(c.glyph, c.span);
          figs.set(key, m);
        });
        held.forEach((h, hi) => {
          for (const { li, l } of h.pending) {
            const m = figs.get(`${hi}:${li}`);
            h.words[li] = lineWords(l, m?.figs, m?.spans);
          }
          h.pending = [];
        });
        const weight = ppWeight(held);
        const laid: Array<{ page: number; items: Item[] }> = [];
        held.forEach((h) => {
          const words = ppItems(h, weight);
          // (σελίδα με κείμενο όπου ο αναγνώστης δεν βρήκε τίποτα: μένει το κείμενο του PDF)
          if (!words.length && h.job.scanned === 'auto') return;
          const { diagrams: fontBoards, rest } = findDiagrams(words);
          const text = h.boards.items.length ? annotateDiagrams(h.boards.items, rest) : rest;
          laid.push({ page: h.job.page, items: [...text, ...fontBoards, ...h.boards.items] });
          if (words.length) ocrPages++;
        });
        // το κενό των στηλών του βιβλίου (χωριστά στις μονές και στις ζυγές σελίδες: το σκανάρισμα τις μετατοπίζει
        // διαφορετικά): σε σελίδα όπου δεν βρίσκεται μόνο του (λίγες γραμμές σε στήλες κάτω από κείμενο σε όλο το πλάτος,
        // π.χ. εκεί που αρχίζει μια παρτίδα) δοκιμάζεται αυτό
        const found = laid.map((p) => ({ page: p.page, g: gutterOf(p.items) }));
        const usual = (parity: number | null): { left: number; right: number } | null => {
          const gs = found.filter((f) => f.g && (parity === null || f.page % 2 === parity)).map((f) => f.g!);
          if (gs.length < Math.max(3, laid.length * (parity === null ? 0.3 : 0.15))) return null;
          const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
          return { left: med(gs.map((g) => g.left)), right: med(gs.map((g) => g.right)) };
        };
        const hints = [usual(0) ?? usual(null), usual(1) ?? usual(null)];
        for (const p of laid) byPage.set(p.page, pageLines(p.items, p.page, 0, hints[p.page % 2] ?? undefined));
        ocrJobs.length = 0;
      }
    }
    // (χωρίς τον αναγνώστη εικόνας, οι σελίδες με κείμενο κρατούν το κείμενό τους)
    for (let i = ocrJobs.length - 1; i >= 0; i--) if (ocrJobs[i].scanned === 'auto') ocrJobs.splice(i, 1);
    if (ocrJobs.length) {
      // παράλληλα OCR (ως 3 διεργασίες, ανάλογα με τους πυρήνες): κάθε διεργασία του OCR των Windows δουλεύει σε έναν πυρήνα
      const workers = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2), Math.ceil(ocrJobs.length / 4)));
      // (με το PDF μόνο όταν τα Windows πρέπει να ζωγραφίσουν σελίδες: ένα PDF που δεν ανοίγουν δεν σταματά τις σκαναρισμένες)
      const withPdf = ocrJobs.some((j) => !j.scanned);
      const pool = Array.from({ length: workers }, () => new WinOcr(withPdf ? path.resolve(file) : null));
      // το μοντέλο ανάγνωσης (αν υπάρχει): διαβάζει κάθε σκαναρισμένη σελίδα παράλληλα με το OCR των Windows
      const vpack = opts.vlm === undefined ? findVlm() : opts.vlm;
      const vlm = vpack && ocrJobs.some((j) => j.scanned) ? new VlmOcr(vpack, path.join(vpack.dir, 'cache')) : null;
      const abort = () => {
        pool.forEach((o) => o.kill());
        vlm?.close();
      };
      signal?.addEventListener('abort', abort);
      // (μέσα στο knightbase-book: αν ο server κλείσει στη μέση, τον καθαρίζει η επόμενη εκκίνηση, `removeStale`)
      const root = path.join(os.tmpdir(), 'knightbase-book');
      fs.mkdirSync(root, { recursive: true });
      const tmp = fs.mkdtempSync(path.join(root, 'ocr-'));
      try {
        await Promise.all(pool.map((o) => o.ready));
        let done = 0;
        let next = 0;
        const run = async (ocr: WinOcr) => {
          while (next < ocrJobs.length) {
            const job = ocrJobs[next++];
            if (signal?.aborted) throw new Error('aborted');
            const bmp = path.join(tmp, `p${job.page}.bmp`);
            let frame = job.scanned ? await scanFrame(job.page) : null;
            // (σκαναρισμένη σελίδα με εικόνα που δεν διαβάστηκε, χωρίς το PDF στα Windows: μένει έξω)
            if (!frame && !withPdf) {
              onOcr?.(++done, ocrJobs.length);
              continue;
            }
            let res: OcrPage;
            let vtext: Promise<string> | null = null;
            let alt: { res: OcrPage; frame: Frame } | null = null;
            if (frame) {
              // σκαναρισμένη σελίδα: η εικόνα του PDF, μεγεθυμένη όταν τα γράμματα είναι πολύ μικρά για το OCR
              const native = frame.img;
              let img = native;
              const target = (frame.w > frame.h ? 3000 : 1800) / Math.max(img.w, 1);
              if (target > 1.25) img = resize(img, Math.round(img.w * Math.min(3, target)), Math.round(img.h * Math.min(3, target)));
              frame = { ...frame, img };
              // (στο μοντέλο ως ~1,2 MP: τόσο κρατά το PaddleOCR-VL, και η μεταφορά είναι μικρότερη)
              const f = Math.sqrt(1.2e6 / (native.w * native.h));
              vtext = vlm ? vlm.read(f < 1 ? resize(native, Math.round(native.w * f), Math.round(native.h * f)) : native, signal) : null;
              fs.writeFileSync(bmp, writeBmp(img));
              res = await ocr.ocr(job.page, bmp);
              // το OCR των Windows παραλείπει λέξεις (κινήσεις με σύμβολο, ακόμη και «f4», «0-0-0»), άλλες σε κάθε ανάλυση:
              // όπου λείπουν κινήσεις («5 6», «8 9»), δεύτερο πέρασμα σε άλλη ανάλυση και ένωση των λέξεων
              if (!res.error && missingMoves(res)) {
                const img2 = img === native ? resize(native, Math.round(native.w * 1.5), Math.round(native.h * 1.5)) : native;
                // (άλλο αρχείο: το PowerShell μπορεί να κρατά ακόμη ανοιχτό το πρώτο)
                const bmp2 = path.join(tmp, `p${job.page}b.bmp`);
                fs.writeFileSync(bmp2, writeBmp(img2));
                const res2 = await ocr.ocr(job.page, bmp2);
                fs.rmSync(bmp2, { force: true });
                if (!res2.error) alt = { res: res2, frame: { ...frame, img: img2 } };
              }
            } else {
              // κείμενο-«σκουπίδια»: η σελίδα όπως τη ζωγραφίζουν τα Windows
              const width = Math.min(3400, Math.max(1700, Math.round((job.pw / Math.max(1, Math.min(job.pw, job.ph))) * 1700)));
              res = await ocr.render(job.page, width, bmp, true);
              frame = { img: fs.existsSync(bmp) ? readBmp(fs.readFileSync(bmp)) : { w: 1, h: 1, px: new Uint8Array(1) }, x0: 0, y0: 0, w: job.pw, h: job.ph };
            }
            fs.rmSync(bmp, { force: true });
            const { items: boards, areas } = res.error ? { items: [], areas: [] } : job.boards?.items.length ? job.boards : imageBoards(frame, job.ph, cells, job.pw, 1400, false, crops);
            const inBoard = (x: number, y: number) => areas.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
            let words = res.error ? [] : ocrItems(res, frame, job.ph, inBoard);
            if (alt) words = mergeWords(words, ocrItems(alt.res, alt.frame, job.ph, inBoard));
            // λέξεις που έλειψαν και από τα δύο: τα κενά με μελάνι ξαναδιαβάζονται μόνα τους
            if (!res.error && frame.img.w > 1) {
              const extra = await gapWords(ocr, job.page, frame.img, res.lines, path.join(tmp, `p${job.page}g`));
              if (extra.length) words = mergeWords(words, ocrItems({ ...res, lines: extra.map((w) => [w]) }, frame, job.ph, inBoard));
            }
            if (vtext) words = retext(words, await vtext);
            const { diagrams: fontBoards, rest } = findDiagrams(words);
            const text = boards.length ? annotateDiagrams(boards, rest) : rest;
            byPage.set(job.page, pageLines([...text, ...fontBoards, ...boards], job.page));
            if (words.length) ocrPages++;
            onOcr?.(++done, ocrJobs.length);
          }
        };
        await Promise.all(pool.map(run));
      } finally {
        signal?.removeEventListener('abort', abort);
        pool.forEach((o) => o.close());
        vlm?.close();
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    const lines = [...byPage.keys()].sort((a, b) => a - b).flatMap((p) => byPage.get(p)!);
    let boards: BookBoards | null = null;
    if (cells.length) {
      boards = readBoards(cells);
      if (net && crops) {
        const read = await readDiagrams(net, cells.map((_, i) => crops[i] ?? null), signal);
        boards.fixed = new Map(read.flatMap((r, i) => (r ? [[i, r.placement] as [number, string]] : [])));
      }
      const pl = placements(boards);
      for (const l of lines) if (l.diagram?.id !== undefined) l.diagram.placement = pl[l.diagram.id];
      // (σελίδες από εικόνα: όσες έχουν κείμενο από τον αναγνώστη ή το OCR)
      const fromImage = new Set(lines.filter((l) => l.segs.some((s) => s.font.startsWith('ocr'))).map((l) => l.page));
      const labelled = lines.filter((l) => l.diagram?.label);
      dropStrayLabels(
        lines.flatMap((l) => (l.diagram?.id !== undefined ? [l.diagram] : [])),
        labelled.length > 0 && labelled.every((l) => fromImage.has(l.page)),
      );
    }
    return { title: meta?.Title?.trim() ?? '', author: meta?.Author?.trim() ?? '', pages: doc.numPages, lines, ocrPages, boards };
  } finally {
    await task.destroy();
  }
}

/**
 * Σελίδα σε δύο στήλες (σκαναρισμένες διπλές σελίδες ή διάταξη δύο στηλών): το κενό ανάμεσά τους, στο μεσαίο τμήμα
 * της σελίδας, όπου δεν περνά σχεδόν καμία γραμμή (μόνο τίτλοι σε όλο το πλάτος). Χωρίς αυτό οι γραμμές των δύο
 * στηλών ενώνονταν.
 */
function gutterOf(items: Item[]): { left: number; right: number; loose?: boolean; band?: boolean } | null {
  const text = items.filter((it) => it.str.trim() && it.w > 0);
  if (text.length < 20) return null;
  const minX = Math.min(...text.map((it) => it.x));
  const width = Math.max(...text.map((it) => it.x + it.w)) - minX;
  if (width < 200) return null;
  // οι γραμμές της σελίδας (κομμάτια στο ίδιο ύψος· δύο στήλες μοιράζονται τις γραμμές τους όταν είναι στο ίδιο ύψος)
  const byY = [...text].sort((a, b) => b.y - a.y || a.x - b.x);
  const rowOf: number[] = [];
  let rows = 0;
  let rowY = Infinity;
  for (const it of byY) {
    if (Math.abs(rowY - it.y) > Math.max(2, 0.35 * it.size)) {
      rows++;
      rowY = it.y;
    }
    rowOf.push(rows - 1);
  }
  // πόσες γραμμές περνούν από κάθε x: γραμμές, όχι κομμάτια, γιατί μια γραμμή σε πολλά κομμάτια (σύμβολα κομματιών
  // και κινήσεις χωριστά, λέξεις του OCR) μετρούσε πολλές φορές και το όριο ξέφευγε (το «κενό» απλωνόταν σε όλη τη
  // σελίδα των λέξεων του OCR, ή έβρισκε «στήλες» σε σελίδες μίας στήλης με λίγες γραμμές)
  const bins = new Uint16Array(Math.ceil(width) + 1);
  const last = new Int32Array(bins.length).fill(-1);
  byY.forEach((it, i) => {
    for (let x = Math.max(0, Math.floor(it.x - minX)); x <= Math.min(bins.length - 1, Math.ceil(it.x + it.w - minX)); x++) {
      if (last[x] === rowOf[i]) continue;
      last[x] = rowOf[i];
      bins[x]++;
    }
  });
  // τίτλοι που περνούν το κενό (π.χ. η αρχή μιας παρτίδας): ως 8% των γραμμών· αν δεν βρεθεί έτσι, ως 15% (γραμμές
  // της αριστερής στήλης που μπαίνουν λίγο σε στενό κενό)
  // (και ως 30%: σελίδα με ζώνες, όπου ανάμεσα στις ζώνες δύο στηλών υπάρχει κείμενο σε όλο το πλάτος· μόνο με τις
  // αυστηρές ενδείξεις στο τέλος)
  let best: [number, number] | null = null;
  let loose = false;
  for (const share of [0.08, 0.15, 0.3]) {
    const limit = Math.max(2, Math.round(rows * share));
    for (let x = Math.floor(width * 0.3); x <= width * 0.7; x++) {
      if (bins[x] > limit) continue;
      let e = x;
      while (e + 1 < bins.length && bins[e + 1] <= limit) e++;
      if (!best || e - x > best[1] - best[0]) best = [x, e];
      x = e;
    }
    // (με το χαλαρότερο όριο μόνο κενό στη μέση της σελίδας: αλλιώς έβρισκε «στήλες» σε σελίδα με ένα διάγραμμα στο πλάι)
    if (best && best[1] - best[0] >= 6 && (share === 0.08 || Math.abs((best[0] + best[1]) / 2 - width / 2) <= width * 0.1)) {
      loose = share === 0.3;
      break;
    }
    best = null;
  }
  if (!best) return bandGutter(text, byY, rowOf, minX, width);
  const left = minX + best[0];
  const right = minX + best[1];
  const l = text.filter((it) => it.x + it.w <= right).length;
  const r = text.filter((it) => it.x >= right - 1).length;
  if (l < text.length * 0.25 || r < text.length * 0.25) return null;
  // λίγες γραμμές περνούν όλο το κενό (σε πραγματικές στήλες μόνο οι τίτλοι)
  const crossing = new Set(byY.flatMap((it, i) => (it.x < right - 1 && it.x + it.w > left + 1 ? [rowOf[i]] : []))).size;
  if (crossing * 2 > rows) return null;
  // το κενό είναι πιο φαρδύ από ένα κενό λέξης: σε μία στήλη με κοντές γραμμές (λύσεις ασκήσεων, ένα διάγραμμα στη
  // μέση) το «κενό» μπορεί να είναι απλώς το διάστημα ανάμεσα σε δύο λέξεις των λίγων μεγάλων γραμμών
  const size = [...text.map((it) => it.size)].sort((a, b) => a - b)[text.length >> 1];
  const narrow = right - left < 0.75 * size;
  if (right - left < 0.5 * size) return null;
  // η δεξιά στήλη έχει δικό της περιθώριο: οι γραμμές της ξεκινούν στο ίδιο x, στη δεξιά άκρη του κενού. Σε μία στήλη
  // με πολλές κοντές γραμμές κινήσεων και ένα διάγραμμα στη μέση το «κενό» βρισκόταν, αλλά τα «δεξιά» κομμάτια ήταν
  // οι συνέχειες των μεγάλων γραμμών, που ξεκινούν όπου έτυχε
  const starts = new Map<number, number>();
  const rowStart = new Map<number, number>();
  byY.forEach((it, i) => {
    if (it.x >= left - 1) rowStart.set(rowOf[i], Math.min(rowStart.get(rowOf[i]) ?? Infinity, it.x));
  });
  for (const x of rowStart.values()) starts.set(Math.round(x / 4), (starts.get(Math.round(x / 4)) ?? 0) + 1);
  // (±1 κελί των 4 μονάδων γύρω από το πιο συχνό)
  let mode = 0;
  let aligned = 0;
  for (const k of starts.keys()) {
    const n = (starts.get(k - 1) ?? 0) + (starts.get(k) ?? 0) + (starts.get(k + 1) ?? 0);
    if (n > aligned) [mode, aligned] = [k, n];
  }
  // (και οι γραμμές με εσοχή, π.χ. οι κινήσεις: ως 48 μονάδες μέσα από το περιθώριο)
  const near = [...rowStart.values()].filter((x) => x >= right - 4 && x <= right + 48).length;
  // στενό κενό (0,5–0,75 του μεγέθους των γραμμάτων): μόνο όταν οι περισσότερες γραμμές της δεξιάς πλευράς ξεκινούν
  // στο ίδιο x (πραγματική στήλη, όχι κενό λέξης)
  if ((narrow || loose) && !(rowStart.size >= 12 && aligned * 2 >= rowStart.size)) return null;
  return Math.abs(mode * 4 - right) <= 10 && near * 5 >= rowStart.size * 2 ? { left, right, loose } : null;
}

/**
 * Σελίδα από εικόνα με ζώνες (δύο στήλες, μετά τίτλος και εισαγωγή σε όλο το πλάτος, μετά πάλι δύο στήλες): πάνω από
 * το 30% των γραμμών περνά το κέντρο και το κενό δεν βρίσκεται από την κάλυψη. Οι γραμμές των στηλών όμως έχουν όλες ένα
 * κενό πάνω από κενό λέξης (≥ 0,7 του μεγέθους) στο ίδιο σημείο: το κοινό του διάστημα, αν είναι τουλάχιστον σε 6
 * γραμμές, είναι το κενό (`loose`, ώστε οι γραμμές σε όλο το πλάτος να μένουν ενωμένες, `pageLines`). Χωρίς αυτό οι
 * γραμμές των δύο στηλών ενώνονταν.
 */
function bandGutter(text: Item[], byY: Item[], rowOf: number[], minX: number, width: number): { left: number; right: number; loose: boolean; band: boolean } | null {
  if (!text.every((it) => it.font.startsWith('ocr'))) return null;
  const size = [...text.map((it) => it.size)].sort((a, b) => a - b)[text.length >> 1];
  const rows = new Map<number, Item[]>();
  byY.forEach((it, i) => rows.set(rowOf[i], [...(rows.get(rowOf[i]) ?? []), it]));
  const gaps: Array<[number, number]> = [];
  for (const row of rows.values()) {
    const r = [...row].sort((a, b) => a.x - b.x);
    let best: [number, number] | null = null;
    for (let k = 1; k < r.length; k++) {
      const a = r[k - 1].x + r[k - 1].w;
      const b = r[k].x;
      const c = (a + b) / 2 - minX;
      if (b - a >= 0.7 * size && c >= width * 0.3 && c <= width * 0.7 && (!best || b - a > best[1] - best[0])) best = [a, b];
    }
    if (best) gaps.push(best);
  }
  if (gaps.length < 6) return null;
  // το σημείο που περιέχεται στα περισσότερα κενά, και το κοινό διάστημα αυτών
  let at = 0;
  let most = 0;
  for (const [a, b] of gaps) {
    const x = (a + b) / 2;
    const n = gaps.filter(([p, q]) => p <= x && x <= q).length;
    if (n > most) [at, most] = [x, n];
  }
  if (most < 6 || most < rows.size * 0.2) return null;
  const share = gaps.filter(([p, q]) => p <= at && at <= q);
  const left = Math.max(...share.map(([p]) => p));
  const right = Math.min(...share.map(([, q]) => q));
  if (right - left < 0.5 * size) return null;
  const l = text.filter((it) => it.x + it.w <= right).length;
  const r = text.filter((it) => it.x >= right - 1).length;
  return l >= text.length * 0.25 && r >= text.length * 0.25 ? { left, right, loose: true, band: true } : null;
}

/**
 * Το κενό των στηλών του βιβλίου (`hint`) σε σελίδα όπου δεν βρέθηκε: ισχύει όταν τουλάχιστον τρεις γραμμές της έχουν
 * κείμενο και στις δύο πλευρές του χωρίς τίποτα μέσα του (οι υπόλοιπες είναι κείμενο σε όλο το πλάτος).
 */
function hintedGutter(items: Item[], hint: { left: number; right: number }): { left: number; right: number; loose: boolean } | null {
  const text = items.filter((it) => !it.diagram && it.str.trim() && it.w > 0);
  const left = hint.left + 1;
  const right = hint.right - 1;
  if (right - left < 2) return null;
  const rows: Item[][] = [];
  for (const it of [...text].sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, 0.35 * Math.min(r[0].size, it.size)));
    if (row) row.push(it);
    else rows.push([it]);
  }
  let split = 0;
  for (const row of rows) {
    if (row.some((it) => it.x < right && it.x + it.w > left)) continue;
    if (row.some((it) => it.x + it.w <= left) && row.some((it) => it.x >= right)) split++;
  }
  return split >= 3 ? { left: hint.left, right: hint.right, loose: true } : null;
}

/**
 * Τα κομμάτια μιας σελίδας σε γραμμές (από πάνω προς τα κάτω, από αριστερά προς τα δεξιά). Σε στήλες: οι
 * τίτλοι σε όλο το πλάτος χωρίζουν τη σελίδα σε ζώνες και σε κάθε ζώνη πρώτα η αριστερή στήλη, μετά η δεξιά (με
 * το x της μετατοπισμένο στο περιθώριο της αριστερής, ώστε οι εσοχές να μετρούν το ίδιο).
 */
export function pageLines(items: Item[], page: number, depth = 0, hint?: { left: number; right: number }): Line[] {
  // (αναδρομικά, ως δύο φορές: σκαναρισμένες διπλές σελίδες με δύο στήλες η καθεμιά)
  const g = depth < 2 ? (gutterOf(items) ?? (hint ? hintedGutter(items, hint) : null)) : null;
  if (!g) return groupLines(items, page);
  const mid = (g.left + g.right) / 2;
  const wide = items.filter((it) => it.x < g.left - 1 && it.x + it.w > g.right + 1);
  // λέξη που περνά το κενό των στηλών: όλη η γραμμή της είναι σε όλο το πλάτος (κεφαλίδα σελίδας σε χωριστές λέξεις,
  // «GAME 2: A. | KHALIFMAN | – E. SVESHNIKOV 17»: αλλιώς τα κομμάτια της έμπαιναν στην αρχή κάθε στήλης)
  for (const s of [...wide]) {
    if (s.diagram) continue;
    for (const o of items) if (!o.diagram && !wide.includes(o) && Math.abs(o.y - s.y) <= Math.max(2, 0.35 * Math.min(o.size, s.size))) wide.push(o);
  }
  // επικεφαλίδα σε όλο το πλάτος σε χωριστές λέξεις (OCR: «Wijk aan | Zee 1999», ο τίτλος της παρτίδας πάνω από τις
  // δύο στήλες): καμία λέξη δεν περνά το κενό των στηλών, αλλά οι δύο πλευρές απέχουν όσο ένα διάστημα, και η γραμμή
  // είναι κεντραρισμένη πάνω στο κενό χωρίς να φτάνει στα εξωτερικά περιθώρια. (Δύο γραμμές κειμένου των στηλών στο ίδιο
  // ύψος φτάνουν από άκρη σε άκρη· σε σκαναρίσματα με στενό κενό στηλών, Structures, κολλούσαν.)
  const pageL = Math.min(...items.filter((o) => !o.diagram).map((o) => o.x));
  const pageR = Math.max(...items.filter((o) => !o.diagram).map((o) => o.x + o.w));
  for (const it of items) {
    if (it.diagram || wide.includes(it)) continue;
    const row = items.filter((o) => !o.diagram && Math.abs(o.y - it.y) <= Math.max(2, 0.35 * Math.min(o.size, it.size)));
    const left = row.filter((o) => o.x + o.w / 2 < mid);
    const right = row.filter((o) => o.x + o.w / 2 >= mid);
    if (!left.length || !right.length) continue;
    const gap = Math.min(...right.map((o) => o.x)) - Math.max(...left.map((o) => o.x + o.w));
    const x0 = Math.min(...row.map((o) => o.x));
    const x1 = Math.max(...row.map((o) => o.x + o.w));
    const centered = x0 > pageL + 2 * it.size && x1 < pageR - 2 * it.size && Math.abs((x0 + x1) / 2 - mid) < 3 * it.size;
    // (σελίδα με ζώνες: γραμμή σε όλο το πλάτος έχει στο κενό των στηλών μόνο ένα κενό λέξης)
    // (και όχι πάνω από κενό λέξης, 0,7 του μεγέθους: όταν το κενό των στηλών είναι στενό, οι γραμμές των δύο
    // στηλών δεν πρέπει να ενώνονται)
    const full = g.loose === true && gap < Math.min(0.8 * (g.right - g.left), 0.7 * it.size);
    // (εκεί και ο κεντραρισμένος τίτλος με αραιά γράμματα, «Game 1»: το κενό του είναι όσο το κενό των στηλών)
    if (full || (centered && (g.loose ? gap < 2 * it.size : gap < 0.6 * it.size && gap < g.right - g.left))) for (const o of row) if (!wide.includes(o)) wide.push(o);
  }
  // (σελίδα με ζώνες που βρέθηκε από το κοινό κενό, `bandGutter`: επικεφαλίδα με μεγάλα γράμματα ανάμεσα στις ζώνες
  // είναι σε όλο το πλάτος και ας πιάνει μόνο το αριστερό μισό· όχι σε άλλες σελίδες με χαλαρό κενό)
  if ('band' in g && g.band) {
    const sizes = items.filter((o) => !o.diagram && o.str.trim()).map((o) => o.size).sort((a, b) => a - b);
    const med = sizes[sizes.length >> 1] ?? 0;
    for (const it of items) if (!it.diagram && !wide.includes(it) && it.str.trim() && it.size >= 1.3 * med) for (const o of items) if (!o.diagram && !wide.includes(o) && Math.abs(o.y - it.y) <= Math.max(2, 0.35 * Math.min(o.size, it.size))) wide.push(o);
  }
  const rest = items.filter((it) => !wide.includes(it));
  const leftX = Math.min(...rest.filter((it) => it.x + it.w / 2 < mid).map((it) => it.x));
  const rightX = Math.min(...rest.filter((it) => it.x + it.w / 2 >= mid).map((it) => it.x));
  const out: Line[] = [];
  let top = Infinity;
  for (const w of [...groupLines(wide, page), null]) {
    const bottom = w ? w.y : -Infinity;
    const band = rest.filter((it) => it.y <= top && it.y > bottom);
    out.push(...pageLines(band.filter((it) => it.x + it.w / 2 < mid), page, depth + 1));
    const right = pageLines(band.filter((it) => it.x + it.w / 2 >= mid), page, depth + 1);
    if (Number.isFinite(leftX) && Number.isFinite(rightX)) for (const l of right) l.x -= rightX - leftX;
    out.push(...right);
    if (w) out.push(w);
    top = bottom;
  }
  return out;
}

function groupLines(items: Item[], page: number): Line[] {
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const out: Line[] = [];
  for (const it of sorted) {
    if (it.diagram) {
      out.push({ page, x: it.x, y: it.y, size: it.size, segs: [], diagram: it.diagram });
      continue;
    }
    const line = out.find((l) => !l.diagram && Math.abs(l.y - it.y) <= Math.max(2, 0.35 * Math.min(l.size, it.size)));
    const seg: Seg = { text: it.str, font: it.font, x: it.x, end: it.x + it.w };
    if (line) {
      line.segs.push(seg);
      line.size = Math.max(line.size, it.size);
    } else out.push({ page, x: it.x, y: it.y, size: it.size, segs: [seg] });
  }
  // εκθέτες («2nd», «3rd»: μικρά γράμματα λίγο πάνω από τη γραμμή βάσης) στη γραμμή τους, όχι γραμμή μόνοι τους
  // (χώριζαν μια επικεφαλίδα στα δύο: «…the development of the f1-» / «nd rd th» / «bishop (on the 2 , 3 or 4 move)»)
  for (let i = out.length - 1; i >= 0; i--) {
    const s = out[i];
    if (s.diagram) continue;
    const x0 = Math.min(...s.segs.map((g) => g.x));
    const x1 = Math.max(...s.segs.map((g) => g.end));
    const host = out.find(
      (l) => l !== s && !l.diagram && s.size <= 0.7 * l.size && s.y > l.y && s.y - l.y <= 0.55 * l.size && l.segs.some((g) => g.x <= x1 + l.size && g.end >= x0 - l.size),
    );
    if (!host) continue;
    host.segs.push(...s.segs);
    out.splice(i, 1);
  }
  for (const l of out) {
    if (l.diagram) continue;
    l.segs.sort((p, q) => p.x - q.x);
    l.x = l.segs[0].x;
  }
  return out.sort((p, q) => q.y - p.y);
}

const GLYPH_SEG = /^\s*[iIlLtJD:.'’*r1�@%>W]{1,5}$/;

/**
 * Γραμμή του OCR μόνο με αριθμό και μία κίνηση («17 cxb3», «17 ... ♗f6», «20 e5!»): η κύρια γραμμή στα βιβλία όπου
 * κάθε κίνηση της παρτίδας είναι σε δική της γραμμή. Εκεί τα έντονα γράμματα τη χωρίζουν από τα σχόλια, αλλά το OCR
 * δεν τα βλέπει. Μόνο χωρίς τελεία μετά τον αριθμό, όπως γράφουν αυτά τα βιβλία: σε βιβλία με «17.♘xe5» μια τέτοια
 * γραμμή είναι απλώς το τέλος μιας βαριάντας που άλλαξε γραμμή.
 */
// (το κείμενο της γραμμής είναι τα κομμάτια της χωρίς κενά, «17cxb3»: η μία τελεία αποκλείεται, τα αποσιωπητικά όχι)
const OCR_MOVE_LINE_RE = /^\d{1,3}\s*(?:(?:\.\s?){2,3}|…)?\s*(?:[^\s.]{0,5}?[a-h]?[1-8]?x?[a-h][1-8lIS](?:=?[QRBN])?|[O0]-[O0](?:-[O0])?)[+#†‡]?[!?]{0,2}$/u;

/** Γραμμή του αναγνώστη εικόνας μόνο με αριθμό και μία ή δύο κινήσεις: «6 ♘d4 d5», «3 … c6», «12 … 0-0». */
const PP_MOVE = '(?:\\S{0,2}?[a-h]?[1-8]?x?[a-h][1-8](?:=?\\S)?|[O0]-[O0](?:-[O0])?)[+#†‡]?[!?]{0,2}';
const PP_MOVE_ROW_RE = new RegExp(`^\\d{1,3}\\.?\\s*(?:(?:\\.\\s?){2,3}|…)?\\s*${PP_MOVE}(?:\\s+${PP_MOVE})?$`, 'u');
/** μία κίνηση μόνη της */
const PP_MOVE_RE = new RegExp(`^${PP_MOVE}$`, 'u');

/**
 * Γραμμή του αναγνώστη εικόνας «αριθμός, κάτι μικρό, κίνηση» («17 s ♔g7», «12 ●1 ♘xd7») ή «σημάδι, κίνηση»
 * («* exd5»): το μικρό είναι οι κουκκίδες της κίνησης του Μαύρου, που το μοντέλο διάβασε σκουπίδι.
 */
function fixDotRow(segs: Seg[]): void {
  if (segs.length < 2 || segs.length > 3 || !segs.every((s) => s.font.startsWith('ocr'))) return;
  const t = segs.map((s) => s.text.trim());
  const move = /^(?:\S{0,2}?[a-h]?[1-8]?x?[a-h][1-8]|[O0]-[O0])/;
  const last = t[t.length - 1];
  if (!move.test(last) || last.length > 9) return;
  // (ως τέσσερις χαρακτήρες, «0香香»: όχι λέξη, δηλαδή ένα μόνο γράμμα ή κάτι που δεν είναι όλο γράμματα)
  const junk = t[1].length <= 4 && (t[1].length === 1 || /[^\p{L}]/u.test(t[1])) && !/[a-h][1-8]|^\d+$|^…$|[-]|^[O0]-[O0]/.test(t[1]);
  if (segs.length === 3 && /^\d{1,3}$/.test(t[0]) && junk) segs[1].text = '…';
  else if (segs.length === 2 && /^[^\p{L}\p{N}-…]{1,2}…?$/u.test(t[0])) segs[0].text = '…';
}

/** Το κείμενο μιας γραμμής: κενό μόνο όπου τα κομμάτια απέχουν (το γράμμα του κομματιού κολλά στο τετράγωνο). */
function joinSegs(segs: Seg[], size: number, role: (font: string, text: string) => FontRole): Run[] {
  const runs: Run[] = [];
  let prevEnd = -Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // σύμβολο αξιολόγησης από εικόνα («11.cxd4±»): ανήκει στην κίνηση πριν από αυτό, κολλητά, με τον ρόλο της
    if (s.font === SYMBOL_FONT && runs.length && s.x - prevEnd < 0.8 * size) {
      runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '') + s.text;
      prevEnd = s.end;
      continue;
    }
    let r = role(s.font, s.text);
    // σύμβολο κομματιού που βγήκε «σκουπίδι» σε άλλη γραμματοσειρά από το τετράγωνο («'ii'» + «e2»): ανήκει στην
    // κίνηση που ακολουθεί κολλητά
    const nextSeg = segs[i + 1];
    if (r !== 'piece' && nextSeg && GLYPH_SEG.test(s.text) && /[iIlLtJDrW�:*@%>]/.test(s.text) && /^x?[a-h]/.test(nextSeg.text) && nextSeg.x - s.end < 0.3 * size) {
      r = role(nextSeg.font, nextSeg.text);
    }
    // το γράμμα/σύμβολο κομματιού παίρνει τον ρόλο του επόμενου (ή του προηγούμενου) κομματιού της γραμμής
    if (r === 'piece') {
      const next = segs.slice(i + 1).find((q) => role(q.font, q.text) !== 'piece');
      const prev = [...segs.slice(0, i)].reverse().find((q) => role(q.font, q.text) !== 'piece');
      r = next ? role(next.font, next.text) : prev ? role(prev.font, prev.text) : 'prose';
    }
    // αριθμός κίνησης πριν από κίνηση της κύριας γραμμής, σε σελίδα από εικόνα («6» χωριστά από το «♘d4 d5», ή «3» +
    // «…» + «f5»): το πάχος ενός μόνου ψηφίου δεν μετριέται καλά, και χωρίς αυτό η κύρια γραμμή κοβόταν εκεί
    if (r === 'prose' && s.font.startsWith('ocr') && /^\d{1,3}\.?$/.test(s.text.trim())) {
      const after = segs.slice(i + 1).find((q) => !/^[\s•·.…]+$/.test(q.text));
      const ar = after ? role(after.font, after.text) : 'prose';
      if (ar === 'main' || ar === 'top') r = ar;
    }
    // «• • •» της κύριας γραμμής σε άλλη γραμματοσειρά (βιβλία από OCR: «8• • •c6»): μένει με την κίνηση
    if (r !== 'main' && r !== 'top' && /^[\s•·.…]+$/.test(s.text) && runs[runs.length - 1]?.main) r = runs[runs.length - 1].top ? 'top' : 'main';
    const gap = s.x - prevEnd;
    // σαχ/σύμβολο κολλητά μετά από κίνηση, σε άλλη γραμματοσειρά («¦e1» + «†»): μένει με την κίνηση
    const tail = runs.length && gap < 0.3 * size ? /^[†‡+#!?]+/.exec(s.text) : null;
    if (tail) runs[runs.length - 1].text += tail[0];
    const segText = tail ? s.text.slice(tail[0].length) : s.text;
    const space = runs.length > 0 && gap > 0.18 * size && !/\s$/.test(runs[runs.length - 1].text) && !/^\s/.test(s.text);
    const main = r === 'main' || r === 'top';
    const top = r === 'top';
    const text = (space ? ' ' : '') + segText;
    const last = runs[runs.length - 1];
    if (!text) {
      prevEnd = s.end;
      continue;
    }
    if (last && last.main === main && Boolean(last.top) === top) last.text += text;
    else runs.push(top ? { text, main, top } : { text, main });
    prevEnd = s.end;
  }
  return runs;
}

/**
 * Οι ρόλοι των γραμματοσειρών από τη χρήση τους: η πιο συχνή είναι το κείμενο· όσες έχουν σχεδόν μόνο ένα
 * γράμμα ή σύμβολο ανά κομμάτι είναι τα κομμάτια (figurines)· όσες γράφουν κυρίως κινήσεις είναι η κύρια
 * γραμμή· όσες εμφανίζονται κυρίως σε γραμμές «Position after»/«Diagram» είναι λεζάντες.
 */
export function fontRoles(lines: Line[]): Record<string, FontRole> {
  const st = new Map<string, { chars: number; items: number; single: number; tokens: number; moves: number; caption: number; numbers: number }>();
  for (const l of lines) {
    const lineText = l.segs.map((s) => s.text).join('');
    const isCaption = /^\s*(position after|(analysis )?diagram|θέση μετά|stellung nach|диаграмма)/i.test(lineText);
    for (const s of l.segs) {
      let f = st.get(s.font);
      if (!f) st.set(s.font, (f = { chars: 0, items: 0, single: 0, tokens: 0, moves: 0, caption: 0, numbers: 0 }));
      f.chars += s.text.length;
      f.items++;
      if (s.text.trim().length <= 2 && !/^\d+\.?$/.test(s.text.trim())) f.single++;
      if (/^\s*\d+\s*$/.test(s.text)) f.numbers++;
      if (isCaption) f.caption++;
      for (const t of s.text.split(/\s+/).filter(Boolean)) {
        f.tokens++;
        if (MOVE_RE.test(t.replace(/[.,;:)\]]+$/, '')) || OCR_MOVE_RE.test(t.replace(/[.,;:)\]]+$/, '')) || /^\d{1,3}\.(\.\.)?$/.test(t)) f.moves++;
      }
    }
  }
  const prose = [...st.entries()].sort((a, b) => b[1].chars - a[1].chars)[0]?.[0];
  const roles: Record<string, FontRole> = {};
  for (const [font, f] of st) {
    if (font === prose) roles[font] = 'prose';
    else if (f.single / f.items >= 0.8) roles[font] = 'piece';
    else if (f.caption / f.items >= 0.6) roles[font] = 'caption';
    else if (f.numbers / f.items >= 0.8) roles[font] = 'other';
    else if (f.tokens && f.moves / f.tokens >= 0.35) roles[font] = 'main';
    else roles[font] = 'prose';
  }
  topLevelFont(lines, roles);
  return roles;
}

/**
 * Δύο επίπεδα κύριας γραμμής: η γραμμή του κεφαλαίου σε δική της γραμματοσειρά, σε γραμμές
 * μόνο με κινήσεις («1.e4 e5 2.♘f3 ♘c6 3.♗c4», «3…g6», «4.d4»), και οι κύριες γραμμές των ενοτήτων («E5) 5…♘a5!
 * 6.♗e2») μέσα στο κείμενο. Η πρώτη γίνεται 'top': οι κινήσεις της συνεχίζουν τη γραμμή του κεφαλαίου, όχι την
 * τελευταία ενότητα. Μόνο όταν οι δύο ξεχωρίζουν καθαρά (μόνη της στη γραμμή ≥ 60% / ≤ 35%).
 */
function topLevelFont(lines: Line[], roles: Record<string, FontRole>): void {
  const mains = Object.keys(roles).filter((f) => roles[f] === 'main');
  if (mains.length < 2) return;
  const st = new Map<string, { lines: number; alone: number }>();
  for (const l of lines) {
    const segs = l.segs.filter((s) => s.text.trim() && roles[s.font] !== 'piece');
    const fonts = new Set(segs.map((s) => s.font));
    for (const f of fonts) {
      if (roles[f] !== 'main') continue;
      // μόνο γραμμές με κίνηση αυτής της γραμματοσειράς (όχι τίτλοι κεφαλαίων και λεζάντες)
      const text = segs.filter((s) => s.font === f).map((s) => s.text).join(' ');
      if (!text.split(/\s+/).some((t) => MOVE_RE.test(t.replace(/[.,;:)\]!?]+$/, '')) || /^\d{1,3}\.(\.\.)?\S/.test(t))) continue;
      const a = st.get(f) ?? { lines: 0, alone: 0 };
      a.lines++;
      if (fonts.size === 1) a.alone++;
      st.set(f, a);
    }
  }
  const ratio = (f: string) => {
    const a = st.get(f);
    return a && a.lines ? a.alone / a.lines : 0;
  };
  const ranked = mains.filter((f) => (st.get(f)?.lines ?? 0) >= 10).sort((a, b) => ratio(b) - ratio(a));
  if (ranked.length < 2) return;
  const [top, next] = ranked;
  if (ratio(top) >= 0.6 && ratio(next) <= 0.35 && (st.get(top)?.alone ?? 0) >= 20) roles[top] = 'top';
}

/**
 * Γραμμές σε παραγράφους: νέα παράγραφος όταν το κενό από την προηγούμενη γραμμή είναι μεγάλο, όταν αλλάζει
 * η εσοχή, σε επικεφαλίδες και λεζάντες· έξω μένουν οι αριθμοί σελίδων και οι επαναλαμβανόμενες κεφαλίδες.
 */
export function toParagraphs(lines: Line[], roles: Record<string, FontRole>): Paragraph[] {
  if (!lines.length) return [];
  const all = lines;
  lines = lines.filter((l) => !l.diagram);
  if (!lines.length) return [];
  // βασικό μέγεθος γραμμάτων και αριστερό περιθώριο: τα πιο συχνά
  const mode = (xs: number[]) => {
    const c = new Map<number, number>();
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  const base = mode(lines.map((l) => Math.round(l.size)));
  const left = mode(lines.map((l) => Math.round(l.x)));
  // το δεξί περιθώριο: το πιο συχνό τέλος γραμμής (γραμμές πλήρους πλάτους)
  const endOf = (l: Line) => l.segs[l.segs.length - 1].end;
  const right = mode(lines.map((l) => Math.round(endOf(l))));
  const centered = (l: Line) => !l.diagram && l.x - left > 3 * base && Math.abs(l.x - left - (right - endOf(l))) < 1.5 * base;
  // κεφαλίδες/υποσέλιδα που επαναλαμβάνονται σε πολλές σελίδες
  const pages = new Set(lines.map((l) => l.page)).size;
  const textOf = (l: Line) => l.segs.map((s) => s.text).join('').trim();
  // μόνο η πάνω και η κάτω γραμμή κάθε σελίδας: αλλιώς γραμμές με μία κίνηση («5 ... d6» → «# ... d#»)
  // μοιάζουν μεταξύ τους και χάνονταν ως κεφαλίδες (βιβλία με μία κίνηση ανά γραμμή)
  const top = new Map<number, number>();
  const bottom = new Map<number, number>();
  for (const l of lines) {
    top.set(l.page, Math.max(top.get(l.page) ?? -Infinity, l.y));
    bottom.set(l.page, Math.min(bottom.get(l.page) ?? Infinity, l.y));
  }
  const edge = (l: Line) => l.y >= top.get(l.page)! - 1 || l.y <= bottom.get(l.page)! + 1;
  const repeated = new Map<string, number>();
  for (const l of lines) if (edge(l)) repeated.set(textOf(l).replace(/\d+/g, '#'), (repeated.get(textOf(l).replace(/\d+/g, '#')) ?? 0) + 1);
  // κεφαλίδα με τον αριθμό της σελίδας, και σε λίγες σελίδες («Solutions to Advanced Exercises 351», «348 Chapter
  // Title» στις ζυγές): ο αριθμός απέχει πάντα το ίδιο από τη σελίδα του PDF
  const folio = (l: Line) => {
    const t = textOf(l);
    const m = /^(\d{1,4})(?=\D)|(?<=\D)(\d{1,4})$/.exec(t);
    const key = t.replace(/\d+/g, '#');
    return m && t.length < 80 && /\p{L}{3}/u.test(key) ? `${key}|${Number(m[1] ?? m[2]) - l.page}` : null;
  };
  const folios = new Map<string, number>();
  for (const l of lines) {
    const k = edge(l) ? folio(l) : null;
    if (k) folios.set(k, (folios.get(k) ?? 0) + 1);
  }
  // κεφαλίδα με κείμενο που αλλάζει (όνομα παρτίδας ή κεφαλαίου: «GAME 2: A. KHALIFMAN – E. SVESHNIKOV 17»): ο αριθμός
  // της απέχει από τη σελίδα του PDF όσο σε όλο το βιβλίο (η ίδια απόσταση στο 30% των σελίδων τουλάχιστον)
  const folioOff = (l: Line): number | null => {
    const t = textOf(l);
    const m = /^(\d{1,4})(?=\D)|(?<=\D)(\d{1,4})$/.exec(t);
    return m && t.length < 80 && (t.match(/\p{L}{3,}/gu)?.length ?? 0) >= 2 ? Number(m[1] ?? m[2]) - l.page : null;
  };
  const offs = new Map<number, Set<number>>();
  for (const l of lines) {
    const o = edge(l) ? folioOff(l) : null;
    if (o === null) continue;
    if (!offs.has(o)) offs.set(o, new Set());
    offs.get(o)!.add(l.page);
  }
  let usualOff: number | null = null;
  for (const [o, ps] of offs) if (ps.size >= Math.max(4, pages * 0.3) && (usualOff === null || ps.size > offs.get(usualOff)!.size)) usualOff = o;
  // και η ίδια κεφαλίδα μισή (ο αναγνώστης εικόνας δεν βρήκε το υπόλοιπο: «GAME 1: A. CHERNIN»)
  const headerKeys = new Set<string>();
  for (const l of lines) {
    if (!edge(l)) continue;
    if ((folios.get(folio(l) ?? '') ?? 0) >= 3 || (usualOff !== null && folioOff(l) === usualOff)) headerKeys.add(textOf(l).replace(/\d+/g, '#'));
  }
  const halfHeader = (t: string) => {
    const key = t.replace(/\d+/g, '#');
    if (key.length < 10 || !/\p{L}{3}/u.test(key)) return false;
    for (const h of headerKeys) if (h.length > key.length && h.startsWith(key)) return true;
    return false;
  };
  // κεφαλίδα που αλλάζει ανά μέρος του βιβλίου, χωρίς αριθμό σελίδας (οι κινήσεις του μέρους, «1.e4 c5
  // 2.♘f3 e6» πάνω από την αριστερή στήλη και «3.d4 cd4 4.♘d4 …» πάνω από τη δεξιά): η ίδια πάνω γραμμή σε τρεις σελίδες
  // τουλάχιστον. Μόνο σε σελίδες από εικόνα (στα ψηφιακά αρκούν οι κανόνες πιο πάνω)· τα σύμβολα κομματιών όλα ίδια,
  // γιατί η ομάδα σχήματος του ίδιου κομματιού αλλάζει από σελίδα σε σελίδα.
  const scannedLine = (l: Line) => l.segs.every((s) => s.font.startsWith('ocr'));
  const topKey = (l: Line) => textOf(l).replace(/[-]/g, '').replace(/\s+/g, '');
  const topPages = new Map<string, Set<number>>();
  for (const l of lines) {
    if (l.y < top.get(l.page)! - 1 || !scannedLine(l)) continue;
    const k = topKey(l);
    // (και σύντομη κεφαλίδα μέρους όπως «1 e4 e5» στις μονές σελίδες: αρκεί που είναι η ίδια στην κορυφή τριών σελίδων)
    if (k.length < 5) continue;
    if (!topPages.has(k)) topPages.set(k, new Set());
    topPages.get(k)!.add(l.page);
  }
  // (μόνο στο ύψος όπου είναι η κεφαλίδα στις περισσότερες σελίδες: ο τίτλος στην αρχή μιας ενότητας, πιο χαμηλά,
  // επαναλαμβάνεται κι αυτός σε κάθε ενότητα του μέρους αλλά είναι κείμενο του βιβλίου)
  const scannedTops = [...top].filter(([p]) => lines.some((l) => l.page === p && scannedLine(l))).map(([, y]) => y).sort((a, b) => a - b);
  const usualTop = scannedTops.length ? scannedTops[scannedTops.length >> 1] : 0;
  // το συνηθισμένο μέγεθος κάθε σελίδας από εικόνα: ο αναγνώστης μετρά τα μεγέθη στην κλίμακα της εικόνας της σελίδας, που
  // αλλάζει από σελίδα σε σελίδα· με τη βάση όλου του βιβλίου, σε μια σελίδα 15% μεγαλύτερη κάθε γραμμή με έντονη λέξη
  // γινόταν επικεφαλίδα και οι λύσεις έσπαγαν σε κομμάτια
  const pageBase = new Map<number, number>();
  {
    const by = new Map<number, number[]>();
    for (const l of lines) if (scannedLine(l)) (by.get(l.page) ?? by.set(l.page, []).get(l.page)!).push(Math.round(l.size * 10) / 10);
    for (const [pg, xs] of by) if (xs.length >= 5) pageBase.set(pg, mode(xs));
  }
  const runningTop = (l: Line) => scannedLine(l) && l.y >= top.get(l.page)! - 1 && l.y >= usualTop - 1.5 * base && (topPages.get(topKey(l))?.size ?? 0) >= 3;
  // (σελίδες από εικόνα με έντονα: η κύρια γραμμή φαίνεται από το πάχος, όχι από το σχήμα της γραμμής)
  const ppBold =Object.keys(roles).some((f) => f.startsWith('ocr-') && (roles[f] === 'main' || roles[f] === 'top'));
  const role = (font: string, text: string): FontRole => (roles[font] === 'piece' && text.trim().length > 2 ? 'prose' : (roles[font] ?? 'prose'));
  // σελίδες από εικόνα, βιβλία με μία κίνηση ανά γραμμή: ο αριθμός, η κίνηση του
  // Λευκού και η κίνηση του Μαύρου είναι πάντα στο ίδιο x. Από εκεί σώζονται: γραμμή-κίνηση που δεν βγήκε έντονη (το
  // πάχος δύο λεπτών γραμμάτων, «♖e1», δεν μετριέται πάντα) και κίνηση του Μαύρου που έμεινε μόνη της («c5» από το
  // «1 … c5»: ο εντοπισμός γραμμών δεν είδε ούτε τον αριθμό ούτε τις κουκκίδες).
  const isMain = (s: Seg) => role(s.font, s.text) === 'main' || role(s.font, s.text) === 'top';
  const rowText = (l: Line) => l.segs.map((s) => s.text.trim()).join(' ');
  const pageLeft = new Map<number, number>();
  let moveIndent: number | null = null;
  let whiteX: number | null = null;
  let blackX: number | null = null;
  if (ppBold) {
    const xs = new Map<number, number[]>();
    for (const l of lines) {
      if (!xs.has(l.page)) xs.set(l.page, []);
      xs.get(l.page)!.push(Math.round(l.x));
    }
    for (const [p, v] of xs) pageLeft.set(p, mode(v));
    const usualOf = (v: number[]): number | null => {
      if (v.length < 20) return null;
      const m = mode(v.map((x) => Math.round(x / 4)));
      return v.filter((x) => Math.abs(Math.round(x / 4) - m) <= 1).length >= v.length * 0.6 ? m * 4 : null;
    };
    const starts: number[] = [];
    const white: number[] = [];
    const black: number[] = [];
    for (const l of lines) {
      if (!l.segs.some(isMain) || !PP_MOVE_ROW_RE.test(rowText(l))) continue;
      const off = pageLeft.get(l.page)!;
      starts.push(l.x - off);
      // (οι θέσεις των κινήσεων από τον αριθμό της γραμμής τους: η σελίδα μπορεί να είναι σκαναρισμένη λοξά)
      // (από το τέλος του αριθμού: ο αριθμός αρχίζει πάντα στο ίδιο x και η κίνηση ακολουθεί, άρα με δύο ψηφία πάει
      // δεξιότερα· και από τα κομμάτια, όχι τη γραμμή: στη δεξιά στήλη μόνο το x της γραμμής είναι μετατοπισμένο)
      if (l.segs.length === 3 && /^[.…\s]+$/.test(l.segs[1].text)) black.push(l.segs[2].x - l.segs[0].end);
      else if (l.segs.length === 2) white.push(l.segs[1].x - l.segs[0].end);
    }
    moveIndent = usualOf(starts);
    if (moveIndent !== null && moveIndent < 2 * base) moveIndent = null;
    whiteX = usualOf(white);
    blackX = usualOf(black);
  }
  /** ο αριθμός της τελευταίας γραμμής-κίνησης της παρτίδας: σελίδα και x */
  let lastNum: { page: number; x: number; end: number; num: string; white: boolean } | null = null;
  // σελίδα από εικόνα: τίτλος με κεφαλαία σε έντονα ή βαριά γράμματα στο μέγεθος του κειμένου («QUICK REPERTOIRE»,
  // «COMPLETE GAMES»: το μέγεθος δεν τον ξεχωρίζει)
  const capsLine = (l: Line) => ppBold && !l.diagram && l.segs.every((s) => /^ocr-[bh]$/.test(s.font)) && /^[\p{Lu}\d\s.,:'’&–-]{4,40}$/u.test(textOf(l)) && /\p{Lu}{4}/u.test(textOf(l));
  // τίτλος ενότητας στην κορυφή σελίδας από εικόνα («1.e4 c5 2.♘f3 e6 3.d4 cd4» / «4.♘d4 ♘c6 5.♘b5 d6
  // 6.♗f4 e5» / «QUICK REPERTOIRE», πάνω δεξιά): οι κινήσεις του μέρους και από κάτω ο τίτλος με κεφαλαία. Η διάταξη σε
  // στήλες τον βάζει στην αρχή της δεξιάς στήλης, δηλαδή μετά από όλο το κείμενο της αριστερής. Πάει στην αρχή της
  // σελίδας, ο τίτλος πρώτος (από αυτόν ξεκινά η νέα ενότητα) και μετά οι κινήσεις της.
  let seq = all;
  if (ppBold) {
    for (let k = 0; k < seq.length; k++) {
      const h = seq[k];
      if (!capsLine(h) || h.y < top.get(h.page)! - 9 * base) continue;
      // οι έντονες γραμμές με κινήσεις ακριβώς από πάνω του (ως 6: «Part 11 1.e4 c5 2.♘f3 e6 rare lines» / «3.b4» /
      // «3.b3» / «3.c4» / «3.♘c3»· ένα διάγραμμα ανάμεσα δεν μετρά)
      const block: number[] = [];
      let below = h;
      for (let j = k - 1; j >= 0 && block.length < 6; j--) {
        const l = seq[j];
        if (l.page !== h.page) break;
        if (l.diagram) continue;
        if (!l.segs.every(isMain) || !/\d\.\s?\S/.test(textOf(l)) || l.y <= below.y || l.y - below.y > 2.6 * base) break;
        block.unshift(j);
        below = l;
      }
      if (!block.length) continue;
      const first = seq.findIndex((l) => l.page === h.page);
      const rest = seq.filter((_, j) => j !== k && !block.includes(j));
      rest.splice(first, 0, h, ...block.map((j) => seq[j]));
      seq = rest;
    }
  }
  const out: Paragraph[] = [];
  let cur: Paragraph | null = null;
  let prev: Line | null = null;
  // η εσοχή της τελευταίας γραμμής της παραγράφου (η πρώτη έχει συχνά δική της εσοχή)
  let lastIndent = 0;
  for (const l of seq) {
    if (l.diagram) {
      cur = { page: l.page, indent: 0, heading: false, caption: false, runs: [], text: '', diagram: l.diagram };
      out.push(cur);
      prev = l;
      continue;
    }
    if (ppBold) {
      fixDotRow(l.segs);
      // κίνηση του Μαύρου χωρίς τον αριθμό της, αμέσως μετά από γραμμή με κίνηση του Λευκού μόνο: παίρνει τον αριθμό
      // εκείνης. Μόνη της στη θέση των κινήσεων του Μαύρου («c5» → «1 … c5»), ή με τις κουκκίδες της («… exd5»).
      const before = lastNum && lastNum.page === l.page && lastNum.white ? lastNum : null;
      if (before && l.segs.length === 1 && blackX !== null && isMain(l.segs[0]) && PP_MOVE_RE.test(l.segs[0].text.trim())) {
        const off = l.x - before.end;
        if (Math.abs(off - blackX) <= 4 && (whiteX === null || Math.abs(off - whiteX) > 6)) l.segs[0].text = `${before.num} … ${l.segs[0].text.trim()}`;
      } else if (before && l.segs.length === 2 && l.segs[0].text.trim() === '…' && PP_MOVE_RE.test(l.segs[1].text.trim())) {
        l.segs[0].text = `${before.num} …`;
      }
    }
    const t = textOf(l);
    if (!t) continue;
    // αριθμός σελίδας ή κεφαλίδα που επαναλαμβάνεται
    if (/^\d{1,4}$/.test(t) || (pages > 8 && edge(l) && (repeated.get(t.replace(/\d+/g, '#')) ?? 0) > pages * 0.3 && t.length < 80)) continue;
    if (edge(l) && (folios.get(folio(l) ?? '') ?? 0) >= 3) continue;
    if (usualOff !== null && edge(l) && folioOff(l) === usualOff) continue;
    if (edge(l) && l.y >= top.get(l.page)! - 1 && halfHeader(t)) continue;
    if (runningTop(l)) continue;
    // (στο OCR το μέγεθος βγαίνει από τα πλαίσια των λέξεων, άρα θέλει περισσότερη διαφορά)
    const heading = capsLine(l) || l.size > (scannedLine(l) ? Math.max(base, pageBase.get(l.page) ?? base) : base) * (l.segs.every((s) => s.font === 'ocr') ? 1.35 : 1.12);
    // γραμμή μόνο με σύμβολα-εικόνες («⩲» που έπεσε στην επόμενη γραμμή μετά το «15.♕xa7»): συνέχεια της παραγράφου
    const symbolsOnly = l.segs.every((s) => s.font === SYMBOL_FONT || !s.text.trim()) && cur !== null && !cur.diagram && !cur.heading;
    const caption = !symbolsOnly && (l.segs.every((s) => role(s.font, s.text) === 'caption' || roles[s.font] === 'piece') || /^(position after|(analysis )?diagram)\b/i.test(t));
    const indent = Math.round(l.x) - left;
    const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
    // στην αλλαγή σελίδας η παράγραφος συνεχίζει όταν η προηγούμενη δεν τελείωσε (χωρίς τελεία) με το ίδιο στυλ και την ίδια εσοχή
    const runsHere = joinSegs(l.segs, l.size, role);
    const moveLine = (x: Line | null) => !ppBold && x !== null && !x.diagram && x.segs.every((s) => s.font === 'ocr') && OCR_MOVE_LINE_RE.test(textOf(x));
    if (moveLine(l)) for (const r of runsHere) r.main = true;
    // σελίδα από εικόνα: γραμμή μόνο με αριθμό και μία-δύο κινήσεις όπου ένα κομμάτι της βγήκε έντονο είναι όλη κύρια
    // γραμμή (το πάχος μιας μόνης λέξης δύο γραμμάτων, «c6», δεν μετριέται πάντα: «3 … c6» έχανε την κίνηση)
    // (ή καμία έντονη, αλλά με την εσοχή των κινήσεων της παρτίδας)
    const moveRow = ppBold && PP_MOVE_ROW_RE.test(rowText(l));
    const atMoveIndent = moveIndent !== null && (Math.abs(l.x - (pageLeft.get(l.page) ?? left) - moveIndent) <= 5 || (lastNum !== null && lastNum.page === l.page && Math.abs(l.x - lastNum.x) <= 3));
    if (moveRow && (runsHere.some((r) => r.main) || atMoveIndent)) lastNum = { page: l.page, x: l.x, end: l.x + (l.segs[0].end - l.segs[0].x), num: l.segs[0].text.trim(), white: l.segs.length === 2 && /^[0-9]{1,3}$/.test(l.segs[0].text.trim()) };
    if (moveRow && (runsHere.some((r) => r.main) || atMoveIndent) && runsHere.some((r) => !r.main)) {
      const top = runsHere.some((r) => r.top);
      for (const r of runsHere) {
        r.main = true;
        if (top) r.top = true;
      }
    }
    const carry =
      prev !== null &&
      prev.page !== l.page &&
      cur !== null &&
      !cur.heading &&
      !cur.caption &&
      (Math.abs(Math.round(l.x) - left - cur.indent) <= 4 || Math.abs(Math.round(l.x) - left - lastIndent) <= 4) &&
      !/[.:!?\]]\s*$/.test(cur.runs.map((r) => r.text).join('')) &&
      (cur.runs[cur.runs.length - 1]?.main ?? false) === (runsHere.find((r) => r.text.trim())?.main ?? false) &&
      !/^[A-Za-z]{1,2}\d{0,2}(?:\.\d{1,2}){0,3}\)/.test(t);
    const newPara =
      !symbolsOnly &&
      (!cur ||
      Boolean(cur.diagram) ||
      centered(l) ||
      (prev !== null && centered(prev)) ||
      moveLine(l) ||
      moveLine(prev) ||
      // σελίδα από εικόνα: ενότητα με ετικέτα και τελεία («A. 8.a3», «B1. 11.f4»), και οι γραμμές του
      // καταλόγου των ενοτήτων πριν από αυτήν («A. 8.a3 – page 79»)
      (ppBold && /^[A-Z]\d{0,2}[a-z]?\.\s*\d{1,3}\.\S/.test(t)) ||
      // αρχή λύσης ή παρτίδας: «859. Laurent Fressinet – Vladimir Kramnik, Paris 2016»
      /^\d{1,4}[.)]\s+\p{Lu}[^\d]{0,60}?\s[–—-]\s\p{Lu}/u.test(t) ||
      heading ||
      caption ||
      cur.heading ||
      cur.caption ||
      (gap > 1.55 * Math.max(base, prev?.size ?? base) && !carry) ||
      (prev !== null && prev.page !== l.page && /^[A-Za-z]{1,2}\d{0,2}(?:\.\d{1,2}){0,3}\)\s/.test(t)) ||
      (Math.abs(indent - cur.indent) > 4 && /^[A-Za-z]{1,2}\d{0,2}(?:\.\d{1,2}){0,3}\)/.test(t)));
    const runs = runsHere;
    if (newPara) {
      cur = { page: l.page, indent, heading, caption, runs: [], text: '', ...(centered(l) ? { centered: true } : {}) };
      out.push(cur);
    } else if (cur && cur.runs.length) {
      // συνέχεια της παραγράφου στην επόμενη γραμμή: κενό, ή ένωση λέξης που κόπηκε με παύλα
      const last = cur.runs[cur.runs.length - 1];
      const next = runs.find((r) => r.text.trim())?.text.trimStart() ?? '';
      if (/\S-$/.test(last.text) && (/(?:^|[^\p{L}])\p{L}-$|\d-$/u.test(last.text) || /^\p{Lu}/u.test(next) || (/(?:^|[\s.…])[0O]-(?:[0O]-)?$/.test(last.text) && /^[0O]/.test(next)))) {
        // η παύλα μένει, χωρίς κενό: «d-» «pawn», «f1-» «bishop», «e7-» «e5», «Vasiukov-» «Gheorghiu», το ροκέ «10.0-» «0»
      } else if (/[a-zα-ω]-$/i.test(last.text) && /^[a-zα-ω]/.test(next)) last.text = last.text.slice(0, -1);
      else if (!/\s$/.test(last.text)) last.text += ' ';
      (cur.lineStarts ??= []).push(cur.runs.reduce((n, r) => n + r.text.length, 0));
    }
    for (const r of runs) {
      const last = cur!.runs[cur!.runs.length - 1];
      if (last && last.main === r.main && Boolean(last.top) === Boolean(r.top)) last.text += r.text;
      else cur!.runs.push({ ...r });
    }
    lastIndent = indent;
    prev = l;
  }
  for (const p of out) p.text = p.runs.map((r) => r.text).join('');
  return out;
}

/** Ολόκληρο το βιβλίο σε παραγράφους. */
export async function readPdfBook(file: string, opts: ReadOptions = {}): Promise<PdfBook> {
  const { title, author, pages, lines, ocrPages, boards } = await readPdfLines(file, opts);
  const fonts = fontRoles(lines);
  return { title, author, pages, paragraphs: toParagraphs(lines, fonts), fonts, ocrPages, boards };
}

/** Ένα ορθογώνιο της εικόνας (μέσα στα όριά της). */
function cropGray(img: Gray, x0: number, y0: number, x1: number, y1: number): Gray {
  const a = Math.max(0, Math.floor(x0));
  const b = Math.max(0, Math.floor(y0));
  const w = Math.max(1, Math.min(img.w, Math.ceil(x1)) - a);
  const h = Math.max(1, Math.min(img.h, Math.ceil(y1)) - b);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) px.set(img.px.subarray((b + y) * img.w + a, (b + y) * img.w + a + w), y * w);
  return { w, h, px };
}
