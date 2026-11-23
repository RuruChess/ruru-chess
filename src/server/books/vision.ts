/**
 * Διαγράμματα-εικόνες: εντοπισμός σκακιέρας σε εικόνα σελίδας (σκαναρισμένης ή αποδοσμένης) ή σε εικόνα του PDF, και
 * τα 64 τετράγωνά της ως χαρακτηριστικά για την αναγνώριση των κομματιών (pieces.ts). Χωρίς βιβλιοθήκες: οι εικόνες
 * είναι γκρι, 8 bit (0 = μαύρο).
 *
 * Σκακιέρα = μια συνεκτική μαύρη περιοχή (πλαίσιο, σκούρα τετράγωνα, κομμάτια) σχεδόν τετράγωνη, που μέσα της τα
 * τετράγωνα εναλλάσσονται ανοιχτά/σκούρα (γραμμοσκίαση, γκρι ή μαύρα). Τα κομμάτια σπάνια φτάνουν στις γωνίες ενός
 * τετραγώνου, άρα οι γωνίες δείχνουν το χρώμα του.
 */

export interface Gray {
  w: number;
  h: number;
  /** 0 = μαύρο, 255 = λευκό, γραμμή-γραμμή από πάνω */
  px: Uint8Array;
}

/** Η σκακιέρα στην εικόνα: τα τετράγωνα (χωρίς το πλαίσιο), πάνω αριστερά και πλευρά, σε pixel. */
export interface BoardBox {
  x: number;
  y: number;
  side: number;
  /** ύψος, όταν διαφέρει από την πλευρά (σελίδα με λίγο διαφορετική κλίμακα στους δύο άξονες)· αλλιώς τετράγωνη */
  h?: number;
}

/** BMP (8 bit με παλέτα γκρι, ή 24/32 bit) σε γκρι εικόνα. */
export function readBmp(b: Buffer): Gray {
  if (b.toString('latin1', 0, 2) !== 'BM') throw new Error('Δεν είναι BMP');
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const hh = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  const h = Math.abs(hh);
  const bytes = bpp >> 3;
  if (![1, 3, 4].includes(bytes)) throw new Error(`BMP ${bpp} bit`);
  const stride = (w * bytes + 3) & ~3;
  const pal = 14 + b.readUInt32LE(14);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = off + (hh < 0 ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = row + x * bytes;
      px[y * w + x] = bytes === 1 ? b[pal + 4 * b[i] + 1] : (b[i] * 29 + b[i + 1] * 150 + b[i + 2] * 77) >> 8;
    }
  }
  return { w, h, px };
}

/** Γκρι εικόνα σε BMP 8 bit (για το OCR των Windows). */
export function writeBmp(img: Gray): Buffer {
  const stride = (img.w + 3) & ~3;
  const off = 14 + 40 + 1024;
  const b = Buffer.alloc(off + stride * img.h);
  b.write('BM', 0, 'latin1');
  b.writeUInt32LE(b.length, 2);
  b.writeUInt32LE(off, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(img.w, 18);
  b.writeInt32LE(-img.h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(8, 28);
  b.writeUInt32LE(stride * img.h, 34);
  b.writeUInt32LE(256, 46);
  for (let i = 0; i < 256; i++) b.fill(i, 54 + 4 * i, 54 + 4 * i + 3);
  for (let y = 0; y < img.h; y++) b.set(img.px.subarray(y * img.w, (y + 1) * img.w), off + y * stride);
  return b;
}

/** Μεγέθυνση/σμίκρυνση με γραμμική παρεμβολή. */
export function resize(img: Gray, w: number, h: number): Gray {
  const px = new Uint8Array(w * h);
  const sx = img.w / w;
  const sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5);
    const y0 = Math.min(img.h - 1, Math.floor(fy));
    const y1 = Math.min(img.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5);
      const x0 = Math.min(img.w - 1, Math.floor(fx));
      const x1 = Math.min(img.w - 1, x0 + 1);
      const tx = fx - x0;
      const a = img.px[y0 * img.w + x0] * (1 - tx) + img.px[y0 * img.w + x1] * tx;
      const c = img.px[y1 * img.w + x0] * (1 - tx) + img.px[y1 * img.w + x1] * tx;
      px[y * w + x] = Math.round(a * (1 - ty) + c * ty);
    }
  }
  return { w, h, px };
}

/** Πίνακας αθροισμάτων (summed-area) μιας περιοχής της εικόνας: η «μαυρίλα» (0…1) κάθε ορθογωνίου σε σταθερό χρόνο. */
export type Dark = (x0: number, y0: number, x1: number, y1: number) => number;

export function integral(img: Gray, rx: number, ry: number, rw: number, rh: number): Dark {
  rx = Math.max(0, Math.floor(rx));
  ry = Math.max(0, Math.floor(ry));
  rw = Math.min(img.w - rx, Math.ceil(rw));
  rh = Math.min(img.h - ry, Math.ceil(rh));
  const W = rw + 1;
  const sat = new Float64Array(W * (rh + 1));
  for (let y = 0; y < rh; y++) {
    let row = 0;
    for (let x = 0; x < rw; x++) {
      row += 255 - img.px[(ry + y) * img.w + rx + x];
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  return (x0, y0, x1, y1) => {
    const a = Math.max(0, Math.min(rw, Math.round(x0 - rx)));
    const b = Math.max(0, Math.min(rh, Math.round(y0 - ry)));
    const c = Math.max(0, Math.min(rw, Math.round(x1 - rx)));
    const d = Math.max(0, Math.min(rh, Math.round(y1 - ry)));
    const n = (c - a) * (d - b);
    return n > 0 ? (sat[d * W + c] - sat[b * W + c] - sat[d * W + a] + sat[b * W + a]) / n / 255 : 0;
  };
}

interface Comp {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Υποψήφιες σκακιέρες: η εικόνα σε μπλοκ (μέση μαυρίλα, που σβήνει τη γραμμοσκίαση) και οι συνεκτικές περιοχές
 * (8 γειτόνων) από μπλοκ σκουρότερα από το χαρτί: τα σκούρα τετράγωνα ακουμπούν στις γωνίες, άρα η σκακιέρα (με ή
 * χωρίς πλαίσιο) είναι μία περιοχή. Μόνο όσες είναι σχεδόν τετράγωνες και αρκετά μεγάλες.
 */
export function candidates(img: Gray, minSide: number): Comp[] {
  const B = Math.max(2, Math.min(8, Math.round(Math.min(img.w, img.h) / 220)));
  const bw = Math.floor(img.w / B);
  const bh = Math.floor(img.h / B);
  if (bw < 8 || bh < 8) return [];
  const map = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      for (let y = by * B; y < by * B + B; y++) for (let x = bx * B; x < bx * B + B; x++) s += img.px[y * img.w + x];
      map[by * bw + bx] = 1 - s / (B * B) / 255;
    }
  // το χαρτί: η πιο συχνή τιμή (σε σκαναρισμένες σελίδες δεν είναι καθαρό λευκό)
  const hist = new Uint32Array(101);
  for (const v of map) hist[Math.round(v * 100)]++;
  let paper = 0;
  for (let i = 1; i <= 100; i++) if (hist[i] > hist[paper]) paper = i;
  const t = paper / 100 + 0.05;
  const label = new Int32Array(bw * bh);
  const out: Comp[] = [];
  let next = 0;
  for (let k = 0; k < bw * bh; k++) {
    if (map[k] <= t || label[k]) continue;
    next++;
    const c: Comp = { x0: bw, y0: bh, x1: -1, y1: -1 };
    const stack = [k];
    label[k] = next;
    while (stack.length) {
      const m = stack.pop()!;
      const x = m % bw;
      const y = (m / bw) | 0;
      c.x0 = Math.min(c.x0, x);
      c.x1 = Math.max(c.x1, x);
      c.y0 = Math.min(c.y0, y);
      c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const n = ny * bw + nx;
          if (map[n] > t && !label[n]) (label[n] = next), stack.push(n);
        }
    }
    const w = (c.x1 - c.x0 + 1) * B;
    const h = (c.y1 - c.y0 + 1) * B;
    if (Math.min(w, h) >= minSide && Math.abs(w - h) <= 0.15 * Math.max(w, h)) out.push({ x0: c.x0 * B, y0: c.y0 * B, x1: (c.x1 + 1) * B - 1, y1: (c.y1 + 1) * B - 1 });
  }
  return out;
}

/** Το μοτίβο σκακιέρας (a8 ανοιχτό) στο κουτί: ποσοστό τετραγώνων στη σωστή πλευρά και η μαυρίλα ανοιχτών/σκούρων. */
export function checkerScore(darkness: Dark, b: BoardBox, inner = false): { ok: number; light: number; dark: number } {
  const cell = b.side / 8;
  const ch = (b.h ?? b.side) / 8;
  const p = cell * 0.08;
  const q = cell * 0.24;
  const py = ch * 0.08;
  const qy = ch * 0.24;
  const corner = (r: number, c: number) => {
    const x = b.x + c * cell;
    const y = b.y + r * ch;
    // οι τέσσερις γωνίες· η πιο ανοιχτή (σε σκούρο) ή η πιο σκούρα (σε ανοιχτό) μπορεί να έχει κομμάτι: η διάμεσος
    const v = [darkness(x + p, y + py, x + q, y + qy), darkness(x + cell - q, y + py, x + cell - p, y + qy), darkness(x + p, y + ch - qy, x + q, y + ch - py), darkness(x + cell - q, y + ch - qy, x + cell - p, y + ch - py)].sort((a, z) => a - z);
    return (v[1] + v[2]) / 2;
  };
  const vals: Array<{ dark: boolean; v: number }> = [];
  // (`inner`: χωρίς τα τετράγωνα της περιμέτρου, που τα επηρεάζει το πλαίσιο· για την ευθυγράμμιση)
  const lo = inner ? 1 : 0;
  const hi = inner ? 7 : 8;
  for (let r = lo; r < hi; r++) for (let c = lo; c < hi; c++) vals.push({ dark: (r + c) % 2 === 1, v: corner(r, c) });
  const med = (xs: number[]) => [...xs].sort((a, z) => a - z)[xs.length >> 1];
  const light = med(vals.filter((x) => !x.dark).map((x) => x.v));
  const dark = med(vals.filter((x) => x.dark).map((x) => x.v));
  const mid = (light + dark) / 2;
  const ok = vals.filter((x) => (x.v > mid) === x.dark).length / vals.length;
  return { ok, light, dark };
}

/**
 * Ευθυγράμμιση με το πλέγμα: η θέση και η πλευρά με τη μεγαλύτερη αντίθεση σκούρων/ανοιχτών τετραγώνων (το πλαίσιο,
 * όταν υπάρχει, είναι χοντρό, διπλό ή σκαναρισμένο, άρα δεν δίνει μόνο του τα όρια). `free`: το ύψος αλλάζει χωριστά
 * από το πλάτος (σκακιέρα όχι ακριβώς τετράγωνη στην εικόνα, ως 6%).
 */
export function align(dk: Dark, b: BoardBox, free = false): { b: BoardBox; s: { ok: number; light: number; dark: number } } {
  // (`free`: και η συμφωνία των τετραγώνων· σε αχνά σκούρα τετράγωνα η αντίθεση μόνη της δεν αλλάζει με μικρές μετακινήσεις)
  const contrast = (s: { ok: number; light: number; dark: number }) => (s.dark - s.light) * (free ? s.ok : 1);
  // αναρρίχηση: θέση και πλευρά, με όλο και μικρότερο βήμα, ως 0,3 τετραγώνου από την αρχική
  const cell0 = b.side / 8;
  let best = { b, s: checkerScore(dk, b) };
  for (const st of [cell0 / 8, cell0 / 16, Math.max(0.5, cell0 / 48)]) {
    // μετακίνηση και αλλαγή πλευράς· `free`: και κάθε ακμή χωριστά (αριστερή, πάνω, κάτω· η δεξιά είναι η αλλαγή πλάτους)
    const moves: number[][] = [
      [st, 0, 0, 0],
      [-st, 0, 0, 0],
      [0, st, 0, 0],
      [0, -st, 0, 0],
      [0, 0, 2 * st, 0],
      [0, 0, -2 * st, 0],
    ];
    if (free) moves.push([0, 0, 0, st], [0, 0, 0, -st], [st, 0, -st, 0], [-st, 0, st, 0], [0, st, 0, -st], [0, -st, 0, st]);
    for (let it = 0; it < (free ? 24 : 12); it++) {
      let moved = false;
      for (const [dx, dy, dw, dh] of moves) {
        const cand: BoardBox = { x: best.b.x + dx, y: best.b.y + dy, side: best.b.side + dw };
        if (free) {
          cand.h = (best.b.h ?? best.b.side) + dh;
          if (Math.abs(cand.h - (b.h ?? b.side)) > cell0 * 0.6 || Math.abs(cand.h - cand.side) > 0.06 * cand.side) continue;
        }
        if (Math.abs(cand.x - b.x) > cell0 * 0.3 || Math.abs(cand.y - b.y) > cell0 * 0.3 || Math.abs(cand.side - b.side) > cell0 * 0.6) continue;
        const s = checkerScore(dk, cand);
        if (contrast(s) > contrast(best.s) + 1e-6) {
          best = { b: cand, s };
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return best;
}

/**
 * Οι σκακιέρες μιας εικόνας (από πάνω προς τα κάτω, από αριστερά προς τα δεξιά). `weak`: εδώ μπαίνουν οι περιοχές που
 * μοιάζουν με σκακιέρα αλλά όχι αρκετά για να διαβαστεί η θέση τους (ό,τι «κείμενο» βρεθεί μέσα τους είναι κομμάτια).
 */
export function findBoards(img: Gray, minSide = 64, weak?: BoardBox[]): BoardBox[] {
  const out: BoardBox[] = [];
  // οι μεγαλύτερες πρώτα: μια περιοχή μέσα σε σκακιέρα που βρέθηκε δεν χρειάζεται ευθυγράμμιση
  const cands = candidates(img, minSide).sort((p, q) => q.x1 - q.x0 - (p.x1 - p.x0));
  for (const c of cands) {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    const side = (w + h) / 2;
    const cx = c.x0 + w / 2;
    const cy = c.y0 + h / 2;
    if (out.some((o) => cx > o.x && cx < o.x + o.side && cy > o.y && cy < o.y + (o.h ?? o.side))) continue;
    const dk = integral(img, c.x0 - side * 0.1, c.y0 - side * 0.1, side * 1.2, side * 1.2);
    // γεμάτες σκακιέρες (π.χ. η αρχική θέση) κρύβουν γωνίες: λιγότερη συμφωνία αρκεί όταν η αντίθεση είναι μεγάλη
    const good = (t: { ok: number; light: number; dark: number }) => !(t.ok < (t.dark - t.light > 0.15 ? 0.75 : 0.85) || t.dark - t.light < 0.06);
    let { b, s } = align(dk, { x: c.x0, y: c.y0, side });
    // σκακιέρα όχι ακριβώς τετράγωνη στην εικόνα (π.χ. 711 × 731 pixel): το τετράγωνο πλέγμα πέφτει πάνω στο πλαίσιο στις
    // δύο πλευρές και τα ακριανά τετράγωνα βγαίνουν λάθος. Δεύτερη προσπάθεια με χωριστό πλάτος και ύψος.
    if (!good(s)) {
      const t = align(dk, { x: c.x0, y: c.y0, side: w, h }, true);
      if (good(t.s)) ({ b, s } = t);
    }
    if (!good(s)) {
      if (weak && s.ok >= 0.7 && s.dark - s.light >= 0.05) weak.push({ x: c.x0, y: c.y0, side: w, h });
      continue;
    }
    // μία σκακιέρα ανά περιοχή: όχι «υπο-σκακιέρες» μέσα σε μια μεγαλύτερη (ή η ίδια δύο φορές)
    const inside = (o: BoardBox, p: BoardBox) => p.x + p.side / 2 > o.x && p.x + p.side / 2 < o.x + o.side && p.y + (p.h ?? p.side) / 2 > o.y && p.y + (p.h ?? p.side) / 2 < o.y + (o.h ?? o.side);
    const clash = out.findIndex((o) => inside(o, b) || inside(b, o));
    if (clash >= 0) {
      if (out[clash].side >= b.side) continue;
      out.splice(clash, 1);
    }
    out.push(b);
  }
  return out.sort((p, q) => (Math.abs(p.y - q.y) < p.side / 2 ? p.x - q.x : p.y - q.y));
}

/** Ένα τετράγωνο της σκακιέρας για την αναγνώριση: εικόνες N×N με τη διαφορά από το φόντο του τετραγώνου (0 = φόντο). */
export interface Cell {
  /** σκούρο τετράγωνο */
  dark: boolean;
  /** η εικόνα, κεντραρισμένη στο κομμάτι (άδειο τετράγωνο: κενός πίνακας, για λιγότερη μνήμη σε μεγάλα βιβλία) */
  sharp: Float32Array;
  /** η αντίθεση φόντου: |σκούρα − ανοιχτά| της σκακιέρας */
  contrast: number;
  /** η μαυρίλα του φόντου του τετραγώνου */
  bg: number;
  /** υπάρχει κομμάτι (σε σχέση με τα άλλα τετράγωνα του ίδιου χρώματος στη σκακιέρα) */
  occ: boolean;
}

export const N = 16;

/** Τα 64 τετράγωνα (a8…h1, γραμμή-γραμμή από πάνω). */
export function boardCells(img: Gray, b: BoardBox): Cell[] {
  const cell = b.side / 8;
  const ch = (b.h ?? b.side) / 8;
  const darkness = integral(img, b.x - 2, b.y - 2, b.side + 4, (b.h ?? b.side) + 4);
  const { light, dark } = checkerScore(darkness, b);
  const out: Cell[] = [];
  const wins: number[] = [];
  const strokeCounts: number[] = [];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const isDark = (row + col) % 2 === 1;
      const bg = isDark ? dark : light;
      // λίγο μέσα από τα όρια, για να μη μετρούν οι γραμμές του πλέγματος, το πλαίσιο και τα διπλανά τετράγωνα
      const m = cell * 0.08;
      const my = ch * 0.08;
      const x0 = b.x + col * cell + m;
      const y0 = b.y + row * ch + my;
      const step = (cell - 2 * m) / N;
      const stepY = (ch - 2 * my) / N;
      const sharp = new Float32Array(N * N);
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const cx = x0 + (i + 0.5) * step;
          const cy = y0 + (j + 0.5) * stepY;
          sharp[j * N + i] = darkness(cx - step / 2, cy - stepY / 2, cx + step / 2, cy + stepY / 2) - bg;
        }
      // η μεγαλύτερη απόκλιση από το φόντο σε εννέα κεντρικά παράθυρα (30% του τετραγώνου): ένα λευκό κομμάτι σε
      // γραμμοσκιασμένο τετράγωνο είναι πιο ανοιχτό από αυτό, και όταν η εικόνα είναι θολή
      let win = 0;
      for (const fy of [0.3, 0.5, 0.7])
        for (const fx of [0.35, 0.5, 0.65]) {
          const v = darkness(x0 - m + cell * (fx - 0.15), y0 - my + ch * (fy - 0.15), x0 - m + cell * (fx + 0.15), y0 - my + ch * (fy + 0.15)) - bg;
          if (Math.abs(v) > Math.abs(win)) win = v;
        }
      let strokes = 0;
      for (const v of sharp) if (Math.abs(v) > 0.25) strokes++;
      wins.push(win);
      strokeCounts.push(strokes);
      out.push({ dark: isDark, sharp, contrast: Math.abs(dark - light), bg, occ: false });
    }
  // κατειλημμένα: σε σχέση με τα (κυρίως άδεια) τετράγωνα του ίδιου χρώματος της σκακιέρας
  for (const isDark of [false, true]) {
    const idx = out.flatMap((c, i) => (c.dark === isDark ? [i] : []));
    const med = (xs: number[]) => [...xs].sort((a, z) => a - z)[xs.length >> 1];
    // η βάση από τα τετράγωνα με τις λιγότερες γραμμές (σχεδόν σίγουρα άδεια· σε γραμμοσκίαση 1 bit όλα έχουν γραμμές)
    // (το 25ο εκατοστημόριο: σε θέσεις ανοίγματος τα μισά τετράγωνα έχουν κομμάτι)
    const usual = [...idx.map((i) => strokeCounts[i])].sort((a, z) => a - z)[idx.length >> 2];
    const calm = idx.filter((i) => strokeCounts[i] <= (usual > 8 ? usual : 2));
    const ref = calm.length >= 6 ? calm : idx;
    const base = med(ref.map((i) => wins[i]));
    const mad = med(ref.map((i) => Math.abs(wins[i] - base)));
    // γραμμές «πάνω από τις συνηθισμένες» του χρώματος (η γραμμοσκίαση δεν μετρά)
    const extra = (i: number) => strokeCounts[i] - (usual > 8 ? usual : 0);
    const limit = Math.max(0.06, 4 * mad);
    // απόκλιση με λίγες γραμμές μόνο αν είναι μεγάλη (θόρυβος θολής εικόνας), ή πολλές γραμμές με μικρή απόκλιση
    // (λευκό κομμάτι σε λευκό τετράγωνο: σχεδόν μόνο περίγραμμα· σε σκούρο, με το λευκό του περίγυρο, περισσότερες)
    for (const i of idx) {
      const dev = Math.abs(wins[i] - base);
      out[i].occ = (dev > limit && extra(i) >= 4) || dev > 0.2 || (!isDark && extra(i) > N * N * 0.03 && dev > 0.03) || (isDark && extra(i) > N * N * 0.1);
    }
  }
  for (const c of out) c.sharp = c.occ ? centered(c.sharp) : EMPTY;
  return out;
}

const EMPTY = new Float32Array(0);

/**
 * Η εικόνα μετατοπισμένη ώστε το κέντρο βάρους του κομματιού να πέφτει στο κέντρο: η
 * ευθυγράμμιση του πλέγματος έχει λάθος ενός-δύο pixel, που αλλιώς κάνει το ίδιο κομμάτι να μοιάζει άλλο.
 */
function centered(a: Float32Array): Float32Array {
  let sx = 0;
  let sy = 0;
  let m = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = Math.abs(a[y * N + x]);
      if (v < 0.15) continue;
      sx += v * x;
      sy += v * y;
      m += v;
    }
  if (m < 1) return a;
  const dx = sx / m - (N - 1) / 2;
  const dy = sy / m - (N - 1) / 2;
  if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return a;
  const out = new Float32Array(N * N);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : a[y * N + x]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const fx = x + dx;
      const fy = y + dy;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      out[y * N + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }
  return out;
}
