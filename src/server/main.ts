/**
 * Ruru — server. Εκκίνηση: `npm start` (ή `node src/server/main.ts --open`).
 * Ακούει μόνο τοπικά (127.0.0.1) και σερβίρει το περιβάλλον από το dist/web.
 */
// πρώτο: η μετονομασία των φακέλων SkakiBase → Ruru, πριν το paths.ts διαλέξει φακέλους
import './boot.ts';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Router } from './http.ts';
import { logError } from './errlog.ts';
import { HttpError, Library } from './library.ts';
import { AnalysisManager, engineLoad, probeEngine } from './analysis.ts';
import { registerApi } from './api.ts';
import { registerTraining } from './training.ts';
import { registerDownloads } from './downloads.ts';
import { registerLc0 } from './lc0.ts';
import { registerBooks } from './books/import.ts';
import { VERSION, newer, registerAbout } from './about.ts';
import { registerWatch } from './watch.ts';
import { registerMyGames } from './mygames.ts';
import { registerPrep } from './prep.ts';
import { registerTactics } from './tactics/index.ts';
import { connectBrowser, maximizeOnOpen } from './browser.ts';
import { discoverEngines } from './engine.ts';
import { openAppWindow } from './window.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));
const PORT = Number(process.env.KNIGHTBASE_PORT ?? 4747);

// σφάλμα σε timer ή callback (εκτός αιτημάτων) δεν πρέπει να κλείνει όλη την εφαρμογή
// (και στο errors.log)
process.on('uncaughtException', (err) => logError(err));
process.on('unhandledRejection', (err) => logError(err));

const lib = new Library();
const analysis = new AnalysisManager(() => lib.settings.engines);
const router = new Router();
const webDir = path.join(ROOT, 'dist', 'web');
if (fs.existsSync(path.join(webDir, 'index.html'))) router.staticDir = webDir;

lib.onJob = (job) => router.broadcast('job', lib.publicJob(job));
analysis.onUpdate = (session, u) => router.broadcast('analysis', { session, ...u });
analysis.onJob = (job) => router.broadcast('gameAnalysis', { id: job.id, status: job.status, done: job.done, total: job.total, error: job.error, last: job.evals[job.evals.length - 1] ?? null });

registerApi(router, lib, analysis);
registerTraining(router, lib);
registerDownloads(router, lib);
registerLc0(router, lib, analysis);
registerBooks(router, lib);
registerAbout(router);
registerWatch(router, lib);
registerMyGames(router, lib);
registerPrep(router, lib);
// νέο κύριο παράθυρο (όταν η εφαρμογή ανοίγει ξανά ενώ τρέχει ήδη)
let appUrl = `http://127.0.0.1:${PORT}`;
router.post('/api/window/main', () => {
  openWindow(appUrl);
  return { ok: true };
});
// νεότερη έκδοση που ξεκινά ζητά από αυτόν τον server να κλείσει. Η κεφαλίδα αναγκάζει τους browsers σε
// έλεγχο CORS (που δεν περνά), άρα δεν μπορεί να το ζητήσει καμία ιστοσελίδα· όχι ενώ τρέχει εισαγωγή.
router.post('/api/quit', (req) => {
  if (req.raw.headers['x-knightbase'] !== 'quit') throw new HttpError(403, 'Μη αποδεκτό αίτημα');
  if ([...lib.jobs.values()].some((j) => j.status === 'running')) throw new HttpError(409, 'Τρέχει εργασία');
  setTimeout(shutdown, 150);
  return { ok: true };
});
// Τακτική (puzzles): ένα σφάλμα της δεν σταματά την υπόλοιπη εφαρμογή
try {
  registerTactics(router, lib, analysis);
} catch (e) {
  console.error('Τακτική: δεν φορτώθηκε', e);
}

/** Πρώτη εκκίνηση: προσθήκη μηχανών που βρίσκονται ήδη στον υπολογιστή. */
async function autoEngines(): Promise<void> {
  if (lib.settings.engines.length) return;
  for (const exe of discoverEngines().slice(0, 3)) {
    try {
      const idn = await probeEngine(exe);
      const engines = [...lib.settings.engines, { id: Math.random().toString(36).slice(2, 10), name: idn.name, path: exe, options: engineLoad(64, 256) }];
      lib.saveSettings({ engines, defaultEngine: lib.settings.defaultEngine ?? engines[0].id });
      console.log(`Βρέθηκε μηχανή: ${idn.name}`);
    } catch {
      // δεν είναι μηχανή UCI
    }
  }
}

interface RunningServer {
  name?: string;
  version?: string;
  pid?: number;
}

/** Ο Ruru (ή η παλιά SkakiBase) που απαντά ήδη σε αυτή τη θύρα. */
async function runningServer(port: number): Promise<RunningServer | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1500) });
    const v = (await r.json()) as RunningServer;
    return v.name === 'KnightBase' || v.name === 'SkakiBase' ? v : null;
  } catch {
    return null;
  }
}

/** Η διεργασία που ακούει στη θύρα (για παλιές εκδόσεις χωρίς /api/quit)· το netstat γράφει την κατάσταση στη γλώσσα των Windows. */
function pidOnPort(port: number): number | null {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
    const m = new RegExp(`TCP\\s+127\\.0\\.0\\.1:${port}\\s+0\\.0\\.0\\.0:0\\s+\\S+\\s+(\\d+)`).exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Τρέχει παλιότερη έκδοση (π.χ. έμεινε ανοιχτή όσο γινόταν η ενημέρωση): κλείνει, για να τρέξει ο νέος κώδικας,
 * εκτός αν κάνει κάποια εργασία (εισαγωγή κ.λπ.). Τα παράθυρά της ξανασυνδέονται και φορτώνουν τη νέα έκδοση.
 */
async function replaceOlder(port: number, v: RunningServer): Promise<boolean> {
  if (v.name !== 'KnightBase' || !v.version || !newer(VERSION, v.version)) return false;
  const base = `http://127.0.0.1:${port}`;
  try {
    const jobs = (await (await fetch(`${base}/api/jobs`, { signal: AbortSignal.timeout(2000) })).json()) as Array<{ status?: string }>;
    if (jobs.some((j) => j.status === 'running')) return false;
  } catch {
    return false;
  }
  const asked = await fetch(`${base}/api/quit`, { method: 'POST', headers: { 'X-KnightBase': 'quit' }, signal: AbortSignal.timeout(2000) }).then(
    (r) => r.ok,
    () => false,
  );
  if (!asked) {
    const pid = v.pid ?? pidOnPort(port);
    if (!pid || pid === process.pid) return false;
    try {
      process.kill(pid);
    } catch {
      return false;
    }
  }
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (!(await runningServer(port))) return true;
  }
  return false;
}

async function start(): Promise<void> {
  const running = await runningServer(PORT);
  if (running && (await replaceOlder(PORT, running))) console.log(`Έκλεισε η παλιότερη έκδοση ${running.version}· ξεκινά η ${VERSION}.`);
  else if (running) {
    console.log('Το Ruru τρέχει ήδη.');
    // το παράθυρο το ανοίγει ο server που τρέχει: έχει το κανάλι ελέγχου και το μεγιστοποιεί
    if (args.has('--open')) {
      const ok = await fetch(`http://127.0.0.1:${PORT}/api/window/main`, { method: 'POST', signal: AbortSignal.timeout(3000) }).then(
        (r) => r.ok,
        () => false,
      );
      if (!ok) openWindow(`http://127.0.0.1:${PORT}`);
    }
    process.exit(0);
  }
  let port = PORT;
  for (;;) {
    try {
      await router.listen(port, '127.0.0.1');
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port > PORT + 20) throw e;
      port++;
    }
  }
  const url = `http://127.0.0.1:${port}`;
  appUrl = url;
  console.log(`Ruru: ${url}`);
  if (!router.staticDir) console.log('(το περιβάλλον δεν έχει χτιστεί — τρέξε «npm run build» ή «npm run dev»)');
  void autoEngines();
  // παράθυρα που είναι ήδη ανοιχτά (π.χ. μετά από επανεκκίνηση του server): το κανάλι ελέγχου (όχι σε Electron)
  if (process.env.RURU_ELECTRON !== '1') connectBrowser(5);
  // --open: λειτουργία εφαρμογής με παράθυρο· --idle: το ίδιο χωρίς νέο παράθυρο (π.χ. επανεκκίνηση
  // του server ενώ τα παράθυρα είναι ήδη ανοιχτά)
  if (args.has('--open') || args.has('--idle')) {
    if (args.has('--open')) openWindow(url);
    // λειτουργία εφαρμογής: τερματισμός όταν κλείσουν όλα τα παράθυρα (και δεν τρέχει εισαγωγή)
    let idleSince = Date.now();
    setInterval(() => {
      const busy = [...lib.jobs.values()].some((j) => j.status === 'running');
      if (router.clientCount > 0 || busy) idleSince = Date.now();
      else if (Date.now() - idleSince > 90_000) shutdown();
    }, 15_000).unref();
  }
}

/** Ανοίγει το Ruru σε δικό του παράθυρο (Edge/Chrome σε λειτουργία εφαρμογής), μεγιστοποιημένο. */
function openWindow(url: string): void {
  // --start-maximized για νέο Edge· για Edge που τρέχει ήδη, μέσα από το κανάλι ελέγχου
  maximizeOnOpen('main');
  openAppWindow(url, undefined, undefined, { maximized: true });
}

const shutdown = () => {
  analysis.closeAll();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// αν έκλεισε απότομα το Electron (χάθηκε το IPC): τερματισμός αμέσως, εκτός αν τρέχει εισαγωγή
// (τότε το --idle τον κλείνει μόλις τελειώσει η εργασία)
process.on('disconnect', () => {
  if (![...lib.jobs.values()].some((j) => j.status === 'running')) shutdown();
});

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
