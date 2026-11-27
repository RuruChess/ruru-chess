/**
 * Σύμβολα αξιολόγησης ζωγραφισμένα ως μικρές εικόνες μέσα στο κείμενο (±, ⩲, ⩱, ∓, ↑,
 * →, ⇄, □ δεν υπάρχουν στο κείμενο του PDF, μόνο ως εικόνες 12×13 κ.λπ.). Αναγνώριση από το σχήμα, όχι από
 * αποτυπώματα, ώστε να δουλεύει σε κάθε βιβλίο: οριζόντιες γραμμές, ο κάθετος άξονας του «+», βέλη, θηλιές του ∞.
 */

export interface SymbolBitmap {
  w: number;
  h: number;
  /** γκρι, 0 = μαύρο */
  px: Uint8Array;
}

/** Ο χαρακτήρας που καταλαβαίνει το bookparse (nagsOf), ή null για εικόνα που δεν είναι σύμβολο. */
export function symbolOf(img: SymbolBitmap): string | null {
  const { w, h, px } = img;
  if (w < 4 || h < 4 || w > 48 || h > 48) return null;
  const dark = (x: number, y: number) => px[y * w + x] < 160;
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (dark(x, y)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return null;
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  const row = (y: number) => {
    let n = 0;
    let first = -1;
    let last = -1;
    // το μεγαλύτερο συνεχόμενο σκούρο κομμάτι: μπάρα είναι μία γραμμή, όχι σκόρπια pixel (οι θηλιές του ∞)
    let run = 0;
    let maxRun = 0;
    for (let x = x0; x <= x1; x++)
      if (dark(x, y)) {
        n++;
        if (first < 0) first = x;
        last = x;
        maxRun = Math.max(maxRun, ++run);
      } else run = 0;
    return { n, first, last, maxRun };
  };
  const rows = Array.from({ length: H }, (_, i) => row(y0 + i));
  let filled = 0;
  for (const r of rows) filled += r.n;
  // γεμάτο τετράγωνο (π.χ. ■): όχι σύμβολο
  if (filled > 0.75 * W * H) return null;
  // άδειο τετράγωνο με περίγραμμα: □ (μοναδική κίνηση)
  const hollow = rows.slice(2, -2).filter((r) => r.n > 0 && r.n <= 4 && r.first - x0 <= 1 && x1 - r.last <= 2).length;
  if (W >= 8 && H >= 8 && Math.abs(W - H) <= 3 && hollow >= 0.6 * (H - 4) && rows[0].n >= 0.7 * W) return '□';

  // κάθετο βέλος (↑ πρωτοβουλία): ψηλό και στενό, η μύτη (οι φαρδύτερες γραμμές) πάνω ή κάτω
  if (H >= 1.6 * W) {
    const top = rows.slice(0, Math.ceil(H / 3)).reduce((m, r) => Math.max(m, r.n), 0);
    const bottom = rows.slice(-Math.ceil(H / 3)).reduce((m, r) => Math.max(m, r.n), 0);
    const mid = rows[Math.floor(H / 2)].n;
    if (top > mid + 1 && top >= bottom) return '↑';
    if (bottom > mid + 1) return '↓';
    return null;
  }

  const isBar = rows.map((r) => r.maxRun >= 0.6 * W);
  const bars: Array<[number, number]> = [];
  for (let i = 0; i < H; i++) {
    if (!isBar[i]) continue;
    let j = i;
    while (j + 1 < H && isBar[j + 1]) j++;
    bars.push([i, j]);
    i = j;
  }
  // γραμμή «άξονα»: λίγα σκούρα pixel, κοντά στη μέση
  const centre = (W - 1) / 2;
  const axis = (i: number) => {
    const r = rows[i];
    if (!r || isBar[i] || r.n === 0 || r.n > Math.max(3, 0.34 * W)) return false;
    return Math.abs((r.first + r.last) / 2 - x0 - centre) <= 0.25 * W;
  };

  // οριζόντιο βέλος/βέλη: φαρδύ, μύτες στις άκρες έξω από τις γραμμές
  if (W >= 1.25 * H && bars.length >= 1 && bars.length <= 2) {
    const heads = (b: [number, number]) => {
      // σκούρα pixel σε γραμμές δίπλα στη γραμμή-άξονα του βέλους, αριστερά ή δεξιά
      let left = 0;
      let right = 0;
      for (let i = Math.max(0, b[0] - 3); i <= Math.min(H - 1, b[1] + 3); i++) {
        if (isBar[i]) continue;
        const r = rows[i];
        if (!r.n) continue;
        const mx = (r.first + r.last) / 2 - x0;
        if (mx > 0.6 * W) right++;
        else if (mx < 0.4 * W) left++;
      }
      return { left, right };
    };
    const hs = bars.map(heads);
    if (bars.length === 1 && hs[0].right >= 2 && hs[0].left === 0) return '→';
    if (bars.length === 1 && hs[0].left >= 2 && hs[0].right === 0) return '←';
    if (bars.length === 2 && ((hs[0].right >= 1 && hs[1].left >= 1) || (hs[0].left >= 1 && hs[1].right >= 1))) return '⇄';
  }

  // ∞ πάνω από γραμμές: αντιστάθμισμα (δύο ή περισσότερα σκούρα κομμάτια ανά γραμμή πάνω από τις γραμμές)
  if (bars.length >= 1 && bars[0][0] >= 4) {
    let loops = 0;
    for (let i = 0; i < bars[0][0]; i++) {
      let runs = 0;
      for (let x = x0, prev = false; x <= x1; x++) {
        const d = dark(x, y0 + i);
        if (d && !prev) runs++;
        prev = d;
      }
      if (runs >= 3) loops++;
    }
    if (loops >= 2) return '©';
  }

  // σύμβολα από «+» και γραμμές, από πάνω προς τα κάτω: P = γραμμή που τη διασχίζει ο άξονας (το «+»), B = σκέτη
  const seq = bars
    .map(([a, b]) => {
      const above = axis(a - 1) || axis(a - 2);
      const below = axis(b + 1) || axis(b + 2);
      return above && below ? 'P' : 'B';
    })
    .join('');
  // ο άξονας πρέπει να εξηγεί όλα τα υπόλοιπα σκούρα pixel (αλλιώς δεν είναι τέτοιο σύμβολο, π.χ. γράμμα)
  // (οι γραμμές ακριβώς πάνω/κάτω από μια μπάρα είναι η θολή άκρη της: επιτρέπονται)
  const fringe = (i: number) => isBar[i - 1] || isBar[i + 1];
  const stray = rows.some((r, i) => r.n > 0 && !isBar[i] && !axis(i) && !fringe(i));
  if (stray) return null;
  return { PB: '±', BP: '∓', PBB: '⩲', BBP: '⩱', BB: '=', P: '+' }[seq] ?? null;
}
