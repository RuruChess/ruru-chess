/** Ο τοπικός server δέχεται μόνο την ίδια την εφαρμογή (DNS rebinding, CSRF, clickjacking) και τα εισαγωγικά του PowerShell. */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Router } from '../src/server/http.ts';
import { psQuote } from '../src/server/psQuote.ts';

let server: http.Server;
let port = 0;
let ran = 0;

beforeAll(async () => {
  const r = new Router();
  r.get('/api/probe', () => ({ n: ++ran }));
  r.post('/api/probe', () => ({ n: ++ran }));
  r.get('/api/watch/callback', () => ({ n: ++ran }));
  r.post('/api/watch/callback', () => ({ n: ++ran }));
  server = await r.listen(0, '127.0.0.1');
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((done) => void server.close(() => done())));

function send(headers: Record<string, string> = {}, method = 'GET', path = '/api/probe') {
  const before = ran;
  return new Promise<{ status: number; ran: boolean; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode!, ran: ran > before, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('τοπικός server: μόνο η ίδια η εφαρμογή', () => {
  it('δέχεται την εφαρμογή και τοπικά προγράμματα', async () => {
    const self = `http://127.0.0.1:${port}`;
    for (const h of [{}, { host: `localhost:${port}`, origin: `http://localhost:${port}` }, { origin: self, 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }] as Array<Record<string, string>>) {
      for (const m of ['GET', 'POST']) expect(await send(h, m)).toMatchObject({ status: 200, ran: true });
    }
  });

  it('απορρίπτει ξένο Host (DNS rebinding), και στα στατικά και στα events', async () => {
    for (const host of ['attacker.example', `attacker.example:${port}`, '127.0.0.1:1', `127.0.0.1.attacker.example:${port}`]) {
      for (const path of ['/api/probe', '/api/events', '/']) expect(await send({ host }, 'GET', path)).toMatchObject({ status: 403, ran: false });
    }
  });

  it('απορρίπτει ξένο Origin', async () => {
    for (const origin of ['https://attacker.example', 'null', 'http://localhost:3000', `https://127.0.0.1:${port}`]) {
      expect(await send({ origin }, 'POST')).toMatchObject({ status: 403, ran: false });
    }
  });

  it('απορρίπτει αιτήματα άλλης σελίδας χωρίς Origin (εικόνα, σύνδεσμος)', async () => {
    for (const site of ['cross-site', 'same-site']) expect(await send({ 'sec-fetch-site': site })).toMatchObject({ status: 403, ran: false });
  });

  it('το /api κρίνεται όπως το διαβάζει ο router', async () => {
    for (const path of ['/x/../api/probe', '/%2e%2e/api/probe', '/api/probe?x=/index.html']) expect(await send({ 'sec-fetch-site': 'cross-site' }, 'GET', path)).toMatchObject({ status: 403, ran: false });
    expect((await send({ 'sec-fetch-site': 'cross-site' }, 'GET', '/')).status).not.toBe(403);
  });

  it('η επιστροφή από τη σύνδεση Lichess περνά μόνο ως πλοήγηση', async () => {
    const nav = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    expect(await send(nav, 'GET', '/api/watch/callback')).toMatchObject({ status: 200, ran: true });
    expect(await send(nav, 'POST', '/api/watch/callback')).toMatchObject({ status: 403, ran: false });
    expect(await send({ ...nav, 'sec-fetch-dest': 'iframe' }, 'GET', '/api/watch/callback')).toMatchObject({ status: 403, ran: false });
  });

  it('δεν μπαίνει σε iframe άλλης σελίδας', async () => {
    expect((await send()).headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});

describe('psQuote', () => {
  it.runIf(process.platform === 'win32')('κάθε είδος απλού εισαγωγικού μένει κείμενο', { timeout: 20_000 }, () => {
    const names = ["O'Brien", 'O’Brien', ...['‘', '’', '‚', '‛', "'"].map((q) => `x${q}; Write-Output INJECTED; #`)];
    const script = names.map((n) => `[Console]::WriteLine((${psQuote(n)}).Length)`).join('\n');
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8' }).stdout;
    expect(out).not.toContain('INJECTED');
    expect(out.trim().split(/\r?\n/)).toEqual(names.map((n) => String(n.length)));
  });
});
