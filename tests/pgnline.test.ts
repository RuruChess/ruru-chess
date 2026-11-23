/** Τεστ: τα βελάκια στο δέντρο μιας λύσης ή μιας σχολιασμένης παρτίδας (← → ↓ ↑) και η αρχή μιας βαριάντας. */
import { describe, expect, it } from 'vitest';
import type { GameNode } from '../src/core/game.ts';
import { parseGames } from '../src/core/pgn.ts';
import { pgnStep, variationRoot } from '../src/web/components/PgnLine.tsx';

const root = parseGames('[Event "?"]\n\n1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) (1... e6 2. d4) 2. Nf3 Nc6 *\n')[0].game.root;
const e4 = root.children[0];
const [e5, c5, e6] = e4.children;
const nf3c5 = c5.children[0];
const c3 = c5.children[1];
const d5 = c3.children[0];
const san = (n: GameNode) => n.san;

describe('βελάκια σε δέντρο PGN', () => {
  it('→ η επόμενη κίνηση της γραμμής, ← η προηγούμενη, στα άκρα μένει εκεί', () => {
    expect(pgnStep(root, 'ArrowRight')).toBe(e4);
    expect(pgnStep(e4, 'ArrowRight')).toBe(e5);
    expect(pgnStep(c5, 'ArrowRight')).toBe(nf3c5);
    expect(pgnStep(d5, 'ArrowLeft')).toBe(c3);
    expect(pgnStep(root, 'ArrowLeft')).toBe(root);
    expect(pgnStep(d5, 'ArrowRight')).toBe(d5);
    expect(pgnStep(e5, 'Enter')).toBe(e5);
  });

  it('↓ οι εναλλακτικές της ίδιας κίνησης κυκλικά, μαζί με την κύρια', () => {
    expect(san(pgnStep(e5, 'ArrowDown'))).toBe('c5');
    expect(san(pgnStep(c5, 'ArrowDown'))).toBe('e6');
    expect(pgnStep(e6, 'ArrowDown')).toBe(e5);
    expect(pgnStep(nf3c5, 'ArrowDown')).toBe(c3);
    // χωρίς εναλλακτικές: μένει εκεί
    expect(pgnStep(e4, 'ArrowDown')).toBe(e4);
  });

  it('↑ πίσω στη γραμμή από την οποία ξεκίνησε η βαριάντα, ένα επίπεδο τη φορά', () => {
    expect(pgnStep(d5, 'ArrowUp')).toBe(nf3c5);
    expect(pgnStep(nf3c5, 'ArrowUp')).toBe(e5);
    expect(pgnStep(c5, 'ArrowUp')).toBe(e5);
    // στην κύρια γραμμή δεν υπάρχει πιο πάνω
    expect(pgnStep(e5, 'ArrowUp')).toBe(e5);
  });

  it('η αρχή της πιο εξωτερικής βαριάντας', () => {
    expect(variationRoot(d5)).toBe(c5);
    expect(variationRoot(nf3c5)).toBe(c5);
    expect(variationRoot(e6.children[0])).toBe(e6);
    expect(variationRoot(e5)).toBeNull();
    expect(variationRoot(e5.children[0])).toBeNull();
  });
});
