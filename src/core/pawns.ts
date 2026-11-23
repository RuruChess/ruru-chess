/**
 * Αναζήτηση δομής πιονιών (όπως το «Pawns» / «Files» του Scid):
 * η κύρια γραμμή περνά κάποια στιγμή από θέση με αυτή τη δομή πιονιών, όπου κι
 * αν είναι τα κομμάτια. Τρόποι: ακριβώς τα ίδια πιόνια και των δύο χρωμάτων· μόνο τα λευκά·
 * μόνο τα μαύρα· μόνο οι στήλες (πόσα πιόνια κάθε χρώματος σε κάθε στήλη, σε όποια γραμμή).
 */
import { BLACK_BIT, PAWN, type Position } from './chess.ts';
import { replayMainline } from './codec.ts';

export type PawnMode = 'exact' | 'white' | 'black' | 'files';
export const PAWN_MODES: readonly PawnMode[] = ['exact', 'white', 'black', 'files'];

export interface PawnSpec {
  mode: PawnMode;
  /** μάσκα στηλών (bit 0 = στήλη a) ανά γραμμή: [0] = 1η … [7] = 8η */
  white: number[];
  black: number[];
}

const POP = Uint8Array.from({ length: 256 }, (_, i) => {
  let n = 0;
  for (let x = i; x; x &= x - 1) n++;
  return n;
});

/** Διαβάζει τη δομή από FEN (ή μόνο το πρώτο του πεδίο)· null αν δεν είναι έγκυρο. */
export function parsePawns(fen: string, mode: PawnMode = 'exact'): PawnSpec | null {
  if (!PAWN_MODES.includes(mode)) return null;
  const rows = fen.trim().split(/\s+/)[0]?.split('/') ?? [];
  if (rows.length !== 8) return null;
  const white = new Array<number>(8).fill(0);
  const black = new Array<number>(8).fill(0);
  for (let i = 0; i < 8; i++) {
    const rank = 7 - i;
    let file = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') file += Number(ch);
      else if ('pnbrqkPNBRQK'.includes(ch)) {
        if (file > 7) return null;
        if (ch === 'P' || ch === 'p') {
          if (rank === 0 || rank === 7) return null;
          (ch === 'P' ? white : black)[rank] |= 1 << file;
        }
        file++;
      } else return null;
    }
    if (file !== 8) return null;
  }
  return { mode, white, black };
}

/** Τα πιόνια της θέσης ως μάσκες στηλών ανά γραμμή. */
export function pawnMasks(pos: Position, w: Uint8Array, b: Uint8Array): void {
  w.fill(0);
  b.fill(0);
  const board = pos.board;
  for (let sq = 0x10; sq < 0x70; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const x = board[sq];
    if (x === PAWN) w[sq >> 4] |= 1 << (sq & 7);
    else if (x === (PAWN | BLACK_BIT)) b[sq >> 4] |= 1 << (sq & 7);
  }
}

/** 3 bits ανά στήλη (bit της στήλης f → 1 << 3f): το άθροισμα των γραμμών δίνει πόσα πιόνια έχει κάθε στήλη (ως 6). */
const SPREAD = Uint32Array.from({ length: 256 }, (_, m) => {
  let x = 0;
  for (let f = 0; f < 8; f++) if (m & (1 << f)) x += 1 << (3 * f);
  return x;
});

function fileCounts(m: Uint8Array): number {
  return SPREAD[m[1]] + SPREAD[m[2]] + SPREAD[m[3]] + SPREAD[m[4]] + SPREAD[m[5]] + SPREAD[m[6]];
}

function count(m: Uint8Array): number {
  return POP[m[1]] + POP[m[2]] + POP[m[3]] + POP[m[4]] + POP[m[5]] + POP[m[6]];
}

export const PAWNS_NO = 0;
export const PAWNS_MATCH = 1;
/** η δομή δεν μπορεί πια να εμφανιστεί σε αυτή την παρτίδα */
export const PAWNS_DEAD = 2;

/**
 * Ετοιμάζει τον έλεγχο μιας δομής. Κλάδεμα: τα πιόνια πάνε μόνο μπροστά και μόνο
 * λιγοστεύουν, άρα (για τα λευκά) το πλήθος στις γραμμές ≤ r δεν αυξάνεται ποτέ, και
 * πιόνι που έφυγε από τη 2η γραμμή δεν ξαναγυρίζει (αντίστοιχα τα μαύρα με τις γραμμές ≥ r και την 7η).
 */
export function pawnMatcher(spec: PawnSpec): (w: Uint8Array, b: Uint8Array) => number {
  const tw = Uint8Array.from(spec.white);
  const tb = Uint8Array.from(spec.black);
  if (spec.mode === 'files') {
    const fw = fileCounts(tw);
    const fb = fileCounts(tb);
    const nw = count(tw);
    const nb = count(tb);
    return (w, b) => {
      if (count(w) < nw || count(b) < nb) return PAWNS_DEAD;
      return fileCounts(w) === fw && fileCounts(b) === fb ? PAWNS_MATCH : PAWNS_NO;
    };
  }
  const checkW = spec.mode !== 'black';
  const checkB = spec.mode !== 'white';
  // ελάχιστα πιόνια στις γραμμές ≤ r (λευκά) / ≥ r (μαύρα) που χρειάζεται ακόμη η δομή
  const needW = new Int8Array(8);
  const needB = new Int8Array(8);
  for (let r = 1, s = 0; r < 7; r++) needW[r] = s += POP[tw[r]];
  for (let r = 6, s = 0; r > 0; r--) needB[r] = s += POP[tb[r]];
  return (w, b) => {
    if (checkW) {
      if (tw[1] & ~w[1]) return PAWNS_DEAD;
      for (let r = 1, s = 0; r < 7; r++) if ((s += POP[w[r]]) < needW[r]) return PAWNS_DEAD;
    }
    if (checkB) {
      if (tb[6] & ~b[6]) return PAWNS_DEAD;
      for (let r = 6, s = 0; r > 0; r--) if ((s += POP[b[r]]) < needB[r]) return PAWNS_DEAD;
    }
    for (let r = 1; r < 7; r++) if ((checkW && w[r] !== tw[r]) || (checkB && b[r] !== tb[r])) return PAWNS_NO;
    return PAWNS_MATCH;
  };
}

/**
 * Αν η κύρια γραμμή περνά από τη δομή. Ελέγχεται μόνο όταν μπορεί να άλλαξε
 * (αρχή, μετά από αιχμαλωσία ή κίνηση πιονιού: halfmove = 0)· σταματά νωρίς όταν δεν γίνεται πια.
 */
export function gameHasPawns(tokens: Uint16Array, fen: string | null, test: (w: Uint8Array, b: Uint8Array) => number, pos: Position, w: Uint8Array, b: Uint8Array): boolean {
  let found = false;
  replayMainline(tokens, pos, fen, (p, ply) => {
    if (ply > 0 && p.halfmove !== 0) return false;
    pawnMasks(p, w, b);
    const s = test(w, b);
    if (s === PAWNS_MATCH) found = true;
    return s !== PAWNS_NO;
  });
  return found;
}

/** Τα τετράγωνα των πιονιών για εμφάνιση, π.χ. «a2 b2 c3 d4 – a7 b6 c7». */
export function describePawns(spec: PawnSpec): string {
  const list = (m: number[]) => {
    const out: string[] = [];
    for (let f = 0; f < 8; f++) for (let r = 1; r < 7; r++) if (m[r] & (1 << f)) out.push('abcdefgh'[f] + (r + 1));
    return out.join(' ') || '—';
  };
  return `${list(spec.white)} – ${list(spec.black)}`;
}
