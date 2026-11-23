import { describe, expect, it } from 'vitest';
import { Position } from '../src/core/chess.ts';
import { GameController } from '../src/web/gameModel.ts';
import { parseGames } from '../src/core/pgn.ts';

const move = (c: GameController, uci: string) => Position.fromFen(c.node.fen).parseUci(uci)!;

describe('shared analysis lock (view only)', () => {
  it('allows navigation but no changes, and reports each attempt', () => {
    const c = new GameController(parseGames('1. e4 e5 *')[0].game);
    let tries = 0;
    c.locked = true;
    c.onLocked = () => tries++;
    c.toEnd();
    expect(c.node.san).toBe('e5');
    c.back();
    c.play(move(c, 'e7e5'));
    expect(c.node.san).toBe('e5');
    c.back();
    c.play(move(c, 'c7c5'));
    expect(c.node.children.length).toBe(1);
    c.setComment(c.node, 'x');
    c.toggleShape(c.node, { from: 12, to: 28, color: 'G' });
    c.addLine(c.node, [move(c, 'c7c5')]);
    expect(tries).toBe(4);
    expect(c.dirty).toBe(false);
    expect(c.canUndo).toBe(false);
  });

  it('still takes the changes of the others', () => {
    const c = new GameController(parseGames('1. e4 *')[0].game);
    c.locked = true;
    c.applyRemote(parseGames('1. e4 e5 *')[0].game, (g) => g.root.children[0]);
    expect(c.game.root.children[0].children[0].san).toBe('e5');
    c.locked = false;
    c.play(move(c, 'c7c5'));
    expect(c.node.san).toBe('c5');
  });
});
