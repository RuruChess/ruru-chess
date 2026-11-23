// Βήμα 4 του σχεδίου Scid: η βάση διαβάζεται από δεύτερη σύνδεση όσο εισάγεται, χωρίς εγγραφές.
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase, type NewGame } from '../src/server/db/store.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-importread-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function game(i: number): NewGame {
  const { game: g } = parseGame(`[White "Παίκτης ${i % 7}"]\n[Black "Player ${i % 5}"]\n[Result "1-0"]\n[Round "${i}"]\n\n1. e4 e5 2. Nf3 1-0`);
  const enc = encodeGame(g);
  return { headers: g.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: 3 };
}

describe('ανάγνωση κατά την εισαγωγή', () => {
  it('βλέπει όσες παρτίδες έχουν γίνει COMMIT, ταξινομεί και δεν γράφει τίποτα', () => {
    const file = path.join(dir, 'growing.kbdb');
    const w = new GameDatabase(file, { create: true });
    const before = { count: w.count(), maxId: w.maxId() };
    // όπως η εισαγωγή σε νέα βάση: χωρίς ευρετήρια, μία συναλλαγή με ενδιάμεσα COMMIT
    w.dropIndexes();
    w.beginBulk();
    w.insertBatch(Array.from({ length: 30 }, (_, i) => game(i)), 1);
    w.commitBulk();
    w.insertBatch(Array.from({ length: 20 }, (_, i) => game(30 + i)), 31);

    const r = new GameDatabase(file, { reader: true });
    r.growing = before;
    // οι 20 τελευταίες δεν έχουν γίνει ακόμη COMMIT
    expect(r.count()).toBe(30);
    expect(r.allIds().length).toBe(30);
    const sorted = r.sortIds(Int32Array.from([3, 1, 2]), 'round', true);
    expect([...sorted]).toEqual([3, 2, 1]);
    expect(r.rows([1])[0].white).toBe('Παίκτης 0');
    expect(r.getGame(30)!.headers.Round).toBe('29');
    // το query_only μένει μετά την ταξινόμηση
    expect(() => r.setMeta('x', '1')).toThrow();

    w.endBulk();
    w.createIndexes();
    expect(r.count()).toBe(50);
    r.close();
    w.close();
  });

  it('σύνδεση ανάγνωσης χωρίς «count» στο meta: μετρά χωρίς να γράψει', () => {
    const file = path.join(dir, 'nometa.kbdb');
    const w = new GameDatabase(file, { create: true });
    w.insertGame(game(1));
    w.db.exec("DELETE FROM meta WHERE key = 'count'");
    w.close();
    const r = new GameDatabase(file, { reader: true });
    expect(r.count()).toBe(1);
    r.close();
    const again = new GameDatabase(file, { reader: true });
    expect(again.getMeta('count')).toBeNull();
    again.close();
  });
});
