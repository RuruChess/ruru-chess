/** Μικρός HTTP router με JSON, γεγονότα προς τα παράθυρα (WebSocket) και στατικά αρχεία. */
import { logError } from './errlog.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { HttpError } from './library.ts';
import { isOwnRequest } from './guard.ts';
import { DbFormatError } from './db/store.ts';

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  raw: IncomingMessage;
  res: ServerResponse;
}

/** Τιμή επιστροφής που σημαίνει «η απάντηση γράφτηκε ήδη». */
export const HANDLED = Symbol('handled');

type Handler = (req: Req) => unknown | Promise<unknown>;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
  /** το σώμα δεν διαβάζεται εδώ: ο handler διαβάζει μόνος του το `raw` (π.χ. ανέβασμα αρχείου) */
  stream?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
};

/** Ένα πλαίσιο WebSocket από τον server (χωρίς μάσκα): 1 = κείμενο, 8 = κλείσιμο, 9 = ping. */
function wsFrame(op: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const n = payload.length;
  let head: Buffer;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) head = Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
  else {
    head = Buffer.from([0x80 | op, 127, 0, 0, 0, 0, 0, 0, 0, 0]);
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

export class Router {
  private routes: Route[] = [];
  private clients = new Set<Duplex>();
  staticDir: string | null = null;
  /** σύνδεση / αποσύνδεση ενός παραθύρου (το `win` το στέλνει το ίδιο το παράθυρο) */
  onClientOpen: ((win: string) => void) | null = null;
  onClientClose: ((win: string) => void) | null = null;

  /** Πόσα παράθυρα του περιβάλλοντος είναι συνδεδεμένα. */
  get clientCount(): number {
    return this.clients.size;
  }

  add(method: string, pattern: string, handler: Handler, opts?: { stream?: boolean }): void {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\/:(\w+)/g, (_m, k: string) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method, re, keys, handler, stream: opts?.stream });
  }

  get(p: string, h: Handler): void {
    this.add('GET', p, h);
  }
  post(p: string, h: Handler, opts?: { stream?: boolean }): void {
    this.add('POST', p, h, opts);
  }
  put(p: string, h: Handler): void {
    this.add('PUT', p, h);
  }
  del(p: string, h: Handler): void {
    this.add('DELETE', p, h);
  }

  /** Αποστολή γεγονότος σε όλους τους συνδεδεμένους browsers. */
  broadcast(type: string, data: unknown): void {
    const frame = wsFrame(1, Buffer.from(JSON.stringify({ type, data })));
    for (const c of this.clients) c.write(frame);
  }

  /**
   * `/api/events`: ένα WebSocket ανά παράθυρο. Όχι Server-Sent Events: ο Chromium (και το Electron) ανοίγει ως 6 συνδέσεις
   * HTTP ανά server, και με μία SSE ανοιχτή ανά παράθυρο, από το 6ο παράθυρο και μετά κάθε αίτημα περίμενε για πάντα
   * (το παράθυρο έμενε στο «Ruru…»)· τα WebSocket δεν μετρούν σε αυτό το όριο.
   */
  private upgrade(req: IncomingMessage, socket: Duplex): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    if (!isOwnRequest(req) || url.pathname !== '/api/events' || req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
      // (destroy μετά την αποστολή: ο server του Node κρατά μισάνοιχτες τις συνδέσεις που κλείνουμε μόνο με end)
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n', () => socket.destroy());
      return;
    }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    this.clients.add(socket);
    const win = url.searchParams.get('win') ?? '';
    if (win) this.onClientOpen?.(win);
    const ping = setInterval(() => socket.write(wsFrame(9)), 20000);
    let gone = false;
    const close = () => {
      if (gone) return;
      gone = true;
      clearInterval(ping);
      this.clients.delete(socket);
      if (win) this.onClientClose?.(win);
    };
    // ο browser στέλνει μόνο pong και close (με μάσκα)· στο close απαντάμε και κλείνουμε
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const len7 = buf[1] & 0x7f;
        const ext = len7 === 126 ? 2 : len7 === 127 ? 8 : 0;
        const mask = buf[1] & 0x80 ? 4 : 0;
        if (buf.length < 2 + ext) return;
        const len = ext === 2 ? buf.readUInt16BE(2) : ext === 8 ? Number(buf.readBigUInt64BE(2)) : len7;
        const size = 2 + ext + mask + len;
        if (buf.length < size) return;
        const op = buf[0] & 0x0f;
        buf = buf.subarray(size);
        if (op === 8) {
          socket.end(wsFrame(8), () => socket.destroy());
          close();
          return;
        }
      }
    });
    // το παράθυρο έκλεισε απότομα (χωρίς close): ο server του Node κρατά μισάνοιχτη τη σύνδεση αν δεν την κλείσουμε εμείς
    socket.on('end', () => socket.destroy());
    socket.on('close', close);
    socket.on('error', close);
  }

  private async readBody(req: IncomingMessage): Promise<any> {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > 64 * 1024 * 1024) throw new HttpError(413, 'Πολύ μεγάλο αίτημα');
      chunks.push(c);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    const type = req.headers['content-type'] ?? '';
    if (type.includes('application/json')) return JSON.parse(text);
    return text;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isOwnRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
      res.end(JSON.stringify({ error: 'Μη αποδεκτό αίτημα' }));
      return;
    }
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    if (url.pathname.startsWith('/api/')) {
      for (const r of this.routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        try {
          const body = r.stream ? undefined : await this.readBody(req);
          const out = await r.handler({ method, path: url.pathname, params, query: url.searchParams, body, raw: req, res });
          if (out === HANDLED) return;
          const json = JSON.stringify(out ?? { ok: true });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(json);
        } catch (e) {
          const status = e instanceof HttpError ? e.status : e instanceof DbFormatError ? 409 : 500;
          if (status === 500) logError(e, `${req.method} ${req.url}`);
          if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Άγνωστη διαδρομή' }));
      return;
    }
    this.serveStatic(url.pathname, res, req.headers['if-modified-since']);
  }

  /**
   * Στατικά αρχεία: τα αρχεία του Vite με hash στο όνομα (assets/) μένουν στην cache για πάντα· όλα τα άλλα (index.html,
   * εικονίδιο, κομμάτια) ελέγχονται σε κάθε φόρτωση (Last-Modified → 304), ώστε μια νέα έκδοση να φαίνεται αμέσως.
   */
  private serveStatic(p: string, res: ServerResponse, ifModifiedSince?: string): void {
    if (!this.staticDir) {
      res.writeHead(404);
      res.end('Το περιβάλλον δεν έχει χτιστεί (npm run build)');
      return;
    }
    const safe = path.normalize(decodeURIComponent(p)).replace(/^([/\\])+/, '');
    let file = path.join(this.staticDir, safe);
    if (!file.startsWith(this.staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(this.staticDir, 'index.html');
    const ext = path.extname(file).toLowerCase();
    const hashed = /^assets[\\/]/.test(path.relative(this.staticDir, file));
    const modified = fs.statSync(file).mtime.toUTCString();
    if (!hashed && ifModifiedSince === modified) {
      res.writeHead(304, { 'Cache-Control': 'no-cache', 'Last-Modified': modified });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(hashed ? {} : { 'Last-Modified': modified }),
    });
    fs.createReadStream(file).pipe(res);
  }

  listen(port: number, host: string): Promise<http.Server> {
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.on('upgrade', (req, socket) => this.upgrade(req, socket));
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server));
    });
  }
}
