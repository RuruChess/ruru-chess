/**
 * Αναζήτηση υλικού: η κύρια γραμμή περνά κάποια
 * στιγμή από θέση με ακριβώς αυτό το υλικό. Μορφή: «KRP-KR», «KRP vs KR», «KRPKR».
 * Ο βασιλιάς εννοείται· «*» = οσαδήποτε πιόνια (τουλάχιστον όσα P γράφονται, π.χ.
 * «R*-R*» όλα τα φινάλε πύργων)· «M» = ελαφρύ κομμάτι (αξιωματικός ή ίππος).
 */
import { BISHOP, BLACK_BIT, KNIGHT, PAWN, QUEEN, ROOK, type Position } from './chess.ts';
import { replayMainline } from './codec.ts';

export interface SideMaterial {
  q: number;
  r: number;
  b: number;
  n: number;
  /** ελαφρά κομμάτια χωρίς είδος (αξιωματικός ή ίππος) */
  m: number;
  p: number;
  /** τουλάχιστον p πιόνια αντί για ακριβώς p */
  anyPawns: boolean;
}

export interface MaterialSpec {
  white: SideMaterial;
  black: SideMaterial;
}

function parseSide(s: string): SideMaterial | null {
  const r: SideMaterial = { q: 0, r: 0, b: 0, n: 0, m: 0, p: 0, anyPawns: false };
  let kings = 0;
  for (const ch of s) {
    if (ch === 'K') kings++;
    else if (ch === 'Q') r.q++;
    else if (ch === 'R') r.r++;
    else if (ch === 'B') r.b++;
    else if (ch === 'N') r.n++;
    else if (ch === 'M') r.m++;
    else if (ch === 'P') r.p++;
    else if (ch === '*') r.anyPawns = true;
    else return null;
  }
  return kings > 1 ? null : r;
}

/** Διαβάζει το υλικό (λευκά πρώτα)· null αν το κείμενο δεν είναι έγκυρο. */
export function parseMaterial(text: string): MaterialSpec | null {
  let parts = text
    .trim()
    .toUpperCase()
    .split(/\s*(?:\bVS?\b\.?|[-–:/])\s*|\s+/)
    .filter(Boolean);
  // «KRPKR»: χωρίζει στον δεύτερο βασιλιά
  if (parts.length === 1) {
    const k = parts[0].indexOf('K', 1);
    if (k > 0) parts = [parts[0].slice(0, k), parts[0].slice(k)];
  }
  if (parts.length !== 2) return null;
  const white = parseSide(parts[0]);
  const black = parseSide(parts[1]);
  return white && black ? { white, black } : null;
}

/** Πλήθος κομματιών ανά κωδικό (1–6 λευκά, 9–14 μαύρα). */
export function materialCounts(pos: Position, out: Int32Array): void {
  out.fill(0);
  const b = pos.board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    out[b[sq]]++;
  }
}

function sideMatches(c: Int32Array, color: number, s: SideMaterial): boolean {
  if (c[QUEEN | color] !== s.q || c[ROOK | color] !== s.r) return false;
  const p = c[PAWN | color];
  if (s.anyPawns ? p < s.p : p !== s.p) return false;
  const b = c[BISHOP | color];
  const n = c[KNIGHT | color];
  if (s.m) return b >= s.b && n >= s.n && b + n === s.b + s.n + s.m;
  return b === s.b && n === s.n;
}

export function materialMatches(c: Int32Array, spec: MaterialSpec, anyColor: boolean): boolean {
  if (sideMatches(c, 0, spec.white) && sideMatches(c, BLACK_BIT, spec.black)) return true;
  return anyColor && sideMatches(c, 0, spec.black) && sideMatches(c, BLACK_BIT, spec.white);
}

/**
 * Αν η κύρια γραμμή περνά από το υλικό. Ελέγχεται μόνο όταν μπορεί να άλλαξε
 * (αρχή, μετά από αιχμαλωσία ή κίνηση πιονιού: halfmove = 0).
 */
export function gameHasMaterial(tokens: Uint16Array, fen: string | null, spec: MaterialSpec, anyColor: boolean, pos: Position, counts: Int32Array): boolean {
  let found = false;
  replayMainline(tokens, pos, fen, (p, ply) => {
    if (ply > 0 && p.halfmove !== 0) return false;
    materialCounts(p, counts);
    return (found = materialMatches(counts, spec, anyColor));
  });
  return found;
}
