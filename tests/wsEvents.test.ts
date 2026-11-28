/**
 * Γεγονότα προς τα παράθυρα με WebSocket (όχι SSE: ο browser ανοίγει ως 6 συνδέσεις HTTP ανά server, και με μία SSE ανά
 * παράθυρο το 6ο παράθυρο έμενε στο «Ruru…»). Παράδοση, κλείσιμο παραθύρου, και μόνο από την ίδια την εφαρμογή.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Router } from '../src/server/http.ts';

let server: http.Server;
let router: Router;
let port = 0;
const closed: string[] = [];

beforeAll(async () => {
  router = new Router();
  router.onClientClose = (win) => closed.push(win);
  server = await router.listen(0, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((done) => void server.close(() => done()));
});

function open(win: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events?win=${win}`);
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('δεν συνδέθηκε')));
  });
}

it('8 παράθυρα παίρνουν το ίδιο γεγονός, και το κλείσιμο ενός φαίνεται στον server', async () => {
  const wins = await Promise.all(Array.from({ length: 8 }, (_, i) => open(`w${i}`)));
  await vi.waitFor(() => expect(router.clientCount).toBe(8));
  const got = wins.map((ws) => new Promise((resolve) => ws.addEventListener('message', (ev) => resolve(JSON.parse(String(ev.data))))));
  // και μεγάλο μήνυμα (μήκος με 2 και με 8 bytes στην κεφαλίδα του πλαισίου)
  const big = 'x'.repeat(70_000);
  router.broadcast('job', { id: 'j1', big });
  for (const m of await Promise.all(got)) expect(m).toEqual({ type: 'job', data: { id: 'j1', big } });

  wins[3].close();
  await vi.waitFor(() => expect(closed).toContain('w3'));
  expect(router.clientCount).toBe(7);
  for (const ws of wins) ws.close();
  await vi.waitFor(() => expect(router.clientCount).toBe(0));
});

it('απορρίπτει σύνδεση από ξένη σελίδα ή ξένο Host', async () => {
  const handshake = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/api/events?win=x',
        agent: false,
        headers: { host: `127.0.0.1:${port}`, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
      });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        resolve(101);
      });
      req.on('error', reject);
      req.end();
    });
  expect(await handshake({ origin: `http://127.0.0.1:${port}` })).toBe(101);
  // (η σύνδεση κόπηκε απότομα, χωρίς close: ο server πρέπει να το καταλάβει, αλλιώς η εφαρμογή δεν κλείνει ποτέ)
  await vi.waitFor(() => expect(closed).toContain('x'));
  expect(router.clientCount).toBe(0);
  expect(await handshake({ origin: 'http://attacker.example' })).toBe(403);
  expect(await handshake({ host: `attacker.example:${port}` })).toBe(403);
  expect(await handshake({ 'sec-fetch-site': 'cross-site' })).toBe(403);
});
