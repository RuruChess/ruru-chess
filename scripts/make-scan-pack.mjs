// Πακέτο σκαναρισμένων βιβλίων: προαιρετική λήψη μέσα από το «Βιβλίο σε βάση» (src/server/books/scanpack.ts).
// Περιέχει τον αναγνώστη εικόνας (PP-OCRv6 small του PaddleOCR + onnxruntime-node, μόνο Windows x64 και μόνο CPU: τα
// DirectML.dll / dxcompiler.dll μένουν έξω, φορτώνονται μόνο κατ' απαίτηση) και το chess-diagram-net, αμετάβλητο. Τα
// αρχεία είναι αυτά που δοκιμάστηκαν στην εφαρμογή: <φάκελος>\ocr\ppocr και <φάκελος>\diagram\cdn (προεπιλογή
// %LOCALAPPDATA%\KnightBase ή \Ruru). Οι άδειες του ONNX Runtime και του PaddleOCR κατεβαίνουν μία φορά στο .tools/.
// Γράφει release/scan-pack/Ruru-Chess-Scan-Pack-win-x64.zip και τυπώνει μέγεθος και SHA-256 για το SCAN_PACK.
// Χρήση: node scripts/make-scan-pack.mjs [--from <φάκελος>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--from');
const from =
  at > 0
    ? path.resolve(process.argv[at + 1])
    : ['KnightBase', 'Ruru'].map((n) => path.join(process.env.LOCALAPPDATA ?? '', n)).find((d) => fs.existsSync(path.join(d, 'ocr', 'ppocr', 'ppocr.json')));
if (!from) throw new Error('Δεν βρέθηκε ο αναγνώστης (ocr\\ppocr): δώσε --from <φάκελος>');
const ppocr = path.join(from, 'ocr', 'ppocr');
const cdn = path.join(from, 'diagram', 'cdn');
const out = path.join(root, 'release', 'scan-pack');
const stage = path.join(out, 'stage');
const tools = path.join(root, '.tools');
const sevenZip = path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const ortNode = path.join(ppocr, 'node_modules', 'onnxruntime-node');
const ORT = JSON.parse(fs.readFileSync(path.join(ortNode, 'package.json'), 'utf8')).version;

/** Κείμενο άδειας από το επίσημο αποθετήριο (μία φορά, στο .tools/). */
async function licenseText(cacheName, url) {
  const file = path.join(tools, cacheName);
  if (!fs.existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    fs.mkdirSync(tools, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

fs.rmSync(stage, { recursive: true, force: true });
const put = (src, rel) => {
  if (!fs.existsSync(src)) throw new Error(`Λείπει: ${src}`);
  const dst = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};

// αναγνώστης: τα δύο μοντέλα, το onnxruntime (JS + Windows x64) και οι άδειες
const P = 'ocr/ppocr';
put(path.join(ppocr, 'ppocr.json'), `${P}/ppocr.json`);
for (const m of ['small_det', 'small_rec']) for (const f of ['inference.onnx', 'inference.yml']) put(path.join(ppocr, 'models', m, f), `${P}/models/${m}/${f}`);
for (const f of ['package.json', 'README.md', 'dist']) put(path.join(ortNode, f), `${P}/node_modules/onnxruntime-node/${f}`);
const bin = 'bin/napi-v6/win32/x64';
for (const f of ['onnxruntime.dll', 'onnxruntime_binding.node']) put(path.join(ortNode, bin, f), `${P}/node_modules/onnxruntime-node/${bin}/${f}`);
const ortCommon = path.join(ppocr, 'node_modules', 'onnxruntime-common');
for (const f of ['package.json', 'README.md', 'dist']) put(path.join(ortCommon, f), `${P}/node_modules/onnxruntime-common/${f}`);
// (από το jsDelivr, που κρατά τα αρχεία κάθε έκδοσης: το github.com/microsoft/onnxruntime απαντά 404 από 11/2026)
const ortRaw = `https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@v${ORT}`;
put(await licenseText(`onnxruntime-${ORT}-LICENSE.txt`, `${ortRaw}/LICENSE`), `${P}/LICENSE-onnxruntime.txt`);
put(await licenseText(`onnxruntime-${ORT}-ThirdPartyNotices.txt`, `${ortRaw}/ThirdPartyNotices.txt`), `${P}/ThirdPartyNotices-onnxruntime.txt`);
put(await licenseText('PaddleOCR-LICENSE.txt', 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/LICENSE'), `${P}/LICENSE-PaddleOCR.txt`);
// διαγράμματα: ολόκληρο, αμετάβλητο, με την άδειά του
put(cdn, 'diagram/cdn');

fs.writeFileSync(
  path.join(stage, 'README.txt'),
  [
    'Ruru Chess - Πακέτο σκαναρισμένων βιβλίων / Scanned books pack (Windows x64)',
    '',
    'Προαιρετικό πακέτο που κατεβάζει το «Βιβλίο σε βάση» του Ruru Chess, για να διαβάζει τα σκαναρισμένα βιβλία πολύ',
    'καλύτερα από το OCR των Windows. Μπαίνει στο %LOCALAPPDATA%\\Ruru (ή \\KnightBase). Αφαίρεση: σβήσε τους φακέλους',
    'ocr\\ppocr και diagram\\cdn εκεί.',
    '',
    'Optional pack downloaded by Ruru Chess (Book to Database) to read scanned books much better than Windows OCR.',
    'It is placed in %LOCALAPPDATA%\\Ruru (or \\KnightBase). To remove it, delete the ocr\\ppocr and diagram\\cdn folders there.',
    '',
    'Contents:',
    '- ocr/ppocr/models: PP-OCRv6_small_det and PP-OCRv6_small_rec (PaddleOCR, PaddlePaddle Authors), unmodified,',
    '  Apache License 2.0 (LICENSE-PaddleOCR.txt). https://github.com/PaddlePaddle/PaddleOCR',
    `- ocr/ppocr/node_modules: onnxruntime-node and onnxruntime-common ${ORT} (Microsoft), unmodified, MIT`,
    '  (LICENSE-onnxruntime.txt, ThirdPartyNotices-onnxruntime.txt). Windows x64, CPU only: DirectML.dll and',
    '  dxcompiler.dll are left out. https://github.com/microsoft/onnxruntime',
    '- diagram/cdn: Chess Diagram Net, unmodified, AGPL-3.0-or-later (diagram/cdn/LICENSE).',
    '  https://github.com/regard2462/chess-diagram-net',
    '',
  ].join('\r\n'),
);

fs.mkdirSync(out, { recursive: true });
const zip = path.join(out, 'Ruru-Chess-Scan-Pack-win-x64.zip');
fs.rmSync(zip, { force: true });
execFileSync(sevenZip, ['a', '-tzip', '-mx=9', zip, '*'], { cwd: stage, stdio: 'ignore', windowsHide: true });
fs.rmSync(stage, { recursive: true, force: true });
const data = fs.readFileSync(zip);
console.log(`${path.relative(root, zip)}\n  bytes:  ${data.length}\n  sha256: ${crypto.createHash('sha256').update(data).digest('hex')}`);
