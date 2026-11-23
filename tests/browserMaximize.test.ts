/**
 * Τεστ: τα παράθυρα βάσεων/παρτίδων ανοίγουν μεγιστοποιημένα. Ένας μικρός ψεύτικος browser (κανάλι DevTools πάνω σε
 * WebSocket) δίνει σελίδες· το KnightBase πρέπει να στείλει `Browser.setWindowBounds` με `maximized` μόνο για τα
 * παράθυρα που ζήτησε (`maximizeOnOpen`), όχι για τα άλλα (π.χ. το μικρό «Αποθήκευση;»).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Cmd = { id: number; method: string; params?: Record<string, unknown>; sessionId?: string };

/** Ελάχιστος server WebSocket (μόνο κείμενο) για το κανάλι DevTools. */
function fakeBrowser(pages: Array<{ targetId: string; url: string }>) {
  const bounds: Array<Record<string, unknown>> = [];
  let socket: Duplex | null = null;
  const send = (obj: unknown) => {
    const data = Buffer.from(JSON.stringify(obj));
    const head = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
    socket?.write(Buffer.concat([head, data]));
  };
  const reply = (c: Cmd): unknown => {
    switch (c.method) {
      case 'Target.getTargets':
        return { targetInfos: pages.map((p) => ({ ...p, type: 'page', attached: false })) };
      case 'Target.attachToTarget':
        return { sessionId: `S-${String(c.params?.targetId)}` };
      case 'Browser.getWindowForTarget':
        return { windowId: Number(String(c.params?.targetId).replace(/\D/g, '')), bounds: {} };
      case 'Browser.setWindowBounds':
        bounds.push(c.params ?? {});
        return {};
      default:
        return {};
    }
  };
  const server = http.createServer();
  server.on('upgrade', (req, sock) => {
    socket = sock;
    const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = Buffer.alloc(0);
    sock.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        }
        const masked = (buf[1] & 0x80) !== 0;
        const maskAt = off;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const raw = buf.subarray(off, off + len);
        const payload = masked ? Buffer.from(raw.map((x, i) => x ^ buf[maskAt + (i % 4)])) : Buffer.from(raw);
        const opcode = buf[0] & 0x0f;
        buf = buf.subarray(off + len);
        if (opcode === 8) return void sock.end();
        if (opcode !== 1) continue;
        const c = JSON.parse(payload.toString()) as Cmd;
        send({ id: c.id, result: reply(c), ...(c.sessionId ? { sessionId: c.sessionId } : {}) });
      }
    });
    sock.on('error', () => {});
  });
  return {
    server,
    bounds,
    /** νέα σελίδα όσο τρέχει ο browser */
    open: (targetId: string, url: string) => send({ method: 'Target.targetCreated', params: { targetInfo: { targetId, type: 'page', url } } }),
  };
}

const until = async (ok: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!ok() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20));
};

describe('παράθυρα μεγιστοποιημένα', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skb-browser-'));
  const fake = fakeBrowser([
    { targetId: 'T1', url: 'http://127.0.0.1:4747/#open=dbwin1' },
    { targetId: 'T2', url: 'http://127.0.0.1:4747/#closeprompt=xyz' },
  ]);
  let browser: typeof import('../src/server/browser.ts');
  const oldLocal = process.env.LOCALAPPDATA;

  beforeAll(async () => {
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
    const port = (fake.server.address() as AddressInfo).port;
    // το προφίλ του browser (DevToolsActivePort) στον προσωρινό φάκελο
    process.env.LOCALAPPDATA = dir;
    fs.mkdirSync(path.join(dir, 'KnightBase', 'browser'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'KnightBase', 'browser', 'DevToolsActivePort'), `${port}\n/devtools/browser/test\n`);
    browser = await import('../src/server/browser.ts');
  });

  afterAll(() => {
    fake.server.closeAllConnections();
    fake.server.close();
    process.env.LOCALAPPDATA = oldLocal;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('παράθυρο που υπήρχε ήδη όταν συνδέθηκε το κανάλι: μεγιστοποιείται, το «Αποθήκευση;» όχι', async () => {
    browser.maximizeOnOpen('dbwin1');
    browser.connectBrowser(20);
    await until(() => fake.bounds.length > 0);
    expect(fake.bounds).toEqual([{ windowId: 1, bounds: { windowState: 'maximized' } }]);
    expect(browser.browserStatus().connected).toBe(true);
  });

  it('νέο παράθυρο που ζητήθηκε: μεγιστοποιείται· άλλο παράθυρο: όχι', async () => {
    browser.maximizeOnOpen('game22');
    fake.open('T33', 'http://127.0.0.1:4747/#open=other');
    fake.open('T22', 'http://127.0.0.1:4747/#open=game22');
    await until(() => fake.bounds.length > 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.bounds).toEqual([
      { windowId: 1, bounds: { windowState: 'maximized' } },
      { windowId: 22, bounds: { windowState: 'maximized' } },
    ]);
  });
});
