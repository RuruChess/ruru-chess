/**
 * Διαγράμματα γραμμένα με γραμματοσειρά σκακιού (Alpha, Merida, Leipzig κ.ά.): κάθε
 * γραμμή της σκακιέρας είναι κείμενο («+l+ +», «PzP»), άρα η θέση διαβάζεται ακριβώς, χωρίς αναγνώριση εικόνας.
 * Μαζί τους ο αριθμός της άσκησης δίπλα στη σκακιέρα, η επικεφαλίδα πάνω της (παίκτες, τόπος, χρονιά) και το
 * σημάδι για το ποιος παίζει (μικρό σύμβολο στη δεξιά πλευρά: ψηλά ο Μαύρος, χαμηλά ο Λευκός).
 */
import type { BookDiagram } from '../../core/bookparse.ts';

export type Item = { str: string; x: number; y: number; w: number; size: number; font: string; diagram?: BookDiagram };

/** Η αντιστοίχιση των γραμματοσειρών Alpha/Merida: πεζά σε λευκό τετράγωνο, κεφαλαία σε μαύρο. */
const PIECE: Record<string, string> = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K', o: 'p', m: 'n', v: 'b', t: 'r', w: 'q', l: 'k' };
const EMPTY_LIGHT = new Set([' ', '*']);
const EMPTY_DARK = new Set(['+']);
const BOARD_RE = /^[ +*pnbrqkomvtwlPNBRQKOMVTWL1-9!"#$%&'()/:;<=>?@[\]À-Ïà-ï]+$/;
/** Το πλαίσιο της Alpha: δεξιά «3» (πάνω), «5», «9» (κάτω)· αριστερά «1», «4», «7» και οι αριθμοί À…Ç. */
const RIGHT_EDGE = new Set(['3', '5', '9']);
const LEFT_EDGE = /^[147À-Ç]$/;

/** Οι γραμματοσειρές «symbol» δίνουν τους χαρακτήρες στην περιοχή U+F0xx: πίσω στα γράμματα της γραμματοσειράς. */
const unPua = (s: string) => s.replace(/[-]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xf000));

type Cell = { x: number; y: number; c: string; item: Item };
type Seg = { y: number; cells: Cell[]; x0: number; x1: number };

const isSquare = (c: string) => EMPTY_LIGHT.has(c) || EMPTY_DARK.has(c) || c in PIECE || c.toLowerCase() in PIECE;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Τα διαγράμματα μιας σελίδας και τα υπόλοιπα κομμάτια κειμένου (χωρίς όσα ανήκουν στα διαγράμματα). */
export function findDiagrams(items: Item[]): { diagrams: Item[]; rest: Item[] } {
  // ανά γραμματοσειρά και μέγεθος: δύο σκακιέρες της ίδιας σελίδας μπορεί να έχουν άλλο μέγεθος κελιού (15 και 18pt)
  const byFont = new Map<string, Item[]>();
  for (const it of items) {
    const key = `${it.font}|${Math.round(it.size)}`;
    const list = byFont.get(key) ?? [];
    list.push(it);
    byFont.set(key, list);
  }
  const used = new Set<Item>();
  const diagrams: Item[] = [];
  for (const list of byFont.values()) {
    const board = list.filter((it) => BOARD_RE.test(unPua(it.str)));
    const chars = (xs: Item[]) => xs.reduce((n, it) => n + it.str.length, 0);
    if (board.length < 8 || chars(board) < chars(list) * 0.9) continue;
    const cell = median(board.map((it) => it.w / Math.max(1, it.str.length)));
    if (!(cell > 2)) continue;
    // κελιά (ένα ανά χαρακτήρα) σε γραμμές, και κάθε γραμμή σε κομμάτια όπου τα κελιά είναι κοντά
    const cells: Cell[] = [];
    for (const it of board) {
      const s = unPua(it.str);
      const cw = it.w / Math.max(1, s.length);
      for (let i = 0; i < s.length; i++) cells.push({ x: it.x + i * cw, y: it.y, c: s[i], item: it });
    }
    cells.sort((a, b) => b.y - a.y || a.x - b.x);
    const segs: Seg[] = [];
    for (const c of cells) {
      // δύο σκακιέρες δίπλα δίπλα (σελίδες ασκήσεων): το δεξί πλαίσιο της μιας απέχει ~2 κελιά από το αριστερό
      // της άλλης· πάνω από ένα κελί κενό μετά από δεξί πλαίσιο ή πριν από αριστερό δεν ενώνει τις γραμμές τους
      const apart = (s: Seg) => c.x - s.x1 > cell * 1.5 && (RIGHT_EDGE.has(s.cells[s.cells.length - 1].c) || LEFT_EDGE.test(c.c));
      const row = segs.filter((s) => Math.abs(s.y - c.y) < cell * 0.3 && c.x - s.x1 < cell * 2.5 && c.x - s.x1 > -cell * 0.5 && !apart(s));
      const s = row[row.length - 1];
      if (s) {
        s.cells.push(c);
        s.x1 = c.x;
      } else segs.push({ y: c.y, cells: [c], x0: c.x, x1: c.x });
    }
    // τα κομμάτια σε στήλες: το καθένα με το από κάτω του (απόσταση ενός κελιού, επικάλυψη στον άξονα x)
    const taken = new Set<Seg>();
    for (const top of segs) {
      if (taken.has(top)) continue;
      const block = [top];
      for (;;) {
        const prev = block[block.length - 1];
        const next = segs.find((s) => !taken.has(s) && !block.includes(s) && prev.y - s.y > cell * 0.75 && prev.y - s.y < cell * 1.3 && Math.min(prev.x1, s.x1) - Math.max(prev.x0, s.x0) > -cell * 0.5);
        if (!next) break;
        block.push(next);
      }
      const d = readBoard(block, cell);
      if (!d) continue;
      for (const s of block) taken.add(s);
      for (const s of block) for (const c of s.cells) used.add(c.item);
      diagrams.push(d);
    }
  }
  if (!diagrams.length) return { diagrams, rest: items };
  return { diagrams, rest: annotateDiagrams(diagrams, items, used) };
}

/**
 * Αριθμός, επικεφαλίδα και σημάδι σειράς γύρω από κάθε σκακιέρα (και των διαγραμμάτων-εικόνων): μένουν στο
 * διάγραμμα και φεύγουν από το κείμενο, που επιστρέφεται. `used`: κομμάτια που ήδη ανήκουν σε σκακιέρες.
 */
export function annotateDiagrams(diagrams: Item[], items: Item[], used = new Set<Item>()): Item[] {
  // το συνηθισμένο μέγεθος γραμμάτων της σελίδας
  const sizes = items.map((it) => it.size).sort((a, b) => a - b);
  const textSize = sizes.length ? sizes[sizes.length >> 1] : 0;
  for (const d of diagrams) {
    const cell = d.size;
    const left = d.x;
    const right = d.x + d.w;
    const top = d.y;
    const bottom = d.y - 9 * cell;
    const near = items.filter((it) => !used.has(it) && it.str.trim());
    // διάγραμμα-εικόνα: ο αριθμός συχνά κάτω από τη σκακιέρα, με τη σειρά («19. White to move»)· η σειρά και από
    // μια γραμμή «Position after White's 26th move» λίγο πάνω ή κάτω
    if (d.diagram?.id !== undefined) {
      if (below(d, near, used)) continue;
      const around = near.filter((it) => it.y > d.y - 8 * cell - cell * 2 && it.y < d.y + cell * 2 && it.x + it.w > d.x - cell && it.x < d.x + d.w + cell);
      for (const y0 of [...new Set(around.map((it) => Math.round(it.y)))]) {
        const line = around.filter((it) => Math.abs(it.y - y0) < cell * 0.4).sort((a, b) => a.x - b.x);
        const t = turnOf(line.map((it) => it.str).join(' '));
        if (t) {
          d.diagram.turn = t;
          break;
        }
      }
    }
    const marker = near.find((it) => unPua(it.str).trim().length <= 2 && !/\d/.test(it.str) && it.x >= right - cell * 0.8 && it.x <= right + cell * 2.5 && it.y > bottom && it.y < top);
    if (marker) {
      used.add(marker);
      d.diagram!.turn = marker.y > (top + bottom) / 2 ? 'b' : 'w';
    }
    // «W» / «B» αριστερά από τη σκακιέρα (ένδειξη σειράς)· αλλιώς έμενε στο κείμενο και κολλούσε στην
    // κίνηση που ακολουθεί («B 18 … ♗xb2»)
    const letter = marker ? undefined : near.find((it) => /^[WB]$/.test(it.str.trim()) && it.x + it.w <= left + cell * 0.3 && it.x >= left - cell * 2.5 && it.y > bottom && it.y < top);
    if (letter) {
      used.add(letter);
      d.diagram!.turn = letter.str.trim() === 'B' ? 'b' : 'w';
    }
    // ο αριθμός αριστερά από τη σκακιέρα, αλλιώς από πάνω της (ο πιο κοντινός)
    // (διάγραμμα-εικόνα: μόνο με τελεία ή παρένθεση, «26.», «(26)»· ένας σκέτος αριθμός εκεί είναι συνήθως κίνηση ή σελίδα)
    // («7)» που κλείνει την παρένθεση της προηγούμενης λέξης είναι παραπομπή του κειμένου, «…3 exd5 (Diagram 7)», όχι
    // αριθμός άσκησης)
    const reference = (it: Item) => {
      const i = items.indexOf(it);
      return /^\d+\)$/.test(it.str.trim()) && i > 0 && /\([^)]*$/.test(items[i - 1].str.trim());
    };
    const num = (it: Item) => !used.has(it) && !reference(it) && (d.diagram?.id !== undefined ? /^(?:\(\d{1,4}\)|\d{1,4}[.)])$/ : /^\(?\d{1,4}[.)]?$/).test(it.str.trim());
    const dist = (a: Item, b: Item) => Math.hypot(a.x - left, a.y - top) - Math.hypot(b.x - left, b.y - top);
    const beside = near.filter((it) => num(it) && it.x + it.w <= left + cell * 0.3 && it.x >= left - cell * 5 && it.y > bottom && it.y <= top);
    // (πάνω από διάγραμμα-εικόνα μόνο πολύ κοντά: πιο πάνω είναι συνήθως αριθμός κίνησης του κειμένου)
    const reach = d.diagram?.id !== undefined ? 1.2 : 3;
    const above = near.filter((it) => num(it) && it.y > top - cell * 0.3 && it.y <= top + cell * reach && it.x >= left - cell * 3 && it.x <= right + cell);
    // (σελίδα από εικόνα: και σκέτος αριθμός, όταν είναι μεγάλος, ≥ 1,4 φορές τα γράμματα της σελίδας, δίπλα στην πάνω
    // άκρη, αριστερά ή δεξιά στο εξωτερικό περιθώριο. Χωρίς αυτόν οι λύσεις δεν έβρισκαν την άσκησή τους στα
    // σκαναρισμένα βιβλία ασκήσεων. Και βαριά γραφή σε κάθε μέγεθος, ή έντονη ≥ 1,15, καθώς το μέγεθος που μετρά ο
    // αναγνώστης για δύο ψηφία είναι αναξιόπιστο)
    const big =
      d.diagram?.id !== undefined
        ? near.find((it) => !used.has(it) && it.font.startsWith('ocr') && /^\d{1,4}$/.test(it.str.trim()) && (it.size >= 1.4 * textSize || /^ocr-h/.test(it.font) || (/^ocr-b/.test(it.font) && it.size >= 1.15 * textSize)) && it.y >= top - cell * 1.6 && it.y <= top + cell * 0.5 && ((it.x + it.w <= left + cell * 0.3 && it.x >= left - cell * 3) || (it.x >= right - cell * 0.3 && it.x <= right + cell * 3)))
        : undefined;
    const label = (beside.length ? beside : above).sort(dist)[0] ?? big;
    if (!label) continue;
    used.add(label);
    d.diagram!.label = label.str.replace(/\D/g, '');
    const cap = near
      .filter((it) => !used.has(it) && it.y > top - cell * 0.2 && it.y <= top + cell * 2.2 && it.x + it.w > left - cell * 3 && it.x < right + cell * 1.5)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    if (cap.length) {
      const y0 = cap[0].y;
      const line = cap.filter((it) => Math.abs(it.y - y0) < cell * 0.4);
      let text = '';
      let end = -Infinity;
      for (const it of line) {
        text += (text && it.x - end > it.size * 0.18 && !/\s$/.test(text) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
        end = it.x + it.w;
        used.add(it);
      }
      d.diagram!.caption = text.replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/^\d{1,4}[.)]\s*/, '').trim();
    }
  }
  return items.filter((it) => !used.has(it));
}

/** Η σειρά από τη λεζάντα: «White to move», «Black to play», «Παίζει ο Μαύρος». */
export function turnOf(text: string): 'w' | 'b' | null {
  // «Position after White's 26th move»: παίζει ο άλλος
  const after = /\b(?:position\s+)?after\s+(white|black)['’]?s\b/i.exec(text);
  if (after) return after[1].toLowerCase() === 'white' ? 'b' : 'w';
  // «Diagram 7 (B)»: το γράμμα στην παρένθεση
  const diagTurn = /\bDiagram\s+\d{1,4}\s*\(([WB])\)/.exec(text);
  if (diagTurn) return diagTurn[1] === 'W' ? 'w' : 'b';
  if (/\b(white|weiß|weiss)\b[^.]{0,20}\b(to (move|play)|zieht|am zug)|(παίζει|παίζουν) (ο |τα )?λευκ/i.test(text)) return 'w';
  if (/\b(black|schwarz)\b[^.]{0,20}\b(to (move|play)|zieht|am zug)|(παίζει|παίζουν) (ο |τα )?μαύρ/i.test(text)) return 'b';
  return null;
}

/**
 * Αριθμός και λεζάντα κάτω από ένα διάγραμμα-εικόνα: η πρώτη γραμμή ως 2,2 τετράγωνα κάτω, πάνω από τη σκακιέρα στον
 * άξονα x, που αρχίζει με αριθμό και τελεία ή παρένθεση (όχι «14 Nc5»: αυτό είναι κείμενο με κινήσεις).
 */
function below(d: Item, near: Item[], used: Set<Item>): boolean {
  const cell = d.size;
  const bottom = d.y - 8 * cell;
  const cand = near.filter((it) => !used.has(it) && it.y < bottom && it.y > bottom - cell * 2.2 && it.x + it.w > d.x && it.x < d.x + d.w).sort((a, b) => b.y - a.y || a.x - b.x);
  if (!cand.length) return false;
  const y0 = cand[0].y;
  const line = cand.filter((it) => Math.abs(it.y - y0) < cell * 0.4);
  const text = line.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
  const m = /^\(?(\d{1,4})\s?[.)]\s*(.*)$/.exec(text);
  // μετά τον αριθμό: τίποτα ή κείμενο («White to move»), όχι κίνηση («8 ... Nxe5», «14. Nc5»)
  if (!m || (m[2] && !/^[A-Za-zΑ-Ωα-ωά-ώ]/.test(m[2])) || /^(?:[KQRBN]?[a-h]?x?[a-h][1-8]|O-O)/.test(m[2])) return false;
  for (const it of line) used.add(it);
  d.diagram!.label = m[1];
  d.diagram!.caption = m[2].trim();
  d.diagram!.turn = turnOf(m[2]) ?? d.diagram!.turn;
  return true;
}

/** Οκτώ γραμμές τετραγώνων (με ή χωρίς πλαίσιο) σε θέση· `null` αν δεν είναι σκακιέρα. */
function readBoard(block: Seg[], cell: number): Item | null {
  const ranks = block.filter((s) => s.cells.some((c) => isSquare(c.c) && c.c !== ' ') || s.cells.filter((c) => isSquare(c.c)).length >= 6);
  if (ranks.length !== 8) return null;
  // το x της στήλης a: από το αριστερό πλαίσιο, αλλιώς από το πρώτο τετράγωνο (με έλεγχο του χρώματος των τετραγώνων)
  const borders = ranks.filter((s) => !isSquare(s.cells[0].c)).map((s) => s.cells[0].x);
  const firstSq = Math.min(...ranks.map((s) => s.cells.find((c) => isSquare(c.c))?.x ?? Infinity));
  const starts = borders.length >= 4 ? [median(borders) + cell] : [firstSq, firstSq - cell, firstSq - 2 * cell];
  // συντεταγμένες στο αριστερό πλαίσιο (À…Ç = 1…8): ανεστραμμένη σκακιέρα όταν το 1 είναι πάνω
  const coord = ranks[0].cells.find((c) => c.c >= 'À' && c.c <= 'Ç');
  const flipped = coord ? coord.c === 'À' : false;
  let best: { placement: string; bad: number } | null = null;
  for (const xa of starts) {
    const grid: string[][] = Array.from({ length: 8 }, () => Array(8).fill(''));
    let bad = 0;
    let off = false;
    ranks.forEach((s, ri) => {
      for (const c of s.cells) {
        if (!isSquare(c.c)) continue;
        const col = Math.round((c.x - xa) / cell);
        if (col < 0 || col > 7) {
          if (c.c !== ' ') off = true;
          continue;
        }
        const r = flipped ? ri : 7 - ri;
        const f = flipped ? 7 - col : col;
        const dark = (f + r) % 2 === 0;
        const piece = PIECE[c.c] ?? PIECE[c.c.toLowerCase()];
        const darkGlyph = EMPTY_DARK.has(c.c) || (piece !== undefined && c.c !== c.c.toLowerCase());
        if (darkGlyph !== dark && c.c !== ' ') bad++;
        if (piece) grid[7 - r][f] = piece;
      }
    });
    if (off) continue;
    const placement = grid.map((row) => row.map((p) => p || '1').join('').replace(/1+/g, (m) => String(m.length))).join('/');
    if (!best || bad < best.bad) best = { placement, bad };
  }
  if (!best || !validPlacement(best.placement)) return null;
  const top = ranks[0].y + cell;
  return {
    str: '\u0001',
    x: starts[0],
    y: top,
    w: cell * 8,
    size: cell,
    font: '#diagram',
    diagram: { placement: best.placement, turn: null, label: null, caption: '', x: starts[0], y: top },
  };
}

/** Ένας βασιλιάς ανά χρώμα, ως 16 κομμάτια ανά πλευρά, όχι πιόνια στην 1η/8η γραμμή. */
export function validPlacement(placement: string): boolean {
  const rows = placement.split('/');
  if (rows.length !== 8) return false;
  const count = (re: RegExp) => (placement.match(re) ?? []).length;
  if (count(/K/g) !== 1 || count(/k/g) !== 1) return false;
  if (count(/[PNBRQK]/g) > 16 || count(/[pnbrqk]/g) > 16 || count(/P/g) > 8 || count(/p/g) > 8) return false;
  return !/[Pp]/.test(rows[0]) && !/[Pp]/.test(rows[7]);
}
