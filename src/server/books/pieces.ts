/**
 * Τα κομμάτια στα διαγράμματα-εικόνες ενός βιβλίου. Σε ένα βιβλίο όλα τα διαγράμματα έχουν την ίδια γραμματοσειρά,
 * άρα το ίδιο κομμάτι στο ίδιο χρώμα τετραγώνου μοιάζει σχεδόν ίδιο παντού: τα τετράγωνα με κομμάτι ομαδοποιούνται
 * και κάθε ομάδα παίρνει όνομα από τη μέση εικόνα της (πολύ πιο καθαρή από ένα τετράγωνο):
 * - χρώμα: πόσο μαύρο έχει η σιλουέτα (τα μαύρα κομμάτια είναι γεμάτα), με κατώφλι από το ίδιο το βιβλίο·
 * - είδος: η σιλουέτα σε σύγκριση με τα κομμάτια Merida της εφαρμογής (`public/pieces/merida`, GPLv2+).
 * Μετά, ένας βασιλιάς ανά χρώμα σε κάθε διάγραμμα, και (`calibrate`) διόρθωση των ομάδων από θέσεις που είναι γνωστές
 * από το κείμενο (το διάγραμμα μέσα σε παρτίδα δείχνει τη θέση μετά τις κινήσεις που προηγήθηκαν).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { altsFit, movesFit, parseBook, placementDiff, swapColors, type BookOptions, type BookParagraph, type BookResult, type DiagramEvidence, type ProbeMove } from '../../core/bookparse.ts';
import { N, type Cell } from './vision.ts';

type Pt = [number, number];

// ---------------------------------------------------------------------------
// SVG (μόνο <path>) σε μάσκα

/** Τα πολύγωνα ενός path του SVG (καμπύλες και τόξα σε ευθύγραμμα τμήματα). */
export function pathPolygons(d: string): Pt[][] {
  const polys: Pt[][] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const num = (): number => {
    skip();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error(`SVG path: αριθμός στη θέση ${i}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number => {
    skip();
    return d[i++] === '1' ? 1 : 0;
  };
  const more = () => {
    skip();
    return i < d.length && /[+\-.\d]/.test(d[i]);
  };
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: Pt | null = null;
  let lastQ: Pt | null = null;
  let cmd = '';
  const close = () => {
    if (cur.length > 2) polys.push(cur);
    cur = [];
  };
  const to = (nx: number, ny: number) => {
    if (!cur.length) cur.push([x, y]);
    cur.push([nx, ny]);
    x = nx;
    y = ny;
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
    const x0 = x;
    const y0 = y;
    for (let k = 1; k <= 10; k++) {
      const t = k / 10;
      const u = 1 - t;
      to(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
    }
    lastC = [x2, y2];
  };
  const quad = (x1: number, y1: number, ex: number, ey: number) => {
    const x0 = x;
    const y0 = y;
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      to(u * u * x0 + 2 * u * t * x1 + t * t * ex, u * u * y0 + 2 * u * t * y1 + t * t * ey);
    }
    lastQ = [x1, y1];
  };
  const arc = (rx: number, ry: number, rot: number, large: number, sweep: number, ex: number, ey: number) => {
    // SVG 1.1, παράρτημα F.6.5: από τα άκρα στο κέντρο
    if (!rx || !ry) return to(ex, ey);
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const phi = (rot * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (x - ex) / 2;
    const dy = (y - ey) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
    const cxp = (co * rx * y1p) / ry;
    const cyp = (-co * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x + ex) / 2;
    const cy = sin * cxp + cos * cyp + (y + ey) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
    for (let k = 1; k <= n; k++) {
      const t = t1 + (dt * k) / n;
      to(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
    }
  };
  while (i < d.length) {
    skip();
    if (i >= d.length) break;
    if (/[A-Za-z]/.test(d[i])) cmd = d[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const C = cmd.toUpperCase();
    const prevC: Pt | null = lastC;
    const prevQ: Pt | null = lastQ;
    lastC = null;
    lastQ = null;
    if (C === 'Z') {
      close();
      x = sx;
      y = sy;
      continue;
    }
    if (C === 'M') {
      close();
      x = ox + num();
      y = oy + num();
      sx = x;
      sy = y;
      cur = [[x, y]];
      // ζεύγη μετά το M είναι γραμμές
      cmd = rel ? 'l' : 'L';
      continue;
    }
    if (C === 'L') to(ox + num(), oy + num());
    else if (C === 'H') to(ox + num(), y);
    else if (C === 'V') to(x, oy + num());
    else if (C === 'C') {
      const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()];
      cubic(a[0], a[1], a[2], a[3], a[4], a[5]);
    } else if (C === 'S') {
      const r: Pt = prevC ? [2 * x - prevC[0], 2 * y - prevC[1]] : [x, y];
      const a = [ox + num(), oy + num(), ox + num(), oy + num()];
      cubic(r[0], r[1], a[0], a[1], a[2], a[3]);
    } else if (C === 'Q') {
      const a = [ox + num(), oy + num(), ox + num(), oy + num()];
      quad(a[0], a[1], a[2], a[3]);
    } else if (C === 'T') {
      const r: Pt = prevQ ? [2 * x - prevQ[0], 2 * y - prevQ[1]] : [x, y];
      quad(r[0], r[1], ox + num(), oy + num());
    } else if (C === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = flag();
      const sweep = flag();
      arc(rx, ry, rot, large, sweep, ox + num(), oy + num());
    } else throw new Error(`SVG path: εντολή ${cmd}`);
    if (!more() && i < d.length && !/[A-Za-z]/.test(d[i])) i++;
  }
  close();
  return polys;
}

/** Γέμισμα πολυγώνων (κανόνας nonzero) σε μάσκα G×G· `scale`: pixel ανά μονάδα του SVG. */
export function fillPolygons(polys: Pt[][], G: number, scale: number): Uint8Array {
  const mask = new Uint8Array(G * G);
  for (let py = 0; py < G; py++) {
    const y = (py + 0.5) / scale;
    const xs: Array<[number, number]> = [];
    for (const poly of polys)
      for (let k = 0; k < poly.length; k++) {
        const [x0, y0] = poly[k];
        const [x1, y1] = poly[(k + 1) % poly.length];
        if (y0 === y1 || y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue;
        xs.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), y1 > y0 ? 1 : -1]);
      }
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      if (!wind) continue;
      for (let px = Math.max(0, Math.ceil(xs[k][0] * scale - 0.5)); px < Math.min(G, Math.ceil(xs[k + 1][0] * scale - 0.5)); px++) mask[py * G + px] = 1;
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// σιλουέτες

const S = 12;

export interface Shape {
  /** η σιλουέτα στο πλαίσιό της, S×S (ποσοστό κάλυψης) */
  sil: Float32Array;
  /** ύψος και πλάτος ως ποσοστό του τετραγώνου */
  h: number;
  w: number;
  /** η κάτω άκρη (ποσοστό του τετραγώνου από πάνω) */
  bottom: number;
}

/** Γέμισμα των τρυπών (ό,τι δεν φτάνεται από τα όρια) και μόνο η μεγαλύτερη περιοχή. */
function solid(mask: Uint8Array, G: number): Uint8Array {
  const out = new Uint8Array(G * G);
  const outside = new Uint8Array(G * G);
  const stack: number[] = [];
  for (let k = 0; k < G; k++)
    for (const idx of [k, (G - 1) * G + k, k * G, k * G + G - 1])
      if (!mask[idx] && !outside[idx]) {
        outside[idx] = 1;
        stack.push(idx);
      }
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % G;
    const y = (k / G) | 0;
    for (const n of [x + 1 < G ? k + 1 : -1, x > 0 ? k - 1 : -1, y + 1 < G ? k + G : -1, y > 0 ? k - G : -1])
      if (n >= 0 && !mask[n] && !outside[n]) {
        outside[n] = 1;
        stack.push(n);
      }
  }
  // η μεγαλύτερη συνεκτική περιοχή (8 γειτόνων) από ό,τι μένει
  const label = new Int32Array(G * G);
  let best = 0;
  let bestN = 0;
  let next = 0;
  for (let k = 0; k < G * G; k++) {
    if (outside[k] || label[k]) continue;
    next++;
    let n = 0;
    const st = [k];
    label[k] = next;
    while (st.length) {
      const c = st.pop()!;
      n++;
      const x = c % G;
      const y = (c / G) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          const m = ny * G + nx;
          if (!outside[m] && !label[m]) {
            label[m] = next;
            st.push(m);
          }
        }
    }
    if (n > bestN) {
      bestN = n;
      best = next;
    }
  }
  for (let k = 0; k < G * G; k++) out[k] = bestN && label[k] === best ? 1 : 0;
  return out;
}

/** Η σιλουέτα μιας μάσκας G×G· `null` αν είναι σχεδόν άδεια. */
export function shapeOf(mask: Uint8Array, G: number): Shape | null {
  const m = solid(mask, G);
  let minX = G;
  let maxX = -1;
  let minY = G;
  let maxY = -1;
  let n = 0;
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++)
      if (m[y * G + x]) {
        n++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  if (n < G * G * 0.03) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const sil = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let s = 0;
      let c = 0;
      for (let yy = minY + Math.floor((y * bh) / S); yy < minY + Math.max(Math.floor((y * bh) / S) + 1, Math.floor(((y + 1) * bh) / S)); yy++)
        for (let xx = minX + Math.floor((x * bw) / S); xx < minX + Math.max(Math.floor((x * bw) / S) + 1, Math.floor(((x + 1) * bw) / S)); xx++, c++) s += m[yy * G + xx];
      sil[y * S + x] = c ? s / c : 0;
    }
  return { sil, h: bh / G, w: bw / G, bottom: (maxY + 1) / G };
}

/** Απόσταση δύο σιλουετών: σχήμα, ύψος, πλάτος. */
export function shapeDistance(a: Shape, b: Shape): number {
  let d = 0;
  for (let k = 0; k < S * S; k++) d += Math.abs(a.sil[k] - b.sil[k]);
  return d / (S * S) + 1.2 * Math.abs(a.h - b.h) + 0.6 * Math.abs(a.w - b.w);
}

let templates: Array<{ type: string; shape: Shape }> | null = null;

/** Οι σιλουέτες των έξι κομματιών από τα SVG Merida (μία φορά). */
export function pieceTemplates(dir = fileURLToPath(new URL('../../../public/pieces/merida/', import.meta.url))): Array<{ type: string; shape: Shape }> {
  if (templates) return templates;
  const G = 64;
  const out: Array<{ type: string; shape: Shape }> = [];
  for (const type of ['K', 'Q', 'R', 'B', 'N', 'P']) {
    const svg = fs.readFileSync(`${dir}/w${type}.svg`, 'utf8');
    const vb = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number) ?? [0, 0, 50, 50];
    const polys = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].flatMap((m) => pathPolygons(m[1])).map((p) => p.map(([x, y]): Pt => [x - vb[0], y - vb[1]]));
    // κάθε περίγραμμα γεμάτο χωριστά (χωρίς τρύπες): η ένωσή τους είναι η σιλουέτα
    const mask = new Uint8Array(G * G);
    for (const poly of polys) fillPolygons([poly], G, G / vb[2]).forEach((v, k) => (mask[k] |= v));
    const shape = shapeOf(mask, G);
    if (shape) out.push({ type, shape });
  }
  templates = out;
  return out;
}

// ---------------------------------------------------------------------------
// ανάγνωση των διαγραμμάτων ενός βιβλίου

/** Κομμάτι στο τετράγωνο (το αποφασίζει η `boardCells`, σε σχέση με τα άλλα τετράγωνα της σκακιέρας). */
const occupied = (c: Cell) => c.occ;

const rms = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2;
  return Math.sqrt(s / a.length);
};

interface Cluster {
  dark: boolean;
  /** η μέση εικόνα των τετραγώνων της ομάδας */
  sharp: Float32Array;
  bg: number;
  n: number;
  /** το κομμάτι (FEN) ή '' για άδειο */
  piece: string;
  /** οι εναλλακτικές με τη σειρά (για τον κανόνα του ενός βασιλιά) */
  ranked: string[];
  /** τα κομμάτια που επιτρέπουν οι καταμετρήσεις (βασιλιάς: ένας ανά διάγραμμα· πιόνι: ποτέ στην 1η/8η γραμμή) */
  allowed: Set<string>;
  /** όνομα από τις καταμετρήσεις (πιόνι, βασιλιάς): το αλλάζουν μόνο γνωστές θέσεις, όχι οι κινήσεις */
  locked?: boolean;
}

export interface BookBoards {
  /** τα τετράγωνα κάθε διαγράμματος (64 το καθένα) */
  boards: Cell[][];
  /** η ομάδα κάθε τετραγώνου (-1 = άδειο) */
  cluster: number[][];
  clusters: Cluster[];
  /** θέσεις που ήρθαν από το πακέτο διαγραμμάτων (`diagramnet.ts`): δεν αλλάζουν από τις ομάδες ούτε από τις κινήσεις */
  fixed?: Map<number, string>;
}

/** Μάσκα του κομματιού από τη μέση «καθαρή» εικόνα μιας ομάδας. */
function clusterShape(c: Cluster): { shape: Shape | null; ink: number } {
  const mask = new Uint8Array(N * N);
  let ink = 0;
  let n = 0;
  for (let k = 0; k < N * N; k++)
    if (Math.abs(c.sharp[k]) > 0.22) {
      mask[k] = 1;
      ink += c.sharp[k] + c.bg;
      n++;
    }
  const shape = shapeOf(mask, N);
  return { shape, ink: n ? ink / n : 0 };
}

/**
 * Πόσο μπορούν να διαφέρουν δύο τετράγωνα με το ίδιο κομμάτι: από την απόσταση κάθε τετραγώνου από το πιο όμοιό του
 * (δείγμα), γιατί ο θόρυβος αλλάζει από βιβλίο σε βιβλίο (καθαρό PDF ή σκανάρισμα 1 bit).
 */
function clusterLimit(boards: Cell[][]): number {
  const occ = boards.flat().filter(occupied);
  if (occ.length < 20) return 0.12;
  const sample = occ.filter((_, i) => i % Math.max(1, Math.floor(occ.length / 300)) === 0);
  const nn = sample.map((a) => {
    let best = Infinity;
    for (const b of occ) if (b !== a && b.dark === a.dark) best = Math.min(best, rms(a.sharp, b.sharp));
    return best;
  });
  const med = [...nn].sort((x, y) => x - y)[nn.length >> 1];
  return Math.max(0.12, Math.min(0.22, med * 2.2));
}

/** Ομαδοποίηση και ονόματα: όλα τα διαγράμματα ενός βιβλίου μαζί. */
export function readBoards(boards: Cell[][]): BookBoards {
  const clusters: Cluster[] = [];
  const limit = clusterLimit(boards);
  const cluster = boards.map((cells) =>
    cells.map((c) => {
      if (!occupied(c)) return -1;
      let best = -1;
      let bestD = Infinity;
      for (let k = 0; k < clusters.length; k++) {
        if (clusters[k].dark !== c.dark) continue;
        const d = rms(clusters[k].sharp, c.sharp);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best >= 0 && bestD < limit) {
        const cl = clusters[best];
        cl.n++;
        for (let k = 0; k < N * N; k++) {
          cl.sharp[k] += (c.sharp[k] - cl.sharp[k]) / cl.n;
        }
        cl.bg += (c.bg - cl.bg) / cl.n;
        return best;
      }
      clusters.push({ dark: c.dark, sharp: Float32Array.from(c.sharp), bg: c.bg, n: 1, piece: '', ranked: [], allowed: new Set() });
      return clusters.length - 1;
    }),
  );
  nameClusters(clusters, cluster);
  return { boards, cluster, clusters };
}

/**
 * Όνομα για κάθε ομάδα: χρώμα από τη μαυρίλα (κατώφλι από το βιβλίο), είδος από τη σιλουέτα, μέσα στα όρια που
 * βάζουν οι καταμετρήσεις: ο βασιλιάς ενός χρώματος είναι οι ομάδες που μαζί εμφανίζονται μία φορά σε κάθε
 * διάγραμμα, το πιο συχνό κομμάτι κάθε χρώματος είναι το πιόνι, και πιόνι δεν υπάρχει στην 1η/8η γραμμή.
 */
function nameClusters(clusters: Cluster[], cluster: number[][]): void {
  const tpl = pieceTemplates();
  const info = clusters.map(clusterShape);
  // καταμετρήσεις: πόσες φορές το πολύ σε ένα διάγραμμα, σε πόσα διαγράμματα, και αν εμφανίζεται στην 1η/8η γραμμή
  // (ανεκτικά: ένα τετράγωνο σε λάθος ομάδα δεν αλλάζει το συμπέρασμα)
  const many = clusters.map(() => 0);
  const twice = clusters.map(() => 0);
  const present = clusters.map(() => new Set<number>());
  const onBack = clusters.map(() => 0);
  cluster.forEach((cells, bi) => {
    const count = new Map<number, number>();
    cells.forEach((k, i) => {
      if (k < 0) return;
      count.set(k, (count.get(k) ?? 0) + 1);
      present[k].add(bi);
      if (i < 8 || i >= 56) onBack[k]++;
    });
    for (const [k, n] of count) {
      if (n > 1) twice[k]++;
      if (n > 2) many[k]++;
    }
  });
  const back = clusters.map((c, k) => onBack[k] > Math.max(1, c.n * 0.03));
  const perBoard = clusters.map((c, k) => (many[k] > Math.max(1, present[k].size * 0.03) ? 3 : twice[k] > Math.max(1, present[k].size * 0.03) ? 2 : 1));
  // το κατώφλι λευκού/μαύρου ανά χρώμα τετραγώνου: δύο ομάδες (k-means) πάνω στη μαυρίλα, με βάρος το πλήθος
  const cut = new Map<boolean, number>();
  for (const dark of [false, true]) {
    const xs = clusters.map((c, k) => ({ v: info[k].ink, n: c.n, dark: c.dark })).filter((x) => x.dark === dark && x.v > 0);
    let lo = 0.3;
    let hi = 0.75;
    for (let it = 0; it < 20; it++) {
      const mid = (lo + hi) / 2;
      const a = xs.filter((x) => x.v <= mid);
      const b = xs.filter((x) => x.v > mid);
      const mean = (ys: typeof xs, d: number) => (ys.length ? ys.reduce((s, y) => s + y.v * y.n, 0) / ys.reduce((s, y) => s + y.n, 0) : d);
      lo = mean(a, lo);
      hi = mean(b, hi);
    }
    cut.set(dark, (lo + hi) / 2);
  }
  const black = clusters.map((c, k) => info[k].ink > cut.get(c.dark)!);
  clusters.forEach((c, k) => {
    const allowed = new Set(['N', 'B', 'R', 'Q', 'K', 'P'].filter((t) => (t === 'K' ? perBoard[k] <= 1 : t === 'P' ? !back[k] : t === 'Q' ? perBoard[k] <= 2 : true)));
    c.allowed = new Set([...allowed].map((t) => (black[k] ? t.toLowerCase() : t)));
    const shape = info[k].shape;
    const order = shape ? tpl.map((t) => ({ t: t.type, d: shapeDistance(shape, t.shape) })).sort((a, b) => a.d - b.d).map((x) => x.t) : ['P', 'N', 'B', 'R', 'Q', 'K'];
    // βασιλιάς μόνο από την κάλυψη πιο κάτω· όσα δεν επιτρέπονται στο τέλος
    const ranked = [...order.filter((t) => allowed.has(t) && t !== 'K'), ...order.filter((t) => !allowed.has(t) || t === 'K')];
    c.ranked = ranked.map((t) => (black[k] ? t.toLowerCase() : t));
    c.piece = c.ranked[0];
  });
  for (const isBlack of [false, true]) {
    const mine = clusters.map((c, k) => k).filter((k) => black[k] === isBlack);
    // πιόνι: η μεγαλύτερη ομάδα κάθε χρώματος τετραγώνου (τα πιόνια είναι τα μισά περίπου κομμάτια)
    for (const dark of [false, true]) {
      const group = mine.filter((k) => clusters[k].dark === dark).sort((a, b) => clusters[b].n - clusters[a].n);
      const total = group.reduce((n, k) => n + clusters[k].n, 0);
      const top = group[0];
      if (top !== undefined && !back[top] && clusters[top].n >= total * 0.25) {
        setPiece(clusters[top], isBlack ? 'p' : 'P');
        clusters[top].locked = true;
      }
    }
    // βασιλιάς: ομάδες που δεν συνυπάρχουν ποτέ στο ίδιο διάγραμμα, όσο καλύπτουν περισσότερα διαγράμματα
    const kings: number[] = [];
    const covered = new Set<number>();
    for (const k of mine.filter((x) => perBoard[x] <= 1).sort((a, b) => present[b].size - present[a].size)) {
      if ([...present[k]].some((bi) => covered.has(bi))) continue;
      if (clusters[k].piece.toUpperCase() === 'P' && clusters[k].n >= 20) continue;
      kings.push(k);
      for (const bi of present[k]) covered.add(bi);
    }
    if (covered.size >= cluster.length * 0.5)
      for (const k of kings) {
        setPiece(clusters[k], isBlack ? 'k' : 'K');
        clusters[k].locked = true;
      }
  }
}

/** Οι θέσεις (πρώτο πεδίο του FEN) των διαγραμμάτων, με έναν βασιλιά ανά χρώμα όπου γίνεται. */
export function placements(r: BookBoards): string[] {
  return r.boards.map((cells, bi) => {
    const fixed = r.fixed?.get(bi);
    if (fixed) return swapColors(queenColors(fixed));
    const grid = r.cluster[bi].map((k) => (k >= 0 ? r.clusters[k].piece : ''));
    for (const king of ['K', 'k']) {
      const at = grid.flatMap((p, i) => (p === king ? [i] : []));
      if (at.length > 1) {
        // κρατά τον βασιλιά της μεγαλύτερης ομάδας· οι άλλοι παίρνουν τη δεύτερη επιλογή τους
        at.sort((a, b) => r.clusters[r.cluster[bi][b]].n - r.clusters[r.cluster[bi][a]].n);
        for (const i of at.slice(1)) grid[i] = r.clusters[r.cluster[bi][i]].ranked.find((p) => p !== king && p.toLowerCase() !== 'k') ?? '';
      } else if (!at.length) {
        // κανένας: το κομμάτι του σωστού χρώματος που έχει τον βασιλιά πιο ψηλά στις επιλογές του
        const cand = grid
          .map((p, i) => ({ i, k: r.cluster[bi][i] }))
          .filter((x) => x.k >= 0 && r.clusters[x.k].ranked.includes(king))
          .sort((a, b) => r.clusters[a.k].ranked.indexOf(king) - r.clusters[b.k].ranked.indexOf(king))[0];
        if (cand) grid[cand.i] = king;
      }
    }
    void cells;
    const rows: string[] = [];
    for (let row = 0; row < 8; row++) rows.push(grid.slice(row * 8, row * 8 + 8).map((p) => p || '1').join('').replace(/1+/g, (m) => String(m.length)));
    return rows.join('/');
  });
}

/**
 * Θέση του πακέτου διαγραμμάτων με δύο βασίλισσες ενός χρώματος και καμία του άλλου, σε θέση μέσης παρτίδας (24+
 * κομμάτια, όπου η δεύτερη βασίλισσα από προαγωγή σχεδόν δεν γίνεται): το πακέτο μπέρδεψε το χρώμα της μίας.
 * Αλλάζει χρώμα αυτή που είναι πιο βαθιά στο στρατόπεδο του αντιπάλου· σε ισοπαλία τίποτα.
 */
function queenColors(placement: string): string {
  const grid = [...cellsOf(placement)];
  if (grid.length !== 64 || grid.filter((c) => c !== '.').length < 24) return placement;
  for (const [q, other] of [['Q', 'q'], ['q', 'Q']] as const) {
    const at = grid.flatMap((c, i) => (c === q ? [i] : []));
    if (at.length !== 2 || grid.includes(other)) continue;
    // (σειρά 0 = 8η γραμμή: για τη λευκή, πιο βαθιά = μικρότερη σειρά)
    const deep = (i: number) => (q === 'Q' ? 7 - (i >> 3) : i >> 3);
    if (deep(at[0]) === deep(at[1])) return placement;
    const flip = deep(at[0]) > deep(at[1]) ? at[0] : at[1];
    grid[flip] = other;
    return toPlacement(grid.map((c) => (c === '.' ? '' : c)));
  }
  return placement;
}

const cellsOf = (placement: string) => placement.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(Number(d)))).join('');

/** Η ανάγνωση ενός διαγράμματος με τα τρέχοντα ονόματα των ομάδων (χωρίς τον κανόνα του βασιλιά). */
const gridOf = (r: BookBoards, bi: number) => r.cluster[bi].map((k) => (k >= 0 ? r.clusters[k].piece : ''));

const toPlacement = (grid: string[]) => {
  const rows: string[] = [];
  for (let row = 0; row < 8; row++) rows.push(grid.slice(row * 8, row * 8 + 8).map((p) => p || '1').join('').replace(/1+/g, (m) => String(m.length)));
  return rows.join('/');
};

/**
 * Διόρθωση των ονομάτων από το κείμενο (`ev`: δείκτης διαγράμματος → τι λέει το κείμενο):
 * 1. θέσεις παρτίδας: όταν τα κατειλημμένα τετράγωνα και τα χρώματα συμφωνούν σχεδόν όλα, κάθε ομάδα παίρνει το
 *    κομμάτι που δείχνουν οι περισσότερες θέσεις της·
 * 2. ομάδες χωρίς τέτοια θέση: το όνομα της πιο όμοιας ομάδας που διορθώθηκε·
 * 3. κινήσεις μετά το διάγραμμα (λύσεις, αποσπάσματα): για κάθε ομάδα, το όνομα (ίδιου χρώματος) με το οποίο
 *    παίζονται οι περισσότερες κινήσεις, με έναν βασιλιά ανά χρώμα.
 * Επιστρέφει πόσες ομάδες άλλαξαν.
 */
export function refine(r: BookBoards, ev: Map<number, DiagramEvidence>, fit: (placement: string, turn: 'w' | 'b' | null, moves: ProbeMove[]) => number): number {
  const before = r.clusters.map((c) => c.piece);
  const white = (p: string) => p !== '' && p === p.toUpperCase();
  // 1. θέσεις παρτίδας
  const votes = r.clusters.map(() => new Map<string, number>());
  const fixed = new Set<number>();
  for (const [bi, e] of ev) {
    if (!e.positions?.length || !r.cluster[bi]) continue;
    const grid = gridOf(r, bi);
    const occ = r.cluster[bi].map((k) => k >= 0);
    let best: { cells: string; bad: number; occ: number } | null = null;
    for (const pos of e.positions) {
      const cells = cellsOf(pos);
      let bad = 0;
      let wrong = 0;
      // κατειλημμένα τετράγωνα (από την εικόνα, αξιόπιστα) και χρώματα όπου υπάρχει όνομα
      for (let i = 0; i < 64; i++) {
        const t = cells[i] === '.' ? '' : cells[i];
        if (Boolean(t) !== occ[i]) wrong++;
        else if (t && grid[i] && white(t) !== white(grid[i])) bad++;
      }
      if (!best || wrong + bad < best.bad + best.occ) best = { cells, bad, occ: wrong };
    }
    // δεκτή: σχεδόν ίδια κατειλημμένα τετράγωνα (τα χρώματα της πρώτης ανάγνωσης μπορεί να έχουν λάθη)
    if (!best || best.occ > 2 || best.occ + best.bad > 12) continue;
    r.cluster[bi].forEach((k, i) => {
      if (k < 0) return;
      const t = best!.cells[i] === '.' ? '' : best!.cells[i];
      votes[k].set(t, (votes[k].get(t) ?? 0) + 1);
    });
  }
  votes.forEach((v, k) => {
    const total = [...v.values()].reduce((a, b) => a + b, 0);
    const [label, n] = [...v.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (!total || n / total < 0.6) return;
    fixed.add(k);
    setPiece(r.clusters[k], label);
  });
  // 2. οι υπόλοιπες ομάδες: η πιο όμοια διορθωμένη (ίδιο χρώμα τετραγώνου)
  if (fixed.size) {
    r.clusters.forEach((c, k) => {
      if (fixed.has(k)) return;
      let best = -1;
      let bestD = Infinity;
      for (const f of fixed) {
        if (r.clusters[f].dark !== c.dark) continue;
        const d = rms(r.clusters[f].sharp, c.sharp);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      if (best >= 0 && bestD < 0.2) setPiece(c, r.clusters[best].piece);
    });
  }
  // 3. κινήσεις: τοπική αναζήτηση, μία ομάδα τη φορά
  const probes = [...ev.entries()].filter(([bi, e]) => e.moves?.length && r.cluster[bi]);
  if (probes.length) {
    const boardsOf = r.clusters.map(() => [] as number[]);
    for (const [bi] of probes) for (const k of new Set(r.cluster[bi])) if (k >= 0) boardsOf[k].push(bi);
    const score = (bi: number) => {
      const grid = gridOf(r, bi);
      const count = (p: string) => grid.filter((x) => x === p).length;
      const kings = count('K') === 1 && count('k') === 1;
      const e = ev.get(bi)!;
      const n = kings ? fit(toPlacement(grid), e.turn ?? null, e.moves!) : 0;
      // απίθανο υλικό (πολλοί ίπποι, δύο βασίλισσες…): μια ετικέτα που «βολεύει» τυχαία κινήσεις δεν περνά
      let odd = 0;
      for (const p of ['N', 'B', 'R', 'n', 'b', 'r']) odd += Math.max(0, count(p) - 2);
      for (const p of ['Q', 'q']) odd += Math.max(0, count(p) - 1);
      for (const p of ['P', 'p']) odd += 2 * Math.max(0, count(p) - 8);
      return (n ? 2 + n : 0) + (kings ? 1 : 0) - odd;
    };
    const order = r.clusters.map((c, k) => k).filter((k) => boardsOf[k].length && !fixed.has(k) && !r.clusters[k].locked).sort((a, b) => boardsOf[b].length - boardsOf[a].length);
    for (let round = 0; round < 3; round++) {
      let improved = false;
      for (const k of order) {
        const c = r.clusters[k];
        const cur = c.piece;
        const base = boardsOf[k].reduce((s, bi) => s + score(bi), 0);
        let best = { label: cur, s: base };
        const options = cur ? [...c.allowed] : [];
        for (const label of options) {
          if (label === cur) continue;
          c.piece = label;
          const s = boardsOf[k].reduce((sum, bi) => sum + score(bi), 0);
          if (s > best.s) best = { label, s };
        }
        c.piece = cur;
        if (best.label !== cur) {
          setPiece(c, best.label);
          improved = true;
        }
      }
      if (!improved) break;
    }
  }
  return r.clusters.filter((c, k) => c.piece !== before[k]).length;
}

function setPiece(c: Cluster, piece: string): void {
  c.piece = piece;
  c.ranked = [piece, ...c.ranked.filter((p) => p !== piece)];
}

/** Τα διαγράμματα που επιβεβαιώνει το κείμενο: θέση παρτίδας (ως 2 τετράγωνα διαφορά) ή κινήσεις που παίζονται. */
export function trustedBoards(r: BookBoards, ev: Map<number, DiagramEvidence>): Set<number> {
  const pl = placements(r);
  const out = new Set<number>();
  for (const [id, e] of ev) {
    if (pl[id] === undefined) continue;
    if (e.positions?.some((p) => placementDiff(p, pl[id]) <= 2)) out.add(id);
    else if (e.moves?.length && movesFit(pl[id], e.turn ?? null, e.moves) >= Math.min(2, e.moves.length)) out.add(id);
    else if (e.moves?.length && altsFit(pl[id], e.moves) >= 2) out.add(id);
  }
  // (η ίδια ακριβώς θέση με ένα επιβεβαιωμένο: η ερώτηση μιας άσκησης και το διάγραμμα της λύσης της)
  const sure = new Set([...out].map((id) => pl[id]));
  pl.forEach((p, id) => {
    if (p !== undefined && sure.has(p)) out.add(id);
  });
  return out;
}

/**
 * Ανάλυση βιβλίου με διαγράμματα-εικόνες: ένα πέρασμα για να μάθει τι λέει το κείμενο για κάθε διάγραμμα, διόρθωση
 * των ονομάτων (`refine`), και ξανά (ως δύο φορές) με τις διορθωμένες θέσεις. Χωρίς διαγράμματα-εικόνες: ένα πέρασμα.
 */
export function parseWithBoards(paragraphs: BookParagraph[], r: BookBoards | null, opts: BookOptions): BookResult & { diagrams: number; verified: number } {
  if (!r?.boards.length) return { ...parseBook(paragraphs, opts), diagrams: 0, verified: 0 };
  const apply = () => {
    const pl = placements(r);
    for (const p of paragraphs) if (p.diagram?.id !== undefined && pl[p.diagram.id] !== undefined) p.diagram.placement = pl[p.diagram.id];
  };
  // (οι θέσεις του πακέτου διαγραμμάτων είναι έμπιστες από την αρχή: από αυτές ο αναλυτής μαθαίνει και τα σύμβολα των
  // κομματιών στα βιβλία ασκήσεων, όπου κάθε λύση ξεκινά από διάγραμμα)
  const fixed = [...(r.fixed?.keys() ?? [])];
  let trusted = new Set<number>(fixed);
  // (όσα επιβεβαίωσαν οι κινήσεις: αυτά μετρούν στα στατιστικά, όχι όσα απλώς εμπιστευόμαστε)
  let byMoves = new Set<number>();
  for (let round = 0; round < 3; round++) {
    const ev = new Map<number, DiagramEvidence>();
    parseBook(paragraphs, {
      ...opts,
      shapes: false,
      trusted: (id) => trusted.has(id),
      fixed: (id) => r.fixed?.has(id) ?? false,
      probe: (id, e) => {
        const cur = ev.get(id) ?? {};
        ev.set(id, { positions: [...(cur.positions ?? []), ...(e.positions ?? [])], moves: cur.moves?.length ? cur.moves : e.moves, turn: e.turn ?? cur.turn ?? null });
      },
    });
    const changed = refine(r, ev, movesFit);
    apply();
    byMoves = trustedBoards(r, ev);
    const next = new Set([...byMoves, ...fixed]);
    const same = next.size === trusted.size && [...next].every((id) => trusted.has(id));
    trusted = next;
    if (!changed && same && round > 0) break;
  }
  return { ...parseBook(paragraphs, { ...opts, trusted: (id) => trusted.has(id), fixed: (id) => r.fixed?.has(id) ?? false }), diagrams: r.boards.length, verified: byMoves.size };
}
