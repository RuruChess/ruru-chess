// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2012-2026 the lila authors (AGPL-3.0-or-later), https://github.com/lichess-org/lila
//   from lila: winning chances and accuracy formulas
// Translated to TypeScript and modified for Ruru Chess: 2026-10-22 to 2026-11-22.
// License texts: LICENSE, licenses/AGPL-3.0.txt, licenses/NOTICES.txt
/**
 * Σχολιασμός παρτίδας από ανάλυση μηχανής
 * (έλεγχος λαθών): σύμβολα ?! ? ??, βαριάντες με την καλύτερη
 * γραμμή, [%eval] σε κάθε κίνηση και στατιστικά απωλειών (centipawn loss).
 */
import { Position } from '../core/chess.ts';
import type { GameNode } from '../core/game.ts';
import type { GameController } from './gameModel.ts';

export interface GameEval {
  ply: number;
  fen: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  best: string[];
  bestUci: string[];
}

export interface AnnotateOptions {
  variations: boolean;
  evals: boolean;
  /** μόνο σοβαρά λάθη (?? και ?) */
  blundersOnly: boolean;
}

export interface PlayerSummary {
  acpl: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  accuracy: number;
}

/** Πιθανότητα νίκης στο [-1, 1] από την πλευρά των λευκών. */
function wc(cp: number | null, mate: number | null): number {
  if (mate !== null) return mate > 0 ? 1 : -1;
  if (cp === null) return 0;
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

function cpOf(e: GameEval): number {
  if (e.mate !== null) return e.mate > 0 ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, e.cp ?? 0));
}

export function evalText(e: GameEval): string {
  if (e.mate !== null) return `#${e.mate}`;
  return ((e.cp ?? 0) / 100).toFixed(2);
}

/**
 * NAG για κίνηση που δεν ήταν η καλύτερη (0 = κανένα). Πρέπει να περνά και το
 * κατώφλι πιθανότητας νίκης (όπως στο Lichess) και η απώλεια σε εκατοστά πιονιού·
 * το ?! δεν μπαίνει στις 10 πρώτες ημικινήσεις. `ply`: 1 = 1η κίνηση των λευκών.
 */
export function moveNag(wcLoss: number, cpLoss: number, ply: number, blundersOnly = false): number {
  if (wcLoss >= 0.3 && cpLoss >= 200) return 4;
  if (wcLoss >= 0.2 && cpLoss >= 100) return 2;
  if (wcLoss >= 0.1 && cpLoss >= 50 && ply > 10 && !blundersOnly) return 6;
  return 0;
}

/** Εφαρμόζει τον σχολιασμό στην κύρια γραμμή· επιστρέφει σύνοψη ανά παίκτη. */
export function annotateGame(ctrl: GameController, evals: GameEval[], opts: AnnotateOptions): { white: PlayerSummary; black: PlayerSummary } {
  const main: GameNode[] = [ctrl.game.root, ...ctrl.game.mainline()];
  const sum = {
    white: { loss: 0, moves: 0, inaccuracies: 0, mistakes: 0, blunders: 0, accSum: 0 },
    black: { loss: 0, moves: 0, inaccuracies: 0, mistakes: 0, blunders: 0, accSum: 0 },
  };
  ctrl.edit(() => {
    for (let i = 0; i + 1 < main.length && i + 1 < evals.length; i++) {
      const before = evals[i];
      const after = evals[i + 1];
      const node = main[i + 1];
      const pos = Position.fromFen(main[i].fen);
      const white = pos.turn === 0;
      const side = white ? sum.white : sum.black;
      if (opts.evals) node.evalText = evalText(after);
      const played = pos.moveToUci(node.move);
      const bestUci = before.bestUci[0];
      const sign = white ? 1 : -1;
      const loss = Math.max(0, sign * (cpOf(before) - cpOf(after)));
      side.loss += Math.min(loss, 1000);
      side.moves++;
      const wcLoss = Math.max(0, sign * (wc(before.cp, before.mate) - wc(after.cp, after.mate)));
      // ακρίβεια όπως στο Lichess (από απώλεια πιθανότητας νίκης)
      const acc = 103.1668 * Math.exp(-0.04354 * (wcLoss * 50)) - 3.1669;
      side.accSum += Math.max(0, Math.min(100, acc));
      if (played === bestUci) continue;
      const nag = moveNag(wcLoss, loss, (pos.fullmove - 1) * 2 + (white ? 1 : 2), opts.blundersOnly);
      if (nag === 4) side.blunders++;
      else if (nag === 2) side.mistakes++;
      else if (nag === 6) side.inaccuracies++;
      if (!nag) continue;
      node.nags = node.nags.filter((g) => g < 1 || g > 6);
      node.nags.unshift(nag);
      if (opts.variations && before.bestUci.length) {
        // βαριάντα με την καλύτερη γραμμή της μηχανής
        const parent = main[i];
        const p = Position.fromFen(parent.fen);
        let n: GameNode = parent;
        let first: GameNode | null = null;
        for (const u of before.bestUci.slice(0, 8)) {
          const m = p.parseUci(u);
          if (!m) break;
          n = ctrl.game.addMove(n, m, p);
          p.makeMove(m);
          first ??= n;
        }
        if (first && first !== node) first.evalText = evalText(before);
      }
    }
  });
  const fin = (s: typeof sum.white): PlayerSummary => ({
    acpl: s.moves ? Math.round(s.loss / s.moves) : 0,
    inaccuracies: s.inaccuracies,
    mistakes: s.mistakes,
    blunders: s.blunders,
    accuracy: s.moves ? Math.round(s.accSum / s.moves) : 0,
  });
  return { white: fin(sum.white), black: fin(sum.black) };
}
