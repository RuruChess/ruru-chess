// Έλεγχοι των οθονών (e2e) πριν από κάθε έκδοση: `npm run e2e` (πρώτα `vite build`, μετά αυτό).
// Όπως το smoke.mjs: δικός του server σε ελεύθερη θύρα με προσωρινό «σπίτι» (USERPROFILE / APPDATA /
// LOCALAPPDATA), άρα δεν αγγίζει τον server του χρήστη (4747), τις βάσεις ή τις ρυθμίσεις του.
// Το UI (dist/web) ανοίγει στον εγκατεστημένο Microsoft Edge χωρίς παράθυρο, μέσω του playwright-core
// (καμία λήψη browser). Όλα σε καρτέλες, χωρίς οδηγό και χωρίς κίνηση κομματιών· καμία τυφλή αναμονή:
// κάθε βήμα περιμένει μια συνθήκη (στοιχείο, FEN της σκακιέρας, απάντηση του server).
// Στο τέλος σταματά τον server και σβήνει τον προσωρινό φάκελο.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-e2e-'));
const docs = path.join(home, 'Documents');
fs.mkdirSync(docs, { recursive: true });

const DB_NAME = 'Δοκιμή e2e';
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

[Event "Ανοιχτό"]
[Site "Θεσσαλονίκη"]
[Date "2021.05.05"]
[Round "3"]
[White "Anand, Viswanathan"]
[Black "Μπανίκας, Χρήστος"]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 Nf6 1/2-1/2
`;

const FEN = {
  start: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  e4e5: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  f4: 'rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq - 0 2',
  exf4: 'rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3',
  end: 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
  ba4: 'r1bqkbnr/1ppp1ppp/p1n5/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 1 4',
  nf6: 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 5',
  nc3: 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 3 5',
};

const results = [];
/** σφάλματα της σελίδας (κονσόλα, εξαιρέσεις, απαντήσεις 5xx) και του server, για τον τελευταίο έλεγχο */
const errors = [];
let base = '';
let server = null;
let serverLog = '';
let serverErr = '';
let browser = null;
let page = null;

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

async function ok(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
    console.log(`  ✗ ${name}: ${e.message.split('\n').slice(0, 4).join('\n    ')}`);
    if (page) {
      const shot = path.join(os.tmpdir(), `knightbase-e2e-fail-${results.length}.png`);
      await page.screenshot({ path: shot }).then(() => console.log(`    (εικόνα: ${shot})`)).catch(() => {});
    }
  }
}

/** Περιμένει να τελειώσουν όλες οι εργασίες (εισαγωγή, ευρετήριο) της βάσης. */
async function waitJobs(dbId, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const jobs = await ok('GET', '/api/jobs');
    const mine = jobs.filter((j) => j.dbId === dbId);
    const failed = mine.find((j) => j.status === 'error');
    if (failed) throw new Error(`η εργασία «${failed.title}» απέτυχε: ${failed.error ?? failed.message ?? ''}`);
    if (!mine.some((j) => j.status === 'running')) return;
    if (Date.now() > until) throw new Error('οι εργασίες δεν τελείωσαν εγκαίρως');
    await sleep(100);
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
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => {
    serverLog += d;
    serverErr += d;
  });
  const until = Date.now() + 30_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`ο server σταμάτησε (κωδικός ${server.exitCode}):\n${serverLog}`);
    try {
      return await (await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(1000) })).json();
    } catch {
      if (Date.now() > until) throw new Error(`ο server δεν απάντησε σε 30″:\n${serverLog}`);
      await sleep(250);
    }
  }
}

// ---------------------------------------------------------------------------
// βοηθητικά για τη σελίδα

/** το ενεργό παράθυρο (οι άλλες καρτέλες μένουν στο DOM, κρυφές) */
const win = () => page.locator('section.window.active');
const board = () => win().locator('svg.board');
const tabClose = () => page.locator('.tab.active .tab-close');

/** η σκακιέρα του ενεργού παραθύρου δείχνει αυτή τη θέση (το aria-label της έχει το FEN) */
async function waitFen(fen) {
  try {
    await win().locator(`svg.board[aria-label="Σκακιέρα: ${fen}"]`).waitFor();
  } catch {
    throw new Error(`η σκακιέρα δείχνει «${(await board().getAttribute('aria-label').catch(() => null)) ?? '—'}», όχι «${fen}»`);
  }
}

/** οι Λευκοί των γραμμών της λίστας παρτίδων στο ενεργό παράθυρο */
const listWhites = () => page.evaluate(() => [...document.querySelectorAll('section.window.active .gl-row')].map((r) => r.children[1]?.textContent ?? ''));

/** η λίστα δείχνει αυτούς τους Λευκούς (με αυτή τη σειρά ή, με `anyOrder`, σε οποιαδήποτε) */
async function waitWhites(want, anyOrder = false) {
  const norm = (a) => JSON.stringify(anyOrder ? [...a].sort() : a);
  try {
    await page.waitForFunction(
      ([w, any]) => {
        const got = [...document.querySelectorAll('section.window.active .gl-row')].map((r) => r.children[1]?.textContent ?? '');
        return JSON.stringify(any ? got.sort() : got) === w;
      },
      [norm(want), anyOrder],
    );
  } catch {
    throw new Error(`η λίστα δείχνει [${(await listWhites()).join(' | ')}], όχι [${want.join(' | ')}]`);
  }
}

/** σύρσιμο κομματιού (λευκά κάτω· viewBox 0 0 8 8) */
async function drag(from, to) {
  const box = await board().boundingBox();
  const at = (sq) => ({ x: box.x + ('abcdefgh'.indexOf(sq[0]) + 0.5) * (box.width / 8), y: box.y + (8.5 - Number(sq[1])) * (box.height / 8) });
  const a = at(from);
  const b = at(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** κίνηση με δύο κλικ: κομμάτι και προορισμός */
async function clickMove(from, to) {
  const box = await board().boundingBox();
  for (const sq of [from, to]) await page.mouse.click(box.x + ('abcdefgh'.indexOf(sq[0]) + 0.5) * (box.width / 8), box.y + (8.5 - Number(sq[1])) * (box.height / 8));
}

/** τα πλήκτρα πάνε στο window (όχι σε κρυφή λίστα που κράτησε την εστίαση) */
async function keys(...list) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  for (const k of list) await page.keyboard.press(k);
}

/** η καρτέλα της παρτίδας δείχνει (ή όχι) «• » για αλλαγές που δεν αποθηκεύτηκαν */
async function waitDirty(dirty) {
  await page.waitForFunction((d) => (document.querySelector('.tab.active .tab-title')?.textContent ?? '').startsWith('• ') === d, dirty);
}

const isGamePut = (dbId, gid) => (r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/db/${dbId}/game/${gid}`);

// ---------------------------------------------------------------------------

async function main() {
  console.log(`KnightBase e2e (προσωρινός φάκελος ${home})`);
  if (!fs.existsSync(path.join(root, 'dist', 'web', 'index.html'))) throw new Error('λείπει το dist/web: τρέξε πρώτα `npx vite build` (το `npm run e2e` το κάνει μόνο του)');
  const version = await startServer();
  // καρτέλες αντί για παράθυρα, χωρίς οδηγό / «Καλώς ήρθες», χωρίς κίνηση κομματιών και χωρίς Lichess
  await ok('PUT', '/api/settings', {
    language: 'el',
    animationMs: 0,
    onlineLookups: false,
    watchLive: false,
    ui: { windows: 'tabs', guide: { off: true }, library: { welcomeOff: true } },
  });
  try {
    browser = await chromium.launch({ channel: 'msedge' });
  } catch (e) {
    throw new Error(`δεν άνοιξε ο Microsoft Edge (channel msedge): ${e.message.split('\n')[0]}`);
  }
  console.log(`  server ${version.version} στη ${base} · Edge ${browser.version()}`);
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  // τα «Failed to load resource» της κονσόλας τα πιάνει, με τη διεύθυνση, ο έλεγχος των απαντήσεων
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`κονσόλα: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`σελίδα: ${e.message}`));
  // εξαίρεση: 410 στις γραμμές λίστας που έληξε με μια αποθήκευση (η λίστα παίρνει νέο κλειδί και ξαναγεμίζει)
  page.on('response', (r) => {
    const url = r.url().replace(base, '');
    if (r.status() >= 400 && !(r.status() === 410 && /^\/api\/db\/[^/]+\/rows\?/.test(url))) errors.push(`${r.status()} ${r.request().method()} ${url}`);
  });

  const pgnFile = path.join(docs, `${DB_NAME}.pgn`);
  fs.writeFileSync(pgnFile, PGN, 'utf8');
  let dbId = '';
  let gid = 0;
  const pgnOf = async () => (await ok('GET', `/api/db/${dbId}/game/${gid}`)).pgn;
  const openGame = async () => {
    await win().locator('.gl-row').filter({ hasText: 'Kasparov, Garry' }).filter({ hasText: '1-0' }).dblclick();
    await page.locator('.tab.active', { hasText: 'Kasparov – Karpov' }).waitFor();
    await waitFen(FEN.start);
  };

  await check('Εισαγωγή PGN: η βάση φαίνεται στη Βιβλιοθήκη χωρίς ανανέωση', async () => {
    await page.goto(base + '/');
    await win().getByRole('button', { name: 'Νέα βάση' }).waitFor();
    dbId = (await ok('POST', '/api/library/open', { path: pgnFile })).opened[0].entry.id;
    await waitJobs(dbId);
    await win().locator('.db-card').filter({ hasText: DB_NAME }).filter({ hasText: '4 παρτίδες' }).waitFor();
    const v = await ok('POST', `/api/db/${dbId}/view`, {});
    const rows = await ok('GET', `/api/db/${dbId}/rows?key=${encodeURIComponent(v.key)}&offset=0&limit=10`);
    gid = rows.rows.find((r) => r.white === 'Kasparov, Garry').id;
  });

  await check('Άνοιγμα βάσης: λίστα, ελληνικά ονόματα, ταξινόμηση', async () => {
    await win().locator('.db-card').filter({ hasText: DB_NAME }).getByRole('button', { name: 'Άνοιγμα' }).click();
    await page.locator('.tab.active', { hasText: DB_NAME }).waitFor();
    await waitWhites(['Kasparov, Garry', 'Karpov, Anatoly', 'Μπανίκας, Χρήστος', 'Anand, Viswanathan']);
    const head = win().locator('.gl-head .gl-cell', { hasText: 'Λευκά' });
    await head.click();
    await waitWhites(['Anand, Viswanathan', 'Karpov, Anatoly', 'Kasparov, Garry', 'Μπανίκας, Χρήστος']);
    await head.click();
    await waitWhites(['Μπανίκας, Χρήστος', 'Kasparov, Garry', 'Karpov, Anatoly', 'Anand, Viswanathan']);
  });

  await check('Άνοιγμα παρτίδας: σημειογραφία, βελάκια, επιλογή βαριάντας', async () => {
    await openGame();
    const notation = win().locator('.notation');
    await notation.locator('.variation', { hasText: '2.f4' }).waitFor();
    await notation.locator('.comment', { hasText: 'σχόλιο' }).waitFor();
    await notation.locator('.nag', { hasText: '!' }).waitFor();
    await keys('ArrowRight', 'ArrowRight');
    await waitFen(FEN.e4e5);
    // → σε διακλάδωση: παράθυρο επιλογής, ↓ στη βαριάντα, Enter
    await keys('ArrowRight');
    await win().getByRole('listbox', { name: 'Επιλογή βαριάντας' }).waitFor();
    await keys('ArrowDown', 'Enter');
    await waitFen(FEN.f4);
    await notation.locator('.move.current', { hasText: '2.f4' }).waitFor();
    await keys('ArrowRight');
    await waitFen(FEN.exf4);
    await keys('ArrowUp');
    await waitFen(FEN.start);
    await keys('ArrowDown');
    await waitFen(FEN.end);
  });

  await check('Κίνηση στη σκακιέρα (σύρσιμο και κλικ) και Ctrl+S', async () => {
    await drag('b5', 'a4');
    await waitFen(FEN.ba4);
    await waitDirty(true);
    await clickMove('g8', 'f6');
    await waitFen(FEN.nf6);
    const saved = page.waitForResponse(isGamePut(dbId, gid));
    await keys('Control+s');
    assert((await saved).status() === 200, 'η αποθήκευση απέτυχε');
    await waitDirty(false);
    const pgn = await pgnOf();
    assert(pgn.includes('4. Ba4 Nf6') && pgn.includes('(2. f4 exf4)') && pgn.includes('{σχόλιο}'), `στο PGN λείπει η κίνηση, η βαριάντα ή το σχόλιο:\n${pgn}`);
  });

  await check('Κλείσιμο παρτίδας με αλλαγές: «Αποθήκευση;» Άκυρο / Όχι / Ναι', async () => {
    const prompt = win().getByRole('dialog', { name: 'Παρτίδα' });
    await drag('b1', 'c3');
    await waitFen(FEN.nc3);
    await waitDirty(true);
    await tabClose().click();
    await prompt.filter({ hasText: 'Αποθήκευση;' }).waitFor();
    // Άκυρο: η παρτίδα μένει ανοιχτή με την αλλαγή της
    await prompt.getByRole('button', { name: 'Άκυρο' }).click();
    await prompt.waitFor({ state: 'detached' });
    await waitFen(FEN.nc3);
    await waitDirty(true);
    // Όχι: κλείνει χωρίς αποθήκευση
    await tabClose().click();
    await prompt.getByRole('button', { name: 'Όχι' }).click();
    await page.locator('.tab', { hasText: 'Kasparov – Karpov' }).waitFor({ state: 'detached' });
    assert(!(await pgnOf()).includes('Nc3'), 'το «Όχι» αποθήκευσε την παρτίδα');
    // Ναι: αποθηκεύει και κλείνει
    await page.locator('.tab.active', { hasText: DB_NAME }).waitFor();
    await openGame();
    await keys('ArrowDown');
    await waitFen(FEN.nf6);
    await drag('b1', 'c3');
    await waitFen(FEN.nc3);
    await tabClose().click();
    const saved = page.waitForResponse(isGamePut(dbId, gid));
    await prompt.getByRole('button', { name: 'Ναι' }).click();
    assert((await saved).status() === 200, 'η αποθήκευση απέτυχε');
    await page.locator('.tab', { hasText: 'Kasparov – Karpov' }).waitFor({ state: 'detached' });
    assert((await pgnOf()).includes('4. Ba4 Nf6 5. Nc3'), 'το «Ναι» δεν αποθήκευσε την κίνηση');
  });

  await check('Γρήγορη αναζήτηση: παίκτης και θέση (FEN)', async () => {
    await page.locator('[data-guide="tab-library"]').click();
    const q = win().getByRole('textbox', { name: 'Αναζήτηση παρτίδων (παίκτης ή θέση)' });
    await q.fill('Karpov');
    await win().getByRole('option', { name: /Karpov, Anatoly/ }).waitFor();
    await q.press('Enter');
    await page.locator('.tab.active', { hasText: DB_NAME }).waitFor();
    await win().getByText('Παίκτης: Karpov, Anatoly').waitFor();
    await waitWhites(['Kasparov, Garry', 'Karpov, Anatoly'], true);
    await page.locator('[data-guide="tab-library"]').click();
    await q.fill(FEN.e4e5);
    await win().getByRole('button', { name: /Παρτίδες με αυτή τη θέση/ }).click();
    await page.locator('.tab.active', { hasText: DB_NAME }).waitFor();
    await waitWhites(['Kasparov, Garry', 'Anand, Viswanathan'], true);
  });

  await check('Ρυθμίσεις: Εφαρμογή χωρίς αποθήκευση, Ακύρωση αλλαγών, Αποθήκευση', async () => {
    // μια νέα παρτίδα σε άλλη καρτέλα, για να φανεί ότι η «Εφαρμογή» φτάνει και εκεί
    await page.getByRole('button', { name: 'Νέα παρτίδα (Ctrl+N)' }).click();
    await waitFen(FEN.start);
    /** οι συντεταγμένες στη σκακιέρα της νέας παρτίδας (16 ή 0)· μετά ξανά στις Ρυθμίσεις */
    const waitCoords = async (n) => {
      await page.locator('.tab', { hasText: 'Νέα παρτίδα' }).click();
      try {
        await page.waitForFunction((want) => document.querySelectorAll('section.window.active svg.board text').length === want, n);
      } catch {
        throw new Error(`η σκακιέρα της παρτίδας έχει ${await win().locator('svg.board text').count()} συντεταγμένες, όχι ${n}`);
      }
      await page.locator('.tab', { hasText: 'Ρυθμίσεις' }).click();
    };
    await page.getByRole('button', { name: 'Ρυθμίσεις', exact: true }).click();
    const box = win().getByRole('checkbox', { name: 'Συντεταγμένες' });
    const status = (text) => win().locator('.settings-actions', { hasText: text }).waitFor();
    await waitCoords(16);
    await box.uncheck();
    await status('Υπάρχουν αλλαγές που δεν εφαρμόστηκαν');
    await win().getByRole('button', { name: 'Εφαρμογή' }).click();
    await status('Εφαρμόστηκαν χωρίς αποθήκευση');
    await waitCoords(0);
    assert((await ok('GET', '/api/settings')).showCoordinates === true, 'η «Εφαρμογή» αποθήκευσε τη ρύθμιση');
    await win().getByRole('button', { name: 'Ακύρωση αλλαγών' }).click();
    await status('Όλα αποθηκευμένα');
    await waitCoords(16);
    assert(await box.isChecked(), 'το κουτάκι δεν γύρισε πίσω');
    await box.uncheck();
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/api/settings'));
    await win().getByRole('button', { name: 'Αποθήκευση', exact: true }).click();
    assert((await saved).status() === 200, 'η αποθήκευση απέτυχε');
    await status('Όλα αποθηκευμένα');
    await waitCoords(0);
    assert((await ok('GET', '/api/settings')).showCoordinates === false, 'η «Αποθήκευση» δεν κράτησε τη ρύθμιση');
  });

  await check('Κανένα σφάλμα στην κονσόλα, στη σελίδα ή στον server', async () => {
    const serverErrors = serverErr
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/ExperimentalWarning|--trace-warnings/.test(l));
    const all = [...errors, ...serverErrors.map((l) => `server: ${l}`)];
    assert(!all.length, all.slice(0, 10).join('\n'));
  });
}

async function stop() {
  await browser?.close().catch(() => {});
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

const started = Date.now();
try {
  await main();
} catch (e) {
  results.push({ name: 'εκκίνηση', ok: false });
  console.log(`  ✗ ${e.message}`);
} finally {
  await stop();
}
const failed = results.filter((r) => !r.ok).length;
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(failed ? `\n${failed} από ${results.length} έλεγχοι απέτυχαν (${secs} δευτ.)` : `\nΌλοι οι έλεγχοι πέρασαν (${results.length}, ${secs} δευτ.)`);
process.exit(failed ? 1 : 0);
