// Διανομή: release/ruru/Ruru-Chess-Setup.exe και Ruru-Chess-Portable.zip (χωρίς εγκατάσταση), με ενσωματωμένο
// Node.js και Electron. Μόνο η εφαρμογή (κώδικας, χτισμένο περιβάλλον, 7-Zip, Electron runtime) — όχι βάσεις,
// ρυθμίσεις, σημειώσεις ανάπτυξης ή το ιστορικό git. Τα ονόματα δεν έχουν έκδοση, ώστε οι σύνδεσμοι …/releases/latest/download/<όνομα> να
// δείχνουν πάντα την τελευταία. Χωρίς συμπληρωμένο PRIVACY.md (υπεύθυνος, email) δεν βγαίνει έκδοση: μόνο
// με --draft, για δοκιμή, σε release/ruru-draft.
// Χρειάζεται: το Inno Setup 6 (ISCC.exe, στο .tools/innosetup ή εγκατεστημένο). Το Node κατεβαίνει μία φορά
// στο .tools/, με έλεγχο SHA-256.
// Χρήση: node scripts/make-release.mjs [--draft]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

/** Το Node που συνοδεύει την εφαρμογή (LTS, ίδια κύρια έκδοση με το "engines" του package.json). */
const NODE_VERSION = '24.22.1';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// η έκδοση όπως φαίνεται («1.1.0-beta» → «1.1.0 BETA»)· στα στοιχεία των αρχείων μόνο οι αριθμοί
const shown = pkg.version.replace(/-(\w+)$/, (_m, t) => ` ${t.toUpperCase()}`);
const draft = process.argv.includes('--draft');
if (!draft && ['PRIVACY.md', 'TERMS.md'].some((f) => /\[(CONTROLLER|EMAIL)\]/.test(fs.readFileSync(path.join(root, f), 'utf8'))))
  throw new Error('Το PRIVACY.md ή το TERMS.md δεν έχει υπεύθυνο / email. Συμπλήρωσέ το, ή --draft για δοκιμή που δεν δημοσιεύεται.');
const outDir = path.join(root, 'release', draft ? 'ruru-draft' : 'ruru');
const stage = path.join(outDir, 'Ruru');
const tools = path.join(root, '.tools');
const sevenZip = path.join(root, 'node_modules', '7zip-bin', 'win', process.arch === 'arm64' ? 'arm64' : 'x64', '7za.exe');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** node.exe για Windows x64 από το nodejs.org (μία φορά, με έλεγχο στο SHASUMS256.txt). */
async function ensureNode() {
  const name = `node-v${NODE_VERSION}-win-x64`;
  const dir = path.join(tools, name);
  if (fs.existsSync(path.join(dir, 'node.exe'))) return dir;
  const base = `https://nodejs.org/dist/v${NODE_VERSION}/`;
  console.log(`Λήψη του Node ${NODE_VERSION}…`);
  const sums = await (await fetch(base + 'SHASUMS256.txt')).text();
  const expected = sums.split('\n').find((l) => l.trim().endsWith(`  ${name}.zip`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`Δεν βρέθηκε το ${name}.zip στο SHASUMS256.txt`);
  const res = await fetch(base + `${name}.zip`);
  if (!res.ok) throw new Error(`Λήψη του Node: ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  if (sha256(zip) !== expected) throw new Error(`Λάθος SHA-256 για το ${name}.zip`);
  const dl = path.join(tools, 'dl-node');
  fs.mkdirSync(dl, { recursive: true });
  fs.writeFileSync(path.join(dl, `${name}.zip`), zip);
  execFileSync(sevenZip, ['x', '-y', `-o${tools}`, path.join(dl, `${name}.zip`), `${name}/node.exe`, `${name}/LICENSE`], { stdio: 'ignore' });
  return dir;
}

/** ISCC.exe του Inno Setup 6. */
function findIscc() {
  const env = (v) => process.env[v] ?? '';
  return [
    env('ISCC'),
    path.join(tools, 'innosetup', 'ISCC.exe'),
    env('ProgramFiles(x86)') && path.join(env('ProgramFiles(x86)'), 'Inno Setup 6', 'ISCC.exe'),
    env('ProgramFiles') && path.join(env('ProgramFiles'), 'Inno Setup 6', 'ISCC.exe'),
    env('LOCALAPPDATA') && path.join(env('LOCALAPPDATA'), 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ].find((p) => p && fs.existsSync(p));
}

const readmeEl = [
  `Ruru Chess ${shown} — βάση δεδομένων και ανάλυση σκακιού (δωρεάν, GPL-3.0-or-later με μέρη AGPL-3.0)`,
  '',
  'ΕΚΚΙΝΗΣΗ',
  '- Με τον εγκαταστάτη: το Ruru Chess είναι στο μενού Έναρξη (και στην επιφάνεια εργασίας, αν',
  '  το διάλεξες).',
  '- Φορητή έκδοση (ZIP): αποσυμπίεσε τον φάκελο Ruru όπου θέλεις και άνοιξε το Ruru.exe.',
  'Ανοίγει στο δικό του αυτόνομο παράθυρο (Electron) χωρίς να χρειάζεται εξωτερικός browser.',
  '',
  'ΠΡΩΤΗ ΦΟΡΑ',
  '- Μηχανή ανάλυσης: Ρυθμίσεις → Μηχανές → «Λήψη Stockfish» (ένα κλικ), ή δική σου μηχανή UCI (.exe).',
  '- Βάση αναφοράς: δεν περιλαμβάνεται. Άνοιξε δικά σου αρχεία PGN / ChessBase (.cbh, .cbv) / Scid, ή',
  '  Βιβλιοθήκη → «Βάση αναφοράς» για τη σελίδα της Lumbra’s Gigabase (© Michael Jansen, CC BY-NC 4.0,',
  '  μόνο μη εμπορική χρήση).',
  '- Οι βάσεις και οι ρυθμίσεις σου αποθηκεύονται στο Έγγραφα\\Ruru (αν είχες KnightBase, μένουν στο',
  '  Έγγραφα\\KnightBase) και μένουν εκεί και μετά από απεγκατάσταση.',
  '',
  'ΑΠΟΡΡΗΤΟ',
  'Οι βάσεις σου μένουν στον υπολογιστή σου. Τι στέλνουν οι online λειτουργίες και πώς κλείνουν: PRIVACY.md.',
  '',
  'ΑΔΕΙΕΣ',
  'Ruru Chess: GPL-3.0-or-later (LICENSE), με μέρη AGPL-3.0 (licenses\\AGPL-3.0.txt).',
  'Ο κώδικας είναι στον φάκελο src. Χωρίς καμία εγγύηση.',
  'Node.js: node\\LICENSE. Electron: LICENSE.electron.txt και LICENSES.chromium.html.',
  'Τα υπόλοιπα: CREDITS.md, THIRD-PARTY-LICENSES.txt και φάκελος licenses.',
  'Το Ruru Chess δεν σχετίζεται με την ChessBase GmbH, το Lichess, το Chess.com ή τη FIDE. Τα σήματα',
  'ανήκουν στους κατόχους τους.',
  '',
].join('\r\n');

const readmeEn = [
  `Ruru Chess ${shown} — chess database and analysis (free, GPL-3.0-or-later with parts under AGPL-3.0)`,
  '',
  'STARTING',
  '- Installed: Ruru Chess is in the Start menu (and on the desktop, if you chose so).',
  '- Portable (ZIP): extract the Ruru folder anywhere and open Ruru.exe.',
  'Opens in its own standalone desktop window (Electron), no external browser needed.',
  '',
  'FIRST TIME',
  '- Analysis engine: Settings → Engines → “Download Stockfish” (one click), or add your own UCI engine.',
  '- Reference database: not included. Open your own PGN / ChessBase (.cbh, .cbv) / Scid files, or use',
  '  Library → “Reference database” for the page of Lumbra’s Gigabase (© Michael Jansen, CC BY-NC 4.0,',
  '  non-commercial use only).',
  '- Your databases and settings are stored in Documents\\Ruru (if you had KnightBase, they stay in',
  '  Documents\\KnightBase) and stay there after uninstalling.',
  '',
  'PRIVACY',
  'Your databases stay on your computer. What the online functions send and how to turn them off: PRIVACY.md.',
  '',
  'LICENSES',
  'Ruru Chess: GPL-3.0-or-later (LICENSE), with parts under AGPL-3.0 (licenses\\AGPL-3.0.txt).',
  'The source code is in the src folder. No warranty of any kind.',
  'Node.js: node\\LICENSE. Electron: LICENSE.electron.txt and LICENSES.chromium.html.',
  'Everything else: CREDITS.md, THIRD-PARTY-LICENSES.txt and the licenses folder.',
  'Ruru Chess is not affiliated with ChessBase GmbH, Lichess, Chess.com or FIDE. Trademarks belong to',
  'their owners.',
  '',
].join('\r\n');

console.log('Χτίσιμο περιβάλλοντος…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

fs.rmSync(stage, { recursive: true, force: true });
for (const f of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) if (/^Ruru-Chess-.*\.(zip|exe)$|^SHA256SUMS\.txt$/.test(f)) fs.rmSync(path.join(outDir, f));
fs.mkdirSync(stage, { recursive: true });

const copy = (rel) => {
  const from = path.join(root, rel);
  if (!fs.existsSync(from)) throw new Error(`Λείπει: ${rel}`);
  fs.cpSync(from, path.join(stage, rel), { recursive: true });
};
// ο κώδικας μπαίνει ολόκληρος (GPL), μαζί με ό,τι χρειάζεται για να ξαναχτιστεί
for (const f of ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'CREDITS.md', 'LICENSE', 'PRIVACY.md', 'TERMS.md', 'Ruru.ico', 'scripts/make-release.mjs']) copy(f);
for (const d of ['src', 'public', 'dist/web', 'installer', 'licenses']) copy(d);
// οι άδειες των βιβλιοθηκών που μπαίνουν στο πακέτο ή μέσα στο dist/web (React κ.ά.): το κείμενο κάθε άδειας,
// όπως ζητούν οι MIT / ISC / Apache, και το 7-Zip (LGPL) του 7za.exe
const notices = [];
const seenDeps = new Set();
const visitDep = (name) => {
  if (seenDeps.has(name)) return;
  seenDeps.add(name);
  const dir = path.join(root, 'node_modules', name);
  if (!fs.existsSync(path.join(dir, 'package.json'))) return console.warn(`Άδεια: δεν βρέθηκε το ${name}`);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : `${meta.license ?? ''} — ${meta.homepage ?? ''}`;
  notices.push(`== ${name} ${meta.version} (${meta.license ?? '?'}) ==\n\n${text}\n`);
  for (const d of Object.keys(meta.dependencies ?? {})) visitDep(d);
};
for (const d of Object.keys(pkg.dependencies ?? {})) visitDep(d);
// Electron runtime (MIT · το πλήρες κείμενο για Chromium/third-party είναι στο LICENSES.chromium.html)
const electronDir = path.join(root, 'node_modules', 'electron');
const electronDist = path.join(electronDir, 'dist');
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) throw new Error('Λείπει το Electron runtime (τρέξε npm install).');
const electronMeta = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
const electronLic = fs.readFileSync(path.join(electronDist, 'LICENSE'), 'utf8').trim();
notices.push(`== electron ${electronMeta.version} (${electronMeta.license ?? 'MIT'}) ==\n\n${electronLic}\n\nChromium & third-party notices: LICENSES.chromium.html\n`);
// μέσα στο dist/web ή στο πακέτο χωρίς να είναι dependencies: οι ειδοποιήσεις γράφονται με το χέρι
notices.unshift(fs.readFileSync(path.join(root, 'licenses', 'NOTICES.txt'), 'utf8').replace(/\r\n/g, '\n'));
fs.writeFileSync(path.join(stage, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n'));
// Electron απευθείας στη ρίζα ως Ruru.exe με resources/app (χωρίς εξωτερικό .NET launcher stub)
copy('electron/main.cjs');
const KEEP_LOCALES = new Set(['el.pak', 'en-US.pak', 'en-GB.pak']);
for (const entry of fs.readdirSync(electronDist, { withFileTypes: true })) {
  const srcPath = path.join(electronDist, entry.name);
  if (entry.name === 'resources' && entry.isDirectory()) continue;
  const dstName = entry.name === 'electron.exe' ? 'Ruru.exe' : entry.name === 'LICENSE' ? 'LICENSE.electron.txt' : entry.name;
  const dstPath = path.join(stage, dstName);
  if (entry.name === 'locales' && entry.isDirectory()) {
    fs.mkdirSync(dstPath, { recursive: true });
    for (const loc of fs.readdirSync(srcPath)) if (KEEP_LOCALES.has(loc)) fs.copyFileSync(path.join(srcPath, loc), path.join(dstPath, loc));
  } else {
    fs.cpSync(srcPath, dstPath, { recursive: true });
  }
}
const appEntryDir = path.join(stage, 'resources', 'app');
fs.mkdirSync(appEntryDir, { recursive: true });
fs.writeFileSync(path.join(appEntryDir, 'package.json'), JSON.stringify({ name: 'ruru-chess', version: pkg.version, main: 'bootstrap.cjs' }, null, 2) + '\n');
fs.writeFileSync(path.join(appEntryDir, 'bootstrap.cjs'), "'use strict';\nrequire('../../electron/main.cjs');\n");
// όνομα και εικονίδιο μέσα στο Ruru.exe: η Διαχείριση Εργασιών και η γραμμή εργασιών δείχνουν «Ruru Chess», όχι «Electron»
const v4 = `${pkg.version.split('-')[0]}.0`;
await rcedit(path.join(stage, 'Ruru.exe'), {
  icon: path.join(root, 'Ruru.ico'),
  'file-version': v4,
  'product-version': v4,
  'version-string': { FileDescription: 'Ruru Chess', ProductName: 'Ruru Chess', InternalName: 'Ruru', OriginalFilename: 'Ruru.exe' },
});
// μόνο ό,τι χρειάζεται ο server στα Windows: το 7za για .7z / .zip / .gz …
for (const f of ['index.js', 'index.d.ts', 'package.json', 'LICENSE.txt', 'win']) copy(`node_modules/7zip-bin/${f}`);
// … και το ts-fsrs για τα διαστήματα επανάληψης της Τακτικής (χωρίς δικές του εξαρτήσεις)
for (const f of ['package.json', 'LICENSE', 'dist/index.mjs', 'dist/index.cjs', 'dist/index.d.ts']) copy(`node_modules/ts-fsrs/${f}`);
// … και το pdf.js της Mozilla (Apache-2.0) για το «Βιβλίο σε βάση»: μόνο το κείμενο των PDF, χωρίς canvas
for (const f of ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'cmaps', 'standard_fonts', 'wasm']) copy(`node_modules/pdfjs-dist/${f}`);
fs.writeFileSync(path.join(stage, 'ΔΙΑΒΑΣΕ ΜΕ.txt'), readmeEl);
fs.writeFileSync(path.join(stage, 'README.txt'), readmeEn);

const nodeDir = await ensureNode();
fs.mkdirSync(path.join(stage, 'node'));
for (const f of ['node.exe', 'LICENSE']) fs.copyFileSync(path.join(nodeDir, f), path.join(stage, 'node', f));

// έλεγχος: τίποτα προσωπικό στο πακέτο
const banned = [/HANDOFF\.md$/i, /NEXT_CHAT_PROMPT\.md$/i, /\.(kbdb|skdb)$/i,/\.pos$/i, /\.tree$/i, /library\.json$/i, /settings\.json$/i, /preset\.json$/i];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(stage);
const bad = files.filter((f) => banned.some((re) => re.test(f)));
if (bad.length) throw new Error(`Προσωπικά αρχεία στο πακέτο: ${bad.join(', ')}`);

execFileSync(sevenZip, ['a', '-tzip', '-mx=9', path.join(outDir, 'Ruru-Chess-Portable.zip'), 'Ruru'], { cwd: outDir, stdio: 'ignore' });

const SETUP = 'Ruru-Chess-Setup.exe';
const iscc = findIscc();
if (iscc) {
  const defs = [`/DAppVersion=${shown}`, `/DAppNumVersion=${pkg.version.split('-')[0]}`, `/DStageDir=${stage}`, `/DOutputDir=${outDir}`];
  if (/^https:\/\//.test(pkg.homepage ?? '')) defs.push(`/DAppURL=${pkg.homepage}`);
  console.log(`Εγκαταστάτης: ${SETUP}…`);
  execFileSync(iscc, ['/Q', ...defs, path.join(root, 'installer', 'Ruru.iss')], { stdio: 'inherit' });
} else {
  console.warn('Δεν βρέθηκε το Inno Setup 6 (ISCC.exe): φτιάχτηκε μόνο το φορητό πακέτο.');
}

const outputs = [SETUP, 'Ruru-Chess-Portable.zip'].filter((f) => fs.existsSync(path.join(outDir, f)));
fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), outputs.map((f) => `${sha256(fs.readFileSync(path.join(outDir, f)))}  ${f}`).join('\n') + '\n');
for (const f of outputs) console.log(`Έτοιμο: ${path.relative(root, outDir)}/${f} (${(fs.statSync(path.join(outDir, f)).size / 1e6).toFixed(1)} MB, ${files.length} αρχεία)`);
