import { describe, expect, it } from 'vitest';
import { Position, parseSquare } from '../src/core/chess.ts';
import { encodeGame } from '../src/core/codec.ts';
import { parseGame } from '../src/core/pgn.ts';
import { gameHasManeuver, parseManeuver } from '../src/core/maneuver.ts';

const has = (pgn: string, text: string, color = -1) => {
  const { game } = parseGame(pgn);
  return gameHasManeuver(encodeGame(game).tokens, null, parseManeuver(text, color)!, new Position());
};

describe('ελιγμοί', () => {
  it('ανάγνωση', () => {
    expect(parseManeuver('Nd2 Nf1 Ng3')).toEqual({ piece: 2, color: -1, squares: ['d2', 'f1', 'g3'].map((s) => parseSquare(s)) });
    expect(parseManeuver('N d2-f1-g3', 0)!.squares.length).toBe(3);
    expect(parseManeuver('Ι d2 f1')!.piece).toBe(2);
    expect(parseManeuver('e4 e5')!.piece).toBe(1);
    expect(parseManeuver('N')).toBeNull();
  });

  it('το ίδιο κομμάτι με τη σειρά, με άλλες κινήσεις ενδιάμεσα', () => {
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Nf1 Re8 13. Ng3 *';
    expect(has(pgn, 'Nd2 Nf1 Ng3')).toBe(true);
    expect(has(pgn, 'Nd2 Nf1 Ng3', 0)).toBe(true);
    expect(has(pgn, 'Nd2 Nf1 Ng3', 1)).toBe(false);
    // παράλειψη ενδιάμεσου τετραγώνου: όχι
    expect(has(pgn, 'Nd2 Ng3')).toBe(false);
    // ελιγμός των μαύρων: Nc6-b8-d7
    expect(has(pgn, 'Nb8 Nd7', 1)).toBe(true);
    expect(has(pgn, 'Ba4 Bb3')).toBe(true);
  });
});
