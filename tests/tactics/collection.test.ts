/** Τεστ: μια συλλογή μόνη της — λίστα θέσεων με τη σειρά, ενότητες, τίτλοι, κατάσταση από τις προσπάθειες, θέση με αριθμό. */
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Router } from '../../src/server/http.ts';
import type { Library } from '../../src/server/library.ts';
import { itemTitle, registerTactics } from '../../src/server/tactics/index.ts';
import { addPuzzles, apiJson, tempTactics } from './helpers.ts';

const LO = 1_000_000_000 + 10 * 10_000_000; // lucas-auerswald (id 10)

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
  addPuzzles(tactics, [1, 2, 3].map((k) => ({ id: LO + k, rating: 1400 + k * 100, source: 10 })));
  const meta = (id: number, m: Record<string, unknown>) => tactics.puzzles.prep('UPDATE puzzle SET meta = ? WHERE id = ?').run(JSON.stringify(m), id);
  meta(LO + 1, { file: 'Pin', white: 'Flohr', black: 'Grob', event: 'Partievariante', date: '1933.??.??' });
  meta(LO + 2, { file: 'Decoy', label: ['Athen (1981)', 'Abramovic-Arvit', 'Difficulty ****'] });
  meta(LO + 3, { file: 'Decoy' });
  server = await router.listen(0, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
  close();
  env.cleanup();
});

describe('συλλογή μόνη της', () => {
  it('λίστα με τη σειρά, ενότητες και τίτλοι από την πηγή', async () => {
    const r = await apiJson(port, 'GET', '/api/tactics/collection/lucas-auerswald');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(3);
    expect(r.json.parts).toEqual([
      { name: 'Pin', n: 1 },
      { name: 'Decoy', n: 2 },
    ]);
    expect(r.json.items.map((x: { seq: number }) => x.seq)).toEqual([1, 2, 3]);
    expect(r.json.items[0].title).toBe('Flohr – Grob, Partievariante, 1933');
    expect(r.json.items[1].title).toBe('Athen (1981) · Abramovic-Arvit');
    expect(r.json.items[0].status).toBeNull();
    expect(r.json.solution).toBe('lines');
  });

  it('κατάσταση από τις προσπάθειες και θέση με αριθμό μέσα σε μια ενότητα', async () => {
    const a = await apiJson(port, 'POST', '/api/tactics/attempt', { id: String(LO + 3), mode: 'casual', win: true, ms: 1000, hints: 0 });
    expect(a.status).toBe(200);
    const r = await apiJson(port, 'GET', '/api/tactics/collection/lucas-auerswald?file=Decoy');
    expect(r.json.total).toBe(2);
    expect(r.json.items.map((x: { status: string | null }) => x.status)).toEqual([null, 'win']);
    expect(r.json.progress).toEqual({ tried: 1, solved: 1 });
    const at = await apiJson(port, 'GET', '/api/tactics/collection/lucas-auerswald/at?i=1&file=Decoy');
    expect(at.json.total).toBe(2);
    expect(at.json.puzzle.id).toBe(String(LO + 3));
    const end = await apiJson(port, 'GET', '/api/tactics/collection/lucas-auerswald/at?i=2&file=Decoy');
    expect(end.json.puzzle).toBeNull();
  });

  it('η κύρια συλλογή και οι άγνωστες δεν είναι «συλλογές»', async () => {
    expect((await apiJson(port, 'GET', '/api/tactics/collection/lichess')).status).toBe(404);
    expect((await apiJson(port, 'GET', '/api/tactics/collection/xyz')).status).toBe(404);
  });

  it('τίτλος θέσης: παίκτες, ετικέτα, κωδικός τεστ', () => {
    expect(itemTitle(JSON.stringify({ id: 'STS(v1.0) Undermine.001', category: 'Undermine' }))).toBe('Undermine.001');
    expect(itemTitle(JSON.stringify({ id: 'BK.01' }))).toBe('BK.01');
    expect(itemTitle(null)).toBe('');
  });
});
