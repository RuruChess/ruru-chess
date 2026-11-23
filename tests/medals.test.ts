import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { medalsOfFlags, medalsToText, textToMedals } from '../src/core/medals.ts';
import { GameDatabase } from '../src/server/db/store.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-medals-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('μετάλλια', () => {
  it('κείμενο ↔ bits', () => {
    expect(textToMedals('novelty, tactics')).toBe((1 << 3) | (1 << 6));
    expect(medalsToText((1 << 3) | (1 << 6))).toBe('novelty,tactics');
    expect(textToMedals('άγνωστο')).toBe(0);
    expect(medalsOfFlags(0x8000 * 65536 + 0x203)).toBe(0x8000);
  });

  it('αποθήκευση στη στήλη flags, ετικέτα Medals, αναζήτηση', () => {
    const db = new GameDatabase(path.join(dir, 'm.skdb'), { create: true });
    const { game } = parseGame('[White "A"]\n[Black "B"]\n[Result "1-0"]\n[Medals "user,novelty"]\n\n1. e4 1-0');
    const enc = encodeGame(game);
    const id = db.insertGame({ headers: game.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: 1 });
    db.insertGame({ headers: { White: 'C', Black: 'D', Result: '0-1' }, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: 1 });
    expect(db.getGame(id)!.headers.Medals).toBe('novelty,user');
    expect(Array.from(db.search({ medals: 1 << 15 }))).toEqual([id]);
    expect(Array.from(db.search({ medals: 1 << 0 }))).toEqual([]);
    // η σημαία διαγραφής δεν πειράζει τα μετάλλια
    db.setDeleted([id], true);
    expect(db.getGame(id)!.headers.Medals).toBe('novelty,user');
    db.close();
  });
});
