/** Ένα puzzle ως παρτίδα για τη σκακιέρα ανάλυσης: η λύση ως κύρια γραμμή, η λάθος κίνηση του χρήστη και η αντίκρουσή της ως βαριάντα. */
import { Position } from '../../core/chess.ts';
import { Game, type GameNode } from '../../core/game.ts';
import { legalUci } from '../../core/puzzle.ts';
import { L } from '../i18n.ts';

export interface AnalysisInput {
  id: string;
  fen: string;
  /** η λύση (UCI) */
  moves: string[];
  sourceName?: string;
  gameUrl?: string | null;
  /** οι κινήσεις που παίχτηκαν πραγματικά (π.χ. άλλο ματ από αυτό της λύσης) */
  played?: string[];
  /** λάθος κίνηση στην ημικίνηση `ply` και η αντίκρουση της μηχανής (UCI) */
  wrong?: { ply: number; uci: string; reply?: string[] } | null;
  /** ημικίνηση όπου ανοίγει η σκακιέρα */
  atPly: number;
  /** χρώμα του λύτη (η σκακιέρα ανοίγει από τη μεριά του) */
  color?: 'white' | 'black';
}

/** Προσθέτει μια σειρά κινήσεων UCI μετά από έναν κόμβο· σταματά στην πρώτη άκυρη. */
function addLine(g: Game, from: GameNode, ucis: readonly string[]): GameNode[] {
  const out: GameNode[] = [];
  const pos = Position.fromFen(from.fen);
  let n = from;
  for (const u of ucis) {
    const m = legalUci(pos, u);
    if (!m) break;
    n = g.addMove(n, m, pos);
    pos.makeMove(m);
    out.push(n);
  }
  return out;
}

/** Η παρτίδα (PGN) με τη λύση και τις βαριάντες. */
export function puzzleGame(a: AnalysisInput): Game {
  const g = new Game(a.fen);
  g.headers.Event = `${L('Τακτική', 'Puzzle')} #${a.id}${a.sourceName ? ` · ${a.sourceName}` : ''}`;
  const main = [g.root, ...addLine(g, g.root, a.moves)];
  // άλλο ματ από αυτό της λύσης: βαριάντα από το σημείο όπου ξεχωρίζει
  if (a.played) {
    let k = 0;
    while (k < a.played.length && k < a.moves.length && a.played[k] === a.moves[k]) k++;
    if (k < a.played.length && main[k]) addLine(g, main[k], a.played.slice(k));
  }
  if (a.wrong && main[a.wrong.ply]) {
    const v = addLine(g, main[a.wrong.ply], [a.wrong.uci, ...(a.wrong.reply ?? [])]);
    if (v[0]) v[0].nags = [2];
    if (v[0] && a.wrong.reply?.length) v[0].comment = L('Η κίνησή σου· η απάντηση της μηχανής', 'Your move; the engine’s reply');
  }
  return g;
}
