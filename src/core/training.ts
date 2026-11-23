/**
 * Εκπαίδευση ανοιγμάτων: δέντρο ρεπερτορίου από τις παρτίδες μιας βάσης (μαζί με
 * τις βαριάντες), επανάληψη σε διαστήματα ανά θέση (σύστημα Leitner) και επιλογή
 * της κίνησης του αντιπάλου. Το δέντρο το φτιάχνει ο server, την εκπαίδευση την
 * τρέχει ο browser.
 */
import { F_NULL, Position, START_FEN } from './chess.ts';
import { TK_COMMENT, TK_NAG, TK_VEND, TK_VSTART, tokenToMove } from './codec.ts';
import { parseComment } from './pgn.ts';

/** Κίνηση του δέντρου εκπαίδευσης. */
export interface TrainMove {
  uci: string;
  san: string;
  /** εμφανίσεις (παρτίδες και βαριάντες) */
  n: number;
  /** πόσες φορές ήταν η κύρια συνέχεια (όχι βαριάντα) */
  main: number;
  /** πόσες φορές σημειώθηκε με ?, ?? ή ?! */
  q: number;
  /** κλειδί της θέσης μετά την κίνηση */
  to: string;
  /** σχόλιο μετά την κίνηση (το πρώτο που βρέθηκε) */
  c?: string;
}

export interface TrainTree {
  /** κλειδί (hashKey) και FEN της αρχικής θέσης */
  root: string;
  rootFen: string;
  /** θέση → κινήσεις, πρώτη η κύρια (μόνο θέσεις με συνέχεια) */
  nodes: Record<string, TrainMove[]>;
  /** από τις παρτίδες (με βαριάντες) ή από το ευρετήριο θέσεων (μεγάλες βάσεις) */
  source: 'games' | 'index';
  games: number;
  /** κόπηκε στο όριο θέσεων */
  truncated: boolean;
  /** κρατήθηκαν μόνο οι γραμμές με πιθανότητα ≥ MIN_P */
  pruned?: boolean;
}

const BAD_NAGS = new Set([2, 4, 6]);
const byMain = (a: TrainMove, b: TrainMove) => b.main - a.main || b.n - a.n;

/** Συλλέγει τις κινήσεις όλων των παρτίδων μιας βάσης ανά θέση (μεταθέσεις μέσω hash). */
export class TrainTreeBuilder {
  readonly nodes = new Map<string, Map<string, TrainMove>>();
  games = 0;
  private pos = new Position();

  /** Προσθέτει μία παρτίδα: κύρια γραμμή και βαριάντες, έως `maxPly` ημικινήσεις από την αρχή της. */
  addGame(tokens: Uint16Array, comments: string[] | null, startFen: string | null, maxPly: number): void {
    const pos = this.pos;
    pos.setFen(startFen ?? START_FEN);
    this.games++;
    // κινήσεις της τρέχουσας γραμμής (και οι ακμές τους), βαριάντες σε στοίβα
    const moves: number[] = [];
    const edges: Array<TrainMove | null> = [];
    const vars: Array<{ base: number; move: number; edge: TrainMove | null }> = [];
    let alt = false;
    let last: TrainMove | null = null;
    let lastMarked = false;
    for (let k = 0; k < tokens.length; k++) {
      const tk = tokens[k];
      if (tk < 0x8000) {
        const m = tokenToMove(pos, tk);
        if (!(m & F_NULL) && (pos.board[m & 0x7f] === 0 || !pos.isLegalPseudo(m))) break;
        const edge = !(m & F_NULL) && moves.length < maxPly ? this.record(m, !alt) : null;
        pos.makeMove(m);
        moves.push(m);
        edges.push(edge);
        last = edge;
        lastMarked = false;
        alt = false;
      } else if (tk === TK_VSTART) {
        // η βαριάντα είναι εναλλακτική της τελευταίας κίνησης
        if (!moves.length) break;
        const move = moves.pop()!;
        const edge = edges.pop()!;
        pos.unmakeMove();
        vars.push({ base: moves.length, move, edge });
        alt = true;
        last = null;
      } else if (tk === TK_VEND) {
        const v = vars.pop();
        if (!v) break;
        while (moves.length > v.base) {
          pos.unmakeMove();
          moves.pop();
          edges.pop();
        }
        pos.makeMove(v.move);
        moves.push(v.move);
        edges.push(v.edge);
        last = v.edge;
        lastMarked = true;
        alt = false;
      } else if ((tk & 0xff00) === TK_NAG) {
        if (last && !lastMarked && BAD_NAGS.has(tk & 0xff)) {
          last.q++;
          lastMarked = true;
        }
      } else if (tk >= TK_COMMENT) {
        const raw = last && !last.c ? comments?.[tk & 0x3fff] : undefined;
        if (raw) {
          const text = parseComment(raw).text.trim();
          if (text) last!.c = text.length > 400 ? `${text.slice(0, 400)}…` : text;
        }
      }
    }
  }

  private record(m: number, main: boolean): TrainMove {
    const pos = this.pos;
    const key = pos.hashKey();
    let node = this.nodes.get(key);
    if (!node) this.nodes.set(key, (node = new Map()));
    const uci = pos.moveToUci(m);
    let e = node.get(uci);
    if (!e) {
      const san = pos.san(m);
      pos.makeMove(m);
      const to = pos.hashKey();
      pos.unmakeMove();
      node.set(uci, (e = { uci, san, n: 0, main: 0, q: 0, to }));
    }
    e.n++;
    if (main) e.main++;
    return e;
  }

  /**
   * Το υποδέντρο από τη θέση `rootFen` έως `depth` ημικινήσεις (κατά πλάτος, έως
   * `maxNodes` θέσεις). Αν δεν χωρά (π.χ. βάση με ολόκληρες παρτίδες), κρατιούνται
   * μόνο οι γραμμές με πιθανότητα ≥ MIN_P.
   */
  extract(rootFen: string, depth: number, maxNodes: number, white = true): TrainTree {
    const tree = this.bfs(rootFen, depth, maxNodes, 0, white);
    return tree.truncated ? this.bfs(rootFen, depth, maxNodes, MIN_P, white) : tree;
  }

  private bfs(rootFen: string, depth: number, maxNodes: number, minP: number, white: boolean): TrainTree {
    const start = Position.fromFen(rootFen);
    const root = start.hashKey();
    const nodes: Record<string, TrainMove[]> = {};
    const prob = new Map([[root, 1]]);
    let frontier = [root];
    let user = (start.turn === 0) === white;
    let count = 0;
    let truncated = false;
    for (let d = 0; d < depth && frontier.length && !truncated; d++) {
      const next: string[] = [];
      for (const key of frontier) {
        const node = this.nodes.get(key);
        if (!node) continue;
        if (count >= maxNodes) {
          truncated = true;
          break;
        }
        const list = [...node.values()].sort(byMain);
        const kept = minP ? pruneByChance(list, prob.get(key)!, user, minP) : list.map((e) => ({ e, p: 1 }));
        if (!kept.length) continue;
        nodes[key] = user ? list : kept.map((k) => k.e);
        count++;
        for (const { e, p } of kept) {
          const old = prob.get(e.to);
          if (old === undefined) {
            prob.set(e.to, p);
            next.push(e.to);
          } else if (p > old) prob.set(e.to, p);
        }
      }
      frontier = next;
      user = !user;
    }
    return { root, rootFen, nodes, source: 'games', games: this.games, truncated, pruned: minP > 0 };
  }
}

/** Ελάχιστη πιθανότητα γραμμής στα μεγάλα δέντρα. */
export const MIN_P = 0.005;

/**
 * Πιθανότητα κάθε συνέχειας: του αντιπάλου ανάλογη με τη συχνότητά της· του χρήστη
 * η κύρια απάντηση κρατά την πιθανότητα της θέσης, οι άλλες μοιράζονται με τη συχνότητα.
 * Επιστρέφει όσες φτάνουν το `minP`.
 */
export function pruneByChance(list: TrainMove[], p: number, user: boolean, minP: number): Array<{ e: TrainMove; p: number }> {
  const total = list.reduce((s, e) => s + e.n, 0) || 1;
  const main = user ? list.find((e) => !isBadMove(e)) : undefined;
  return list.map((e) => ({ e, p: e === main ? p : (p * e.n) / total })).filter((k) => k.p >= minP);
}

/** Κίνηση σημειωμένη ως λάθος (?, ??, ?!) στις περισσότερες εμφανίσεις της. */
export const isBadMove = (m: TrainMove): boolean => m.q * 2 > m.n;

/** Οι σωστές απαντήσεις σε μια θέση (χωρίς τις σημειωμένες ως λάθος), πρώτη η κύρια. */
export function answers(tree: TrainTree, key: string): TrainMove[] {
  return (tree.nodes[key] ?? []).filter((m) => !isBadMove(m));
}

// ---------------------------------------------------------------------------
// Επανάληψη σε διαστήματα

export interface CardStat {
  /** κουτί Leitner (0 = ξανά σύντομα) */
  box: number;
  /** πότε ξαναρωτιέται (ms) */
  due: number;
  ok: number;
  bad: number;
  last: number;
}

export type CardStats = Record<string, CardStat>;

const DAY = 86_400_000;
/** Διάστημα ανά κουτί, σε ημέρες. */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35, 80, 180];

/** Νέα κατάσταση μιας θέσης μετά από απάντηση. Σωστή απάντηση πριν τη λήξη δεν ανεβάζει κουτί. */
export function review(s: CardStat | undefined, correct: boolean, now: number): CardStat {
  if (correct && s && s.due > now) return { ...s, ok: s.ok + 1, last: now };
  const box = correct ? Math.min(BOX_DAYS.length - 1, (s?.box ?? 0) + 1) : 0;
  return { box, due: now + BOX_DAYS[box] * DAY, ok: (s?.ok ?? 0) + (correct ? 1 : 0), bad: (s?.bad ?? 0) + (correct ? 0 : 1), last: now };
}

export type CardState = 'new' | 'due' | 'learning' | 'learned';

export function cardState(s: CardStat | undefined, now: number): CardState {
  if (!s) return 'new';
  if (s.due <= now) return 'due';
  return s.box >= 3 ? 'learned' : 'learning';
}

/**
 * Επίσκεψη των θέσεων ανά επίπεδο έως `depth` ημικινήσεις. Στις θέσεις του χρήστη
 * ακολουθείται μόνο η κύρια απάντηση· στου αντιπάλου όλες οι κινήσεις.
 */
function walk(tree: TrainTree, start: string, userTurn: boolean, depth: number, visit: (key: string, userTurn: boolean) => void): void {
  let frontier = [start];
  const seen = new Set(frontier);
  let turn = userTurn;
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const key of frontier) {
      visit(key, turn);
      const moves = turn ? answers(tree, key).slice(0, 1) : (tree.nodes[key] ?? []);
      for (const m of moves) {
        if (seen.has(m.to)) continue;
        seen.add(m.to);
        next.push(m.to);
      }
    }
    frontier = next;
    turn = !turn;
  }
}

export interface TrainSummary {
  /** θέσεις όπου παίζει ο χρήστης */
  total: number;
  fresh: number;
  due: number;
  learning: number;
  learned: number;
}

export function summarize(tree: TrainTree, userFirst: boolean, depth: number, stats: CardStats, now: number): TrainSummary {
  const out: TrainSummary = { total: 0, fresh: 0, due: 0, learning: 0, learned: 0 };
  walk(tree, tree.root, userFirst, depth, (key, userTurn) => {
    if (!userTurn || !answers(tree, key).length) return;
    out.total++;
    const st = cardState(stats[key], now);
    if (st === 'new') out.fresh++;
    else if (st === 'due') out.due++;
    else if (st === 'learning') out.learning++;
    else out.learned++;
  });
  return out;
}

/** Πόσες θέσεις του χρήστη (νέες ή για επανάληψη) υπάρχουν έως `depth` ημικινήσεις από το `key`. */
export function needIn(tree: TrainTree, key: string, userTurn: boolean, depth: number, stats: CardStats, now: number): number {
  let n = 0;
  walk(tree, key, userTurn, depth, (k, turn) => {
    if (!turn || !answers(tree, k).length) return;
    const st = cardState(stats[k], now);
    if (st === 'new' || st === 'due') n++;
  });
  return n;
}

/**
 * Κίνηση του αντιπάλου, με βάρος τη συχνότητά της. Στην «επανάληψη» προτιμώνται οι
 * γραμμές με θέσεις νέες ή για επανάληψη· οι μαθημένες βγαίνουν σπάνια.
 */
export function pickOpponentMove(
  tree: TrainTree,
  key: string,
  opts: { stats: CardStats; now: number; depth: number; mode: 'review' | 'random'; rand?: () => number },
): TrainMove | null {
  const moves = tree.nodes[key];
  if (!moves?.length) return null;
  const weights = moves.map((m) => {
    if (opts.mode === 'random') return m.n;
    const need = needIn(tree, m.to, true, opts.depth - 1, opts.stats, opts.now);
    return m.n * (need > 0 ? 1 + Math.log2(1 + need) : 0.1);
  });
  let r = (opts.rand ?? Math.random)() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i];
    if (r < 0) return moves[i];
  }
  return moves[moves.length - 1];
}
