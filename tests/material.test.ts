import { describe, expect, it } from 'vitest';
import { Position } from '../src/core/chess.ts';
import { encodeGame } from '../src/core/codec.ts';
import { parseGame } from '../src/core/pgn.ts';
import { gameHasMaterial, materialCounts, materialMatches, parseMaterial } from '../src/core/material.ts';

const has = (fen: string, text: string, anyColor = false) => {
  const c = new Int32Array(16);
  materialCounts(Position.fromFen(fen), c);
  return materialMatches(c, parseMaterial(text)!, anyColor);
};

describe('υλικό', () => {
  it('διαβάζει τις μορφές', () => {
    expect(parseMaterial('KRP-KR')).toEqual(parseMaterial('KRP vs KR'));
    expect(parseMaterial('KRPKR')).toEqual(parseMaterial('krp : kr'));
    expect(parseMaterial('R*-R*')!.white).toMatchObject({ r: 1, p: 0, anyPawns: true });
    expect(parseMaterial('QM-Q')!.white).toMatchObject({ q: 1, m: 1 });
    expect(parseMaterial('KRX-KR')).toBeNull();
    expect(parseMaterial('KR')).toBeNull();
  });

  it('ταιριάζει ακριβώς, με «*», «M» και αντίστροφα χρώματα', () => {
    const fen = '8/5k2/8/3r4/8/2R2P2/5K2/8 w - - 0 1'; // KRP-KR
    expect(has(fen, 'KRP-KR')).toBe(true);
    expect(has(fen, 'KR-KR')).toBe(false);
    expect(has(fen, 'R*-R*')).toBe(true);
    expect(has(fen, 'RP*-R')).toBe(true);
    expect(has(fen, 'KR-KRP')).toBe(false);
    expect(has(fen, 'KR-KRP', true)).toBe(true);
    expect(has('8/5k2/8/3n4/8/2B5/5K2/8 w - - 0 1', 'M-M')).toBe(true);
    expect(has('8/5k2/8/3n4/8/2B5/5K2/8 w - - 0 1', 'N-B')).toBe(false);
  });

  it('βρίσκει το υλικό μέσα στην παρτίδα', () => {
    const { game } = parseGame('[FEN "4k3/8/8/r7/8/2R2P2/3n4/4K3 w - - 0 1"]\n\n1. Kxd2 Kf7 2. Rc7+ Kf6 *');
    expect(game.plyCount()).toBe(4);
    const enc = encodeGame(game);
    const pos = new Position();
    const c = new Int32Array(16);
    expect(gameHasMaterial(enc.tokens, game.startFen, parseMaterial('KRP-KR')!, false, pos, c)).toBe(true);
    expect(gameHasMaterial(enc.tokens, game.startFen, parseMaterial('KRP-K')!, false, pos, c)).toBe(false);
    expect(gameHasMaterial(enc.tokens, game.startFen, parseMaterial('KP-K')!, false, pos, c)).toBe(false);
  });
});
