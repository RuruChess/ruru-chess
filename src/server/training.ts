/** Εκπαίδευση ανοιγμάτων: δέντρο ρεπερτορίου από μια βάση και αποθήκευση της προόδου. */
import fs from 'node:fs';
import path from 'node:path';
import { Position, START_FEN } from '../core/chess.ts';
import { TK_NULL, tokenToMove } from '../core/codec.ts';
import { MIN_P, TrainTreeBuilder, pruneByChance, type CardStats, type TrainMove, type TrainTree } from '../core/training.ts';
import type { PositionIndex } from './db/posindex.ts';
import type { Router } from './http.ts';
import { HttpError, type Library } from './library.ts';
import { APP_DIR } from './paths.ts';

/** Ως τόσες παρτίδες το δέντρο φτιάχνεται από τις ίδιες τις παρτίδες (με βαριάντες, σχόλια, σύμβολα). */
const SMALL_DB = 20_000;
const MAX_NODES = 20_000;
const STATS_DIR = path.join(APP_DIR, 'training');

const fenPly = (fen: string) => {
  const f = fen.trim().split(/\s+/);
  return (Math.max(1, Number(f[5]) || 1) - 1) * 2 + (f[1] === 'b' ? 1 : 0);
};

/**
 * Μεγάλες βάσεις: δέντρο από τα προϋπολογισμένα στατιστικά του ευρετηρίου (θέσεις με
 * ≥24 παρτίδες). Σωστές απαντήσεις του χρήστη: κινήσεις με ≥5% των παρτίδων· γραμμές
 * με πιθανότητα ≥ MIN_P (οι κύριες πάνε βαθιά, οι σπάνιες κόβονται νωρίς).
 */
function indexTree(index: PositionIndex, rootFen: string, white: boolean, depth: number, maxNodes: number, games: number): TrainTree {
  const rootKey = Position.fromFen(rootFen).hashKey();
  const nodes: Record<string, TrainMove[]> = {};
  const queue = [{ fen: rootFen, key: rootKey, d: 0 }];
  const prob = new Map([[rootKey, 1]]);
  let truncated = false;
  for (let qi = 0; qi < queue.length; qi++) {
    const { fen, key, d } = queue[qi];
    if (d >= depth) continue;
    const pos = Position.fromFen(fen);
    const t = index.tree(pos.hashHi, pos.hashLo);
    if (!t) continue;
    const user = (pos.turn === 0) === white;
    const total = t.moves.reduce((s, m) => s + m.games, 0);
    const fens = new Map<string, string>();
    const list: TrainMove[] = [];
    for (const tm of t.moves) {
      if (tm.token === TK_NULL || (user && tm.games < 0.05 * total)) continue;
      const mv = tokenToMove(pos, tm.token);
      if (pos.board[mv & 0x7f] === 0 || !pos.isLegalPseudo(mv)) continue;
      const uci = pos.moveToUci(mv);
      const san = pos.san(mv);
      pos.makeMove(mv);
      const to = pos.hashKey();
      fens.set(to, pos.fen());
      pos.unmakeMove();
      list.push({ uci, san, n: tm.games, main: tm.games, q: 0, to });
    }
    list.sort((a, b) => b.n - a.n);
    const kept = pruneByChance(list, prob.get(key)!, user, MIN_P);
    const shown = user ? list : kept.map((k) => k.e);
    if (!shown.length) continue;
    nodes[key] = shown;
    for (const { e, p } of kept) {
      const old = prob.get(e.to);
      if (old !== undefined) {
        if (p > old) prob.set(e.to, p);
        continue;
      }
      if (prob.size >= maxNodes) {
        truncated = true;
        continue;
      }
      prob.set(e.to, p);
      queue.push({ fen: fens.get(e.to)!, key: e.to, d: d + 1 });
    }
  }
  return { root: rootKey, rootFen, nodes, source: 'index', games, truncated, pruned: true };
}

export function registerTraining(r: Router, lib: Library): void {
  /** Δέντρο εκπαίδευσης {db, fen, color, depth}. */
  r.post('/api/training/tree', (req) => {
    const h = lib.handle(String(req.body?.db ?? ''));
    const fen = String(req.body?.fen || START_FEN);
    try {
      Position.fromFen(fen);
    } catch {
      throw new HttpError(400, 'Άκυρη θέση (FEN)');
    }
    const depth = Math.max(2, Math.min(80, Math.round(Number(req.body?.depth) || 20)));
    const count = h.db.count();
    if (count > SMALL_DB) {
      if (!h.index) throw new HttpError(409, 'Η βάση είναι μεγάλη και δεν έχει ευρετήριο θέσεων');
      return indexTree(h.index, fen, req.body?.color !== 'black', depth, 5000, count);
    }
    // λίγες ημικινήσεις παραπάνω για μεταθέσεις με μακρύτερη σειρά κινήσεων
    const maxPly = fenPly(fen) + depth + 4;
    const b = new TrainTreeBuilder();
    for (const g of h.db.iterateWithComments()) {
      const limit = maxPly - (g.fen ? fenPly(g.fen) : 0);
      if (limit > 0) b.addGame(g.tokens, g.comments, g.fen, limit);
    }
    return b.extract(fen, depth, MAX_NODES, req.body?.color !== 'black');
  });

  // πρόοδος ανά βάση και χρώμα: Έγγραφα\Ruru\.knightbase\training\<id>-w.json
  const statsFile = (dbId: string, color: unknown) => {
    lib.find(dbId);
    return path.join(STATS_DIR, `${dbId}-${color === 'black' ? 'b' : 'w'}.json`);
  };

  r.get('/api/training/stats', (req) => {
    const file = statsFile(req.query.get('db') ?? '', req.query.get('color'));
    try {
      return { stats: JSON.parse(fs.readFileSync(file, 'utf8')) as CardStats };
    } catch {
      return { stats: {} };
    }
  });

  r.put('/api/training/stats', (req) => {
    const file = statsFile(String(req.body?.db ?? ''), req.body?.color);
    const stats = req.body?.stats as CardStats | undefined;
    if (!stats || typeof stats !== 'object') throw new HttpError(400, 'Λείπουν τα στατιστικά');
    fs.mkdirSync(STATS_DIR, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(stats));
    fs.renameSync(`${file}.tmp`, file);
    return { ok: true, positions: Object.keys(stats).length };
  });
}
