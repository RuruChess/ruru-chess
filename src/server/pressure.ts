/**
 * Η κίνηση της μηχανής «με κίνητρο» για το «Παίξε τη θέση»: μία αναζήτηση για τις υποψήφιες κινήσεις, μία σύντομη
 * για τις απαντήσεις του αντιπάλου σε καθεμία, και η επιλογή του `core/pressure.ts` (η πιο δύσκολη για τον
 * αντίπαλο από τις ισάξιες, χωρίς άσκοπες απλουστεύσεις).
 */
import { Position } from '../core/chess.ts';
import { PRESSURE, isDead, materialOf, povScore, pressurePick, repetitionKey, type PressureCand } from '../core/pressure.ts';
import type { AnalysisManager } from './analysis.ts';
import type { PvLine } from './engine.ts';

export interface PressureResult {
  bestmove: string | null;
  /** η αξιολόγηση της κίνησης από τη σκοπιά της μηχανής (εκατοστά· ματ ±10000) */
  score: number | null;
  line: PvLine | null;
  /** οι υποψήφιες που εξετάστηκαν, με την πρακτική αξία τους (η επιλογή πρώτη) */
  ranked: Array<{ uci: string; score: number; value: number }>;
}

type History = { startFen: string; moves: string[] };

/** Πόσες υποψήφιες εξετάζονται και πόσες απαντήσεις του αντιπάλου σε καθεμία. */
const CANDS = 4;
const REPLIES = 8;

export async function pressureMove(analysis: Pick<AnalysisManager, 'evaluate'>, engineId: string, fen: string, history: History | undefined, movetime: number): Promise<PressureResult> {
  const pos = Position.fromFen(fen);
  const legal = pos.legalMoves().length;
  if (!legal) return { bestmove: null, score: null, line: null, ranked: [] };
  const white = pos.turn === 0;
  const t1 = legal === 1 ? Math.min(300, movetime) : Math.round(movetime * 0.4);
  const u = await analysis.evaluate(engineId, fen, { movetime: t1 }, {}, false, Math.min(legal, 6), history);
  // μία γραμμή ανά κίνηση (η μηχανή στέλνει καμιά φορά δύο γραμμές με την ίδια πρώτη κίνηση από διαφορετικά βάθη)
  const firsts = new Set<string>();
  const scored = u.lines
    .filter((l) => l.uci.length > 0)
    .map((l) => ({ l, s: povScore(l, white) }))
    .sort((a, b) => b.s - a.s)
    .filter((x) => !firsts.has(x.l.uci[0]) && Boolean(firsts.add(x.l.uci[0])));
  if (!scored.length) return { bestmove: u.bestmove ?? null, score: null, line: null, ranked: [] };
  const best = scored[0].s;
  const band = best <= -9000 ? 2 : PRESSURE.band;
  const pool = best >= 9000 ? [scored[0]] : scored.filter((x) => best - x.s <= band).slice(0, CANDS);
  const one = (x: (typeof scored)[number]): PressureResult => ({ bestmove: x.l.uci[0], score: x.s, line: x.l, ranked: [{ uci: x.l.uci[0], score: x.s, value: 0 }] });
  if (pool.length === 1) return one(pool[0]);

  // οι θέσεις της παρτίδας ως εδώ (για τις επαναλήψεις)
  const seen = new Map<string, number>();
  const mark = (f: string) => seen.set(repetitionKey(f), (seen.get(repetitionKey(f)) ?? 0) + 1);
  if (history) {
    const p = Position.fromFen(history.startFen);
    mark(p.fen());
    for (const m of history.moves) {
      const mv = p.parseUci(m);
      if (!mv) break;
      p.makeMove(mv);
      mark(p.fen());
    }
  } else mark(fen);

  const t2 = Math.max(150, Math.round((movetime - t1) / pool.length));
  const cands: PressureCand[] = [];
  for (const x of pool) {
    const uci = x.l.uci[0];
    const p = Position.fromFen(fen);
    const m = p.parseUci(uci);
    if (!m) continue;
    p.makeMove(m);
    const after = p.fen();
    const n = p.legalMoves().length;
    let replies = [x.s];
    let dead = isDead(p);
    let material = materialOf(after).total;
    if (n > 0 && !dead) {
      const hist = { startFen: history?.startFen ?? fen, moves: [...(history?.moves ?? []), uci] };
      const r = await analysis.evaluate(engineId, after, { movetime: t2 }, {}, false, Math.min(n, REPLIES), hist);
      const rl = r.lines.filter((l) => l.uci.length > 0);
      if (rl.length) {
        // οι γραμμές είναι από τη σκοπιά των λευκών: από τη σκοπιά της μηχανής, όπως πριν
        replies = rl.map((l) => povScore(l, white)).sort((a, b) => a - b);
        const q = Position.fromFen(after);
        const mm = q.parseUci(rl[0].uci[0]);
        if (mm) {
          q.makeMove(mm);
          dead = isDead(q);
          material = materialOf(q.fen()).total;
        }
      }
    }
    cands.push({ uci, score: x.s, replies, legal: n, dead, seen: seen.get(repetitionKey(after)) ?? 0, material });
  }
  const pick = pressurePick(cands);
  const chosen = pick ? pool.find((x) => x.l.uci[0] === pick.uci) : undefined;
  if (!pick || !chosen) return one(pool[0]);
  return { bestmove: pick.uci, score: chosen.s, line: chosen.l, ranked: pick.ranked };
}
