/** Τεστ: οι διαδρομές /api/tactics/* απαντούν 4xx (όχι 500) σε άκυρη είσοδο και ελέγχουν σωστά τη σειρά κινήσεων του λύτη. */
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Router } from '../../src/server/http.ts';
import type { Library } from '../../src/server/library.ts';
import { registerTactics } from '../../src/server/tactics/index.ts';
import { puzzleKey } from '../../src/server/tactics/pack.ts';
import type { AddressInfo } from 'node:net';
import { addPuzzles, apiJson, tempTactics } from './helpers.ts';

let env: ReturnType<typeof tempTactics>;
let server: http.Server;
let port: number;
let close: () => void;

beforeAll(async () => {
  env = tempTactics();
  const lib = { settings: { databasesDir: env.dir, engines: [], defaultEngine: null }, jobs: new Map() } as unknown as Library;
  const router = new Router();
  const { tactics } = registerTactics(router, lib);
  close = () => tactics.close();
  addPuzzles(tactics, Array.from({ length: 30 }, (_, i) => ({ id: i + 1, rating: 1300 + i * 20, themes: ['fork'] })));
  server = await router.listen(0, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
  close();
  env.cleanup();
});

const P = puzzleKey(5);
const call = (method: string, path: string, body?: unknown) => apiJson(port, method, path, body);

describe('άκυρη είσοδος → 4xx', () => {
  const cases: Array<[string, string, unknown]> = [
    ['POST', '/api/tactics/check', null],
    ['POST', '/api/tactics/check', { id: P, ply: 'x', uci: 'e6e7' }],
    ['POST', '/api/tactics/check', { id: P, ply: 99, uci: 'e6e7' }],
    ['POST', '/api/tactics/check', { id: P, ply: 1 }],
    ['POST', '/api/tactics/refute', null],
    ['POST', '/api/tactics/refute', { id: P, ply: -3, uci: 'e6e7' }],
    ['GET', `/api/tactics/hint?id=${P}&ply=-1`, undefined],
    ['GET', `/api/tactics/hint?id=${P}&ply=1.5`, undefined],
    ['GET', `/api/tactics/hint?id=${P}&ply=99`, undefined],
    ['POST', '/api/tactics/practice/check', {}],
    ['POST', '/api/tactics/practice/check', null],
    ['POST', '/api/tactics/attempt', null],
    ['POST', '/api/tactics/attempt', { id: P, mode: 'casual', hints: 'x' }],
    ['POST', '/api/tactics/attempt', { id: P, mode: 'casual', wrong: { a: 1 } }],
    ['POST', '/api/tactics/attempt', { id: P, mode: 'woodpecker', cycle: 'x' }],
    ['POST', '/api/tactics/attempt', { id: P, mode: 'casual', angle: [1, 2] }],
    ['POST', '/api/tactics/rating', null],
    ['POST', '/api/tactics/rating', { rating: 1500, deviation: 'x' }],
    ['POST', '/api/tactics/puzzle/00005/flag', { note: { a: 1 } }],
    ['POST', '/api/tactics/decks', null],
    ['POST', '/api/tactics/decks', { name: 'α', ids: [null] }],
    ['POST', '/api/tactics/decks', { name: 'α', ids: 'abc' }],
    ['POST', '/api/tactics/decks/1/cards', { add: 5 }],
    ['POST', '/api/tactics/decks/1/cards', { add: [null] }],
    ['POST', '/api/tactics/decks/1/cards', { remove: [{}] }],
    ['POST', '/api/tactics/woodpecker', { size: 'x' }],
    ['POST', '/api/tactics/woodpecker', { min: 'abc', max: 'def' }],
    ['POST', '/api/tactics/woodpecker', { size: 5, targetDays: 'x' }],
    ['POST', '/api/tactics/run', null],
    ['POST', '/api/tactics/run', { mode: 'storm', score: 'abc' }],
    ['POST', '/api/tactics/run', { mode: 'storm', score: 5, puzzles: 5 }],
    ['POST', '/api/tactics/run', { mode: 'storm', score: 5, puzzles: [null] }],
    ['GET', '/api/tactics/history?limit=1.5', undefined],
    ['GET', '/api/tactics/history?offset=-1', undefined],
    ['GET', '/api/tactics/review/due?limit=2.5', undefined],
    ['GET', '/api/tactics/next?kind=bogus', undefined],
    ['POST', '/api/tactics/import', { source: { a: 1 } }],
    ['POST', '/api/tactics/import/cancel', [1]],
  ];
  for (const [method, path, body] of cases) {
    it(`${method} ${path} ${JSON.stringify(body) ?? ''}`, async () => {
      const r = await call(method, path, body);
      expect(r.status, r.text).toBeGreaterThanOrEqual(400);
      expect(r.status, r.text).toBeLessThan(500);
    });
  }

  it('Woodpecker: άκυρος στόχος ημερών σε νέο κύκλο', async () => {
    const w = await call('POST', '/api/tactics/woodpecker', { size: 5, min: 1000, max: 2000 });
    expect(w.status, w.text).toBe(200);
    const r = await call('POST', `/api/tactics/woodpecker/${w.json.id}/cycle`, { targetDays: 'x' });
    expect(r.status, r.text).toBe(400);
  });

  it('τράπουλα: σελίδα με άκυρο όριο', async () => {
    const d = await call('POST', '/api/tactics/decks', { name: 'Δοκιμή', ids: [P] });
    expect(d.status, d.text).toBe(200);
    const r = await call('GET', `/api/tactics/decks/${d.json.id}?limit=1.5`);
    expect(r.status, r.text).toBe(400);
  });

  it('ένας γύρος με άκυρα puzzles δεν αφήνει μισή εγγραφή', async () => {
    const before = (await call('GET', '/api/tactics/runs?mode=storm')).json.count;
    await call('POST', '/api/tactics/run', { mode: 'storm', score: 5, puzzles: 5 });
    expect((await call('GET', '/api/tactics/runs?mode=storm')).json.count).toBe(before);
  });
});

describe('έλεγχος κίνησης', () => {
  it('δεκτή μόνο σε κίνηση του λύτη (όχι του αντιπάλου)', async () => {
    // γραμμή: f2g3 (αντίπαλος) e6e7 (λύτης) b2b1 b3c1 b1c1 h6c1
    const ok = await call('POST', '/api/tactics/check', { id: P, ply: 1, uci: 'e6e7' });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.result).toBe('correct');
    const opp = await call('POST', '/api/tactics/check', { id: P, ply: 2, uci: 'b2b1' });
    expect(opp.status, opp.text).toBe(400);
    const first = await call('POST', '/api/tactics/check', { id: P, ply: 0, uci: 'f2g3' });
    expect(first.status, first.text).toBe(400);
  });
  it('η τελευταία κίνηση: ματ ή η κίνηση της λύσης', async () => {
    const last = await call('POST', '/api/tactics/check', { id: P, ply: 5, uci: 'h6c1' });
    expect(last.status, last.text).toBe(200);
    expect(last.json.result).toBe('solved');
  });
});
