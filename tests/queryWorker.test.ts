import { afterAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { GameDatabase } from '../src/server/db/store.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-qworker-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function add(db: GameDatabase, year: number) {
  const { game } = parseGame(`[White "A"]\n[Black "B"]\n[Result "1-0"]\n[Date "${year}.01.01"]\n\n1. e4 e5 1-0`);
  const enc = encodeGame(game);
  return db.insertGame({ headers: game.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: 2 });
}

// Η μόνιμη σύνδεση του worker κρατούσε το πλήθος από την πρώτη ερώτηση. Αν ο server πρόσθετε
// παρτίδα και ένα φίλτρο έδινε ακριβώς το παλιό πλήθος, το sortIds ταξινομούσε όλη τη βάση.
it('ταξινόμηση στον worker μετά από αλλαγή της βάσης από άλλη σύνδεση', async () => {
  const file = path.join(dir, 'q.kbdb');
  const db = new GameDatabase(file, { create: true });
  add(db, 2001);
  add(db, 2002);
  add(db, 2000);
  const w = new Worker(new URL('../src/server/db/queryWorker.ts', import.meta.url));
  let seq = 0;
  const ask = (msg: object) =>
    new Promise<number[]>((resolve, reject) => {
      const id = ++seq;
      const on = (m: { id: number; ids?: Int32Array; error?: string; progress?: unknown }) => {
        if (m.id !== id || m.progress) return;
        w.off('message', on);
        if (m.error) reject(new Error(m.error));
        else resolve(Array.from(m.ids!));
      };
      w.on('message', on);
      w.postMessage({ id, file, filter: null, baseIds: null, sort: null, ...msg });
    });
  try {
    expect(await ask({ sort: { col: 'date', desc: false } })).toEqual([3, 1, 2]);
    expect(add(db, 2003)).toBe(4);
    // φίλτρο με 3 παρτίδες = το παλιό πλήθος της βάσης
    expect(await ask({ baseIds: Int32Array.from([1, 2, 4]), sort: { col: 'date', desc: false } })).toEqual([1, 2, 4]);
    expect(await ask({ sort: { col: 'date', desc: true } })).toEqual([4, 2, 1, 3]);
    w.postMessage({ type: 'close', file });
  } finally {
    await w.terminate();
    db.close();
  }
});
