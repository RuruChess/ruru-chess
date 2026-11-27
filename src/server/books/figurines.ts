/**
 * Σύμβολα κομματιών (♘♗♖♕♔) σε σελίδες που διαβάζονται από την εικόνα τους (`ppocr.ts`). Το μοντέλο ανάγνωσης διαβάζει
 * το κείμενο σχεδόν τέλεια αλλά δεν ξέρει τα σύμβολα: τα παραλείπει ή βγάζει πάνω τους έναν ψεύτικο χαρακτήρα («2» για
 * ίππο, «g» για πύργο). Εδώ βρίσκονται από το ΣΧΗΜΑ τους:
 *
 * 1. Κάθε γραμμή χωρίζεται σε «γλύφους» (κομμάτια μελανιού) και οι χαρακτήρες του μοντέλου στοιχίζονται σε αυτούς.
 * 2. Υποψήφιος είναι κάθε γλύφος στο μέγεθος συμβόλου που αρχίζει λέξη και ακολουθείται από κίνηση («f3», «xd5»).
 *    «Σπόρος» είναι ο υποψήφιος που το μοντέλο δεν διάβασε με σιγουριά: σχεδόν πάντα σύμβολο.
 * 3. Σε όλο το βιβλίο οι σπόροι γίνονται ομάδες σχήματος· κάθε υποψήφιος που μοιάζει με ομάδα είναι σύμβολο, ό,τι κι αν
 *    διάβασε πάνω του το μοντέλο. Ομάδα που διαβάζεται σχεδόν πάντα με τον ίδιο χαρακτήρα είναι γράμμα και φεύγει.
 *
 * Το ποιο κομμάτι είναι κάθε ομάδα δεν αποφασίζεται εδώ: κάθε ομάδα γράφεται με δικό της χαρακτήρα (U+E000…) και ο
 * αναλυτής (`core/bookparse.ts`, `learnGlyphs`) το μαθαίνει από τις κινήσεις όπου μόνο ένα κομμάτι είναι νόμιμο.
 */
import { resize, type Gray } from './vision.ts';

/** πλευρά της εικόνας-προτύπου κάθε γλύφου */
export const V = 32;
/** σιγουριά χαρακτήρα του μοντέλου πάνω από την οποία ο γλύφος θεωρείται «διαβασμένος» */
const SURE = 0.85;
/** πόσο μοιάζουν δύο γλύφοι του ίδιου συμβόλου (RMS της θολωμένης εικόνας V×V, 0–1): σύμβολα ≤ 0,13, γράμματα ≥ 0,24 */
const TAU = 0.15;
/** ο χαρακτήρας της πρώτης ομάδας συμβόλων· η ομάδα k γράφεται U+E000 + k (ως U+E0FE) */
export const FIG_BASE = 0xe000;
/** σύμβολο που δεν μοιάζει με καμία ομάδα (άγνωστο κομμάτι) */
export const FIG_LONE = String.fromCharCode(FIG_BASE + 0xff);
const FIG_SRC = '[\ue000-\ue0ff]';
export const FIG_RE = new RegExp(FIG_SRC);

export interface RecChar {
  ch: string;
  /** θέση στο απόκομμα της γραμμής (0..1 του πλάτους του) */
  x: number;
  /** σιγουριά του μοντέλου */
  p: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Glyph {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** εικονοστοιχεία μελανιού */
  n: number;
  /** πάχος γραμμής (pixel): το πιο συχνό μήκος οριζόντιας σειράς μελανιού */
  sw: number;
  /** οι χαρακτήρες του μοντέλου που αντιστοιχούν σε αυτόν (δείκτες στο chars) */
  chars: number[];
}

/** Μία γραμμή κειμένου της σελίδας, όπως τη διάβασε το μοντέλο, με τους γλύφους της (συντεταγμένες του αποκόμματος). */
export interface PLine {
  /** το απόκομμα στην εικόνα της σελίδας */
  box: Box;
  /** μέγεθος γραμμάτων σε pixel (χονδρικά) */
  em: number;
  chars: RecChar[];
  /** θέση x κάθε χαρακτήρα στο απόκομμα (pixel) */
  cx: Float32Array;
  glyphs: Glyph[];
  /** χαρακτήρας → γλύφος (-1: κενό) */
  assign: Int32Array;
}

export interface Cand {
  page: number;
  line: number;
  /** ο (πρώτος) γλύφος της γραμμής και πόσους διαδοχικούς πιάνει (> 1: ενωμένη μορφή κομματιών) */
  glyph: number;
  span: number;
  vec: Uint8Array;
  /** οι χαρακτήρες του μοντέλου πάνω του (χωρίς τελείες) και η μεγαλύτερη σιγουριά τους */
  ch: string;
  p: number;
  /** αρχίζει λέξη και ακολουθεί κίνηση («f3», «xd5», «bd7»), ή είναι κομμάτι προαγωγής («=») */
  move: boolean;
}

const DOTS = ".,'’…·";

function crop(img: Gray, x0: number, y0: number, x1: number, y1: number): Gray {
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(img.w, Math.ceil(x1));
  y1 = Math.min(img.h, Math.ceil(y1));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) px.set(img.px.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
  return { w, h, px };
}

/** Το κατώφλι μελανιού ενός αποκόμματος (ανάμεσα στο σκούρο 2% και το ανοιχτό 90%), ή -1 αν είναι σχεδόν ομοιόμορφο. */
function inkThreshold(c: Gray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < c.px.length; i++) hist[c.px[i]]++;
  const q = (f: number) => {
    let s = 0;
    for (let v = 0; v < 256; v++) {
      s += hist[v];
      if (s >= f * c.px.length) return v;
    }
    return 255;
  };
  const lo = q(0.02);
  const hi = q(0.9);
  return hi - lo < 50 ? -1 : (lo + hi) / 2;
}

/** Τα συνδεδεμένα κομμάτια μελανιού μιας γραμμής (8 γείτονες). */
function components(c: Gray, thr: number): Glyph[] {
  const { w, h, px } = c;
  const lab = new Uint8Array(w * h);
  const comps: Glyph[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] || px[i] >= thr) continue;
    const cm: Glyph = { x0: w, y0: h, x1: 0, y1: 0, n: 0, sw: 0, chars: [] };
    lab[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j - x) / w;
      cm.n++;
      if (x < cm.x0) cm.x0 = x;
      if (x > cm.x1) cm.x1 = x;
      if (y < cm.y0) cm.y0 = y;
      if (y > cm.y1) cm.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const m = ny * w + nx;
          if (!lab[m] && px[m] < thr) {
            lab[m] = 1;
            stack.push(m);
          }
        }
      }
    }
    if (cm.n >= 3) comps.push(cm);
  }
  return comps;
}

/**
 * Το πάχος γραμμής ενός γλύφου: σε κάθε εικονοστοιχείο μελανιού το μικρότερο από το μήκος της οριζόντιας και της κάθετης
 * σειράς μελανιού που περνά από αυτό (η οριζόντια μόνη της δίνει το μήκος της μπάρας στο «e» ή στο «t»), και από αυτά η
 * διάμεσος.
 */
function strokeOf(c: Gray, g: Glyph, thr: number): number {
  const w = g.x1 - g.x0 + 1;
  const h = g.y1 - g.y0 + 1;
  if (w * h > 40000) return 0;
  const ink = (x: number, y: number) => c.px[(g.y0 + y) * c.w + g.x0 + x] < thr;
  const hor = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; ) {
      if (!ink(x, y)) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && ink(e, y)) e++;
      for (let k = x; k < e; k++) hor[y * w + k] = e - x;
      x = e;
    }
  }
  const hist = new Uint32Array(64);
  let total = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; ) {
      if (!ink(x, y)) {
        y++;
        continue;
      }
      let e = y;
      while (e < h && ink(x, e)) e++;
      for (let k = y; k < e; k++) {
        hist[Math.min(63, Math.min(e - y, hor[k * w + x]))]++;
        total++;
      }
      y = e;
    }
  }
  if (!total) return 0;
  // διάμεσος, με παρεμβολή μέσα στη στάθμη της (τα πάχη είναι λίγα pixel: 4 ή 5 κανονικά, 7 έντονα)
  let acc = 0;
  for (let v = 1; v < 64; v++) {
    if (acc + hist[v] >= total / 2) return v - 0.5 + (total / 2 - acc) / hist[v];
    acc += hist[v];
  }
  return 63;
}

/**
 * Οι γλύφοι μιας γραμμής: τα κομμάτια μελανιού, με τα μικρά ενωμένα σε ό,τι βρίσκεται πάνω ή κάτω τους (τελεία του i,
 * σταυρός του βασιλιά, «:», «=»). Επιστρέφει και το μέγεθος των γραμμάτων: το ύψος του αποκόμματος το υπερεκτιμά
 * (ως ×1,4), ενώ ο ψηλότερος γλύφος είναι το πολύ ~0,9 em.
 */
export function glyphsOf(c: Gray, em0: number): { glyphs: Glyph[]; em: number } {
  const thr = inkThreshold(c);
  if (thr < 0) return { glyphs: [], em: em0 };
  // κομμάτια γειτονικών γραμμών στην άκρη του αποκόμματος: έξω
  const comps = components(c, thr).filter((cm) => !((cm.y0 === 0 || cm.y1 === c.h - 1) && cm.y1 - cm.y0 + 1 < 0.3 * em0));
  // ο ψηλότερος γλύφος που δεν είναι μοναδικός στο ύψος του (δύο γραμμές που κόλλησαν, μια αγκύλη, ένας λεκές θα έδιναν
  // ψεύτικα μεγάλα γράμματα): χρειάζεται άλλους δύο τουλάχιστον στο 80% του
  const hs = comps.map((g) => g.y1 - g.y0 + 1).sort((a, b) => b - a);
  let top = hs[0] ?? 0;
  // (όχι κάτω από το μισό του ψηλότερου: στο «1...e5» οι τρεις τελείες είναι οι μόνες με ίδιο ύψος, και η γραμμή έβγαινε
  // με μέγεθος γραμμάτων όσο μια τελεία)
  for (let i = 0; i + 2 < hs.length && hs[i] >= 0.5 * hs[0]; i++) {
    if (hs[i + 2] >= 0.8 * hs[i]) {
      top = hs[i];
      break;
    }
  }
  const em = Math.min(em0, 1.25 * top);
  comps.sort((a, b) => a.x0 - b.x0);
  const join = (g: Glyph, s: Glyph) => {
    g.x0 = Math.min(g.x0, s.x0);
    g.x1 = Math.max(g.x1, s.x1);
    g.y0 = Math.min(g.y0, s.y0);
    g.y1 = Math.max(g.y1, s.y1);
    g.n += s.n;
  };
  const tall = (g: Glyph) => g.y1 - g.y0 + 1 >= 0.45 * em;
  const overlap = (a: Glyph, b: Glyph) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
  const glyphs: Glyph[] = comps.filter(tall).map((g) => ({ ...g }));
  const smalls: Glyph[] = [];
  for (const s of comps) {
    if (tall(s)) continue;
    const host = glyphs.find((g) => overlap(g, s) >= 0.6 * (s.x1 - s.x0 + 1)) ?? smalls.find((g) => overlap(g, s) >= 0.6 * Math.min(s.x1 - s.x0 + 1, g.x1 - g.x0 + 1));
    if (host) join(host, s);
    else smalls.push({ ...s });
  }
  const out = [...glyphs, ...smalls].sort((a, b) => a.x0 + a.x1 - (b.x0 + b.x1));
  for (const g of out) g.sw = strokeOf(c, g, thr);
  return { glyphs: out, em };
}

/**
 * Κάθε χαρακτήρας του μοντέλου (όχι τα κενά) στον γλύφο του: μονότονη στοίχιση με το μικρότερο κόστος. Το κόστος είναι η
 * απόσταση, και επιπλέον: τελεία πάνω σε μεγάλο γλύφο ή γράμμα πάνω σε κουκκίδα, περισσότεροι χαρακτήρες απ' όσους
 * χωρά ο γλύφος, γλύφος που μένει χωρίς χαρακτήρα.
 */
export function assignChars(chars: RecChar[], cx: Float32Array, glyphs: Glyph[], em: number): Int32Array {
  const assign = new Int32Array(chars.length).fill(-1);
  const idx: number[] = [];
  chars.forEach((c, i) => {
    if (c.ch !== ' ') idx.push(i);
  });
  const n = idx.length;
  const m = glyphs.length;
  if (!n || !m) return assign;
  const tiny = glyphs.map((g) => g.y1 - g.y0 + 1 < 0.25 * em && g.x1 - g.x0 + 1 < 0.25 * em);
  const cost = (i: number, j: number) => {
    const x = cx[idx[i]];
    const g = glyphs[j];
    const out = x < g.x0 ? g.x0 - x : x > g.x1 ? x - g.x1 : 0;
    const ch = chars[idx[i]].ch;
    const dot = DOTS.includes(ch);
    // τελεία, κόμμα, απόστροφος δεν είναι ποτέ μεγάλος γλύφος (το μοντέλο τα βάζει συχνά πάνω στο σύμβολο που δεν
    // διάβασε)· ούτε γράμμα ή ψηφίο μια κουκκίδα («...a6»: το «a» πήγαινε στα αποσιωπητικά)
    const odd = (dot && g.y1 - g.y0 + 1 >= 0.45 * em && g.x1 - g.x0 + 1 >= 0.36 * em) || (!dot && tiny[j] && /[A-Za-z0-9]/.test(ch)) ? 0.6 : 0;
    return (out * 2 + 0.2 * Math.abs(x - (g.x0 + g.x1) / 2)) / em + odd;
  };
  // πόσοι χαρακτήρες χωρούν σε έναν γλύφο (κολλημένα γράμματα: περισσότεροι)· κάθε παραπάνω κοστίζει, ώστε ένα γράμμα
  // να μη στριμώχνεται στον διπλανό γλύφο («...a6»: το «a» έμπαινε στο «6» και ο δικός του γλύφος έμενε «αδιάβαστος»)
  const room = glyphs.map((g) => Math.max(1, Math.round((g.x1 - g.x0 + 1) / (0.45 * em))));
  // γλύφος που μένει χωρίς χαρακτήρα κοστίζει λίγο (τα σύμβολα κομματιών μένουν δικαίως, οι κουκκίδες συχνά)
  const skip = new Float32Array(m + 1);
  for (let k = 0; k < m; k++) skip[k + 1] = skip[k] + (tiny[k] ? 0.05 : 0.15);
  const dp = new Float32Array(n * m);
  const from = new Int32Array(n * m);
  const cnt = new Int32Array(n * m);
  for (let i = 0; i < n; i++) {
    // το καλύτερο ως τώρα από γλύφο πιο αριστερά (j' < j), με το κόστος των γλύφων που πηδιούνται ως τον j
    let best = Infinity;
    let bj = 0;
    for (let j = 0; j < m; j++) {
      if (i === 0) {
        dp[j] = cost(0, j) + skip[j];
        from[j] = -1;
        cnt[j] = 1;
        continue;
      }
      const stay = dp[(i - 1) * m + j] + (cnt[(i - 1) * m + j] >= room[j] ? 0.4 : 0);
      const jump = best + skip[j];
      if (stay <= jump) {
        dp[i * m + j] = stay + cost(i, j);
        from[i * m + j] = j;
        cnt[i * m + j] = cnt[(i - 1) * m + j] + 1;
      } else {
        dp[i * m + j] = jump + cost(i, j);
        from[i * m + j] = bj;
        cnt[i * m + j] = 1;
      }
      const prev = dp[(i - 1) * m + j] - skip[j + 1];
      if (prev < best) {
        best = prev;
        bj = j;
      }
    }
  }
  let j = 0;
  const end = (k: number) => dp[(n - 1) * m + k] + skip[m] - skip[k + 1];
  for (let k = 1; k < m; k++) if (end(k) < end(j)) j = k;
  for (let i = n - 1; i >= 0; i--) {
    assign[idx[i]] = j;
    glyphs[j].chars.unshift(idx[i]);
    j = i > 0 ? from[i * m + j] : j;
  }
  return assign;
}

/** Η εικόνα του γλύφου σε τετράγωνο V×V (με τις αναλογίες του, λευκό γύρω), ελαφρά θολωμένη (ανοχή στον θόρυβο). */
export function glyphVec(c: Gray, g: Box): Uint8Array {
  const t = crop(c, g.x0, g.y0, g.x1 + 1, g.y1 + 1);
  const side = Math.max(t.w, t.h);
  const sq = new Uint8Array(side * side).fill(255);
  const ox = (side - t.w) >> 1;
  const oy = (side - t.h) >> 1;
  for (let y = 0; y < t.h; y++) sq.set(t.px.subarray(y * t.w, (y + 1) * t.w), (oy + y) * side + ox);
  const v = resize({ w: side, h: side, px: sq }, V, V).px;
  const out = new Uint8Array(V * V);
  for (let y = 0; y < V; y++)
    for (let x = 0; x < V; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= V) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= V) continue;
          s += v[yy * V + xx];
          n++;
        }
      }
      out[y * V + x] = s / n;
    }
  return out;
}

const MOVE_AFTER = /^(?:[a-h]?[1-8]?x?[a-h][1-8]|x[a-h][1-8])/;
/** χαλαρά (για τους υποψήφιους): και με το «1» διαβασμένο «l» ή «I» («Kcl») */
const MOVE_LOOSE = /^(?:[a-h]?[1-8]?x?[a-h][1-8lI](?![a-z])|x[a-h][1-8lI](?![a-z]))/;

/** το κείμενο του μοντέλου μετά τον γλύφο `k1` (χωρίς τα κενά της αρχής) και πριν από τον `k0` */
function around(l: PLine, k0: number, k1: number): { after: string; before: string } {
  let i0 = l.chars.length;
  for (let i = 0; i < l.chars.length; i++) {
    if (l.assign[i] > k1) {
      i0 = i;
      break;
    }
  }
  let j = i0 - 1;
  while (j >= 0 && ((l.assign[j] >= k0 && l.assign[j] <= k1) || l.chars[j].ch === ' ')) j--;
  let before = '';
  for (let i = Math.max(0, j - 2); i <= j; i++) before += l.chars[i].ch;
  let after = '';
  for (let i = i0; i < Math.min(l.chars.length, i0 + 8); i++) after += l.chars[i].ch;
  return { after, before };
}

/**
 * Μία γραμμή: γλύφοι, στοίχιση, και οι υποψήφιοι: γλύφοι στο μέγεθος συμβόλου κομματιού που αρχίζουν λέξη και
 * ακολουθούνται από κίνηση (ό,τι κι αν διάβασε πάνω τους το μοντέλο). Υποψήφια είναι και η ΕΝΩΜΕΝΗ μορφή διαδοχικών
 * γλύφων που σχεδόν ακουμπούν (`span` > 1): σύμβολο με λεπτές γραμμές που έσπασε σε κομμάτια· αν είναι σύμβολο ή δύο
 * γράμματα το κρίνει το σχήμα σε όλο το βιβλίο. `c`: το απόκομμα της γραμμής· `em0`: χονδρική εκτίμηση του μεγέθους των
 * γραμμάτων (ύψος αποκόμματος).
 */
export function analyseLine(c: Gray, chars: RecChar[], box: Box, em0: number, page: number, line: number): { l: PLine; cands: Cand[] } {
  const { glyphs, em } = glyphsOf(c, em0);
  // το μοντέλο δίνει κάθε χαρακτήρα ~0,35 βήμα (βήμα = 8 pixel στο ύψος 48) δεξιότερα από το κέντρο του γράμματος
  // (μετρημένο σε 25.000 χαρακτήρες τεσσάρων βιβλίων, ίδιο σε όλο το μήκος της γραμμής)
  const lag = (0.35 * 8 * c.h) / 48;
  const cx = Float32Array.from(chars, (ch) => ch.x * c.w - lag);
  const assign = assignChars(chars, cx, glyphs, em);
  const l: PLine = { box, em, chars, cx, glyphs, assign };
  const cands: Cand[] = [];
  const tryCand = (k0: number, k1: number) => {
    const g = { x0: glyphs[k0].x0, y0: glyphs[k0].y0, x1: glyphs[k0].x1, y1: glyphs[k0].y1 };
    const own: RecChar[] = [];
    for (let k = k0; k <= k1; k++) {
      g.x0 = Math.min(g.x0, glyphs[k].x0);
      g.x1 = Math.max(g.x1, glyphs[k].x1);
      g.y0 = Math.min(g.y0, glyphs[k].y0);
      g.y1 = Math.max(g.y1, glyphs[k].y1);
      // (η τελεία του αριθμού κίνησης πάνω στο σύμβολο δεν μετρά ως «διαβασμένο»)
      for (const i of glyphs[k].chars) if (!DOTS.includes(chars[i].ch)) own.push(chars[i]);
    }
    const bw = g.x1 - g.x0 + 1;
    const bh = g.y1 - g.y0 + 1;
    // όχι στενά και ψηλά («†», «!», «?», παρενθέσεις), ούτε στο ύψος των πεζών «a», «c», «e»: τα σύμβολα είναι από 0,69 em
    // και πάνω, και το em εδώ είναι ως ×1,25 το πραγματικό
    if (bw < 0.36 * em || bh < 0.52 * em || bw > (k1 > k0 ? 1.2 : 1.5) * em || bw < 0.58 * bh) return;
    const { after, before } = around(l, k0, k1);
    // χαρακτήρας άλλης γραφής πάνω στον γλύφο («皇» για αξιωματικό, «主», «出»): το μοντέλο δεν ξέρει το σύμβολο και
    // γράφει ό,τι του μοιάζει, συχνά με μεγάλη σιγουριά· δεν μετρά ως «διαβασμένο»
    const p = own.some((o) => /[⺀-鿿豈-﫿＀-￯]/.test(o.ch)) ? 0 : own.reduce((m, o) => Math.max(m, o.p), 0);
    // σύμβολο κομματιού αρχίζει λέξη: πριν από αυτό κενό (στο μελάνι), τελεία, παρένθεση ή «=» (όχι κολλημένο στην
    // προηγούμενη κίνηση όπως το «†»)
    const prev = k0 > 0 ? glyphs[k0 - 1] : null;
    const starts = !prev || g.x0 - prev.x1 >= 0.16 * em || (prev.y1 - prev.y0 + 1 < 0.25 * em && prev.x1 - prev.x0 + 1 < 0.25 * em) || /[(\[=…/]$/.test(before);
    const strict = starts && (MOVE_AFTER.test(after) || (/=$/.test(before) && p < SURE));
    // (χαλαρά: και με έναν ψεύτικο χαρακτήρα ανάμεσα, που η στοίχιση έδωσε στον επόμενο γλύφο)
    if (!strict && !(starts && (MOVE_LOOSE.test(after) || MOVE_LOOSE.test(after.slice(1).trimStart())))) return;
    cands.push({ page, line, glyph: k0, span: k1 - k0 + 1, vec: glyphVec(c, g), ch: own.map((o) => o.ch).join(''), p, move: strict });
  };
  for (let k = 0; k < glyphs.length; k++) {
    tryCand(k, k);
    // η αλυσίδα γλύφων που αρχίζει εδώ: ο καθένας επικαλύπτει τον επόμενο στο x ή σχεδόν τον ακουμπά (σύμβολο που έσπασε
    // σε κάθετες φέτες)· όχι από τελεία («12.♘»)
    if (glyphs[k].y1 - glyphs[k].y0 + 1 < 0.25 * em && glyphs[k].x1 - glyphs[k].x0 + 1 < 0.25 * em) continue;
    let e = k;
    let right = glyphs[k].x1;
    while (e + 1 < glyphs.length && glyphs[e + 1].x0 - right <= 0.06 * em && Math.max(right, glyphs[e + 1].x1) - glyphs[k].x0 + 1 <= 1.2 * em) {
      e++;
      right = Math.max(right, glyphs[e].x1);
      tryCand(k, e);
    }
  }
  return { l, cands };
}

// ---------------------------------------------------------------------------- «3 … f5»
const DOT_LINE = /^[.…·•●。]{1,4}$/;
const NUM_LINE = /^\d{1,3}$/;
/** γραμμή που αρχίζει με κίνηση (με ως δύο ψεύτικους χαρακτήρες πάνω στο σύμβολο του κομματιού) ή ροκέ */
const MOVE_START = /^(?:\S{0,2}?[a-h]?[1-8]?x?[a-h][1-8lI]|[O0o]-[O0o])/;

const rawText = (l: PLine): string => l.chars.map((c) => c.ch).join('').trim();

/** Γραμμή του εντοπισμού που είναι μόνο δύο ως τέσσερις κουκκίδες, ό,τι κι αν διάβασε το μοντέλο («..», «●»): «…». */
export function isDotLine(l: PLine): boolean {
  const n = l.glyphs.length;
  const text = rawText(l).replace(/\s+/g, '');
  if (n < 2 || n > 4 || text.length > 4) return false;
  if (DOT_LINE.test(text)) return true;
  // από το σχήμα («0香香», «*»): ίδιες μικρές τετράγωνες κουκκίδες στην ίδια βάση, με κενό ανάμεσά τους όσο οι ίδιες
  const gs = [...l.glyphs].sort((a, b) => a.x0 - b.x0);
  const w = gs.map((g) => g.x1 - g.x0 + 1);
  const h = gs.map((g) => g.y1 - g.y0 + 1);
  const side = [...w, ...h].sort((a, b) => a - b)[n];
  for (let k = 0; k < n; k++) {
    // (γεμάτες, όχι γράμματα με κενό στη μέση)
    if (gs[k].n < 0.65 * w[k] * h[k]) return false;
    if (w[k] < 0.6 * side || w[k] > 1.67 * side || h[k] < 0.6 * side || h[k] > 1.67 * side) return false;
    if (Math.abs(gs[k].y1 - gs[0].y1) > 0.5 * side) return false;
    if (k > 0 && (gs[k].x0 - gs[k - 1].x1 < 0.8 * side || gs[k].x0 - gs[k - 1].x1 > 6 * side)) return false;
  }
  return true;
}

/**
 * Τα αποσιωπητικά της κίνησης του Μαύρου στα βιβλία με μία κίνηση ανά γραμμή («3 … f5»): τρεις μικρές
 * κουκκίδες μόνες τους, μακριά από τον αριθμό και από την κίνηση, που ο εντοπισμός γραμμών συχνά δεν βλέπει· χωρίς
 * αυτές η κίνηση διαβάζεται ως κίνηση του Λευκού. Εδώ βρίσκονται από την εικόνα: γραμμή που είναι μόνο αριθμός, δεξιά
 * της στο ίδιο ύψος γραμμή που αρχίζει με κίνηση, και στο κενό ανάμεσά τους μόνο δύο ως τέσσερις κουκκίδες πάνω στη
 * γραμμή βάσης. Επιστρέφει τις γραμμές «…» που λείπουν (με το μέγεθος γραμμάτων του αριθμού).
 */
export function moveDots(img: Gray, lines: PLine[], page: number): PLine[] {
  const out: PLine[] = [];
  const ink = (l: PLine) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    const ys: number[] = [];
    for (const g of l.glyphs) {
      x0 = Math.min(x0, g.x0);
      x1 = Math.max(x1, g.x1);
      if (g.y1 - g.y0 + 1 >= 0.3 * l.em) ys.push(g.y1);
    }
    ys.sort((a, b) => a - b);
    return { x0: l.box.x0 + x0, x1: l.box.x0 + x1, base: l.box.y0 + (ys.length ? ys[ys.length >> 1] : l.box.y1 - l.box.y0) };
  };
  const inks = lines.map((l) => (l.glyphs.length ? ink(l) : null));
  lines.forEach((a, ai) => {
    const ia = inks[ai];
    if (!ia || !NUM_LINE.test(rawText(a))) return;
    const em = a.em;
    // η πιο κοντινή γραμμή δεξιά στο ίδιο ύψος
    let bi = -1;
    lines.forEach((b, k) => {
      const ib = inks[k];
      if (k === ai || !ib || ib.x0 <= ia.x1 || Math.abs(ib.base - ia.base) > 0.3 * em) return;
      if (bi < 0 || ib.x0 < inks[bi]!.x0) bi = k;
    });
    if (bi < 0) return;
    const ib = inks[bi]!;
    const gap = ib.x0 - ia.x1;
    // (η κίνηση του Λευκού είναι κοντά στον αριθμό· κουκκίδες που βρήκε ο εντοπισμός είναι ήδη γραμμή ανάμεσα)
    if (gap < 1.2 * em || gap > 14 * em || !MOVE_START.test(rawText(lines[bi]))) return;
    const thr = inkThreshold(crop(img, a.box.x0, a.box.y0, a.box.x1, a.box.y1));
    if (thr < 0) return;
    const rx = Math.round(ia.x1 + 0.2 * em);
    const ry = Math.round(ia.base - 0.6 * em);
    const region = crop(img, rx, ry, ib.x0 - 0.2 * em, ia.base + 0.25 * em);
    const comps = components(region, thr);
    if (comps.length < 2 || comps.length > 4) return;
    const small = (g: Glyph) => g.x1 - g.x0 + 1 <= 0.3 * em && g.y1 - g.y0 + 1 <= 0.3 * em && g.x1 - g.x0 + 1 >= 0.04 * em;
    const bottoms = comps.map((g) => ry + g.y1);
    if (!comps.every(small) || Math.max(...bottoms) - Math.min(...bottoms) > 0.12 * em || Math.abs(bottoms[0] - ia.base) > 0.2 * em) return;
    // κοντά η μία στην άλλη (όχι λεκέδες σκόρπιοι στο κενό)
    comps.sort((p, q) => p.x0 - q.x0);
    if (comps[comps.length - 1].x1 - comps[0].x0 > 1.6 * em) return;
    const box: Box = {
      x0: Math.max(0, rx + comps[0].x0 - 2),
      y0: Math.max(0, ry + Math.min(...comps.map((g) => g.y0)) - 2),
      x1: Math.min(img.w, rx + comps[comps.length - 1].x1 + 3),
      y1: Math.min(img.h, ry + Math.max(...comps.map((g) => g.y1)) + 3),
    };
    const { l } = analyseLine(crop(img, box.x0, box.y0, box.x1, box.y1), [{ ch: '…', x: 0.5, p: 1 }], box, em, page, lines.length + out.length);
    if (!l.glyphs.length) return;
    l.em = em;
    out.push(l);
  });
  return out;
}

// ---------------------------------------------------------------------------- απόφαση σε όλο το βιβλίο
/** ανά υποψήφιο: η ομάδα συμβόλου (0…), LONE (σύμβολο χωρίς ομάδα) ή -1 (γράμμα) */
export const LONE = 0xff;

function distMean(a: Uint8Array, m: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - m[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length) / 255;
}

/**
 * Ποιοι υποψήφιοι είναι σύμβολα κομματιών, και σε ποια ομάδα σχήματος ανήκει ο καθένας. Οι σπόροι (αδιάβαστοι, πριν από
 * κίνηση) γίνονται ομάδες· κάθε άλλος υποψήφιος που μοιάζει με ομάδα είναι κι αυτός σύμβολο, ό,τι κι αν διάβασε πάνω
 * του το μοντέλο. Ομάδα που το μοντέλο τη διαβάζει σχεδόν πάντα με τον ίδιο σίγουρο χαρακτήρα είναι γράμμα («N» σε
 * βιβλίο με γράμματα, «x», έντονο «d» που μία φορά βγήκε αβέβαιο) και φεύγει. Όταν και η ενωμένη μορφή και ένα κομμάτι
 * της βγουν σύμβολα, μένει η ενωμένη.
 */
export function decideFigurines(cands: Cand[], tau = TAU): { cluster: Int32Array; clusters: number } {
  const cluster = new Int32Array(cands.length).fill(-1);
  type Cl = { sum: Float32Array; n: number; mean: Float32Array };
  const cls: Cl[] = [];
  const add = (cl: Cl, v: Uint8Array) => {
    cl.n++;
    for (let k = 0; k < v.length; k++) {
      cl.sum[k] += v[k];
      cl.mean[k] = cl.sum[k] / cl.n;
    }
  };
  const nearest = (v: Uint8Array): { k: number; d: number } => {
    let k = -1;
    let d = Infinity;
    for (let i = 0; i < cls.length; i++) {
      const x = distMean(v, cls[i].mean);
      if (x < d) (d = x), (k = i);
    }
    return { k, d };
  };
  const seed = (c: Cand) => c.p < SURE && c.move;
  for (const c of cands) {
    if (!seed(c)) continue;
    const { k, d } = nearest(c.vec);
    if (k >= 0 && d < tau) add(cls[k], c.vec);
    else {
      const cl = { sum: new Float32Array(c.vec.length), n: 0, mean: new Float32Array(c.vec.length) };
      add(cl, c.vec);
      cls.push(cl);
    }
  }
  // κάθε υποψήφιος στην πιο κοντινή ομάδα, αν μοιάζει (οι μοναχικές «ομάδες» δεν τραβούν άλλους)
  cands.forEach((c, i) => {
    const { k, d } = nearest(c.vec);
    if (k >= 0 && d < tau && (cls[k].n >= 2 || seed(c))) cluster[i] = k;
  });
  const stats = cls.map(() => ({ n: 0, read: 0, chars: new Map<string, number>() }));
  cands.forEach((c, i) => {
    const k = cluster[i];
    if (k < 0) return;
    const s = stats[k];
    s.n++;
    if (c.p >= SURE) {
      s.read++;
      s.chars.set(c.ch, (s.chars.get(c.ch) ?? 0) + 1);
    }
  });
  const keep: number[] = [];
  let clusters = 0;
  stats.forEach((s, k) => {
    const top = Math.max(0, ...s.chars.values());
    // γράμμα: σχεδόν πάντα διαβασμένο, με τον ίδιο χαρακτήρα
    if (s.read > 0.6 * s.n && top > 0.5 * s.n) keep[k] = -1;
    // μοναχικός σπόρος: σύμβολο χωρίς ομάδα
    else if (s.n < 2 || clusters >= LONE) keep[k] = LONE;
    else keep[k] = clusters++;
  });
  for (let i = 0; i < cluster.length; i++) if (cluster[i] >= 0) cluster[i] = keep[cluster[i]];
  // ενωμένη μορφή και κομμάτια της: σύμβολο είναι η ενωμένη, αν ανήκει σε ομάδα· αλλιώς τα κομμάτια
  const inGroup = (k: number) => k >= 0 && k !== LONE;
  const byLine = new Map<string, number[]>();
  cands.forEach((c, i) => {
    const key = `${c.page}:${c.line}`;
    const a = byLine.get(key);
    if (a) a.push(i);
    else byLine.set(key, [i]);
  });
  cands.forEach((c, i) => {
    if (c.span < 2) return;
    const parts = byLine.get(`${c.page}:${c.line}`)!.filter((j) => j !== i && cands[j].glyph >= c.glyph && cands[j].glyph + cands[j].span <= c.glyph + c.span);
    if (inGroup(cluster[i])) for (const j of parts) cluster[j] = -1;
    else if (parts.some((j) => cluster[j] >= 0) || cluster[i] === LONE) cluster[i] = -1;
  });
  return { cluster, clusters };
}

/** Ο χαρακτήρας με τον οποίο γράφεται ένα σύμβολο της ομάδας `k`. */
export const figChar = (k: number): string => (k === LONE ? FIG_LONE : String.fromCharCode(FIG_BASE + k));

// ---------------------------------------------------------------------------- κείμενο και λέξεις
/** Ένας χαρακτήρας του τελικού κειμένου και ο γλύφος από τον οποίο βγήκε (-1: κενό). */
interface Cell {
  s: string;
  g: number;
}

/**
 * Το κείμενο της γραμμής ως χαρακτήρες με τον γλύφο τους. `figs`: γλύφος → σύμβολο κομματιού που γράφεται στη θέση του
 * (οι χαρακτήρες του μοντέλου πάνω σε τέτοιο γλύφο φεύγουν, εκτός από την τελεία του αριθμού κίνησης, που η στοίχιση
 * δίνει συχνά στο σύμβολο)· `spans`: σύμβολα από ενωμένους γλύφους (πρώτος γλύφος → πόσοι).
 */
function lineCells(l: PLine, figs: Map<number, string>, spans: Map<number, number>): Cell[] {
  // (ενωμένο σύμβολο: οι υπόλοιποι γλύφοι του είναι σαν να μην υπάρχουν)
  const host = new Map<number, number>();
  for (const [k, n] of spans) for (let j = 1; j < n; j++) host.set(k + j, k);
  const cells: Cell[] = [];
  const last = () => cells[cells.length - 1]?.s ?? '';
  const order = [...figs.keys()].sort((a, b) => a - b);
  let next = 0;
  let prevG = -1;
  const flush = (upto: number) => {
    while (next < order.length && order[next] < upto) {
      if (cells.length && !/[\s.(\[…=]/.test(last())) cells.push({ s: ' ', g: -1 });
      cells.push({ s: figs.get(order[next])!, g: order[next] });
      next++;
      prevG = -1;
    }
  };
  l.chars.forEach((ch, i) => {
    const g = host.get(l.assign[i]) ?? l.assign[i];
    if (ch.ch === ' ') {
      if (cells.length && last() !== ' ') cells.push({ s: ' ', g: -1 });
      return;
    }
    if (figs.has(g)) {
      // («12.♘f3»: η τελεία μένει, πριν από το σύμβολο)
      if ((ch.ch === '.' || ch.ch === '…') && next < order.length && order[next] === g) cells.push({ s: ch.ch, g: -1 });
      flush(g + 1);
      return;
    }
    flush(g);
    // «23.a4!N a6»: το «N» (νέα κίνηση) κολλημένο σε κίνηση, και μετά κενό στο μελάνι που το μοντέλο δεν έγραψε
    if (prevG >= 0 && g !== prevG && /[a-h]/.test(ch.ch) && /[KQRBN]/.test(last()) && /[!?+#\d]/.test(cells[cells.length - 2]?.s ?? '') && l.glyphs[g].x0 - l.glyphs[prevG].x1 >= 0.15 * l.em) {
      cells.push({ s: ' ', g: -1 });
    }
    cells.push({ s: ch.ch, g });
    prevG = g;
  });
  flush(Infinity);
  if (!figs.size) return cells;
  // διορθώσεις γύρω από τα σύμβολα, πάνω στο κείμενο (κάθε κελί είναι ένας χαρακτήρας του)
  let cs = cells;
  const each = (re: RegExp, fn: (m: RegExpExecArray, drop: Set<number>) => void) => {
    const t = cs.map((c) => (c.s.length === 1 ? c.s : '\u0000')).join('');
    const drop = new Set<number>();
    for (let m = re.exec(t); m; m = re.exec(t)) fn(m, drop);
    if (drop.size) cs = cs.filter((_, i) => !drop.has(i));
  };
  // το σύμβολο κολλά στην κίνησή του («♘ c7» → «♘c7»)
  each(new RegExp(`${FIG_SRC}( +)(?=x?[a-h1-8])`, 'g'), (m, drop) => {
    for (let k = 0; k < m[1].length; k++) drop.add(m.index + 1 + k);
  });
  // «7. ♗xh6», «6... ♘h6»: το κενό ανάμεσα στον αριθμό κίνησης και το σύμβολο φεύγει (το μοντέλο το γράφει εκεί που δεν
  // διάβασε το σύμβολο· ο αναλυτής περιμένει «7.♗xh6», όπως στα ψηφιακά βιβλία)
  each(new RegExp(`\\d(?:\\.{1,3}|…|\\.…)( +)${FIG_SRC}`, 'g'), (m, drop) => {
    for (let k = 0; k < m[1].length; k++) drop.add(m.index + m[0].length - 1 - m[1].length + k);
  });
  // «xxc8» = xc8 (ψεύτικος χαρακτήρας πάνω στο σύμβολο που πήγε στον διπλανό γλύφο)
  each(new RegExp(`${FIG_SRC}[x×]([x×])(?=[a-h][1-8])`, 'g'), (m, drop) => {
    drop.add(m.index + m[0].length - 1);
  });
  // «cl» = c1 μετά από σύμβολο
  each(new RegExp(`${FIG_SRC}[a-h]?[1-8]?[x×]?[a-h]([lI])(?![a-z\\d])`, 'g'), (m) => {
    cs[m.index + m[0].length - 1].s = '1';
  });
  // προαγωγή: «e8= ♕ ♖xe8» → «e8=♕ ♖xe8»
  each(new RegExp(`[a-h][18]=( +)${FIG_SRC}(?![a-h1-8x])`, 'g'), (m, drop) => {
    for (let k = 0; k < m[1].length; k++) drop.add(m.index + 3 + k);
  });
  return cs;
}

/** Το κείμενο μιας γραμμής (για δοκιμές και μετρήσεις). */
export function lineText(l: PLine, figs: Map<number, string> = new Map(), spans: Map<number, number> = new Map()): string {
  return lineCells(l, figs, spans)
    .map((c) => c.s)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PWord {
  text: string;
  /** στην εικόνα της σελίδας (pixel) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** πάχος γραμμής των γραμμάτων της (pixel), 0 αν δεν μετρήθηκε */
  sw: number;
}

/** Οι λέξεις μιας γραμμής με τη θέση τους στη σελίδα (από τους γλύφους τους). */
export function lineWords(l: PLine, figs: Map<number, string> = new Map(), spans: Map<number, number> = new Map()): PWord[] {
  const cells = lineCells(l, figs, spans);
  const words: PWord[] = [];
  let cur: Cell[] = [];
  const end = () => {
    if (!cur.length) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const sws: number[] = [];
    const seen = new Set<number>();
    for (const c of cur) {
      if (c.g < 0 || seen.has(c.g)) continue;
      seen.add(c.g);
      const n = spans.get(c.g) ?? 1;
      for (let k = c.g; k < c.g + n; k++) {
        const g = l.glyphs[k];
        x0 = Math.min(x0, g.x0);
        x1 = Math.max(x1, g.x1);
        y0 = Math.min(y0, g.y0);
        y1 = Math.max(y1, g.y1);
      }
      // (τα σύμβολα κομματιών και τα σημεία στίξης δεν δείχνουν το πάχος των γραμμάτων)
      const g = l.glyphs[c.g];
      if (!figs.has(c.g) && g.sw > 0 && g.y1 - g.y0 + 1 >= 0.3 * l.em) sws.push(g.sw);
    }
    if (x1 >= x0) {
      sws.sort((a, b) => a - b);
      words.push({ text: cur.map((c) => c.s).join(''), x0: l.box.x0 + x0, y0: l.box.y0 + y0, x1: l.box.x0 + x1 + 1, y1: l.box.y0 + y1 + 1, sw: sws.length ? sws[sws.length >> 1] : 0 });
    }
    cur = [];
  };
  for (const c of cells) {
    if (c.s === ' ') end();
    else cur.push(c);
  }
  end();
  return words;
}
