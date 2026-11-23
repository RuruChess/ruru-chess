/**
 * Οι υποβαριάντες της λύσης μιας πηγής (π.χ. «1. Nxc4 Qxc4 (1… b5 2. d6 Nxd6 …) 2. Bb3 …»): οι άμυνες του
 * αντιπάλου που πρέπει να αντικρούσεις, με τη σειρά που γράφονται. Οι εναλλακτικές του λύτη δεν παίζονται
 * (φαίνονται στη λύση της πηγής).
 */
import { Position } from '../../core/chess.ts';
import type { GameNode } from '../../core/game.ts';
import { parseGames } from '../../core/pgn.ts';
import { standardUci } from '../../core/puzzle.ts';
import { moveText } from './logic.ts';

export interface SubLine {
  /** η θέση πριν από την άμυνα του αντιπάλου */
  fen: string;
  /** η γραμμή σε UCI: πρώτα η άμυνα, μετά η απάντηση του λύτη κ.ο.κ. */
  moves: string[];
  /** η άμυνα, π.χ. «1…b5» */
  label: string;
  /** το σχόλιο της πηγής μετά από κάθε κίνηση της γραμμής ('' χωρίς σχόλιο) */
  notes: string[];
}

function tree(fen: string, solution: string): GameNode | null {
  try {
    return parseGames(`[Event "?"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n${solution}\n`)[0]?.game.root ?? null;
  } catch {
    return null;
  }
}

/** Η γραμμή από έναν κόμβο και κάτω (πάντα η πρώτη συνέχεια), με τα σχόλιά της. */
function line(n: GameNode | undefined): { moves: string[]; notes: string[] } {
  const moves: string[] = [];
  const notes: string[] = [];
  for (let x = n; x; x = x.children[0]) {
    moves.push(standardUci(x.move));
    notes.push(x.comment.trim());
  }
  return { moves, notes };
}

/** Τα σχόλια της κύριας γραμμής της λύσης, ένα ανά ημικίνηση (για τα μαθήματα). */
export function lineNotes(fen: string, solution: string): string[] {
  if (!solution.includes('{')) return [];
  const root = tree(fen, solution);
  return root ? line(root.children[0]).notes : [];
}

export function subLines(fen: string, solution: string, solver: 'white' | 'black'): SubLine[] {
  if (!solution.includes('(')) return [];
  const root = tree(fen, solution);
  if (!root) return [];
  const out: SubLine[] = [];
  const walk = (node: GameNode) => {
    const turn = Position.fromFen(node.fen).turn === 0 ? 'white' : 'black';
    node.children.forEach((child, i) => {
      if (i === 0 || turn === solver) return;
      out.push({ fen: node.fen, ...line(child), label: moveText(node.fen, child.san) });
      walk(child);
    });
    if (node.children[0]) walk(node.children[0]);
  };
  walk(root);
  // η άμυνα και τουλάχιστον μία απάντηση του λύτη
  return out.filter((x) => x.moves.length >= 2);
}
