/**
 * «Δικοί μου ήχοι»: ο χρήστης διαλέγει ένα αρχείο ήχου για κίνηση, αιχμαλωσία, σαχ και ματ (Ρυθμίσεις → Ήχος).
 * Τα αρχεία μένουν στο <φάκελος εφαρμογής>\sounds (<είδος>.bin + <είδος>.type με τον τύπο τους).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { HANDLED, type Router } from './http.ts';
import { HttpError } from './library.ts';
import { APP_DIR } from './paths.ts';

const KINDS = new Set(['move', 'capture', 'check', 'mate']);
const MAX = 2 * 1024 * 1024;
const DIR = path.join(APP_DIR, 'sounds');

function kindOf(k: string): string {
  if (!KINDS.has(k)) throw new HttpError(404, 'Άγνωστος ήχος');
  return k;
}

export function registerSounds(r: Router): void {
  r.post(
    '/api/sounds/custom/:kind',
    async (req) => {
      const kind = kindOf(req.params.kind);
      // μόνο audio/*: ένα αίτημα από ξένη σελίδα με text/plain δεν περνά
      const type = String(req.raw.headers['content-type'] ?? '');
      if (!/^audio\/[\w.+-]+$/i.test(type)) throw new HttpError(415, 'Χρειάζεται αρχείο ήχου (mp3, wav, ogg)');
      const tooBig = () => new HttpError(413, `Το αρχείο ήχου είναι πολύ μεγάλο (το όριο είναι ${MAX / 1024 / 1024} MB)`);
      if (Number(req.raw.headers['content-length'] ?? 0) > MAX) throw tooBig();
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = path.join(DIR, `${kind}.tmp`);
      let size = 0;
      try {
        await pipeline(
          req.raw,
          new Transform({
            transform(chunk: Buffer, _enc, done) {
              size += chunk.length;
              done(size > MAX ? tooBig() : null, chunk);
            },
          }),
          fs.createWriteStream(tmp),
        );
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, 'Το ανέβασμα του ήχου διακόπηκε');
      }
      if (!size) {
        fs.rmSync(tmp, { force: true });
        throw new HttpError(400, 'Το αρχείο ήχου είναι άδειο');
      }
      fs.renameSync(tmp, path.join(DIR, `${kind}.bin`));
      fs.writeFileSync(path.join(DIR, `${kind}.type`), type);
      return { ok: true, version: Date.now() };
    },
    { stream: true },
  );

  r.get('/api/sounds/custom/:kind', (req) => {
    const kind = kindOf(req.params.kind);
    const file = path.join(DIR, `${kind}.bin`);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Δεν υπάρχει ήχος');
    let type = 'application/octet-stream';
    try {
      type = fs.readFileSync(path.join(DIR, `${kind}.type`), 'utf8').trim() || type;
    } catch {
      // χωρίς τύπο: ο browser αναγνωρίζει τον ήχο από τα bytes
    }
    req.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    req.res.end(fs.readFileSync(file));
    return HANDLED;
  });

  r.del('/api/sounds/custom/:kind', (req) => {
    const kind = kindOf(req.params.kind);
    for (const ext of ['bin', 'type']) fs.rmSync(path.join(DIR, `${kind}.${ext}`), { force: true });
    return { ok: true };
  });
}
