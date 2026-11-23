// Η συντόμευση «KnightBase (νέος κώδικας)» (μέσω του open-dev.vbs): ανοίγει το KnightBase από αυτόν τον φάκελο,
// με ό,τι άλλαξε στον κώδικα, χωρίς έκδοση και εγκατάσταση.
// 1. Άλλαξε κάτι στο περιβάλλον μετά το τελευταίο build; → vite build (λίγα δευτερόλεπτα).
// 2. Τρέχει ήδη KnightBase από άλλον φάκελο (π.χ. το εγκατεστημένο) ή από εδώ αλλά πριν από την τελευταία αλλαγή;
//    → κλείνει (όχι όσο κάνει εργασία, π.χ. εισαγωγή: τότε ανοίγει απλώς παράθυρο σε αυτόν).
// 3. Ξεκινά τον server με --open (αν τρέχει ήδη ο σωστός, ανοίγει μόνο νέο παράθυρο).
// Η έξοδος του build και του server γράφεται στο %TEMP%\knightbase-dev.log· σε σφάλμα έξοδος 1 (το .vbs ανοίγει το log).
// Να ξεκινά έξω από το Claude (διπλό κλικ ή `explorer.exe scripts\open-dev.vbs`): αλλιώς οι ρυθμίσεις γράφονται
// στον εικονικό φάκελο του MSIX.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://127.0.0.1:${process.env.KNIGHTBASE_PORT || 4747}`;
const logFile = path.join(os.tmpdir(), 'knightbase-dev.log');
fs.writeFileSync(logFile, `KnightBase (νέος κώδικας) · ${new Date().toLocaleString('el-GR')} · ${root}\n`);
const log = (s) => fs.appendFileSync(logFile, `${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Η πιο πρόσφατη αλλαγή (ms) σε αυτά τα αρχεία / φακέλους. */
function newest(items) {
  let t = 0;
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n));
    else t = Math.max(t, st.mtimeMs);
  };
  for (const it of items) walk(path.join(root, it));
  return t;
}

async function get(url) {
  try {
    const r = await fetch(base + url, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const same = (a) => typeof a === 'string' && path.resolve(a).toLowerCase() === root.toLowerCase();

async function main() {
  // 1. περιβάλλον (dist/web)
  const built = newest(['dist/web/index.html']);
  if (newest(['src/web', 'src/core', 'public', 'index.html', 'vite.config.ts', 'package.json', 'PRIVACY.md', 'TERMS.md']) > built) {
    log('Build του περιβάλλοντος…');
    const b = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], { cwd: root, encoding: 'utf8', windowsHide: true });
    log(`${b.stdout ?? ''}${b.stderr ?? ''}`.trim());
    if (b.status !== 0) throw new Error('Το build απέτυχε (βλ. πιο πάνω).');
  }

  // 2. server που τρέχει με παλιό κώδικα
  const running = await get('/api/version');
  if (running) {
    const fresh = same(running.root) && running.started > Math.max(newest(['src', 'package.json']), newest(['dist/web/index.html']));
    const jobs = fresh ? [] : await get('/api/jobs');
    if (!fresh && Array.isArray(jobs) && !jobs.some((j) => j.status === 'running')) {
      log(`Κλείνει ο server που έτρεχε (${running.version}, ${running.root ?? 'άλλος φάκελος'}).`);
      await fetch(`${base}/api/quit`, { method: 'POST', headers: { 'X-KnightBase': 'quit' }, signal: AbortSignal.timeout(2000) }).catch(() => {});
      for (let i = 0; i < 50 && (await get('/api/version')); i++) await sleep(200);
      if (await get('/api/version')) throw new Error('Ο server που έτρεχε δεν έκλεισε.');
    } else if (!fresh) log('Ο server που τρέχει κάνει εργασία: ανοίγει παράθυρο σε αυτόν (παλιός κώδικας ως την επόμενη φορά).');
  }

  // 3. server από αυτόν τον φάκελο (ή νέο παράθυρο στον σωστό που τρέχει ήδη)
  const out = fs.openSync(logFile, 'a');
  spawn(process.execPath, [path.join(root, 'src/server/main.ts'), '--open'], { cwd: root, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
  for (let i = 0; i < 150; i++) {
    const v = await get('/api/version');
    if (v && (same(v.root) || running)) return;
    await sleep(200);
  }
  throw new Error('Ο server δεν απάντησε σε 30 δευτερόλεπτα.');
}

main().then(
  () => process.exit(0),
  (e) => {
    log(`ΣΦΑΛΜΑ: ${e.message}`);
    process.exit(1);
  },
);
