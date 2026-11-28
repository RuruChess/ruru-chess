import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { sevenZipPath } from '../src/server/db/importer.ts';
import { fetchScanPack, unpackScanPack, vcRuntimeMissing } from '../src/server/books/scanpack.ts';

// Μικρά πακέτα με τη δομή του αληθινού (ocr/ppocr, diagram/cdn), από τοπικό server
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruru-scanpack-'));
const zips: Record<string, Buffer> = {};
let server: http.Server;
let base = '';

function makeZip(name: string, parts: string[]): void {
  const src = path.join(root, `src-${name}`);
  for (const p of parts) {
    fs.mkdirSync(path.join(src, p), { recursive: true });
    fs.writeFileSync(path.join(src, p, 'file.txt'), p);
  }
  const zip = path.join(root, `${name}.zip`);
  execFileSync(sevenZipPath(), ['a', '-tzip', zip, '*'], { cwd: src, stdio: 'ignore', windowsHide: true });
  zips[name] = fs.readFileSync(zip);
}
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const appDir = (n: string) => fs.mkdtempSync(path.join(root, `app-${n}-`));
const never = () => new AbortController().signal;

beforeAll(async () => {
  makeZip('good', ['ocr/ppocr', 'diagram/cdn']);
  makeZip('half', ['ocr/ppocr']);
  server = http.createServer((req, res) => {
    const z = zips[path.basename(req.url ?? '', '.zip')];
    if (!z) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': z.length }).end(z);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('πακέτο σκαναρισμένων βιβλίων', () => {
  it('κατεβαίνει, ελέγχεται και ανοίγει στη θέση του (αντικαθιστά τον παλιό φάκελο, σβήνει τα προσωρινά)', async () => {
    const dir = appDir('ok');
    fs.mkdirSync(path.join(dir, 'ocr', 'ppocr'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ocr', 'ppocr', 'old.txt'), 'old');
    fs.writeFileSync(path.join(dir, 'ocr', 'vlm.json'), '{}'); // άλλο πακέτο στον ίδιο φάκελο: μένει
    let got = 0;
    const zip = await fetchScanPack({ url: `${base}/good.zip`, bytes: zips.good.length, sha256: sha(zips.good) }, dir, (g) => (got = g), never());
    expect(got).toBe(zips.good.length);
    unpackScanPack(zip, dir);
    expect(fs.readFileSync(path.join(dir, 'ocr', 'ppocr', 'file.txt'), 'utf8')).toBe('ocr/ppocr');
    expect(fs.readFileSync(path.join(dir, 'diagram', 'cdn', 'file.txt'), 'utf8')).toBe('diagram/cdn');
    expect(fs.existsSync(path.join(dir, 'ocr', 'ppocr', 'old.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'ocr', 'vlm.json'))).toBe(true);
    expect(fs.existsSync(zip)).toBe(false);
    expect(fs.existsSync(path.join(dir, '_scanpack'))).toBe(false);
  });

  it('λάθος SHA-256: σφάλμα, τίποτα δεν εγκαθίσταται και το αρχείο σβήνεται', async () => {
    const dir = appDir('sha');
    await expect(fetchScanPack({ url: `${base}/good.zip`, bytes: zips.good.length, sha256: '0'.repeat(64) }, dir, () => {}, never())).rejects.toThrow(/SHA-256/);
    expect(fs.readdirSync(path.join(dir, '_downloads'))).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'ocr'))).toBe(false);
  });

  it('πακέτο χωρίς έναν από τους φακέλους: σφάλμα, ο υπάρχων φάκελος μένει ως έχει', async () => {
    const dir = appDir('half');
    fs.mkdirSync(path.join(dir, 'ocr', 'ppocr'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ocr', 'ppocr', 'old.txt'), 'old');
    const zip = await fetchScanPack({ url: `${base}/half.zip`, bytes: zips.half.length, sha256: sha(zips.half) }, dir, () => {}, never());
    expect(() => unpackScanPack(zip, dir)).toThrow(/diagram\/cdn/);
    expect(fs.existsSync(path.join(dir, 'ocr', 'ppocr', 'old.txt'))).toBe(true);
    expect(fs.existsSync(zip)).toBe(false);
  });

  it('Visual C++ Redistributable: ποια αρχεία λείπουν', () => {
    const system32 = appDir('sys');
    fs.writeFileSync(path.join(system32, 'msvcp140.dll'), '');
    fs.writeFileSync(path.join(system32, 'vcruntime140.dll'), '');
    expect(vcRuntimeMissing(system32)).toEqual(['msvcp140_1.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140_1.dll']);
  });
});
