/**
 * Ruru — «Παρτίδα με φίλο»: ο μικρός server στο Cloudflare.
 *
 *  POST /api/new   → νέο δωμάτιο {id, token} (το καλεί το Ruru του οικοδεσπότη)
 *  GET  /ws/<id>   → WebSocket του δωματίου (οικοδεσπότης με το κλειδί του, φίλος, θεατές)
 *  GET  /g/<id>    → η σελίδα του φίλου (στατικά αρχεία από το dist/, βλ. web/)
 *
 *  Κοινή ανάλυση: POST /api/analysis/new {name, pgn} → {id, token}, WebSocket /wa/<id>, σελίδα /a/<id>.
 *  Φίλοι (social.ts): POST /api/social/register {name}, POST /api/social/recover {key}, WebSocket /social?u=<id>.
 *  Λογαριασμός (κλειδί στο Authorization): POST /api/social/delete?u=, POST /api/social/export?u=
 *  Υπεύθυνος (μόνο αν έχει οριστεί το secret ADMIN_KEY): POST /api/admin {action} (βλ. admin.mjs).
 *  Αρχεία: POST /api/social/file?u=&to=|team=&name=&games= (μόνο PGN σε απλό κείμενο, έως 1 MB, κλειδί στο Authorization),
 *          GET /api/social/file/<id>?u= (μόνο για τα μέλη της συνομιλίας).
 *
 * Κάθε δωμάτιο είναι ένα Durable Object: κρατά την κατάσταση, ελέγχει κάθε κίνηση με τους κανόνες του
 * src/core/online.ts και τη στέλνει σε όλους. Τα δωμάτια σβήνουν μόνα τους μία μέρα μετά την τελευταία κίνηση.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  applyMove,
  checkFlag,
  cleanName,
  colorOf,
  declineDraw,
  newRoom,
  offerDraw,
  randomId,
  requestRematch,
  resign,
  type ClientMsg,
  type Color,
  type Outcome,
  type RoomState,
  type ServerMsg,
} from '../../src/core/online.ts';
import {
  RTC_MAX,
  SHARE_CHAT_KEEP,
  SHARE_KICKED,
  SHARE_LOCKED,
  SHARE_MAX_CHAT,
  SHARE_MAX_GUESTS,
  SHARE_MAX_PGN,
  VOICE_MAX,
  applyRule,
  canCam,
  canEdit,
  cleanLive,
  cleanVideoId,
  cleanVoice,
  type ChatMsg,
  type EngineInfo,
  type Pid,
  type ShareClientMsg,
  type ShareLiveInfo,
  type ShareRules,
  type ShareServerMsg,
  type VoiceState,
} from '../../src/core/share.ts';
import { PGN_MIME, readCapped } from '../../src/core/pgnFile.ts';
import { FILE_DAYS, FILE_MAX, FILE_RE, TEAM_RE, cleanFileName, hashKey, parseNameTag, parseRecovery, USER_RE } from '../../src/core/social.ts';
import { Conversation, Directory, Team, UserHub, type SocialEnv } from './social.ts';

export { Conversation, Directory, Team, UserHub };

interface Env extends SocialEnv {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ANALYSIS: DurableObjectNamespace<AnalysisRoom>;
  ASSETS: Fetcher;
  ROOMS_LIMIT: RateLimit;
  SOCIAL_LIMIT: RateLimit;
  /** secret του υπευθύνου (npx wrangler secret put ADMIN_KEY) */
  ADMIN_KEY?: string;
  /** Cloudflare Realtime TURN (προαιρετικά secrets: wrangler secret put TURN_KEY_ID / TURN_API_TOKEN) */
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
}

type Role = 'host' | 'guest' | 'spectator';
interface Tokens {
  host: string;
  guest: string | null;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
const ROOM_RE = /^[a-z2-9]{8}$/;
const TOKEN_RE = /^[a-z2-9]{24}$/;
const DAY = 24 * 60 * 60 * 1000;
const MAX_MSG = 512;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
}

export interface CreateRequest {
  name?: unknown;
  color?: unknown;
  /** δευτερόλεπτα */
  tc?: { base?: unknown; inc?: unknown } | null;
}

function parseCreate(b: CreateRequest): { name: string; color: Color; tc: RoomState['tc'] } | null {
  const color = b.color === 'white' ? 'w' : b.color === 'black' ? 'b' : b.color === 'random' || b.color === undefined ? (Math.random() < 0.5 ? 'w' : 'b') : null;
  if (!color) return null;
  let tc: RoomState['tc'] = null;
  if (b.tc) {
    const base = Number(b.tc.base);
    const inc = Number(b.tc.inc ?? 0);
    if (!Number.isInteger(base) || !Number.isInteger(inc) || base < 15 || base > 3 * 3600 || inc < 0 || inc > 180) return null;
    tc = { base, inc };
  }
  return { name: cleanName(b.name, 'Host'), color, tc };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const limiter =
      url.pathname === '/api/new' || url.pathname === '/api/analysis/new' || /^\/api\/analysis\/[^/]+\/ice$/.test(url.pathname)
        ? env.ROOMS_LIMIT
        : url.pathname === '/social' || url.pathname === '/api/admin' || url.pathname.startsWith('/api/social/')
          ? env.SOCIAL_LIMIT
          : null;
    // το GET στα endpoints δωματίων παίρνει σκέτο 405 και δεν μετρά
    if (limiter && (req.method === 'POST' || limiter === env.SOCIAL_LIMIT)) {
      const { success } = await limiter.limit({ key: req.headers.get('CF-Connecting-IP') ?? 'local' });
      if (!success) return json({ error: 'rate' }, 429);
    }

    if (url.pathname === '/api/new') {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const body = (await req.json().catch(() => ({}))) as CreateRequest;
      const opts = parseCreate(body ?? {});
      if (!opts) return json({ error: 'bad request' }, 400);
      for (let i = 0; i < 3; i++) {
        const id = randomId(8);
        const token = await env.ROOMS.get(env.ROOMS.idFromName(id)).create(id, opts.name, opts.color, opts.tc);
        if (token) return json({ id, token });
      }
      return json({ error: 'busy' }, 503);
    }

    if (url.pathname === '/api/analysis/new') {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const text = await req.text();
      if (text.length > SHARE_MAX_PGN + 2000) return json({ error: 'too large' }, 413);
      let body: { name?: unknown; pgn?: unknown; rules?: unknown } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        return json({ error: 'bad request' }, 400);
      }
      const pgn = typeof body.pgn === 'string' ? body.pgn : '';
      for (let i = 0; i < 3; i++) {
        const id = randomId(8);
        const token = await env.ANALYSIS.get(env.ANALYSIS.idFromName(id)).create(id, cleanName(body.name, 'Host'), pgn, body.rules === true);
        if (token) return json({ id, token });
      }
      return json({ error: 'busy' }, 503);
    }

    const iceMatch = /^\/api\/analysis\/([^/]+)\/ice$/.exec(url.pathname);
    if (iceMatch) {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      return analysisIce(req, env, iceMatch[1]);
    }

    if (url.pathname === '/api/social/register' || url.pathname === '/api/social/recover') {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const text = await req.text();
      if (text.length > 1000) return json({ error: 'bad request' }, 400);
      let body: { name?: unknown; key?: unknown; accept?: unknown } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        return json({ error: 'bad request' }, 400);
      }
      const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
      if (url.pathname === '/api/social/register') {
        const r = await dir.register(typeof body.name === 'string' ? body.name : '', req.headers.get('CF-Connecting-IP') ?? 'local', body.accept);
        return 'error' in r ? json(r, r.error === 'rate' ? 429 : 400) : json(r);
      }
      const key = typeof body.key === 'string' ? parseRecovery(body.key) : null;
      const p = key ? await dir.recover(await hashKey(key)) : null;
      return p ? json({ userId: p.id, name: p.name, tag: p.tag, key }) : json({ error: 'notfound' }, 404);
    }

    if (url.pathname === '/api/social/delete' || url.pathname === '/api/social/export') {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      const u = url.searchParams.get('u') ?? '';
      if (!USER_RE.test(u)) return json({ error: 'bad' }, 400);
      const hub = env.USERS.get(env.USERS.idFromName(u));
      if (url.pathname === '/api/social/delete') return (await hub.deleteAccount(bearer(req))) ? json({ ok: true }) : json({ error: 'auth' }, 401);
      const r = await hub.exportData(bearer(req));
      if ('error' in r) return json(r, r.error === 'rate' ? 429 : 401);
      return new Response(r.json, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', ...CORS } });
    }

    if (url.pathname === '/api/admin') return admin(req, env);

    if (url.pathname === '/api/social/file' && req.method === 'POST') return uploadFile(req, url, env);
    const file = /^\/api\/social\/file\/([a-z2-9]+)$/.exec(url.pathname);
    if (file && req.method === 'GET') return downloadFile(req, url, env, file[1]);

    if (url.pathname === '/social') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const u = url.searchParams.get('u') ?? '';
      if (!USER_RE.test(u)) return new Response('Not found', { status: 404 });
      return env.USERS.get(env.USERS.idFromName(u)).fetch(req);
    }

    const wa = /^\/wa\/([^/]+)$/.exec(url.pathname);
    if (wa) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!ROOM_RE.test(wa[1])) return new Response('Not found', { status: 404 });
      return env.ANALYSIS.get(env.ANALYSIS.idFromName(wa[1])).fetch(req);
    }

    const ws = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (ws) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!ROOM_RE.test(ws[1])) return new Response('Not found', { status: 404 });
      return env.ROOMS.get(env.ROOMS.idFromName(ws[1])).fetch(req);
    }

    // η σελίδα του φίλου (το wrangler.jsonc στέλνει ό,τι άλλο κατευθείαν στα στατικά αρχεία)
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Φωνή & κάμερα: Cloudflare Realtime TURN credentials (μόνο για συμμετέχοντες ενεργού δωματίου).
// Αν δεν έχουν οριστεί τα secrets TURN_KEY_ID / TURN_API_TOKEN, επιστρέφει μόνο τον STUN της Cloudflare.

const STUN_ONLY: Array<{ urls: string[] }> = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

function cleanIceServers(raw: unknown): Array<{ urls: string[]; username?: string; credential?: string }> {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: Array<{ urls: string[]; username?: string; credential?: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = (Array.isArray(o.urls) ? o.urls : typeof o.urls === 'string' ? [o.urls] : []).filter(
      // οι browsers μπλοκάρουν τη θύρα 53 (DNS) και καθυστερούν το ICE
      (u): u is string => typeof u === 'string' && !/:53(?:[/?]|$)/.test(u),
    );
    if (!urls.length) continue;
    out.push({
      urls,
      ...(typeof o.username === 'string' ? { username: o.username } : {}),
      ...(typeof o.credential === 'string' ? { credential: o.credential } : {}),
    });
  }
  return out.length ? out : STUN_ONLY;
}

async function analysisIce(req: Request, env: Env, id: string): Promise<Response> {
  if (!ROOM_RE.test(id)) return json({ error: 'notfound' }, 404);
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body?.token === 'string' ? body.token : bearer(req);
  if (!TOKEN_RE.test(token)) return json({ error: 'auth' }, 401);
  if (!(await env.ANALYSIS.get(env.ANALYSIS.idFromName(id)).hasToken(token))) return json({ error: 'forbidden' }, 403);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', ...CORS };
  const keyId = env.TURN_KEY_ID?.trim();
  const apiToken = env.TURN_API_TOKEN?.trim();
  if (!keyId || !apiToken) return new Response(JSON.stringify({ iceServers: STUN_ONLY, turn: false }), { headers });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 7200 }),
    });
    if (!r.ok) return new Response(JSON.stringify({ iceServers: STUN_ONLY, turn: false }), { headers });
    const data = (await r.json()) as { iceServers?: unknown };
    const iceServers = cleanIceServers(data.iceServers);
    const hasTurn = iceServers.some((s) => s.urls.some((u) => u.startsWith('turn:') || u.startsWith('turns:')));
    return new Response(JSON.stringify({ iceServers, turn: hasTurn }), { headers });
  } catch {
    return new Response(JSON.stringify({ iceServers: STUN_ONLY, turn: false }), { headers });
  }
}

// ---------------------------------------------------------------------------
// Φίλοι: αρχεία (μόνο PGN σε απλό κείμενο, έως 1 MB) στο Workers KV, που τα σβήνει μόνο του σε 7 μέρες

const bearer = (req: Request) => /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';

async function uploadFile(req: Request, url: URL, env: Env): Promise<Response> {
  const u = url.searchParams.get('u') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const team = url.searchParams.get('team') ?? '';
  // το όνομα τελειώνει πάντα σε .pgn, ό,τι κι αν δήλωσε ο αποστολέας
  const name = cleanFileName(url.searchParams.get('name')?.replace(/\.pgn$/i, ''));
  if (!USER_RE.test(u) || !name || (team ? !TEAM_RE.test(team) : !USER_RE.test(to))) return json({ error: 'bad' }, 400);
  if (Number(req.headers.get('Content-Length') ?? 0) > FILE_MAX) return json({ error: 'large' }, 413);
  const hub = env.USERS.get(env.USERS.idFromName(u));
  const id = randomId(20);
  const ok = await hub.fileCheck(bearer(req), to, team, id);
  if ('error' in ok) return json({ error: ok.error }, ok.error === 'auth' ? 401 : ok.error === 'rate' ? 429 : 403);
  const type = (req.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== PGN_MIME || req.headers.has('Content-Encoding')) return json({ error: 'notpgn' }, 415);
  // το Content-Length μπορεί να λείπει ή να λέει ψέματα: μετρά ό,τι φτάνει
  const data = await readCapped(req.body, FILE_MAX);
  if (!data) return json({ error: 'large' }, 413);
  // ο έλεγχος περιεχομένου στο Durable Object: ο Worker του δωρεάν πλάνου έχει μόνο 10 ms CPU
  const pgn = await hub.fileInspect(data);
  if ('error' in pgn) return json({ error: pgn.error }, pgn.error === 'large' ? 413 : 400);
  const exp = Date.now() + FILE_DAYS * DAY;
  await env.FILES.put(id, data, { expirationTtl: FILE_DAYS * 24 * 3600, metadata: { conv: ok.conv, from: u, pgn: true, exp } });
  if (!(await hub.fileShared(to, team, { id, name: `${name}.pgn`, games: pgn.games, size: data.byteLength, exp }))) {
    await env.FILES.delete(id);
    return json({ error: team ? 'notmember' : 'notfriend' }, 403);
  }
  return json({ id, exp });
}

async function downloadFile(req: Request, url: URL, env: Env, id: string): Promise<Response> {
  const u = url.searchParams.get('u') ?? '';
  if (!USER_RE.test(u) || !FILE_RE.test(id)) return json({ error: 'bad' }, 400);
  if (!(await env.USERS.get(env.USERS.idFromName(u)).verifyKey(bearer(req)))) return json({ error: 'auth' }, 401);
  const got = await env.FILES.getWithMetadata<{ conv: string; from: string; pgn?: boolean; exp?: number }>(id, 'stream');
  if (!got.value || !got.metadata) return json({ error: 'gone' }, 404);
  // μόνο όσοι είναι στη συνομιλία: οι δύο φίλοι, ή τα μέλη της ομάδας
  const conv = got.metadata.conv;
  let allowed = false;
  if (conv.startsWith('dm:')) allowed = conv.split(':').slice(1).includes(u);
  else if (conv.startsWith('team:')) allowed = await env.TEAMS.get(env.TEAMS.idFromName(conv.slice(5))).isMember(u);
  if (!allowed) {
    await got.value.cancel();
    return json({ error: 'forbidden' }, 403);
  }
  // ληγμένο, ή από την παλιά έκδοση (gzip χωρίς έλεγχο περιεχομένου): δεν δίνεται και σβήνεται
  if (got.metadata.pgn !== true || !(Number(got.metadata.exp) > Date.now())) {
    await got.value.cancel();
    await env.FILES.delete(id);
    return json({ error: 'gone' }, 404);
  }
  return new Response(got.value, {
    headers: {
      'Content-Type': `${PGN_MIME}; charset=utf-8`,
      'Content-Disposition': 'attachment; filename="games.pgn"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      ...CORS,
    },
  });
}

// ---------------------------------------------------------------------------
// Υπεύθυνος: αναφορές, αφαίρεση περιεχομένου, διαγραφή λογαριασμού με αίτημα (relay/admin.mjs)

async function admin(req: Request, env: Env): Promise<Response> {
  const secret = env.ADMIN_KEY ?? '';
  // χωρίς secret δεν υπάρχει καν
  if (secret.length < 32) return json({ error: 'notfound' }, 404);
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  // σύγκριση hash, ώστε ο χρόνος να μη δείχνει πόσο σωστό ήταν το κλειδί
  if ((await hashKey(bearer(req))) !== (await hashKey(secret))) return json({ error: 'auth' }, 401);
  const body = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
  const hub = (u: string) => env.USERS.get(env.USERS.idFromName(u));
  switch (body?.action) {
    case 'reports':
      return json({ reports: await dir.reports() });
    case 'test-accounts':
      return json({ accounts: await dir.testAccounts() });
    case 'close':
      return json({ ok: await dir.closeReport(id) });
    case 'remove-message': {
      const r = await dir.reportById(id);
      if (!r?.conv) return json({ error: 'notfound' }, 404);
      if (r.conv.startsWith('team:')) await env.TEAMS.get(env.TEAMS.idFromName(r.conv.slice(5))).removeMsg(r.target, r.mid);
      else {
        const got = await env.CONVS.get(env.CONVS.idFromName(r.conv)).remove(r.target, r.mid);
        if (got.file) await env.FILES.delete(got.file);
        const [a, b] = r.conv.split(':').slice(1);
        if (got.ok) await Promise.all([hub(a).msgDeleted(b, r.mid), hub(b).msgDeleted(a, r.mid)]);
      }
      return json({ ok: true });
    }
    case 'delete-team': {
      if (!TEAM_RE.test(id)) return json({ error: 'bad' }, 400);
      await env.TEAMS.get(env.TEAMS.idFromName(id)).dissolve();
      return json({ ok: true });
    }
    case 'delete-user': {
      const nt = parseNameTag(id);
      const u = nt ? ((await dir.find(nt.name, nt.tag))?.id ?? '') : id;
      if (!USER_RE.test(u)) return json({ error: 'notfound' }, 404);
      return json({ ok: await hub(u).beginDelete() });
    }
    default:
      return json({ error: 'bad' }, 400);
  }
}

export class GameRoom extends DurableObject<Env> {
  private room: RoomState | null = null;
  private tokens: Tokens | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // το ping του browser απαντιέται χωρίς να «ξυπνήσει» το δωμάτιο
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    void ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>('room')) ?? null;
      this.tokens = (await ctx.storage.get<Tokens>('tokens')) ?? null;
    });
  }

  /** Νέο δωμάτιο· null αν το αναγνωριστικό υπάρχει ήδη. */
  async create(id: string, name: string, color: Color, tc: RoomState['tc']): Promise<string | null> {
    if (this.room) return null;
    this.room = newRoom({ id, hostName: name, hostColor: color, tc }, Date.now());
    this.tokens = { host: randomId(24), guest: null };
    await this.save();
    return this.tokens.host;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put({ room: this.room, tokens: this.tokens });
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }

  /** Καθάρισμα: μία μέρα χωρίς κίνηση και κανείς συνδεδεμένος → το δωμάτιο σβήνει. */
  async alarm(): Promise<void> {
    if (this.sockets().length) {
      await this.ctx.storage.setAlarm(Date.now() + DAY);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.room = null;
    this.tokens = null;
  }

  private sockets(tag?: Role): WebSocket[] {
    return this.ctx.getWebSockets(tag).filter((w) => w.readyState === WebSocket.OPEN);
  }

  private broadcast(): void {
    if (!this.room) return;
    const msg: ServerMsg = {
      t: 'state',
      state: this.room,
      online: { host: this.sockets('host').length > 0, guest: this.sockets('guest').length > 0 },
      now: Date.now(),
    };
    const text = JSON.stringify(msg);
    for (const w of this.sockets()) {
      try {
        w.send(text);
      } catch {
        // κλείνει ήδη
      }
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // κλείνει ήδη
    }
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (!this.room || !this.tokens) {
      this.ctx.acceptWebSocket(server, ['spectator']);
      server.close(4404, 'room not found');
      return new Response(null, { status: 101, webSocket: client });
    }
    const url = new URL(req.url);
    const token = url.searchParams.get('t') ?? '';
    let role: Role = 'spectator';
    let fresh: string | undefined;
    if (token && token === this.tokens.host) role = 'host';
    else if (token && token === this.tokens.guest) role = 'guest';
    else if (!this.tokens.guest) {
      // ο πρώτος που ανοίγει το link χωρίς κλειδί είναι ο φίλος
      role = 'guest';
      // ο καλεσμένος μπορεί να φέρει δικό του κλειδί (Ruru με πρόσκληση): έτσι και μια δεύτερη σύνδεση
      // πριν φτάσει το welcome είναι ο ίδιος άνθρωπος, όχι θεατής ή νέος καλεσμένος
      fresh = TOKEN_RE.test(token) ? token : randomId(24);
      this.tokens = { ...this.tokens, guest: fresh };
      this.room = { ...this.room, guestJoined: true, names: { ...this.room.names, guest: cleanName(url.searchParams.get('name'), 'Guest') } };
      await this.save();
    }
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role });
    this.sendTo(server, { t: 'welcome', role, ...(fresh ? { token: fresh } : {}) });
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > MAX_MSG || !this.room) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(data) as ClientMsg;
    } catch {
      return;
    }
    const role = ((ws.deserializeAttachment() as { role?: Role } | null)?.role ?? 'spectator') as Role;
    if (role === 'spectator' || typeof m !== 'object' || !m) return;
    const room = this.room;
    const now = Date.now();
    const me = colorOf(room, role);
    let out: Outcome;
    switch (m.t) {
      case 'move':
        out = applyMove(room, me, m.uci, m.ply, now);
        break;
      case 'resign':
        out = resign(room, me, now);
        break;
      case 'abort':
        out = room.moves.length < 2 ? resign(room, me, now) : { ok: false, error: 'late' };
        break;
      case 'draw':
        out = offerDraw(room, me, now);
        break;
      case 'decline':
        out = declineDraw(room, me);
        break;
      case 'flag': {
        const s = checkFlag(room, now);
        out = s === room ? { ok: false, error: 'time' } : { ok: true, state: s };
        break;
      }
      case 'rematch':
        out = requestRematch(checkFlag(room, now), role, now);
        break;
      case 'name':
        out = { ok: true, state: { ...room, names: { ...room.names, [role]: cleanName(m.name, room.names[role] || (role === 'host' ? 'Host' : 'Guest')) } } };
        break;
      default:
        return;
    }
    if (!out.ok) {
      this.sendTo(ws, { t: 'error', msg: out.error });
      // ο browser είχε παλιά εικόνα (π.χ. ρολόι): ξαναστέλνουμε την κατάσταση
      this.broadcast();
      return;
    }
    this.room = out.state;
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // ήδη κλειστό
    }
    this.broadcast();
  }

  async webSocketError(): Promise<void> {
    this.broadcast();
  }
}

// ---------------------------------------------------------------------------
// Κοινή ανάλυση: ένα δωμάτιο ανά ανάλυση. Κρατά το τελευταίο PGN και το chat· η θέση όπου βρίσκεται ο καθένας
// (για το «ίδια θέση») μένει στο WebSocket του, και η μηχανή του οικοδεσπότη μόνο στη μνήμη.

interface ShareMeta {
  id: string;
  seq: number;
  names: Record<Pid, string>;
  /** κλειδί → συμμετέχων */
  tokens: Record<string, Pid>;
  guests: number;
  /** μόνο σε δωμάτια από KnightBase ≥ 2.4.0 (αλλιώς αλλάζουν όλοι) */
  rules?: ShareRules;
  /** κλειδιά όσων έβγαλε ο οικοδεσπότης */
  kicked?: string[];
}
interface ShareAttach {
  pid: Pid;
  role: 'host' | 'guest';
  cursor?: string[];
  voice?: VoiceState;
}

const UCI_RE = /^(?:[a-h][1-8][a-h][1-8][qrbn]?|0000)$/;
/** η θέση του καθενός μένει στο WebSocket του (έως 2 KB) */
const CURSOR_KEEP = 200;

export class AnalysisRoom extends DurableObject<Env> {
  private meta: ShareMeta | null = null;
  private pgn = '';
  private chat: ChatMsg[] = [];
  private engine: EngineInfo | null = null;
  private live: ShareLiveInfo | null = null;
  private liveAt = 0;
  private video: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    void ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get<unknown>(['meta', 'pgn', 'chat']);
      this.meta = (got.get('meta') as ShareMeta | undefined) ?? null;
      this.pgn = (got.get('pgn') as string | undefined) ?? '';
      this.chat = (got.get('chat') as ChatMsg[] | undefined) ?? [];
    });
  }

  async create(id: string, name: string, pgn: string, rules = false): Promise<string | null> {
    if (this.meta || pgn.length > SHARE_MAX_PGN) return null;
    const token = randomId(24);
    this.meta = { id, seq: 1, names: { h: name }, tokens: { [token]: 'h' }, guests: 0, ...(rules ? { rules: { editors: [], silenced: [], cams: [] } } : {}) };
    this.pgn = pgn;
    this.chat = [];
    await this.ctx.storage.put({ meta: this.meta, pgn: this.pgn, chat: this.chat });
    await this.ctx.storage.setAlarm(Date.now() + DAY);
    return token;
  }

  /** Ανήκει αυτό το κλειδί σε ενεργό συμμετέχοντα του δωματίου; (για έκδοση TURN credentials). */
  async hasToken(token: string): Promise<boolean> {
    return Boolean(this.meta && token && this.meta.tokens[token]);
  }

  private async save(parts: { meta?: boolean; pgn?: boolean; chat?: boolean }): Promise<void> {
    const out: Record<string, unknown> = {};
    if (parts.meta) out.meta = this.meta;
    if (parts.pgn) out.pgn = this.pgn;
    if (parts.chat) out.chat = this.chat;
    await this.ctx.storage.put(out);
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }

  async alarm(): Promise<void> {
    if (this.open().length) {
      await this.ctx.storage.setAlarm(Date.now() + DAY);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.meta = null;
    this.pgn = '';
    this.chat = [];
    this.engine = null;
  }

  private open(): WebSocket[] {
    return this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN);
  }

  /** Υπόλοιπος χρόνος τώρα (με το ρολόι του relay, ανεξάρτητα από τυχόν απόκλιση ώρας host/guest). */
  private currentLive(): ShareLiveInfo | null {
    const l = this.live;
    if (!l) return null;
    if (l.status !== 'live' || l.plies < 2 || !this.liveAt) return l;
    const elapsed = Math.max(0, Date.now() - this.liveAt);
    const v = l[l.turn];
    return { ...l, [l.turn]: v === null ? null : Math.max(0, v - elapsed), at: Date.now() };
  }

  private presence() {
    const online = [...new Set(this.open().map((w) => (w.deserializeAttachment() as ShareAttach | null)?.pid).filter((p): p is Pid => Boolean(p)))];
    return { online, names: this.meta?.names ?? {} };
  }

  /** Η φωνή του καθενός (από το WebSocket του που είναι μέσα στη φωνή). */
  private voices(except?: WebSocket): Record<Pid, VoiceState> {
    const out: Record<Pid, VoiceState> = {};
    for (const w of this.open()) {
      if (w === except) continue;
      const a = w.deserializeAttachment() as ShareAttach | null;
      if (a?.voice) out[a.pid] = a.voice;
    }
    return out;
  }

  private socketsOf(pid: Pid): WebSocket[] {
    return this.open().filter((w) => (w.deserializeAttachment() as ShareAttach | null)?.pid === pid);
  }

  /** Κλείνει το μικρόφωνο ή την κάμερα κάποιου (σίγαση ή άδεια που πάρθηκε πίσω), και το λέει σε όλους. */
  private forceOff(pid: Pid, what: 'mic' | 'cam'): void {
    for (const w of this.socketsOf(pid)) {
      const a = w.deserializeAttachment() as ShareAttach;
      if (!a.voice?.[what]) continue;
      a.voice = { ...a.voice, [what]: false };
      w.serializeAttachment(a);
      this.broadcast({ t: 'voice', by: pid, state: a.voice });
    }
  }

  private send(ws: WebSocket, msg: ShareServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // κλείνει ήδη
    }
  }

  private broadcast(msg: ShareServerMsg, except?: WebSocket): void {
    const text = JSON.stringify(msg);
    for (const w of this.open()) {
      if (w === except) continue;
      try {
        w.send(text);
      } catch {
        // κλείνει ήδη
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const meta = this.meta;
    if (!meta) {
      this.ctx.acceptWebSocket(server);
      server.close(4404, 'room not found');
      return new Response(null, { status: 101, webSocket: client });
    }
    const url = new URL(req.url);
    const token = url.searchParams.get('t') ?? '';
    if (token && meta.kicked?.includes(token)) {
      this.ctx.acceptWebSocket(server);
      server.close(SHARE_KICKED, 'kicked');
      return new Response(null, { status: 101, webSocket: client });
    }
    let pid: Pid | undefined = token ? meta.tokens[token] : undefined;
    let fresh: string | undefined;
    if (!pid) {
      if (meta.rules?.locked) {
        this.ctx.acceptWebSocket(server);
        server.close(SHARE_LOCKED, 'room locked');
        return new Response(null, { status: 101, webSocket: client });
      }
      if (meta.guests >= SHARE_MAX_GUESTS) {
        this.ctx.acceptWebSocket(server);
        server.close(4429, 'room full');
        return new Response(null, { status: 101, webSocket: client });
      }
      meta.guests++;
      pid = `g${meta.guests}`;
      // ο καλεσμένος μπορεί να φέρει δικό του κλειδί (Ruru με πρόσκληση): έτσι και μια δεύτερη σύνδεση
      // πριν φτάσει το welcome είναι ο ίδιος άνθρωπος, όχι θεατής ή νέος καλεσμένος
      fresh = TOKEN_RE.test(token) ? token : randomId(24);
      meta.tokens[fresh] = pid;
      meta.names[pid] = cleanName(url.searchParams.get('name'), 'Guest');
      await this.save({ meta: true });
    }
    const role = pid === 'h' ? 'host' : 'guest';
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid, role } satisfies ShareAttach);
    const cursors: Record<Pid, string[]> = {};
    for (const w of this.open()) {
      const a = w.deserializeAttachment() as ShareAttach | null;
      // όποιος μόνο βλέπει δεν τραβά τους άλλους στη θέση του
      if (a?.cursor && canEdit(meta.rules, a.pid)) cursors[a.pid] = a.cursor;
    }
    this.send(server, { t: 'welcome', pid, role, v: 3, ...(fresh ? { token: fresh } : {}) });
    const liveInit = this.currentLive();
    this.send(server, { t: 'init', pgn: this.pgn, seq: meta.seq, chat: this.chat, presence: this.presence(), cursors, engine: this.engine, voice: this.voices(), ...(liveInit ? { live: liveInit } : {}), ...(this.video ? { video: this.video } : {}), ...(meta.rules ? { rules: meta.rules } : {}) });
    this.broadcast({ t: 'presence', presence: this.presence() }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const meta = this.meta;
    if (typeof data !== 'string' || data.length > SHARE_MAX_PGN + 1000 || !meta) return;
    let m: ShareClientMsg;
    try {
      m = JSON.parse(data) as ShareClientMsg;
    } catch {
      return;
    }
    const at = ws.deserializeAttachment() as ShareAttach | null;
    if (!at || typeof m !== 'object' || !m) return;
    switch (m.t) {
      case 'pgn': {
        if (typeof m.pgn !== 'string' || m.pgn.length > SHARE_MAX_PGN || m.pgn === this.pgn) return;
        if (!canEdit(meta.rules, at.pid)) {
          // χωρίς άδεια: η αλλαγή δεν περνά, και ο ίδιος γυρίζει στην ανάλυση όπως είναι
          this.send(ws, { t: 'pgn', pgn: this.pgn, seq: meta.seq, by: 'h' });
          return;
        }
        this.pgn = m.pgn;
        meta.seq++;
        await this.save({ meta: true, pgn: true });
        this.broadcast({ t: 'pgn', pgn: this.pgn, seq: meta.seq, by: at.pid }, ws);
        return;
      }
      case 'cursor': {
        const path = m.path;
        if (!Array.isArray(path) || path.length > 2000 || !path.every((x) => typeof x === 'string' && UCI_RE.test(x))) return;
        ws.serializeAttachment({ ...at, cursor: path.length <= CURSOR_KEEP ? path : undefined } satisfies ShareAttach);
        if (canEdit(meta.rules, at.pid)) this.broadcast({ t: 'cursor', by: at.pid, path }, ws);
        return;
      }
      case 'chat': {
        const text = typeof m.text === 'string' ? m.text.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, SHARE_MAX_CHAT) : '';
        if (!text) return;
        const msg: ChatMsg = { by: at.pid, name: meta.names[at.pid] ?? at.pid, text, at: Date.now() };
        this.chat = [...this.chat, msg].slice(-SHARE_CHAT_KEEP);
        await this.save({ chat: true });
        this.broadcast({ t: 'chat', msg });
        return;
      }
      case 'engine': {
        if (at.role !== 'host') return;
        const info = m.info;
        this.engine = info && typeof info.fen === 'string' && Array.isArray(info.lines) ? { fen: info.fen, depth: Number(info.depth) || 0, lines: info.lines.slice(0, 5) } : null;
        this.broadcast({ t: 'engine', info: this.engine }, ws);
        return;
      }
      case 'live': {
        if (at.role !== 'host') return;
        this.live = cleanLive(m.info);
        this.liveAt = this.live ? Date.now() : 0;
        this.broadcast({ t: 'live', info: this.live }, ws);
        return;
      }
      case 'video': {
        if (!canEdit(meta.rules, at.pid)) return;
        this.video = cleanVideoId(m.id);
        this.broadcast({ t: 'video', id: this.video });
        return;
      }
      case 'voice': {
        let state = cleanVoice(m.state);
        if (state && meta.rules?.silenced.includes(at.pid)) state = { ...state, mic: false };
        if (state?.cam && !canCam(meta.rules, at.pid)) state = { ...state, cam: false };
        if (state && !at.voice && Object.keys(this.voices(ws)).filter((p) => p !== at.pid).length >= VOICE_MAX) state = null;
        ws.serializeAttachment({ ...at, voice: state ?? undefined } satisfies ShareAttach);
        this.broadcast({ t: 'voice', by: at.pid, state });
        return;
      }
      case 'rtc': {
        if (typeof m.to !== 'string' || m.to === at.pid || !at.voice || !m.data || typeof m.data !== 'object' || JSON.stringify(m.data).length > RTC_MAX) return;
        const out: ShareServerMsg = { t: 'rtc', by: at.pid, data: m.data };
        for (const w of this.socketsOf(m.to)) if ((w.deserializeAttachment() as ShareAttach).voice) this.send(w, out);
        return;
      }
      case 'lock': {
        if (at.role !== 'host' || !meta.rules || typeof m.on !== 'boolean') return;
        meta.rules = applyRule(meta.rules, m, []);
        await this.save({ meta: true });
        this.broadcast({ t: 'rules', rules: meta.rules });
        return;
      }
      case 'perm':
      case 'silence':
      case 'cam':
      case 'kick': {
        if (at.role !== 'host' || !meta.rules || typeof m.pid !== 'string' || m.pid === 'h') return;
        if ((m.t === 'perm' && typeof m.edit !== 'boolean') || ((m.t === 'silence' || m.t === 'cam') && typeof m.on !== 'boolean')) return;
        const guests = this.presence().online.filter((p) => p !== 'h');
        meta.rules = applyRule(meta.rules, m, guests);
        if (m.t === 'kick') {
          const gone = Object.keys(meta.tokens).filter((k) => meta.tokens[k] === m.pid);
          for (const k of gone) delete meta.tokens[k];
          meta.kicked = [...(meta.kicked ?? []), ...gone].slice(-200);
        }
        await this.save({ meta: true });
        this.broadcast({ t: 'rules', rules: meta.rules });
        if (m.t === 'silence' && m.on) this.forceOff(m.pid, 'mic');
        if (m.t === 'cam' && !m.on) this.forceOff(m.pid, 'cam');
        if (m.t === 'kick') {
          for (const w of this.socketsOf(m.pid)) {
            try {
              w.close(SHARE_KICKED, 'kicked');
            } catch {
              // ήδη κλειστό
            }
          }
          this.broadcast({ t: 'voice', by: m.pid, state: null });
          this.broadcast({ t: 'presence', presence: this.presence() });
        }
        return;
      }
      case 'name': {
        meta.names[at.pid] = cleanName(m.name, meta.names[at.pid] ?? 'Guest');
        await this.save({ meta: true });
        this.broadcast({ t: 'presence', presence: this.presence() });
        return;
      }
      default:
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // ήδη κλειστό
    }
    this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  /** Κάποιος έφυγε: ποιοι μένουν, και η φωνή του (αν δεν είναι μέσα από άλλη σύνδεση). */
  private left(ws: WebSocket): void {
    const at = ws.deserializeAttachment() as ShareAttach | null;
    if (at?.voice) this.broadcast({ t: 'voice', by: at.pid, state: this.voices(ws)[at.pid] ?? null }, ws);
    this.broadcast({ t: 'presence', presence: this.presence() }, ws);
  }
}
