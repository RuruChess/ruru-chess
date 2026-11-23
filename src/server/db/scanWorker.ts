/**
 * Worker σάρωσης κινήσεων: παίζει την κύρια γραμμή κάθε παρτίδας ενός εύρους (ή μιας
 * λίστας ids) και επιστρέφει όσες ταιριάζουν (υλικό ή θέση).
 */
import { parentPort } from 'node:worker_threads';
import { BLACK_BIT, PAWN, Position } from '../../core/chess.ts';
import { replayMainline } from '../../core/codec.ts';
import { gameHasMaterial } from '../../core/material.ts';
import { gameHasManeuver } from '../../core/maneuver.ts';
import { gameHasPawns, pawnMatcher } from '../../core/pawns.ts';
import { GameDatabase } from './store.ts';
import type { ScanJob, ScanSpec } from './scan.ts';

const open = new Map<string, GameDatabase>();
const pos = new Position();
const counts = new Int32Array(16);
const pw = new Uint8Array(8);
const pb = new Uint8Array(8);

/** Κομμάτια και πιόνια στη 2η / 7η γραμμή (μάσκα στηλών): δεν αυξάνονται ποτέ μέσα σε μια παρτίδα. */
function shape(p: Position): { pieces: number; w2: number; b7: number } {
  let pieces = 0;
  let w2 = 0;
  let b7 = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const x = p.board[sq];
    if (!x) continue;
    pieces++;
    if (x === PAWN && sq >> 4 === 1) w2 |= 1 << (sq & 7);
    else if (x === (PAWN | BLACK_BIT) && sq >> 4 === 6) b7 |= 1 << (sq & 7);
  }
  return { pieces, w2, b7 };
}

function matcher(spec: ScanSpec): (tokens: Uint16Array, fen: string | null) => boolean {
  if (spec.kind === 'material') return (t, f) => gameHasMaterial(t, f, spec.material, spec.anyColor, pos, counts);
  if (spec.kind === 'maneuver') return (t, f) => gameHasManeuver(t, f, spec.maneuver, pos);
  if (spec.kind === 'pawns') {
    const test = pawnMatcher(spec.pawns);
    return (t, f) => gameHasPawns(t, f, test, pos, pw, pb);
  }
  const goal = Position.fromFen(spec.fen);
  const target = shape(goal);
  return (t, f) => {
    let found = false;
    replayMainline(t, pos, f, (p, ply) => {
      if (p.hashHi === goal.hashHi && p.hashLo === goal.hashLo) return (found = true);
      if (ply > 0 && p.halfmove !== 0) return false;
      // μετά από αιχμαλωσία ή κίνηση πιονιού η θέση μπορεί να έγινε απρόσιτη
      const s = shape(p);
      return s.pieces < target.pieces || (target.w2 & ~s.w2) !== 0 || (target.b7 & ~s.b7) !== 0;
    });
    return found;
  };
}

parentPort!.on('message', (m: ScanJob) => {
  try {
    let db = open.get(m.file);
    if (!db) open.set(m.file, (db = new GameDatabase(m.file, { reader: true })));
    const test = matcher(m.spec);
    const out: number[] = [];
    if (m.ids) {
      for (const id of m.ids) {
        const g = db.moveData(id);
        if (g && test(g.tokens, g.fen)) out.push(id);
      }
    } else {
      for (const g of db.movesInRange(m.from!, m.to!)) if (test(g.tokens, g.fen)) out.push(g.id);
    }
    const ids = Int32Array.from(out);
    parentPort!.postMessage({ ids }, [ids.buffer as ArrayBuffer]);
  } catch (e) {
    parentPort!.postMessage({ error: (e as Error).message });
  }
});
