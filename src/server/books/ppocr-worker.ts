/**
 * Η διεργασία του αναγνώστη (βλ. `ppocr.ts`): φορτώνει το onnxruntime και τα δύο μοντέλα του PP-OCRv6 από το πακέτο και
 * διαβάζει μία σελίδα ανά μήνυμα: εντοπισμός γραμμών (det), ανάγνωση κάθε γραμμής (rec) με θέση και σιγουριά ανά
 * χαρακτήρα, και οι γλύφοι και τα υποψήφια σύμβολα κομματιών της (`figurines.ts`).
 *
 * Προεπεξεργασία όπως στο PaddleX (inference.yml): rec ύψος 48, (x/255 − 0,5)/0,5, γέμισμα δεξιά· det πλευρές
 * πολλαπλάσια του 32, μέσος/απόκλιση του ImageNet, κατώφλι χάρτη 0,2, πλαισίου 0,45, διεύρυνση 1,4. Τα βιβλία είναι
 * ίσια, άρα τα πλαίσια των γραμμών είναι παράλληλα στους άξονες.
 *
 * Τελειώνει μόνο όταν τη σκοτώσει ο server (ή όταν χαθεί η σύνδεση μαζί του): ΠΟΤΕ με process.exit, γιατί με φορτωμένο
 * το onnxruntime η έξοδος κόλλησε τη διεργασία (έμεινε με ένα νήμα σε αναμονή και δεν τερματιζόταν ούτε με taskkill).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { analyseLine, isDotLine, moveDots, type Box, type Cand, type PLine, type RecChar } from './figurines.ts';
import { resize, type Gray } from './vision.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ort = any;

interface Init {
  runtime: string;
  det: string;
  rec: string;
  dict: string;
  threads: number;
  /** η μεγαλύτερη πλευρά της εικόνας στον εντοπισμό γραμμών */
  detSide: number;
}

const die = (): never => {
  process.kill(process.pid, 'SIGKILL');
  throw new Error('unreachable');
};

/** Το λεξικό χαρακτήρων από το inference.yml του μοντέλου (λίστα YAML `character_dict`). */
export function loadDict(yml: string): string[] {
  const lines = fs.readFileSync(yml, 'utf8').split(/\r?\n/);
  const i0 = lines.findIndex((l) => /^\s*character_dict:/.test(l));
  const out: string[] = [];
  for (let i = i0 + 1; i < lines.length; i++) {
    const m = /^\s*-(?: (.*))?$/.exec(lines[i]);
    if (!m) break;
    let s = m[1] ?? '';
    if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) s = s.slice(1, -1).replace(/''/g, "'");
    else if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      s = JSON.parse(
        s
          .replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')
          .replace(/\\U([0-9a-fA-F]{8})/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/\\N/g, '\\u0085')
          .replace(/\\_/g, '\\u00a0')
          .replace(/\\L/g, '\\u2028')
          .replace(/\\P/g, '\\u2029')
          .replace(/\\e/g, '\\u001b')
          .replace(/\\a/g, '\\u0007')
          .replace(/\\0/g, '\\u0000')
          .replace(/\\v/g, '\\u000b'),
      ) as string;
    }
    out.push(s);
  }
  // (θέση 0: το «κενό» του CTC· στο τέλος το διάστημα)
  return ['', ...out, ' '];
}

function crop(img: Gray, b: Box): Gray {
  const w = Math.max(1, b.x1 - b.x0);
  const h = Math.max(1, b.y1 - b.y0);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) px.set(img.px.subarray((b.y0 + y) * img.w + b.x0, (b.y0 + y) * img.w + b.x0 + w), y * w);
  return { w, h, px };
}

/** Πλαίσια γραμμών κειμένου: συνδεδεμένες περιοχές του χάρτη πιθανότητας, διευρυμένες. */
async function findLines(ort: Ort, s: Ort, img: Gray, side: number): Promise<Box[]> {
  const k = Math.min(1, side / Math.max(img.w, img.h));
  const W = Math.max(32, Math.round((img.w * k) / 32) * 32);
  const H = Math.max(32, Math.round((img.h * k) / 32) * 32);
  const r = W === img.w && H === img.h ? img : resize(img, W, H);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const data = new Float32Array(3 * H * W);
  for (let c = 0; c < 3; c++) for (let i = 0; i < H * W; i++) data[c * H * W + i] = (r.px[i] / 255 - mean[c]) / std[c];
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, H, W]) });
  const pr = out[s.outputNames[0]].data as Float32Array;
  const thresh = 0.2;
  const lab = new Uint8Array(H * W);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let i = 0; i < H * W; i++) {
    if (lab[i] || pr[i] <= thresh) continue;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    let sum = 0;
    let n = 0;
    lab[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      const y = (j - x) / W;
      sum += pr[j];
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !lab[j - 1] && pr[j - 1] > thresh) (lab[j - 1] = 1), stack.push(j - 1);
      if (x < W - 1 && !lab[j + 1] && pr[j + 1] > thresh) (lab[j + 1] = 1), stack.push(j + 1);
      if (y > 0 && !lab[j - W] && pr[j - W] > thresh) (lab[j - W] = 1), stack.push(j - W);
      if (y < H - 1 && !lab[j + W] && pr[j + W] > thresh) (lab[j + W] = 1), stack.push(j + W);
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3 || sum / n < 0.45) continue;
    const grow = (bw * bh * 1.4) / (2 * (bw + bh));
    const sx = img.w / W;
    const sy = img.h / H;
    boxes.push({
      x0: Math.max(0, Math.floor((x0 - grow) * sx)),
      y0: Math.max(0, Math.floor((y0 - grow) * sy)),
      x1: Math.min(img.w, Math.ceil((x1 + 1 + grow) * sx)),
      y1: Math.min(img.h, Math.ceil((y1 + 1 + grow) * sy)),
    });
  }
  return boxes;
}

/** Μία γραμμή κειμένου (απόκομμα): οι χαρακτήρες με τη θέση (0..1 του πλάτους) και τη σιγουριά τους. */
async function readLine(ort: Ort, s: Ort, dict: string[], img: Gray): Promise<RecChar[]> {
  const H = 48;
  const rw = Math.min(3200, Math.max(1, Math.ceil((H * img.w) / img.h)));
  const W = Math.max(320, rw);
  const r = img.h === H && img.w === rw ? img : resize(img, rw, H);
  const data = new Float32Array(3 * H * W);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < rw; x++) {
      const v = (r.px[y * rw + x] / 255 - 0.5) / 0.5;
      data[y * W + x] = v;
      data[H * W + y * W + x] = v;
      data[2 * H * W + y * W + x] = v;
    }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, H, W]) });
  const o = out[s.outputNames[0]];
  const [, T, C] = o.dims as number[];
  if (C !== dict.length) throw new Error(`Το λεξικό του μοντέλου δεν ταιριάζει (${dict.length} ≠ ${C})`);
  const d = o.data as Float32Array;
  const chars: RecChar[] = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bp = -1;
    const off = t * C;
    for (let c = 0; c < C; c++) {
      if (d[off + c] > bp) {
        bp = d[off + c];
        best = c;
      }
    }
    if (best !== 0 && best !== prev) chars.push({ ch: dict[best], x: Math.min(1, ((t + 0.5) / T) * (W / rw)), p: bp });
    prev = best;
  }
  return chars;
}

let ort: Ort = null;
let det: Ort = null;
let rec: Ort = null;
let dict: string[] = [];
let detSide = 1600;

async function init(m: Init): Promise<void> {
  ort = createRequire(import.meta.url)(m.runtime);
  const opts = { intraOpNumThreads: m.threads, interOpNumThreads: 1, logSeverityLevel: 3 };
  det = await ort.InferenceSession.create(m.det, opts);
  rec = await ort.InferenceSession.create(m.rec, opts);
  dict = loadDict(m.dict);
  detSide = m.detSide;
}

async function readPage(page: number, img: Gray): Promise<{ lines: PLine[]; cands: Cand[] }> {
  const lines: PLine[] = [];
  const cands: Cand[] = [];
  for (const box of await findLines(ort, det, img, detSide)) {
    if (box.y1 - box.y0 < 12 || box.x1 - box.x0 < 4) continue;
    const c = crop(img, box);
    const chars = await readLine(ort, rec, dict, c);
    if (!chars.length) continue;
    const res = analyseLine(c, chars, box, c.h / 1.05, page, lines.length);
    // κουκκίδες μόνες τους («3 … f5»): το μοντέλο τις διαβάζει «..», «●» ή «…»
    if (isDotLine(res.l)) res.l.chars.splice(0, res.l.chars.length, { ch: '…', x: 0.5, p: 1 });
    lines.push(res.l);
    cands.push(...res.cands);
  }
  // και όσες δεν βρήκε καθόλου ο εντοπισμός
  lines.push(...moveDots(img, lines, page));
  return { lines, cands };
}

if (process.send) {
  let queue: Promise<void> = Promise.resolve();
  process.on('message', (m: { id: number; init?: Init; page?: number; w?: number; h?: number; px?: Uint8Array }) => {
    queue = queue.then(async () => {
      try {
        if (m.init) {
          await init(m.init);
          process.send!({ id: m.id });
        } else {
          const t0 = Date.now();
          const res = await readPage(m.page!, { w: m.w!, h: m.h!, px: m.px! });
          process.send!({ id: m.id, ...res, ms: Date.now() - t0 });
        }
      } catch (e) {
        process.send!({ id: m.id, error: (e as Error).message });
      }
    });
  });
  // ο server έκλεισε: άμεσος τερματισμός (όχι έξοδος, βλ. πάνω)
  process.on('disconnect', die);
}
