import { describe, expect, it } from 'vitest';
import { boardCells, findBoards, readBmp, writeBmp, type Cell, type Gray } from '../src/server/books/vision.ts';
import { fillPolygons, pathPolygons, pieceTemplates, placements, readBoards, refine } from '../src/server/books/pieces.ts';
import { annotateDiagrams, turnOf, type Item } from '../src/server/books/diagrams.ts';
import { dropStrayLabels, pageLines, textQuality } from '../src/server/books/pdf.ts';
import { movesFit, placementDiff, type DiagramEvidence } from '../src/core/bookparse.ts';

// Συνθετική σελίδα: σκακιέρα με πλαίσιο, γραμμοσκιασμένα σκούρα τετράγωνα και «κομμάτια» (γεμάτοι ή άδειοι κύκλοι)
function page(pieces: Record<string, 'b' | 'w'>, x0 = 100, y0 = 150, side = 400): Gray {
  const w = 700;
  const h = 800;
  const px = new Uint8Array(w * h).fill(255);
  const cell = side / 8;
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = v;
  };
  for (let y = y0 - 4; y < y0 + side + 4; y++)
    for (let x = x0 - 4; x < x0 + side + 4; x++) {
      const inside = x >= x0 && x < x0 + side && y >= y0 && y < y0 + side;
      if (!inside) {
        if (x < x0 - 1 || x > x0 + side || y < y0 - 1 || y > y0 + side) set(x, y, 0);
        continue;
      }
      const c = Math.floor((x - x0) / cell);
      const r = Math.floor((y - y0) / cell);
      if ((r + c) % 2 === 1 && (x + y) % 6 < 2) set(x, y, 0);
    }
  for (const [sq, color] of Object.entries(pieces)) {
    const c = sq.charCodeAt(0) - 97;
    const r = 8 - Number(sq[1]);
    const cx = x0 + (c + 0.5) * cell;
    const cy = y0 + (r + 0.5) * cell;
    for (let y = Math.floor(cy - cell / 2); y < cy + cell / 2; y++)
      for (let x = Math.floor(cx - cell / 2); x < cx + cell / 2; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < cell * 0.4) set(x, y, 255); // λευκός περίγυρος (καθαρίζει τη γραμμοσκίαση)
        if (color === 'b' ? d < cell * 0.3 : Math.abs(d - cell * 0.28) < 2) set(x, y, 0);
      }
  }
  return { w, h, px };
}

describe('διαγράμματα-εικόνες: εντοπισμός σκακιέρας', () => {
  const pieces = { e1: 'w', e8: 'b', d4: 'w', c5: 'b', h7: 'b', a2: 'w' } as const;
  const img = page(pieces);

  it('βρίσκει τη σκακιέρα μέσα στο πλαίσιο', () => {
    const boards = findBoards(img);
    expect(boards).toHaveLength(1);
    // (ως 0,15 τετραγώνου: τα τετράγωνα διαβάζονται με περιθώριο, και τα κομμάτια κεντράρονται)
    expect(Math.abs(boards[0].x - 100)).toBeLessThanOrEqual(8);
    expect(Math.abs(boards[0].y - 150)).toBeLessThanOrEqual(8);
    expect(Math.abs(boards[0].side - 400)).toBeLessThanOrEqual(12);
  });

  it('κατειλημμένα τετράγωνα: μόνο όπου υπάρχει κομμάτι, σε ανοιχτά και γραμμοσκιασμένα', () => {
    const cells = boardCells(img, findBoards(img)[0]);
    const occ = cells.flatMap((c, i) => (c.occ ? [`${'abcdefgh'[i % 8]}${8 - (i >> 3)}`] : []));
    expect(occ.sort()).toEqual(Object.keys(pieces).sort());
  });

  it('σελίδα χωρίς σκακιέρα (κείμενο, πλαίσια): τίποτα', () => {
    const w = 400;
    const h = 300;
    const px = new Uint8Array(w * h).fill(255);
    for (let y = 20; y < 280; y += 12) for (let x = 20; x < 380; x++) if ((x >> 3) % 5 !== 4) px[y * w + x] = 0;
    expect(findBoards({ w, h, px })).toEqual([]);
  });

  it('BMP 8 bit: γράψιμο και διάβασμα', () => {
    const g: Gray = { w: 5, h: 3, px: Uint8Array.from([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 255]) };
    expect(readBmp(writeBmp(g))).toEqual(g);
  });
});

describe('διαγράμματα-εικόνες: κομμάτια', () => {
  it('SVG path σε μάσκα (γραμμές, καμπύλες, τόξα)', () => {
    const area = (d: string) => fillPolygons(pathPolygons(d), 20, 2).reduce((n, v) => n + v, 0);
    expect(area('M0 0H10V10H0Z')).toBe(400);
    expect(area('M0 0h5v10H0z')).toBe(200);
    // κύκλος ακτίνας 5 με δύο τόξα: ≈ π·10² pixel
    expect(Math.abs(area('M0 5a5 5 0 1 0 10 0a5 5 0 1 0-10 0z') - Math.PI * 100)).toBeLessThan(25);
  });

  it('σιλουέτες των κομματιών Merida της εφαρμογής', () => {
    const t = pieceTemplates();
    expect(t.map((x) => x.type)).toEqual(['K', 'Q', 'R', 'B', 'N', 'P']);
    for (const x of t) expect(x.shape.h).toBeGreaterThan(0.6);
  });

  // Συνθετικά τετράγωνα: κάθε κομμάτι (ανά χρώμα τετραγώνου) έχει δικό του μοτίβο, με λίγο θόρυβο
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const patterns = new Map<string, Float32Array>();
  const pattern = (p: string, dark: boolean) => {
    const key = p + dark;
    if (!patterns.has(key)) {
      // μαύρο: γεμάτο (πολύ μελάνι)· λευκό: περίγραμμα, και σε σκούρο τετράγωνο λευκός περίγυρος (αρνητικές τιμές)
      const a = new Float32Array(256);
      const black = p === p.toLowerCase();
      for (let k = 0; k < 256; k++) a[k] = rnd() < (black ? 0.5 : 0.3) ? (black ? 0.65 : 0.35) : dark && !black && rnd() < 0.5 ? -0.3 : 0;
      patterns.set(key, a);
    }
    return patterns.get(key)!;
  };
  const cellsOf = (placement: string): Cell[] => {
    const rows = placement.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(Number(d))));
    return Array.from({ length: 64 }, (_, i) => {
      const dark = ((i >> 3) + (i & 7)) % 2 === 1;
      const p = rows[i >> 3][i & 7];
      const base = p === '.' ? new Float32Array(256) : pattern(p, dark);
      const sharp = base.map((v) => v + (rnd() - 0.5) * 0.06);
      return { dark, sharp, contrast: 0.3, bg: dark ? 0.3 : 0, occ: p !== '.' };
    });
  };
  const truth = [
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R',
    'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR',
    'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R',
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R',
    'r2qkb1r/ppp2ppp/2np1n2/4p2b/2B1P3/2NP1N1P/PPP2PP1/R1BQK2R',
  ];

  it('γνωστές θέσεις από το κείμενο διορθώνουν τα ονόματα των ομάδων', () => {
    const r = readBoards(truth.map(cellsOf));
    const ev = new Map<number, DiagramEvidence>(truth.map((t, i) => [i, { positions: [t] }]));
    refine(r, ev, movesFit);
    expect(placements(r)).toEqual(truth);
  });

  it('η θέση ενός διαγράμματος επιβεβαιώνεται από τις κινήσεις που ακολουθούν', () => {
    expect(movesFit(truth[0], null, [{ san: 'Bb5', num: 3, black: false }, { san: 'a6', num: 3, black: true }])).toBe(2);
    expect(movesFit(truth[0], null, [{ san: 'Bc5', num: 3, black: false }])).toBe(0);
    // σταματά σε βαριάντα (αριθμός που δεν συνεχίζει)
    expect(movesFit(truth[0], null, [{ san: 'Bb5', num: 3, black: false }, { san: 'Bc4', num: 3, black: false }])).toBe(1);
    expect(placementDiff(truth[0], truth[3])).toBe(6);
  });
});

describe('διαγράμματα-εικόνες: αριθμός, λεζάντα, σειρά', () => {
  const board = (x: number, y: number): Item => ({ str: '\u0001', x, y, w: 160, size: 20, font: '#diagram', diagram: { placement: '8/8/8/8/8/8/8/8', turn: null, label: null, caption: '', x, y, id: 0 } });
  const text = (t: string, x: number, y: number): Item => ({ str: t, x, y, w: t.length * 5, size: 10, font: 'ocr' });

  it('«19. White to move» κάτω από τη σκακιέρα', () => {
    const d = board(100, 500);
    const rest = annotateDiagrams([d], [text('19.', 120, 320), text('White', 140, 320), text('to', 170, 320), text('move', 185, 320), text('Other text', 100, 200)]);
    expect(d.diagram).toMatchObject({ label: '19', turn: 'w', caption: 'White to move' });
    expect(rest.map((t) => t.str)).toEqual(['Other text']);
  });

  it('κινήσεις κάτω από τη σκακιέρα δεν είναι αριθμός άσκησης', () => {
    const d = board(100, 500);
    annotateDiagrams([d], [text('8', 100, 320), text('...', 110, 320), text('Nxe5', 130, 320), text('14', 100, 560), text('Nc5', 115, 560)]);
    expect(d.diagram!.label).toBeNull();
  });

  it('σειρά από λεζάντα παλιού βιβλίου', () => {
    expect(turnOf("Position after White's 26th move.")).toBe('b');
    expect(turnOf('Position after Black’s 14th move')).toBe('w');
    expect(turnOf('Black to play and win')).toBe('b');
    expect(turnOf('Παίζει ο Λευκός')).toBe('w');
  });
});

describe('σελίδες για OCR', () => {
  const it2 = (str: string): Item => ({ str, x: 0, y: 0, w: 10, size: 10, font: 'f' });

  it('ποιότητα κειμένου: κανονικό, «σκουπίδια» (χωρίς ToUnicode), σχεδόν τίποτα', () => {
    expect(textQuality(['The hanging pawns at c5 and d5 must be put under pressure.', '1.Ne1! Rbc8 2.Bg4'].map(it2))).toBe('good');
    expect(textQuality(['\u001f 9 \u001d J\u000fÇ Rv~±nÇ´ ¬ Ç«¬ÄnÇ ))\u0007ÇNX\\Ç´¬Ç¢¬ÄnÇ )\u0018\u0004Ç Rz´nÇ´¬Ç¢¬ÄnÇ'].map(it2))).toBe('garbage');
    expect(textQuality(['12'].map(it2))).toBe('none');
  });

  it('διπλή σελίδα με δύο στήλες η καθεμιά: τέσσερις στήλες με τη σειρά', () => {
    const items: Item[] = [];
    // τέσσερις στήλες (x = 0, 220, 600, 820), 12 γραμμές η καθεμιά
    ['A', 'B', 'C', 'D'].forEach((col, k) => {
      for (let i = 0; i < 12; i++) items.push({ str: `${col}${i} text text text`, x: [0, 220, 600, 820][k], y: 700 - i * 14, w: 170, size: 10, font: 'ocr' });
    });
    const order = pageLines(items, 1).map((l) => l.segs.map((s) => s.text).join(' ')[0]);
    expect(order.join('')).toBe('A'.repeat(12) + 'B'.repeat(12) + 'C'.repeat(12) + 'D'.repeat(12));
  });
});

describe('αριθμοί ασκήσεων στα διαγράμματα-εικόνες', () => {
  const d = (label: string | null) => ({ placement: '8/8/8/8/8/8/8/8', turn: null, label, caption: '', id: 0 });
  it('μένουν σε βιβλίο ασκήσεων (συνεχόμενοι, με όποια σειρά στη σελίδα)', () => {
    const ds = ['19', '22', '20', '23', '21', '24', '25'].map(d);
    dropStrayLabels(ds);
    expect(ds.map((x) => x.label)).toEqual(['19', '22', '20', '23', '21', '24', '25']);
  });
  it('φεύγουν σε βιβλίο παρτίδων (αριθμοί κινήσεων)', () => {
    const ds = ['26', '15', '31', '15', '9', '40'].map(d);
    dropStrayLabels(ds);
    expect(ds.every((x) => x.label === null)).toBe(true);
  });
});
