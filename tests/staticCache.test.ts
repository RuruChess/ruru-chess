/**
 * Τεστ: τα στατικά αρχεία. Τα αρχεία του Vite με hash στο όνομα (assets/) μένουν στην cache για πάντα· όλα τα άλλα
 * (index.html, εικονίδιο) ελέγχονται σε κάθε φόρτωση (Last-Modified → 304), ώστε μια νέα έκδοση (π.χ. νέο εικονίδιο)
 * να φαίνεται χωρίς να σβηστεί η cache του browser.
 */
import fs from 'node:fs';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Router } from '../src/server/http.ts';

describe('στατικά αρχεία: cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skb-static-'));
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><script type="module" src="/assets/index-abc123.js"></script>');
    fs.writeFileSync(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    const r = new Router();
    r.staticDir = dir;
    server = await r.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('το εικονίδιο: χωρίς immutable, με Last-Modified, και 304 όταν δεν άλλαξε', async () => {
    const a = await fetch(`${base}/icon.svg`);
    expect(a.status).toBe(200);
    expect(a.headers.get('cache-control')).toBe('no-cache');
    const lm = a.headers.get('last-modified');
    expect(lm).toBeTruthy();
    const b = await fetch(`${base}/icon.svg?v=0.8.0`, { headers: { 'If-Modified-Since': lm! } });
    expect(b.status).toBe(304);
    // άλλαξε το αρχείο: ξανά ολόκληρο
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, 'icon.svg'), later, later);
    const c = await fetch(`${base}/icon.svg`, { headers: { 'If-Modified-Since': lm! } });
    expect(c.status).toBe(200);
  });

  it('τα αρχεία με hash (assets/): immutable· το index.html: no-cache', async () => {
    const js = await fetch(`${base}/assets/index-abc123.js`);
    expect(js.headers.get('cache-control')).toContain('immutable');
    const html = await fetch(`${base}/`);
    expect(html.headers.get('cache-control')).toBe('no-cache');
    expect(await html.text()).toContain('/assets/index-abc123.js');
  });
});
