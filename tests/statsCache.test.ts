import { afterAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase } from '../src/server/db/store.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-stats-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function add(db: GameDatabase, welo: number, belo: number) {
  const { game } = parseGame(`[White "A"]\n[Black "B"]\n[Result "1-0"]\n[WhiteElo "${welo}"]\n[BlackElo "${belo}"]\n\n1. e4 e5 1-0`);
  const enc = encodeGame(game);
  return db.insertGame({ headers: game.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: 2 });
}

// Οι παλιές βάσεις κρατούν στο meta στατιστικά από παλιότερο τύπο (avgElo μόνο από ένα χρώμα).
// Η παλιά τιμή φαίνεται αμέσως (χωρίς σάρωση στο κύριο νήμα) και ο ξαναϋπολογισμός γίνεται με refreshStats().
it('παλιά στατιστικά στο meta: σημαδεύονται και ξαναϋπολογίζονται με refreshStats', () => {
  const file = path.join(dir, 'old.kbdb');
  const db = new GameDatabase(file, { create: true });
  add(db, 2000, 2400);
  add(db, 2200, 2600);
  const fresh = db.stats();
  expect(fresh.avgElo).toBe(2300);
  expect(db.statsOutdated).toBe(false);
  // όπως τη γράφανε οι παλιές εκδόσεις: χωρίς έκδοση και με άλλο avgElo
  db.setMeta('stats', JSON.stringify({ ...fresh, avgElo: 2100 }));
  db.close();

  const old = new GameDatabase(file);
  expect(old.stats().avgElo).toBe(2100);
  expect(old.statsOutdated).toBe(true);
  expect(old.refreshStats()).toBe(true);
  expect(old.statsOutdated).toBe(false);
  expect(old.stats()).toEqual(fresh);
  old.close();

  // ο server διαβάζει μετά τη νέα τιμή από το meta (το έγραψε άλλη σύνδεση, π.χ. ο worker)
  const again = new GameDatabase(file);
  expect(again.stats()).toEqual(fresh);
  expect(again.statsOutdated).toBe(false);
  again.close();
});

it('refreshStats δεν γράφει αν άλλαξε η βάση στο μεταξύ (άλλη σύνδεση)', () => {
  const file = path.join(dir, 'race.kbdb');
  const a = new GameDatabase(file, { create: true });
  add(a, 2000, 2400);
  a.setMeta('stats', JSON.stringify({ ...a.stats(), avgElo: 1 }));
  const b = new GameDatabase(file);
  // η b ξεκινά τον υπολογισμό και, πριν γράψει, η a προσθέτει παρτίδα
  expect(b.refreshStats(() => add(a, 2100, 2500))).toBe(false);
  expect(b.getMeta('stats')).toBeNull();
  b.close();
  expect(a.stats().games).toBe(2);
  a.close();
});
