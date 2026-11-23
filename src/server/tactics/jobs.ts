/** Εργασίες εισαγωγής της Τακτικής: ουρά (μία τη φορά), πρόοδος με SSE «tactics», ακύρωση, συνέχιση λήψεων, έλεγχος δίσκου. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../library.ts';
import { VERSION } from '../about.ts';

export const USER_AGENT = `RuruChess/${VERSION} (local chess app)`;
/** Ελάχιστος ελεύθερος χώρος που αφήνει πάντα μια εισαγωγή (απόφαση χρήστη: 5 GB). */
export const MIN_FREE_BYTES = Number(process.env.REALCHESSBASE_MIN_FREE_GB ?? 5) * 1024 ** 3;

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface TacticsJob {
  id: string;
  /** κλειδί πηγής (π.χ. lichess, lucas-auerswald) */
  source: string;
  title: string;
  status: JobStatus;
  /** φάση: download | import | index | finish */
  phase: string;
  message?: string;
  /** πρόοδος της τρέχουσας φάσης */
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
  /** puzzles που μπήκαν/ενημερώθηκαν */
  imported: number;
  /** απορρίφθηκαν από την επικύρωση */
  rejected: number;
  /** εκτός φίλτρου ποιότητας */
  filtered: number;
  started: number;
  finished?: number;
  error?: string;
  /** αναφορά στο τέλος (μετρήσεις, χρόνοι, λόγοι απόρριψης) */
  report?: Record<string, unknown>;
}

export interface JobContext {
  job: TacticsJob;
  signal: AbortSignal;
  /** ενημέρωση προόδου (στέλνεται με SSE το πολύ κάθε 250 ms) */
  progress: (patch: Partial<TacticsJob>) => void;
}

type Work = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

interface Entry {
  job: TacticsJob;
  abort: AbortController;
  work: Work;
}

/** Ουρά εργασιών: οι εισαγωγές τρέχουν μία μία (ευγένεια προς τους servers, μία εγγραφή στη βάση). */
export class JobQueue {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private running: Entry | null = null;
  private lastSent = 0;
  private timer: NodeJS.Timeout | null = null;
  /** ειδοποίηση SSE (event «tactics») */
  onUpdate: (job: TacticsJob) => void = () => {};
  /** αρχή/τέλος εργασίας (π.χ. για να μην κλείσει ο server όσο τρέχει) */
  onActive: (job: TacticsJob, active: boolean) => void = () => {};

  list(): TacticsJob[] {
    return [...this.entries.values()].map((e) => e.job).sort((a, b) => b.started - a.started);
  }

  get(id: string): TacticsJob | undefined {
    return this.entries.get(id)?.job;
  }

  /** Τρέχουσα ή σε αναμονή εργασία μιας πηγής. */
  active(source: string): TacticsJob | undefined {
    for (const e of this.entries.values()) if (e.job.source === source && (e.job.status === 'running' || e.job.status === 'queued')) return e.job;
    return undefined;
  }

  get busy(): boolean {
    return this.running !== null || this.queue.length > 0;
  }

  enqueue(source: string, title: string, work: Work): TacticsJob {
    const existing = this.active(source);
    if (existing) return existing;
    const job: TacticsJob = {
      id: crypto.randomUUID(),
      source,
      title,
      status: 'queued',
      phase: 'queued',
      done: 0,
      total: 0,
      bytes: 0,
      totalBytes: 0,
      imported: 0,
      rejected: 0,
      filtered: 0,
      started: Date.now(),
    };
    const e: Entry = { job, abort: new AbortController(), work };
    this.entries.set(job.id, e);
    // κρατάμε το ιστορικό μικρό
    if (this.entries.size > 60) {
      for (const [id, x] of this.entries) {
        if (x.job.status !== 'running' && x.job.status !== 'queued') {
          this.entries.delete(id);
          break;
        }
      }
    }
    this.queue.push(e);
    this.send(job, true);
    void this.pump();
    return job;
  }

  cancel(id: string): TacticsJob {
    const e = this.entries.get(id);
    if (!e) throw new HttpError(404, 'Δεν βρέθηκε η εργασία');
    if (e.job.status === 'queued') {
      this.queue = this.queue.filter((x) => x !== e);
      e.job.status = 'cancelled';
      e.job.finished = Date.now();
      this.send(e.job, true);
    } else if (e.job.status === 'running') {
      e.abort.abort();
    }
    return e.job;
  }

  /** Ακύρωση όλων (τερματισμός server). */
  cancelAll(): void {
    for (const e of this.entries.values()) if (e.job.status === 'running' || e.job.status === 'queued') this.cancel(e.job.id);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const e = this.queue.shift();
    if (!e) return;
    this.running = e;
    const job = e.job;
    job.status = 'running';
    job.phase = 'start';
    this.onActive(job, true);
    this.send(job, true);
    const ctx: JobContext = {
      job,
      signal: e.abort.signal,
      progress: (patch) => {
        Object.assign(job, patch);
        this.send(job, false);
      },
    };
    try {
      const report = await e.work(ctx);
      if (report) job.report = report;
      job.status = e.abort.signal.aborted ? 'cancelled' : 'done';
    } catch (err) {
      job.status = e.abort.signal.aborted ? 'cancelled' : 'error';
      if (job.status === 'error') {
        job.error = (err as Error).message;
        console.error('Τακτική:', err);
      }
    }
    job.finished = Date.now();
    job.phase = job.status;
    this.running = null;
    this.onActive(job, false);
    this.send(job, true);
    void this.pump();
  }

  private send(job: TacticsJob, force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastSent < 250) {
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.lastSent = Date.now();
          this.onUpdate({ ...job });
        }, 250);
      }
      return;
    }
    this.lastSent = now;
    this.onUpdate({ ...job });
  }
}

/** Ελεύθερος χώρος στον δίσκο του φακέλου. */
export function freeBytes(dir: string): number {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Σφάλμα αν μετά από `need` bytes ο ελεύθερος χώρος πέφτει κάτω από το όριο. */
export function ensureDisk(dir: string, need: number): void {
  const free = freeBytes(dir);
  if (free - need < MIN_FREE_BYTES) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    throw new HttpError(507, `Δεν υπάρχει αρκετός χώρος: ελεύθερα ${gb(free)} GB, χρειάζονται ${gb(need)} GB και πρέπει να μείνουν ${gb(MIN_FREE_BYTES)} GB`);
  }
}

// ---------------------------------------------------------------------------
// Δίκτυο: ένα αίτημα τη φορά ανά server, με αναμονή σε 429

const hostQueues = new Map<string, Promise<unknown>>();

/** fetch με User-Agent, σειριακά ανά host, με επανάληψη σε 429/5xx (έως 3 φορές). */
export async function politeFetch(url: string, init: RequestInit & { signal?: AbortSignal } = {}, opts: { gapMs?: number } = {}): Promise<Response> {
  const host = new URL(url).host;
  const prev = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  hostQueues.set(
    host,
    prev.then(() => mine),
  );
  await prev.catch(() => {});
  try {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) } });
      if ((r.status === 429 || r.status >= 500) && attempt < 3) {
        await r.body?.cancel().catch(() => {});
        // το Lichess ζητά ένα λεπτό αναμονής μετά από 429
        await sleep(r.status === 429 ? 60_000 : 5_000 * (attempt + 1), init.signal);
        continue;
      }
      return r;
    }
  } finally {
    // κενό ανάμεσα στα αιτήματα προς τον ίδιο server (το API του Lichess απαντά 429 σε γρήγορα συνεχόμενα αιτήματα)
    setTimeout(release, opts.gapMs ?? (host === 'lichess.org' ? 3000 : 600));
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Ακυρώθηκε'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('Ακυρώθηκε'));
      },
      { once: true },
    );
  });
}

/** Κείμενο από URL (μικρά αρχεία: συλλογές, PGN, EPD). */
export async function fetchText(url: string, signal?: AbortSignal, opts: { latin1Fallback?: boolean } = {}): Promise<string> {
  const r = await politeFetch(url, { signal });
  if (!r.ok) throw new Error(`Λήψη ${url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (opts.latin1Fallback) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return buf.toString('latin1');
    }
  }
  return buf.toString('utf8');
}

interface PartInfo {
  url: string;
  etag: string | null;
  lastModified: string | null;
  total: number;
}

export interface DownloadResult {
  file: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
  resumed: boolean;
}

/**
 * Λήψη με συνέχιση: γράφει στο `<dest>.part` (με `<dest>.part.json` για το ETag) και στο τέλος
 * μετονομάζει. Μετά από διακοπή συνεχίζει με Range/If-Range· αν το αρχείο άλλαξε στον server, ξεκινά από την αρχή.
 */
export async function downloadResumable(
  url: string,
  dest: string,
  opts: { signal: AbortSignal; onProgress?: (bytes: number, total: number) => void },
): Promise<DownloadResult> {
  const part = dest + '.part';
  const infoFile = part + '.json';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let info: PartInfo | null = null;
  try {
    info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as PartInfo;
  } catch {
    info = null;
  }
  let have = 0;
  if (info && info.url === url && fs.existsSync(part)) have = fs.statSync(part).size;
  else fs.rmSync(part, { force: true });
  const headers: Record<string, string> = {};
  if (have > 0) {
    headers.Range = `bytes=${have}-`;
    const validator = info?.etag ?? info?.lastModified;
    if (validator) headers['If-Range'] = validator;
  }
  const r = await politeFetch(url, { headers, signal: opts.signal });
  if (r.status === 416 && info && have >= info.total && info.total > 0) {
    await r.body?.cancel().catch(() => {});
    fs.renameSync(part, dest);
    fs.rmSync(infoFile, { force: true });
    return { file: dest, size: have, etag: info.etag, lastModified: info.lastModified, resumed: true };
  }
  if (!r.ok || !r.body) throw new Error(`Λήψη ${url}: HTTP ${r.status}`);
  const resumed = r.status === 206;
  if (!resumed) have = 0;
  const etag = r.headers.get('etag');
  const lastModified = r.headers.get('last-modified');
  const len = Number(r.headers.get('content-length') ?? 0);
  const total = resumed ? Number(/\/(\d+)$/.exec(r.headers.get('content-range') ?? '')?.[1] ?? have + len) : len;
  ensureDisk(path.dirname(dest), Math.max(0, total - have) + total * 4);
  fs.writeFileSync(infoFile, JSON.stringify({ url, etag, lastModified, total } satisfies PartInfo));
  const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
  let bytes = have;
  let lastReport = 0;
  const body = Readable.fromWeb(r.body as import('node:stream/web').ReadableStream<Uint8Array>);
  body.on('data', (c: Buffer) => {
    bytes += c.length;
    const now = Date.now();
    if (now - lastReport > 250) {
      lastReport = now;
      opts.onProgress?.(bytes, total);
    }
  });
  const abort = () => body.destroy(new Error('Ακυρώθηκε'));
  opts.signal.addEventListener('abort', abort, { once: true });
  try {
    await pipeline(body, out);
  } finally {
    opts.signal.removeEventListener('abort', abort);
  }
  if (opts.signal.aborted) throw new Error('Ακυρώθηκε');
  const size = fs.statSync(part).size;
  if (total && size !== total) throw new Error(`Ελλιπής λήψη (${size} από ${total} bytes)· ξαναδοκίμασε για συνέχιση`);
  opts.onProgress?.(size, total);
  fs.renameSync(part, dest);
  fs.rmSync(infoFile, { force: true });
  return { file: dest, size, etag, lastModified, resumed };
}

/** Πληροφορίες αρχείου στον server (HEAD) χωρίς λήψη. */
export async function remoteInfo(url: string, signal?: AbortSignal): Promise<{ size: number; etag: string | null; lastModified: string | null }> {
  const r = await politeFetch(url, { method: 'HEAD', signal });
  if (!r.ok) throw new Error(`HEAD ${url}: HTTP ${r.status}`);
  return { size: Number(r.headers.get('content-length') ?? 0), etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified') };
}
