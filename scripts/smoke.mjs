// Smoke test πριν από κάθε έκδοση: `npm run smoke`.
// Ξεκινά δικό του server σε ελεύθερη θύρα με προσωρινό «σπίτι» (USERPROFILE / APPDATA / LOCALAPPDATA),
// άρα δεν αγγίζει τον server του χρήστη (4747), τις βάσεις του ή τις ρυθμίσεις του, και ελέγχει
// μέσω του API τις βασικές λειτουργίες: εισαγωγή PGN, λίστα, παρτίδα, αποθήκευση, αναζήτηση παίκτη
// και θέσης, δέντρο, διπλές, αντιγραφή, εξαγωγή, βάση νεότερης μορφής, ανάγνωση βάσης κατά την
// εισαγωγή της και (αν υπάρχει) μηχανή.
// Στο τέλος σταματά τον server και σβήνει τον προσωρινό φάκελο.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-smoke-'));
const docs = path.join(home, 'Documents');
fs.mkdirSync(docs, { recursive: true });

const PGN = `[Event "Smoke"]
[Site "Moscow"]
[Date "1985.10.15"]
[Round "1"]
[White "Kasparov, Garry"]
[Black "Karpov, Anatoly"]
[Result "1-0"]

1. e4 e5 2. Nf3 (2. f4 exf4) 2... Nc6 {σχόλιο} 3. Bb5 a6! 1-0

[Event "Smoke"]
[Site "Moscow"]
[Date "1985.10.16"]
[Round "2"]
[White "Karpov, Anatoly"]
[Black "Kasparov, Garry"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 1/2-1/2

[Event "Πρωτάθλημα"]
[Site "Αθήνα"]
[Date "2020.01.01"]
[Round "1"]
[White "Μπανίκας, Χρήστος"]
[Black "Kasparov, Garry"]
[Result "*"]
[SetUp "1"]
[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]

1. O-O Kd7 *

[Event "Smoke"]
[Site "Moscow"]
[Date "1985.10.15"]
[Round "1"]
[White "Kasparov, Garry"]
[Black "Karpov, Anatoly"]
[Result "1-0"]

1. e4 e5 2. Nf3 (2. f4 exf4) 2... Nc6 {σχόλιο} 3. Bb5 a6! 1-0
`;

const results = [];
let base = '';
let server = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // όχι JSON (π.χ. εξαγωγή PGN)
  }
  return { status: res.status, json, text };
}

async function ok(method, url, body) {
  const r = await api(method, url, body);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${r.json?.error ?? r.text.slice(0, 200)}`);
  return r.json ?? r.text;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function check(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

/** Περιμένει να τελειώσουν όλες οι εργασίες (εισαγωγή, ευρετήριο) της βάσης. */
async function waitJobs(dbId, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const jobs = await ok('GET', '/api/jobs');
    const mine = jobs.filter((j) => j.dbId === dbId);
    const failed = mine.find((j) => j.status === 'error');
    if (failed) throw new Error(`η εργασία «${failed.title}» απέτυχε: ${failed.error ?? failed.message ?? ''}`);
    if (!mine.some((j) => j.status === 'running')) return;
    if (Date.now() > until) throw new Error('οι εργασίες δεν τελείωσαν εγκαίρως');
    await sleep(200);
  }
}

async function startServer() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    KNIGHTBASE_PORT: String(port),
    USERPROFILE: home,
    HOME: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  };
  server = spawn(process.execPath, [path.join(root, 'src', 'server', 'main.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const until = Date.now() + 30_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`ο server σταμάτησε (κωδικός ${server.exitCode}):\n${log}`);
    try {
      const v = await (await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(1000) })).json();
      return v;
    } catch {
      if (Date.now() > until) throw new Error(`ο server δεν απάντησε σε 30″:\n${log}`);
      await sleep(250);
    }
  }
}

async function main() {
  console.log(`KnightBase smoke test (προσωρινός φάκελος ${home})`);
  const version = await startServer();
  console.log(`  server ${version.version} στη ${base}`);

  const pgnFile = path.join(docs, 'smoke.pgn');
  fs.writeFileSync(pgnFile, PGN, 'utf8');
  let dbId = '';
  let viewKey = '';
  let gid = 0;

  await check('Εισαγωγή PGN', async () => {
    const r = await ok('POST', '/api/library/open', { path: pgnFile });
    dbId = r.opened[0].entry.id;
    await waitJobs(dbId);
    const lib = await ok('GET', '/api/library');
    const e = lib.databases.find((d) => d.id === dbId);
    assert(e && e.games === 4, `περίμενα 4 παρτίδες, βρέθηκαν ${e?.games}`);
    assert(e.format === 2, `νέα βάση σε μορφή ${e.format}, όχι 2 (λεξικό ετικετών)`);
    return '4 παρτίδες';
  });

  await check('Λίστα παρτίδων (και ελληνικά ονόματα)', async () => {
    const v = await ok('POST', `/api/db/${dbId}/view`, {});
    viewKey = v.key;
    assert(v.count === 4, `count ${v.count}`);
    const r = await ok('GET', `/api/db/${dbId}/rows?key=${encodeURIComponent(v.key)}&offset=0&limit=10`);
    assert(r.rows.length === 4, `rows ${r.rows.length}`);
    assert(r.rows.some((x) => x.white === 'Μπανίκας, Χρήστος'), 'λείπει το ελληνικό όνομα');
    gid = r.rows.find((x) => x.white === 'Kasparov, Garry' && x.result === 1)?.id ?? r.rows.find((x) => x.white === 'Kasparov, Garry').id;
  });

  await check('Άνοιγμα παρτίδας (βαριάντα, σχόλιο, σύμβολο)', async () => {
    const g = await ok('GET', `/api/db/${dbId}/game/${gid}`);
    // το «!» γράφεται ως NAG $1 (κανονική μορφή PGN)
    for (const part of ['(2. f4 exf4)', '{σχόλιο}', 'a6 $1', 'Kasparov, Garry']) assert(g.pgn.includes(part), `λείπει «${part}» από το PGN`);
  });

  await check('Αποθήκευση αλλαγής σε παρτίδα', async () => {
    const g = await ok('GET', `/api/db/${dbId}/game/${gid}`);
    await ok('PUT', `/api/db/${dbId}/game/${gid}`, { pgn: g.pgn.replace('{σχόλιο}', '{σχόλιο smoke-edit}') });
    const g2 = await ok('GET', `/api/db/${dbId}/game/${gid}`);
    assert(g2.pgn.includes('smoke-edit'), 'η αλλαγή δεν αποθηκεύτηκε');
  });

  await check('Αναζήτηση παίκτη', async () => {
    const v = await ok('POST', `/api/db/${dbId}/view`, { filter: { player: 'Karpov' } });
    assert(v.count === 3, `περίμενα 3, βρέθηκαν ${v.count}`);
  });

  await check('Αναζήτηση θέσης (1.e4 e5)', async () => {
    const v = await ok('POST', `/api/db/${dbId}/view`, { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2' });
    assert(v.count === 2, `περίμενα 2, βρέθηκαν ${v.count}`);
  });

  await check('Δομή πιονιών', async () => {
    const v = await ok('POST', `/api/db/${dbId}/view`, { filter: { pawns: '4k3/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/4K3' } });
    assert(v.count === 2, `περίμενα 2, βρέθηκαν ${v.count}`);
    const w = await ok('POST', `/api/db/${dbId}/view`, { filter: { pawns: '4k3/8/8/8/2PP4/8/PP2PPPP/4K3', pawnsMode: 'white' } });
    assert(w.count === 1, `μόνο λευκά: περίμενα 1, βρέθηκαν ${w.count}`);
  });

  await check('Δέντρο ανοιγμάτων', async () => {
    const t = await ok('POST', `/api/db/${dbId}/tree`, {});
    assert(t.indexed, 'χωρίς ευρετήριο θέσεων');
    const e4 = t.moves.find((m) => m.uci === 'e2e4');
    const d4 = t.moves.find((m) => m.uci === 'd2d4');
    assert(e4 && d4, `κινήσεις: ${t.moves.map((m) => m.uci).join(' ')}`);
  });

  await check('Διπλές παρτίδες (χωρίς σήμανση)', async () => {
    const r = await ok('POST', `/api/db/${dbId}/doubles`, { mark: false });
    assert(r.doubles === 1, `περίμενα 1, βρέθηκαν ${r.doubles}`);
  });

  await check('Αντιγραφή σε άλλη βάση', async () => {
    const n = await ok('POST', '/api/library/new', { name: 'smoke-copy' });
    const target = n.entry.id;
    await ok('POST', `/api/db/${dbId}/copy`, { ids: [gid], target });
    const v = await ok('POST', `/api/db/${target}/view`, {});
    assert(v.count === 1, `count ${v.count}`);
    const r = await ok('GET', `/api/db/${target}/rows?key=${encodeURIComponent(v.key)}&offset=0&limit=1`);
    const g = await ok('GET', `/api/db/${target}/game/${r.rows[0].id}`);
    assert(g.pgn.includes('smoke-edit') && g.pgn.includes('(2. f4 exf4)'), 'η αντιγραφή έχασε σχόλιο ή βαριάντα');
  });

  await check('Εξαγωγή PGN', async () => {
    // η αποθήκευση πιο πάνω ακυρώνει τις λίστες της βάσης: νέα λίστα πριν από την εξαγωγή
    viewKey = (await ok('POST', `/api/db/${dbId}/view`, {})).key;
    const text = await ok('GET', `/api/db/${dbId}/export.pgn?key=${encodeURIComponent(viewKey)}`);
    const n = (text.match(/\[Event /g) ?? []).length;
    assert(n === 4, `περίμενα 4 παρτίδες, βγήκαν ${n}`);
    assert(text.includes('Μπανίκας, Χρήστος') && text.includes('[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]'), 'λείπει ελληνικό όνομα ή FEN');
  });

  await check('Βάση νεότερης μορφής: καθαρό μήνυμα, το αρχείο μένει ανέγγιχτο', async () => {
    const file = path.join(docs, 'future.kbdb');
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('format', '99');");
    db.close();
    const before = fs.readFileSync(file);
    const r = await api('POST', '/api/library/open', { path: file });
    assert(r.status === 409, `κωδικός ${r.status}`);
    assert(/νεότερη έκδοση/.test(r.json?.error ?? ''), `μήνυμα: ${r.json?.error}`);
    assert(fs.readFileSync(file).equals(before), 'το αρχείο άλλαξε');
  });

  await check('Μετατροπή παλιάς βάσης (μορφή 1 → 2) με αντίγραφο ασφαλείας', async () => {
    const { GameDatabase } = await import('../src/server/db/store.ts');
    const { parseGame } = await import('../src/core/pgn.ts');
    const { encodeGame } = await import('../src/core/codec.ts');
    const file = path.join(docs, 'old-format.kbdb');
    const old = new GameDatabase(file, { create: true, format: 1 });
    const { game } = parseGame(`[Event "Παλιά"]
[White "Άλφα"]
[Black "Βήτα"]
[Result "1-0"]
[WhiteFideId "4200001"]
[Source "Smoke"]

1. e4 {σχόλιο} e5 1-0`);
    const enc = encodeGame(game);
    old.insertGame({ headers: game.headers, tokens: enc.tokens, comments: enc.comments, fen: null, flags: enc.flags, plies: 2 });
    old.close();
    const id = (await ok('POST', '/api/library/open', { path: file })).opened[0].entry.id;
    const format = async () => (await ok('GET', '/api/library')).databases.find((d) => d.id === id)?.format;
    assert((await format()) === 1, `παλιά βάση σε μορφή ${await format()}`);
    const before = (await ok('GET', `/api/db/${id}/game/1`)).pgn;
    await ok('POST', `/api/library/${id}/convert`);
    await waitJobs(id);
    assert((await format()) === 2, `μετά τη μετατροπή μορφή ${await format()}`);
    const after = (await ok('GET', `/api/db/${id}/game/1`)).pgn;
    assert(after === before && after.includes('[WhiteFideId "4200001"]') && after.includes('{σχόλιο}'), 'η παρτίδα άλλαξε');
    assert(fs.existsSync(`${file}.bak`), 'λείπει το αντίγραφο ασφαλείας');
  });

  await check('Βάση που εισάγεται: λίστα και παρτίδα αμέσως, αλλαγές και θέση μετά το τέλος', async () => {
    const N = 300_000;
    const file = path.join(docs, 'big.pgn');
    const fd = fs.openSync(file, 'w');
    let chunk = '';
    for (let i = 0; i < N; i++) {
      chunk += `[Event "Big ${i % 500}"]
[White "W${i % 3000}"]
[Black "B${i % 2900}"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0

`;
      if (chunk.length > 1 << 20) {
        fs.writeSync(fd, chunk);
        chunk = '';
      }
    }
    fs.writeSync(fd, chunk);
    fs.closeSync(fd);
    const id = (await ok('POST', '/api/library/open', { path: file })).opened[0].entry.id;
    const entry = async () => (await ok('GET', '/api/library')).databases.find((d) => d.id === id);
    // οι πρώτες παρτίδες φαίνονται μετά το πρώτο COMMIT (20.000 παρτίδες), ενώ η εισαγωγή τρέχει ακόμη
    let seen = 0;
    for (const until = Date.now() + 60_000; !seen; ) {
      const e = await entry();
      if (e.busy?.kind !== 'import') throw new Error(`η εισαγωγή τελείωσε πριν φανούν παρτίδες (${e.games})`);
      seen = e.games;
      if (Date.now() > until) throw new Error('καμία παρτίδα σε 60″');
      if (!seen) await sleep(50);
    }
    const v = await ok('POST', `/api/db/${id}/view`, {});
    assert(v.count >= seen && v.count <= N, `λίστα ${v.count} (ορατές ${seen})`);
    const rows = await ok('GET', `/api/db/${id}/rows?key=${encodeURIComponent(v.key)}&offset=${v.count - 5}&limit=5`);
    assert(rows.rows.length === 5, `rows ${rows.rows.length}`);
    const g = await ok('GET', `/api/db/${id}/game/${rows.rows[4].id}`);
    assert(g.pgn.includes('4. Ba4 Nf6'), 'η παρτίδα δεν άνοιξε σωστά');
    const sorted = await ok('POST', `/api/db/${id}/view`, { sort: { col: 'white', desc: false } });
    assert(sorted.count >= v.count, `ταξινομημένη λίστα ${sorted.count}`);
    const save = await api('PUT', `/api/db/${id}/game/${rows.rows[4].id}`, { pgn: g.pgn });
    const pos = await api('POST', `/api/db/${id}/view`, { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1' });
    const tree = await api('POST', `/api/db/${id}/tree`, {});
    assert((await entry()).busy?.kind === 'import', 'η εισαγωγή τελείωσε πριν από τους ελέγχους· χρειάζεται μεγαλύτερο PGN');
    for (const [what, r] of [['αποθήκευση', save], ['αναζήτηση θέσης', pos], ['δέντρο', tree]]) {
      assert(r.status === 409 && /τελειώσει η εισαγωγή/.test(r.json?.error ?? ''), `${what}: ${r.status} ${r.json?.error}`);
    }
    await waitJobs(id);
    const e = await entry();
    assert(e.games === N, `στο τέλος ${e.games} παρτίδες, όχι ${N}`);
    const after = await ok('POST', `/api/db/${id}/view`, { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1' });
    assert(after.count === N, `θέση μετά την εισαγωγή: ${after.count}`);
    return `${seen} από ${N} παρτίδες ορατές στη διάρκεια`;
  });

  await check('Μηχανή (κίνηση σε 100 ms)', async () => {
    const e = await ok('GET', '/api/engines');
    if (!e.engines.length) return 'παραλείφθηκε: δεν υπάρχει μηχανή στον προσωρινό φάκελο';
    const m = await ok('POST', '/api/engine/move', { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', movetime: 100 });
    assert(/^[a-h][1-8][a-h][1-8]/.test(m.bestmove ?? ''), `bestmove ${m.bestmove}`);
    return m.bestmove;
  });
}

async function stop() {
  if (server && server.exitCode === null) {
    server.kill();
    for (let i = 0; i < 50 && server.exitCode === null; i++) await sleep(100);
  }
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(home, { recursive: true, force: true });
      return;
    } catch {
      await sleep(250); // τα αρχεία της βάσης κλείνουν λίγο μετά τον server
    }
  }
  console.log(`  (ο προσωρινός φάκελος δεν σβήστηκε: ${home})`);
}

try {
  await main();
} catch (e) {
  results.push({ name: 'εκκίνηση', ok: false });
  console.log(`  ✗ ${e.message}`);
} finally {
  await stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} από ${results.length} έλεγχοι απέτυχαν` : `\nΌλοι οι έλεγχοι πέρασαν (${results.length})`);
process.exit(failed ? 1 : 0);
