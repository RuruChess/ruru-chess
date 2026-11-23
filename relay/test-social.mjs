// Έλεγχος των Φίλων σε τοπικό wrangler με δική του προσωρινή αποθήκευση (δεν αγγίζει το .wrangler ή τον
// πραγματικό server): όροι και ηλικία, αναφορές, εργαλείο υπευθύνου, εξαγωγή, και ότι μετά τη διαγραφή
// λογαριασμού δεν μένει τίποτα δικό του σε κανέναν πίνακα ή αρχείο. Και ο κανόνας των αρχείων: μόνο PGN σε
// απλό κείμενο έως 1 MB, που σβήνεται σε 7 μέρες.
//
//   npm run build:web && node test-social.mjs
//   node test-social.mjs --old <wrangler.jsonc παλιού relay>   και η αναβάθμιση λογαριασμών της δοκιμής
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, gzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(here, 'wrangler.jsonc');
const OLD = process.argv.includes('--old') ? path.resolve(process.argv[process.argv.indexOf('--old') + 1]) : null;
const ADMIN = randomBytes(24).toString('hex');
const ACCEPT = { terms: /TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(here, '../src/core/social.ts'), 'utf8'))[1], age16: true };

const PGN = 'application/x-chess-pgn';
const MB = 1024 * 1024;
const DAY_MS = 24 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
function ok(cond, text, extra) {
  if (cond) passed++;
  else {
    failed++;
    console.error('✗', text, extra ?? '');
  }
}

async function until(fn, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(60);
  }
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let base = '';
let proc = null;
let log = '';
async function start(config, dir) {
  const port = await freePort();
  const inspector = await freePort();
  base = `http://127.0.0.1:${port}`;
  log = '';
  proc = spawn(
    process.execPath,
    [path.join(here, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', config, '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', dir, '--var', `ADMIN_KEY:${ADMIN}`],
    { cwd: path.dirname(config), env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', CI: '1' } },
  );
  for (const s of [proc.stdout, proc.stderr]) s.on('data', (d) => (log += d));
  const up = await until(() => fetch(`${base}/api/new`).then((r) => r.status === 405, () => false), 60_000);
  if (!up) throw new Error(`δεν ξεκίνησε το wrangler\n${log}`);
}
async function stop() {
  if (!proc) return;
  const p = proc;
  proc = null;
  if (p.exitCode === null) {
    const done = new Promise((r) => p.once('exit', r));
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill();
    await done;
  }
  await sleep(800);
}

async function post(url, { body, key, raw, type, headers = {} } = {}) {
  const r = await fetch(base + url, {
    method: 'POST',
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(type ? { 'Content-Type': type } : {}), ...headers },
    ...(raw instanceof ReadableStream ? { duplex: 'half' } : {}),
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function register(name, accept = ACCEPT) {
  const r = await post('/api/social/register', { body: { name, accept } });
  if (r.status !== 200) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function connect(u, accept) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/social?u=${u.userId}`);
  const c = { u, msgs: [], code: 0 };
  ws.onmessage = (e) => c.msgs.push(JSON.parse(String(e.data)));
  ws.onclose = (e) => (c.code = e.code || -1);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.close = () => ws.close(1000);
  c.wait = (fn, ms) => until(() => c.msgs.find(fn), ms);
  c.ask = async (m, fn) => {
    const from = c.msgs.length;
    c.send(m);
    return until(() => c.msgs.slice(from).find(fn));
  };
  c.first = await c.ask({ t: 'auth', key: u.key, ...(accept ? { accept } : {}) }, (m) => m.t === 'hello' || m.t === 'terms');
  return c;
}

async function befriend(a, b) {
  await b.ask({ t: 'ping' }, () => true);
  a.send({ t: 'add', name: b.u.name, tag: b.u.tag });
  await b.wait((m) => m.t === 'friend' && m.f.id === a.u.userId && m.f.state === 'in');
  b.send({ t: 'accept', id: a.u.userId });
  if (!(await a.wait((m) => m.t === 'friend' && m.f.id === b.u.userId && m.f.state === 'friend'))) throw new Error('φιλία');
}

const say = (from, to, text) => from.ask({ t: 'send', peer: to.u.userId, text }, (m) => m.t === 'msg' && m.m.text === text);
const tsay = (from, team, text) => from.ask({ t: 'team_send', team, text }, (m) => m.t === 'tmsg' && m.m.text === text);

async function makeTeam(owner, name) {
  const r = await owner.ask({ t: 'team_create', name }, (m) => m.t === 'team' && m.team.name === name);
  return r.team.id;
}
async function invite(owner, guest, team, join = true) {
  owner.send({ t: 'team_invite', team, peer: guest.u.userId });
  await guest.wait((m) => m.t === 'team' && m.team.id === team && m.team.state === 'invited');
  if (!join) return;
  guest.send({ t: 'team_accept', team });
  await guest.wait((m) => m.t === 'team' && m.team.id === team && m.team.state === 'member');
}

async function upload(from, dest, text) {
  const r = await post(`/api/social/file?u=${from.u.userId}&${dest}&name=${encodeURIComponent(text)}`, { key: from.u.key, type: PGN, raw: `[Event "${text}"]\n\n1. e4 *\n` });
  if (r.status !== 200) throw new Error(`upload ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.id;
}
const download = async (u, id) => {
  const r = await fetch(`${base}/api/social/file/${id}?u=${u.userId}`, { headers: { Authorization: `Bearer ${u.key}` } });
  await r.arrayBuffer();
  return r.status;
};
const admin = (action, id = '', key = ADMIN) => post('/api/admin', { key, body: { action, id } });
const hash = (key) => createHash('sha256').update(`knightbase-social:${key}`).digest('hex');

/** Όλες οι γραμμές όλων των πινάκων της αποθήκευσης, εκτός από τους εσωτερικούς του wrangler (ονόματα αντικειμένων, alarms). */
function eachTable(dir, fn, write = false) {
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    // το observability είναι τα ίχνη αιτημάτων του τοπικού wrangler· στον server είναι κλειστό (wrangler.jsonc)
    if (!String(f).endsWith('.sqlite') || String(f).includes('observability')) continue;
    const db = new DatabaseSync(path.join(dir, String(f)), { readOnly: !write });
    try {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())
        if (!/^(_cf_|__miniflare|sqlite_)/.test(name)) fn(db, name);
    } finally {
      db.close();
    }
  }
}
function leftovers(dir, needles) {
  const found = [];
  let rows = 0;
  eachTable(dir, (db, t) => {
    for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
      rows++;
      const text = JSON.stringify(row);
      for (const n of needles) if (text.includes(n)) found.push(`${t}: ${n}`);
    }
  });
  return { found: [...new Set(found)], rows };
}

/** Οι εγγραφές του KV στον δίσκο του τοπικού wrangler. */
function kvRows(dir, change) {
  const rows = [];
  eachTable(
    dir,
    (db, t) => {
      if (t !== '_mf_entries' || !db.prepare('PRAGMA table_info(_mf_entries)').all().some((c) => c.name === 'expiration')) return;
      for (const r of db.prepare('SELECT key, expiration, metadata FROM _mf_entries').all()) {
        if (!/^[a-z2-9]{20}$/.test(r.key)) continue;
        rows.push(r);
        const next = change?.(r);
        if (next) db.prepare('UPDATE _mf_entries SET expiration = ?, metadata = ? WHERE key = ?').run(next.expiration, next.metadata, r.key);
      }
    },
    Boolean(change),
  );
  return rows;
}

async function fileRules(dir) {
  await start(CONFIG, dir);
  const to = await connect(await register('Receiver'));
  const from = [];
  // έως 10 αποστολές τη μέρα ανά λογαριασμό, και οι απορρίψεις μετρούν: περισσότεροι αποστολείς
  for (const n of ['One', 'Two', 'Three', 'Four']) {
    const x = await connect(await register(`Sender ${n}`));
    await befriend(x, to);
    from.push(x);
  }
  let sent = 0;
  const send = (raw, { type = PGN, name = 'games', headers, who = from[Math.floor(sent++ / 9)] } = {}) =>
    post(`/api/social/file?u=${who.u.userId}&to=${to.u.userId}&name=${encodeURIComponent(name)}&games=999999`, { key: who.u.key, type, raw, headers });

  const game = '[Event "files"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n';
  const zipped = deflateRawSync(game);
  const zip = Buffer.alloc(30);
  zip.writeUInt32LE(0x04034b50, 0);
  zip.writeUInt16LE(8, 8);
  zip.writeUInt32LE(zipped.length, 18);
  const cbh = Buffer.alloc(92);
  cbh.set([0, 0, 0x2c, 0, 0x2e, 1]);
  const reject = [
    ['PNG', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')],
    ['JPEG', Buffer.from('ffd8ffe000104a46494600010100', 'hex')],
    ['GIF', Buffer.from('47494638396101000100800000', 'hex')],
    ['WebP', Buffer.from('524946462400000057454250565038200000', 'hex')],
    ['ZIP', Buffer.concat([zip, zipped])],
    ['7z', Buffer.from('377abcaf271c00040000', 'hex')],
    ['gzip με PGN μέσα', gzipSync(game)],
    ['.cbh', cbh],
    ['EXE', Buffer.from('4d5a90000300000004000000ffff', 'hex')],
    ['PGN και μετά ZIP', Buffer.concat([Buffer.from(game), zip, zipped])],
    ['UTF-16', Buffer.from(`\ufeff${game}`, 'utf16le')],
    ['HTML', '<!doctype html><script>alert(1)</script>'],
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['σκέτο κείμενο', 'γεια'],
    ['εικόνα μέσα σε σχόλιο', '[Event "x"]\n\n1. e4 {data:image/png;base64,iVBORw0KGgo=} *'],
    ['άδειο', ''],
  ];
  // δηλώνουν όλα PGN και όνομα .pgn: τα πιάνει μόνο ο έλεγχος περιεχομένου
  for (const [what, raw] of reject) {
    const r = await send(raw, { name: 'games.pgn' });
    ok(r.status === 400 && r.data.error === 'notpgn', `κόβεται: ${what}`, r);
  }
  for (const type of ['application/gzip', 'image/png', 'application/zip', 'text/html', undefined]) {
    const r = await send(Buffer.from(game), { type: type ?? '' });
    ok(r.status === 415, `κόβεται ο τύπος ${type}`, r);
  }
  ok((await send(game, { headers: { 'Content-Encoding': 'gzip' } })).status >= 400, 'κόβεται Content-Encoding');

  const head = '[Event "max"]\n\n1. e4 {';
  const max = head + 'word '.repeat(MB / 5).slice(0, MB - head.length - 3) + '} *';
  ok(Buffer.byteLength(max) === MB, 'το δείγμα είναι ακριβώς 1 MB', Buffer.byteLength(max));
  const over = await send(`${max}\n`);
  ok(over.status === 413 && over.data.error === 'large', '1 MB και 1 byte κόβεται', over);
  // χωρίς Content-Length: μετρά τα bytes που φτάνουν
  const stream = await send(new Blob([max, ' '.repeat(200_000)]).stream());
  ok(stream.status === 413, 'μεγάλο χωρίς Content-Length κόβεται', stream);
  ok(kvRows(dir).length === 0, 'τίποτα από όσα κόπηκαν δεν αποθηκεύτηκε');

  const full = await send(max);
  ok(full.status === 200, '1 MB ακριβώς περνά', full);
  const fine = await send(`\ufeff${game}\n${game}`, { name: 'setup.exe' });
  ok(fine.status === 200, 'κανονικό PGN περνά', fine);
  const note = await to.wait((m) => m.t === 'msg' && m.m.kind === 'file' && m.m.text.includes(fine.data.id));
  const info = note ? JSON.parse(note.m.text) : {};
  ok(info.name === 'setup.exe.pgn' && info.games === 2, 'όνομα .pgn και πλήθος από τον server, όχι από τον αποστολέα', info);
  const got = await fetch(`${base}/api/social/file/${fine.data.id}?u=${to.u.userId}`, { headers: { Authorization: `Bearer ${to.u.key}` } });
  ok(got.headers.get('content-type')?.startsWith(PGN) && got.headers.get('x-content-type-options') === 'nosniff', 'δίνεται ως PGN', got.headers.get('content-type'));
  ok(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(`\ufeff${game}\n${game}`)), 'φτάνει ίδιο');
  const old = await send(game);
  ok(old.status === 200, 'τρίτο αρχείο', old);
  for (const x of [...from, to]) x.close();
  await sleep(500);
  await stop();

  // λήξη: ο χώρος αποθήκευσης το σβήνει μόνος του σε 7 μέρες
  const rows = kvRows(dir, (r) => {
    const in7 = (Number(r.expiration) > 1e12 ? Number(r.expiration) : Number(r.expiration) * 1000) - Date.now();
    ok(Math.abs(in7 - 7 * DAY_MS) < 180_000, 'λήξη αποθήκευσης σε 7 μέρες', in7 / DAY_MS);
    const meta = JSON.parse(r.metadata);
    ok(meta.pgn === true && Math.abs(meta.exp - Date.now() - 7 * DAY_MS) < 180_000, 'λήξη και στα στοιχεία του', meta);
    if (r.key === full.data.id) return { expiration: Number(r.expiration) - 8 * DAY_MS / (Number(r.expiration) > 1e12 ? 1 : 1000), metadata: r.metadata };
    if (r.key === fine.data.id) return { expiration: r.expiration, metadata: JSON.stringify({ ...meta, exp: Date.now() - 1000 }) };
    return { expiration: r.expiration, metadata: JSON.stringify({ conv: meta.conv, from: meta.from }) };
  });
  ok(rows.length === 3, 'αποθηκεύτηκαν μόνο τα τρία σωστά', rows.length);

  await start(CONFIG, dir);
  ok((await download(to.u, full.data.id)) === 404, 'μετά τις 7 μέρες δεν υπάρχει');
  ok((await download(to.u, fine.data.id)) === 404, 'ληγμένο δεν δίνεται');
  ok((await download(to.u, old.data.id)) === 404, 'αρχείο παλιάς έκδοσης (χωρίς έλεγχο) δεν δίνεται');
  await stop();
  const left = kvRows(dir).map((r) => r.key);
  ok(!left.includes(fine.data.id) && !left.includes(old.data.id), 'και σβήνονται από τον χώρο', left);
}

async function main(dir) {
  await start(CONFIG, dir);

  // όροι και ηλικία
  for (const accept of [undefined, {}, { ...ACCEPT, age16: false }, { ...ACCEPT, age16: 'true' }, { ...ACCEPT, terms: '2000-01-01' }]) {
    const r = await post('/api/social/register', { body: { name: 'Nobody', ...(accept ? { accept } : {}) } });
    ok(r.status === 400 && r.data.error === 'consent', 'εγγραφή χωρίς αποδοχή κόβεται', accept);
  }

  const names = { a: 'Zeldaquux', b: 'Bob', c: 'Carol', d: 'Dave', e: 'Erin', f: 'Frank', g: 'Grace', h: 'Heidi', i: 'Ivan', o: 'Outsider' };
  const u = {};
  const c = {};
  for (const [k, n] of Object.entries(names)) {
    u[k] = await register(n);
    c[k] = await connect(u[k]);
    ok(c[k].first?.t === 'hello', `σύνδεση ${n}`);
  }
  const { a, b, o } = c;

  for (const k of ['b', 'c', 'e', 'f', 'g', 'i']) await befriend(a, c[k]);
  await befriend(b, c.c);
  await a.ask({ t: 'accounts', acc: { lichess: 'zeldaquux_li' } }, (m) => m.t === 'accounts');

  // αιτήματα προς τα δύο μέρη, μπλοκ προς τα δύο μέρη, παλιός φίλος
  await a.ask({ t: 'add', name: u.d.name, tag: u.d.tag }, (m) => m.t === 'added');
  await c.h.ask({ t: 'add', name: u.a.name, tag: u.a.tag }, (m) => m.t === 'added');
  for (let n = 0; n < 11; n++) {
    const x = await register(`Extra ${n}`);
    await a.ask({ t: 'add', name: x.name, tag: x.tag }, (m) => m.t === 'added' && m.name === x.name);
  }
  await say(a, c.e, 'MARK-A-blocked');
  await say(a, c.f, 'MARK-A-exfriend');
  await say(c.g, a, 'MARK-G-to-A');
  await c.e.ask({ t: 'block', id: u.a.userId }, (m) => m.t === 'blocked');
  await a.ask({ t: 'block', id: u.g.userId }, (m) => m.t === 'blocked');
  await c.f.ask({ t: 'remove', id: u.a.userId }, (m) => m.t === 'unfriend');

  const am = await say(a, b, 'MARK-A-dm');
  const bm = await say(b, a, 'MARK-B-to-A');
  await say(b, c.c, 'KEEP-B-to-C');
  const cm = await say(c.c, b, 'KEEP-C-bad');

  // ομάδες: ιδιοκτήτης, πρώην μέλος, προσκεκλημένος, τελευταίο μέλος
  const t1 = await makeTeam(a, 'Alpha team');
  await invite(a, b, t1);
  await invite(a, c.c, t1);
  await invite(a, c.i, t1, false);
  const t2 = await makeTeam(b, 'Beta team');
  await invite(b, a, t2);
  const t3 = await makeTeam(b, 'Gamma team');
  await invite(b, a, t3, false);
  const t4 = await makeTeam(a, 'Solo team');
  await tsay(a, t4, 'MARK-A-solo');
  const tam = await tsay(a, t1, 'MARK-A-team');
  await tsay(b, t1, 'KEEP-B-team');
  await tsay(a, t2, 'MARK-A-kicked');
  await b.ask({ t: 'team_kick', team: t2, id: u.a.userId }, (m) => m.t === 'teaminfo' && m.info.id === t2 && !m.info.members.some((x) => x.id === u.a.userId));

  const files = [await upload(a, `to=${u.b.userId}`, 'MARK-A-file'), await upload(a, `team=${t1}`, 'MARK-A-teamfile')];
  const fromB = await upload(b, `to=${u.a.userId}`, 'MARK-B-file');
  const keep = await upload(b, `team=${t1}`, 'KEEP-B-teamfile');
  ok((await download(u.b, files[0])) === 200, 'ο φίλος κατεβάζει');
  ok((await download(u.o, files[0])) === 403, 'ο ξένος δεν κατεβάζει');

  // αναφορές
  const rep = async (who, m) => who.ask({ t: 'report', reason: 'abuse', text: '', ...m }, (x) => x.t === 'reported' || x.t === 'error');
  const r1 = await rep(b, { id: u.a.userId, mid: am.m.id, text: 'REP-by-B' });
  const r2 = await rep(c.c, { team: t1, mid: tam.m.id });
  const r3 = await rep(a, { id: u.b.userId, text: 'MARK-A-report' });
  const r4 = await rep(b, { id: u.c.userId, mid: cm.m.id });
  const r5 = await rep(c.c, { team: t1 });
  ok([r1, r2, r3, r4, r5].every((r) => r?.t === 'reported'), 'αναφορές μηνύματος, χρήστη, ομάδας', [r1, r2, r3, r4, r5]);
  ok((await rep(o, { id: u.a.userId }))?.code === 'bad', 'ξένος δεν αναφέρει με σκέτο id');
  ok((await rep(o, { id: u.a.userId, mid: am.m.id }))?.code === 'bad', 'ξένος δεν διαβάζει μήνυμα μέσω αναφοράς');
  ok((await rep(o, { team: t1, mid: tam.m.id }))?.code === 'notmember', 'ξένος δεν αναφέρει μήνυμα ομάδας');
  ok((await rep(a, { id: u.b.userId, mid: am.m.id }))?.code === 'bad', 'κανείς δεν αναφέρει δικό του μήνυμα');
  ok((await rep(b, { id: u.a.userId, reason: 'xx' }))?.code === 'bad', 'άγνωστος λόγος κόβεται');

  ok((await admin('reports', '', '')).status === 401, 'admin χωρίς κλειδί');
  ok((await admin('reports', '', 'x'.repeat(48))).status === 401, 'admin με λάθος κλειδί');
  ok((await admin('reports', '', u.a.key)).status === 401, 'admin με κλειδί χρήστη');
  const list = (await admin('reports')).data.reports;
  ok(list.length === 5, 'λίστα αναφορών', list.length);
  const got = list.find((r) => r.id === r1.id);
  ok(got?.evidence === 'MARK-A-dm' && got.target === u.a.userId && got.target_name === `${u.a.name}#${u.a.tag}`, 'το αντίγραφο και ο αποστολέας από τον server', got);
  ok((await admin('remove-message', r4.id)).data.ok === true, 'αφαίρεση μηνύματος');
  ok(await c.c.wait((m) => m.t === 'msgdel' && m.mid === cm.m.id), 'το μήνυμα φεύγει και στην οθόνη');
  ok((await admin('close', r4.id)).data.ok === true, 'κλείσιμο αναφοράς');

  // εξαγωγή
  ok((await post(`/api/social/export?u=${u.a.userId}`, { key: u.b.key })).status === 401, 'εξαγωγή με ξένο κλειδί');
  const ex = await post(`/api/social/export?u=${u.a.userId}`, { key: u.a.key });
  const exText = JSON.stringify(ex.data);
  ok(ex.status === 200 && ['MARK-A-dm', 'MARK-A-team', 'MARK-A-exfriend', 'MARK-A-kicked', 'MARK-A-report', 'zeldaquux_li'].every((x) => exText.includes(x)), 'εξαγωγή: όλα τα δικά του');
  ok(!['MARK-B-to-A', 'KEEP-B-team', 'MARK-G-to-A', u.a.key, hash(u.a.key)].some((x) => exText.includes(x)), 'εξαγωγή: ούτε μηνύματα άλλων ούτε κλειδί');

  // διαγραφή
  ok((await post(`/api/social/delete?u=${u.a.userId}`, { key: u.b.key })).status === 401, 'διαγραφή με ξένο κλειδί');
  ok((await post(`/api/social/delete?u=${u.a.userId}`)).status === 401, 'διαγραφή χωρίς κλειδί');
  ok((await fetch(`${base}/api/social/delete?u=${u.a.userId}`)).status === 405, 'διαγραφή με GET');
  ok((await post(`/api/social/delete?u=${u.a.userId}`, { key: u.a.key })).status === 200, 'διαγραφή');
  ok(await until(() => a.code === 4404), 'η σύνδεσή του κλείνει αμέσως', a.code);
  ok((await post(`/api/social/file?u=${u.a.userId}&to=${u.b.userId}&name=x`, { key: u.a.key, type: PGN, raw: 'x' })).status === 401, 'δεν ανεβάζει πια');
  ok(await b.wait((m) => m.t === 'unfriend' && m.id === u.a.userId, 30_000), 'φεύγει από τους φίλους των άλλων');
  ok(await b.wait((m) => m.t === 'tforget' && m.team === t1 && m.id === u.a.userId, 30_000), 'φεύγει από το chat της ομάδας');
  await sleep(6000);

  ok((await post('/api/social/recover', { body: { key: u.a.key } })).status === 404, 'ο κωδικός ανάκτησης δεν ισχύει');
  ok((await o.ask({ t: 'add', name: u.a.name, tag: u.a.tag }, (m) => m.t === 'error'))?.code === 'notfound', 'το όνομα δεν βρίσκεται');
  for (const id of [...files, fromB]) ok((await download(u.b, id)) === 404, 'τα αρχεία σβήστηκαν', id);
  ok((await download(u.c, keep)) === 200, 'αρχείο άλλου στην ομάδα μένει');
  const info = await b.ask({ t: 'team_get', team: t1 }, (m) => m.t === 'teaminfo' && m.info.id === t1);
  ok(info?.info.members.filter((m) => m.role === 'owner').length === 1 && info.info.members.length === 2, 'μεταβίβαση ιδιοκτήτη', info?.info.members);
  const hist = await b.ask({ t: 'team_history', team: t1 }, (m) => m.t === 'thistory');
  ok(hist?.msgs.some((m) => m.text === 'KEEP-B-team') && !JSON.stringify(hist.msgs).includes('MARK-A'), 'τα μηνύματα των άλλων μένουν');

  const b2 = await connect(u.b);
  ok(b2.first?.t === 'hello' && !JSON.stringify(b2.first).includes(u.a.userId) && b2.first.friends.some((f) => f.id === u.c.userId), 'οι άλλες φιλίες μένουν');
  b2.close();

  // εργαλείο υπευθύνου: διαγραφή ομάδας και λογαριασμού με Όνομα#TAG
  ok((await admin('delete-team', t2)).data.ok === true, 'διαγραφή ομάδας');
  ok(await b.wait((m) => m.t === 'unteam' && m.id === t2), 'η ομάδα φεύγει από τα μέλη');
  ok((await admin('delete-user', `${u.o.name}#${u.o.tag}`)).data.ok === true, 'διαγραφή με αίτημα');
  ok(await until(() => o.code === 4404), 'ο διαγραμμένος αποσυνδέεται');
  await sleep(4500);
  ok((await post('/api/social/recover', { body: { key: u.o.key } })).status === 404, 'διαγραμμένος από υπεύθυνο');

  // μπλοκ σε μέλος ομάδας που δεν είναι φίλος
  const bl = {};
  for (const [k, n] of [['p', 'Pavlos'], ['q', 'Quentin'], ['r', 'Rolandoblocked']]) {
    u[k] = await register(n);
    bl[k] = c[k] = await connect(u[k]);
  }
  await befriend(bl.p, bl.q);
  await befriend(bl.p, bl.r);
  const t5 = await makeTeam(bl.p, 'Block team');
  await invite(bl.p, bl.q, t5);
  await invite(bl.p, bl.r, t5);
  await tsay(bl.r, t5, 'MARK-R-before');
  ok((await bl.q.ask({ t: 'block', id: u.b.userId }, (m) => m.t === 'error'))?.code === 'bad', 'δεν μπλοκάρει άγνωστο id');
  ok(await bl.q.ask({ t: 'block', id: u.r.userId, team: t5 }, (m) => m.t === 'blocked' && m.list.some((x) => x.id === u.r.userId)), 'μπλοκ μέλους ομάδας');
  await tsay(bl.r, t5, 'MARK-R-after');
  await sleep(500);
  ok(!bl.q.msgs.some((m) => m.t === 'tmsg' && m.m.text === 'MARK-R-after'), 'δεν του φτάνουν τα μηνύματά του');
  const qh = await bl.q.ask({ t: 'team_history', team: t5 }, (m) => m.t === 'thistory');
  ok(qh && !JSON.stringify(qh.msgs).includes('MARK-R'), 'ούτε στο ιστορικό');
  const ri = await bl.r.ask({ t: 'team_get', team: t5 }, (m) => m.t === 'teaminfo');
  ok(ri?.info.members.find((x) => x.id === u.q.userId)?.p.s === 'offline', 'ο μπλοκαρισμένος τον βλέπει εκτός σύνδεσης');
  ok(ri?.info.members.find((x) => x.id === u.p.userId)?.p.s === 'online', 'τους άλλους τους βλέπει κανονικά');
  await bl.q.ask({ t: 'unblock', id: u.r.userId }, (m) => m.t === 'blocked');
  const qh2 = await bl.q.ask({ t: 'team_history', team: t5 }, (m) => m.t === 'thistory');
  ok(JSON.stringify(qh2?.msgs).includes('MARK-R-after'), 'ξεμπλοκάρισμα: φαίνονται ξανά');
  await bl.q.ask({ t: 'block', id: u.r.userId, team: t5 }, (m) => m.t === 'blocked');
  await bl.r.ask({ t: 'team_leave', team: t5 }, (m) => m.t === 'unteam');
  await post(`/api/social/delete?u=${u.r.userId}`, { key: u.r.key });
  ok(await bl.q.wait((m) => m.t === 'blocked' && !m.list.length && bl.q.msgs.indexOf(m) === bl.q.msgs.findLastIndex((x) => x.t === 'blocked'), 20_000), 'η διαγραφή τον βγάζει και από τα μπλοκ');
  await sleep(3000);

  // όριο ρυθμού: 45 δωμάτια, άρα πάνω από 20 σε κάποιο από τα δύο λεπτά που μπορεί να πιάσουν
  const made = [];
  for (let n = 0; n < 45; n++) made.push((await post('/api/analysis/new', { body: { name: 'Limit', pgn: '*' } })).status);
  ok(made[0] === 200 && made.includes(429), 'όριο στη δημιουργία δωματίων', made.join());

  for (const x of Object.values(c)) x.close();
  await sleep(1000);
  await stop();

  const needles = [u.a.userId, u.a.name, hash(u.a.key), u.a.key, 'zeldaquux_li', 'MARK-A', 'MARK-B-to-A', 'MARK-B-file', 'MARK-G-to-A', 'REP-by-B', ...files, u.o.userId, bm.m.text, u.r.userId, u.r.name, 'MARK-R'];
  const left = leftovers(dir, needles);
  ok(left.rows > 20 && !left.found.length, 'δεν μένει τίποτα του διαγραμμένου', left);
  ok(leftovers(dir, ['KEEP-B-team']).found.length > 0, 'ο έλεγχος διαβάζει όντως τους πίνακες');
  ok(leftovers(dir, ['KEEP-C-bad']).found.length === 0, 'το αφαιρεμένο μήνυμα και το αντίγραφό του σβήστηκαν');

  // λήξεις: IP εγγραφής (1 ώρα) και αναφορές (180 μέρες), χωρίς να ξαναγίνει εγγραφή ή αναφορά
  const count = (t) => {
    let n = 0;
    eachTable(dir, (db, name) => name === t && (n += db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n));
    return n;
  };
  ok(count('regs') > 0 && count('reports') > 0, 'υπάρχουν εγγραφές προς λήξη');
  eachTable(dir, (db, t) => (t === 'regs' || t === 'reports') && db.exec(`UPDATE ${t} SET at = 0`), true);
  await start(CONFIG, dir);
  await post('/api/social/recover', { body: { key: u.b.key } });
  await sleep(4000);
  await stop();
  ok(count('regs') === 0, 'οι IP λήγουν');
  ok(count('reports') === 0, 'οι αναφορές λήγουν');
}

async function upgrade(dir) {
  await start(OLD, dir);
  const u = {};
  const c = {};
  for (const [k, n] of [['x', 'Oldxylophone'], ['y', 'Oldyara'], ['z', 'Oldzeno']]) {
    u[k] = await register(n);
    c[k] = await connect(u[k]);
  }
  await befriend(c.x, c.y);
  await befriend(c.x, c.z);
  await say(c.x, c.y, 'MARK-X-exfriend');
  await say(c.x, c.z, 'MARK-X-dm');
  const team = await makeTeam(c.y, 'Old team');
  await invite(c.y, c.x, team);
  await tsay(c.x, team, 'MARK-X-team');
  // σχέσεις που δεν φαίνονται πια πουθενά στον λογαριασμό του: παλιός φίλος και παλιά ομάδα
  await c.x.ask({ t: 'team_leave', team }, (m) => m.t === 'unteam');
  await c.x.ask({ t: 'remove', id: u.y.userId }, (m) => m.t === 'unfriend');
  for (const x of Object.values(c)) x.close();
  await sleep(1000);
  await stop();

  await start(CONFIG, dir);
  const olds = (await admin('test-accounts')).data.accounts;
  ok(olds?.length === 3 && olds.some((x) => x.id === u.x.userId), 'λίστα λογαριασμών δοκιμής', olds);
  await register('Newperson');
  ok((await admin('test-accounts')).data.accounts.length === 3, 'η λίστα δεν έχει νέους λογαριασμούς');
  const z = await connect(u.z);
  ok(z.first?.t === 'terms', 'παλιός λογαριασμός: ζητά όρους', z.first);
  ok(!(await Promise.race([z.ask({ t: 'ping' }, (m) => m.t === 'hello'), sleep(700)])), 'χωρίς αποδοχή δεν παίρνει τίποτα');
  ok((await post(`/api/social/file?u=${u.z.userId}&to=${u.x.userId}&name=x`, { key: u.z.key, type: PGN, raw: 'x' })).status === 401, 'χωρίς αποδοχή δεν στέλνει αρχείο');
  ok((await post(`/api/social/export?u=${u.x.userId}`, { key: u.x.key })).status === 200, 'εξαγωγή χωρίς αποδοχή');
  ok((await z.ask({ t: 'auth', key: u.z.key, accept: ACCEPT }, (m) => m.t === 'hello')) !== null, 'αποδοχή και σύνδεση');
  const z2 = await connect(u.z);
  ok(z2.first?.t === 'hello', 'η αποδοχή θυμάται');
  ok((await post(`/api/social/delete?u=${u.x.userId}`, { key: u.x.key })).status === 200, 'διαγραφή παλιού χωρίς αποδοχή');
  ok(await z.wait((m) => m.t === 'unfriend' && m.id === u.x.userId, 20_000), 'φεύγει από τον φίλο');
  await sleep(5000);
  z.close();
  z2.close();
  await sleep(500);
  await stop();
  const left = leftovers(dir, [u.x.userId, u.x.name, hash(u.x.key), 'MARK-X']);
  ok(!left.found.length, 'παλιός λογαριασμός: δεν μένει τίποτα, ούτε σε παλιό φίλο ή ομάδα', left);
}

const run = async (name, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruru-social-test-'));
  try {
    await fn(dir);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}:`, e, '\n', log.slice(-3000));
  } finally {
    await stop();
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
};
await run('διαγραφή', main);
await run('αρχεία', fileRules);
if (OLD) await run('αναβάθμιση', upgrade);
console.log(`${passed} έλεγχοι εντάξει, ${failed} απέτυχαν`);
process.exitCode = failed ? 1 : 0;
