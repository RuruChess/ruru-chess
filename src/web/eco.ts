/** Ονόματα ανοιγμάτων στο περιβάλλον (φορτώνονται μία φορά από τον server). */
import { useEffect, useState } from 'react';
import { EcoBook, type OpeningInfo } from '../core/eco.ts';
import type { GameController } from './gameModel.ts';
import type { GameNode } from '../core/game.ts';
import { Position } from '../core/chess.ts';

let book: EcoBook | null = null;
let loading: Promise<EcoBook> | null = null;

export function loadEco(): Promise<EcoBook> {
  if (book) return Promise.resolve(book);
  loading ??= fetch('/api/openings.tsv')
    .then((r) => r.text())
    .then((t) => (book = new EcoBook(t)));
  return loading;
}

export function useEcoBook(): EcoBook | null {
  const [b, setB] = useState<EcoBook | null>(book);
  useEffect(() => {
    if (!b) void loadEco().then(setB);
  }, [b]);
  return b;
}

/** Το άνοιγμα της τρέχουσας γραμμής (το βαθύτερο γνωστό ως τον κόμβο). */
export function openingAt(b: EcoBook | null, ctrl: GameController, node: GameNode): OpeningInfo | null {
  if (!b) return null;
  let n: GameNode | null = node;
  while (n) {
    const p = Position.fromFen(n.fen);
    const o = b.lookup(p.hashHi, p.hashLo);
    if (o) return o;
    n = n.parent;
  }
  void ctrl;
  return null;
}
