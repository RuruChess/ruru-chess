/**
 * Βιβλίο σε βάση: ένα σκακιστικό βιβλίο σε PDF γίνεται νέα βάση της Βιβλιοθήκης, με όλες τις κινήσεις,
 * βαριάντες, υποβαριάντες, σχόλια και (προαιρετικά) βέλη για τα πλάνα και κύκλους για τις αδυναμίες.
 * Ανάγνωση (pdf.ts) → ανάλυση (core/bookparse.ts) → PGN σε προσωρινό αρχείο → εισαγωγή της Βιβλιοθήκης.
 *
 * Το PDF έρχεται ανεβασμένο από το παράθυρο (`/api/book/upload`: «Διάλεξε PDF…» με το παράθυρο αρχείων του
 * browser, ή σύρσιμο του αρχείου), όχι από διάλογο του PowerShell, που σε μερικούς υπολογιστές κολλούσε και
 * έμενε παγωμένος πάνω από όλα τα παράθυρα. Με διαδρομή στον δίσκο: `/api/book/import`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Router } from '../http.ts';
import { HttpError, type Library } from '../library.ts';
import type { BookStats, BookWarning } from '../../core/bookparse.ts';
import { bookVerdict, textWarning, type BookVerdict, type TextScan } from '../../core/bookquality.ts';
import { readPdfBook } from './pdf.ts';
import { parseWithBoards } from './pieces.ts';

export interface BookImport {
  id: string;
  /** η διαδρομή του PDF, ή μόνο το όνομά του όταν ανέβηκε από το παράθυρο */
  file: string;
  title: string;
  /** ocr: σελίδες χωρίς κείμενο ή με κείμενο-«σκουπίδια» διαβάζονται με το OCR των Windows (`page` από `pages`) */
  status: 'reading' | 'ocr' | 'parsing' | 'importing' | 'done' | 'error' | 'cancelled';
  page: number;
  pages: number;
  error?: string;
  stats?: BookStats;
  /** έγκαιρη ένδειξη από την ανάγνωση (πριν από το OCR και την ανάλυση): σκαναρισμένο ή με χαλασμένο κείμενο */
  early?: 'scanned' | 'garbled';
  /** ετυμηγορία ποιότητας μετά την ανάλυση (Καλή / Μερική / Πειραματική ανάγνωση) */
  verdict?: BookVerdict;
  /** κινήσεις που έμειναν ως κείμενο (σελίδα και απόσπασμα), οι πρώτες 300 */
  warnings?: BookWarning[];
  dbId?: string;
  /** η εργασία εισαγωγής της Βιβλιοθήκης (με τη δική της πρόοδο) */
  jobId?: string;
  started: number;
}

/** Το μεγαλύτερο PDF που δέχεται το ανέβασμα (τα βιβλία με κείμενο είναι συνήθως 5–100 MB). */
export const MAX_PDF = 512 * 1024 * 1024;

interface Options {
  title: string;
  author: string;
  year?: number;
  shapes: boolean;
}

type Job = BookImport & { abort: AbortController };

/** Όνομα αρχείου (και βάσης) από τον τίτλο του βιβλίου. */
function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*]|\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'Βιβλίο';
}

/** Ο προσωρινός φάκελος μιας εργασίας: το PDF που ανέβηκε (σβήνεται μόλις διαβαστεί) και το PGN για τη Βιβλιοθήκη. */
const jobDir = (id: string) => path.join(os.tmpdir(), 'knightbase-book', id);

/**
 * Προσωρινοί φάκελοι εργασιών που έμειναν: άδειοι μετά την εισαγωγή, ή με PDF από server που έκλεισε στη μέση της
 * ανάγνωσης. Όχι οι πρόσφατοι: μπορεί να τους χρησιμοποιεί άλλος server που τρέχει ταυτόχρονα.
 */
function removeStale(): void {
  const root = path.join(os.tmpdir(), 'knightbase-book');
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return; // δεν υπάρχει ακόμη ο φάκελος
  }
  for (const d of dirs) {
    try {
      const dir = path.join(root, d);
      if (Date.now() - fs.statSync(dir).mtimeMs > 3600_000) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* σε χρήση: την επόμενη φορά */
    }
  }
}

export function registerBooks(r: Router, lib: Library): void {
  const jobs = new Map<string, Job>();
  const pub = (j: BookImport & { abort?: AbortController }): BookImport => {
    const { abort: _abort, ...rest } = j;
    return rest;
  };
  const emit = (j: BookImport) => r.broadcast('bookImport', pub(j));
  const newId = () => crypto.randomUUID().slice(0, 8);
  const options = (get: (k: string) => unknown): Options => ({
    title: String(get('title') ?? '').trim(),
    author: String(get('author') ?? '').trim(),
    year: Number(get('year')) || undefined,
    shapes: get('shapes') === true || get('shapes') === '1',
  });
  removeStale();

  /** Η εργασία στο παρασκήνιο. `temp`: το PDF είναι αντίγραφο που ανέβηκε και σβήνεται μόλις διαβαστεί. */
  const start = (id: string, file: string, src: string, o: Options, temp: boolean): Job => {
    const j: Job = { id, file, title: o.title, status: 'reading', page: 0, pages: 0, started: Date.now(), abort: new AbortController() };
    jobs.set(j.id, j);
    void (async () => {
      try {
        let last = 0;
        const progress = (status: 'reading' | 'ocr') => (page: number, pages: number) => {
          j.status = status;
          j.page = page;
          j.pages = pages;
          if (Date.now() - last > 250) {
            last = Date.now();
            emit(j);
          }
        };
        let scan: TextScan | undefined;
        const onText = (s: TextScan) => {
          scan = s;
          const w = textWarning(s) ?? undefined;
          if (w !== j.early) {
            j.early = w;
            emit(j);
          }
        };
        const book = await readPdfBook(src, { signal: j.abort.signal, onPage: progress('reading'), onOcr: progress('ocr'), onText }).finally(() => temp && fs.rmSync(src, { force: true }));
        j.status = 'parsing';
        j.title ||= book.title || path.basename(file, path.extname(file));
        emit(j);
        // διαγράμματα-εικόνες: διόρθωση της αναγνώρισης από το κείμενο, σε δύο-τρία περάσματα
        const res = parseWithBoards(book.paragraphs, book.boards, { title: j.title, author: o.author || book.author, year: o.year, shapes: o.shapes });
        if (res.diagrams) Object.assign(res.stats, { diagrams: res.diagrams, verified: res.verified });
        if (book.ocrPages) res.stats.ocrPages = book.ocrPages;
        if (!res.games.length) {
          // σκαναρισμένο βιβλίο (σελίδες-εικόνες χωρίς κείμενο) ή κείμενο χωρίς κινήσεις σε μορφή που αναγνωρίζεται
          const chars = book.paragraphs.reduce((n, p) => n + p.text.length, 0);
          throw new Error(
            chars < book.pages * 20
              ? 'Το PDF δεν έχει κείμενο: οι σελίδες του είναι εικόνες (σκαναρισμένο βιβλίο) και το OCR των Windows δεν βρήκε κείμενο σε αυτές.'
              : 'Το PDF έχει κείμενο, αλλά δεν βρέθηκαν κινήσεις σκακιού σε μορφή που αναγνωρίζει το Ruru.',
          );
        }
        if (j.abort.signal.aborted) throw new Error('cancelled');
        j.stats = res.stats;
        j.warnings = res.warnings.slice(0, 300);
        j.verdict = bookVerdict(res.stats, book.pages, res.warnings, scan);
        // η βάση παίρνει το όνομα του αρχείου: PGN με το όνομα του βιβλίου στον φάκελο της εργασίας
        const dir = jobDir(j.id);
        fs.mkdirSync(dir, { recursive: true });
        const pgn = path.join(dir, `${safeName(j.title)}.pgn`);
        fs.writeFileSync(pgn, res.pgn, 'utf8');
        j.status = 'importing';
        const { entry, job } = lib.openFile(pgn, { removeSource: true, origin: 'book' });
        j.dbId = entry.id;
        j.jobId = job?.id;
        j.status = 'done';
        emit(j);
      } catch (e) {
        const msg = (e as Error).message;
        j.status = j.abort.signal.aborted || msg === 'cancelled' ? 'cancelled' : 'error';
        if (j.status === 'error') j.error = msg;
        fs.rmSync(jobDir(j.id), { recursive: true, force: true });
        emit(j);
      }
    })();
    return j;
  };

  r.get('/api/book/imports', () => ({ jobs: [...jobs.values()].map(pub) }));

  // ?name=&title=&author=&year=&shapes=0|1, σώμα: τα bytes του PDF (Content-Type: application/pdf)
  r.post(
    '/api/book/upload',
    async (req) => {
      // μόνο application/pdf: ένα αίτημα από ξένη ιστοσελίδα με text/plain δεν περνά (θα ήθελε έλεγχο CORS)
      if (!/^application\/pdf\b/i.test(String(req.raw.headers['content-type'] ?? ''))) throw new HttpError(415, 'Χρειάζεται αρχείο PDF');
      const tooBig = () => new HttpError(413, `Το PDF είναι πολύ μεγάλο (το όριο είναι ${MAX_PDF / 1024 / 1024} MB)`);
      if (Number(req.raw.headers['content-length'] ?? 0) > MAX_PDF) throw tooBig();
      const name = path.basename(String(req.query.get('name') ?? '').replace(/[\\/]/g, path.sep)).trim() || 'Βιβλίο.pdf';
      const id = newId();
      const dir = jobDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const src = path.join(dir, 'book.pdf');
      let size = 0;
      let head = Buffer.alloc(0);
      try {
        await pipeline(
          req.raw,
          new Transform({
            transform(chunk: Buffer, _enc, done) {
              size += chunk.length;
              if (size > MAX_PDF) return done(tooBig());
              if (head.length < 1024) head = Buffer.concat([head, chunk.subarray(0, 1024 - head.length)]);
              done(null, chunk);
            },
          }),
          fs.createWriteStream(src),
        );
        // η κεφαλίδα «%PDF-» είναι στα πρώτα 1024 bytes
        if (!head.includes('%PDF-')) throw new HttpError(400, 'Το αρχείο δεν είναι PDF');
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, 'Το ανέβασμα του PDF διακόπηκε');
      }
      return { job: pub(start(id, name, src, options((k) => req.query.get(k) ?? undefined), true)) };
    },
    { stream: true },
  );

  r.post('/api/book/import', (req) => {
    const file = path.resolve(String(req.body?.file ?? ''));
    if (!req.body?.file || !fs.existsSync(file)) throw new HttpError(404, 'Δεν βρέθηκε το αρχείο');
    if (path.extname(file).toLowerCase() !== '.pdf') throw new HttpError(400, 'Χρειάζεται αρχείο PDF');
    if ([...jobs.values()].some((j) => j.file.toLowerCase() === file.toLowerCase() && ['reading', 'ocr', 'parsing', 'importing'].includes(j.status))) {
      throw new HttpError(409, 'Το βιβλίο αυτό διαβάζεται ήδη');
    }
    return { job: pub(start(newId(), file, file, options((k) => req.body?.[k]), false)) };
  });

  r.post('/api/book/:id/cancel', (req) => {
    const j = jobs.get(req.params.id);
    if (!j) throw new HttpError(404, 'Δεν βρέθηκε η εργασία');
    j.abort.abort();
    return { ok: true };
  });

  r.post('/api/book/:id/forget', (req) => {
    jobs.delete(req.params.id);
    return { ok: true };
  });
}
