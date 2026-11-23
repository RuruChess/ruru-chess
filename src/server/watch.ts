/**
 * Watch Live: παρτίδες σε εξέλιξη από το Lichess.
 * - Λίστες: επίσημα broadcasts (`/api/broadcast/top`) και οι παρτίδες ενός γύρου.
 * - Live: ένα stream προς το Lichess ανά παρτίδα ή γύρο, όσα παράθυρα κι αν το βλέπουν (SSE προς τα παράθυρα),
 *   με κλείσιμο 30″ αφού φύγει και το τελευταίο.
 * - «Σύνδεση με Lichess» (OAuth με PKCE, μόνο `study:read`): τη ζητούν τα broadcasts από τον Αύγουστο 2026
 *   (χωρίς token: 1 stream και ελάχιστα αιτήματα, που σύντομα κόβονται). Το token μένει σε αυτόν τον υπολογιστή.
 * Όρια του Lichess: ένα αίτημα τη φορά, μετά από 429 αναμονή ενός λεπτού, έως 8 streams παρτίδων ανά IP.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { LichessGameFeed, broadcastGameId, splitPgnStream } from '../core/live.ts';
import { parseHeaderBlock } from '../core/pgn.ts';
import { HANDLED, type Router } from './http.ts';
import { HttpError, type Library } from './library.ts';
import { APP_DIR } from './paths.ts';
import { VERSION } from './about.ts';

const LICHESS = 'https://lichess.org';
const UA = `RuruChess/${VERSION} (local chess app)`;
const CLIENT_ID = 'ruru-chess';
const TOKEN_FILE = path.join(APP_DIR, 'lichess.json');
/** streams προς το Lichess ταυτόχρονα (το Lichess δέχεται έως 8 παρτίδες ανά IP) */
const MAX_STREAMS = 6;
const ID = /^[A-Za-z0-9]{8}$/;

// ---------------------------------------------------------------------------
// λογαριασμός Lichess (token OAuth)

interface Account {
  token: string;
  username: string;
  expires: number;
}

let account: Account | null = (() => {
  try {
    const a = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) as Account;
    return a?.token && (!a.expires || a.expires > Date.now()) ? a : null;
  } catch {
    return null;
  }
})();

function saveAccount(a: Account | null): void {
  account = a;
  try {
    if (a) fs.writeFileSync(TOKEN_FILE, JSON.stringify(a));
    else fs.rmSync(TOKEN_FILE, { force: true });
  } catch {
    /* χωρίς αρχείο: μένει μόνο για αυτή την εκτέλεση */
  }
}

const lichessHeaders = (accept = 'application/json'): Record<string, string> => ({
  'User-Agent': UA,
  Accept: accept,
  ...(account ? { Authorization: `Bearer ${account.token}` } : {}),
});

// ---------------------------------------------------------------------------
// αιτήματα: ένα τη φορά, με cache και αναμονή μετά από 429

let backoffUntil = 0;
/** όταν το Lichess απορρίψει το token (ανακλήθηκε ή έληξε): ενημέρωση των παραθύρων */
let onAuthLost: (() => void) | null = null;

/** Κωδικοί σφάλματος που μεταφράζει το περιβάλλον: rate, auth, notfound, busy, disabled, net. */
function check(res: Response): void {
  if (res.status === 429) {
    backoffUntil = Date.now() + 60_000;
    throw new HttpError(429, 'rate');
  }
  if (res.status === 401 && account) {
    saveAccount(null);
    cache.clear();
    onAuthLost?.();
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'auth');
  if (res.status === 404) throw new HttpError(404, 'notfound');
  if (!res.ok) throw new HttpError(502, 'net');
}

export const codeOf = (e: unknown): string => (e instanceof HttpError ? e.message : 'net');

let chain: Promise<unknown> = Promise.resolve();
const cache = new Map<string, { at: number; data: unknown }>();

/** `text`: true = PGN ως κείμενο, ή άλλο Accept (π.χ. ndjson) ως κείμενο· `ttl` 0 = χωρίς cache. */
function lichessGet<T>(url: string, ttl: number, text: boolean | string = false): Promise<T> {
  const fresh = () => {
    const hit = cache.get(url);
    return hit && Date.now() - hit.at < ttl ? hit : null;
  };
  const hit = fresh();
  if (hit) return Promise.resolve(hit.data as T);
  const run = async () => {
    const again = fresh();
    if (again) return again.data;
    if (Date.now() < backoffUntil) throw new HttpError(429, 'rate');
    let res: Response;
    try {
      res = await fetch(LICHESS + url, { headers: lichessHeaders(typeof text === 'string' ? text : text ? 'application/x-chess-pgn' : 'application/json'), signal: AbortSignal.timeout(ttl > 0 ? 15000 : 60000) });
    } catch {
      throw new HttpError(502, 'net');
    }
    check(res);
    const data = text ? await res.text() : await res.json();
    if (ttl <= 0) return data;
    cache.set(url, { at: Date.now(), data });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    return data;
  };
  const p = chain.then(run, run) as Promise<T>;
  chain = p.catch(() => undefined);
  return p;
}

// ---------------------------------------------------------------------------
// Chess.com (κάρτες «Φίλοι live»): το δημόσιο API δεν δίνει τις live παρτίδες σε εξέλιξη, μόνο τις daily
// (αλληλογραφίας) και τις τελειωμένες. Ένα αίτημα τη φορά (το Chess.com κόβει τα παράλληλα), cache 5′.

const CHESSCOM = 'https://api.chess.com/pub';
const CC_USER = /^[a-z0-9][a-z0-9_-]{1,24}$/;
/** «μόλις έπαιξε»: παρτίδα που τελείωσε τις τελευταίες 3 ώρες */
const CC_RECENT = 3 * 3600_000;
let ccChain: Promise<unknown> = Promise.resolve();
let ccBackoff = 0;
const ccCache = new Map<string, { at: number; data: unknown }>();

/** GET στο Chess.com· στην cache μπαίνει μόνο ό,τι κρατά το `trim` (τα αρχεία του μήνα είναι μεγάλα). null: δεν υπάρχει. */
function chesscomGet<T>(url: string, ttl: number, trim: (d: unknown) => T): Promise<T | null> {
  const fresh = () => {
    const hit = ccCache.get(url);
    return hit && Date.now() - hit.at < ttl ? hit : null;
  };
  const hit = fresh();
  if (hit) return Promise.resolve(hit.data as T | null);
  const run = async () => {
    const again = fresh();
    if (again) return again.data;
    if (Date.now() < ccBackoff) throw new HttpError(429, 'rate');
    let res: Response;
    try {
      res = await fetch(CHESSCOM + url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new HttpError(502, 'net');
    }
    if (res.status === 429) {
      ccBackoff = Date.now() + 60_000;
      throw new HttpError(429, 'rate');
    }
    if (res.status !== 404 && res.status !== 410 && !res.ok) throw new HttpError(502, 'net');
    const data = res.ok ? trim(await res.json()) : null;
    if (ttl <= 0) return data;
    ccCache.set(url, { at: Date.now(), data });
    if (ccCache.size > 200) ccCache.delete(ccCache.keys().next().value!);
    return data;
  };
  const p = ccChain.then(run, run) as Promise<T | null>;
  ccChain = p.catch(() => undefined);
  return p;
}

/**
 * Για την «Προετοιμασία για αντίπαλο» (prep.ts): ροή ndjson γραμμή γραμμή (χιλιάδες παρτίδες, λεπτά), με το token του
 * χρήστη αν υπάρχει (το Lichess δίνει τότε 30 παρτίδες/″ αντί για 20) και τον ίδιο έλεγχο 429 / 401.
 */
export async function lichessStream(url: string, signal: AbortSignal, onLine: (line: string) => void | 'stop'): Promise<void> {
  if (Date.now() < backoffUntil) throw new HttpError(429, 'rate');
  let res: Response;
  try {
    res = await fetch(LICHESS + url, { headers: lichessHeaders('application/x-ndjson'), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new HttpError(502, 'net');
  }
  check(res);
  let buf = '';
  let stopped = false;
  await readText(res, (s) => {
    if (signal.aborted) return 'stop';
    buf += s;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim() && onLine(line) === 'stop') {
        stopped = true;
        return 'stop';
      }
    }
  });
  if (buf.trim() && !signal.aborted && !stopped) onLine(buf);
}

/** Για την «Προετοιμασία» (παίκτες FIDE): JSON από την ίδια ουρά, cache 10′. */
export const lichessCached = <T = unknown>(url: string) => lichessGet<T>(url, 10 * 60_000);

/** Για «Οι παρτίδες μου»: από την ίδια ουρά, χωρίς cache. */
export const lichessNdjson = (url: string) => lichessGet<string>(url, 0, 'application/x-ndjson');
export const chesscomJson = <T>(url: string) => chesscomGet<T>(url, 0, (d) => d as T);

export interface CcGame {
  url: string;
  /** «180+2», «1/86400» (daily) */
  tc: string;
  /** bullet, blitz, rapid, daily */
  cls: string;
  rules: string;
  white: { user: string; rating: number | null; result: string };
  black: { user: string; rating: number | null; result: string };
  end: number | null;
  turn: 'white' | 'black' | null;
  moveBy: number | null;
  pgn: string;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function trimCc(g: any): CcGame {
  // στις daily σε εξέλιξη ο παίκτης είναι link (…/pub/player/όνομα), στα αρχεία αντικείμενο
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const side = (v: any) =>
    typeof v === 'string'
      ? { user: v.split('/').pop() ?? '?', rating: null, result: '' }
      : { user: String(v?.username ?? '?'), rating: Number(v?.rating) || null, result: String(v?.result ?? '') };
  return {
    url: typeof g?.url === 'string' && g.url.startsWith('https://www.chess.com/') ? g.url : '',
    tc: String(g?.time_control ?? '').slice(0, 20),
    cls: String(g?.time_class ?? '').slice(0, 12),
    rules: String(g?.rules ?? 'chess').slice(0, 20),
    white: side(g?.white),
    black: side(g?.black),
    end: Number(g?.end_time) * 1000 || null,
    turn: g?.turn === 'white' || g?.turn === 'black' ? g.turn : null,
    moveBy: Number(g?.move_by) * 1000 || null,
    pgn: typeof g?.pgn === 'string' ? g.pgn.slice(0, 200_000) : '',
  };
}

// ---------------------------------------------------------------------------
// live: ένα stream ανά παρτίδα / γύρο

type Send = (event: string, data: unknown) => void;

/** Η τελευταία κατάσταση μιας παρτίδας: ολόκληρο το PGN (με [%clk]) και πότε ήρθε. */
interface Snapshot {
  id: string;
  pgn: string;
  ended: boolean;
  at: number;
}

interface Feed {
  key: string;
  /** παράθυρο → ποια παρτίδα θέλει */
  subs: Map<Send, string>;
  games: Map<string, Snapshot>;
  error: string | null;
  done: boolean;
  abort: AbortController;
  closeTimer: NodeJS.Timeout | null;
}

const feeds = new Map<string, Feed>();

function publish(feed: Feed, snap: Snapshot): void {
  const old = feed.games.get(snap.id);
  if (old && old.pgn === snap.pgn && old.ended === snap.ended) return;
  feed.games.set(snap.id, snap);
  for (const [send, want] of feed.subs) if (want === snap.id) send('game', snap);
}

function fail(feed: Feed, code: string): void {
  feed.error = code;
  feed.done = true;
  for (const send of feed.subs.keys()) send('fail', { code });
}

function closeFeed(feed: Feed): void {
  feed.abort.abort();
  if (feeds.get(feed.key) === feed) feeds.delete(feed.key);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

/** Διαβάζει το σώμα κομμάτι κομμάτι· `onText` για κάθε κομμάτι κειμένου, 'stop' για διακοπή. */
async function readText(res: Response, onText: (s: string) => void | 'stop'): Promise<void> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (onText(dec.decode(value, { stream: true })) === 'stop') {
      reader.cancel().catch(() => {});
      return;
    }
  }
}

/** Παρτίδα του Lichess (π.χ. TV ή παρτίδα φίλου): `GET /api/stream/game/{id}` (ndjson, από την αρχή της παρτίδας). */
async function runGame(feed: Feed, id: string): Promise<void> {
  const signal = feed.abort.signal;
  // κεφαλίδες (Event, Site, Date, TimeControl, άνοιγμα) από το export, χωρίς κινήσεις
  let headers: Record<string, string> = {};
  try {
    headers = parseHeaderBlock(await lichessGet<string>(`/game/export/${id}?moves=false&tags=true&clocks=false&evals=false&opening=true`, 5000, true)).headers;
  } catch (e) {
    if (codeOf(e) === 'notfound') return fail(feed, 'notfound');
  }
  for (let attempt = 0; attempt < 4 && !signal.aborted; attempt++) {
    // κάθε σύνδεση ξαναστέλνει όλη την παρτίδα: νέα κατάσταση από την αρχή
    const lf = new LichessGameFeed(headers);
    let timer: NodeJS.Timeout | null = null;
    const emit = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      publish(feed, { id, pgn: lf.pgn(), ended: lf.ended, at: Date.now() });
    };
    let res: Response;
    try {
      res = await fetch(`${LICHESS}/api/stream/game/${id}`, { headers: lichessHeaders('application/x-ndjson'), signal });
      check(res);
    } catch (e) {
      if (signal.aborted) return;
      return fail(feed, codeOf(e));
    }
    let buf = '';
    let resync = false;
    try {
      await readText(res, (s) => {
        buf += s;
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          const r = lf.push(msg);
          if (r === 'resync') {
            resync = true;
            return 'stop';
          }
          // στην αρχή έρχεται όλη η παρτίδα μαζί: ένα μήνυμα προς τα παράθυρα ανά 150 ms
          if (r) timer ??= setTimeout(emit, 150);
        }
      });
    } catch {
      if (signal.aborted) return;
    }
    emit();
    if (lf.ended) break;
    await sleep(resync ? 1000 : 3000, signal);
  }
  feed.done = true;
}

/** Γύρος broadcast: `GET /api/stream/broadcast/round/{id}.pgn` (όλες οι παρτίδες, μετά όποια αλλάζει). */
async function runRound(feed: Feed, round: string): Promise<void> {
  const signal = feed.abort.signal;
  // πόσα δευτερόλεπτα σκέφτεται ήδη αυτός που παίζει (από το JSON του γύρου): το ρολόι του στο άνοιγμα
  // μετρά από την τελευταία κίνηση και όχι από τη στιγμή που ανοίξαμε
  const think = new Map<string, number>();
  try {
    const x = await lichessGet<{ games?: Array<{ id: string; thinkTime?: number }> }>(`/api/broadcast/-/-/${round}`, 15_000);
    for (const g of x.games ?? []) if (typeof g.thinkTime === 'number' && g.thinkTime >= 0 && g.thinkTime < 6 * 3600) think.set(g.id, g.thinkTime);
  } catch {
    /* χωρίς thinkTime: το ρολόι μετρά από τώρα */
  }
  for (let attempt = 0; attempt < 30 && !signal.aborted; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${LICHESS}/api/stream/broadcast/round/${round}.pgn?clocks=true&comments=false`, { headers: lichessHeaders('application/x-chess-pgn'), signal });
      check(res);
    } catch (e) {
      if (signal.aborted) return;
      return fail(feed, codeOf(e));
    }
    let buf = '';
    try {
      await readText(res, (s) => {
        const { games, rest } = splitPgnStream(buf + s);
        buf = rest;
        for (const g of games) {
          const id = broadcastGameId(g);
          if (!id) continue;
          // η πρώτη φορά (όλος ο γύρος μαζί): ο χρόνος σκέψης ως τώρα· μετά, κάθε νέα κίνηση έγινε μόλις τώρα
          const t = feed.games.has(id) ? 0 : (think.get(id) ?? 0);
          think.delete(id);
          publish(feed, { id, pgn: g, ended: !/\[Result "\*"\]/.test(g), at: Date.now() - t * 1000 });
        }
      });
    } catch {
      if (signal.aborted) return;
    }
    const all = [...feed.games.values()];
    if (all.length && all.every((g) => g.ended)) break;
    await sleep(15_000, signal);
  }
  feed.done = true;
}

function openFeed(key: string, start: (f: Feed) => Promise<void>): Feed | null {
  const old = feeds.get(key);
  if (old && !old.error) return old;
  if (old) closeFeed(old);
  if ([...feeds.values()].filter((f) => !f.done).length >= MAX_STREAMS) return null;
  const feed: Feed = { key, subs: new Map(), games: new Map(), error: null, done: false, abort: new AbortController(), closeTimer: null };
  feeds.set(key, feed);
  start(feed).catch(() => fail(feed, 'net'));
  return feed;
}

// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const trimTour = (x: any) => ({
  tour: {
    id: String(x?.tour?.id ?? ''),
    name: String(x?.tour?.name ?? ''),
    slug: String(x?.tour?.slug ?? ''),
    tier: Number(x?.tour?.tier ?? 0),
    dates: Array.isArray(x?.tour?.dates) ? x.tour.dates : [],
    info: { tc: x?.tour?.info?.tc, players: x?.tour?.info?.players, location: x?.tour?.info?.location, format: x?.tour?.info?.format },
  },
  round: x?.round ? { id: String(x.round.id), name: String(x.round.name ?? ''), ongoing: Boolean(x.round.ongoing), startsAt: x.round.startsAt ?? null, finishedAt: x.round.finishedAt ?? null } : null,
  group: x?.group ?? null,
});

const trimPlayer = (p: any) => ({ name: String(p?.name ?? '?'), title: p?.title ?? null, rating: p?.rating ?? null, fed: p?.fed ?? null, clock: typeof p?.clock === 'number' ? p.clock : null });
/* eslint-enable @typescript-eslint/no-explicit-any */

function callbackPage(res: ServerResponse, el: boolean, ok: boolean, text: string): typeof HANDLED {
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  const esc = text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  res.end(
    `<!doctype html><html lang="${el ? 'el' : 'en'}"><meta charset="utf-8"><title>Ruru</title>` +
      `<body style="font:16px system-ui,sans-serif;background:#1f1f1f;color:#eee;display:grid;place-items:center;height:90vh">` +
      `<div style="max-width:30em;text-align:center"><h2>${ok ? '✓' : '✗'} Ruru · Lichess</h2><p>${esc}</p>` +
      `<p style="color:#aaa">${el ? 'Μπορείς να κλείσεις αυτή τη σελίδα.' : 'You can close this page.'}</p></div></body></html>`,
  );
  return HANDLED;
}

const LICHESS_USER = /^[a-z0-9][a-z0-9_-]{1,29}$/;

/**
 * Ένας φίλος από το `/api/users/status`: online και (με `withGameMetas`) η παρτίδα που παίζει, π.χ.
 * `playing: {id, clock: "3+2", variant?}`. Μερικές φορές έρχεται σκέτο `playing: true` (χωρίς παρτίδα): `id` null.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function trimStatus(u: any): { id: string; online: boolean; playing?: { id: string | null; clock: string | null; variant: string } } | null {
  if (!u || typeof u.id !== 'string') return null;
  const pl = u.playing && typeof u.playing === 'object' ? u.playing : null;
  const game = typeof pl?.id === 'string' ? pl.id : typeof u.playingId === 'string' ? u.playingId : null;
  return {
    id: u.id.toLowerCase(),
    online: Boolean(u.online),
    ...(u.playing
      ? { playing: { id: game && ID.test(game) ? game : null, clock: typeof pl?.clock === 'string' ? pl.clock.slice(0, 12) : null, variant: typeof pl?.variant === 'string' ? pl.variant.slice(0, 20) : 'standard' } }
      : {}),
  };
}

export function registerWatch(r: Router, lib: Library): void {
  const enabled = () => {
    if (lib.settings.watchLive === false) throw new HttpError(403, 'disabled');
  };
  const el = () => lib.settings.language !== 'en';
  const accountInfo = () => ({ enabled: lib.settings.watchLive !== false, connected: Boolean(account), username: account?.username ?? null, expires: account?.expires || null });
  onAuthLost = () => r.broadcast('lichess', accountInfo());

  r.get('/api/watch/account', () => accountInfo());

  // «Σύνδεση με Lichess»: OAuth με PKCE (χωρίς εγγραφή εφαρμογής), στον browser του χρήστη
  const pending = new Map<string, { verifier: string; redirect: string; at: number }>();
  r.post('/api/watch/login', (req) => {
    enabled();
    const port = req.raw.socket.localPort;
    const redirect = `http://127.0.0.1:${port}/api/watch/callback`;
    const b64 = (b: Buffer) => b.toString('base64url');
    const verifier = b64(crypto.randomBytes(32));
    const state = b64(crypto.randomBytes(16));
    for (const [k, p] of pending) if (Date.now() - p.at > 15 * 60_000) pending.delete(k);
    pending.set(state, { verifier, redirect, at: Date.now() });
    const url =
      `${LICHESS}/oauth?` +
      new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirect,
        code_challenge_method: 'S256',
        code_challenge: b64(crypto.createHash('sha256').update(verifier).digest()),
        scope: 'study:read',
        state,
      }).toString();
    // στον προεπιλεγμένο browser: το explorer.exe ανοίγει φάκελο όταν το link έχει «?…&…=» (κόμματα/ίσον ως διακόπτες)
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
    return { url };
  });

  r.get('/api/watch/callback', async (req) => {
    const state = req.query.get('state') ?? '';
    const p = pending.get(state);
    const code = req.query.get('code');
    if (!p || !code) {
      const denied = req.query.get('error') === 'access_denied';
      return callbackPage(req.res, el(), false, denied ? (el() ? 'Η σύνδεση ακυρώθηκε.' : 'The connection was cancelled.') : el() ? 'Η σύνδεση δεν ολοκληρώθηκε. Δοκίμασε ξανά από το Ruru.' : 'The connection did not complete. Try again from Ruru.');
    }
    pending.delete(state);
    try {
      const tr = await fetch(`${LICHESS}/api/token`, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: p.redirect, client_id: CLIENT_ID }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!tr.ok) throw new Error(String(tr.status));
      const t = (await tr.json()) as { access_token?: string; expires_in?: number };
      if (!t.access_token) throw new Error('token');
      const me = await fetch(`${LICHESS}/api/account`, { headers: { 'User-Agent': UA, Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(15000) });
      const user = me.ok ? ((await me.json()) as { username?: string }).username : undefined;
      saveAccount({ token: t.access_token, username: user ?? '?', expires: t.expires_in ? Date.now() + t.expires_in * 1000 : 0 });
      cache.clear();
      r.broadcast('lichess', accountInfo());
      return callbackPage(req.res, el(), true, el() ? `Συνδέθηκες με το Lichess ως ${user ?? '?'}.` : `Connected to Lichess as ${user ?? '?'}.`);
    } catch {
      return callbackPage(req.res, el(), false, el() ? 'Το Lichess δεν έδωσε πρόσβαση. Δοκίμασε ξανά.' : 'Lichess did not grant access. Try again.');
    }
  });

  r.post('/api/watch/logout', async () => {
    const a = account;
    saveAccount(null);
    cache.clear();
    if (a) await fetch(`${LICHESS}/api/token`, { method: 'DELETE', headers: { 'User-Agent': UA, Authorization: `Bearer ${a.token}` }, signal: AbortSignal.timeout(10000) }).catch(() => {});
    r.broadcast('lichess', accountInfo());
    return accountInfo();
  });

  // λίστες
  r.get('/api/watch/broadcasts', async () => {
    enabled();
    const top = await lichessGet<{ active?: unknown[]; upcoming?: unknown[] }>('/api/broadcast/top?page=1', 60_000);
    return { active: (top.active ?? []).map(trimTour), upcoming: (top.upcoming ?? []).slice(0, 20).map(trimTour) };
  });

  r.get('/api/watch/round/:id', async (req) => {
    enabled();
    if (!ID.test(req.params.id)) throw new HttpError(400, 'notfound');
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const x = await lichessGet<any>(`/api/broadcast/-/-/${req.params.id}`, 15_000);
    return {
      ...trimTour(x),
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      games: (Array.isArray(x?.games) ? x.games : []).map((g: any) => ({
        id: String(g.id),
        players: Array.isArray(g.players) ? g.players.map(trimPlayer) : [],
        fen: g.fen ?? null,
        lastMove: g.lastMove ?? null,
        status: String(g.status ?? '*'),
        thinkTime: g.thinkTime ?? null,
      })),
    };
  });

  // φίλοι στο Lichess: ποιος είναι online και ποια παρτίδα παίζει (έως 100 ονόματα, χωρίς token)
  r.get('/api/watch/friends', async (req) => {
    enabled();
    const ids = [
      ...new Set(
        (req.query.get('ids') ?? '')
          .split(',')
          .map((u) => u.trim().toLowerCase())
          .filter((u) => LICHESS_USER.test(u)),
      ),
    ]
      .sort()
      .slice(0, 100);
    if (!ids.length) return { users: [] };
    const list = await lichessGet<unknown>(`/api/users/status?ids=${ids.join(',')}&withGameMetas=true`, 45_000);
    return { users: (Array.isArray(list) ? list : []).map(trimStatus).filter(Boolean) };
  });

  // φίλοι στο Chess.com: daily σε εξέλιξη και η παρτίδα που μόλις τελείωσε (έως 30 ονόματα)
  r.get('/api/watch/chesscom', async (req) => {
    enabled();
    const users = [
      ...new Set(
        (req.query.get('users') ?? '')
          .split(',')
          .map((u) => u.trim().toLowerCase())
          .filter((u) => CC_USER.test(u)),
      ),
    ].slice(0, 30);
    const now = new Date();
    const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const out: Array<{ user: string; daily: CcGame[]; recent: CcGame[]; error?: string }> = [];
    for (const u of users) {
      try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const daily = await chesscomGet(`/player/${u}/games`, 300_000, (d: any) => (Array.isArray(d?.games) ? d.games.slice(0, 10).map(trimCc) : []));
        const recent = await chesscomGet(`/player/${u}/games/${month}`, 300_000, (d: any) =>
          (Array.isArray(d?.games) ? d.games : [])
            .filter((g: any) => Number(g?.end_time) * 1000 > Date.now() - CC_RECENT)
            .slice(-1)
            .map(trimCc),
        );
        /* eslint-enable @typescript-eslint/no-explicit-any */
        out.push({ user: u, daily: daily ?? [], recent: recent ?? [] });
      } catch (e) {
        out.push({ user: u, daily: [], recent: [], error: codeOf(e) });
        // μετά από 429 ή χωρίς δίκτυο: όχι άλλα αιτήματα τώρα
        if (codeOf(e) === 'rate' || codeOf(e) === 'net') break;
      }
    }
    return { users: out };
  });

  // ο αριθμός κίνησης μιας παρτίδας σε εξέλιξη: μόνο όταν ζητηθεί (π.χ. με το ποντίκι πάνω στον φίλο)
  r.get('/api/watch/moves/:id', async (req) => {
    enabled();
    if (!ID.test(req.params.id)) throw new HttpError(400, 'notfound');
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const g = await lichessGet<any>(`/game/export/${req.params.id}?moves=true&tags=false&clocks=false&evals=false&opening=false`, 60_000);
    const moves = typeof g?.moves === 'string' ? g.moves.trim() : '';
    const plies = moves ? moves.split(/\s+/).length : 0;
    const user = (c: 'white' | 'black') => (typeof g?.players?.[c]?.user?.id === 'string' ? String(g.players[c].user.id) : null);
    return { plies, move: Math.floor(plies / 2) + 1, white: user('white'), black: user('black'), status: String(g?.status ?? '') };
  });

  // live: SSE με «game» (Snapshot) και «fail» ({code})
  r.get('/api/watch/live', (req) => {
    enabled();
    const game = req.query.get('game') ?? '';
    const round = req.query.get('round');
    if (!ID.test(game) || (round !== null && !ID.test(round))) throw new HttpError(400, 'notfound');
    const res = req.res;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 5000\n\n');
    const send: Send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const feed = openFeed(round ? `r:${round}` : `g:${game}`, (f) => (round ? runRound(f, round) : runGame(f, game)));
    if (!feed) {
      send('fail', { code: 'busy' });
      res.end();
      return HANDLED;
    }
    feed.subs.set(send, game);
    if (feed.closeTimer) clearTimeout(feed.closeTimer);
    feed.closeTimer = null;
    const snap = feed.games.get(game);
    if (snap) send('game', snap);
    if (feed.error) send('fail', { code: feed.error });
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    res.on('close', () => {
      clearInterval(ping);
      feed.subs.delete(send);
      if (!feed.subs.size && !feed.closeTimer) feed.closeTimer = setTimeout(() => closeFeed(feed), 30_000);
    });
    return HANDLED;
  });
}
