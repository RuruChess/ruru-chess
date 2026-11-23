/** Εισαγωγή της βάσης puzzles του Lichess: λήψη με συνέχιση, αποσυμπίεση ανά frame σε workers, επικύρωση, upsert σε worker εγγραφής, ευρετήρια. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Histogram, monitorEventLoopDelay } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';
import { dbTask, refreshCountsAsync, saveSource } from './catalog.ts';
import type { Tactics } from './context.ts';
import { type ColumnMap, type QualityFilter, parseHeader, qualityFrom, QUALITY_PRESETS } from './csv.ts';
import { downloadResumable, ensureDisk, type JobContext, remoteInfo } from './jobs.ts';
import { batchTransfer, emptyStats, type FrameResult, IMPORT_STATE_KEY, type ImportState, sumRejected } from './lichessRows.ts';
import type { WriterInit, WriterReply, WriterRequest } from './lichessWriter.ts';
import { F_INACTIVE, F_STALE } from './store.ts';
import { SOURCE_BY_KEY } from './sources.ts';
import { themeBits } from './themes.ts';
import { type FrameInfo, fileFrames, readFrame } from './zstd.ts';

export const LICHESS_PUZZLE_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const WORKER_URL = new URL('./lichessWorker.ts', import.meta.url);
const WRITER_URL = new URL('./lichessWriter.ts', import.meta.url);
const zstdDecompress = promisify(zlib.zstdDecompress);

/** Ο worker εγγραφής από την πλευρά του κύριου νήματος: ένα αίτημα τη φορά, απάντηση ως υπόσχεση. */
class WriterClient {
  private w: Worker;
  private waiting: { resolve: (r: WriterReply) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;
  private closed = false;

  constructor(init: WriterInit) {
    this.w = new Worker(WRITER_URL, { workerData: init });
    this.w.on('message', (m: WriterReply) => {
      const x = this.waiting;
      this.waiting = null;
      if (m.type === 'error') x?.reject(new Error(m.error));
      else x?.resolve(m);
    });
    this.w.on('error', (e: Error) => this.fail(e));
    this.w.on('exit', (code) => this.fail(new Error(`Ο worker εγγραφής τερμάτισε (${code})`)));
  }

  private fail(e: Error): void {
    this.failure ??= e;
    const x = this.waiting;
    this.waiting = null;
    x?.reject(e);
  }

  request(msg: WriterRequest, transfer?: ArrayBuffer[]): Promise<WriterReply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.w.postMessage(msg, transfer);
    });
  }

  /** Κλείνει τη σύνδεση του worker (καμία συναλλαγή δεν μένει ανοιχτή) και τον τερματίζει. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.failure) await this.request({ type: 'close' }).catch(() => undefined);
    await this.w.terminate();
  }
}

export interface LichessImportOptions {
  quality?: unknown;
  /** ξανά εισαγωγή ακόμη κι αν η έκδοση δεν άλλαξε */
  force?: boolean;
  /** τοπικό αρχείο .csv.zst (χωρίς λήψη· για δοκιμές) */
  file?: string;
  /** να μη σβηστεί το αρχείο μετά την εισαγωγή */
  keepArchive?: boolean;
  /** πλήθος workers (προεπιλογή: πυρήνες − 2, έως 8) */
  workers?: number;
}

const STATE_KEY = IMPORT_STATE_KEY;
const DROP_INDEXES = 'DROP INDEX IF EXISTS ix_puzzle_rating; DROP INDEX IF EXISTS ix_puzzle_opening; DROP INDEX IF EXISTS ix_puzzle_source;';

/** Πόσα puzzles του Lichess υπάρχουν ήδη στη βάση. */
function hasLichess(t: Tactics): boolean {
  return !!t.puzzles.prep('SELECT 1 FROM puzzle WHERE source_id = 1 LIMIT 1').get();
}

export async function importLichess(t: Tactics, ctx: JobContext, opts: LichessImportOptions = {}): Promise<Record<string, unknown>> {
  const db = t.puzzles;
  const { key: qKey, filter } = qualityFrom(opts.quality ?? 'default');
  const t0 = Date.now();
  let state = db.getJson<ImportState>(STATE_KEY);
  let archive = opts.file ?? path.join(t.downloadsDir, 'lichess_db_puzzle.csv.zst');
  let version = opts.file ? `file:${fs.statSync(opts.file).size}:${Math.round(fs.statSync(opts.file).mtimeMs)}` : '';
  let downloadMs = 0;
  if (!opts.file) {
    ctx.progress({ phase: 'download', message: 'Έλεγχος για νέα έκδοση' });
    const remote = await remoteInfo(LICHESS_PUZZLE_URL, ctx.signal);
    version = remote.lastModified ?? remote.etag ?? '';
    const current = db.prep('SELECT version, info FROM source WHERE id = 1').get() as { version: string | null; info: string | null } | undefined;
    const sameQuality = current?.info ? (JSON.parse(current.info) as { quality?: string }).quality === qKey : false;
    if (!state && !opts.force && current?.version === version && sameQuality && hasLichess(t)) {
      return { upToDate: true, version, quality: qKey };
    }
    const haveArchive = fs.existsSync(archive) && fs.statSync(archive).size === remote.size;
    if (!haveArchive) {
      ensureDisk(t.dir, remote.size + (QUALITY_PRESETS[qKey]?.mb ?? 600) * 1024 * 1024 * 2.5);
      const td = Date.now();
      ctx.progress({ phase: 'download', message: 'Λήψη των puzzles', bytes: 0, totalBytes: remote.size });
      const r = await downloadResumable(LICHESS_PUZZLE_URL, archive, {
        signal: ctx.signal,
        onProgress: (bytes, total) => ctx.progress({ phase: 'download', bytes, totalBytes: total }),
      });
      archive = r.file;
      downloadMs = Date.now() - td;
    }
  }
  if (state && (state.version !== version || state.quality !== qKey)) {
    // άλλη έκδοση (ή άλλο τοπικό αρχείο) ή άλλο φίλτρο: η μισή εισαγωγή ξεκινά από την αρχή (τα puzzles μένουν, θα ενημερωθούν)
    state = null;
    db.setJson(STATE_KEY, null);
  }
  const archiveSize = fs.statSync(archive).size;
  // η βάση και ο WAL της (μεγαλώνει ως το μέγεθος της βάσης μέχρι το checkpoint του τέλους)
  ensureDisk(t.dir, (QUALITY_PRESETS[qKey]?.mb ?? 600) * 1024 * 1024 * 2.5);

  // Χωρίς αυτόματο checkpoint όσο γράφει το κύριο νήμα: αλλιώς κάθε COMMIT αντιγράφει τον WAL στη
  // βάση με fsync (παγώματα 1–2 s του server). Το checkpoint γίνεται σε worker (ευρετήρια, τέλος).
  db.db.exec('PRAGMA wal_autocheckpoint=0');
  // πόσο «παγώνει» το κύριο νήμα (άρα ο server) όσο τρέχει η εισαγωγή
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  try {
    return await importArchive(t, ctx, { archive, archiveSize, version, qKey, filter, state, downloadMs, t0, keepArchive: !!opts.file || !!opts.keepArchive, workers: opts.workers, lag });
  } finally {
    lag.disable();
    await dbTask(db.file, 'checkpoint').catch(() => undefined);
    db.db.exec('PRAGMA wal_autocheckpoint=1000');
  }
}

interface ArchiveImport {
  archive: string;
  archiveSize: number;
  version: string;
  qKey: string;
  filter: QualityFilter;
  state: ImportState | null;
  downloadMs: number;
  t0: number;
  keepArchive: boolean;
  workers?: number;
  lag: Histogram;
}

/** Η εισαγωγή του (ήδη τοπικού) αρχείου: frames σε workers, εγγραφή, καθάρισμα, ευρετήρια, μετρήσεις. */
async function importArchive(t: Tactics, ctx: JobContext, a: ArchiveImport): Promise<Record<string, unknown>> {
  const db = t.puzzles;
  const { archive } = a;

  // κεφαλίδα του CSV από το πρώτο frame (αποσυμπίεση εκτός κύριου νήματος)
  const firstFrame = fileFrames(archive).next().value as FrameInfo | undefined;
  if (!firstFrame) throw new Error('Κενό αρχείο puzzles');
  const firstText = (await zstdDecompress(readFrame(archive, firstFrame))).toString('utf8', 0, 4096);
  const cols = parseHeader(firstText.slice(0, firstText.indexOf('\n')));

  // Από εδώ τα ευρετήρια σβήνονται (γρηγορότερη εγγραφή). Σε ακύρωση ή σφάλμα ξαναφτιάχνονται
  // πριν τελειώσει η εργασία· αλλιώς κάθε επιλογή puzzle θα σάρωνε όλο τον πίνακα (~0,6 s) ως τη συνέχιση.
  const done = { indexed: false };
  try {
    return await writeArchive(t, ctx, a, cols, done);
  } catch (e) {
    if (!done.indexed) {
      ctx.progress({ phase: 'index', message: 'Επαναφορά ευρετηρίων (η εισαγωγή συνεχίζει αργότερα από το ίδιο σημείο)' });
      await dbTask(db.file, 'indexes').catch((err: unknown) => console.error('Τακτική: επαναφορά ευρετηρίων', err));
      t.puzzlesChanged();
    }
    throw e;
  }
}

/**
 * Προετοιμασία, frames (ανάγνωση στους workers, εγγραφή στον worker εγγραφής), καθάρισμα, ευρετήρια,
 * μετρήσεις και αναφορά. Το `done.indexed` γίνεται true μόλις ξαναφτιαχτούν τα ευρετήρια.
 */
async function writeArchive(t: Tactics, ctx: JobContext, a: ArchiveImport, cols: ColumnMap, done: { indexed: boolean }): Promise<Record<string, unknown>> {
  const db = t.puzzles;
  const def = SOURCE_BY_KEY.get('lichess')!;
  const { archive, archiveSize, version, qKey, filter, downloadMs, t0, lag } = a;
  let state = a.state;
  // οι μαζικές εντολές σε όλο τον πίνακα τρέχουν σε worker (ο server απαντά στο μεταξύ)
  const tp = Date.now();
  if (!state || state.archiveSize !== archiveSize) {
    const fresh = !hasLichess(t);
    state = { version, quality: qKey, filter, archiveSize, nextOffset: 0, frames: 0, carry: '', fresh, stats: emptyStats(), started: Date.now(), workMs: 0 };
    ctx.progress({ phase: 'import', message: 'Προετοιμασία της βάσης' });
    await dbTask(db.file, 'exec', DROP_INDEXES);
    if (!fresh) await dbTask(db.file, 'exec', `UPDATE puzzle SET flags = flags | ${F_STALE} WHERE source_id = 1`);
    db.setJson(STATE_KEY, state);
  } else {
    await dbTask(db.file, 'exec', DROP_INDEXES);
  }
  const prepareMs = Date.now() - tp;
  let st: ImportState = state;
  const resumedAt = st.frames;
  const frames = [...fileFrames(archive, st.nextOffset)];
  const totalFrames = st.frames + frames.length;
  ctx.progress({ phase: 'import', done: st.frames, total: totalFrames, imported: st.stats.accepted, rejected: sumRejected(st.stats), filtered: st.stats.filtered, message: resumedAt ? `Συνέχεια από το frame ${resumedAt + 1}` : 'Εισαγωγή' });

  const bits = themeBits();
  const nWorkers = Math.max(1, Math.min(a.workers ?? 8, os.availableParallelism() - 2));
  const workers: Worker[] = [];
  const idle: Worker[] = [];
  const pending = new Map<number, FrameResult>();
  const waiters = new Map<number, (r: FrameResult) => void>();
  let failure: Error | null = null;
  const onResult = (w: Worker) => (r: FrameResult) => {
    idle.push(w);
    const f = waiters.get(r.index);
    if (f) {
      waiters.delete(r.index);
      f(r);
    } else pending.set(r.index, r);
    feed();
  };
  for (let k = 0; k < Math.min(nWorkers, frames.length); k++) {
    const w = new Worker(WORKER_URL, { workerData: { file: archive, cols, quality: filter, bits } satisfies { file: string; cols: ColumnMap; quality: QualityFilter; bits: Record<string, number> } });
    w.on('message', onResult(w));
    w.on('error', (e: Error) => (failure = e));
    workers.push(w);
    idle.push(w);
  }
  // η εγγραφή στη βάση (εντολές SQLite και COMMIT) γίνεται σε δικό της worker, όχι στο κύριο νήμα
  const writer = new WriterClient({ file: db.file, cols, quality: filter, bits, state: st });
  let nextSend = 0;
  let nextWrite = 0;
  const maxAhead = nWorkers + 2;
  function feed(): void {
    while (idle.length && nextSend < frames.length && nextSend - nextWrite < maxAhead && !ctx.signal.aborted) {
      const w = idle.pop()!;
      const f = frames[nextSend];
      // ο worker διαβάζει μόνος του το frame από το αρχείο
      w.postMessage({ index: nextSend, offset: f.offset, length: f.length });
      nextSend++;
    }
  }
  const result = (i: number): Promise<FrameResult> => {
    const r = pending.get(i);
    if (r) {
      pending.delete(i);
      return Promise.resolve(r);
    }
    return new Promise((resolve, reject) => {
      waiters.set(i, resolve);
      const check = setInterval(() => {
        if (failure || ctx.signal.aborted) {
          clearInterval(check);
          waiters.delete(i);
          reject(failure ?? new Error('Ακυρώθηκε'));
        }
        if (!waiters.has(i)) clearInterval(check);
      }, 200);
    });
  };

  let decompressMs = 0;
  let processMs = 0;
  let writeMs = 0;
  const commits: number[] = [];
  try {
    feed();
    for (let i = 0; i < frames.length; i++) {
      const r = await result(i);
      nextWrite = i + 1;
      feed();
      if (r.error || !r.batch || !r.stats) throw new Error(`Frame ${st.frames + i + 1}: ${r.error ?? 'άγνωστο σφάλμα'}`);
      decompressMs += r.msDecompress ?? 0;
      processMs += r.msProcess ?? 0;
      // ένα frame ανά συναλλαγή, μαζί με την κατάσταση συνέχισης (στον worker εγγραφής)
      const w = await writer.request({ type: 'frame', offset: frames[i].offset, length: frames[i].length, frame: r }, batchTransfer(r.batch));
      writeMs += w.writeMs ?? 0;
      commits.push(w.commitMs ?? 0);
      ctx.progress({ phase: 'import', done: w.frames, total: totalFrames, imported: w.accepted, rejected: w.rejected, filtered: w.filtered, message: `Frame ${w.frames}/${totalFrames}` });
      if (ctx.signal.aborted) throw new Error('Ακυρώθηκε');
    }
    // τελευταία γραμμή χωρίς αλλαγή γραμμής στο τέλος του αρχείου
    st = (await writer.request({ type: 'finish' })).state ?? st;
  } finally {
    await Promise.all([...workers.map((w) => w.terminate()), writer.close()]);
  }

  // τέλος: όσα δεν ήρθαν ξανά σβήνονται, εκτός αν τα έχει δει ο χρήστης (τότε μένουν ανενεργά)
  ctx.progress({ phase: 'finish', message: 'Καθάρισμα παλιών puzzles' });
  let removed = 0;
  let deactivated = 0;
  if (!st.fresh) {
    // μαζικά, σε worker: από «όλα» σε «προτεινόμενο» φεύγουν ~1,7 εκατ. puzzles
    const referenced = JSON.stringify([...t.user.referencedIds()]);
    deactivated = (await dbTask(db.file, 'exec', `UPDATE puzzle SET flags = (flags & ~${F_STALE}) | ${F_INACTIVE} WHERE source_id = 1 AND (flags & ${F_STALE}) != 0 AND id IN (SELECT value FROM json_each(?))`, [referenced])).changes ?? 0;
    removed = (await dbTask(db.file, 'exec', `DELETE FROM puzzle WHERE source_id = 1 AND (flags & ${F_STALE}) != 0`, [])).changes ?? 0;
  }
  ctx.progress({ phase: 'index', message: 'Ευρετήρια επιλογής' });
  const ti = Date.now();
  await dbTask(db.file, 'indexes');
  done.indexed = true;
  const indexMs = Date.now() - ti;
  ctx.progress({ phase: 'finish', message: 'Μετρήσεις θεμάτων και ανοιγμάτων' });
  const counts = await refreshCountsAsync(db);
  const n = Number((await dbTask(db.file, 'all', `SELECT count(*) FROM puzzle WHERE source_id = 1 AND (flags & ${F_INACTIVE}) = 0`)).rows?.[0]?.[0] ?? 0);
  const report = {
    version,
    quality: qKey,
    filter,
    lines: st.stats.lines,
    imported: st.stats.accepted,
    filtered: st.stats.filtered,
    rejected: st.stats.rejected,
    rejectedTotal: sumRejected(st.stats),
    samples: st.stats.samples,
    unknownThemes: st.stats.unknownThemes,
    mateLengthMismatch: st.stats.mateLengthMismatch,
    urlOrientation: st.stats.urlOrientation,
    removed,
    deactivated,
    active: n,
    resumedAtFrame: resumedAt || undefined,
    frames: totalFrames,
    archiveBytes: archiveSize,
    ms: { total: Date.now() - t0, download: downloadMs, prepare: prepareMs, import: st.workMs, decompressCpu: Math.round(decompressMs), parseValidateCpu: Math.round(processMs), write: writeMs, index: indexMs, counts: counts.ms },
    /** καθυστέρηση του event loop του server στη διάρκεια (p99/μέγιστη) και το πιο αργό COMMIT */
    mainThread: { lagP99Ms: Math.round(lag.percentile(99) / 1e6), lagMaxMs: Math.round(lag.max / 1e6), commitMaxMs: Math.max(0, ...commits), commitsMs: commits },
  };
  saveSource(db, def, { version, n, info: { quality: qKey, filter, report: { ...report, samples: undefined } } });
  db.setJson(STATE_KEY, null);
  if (!a.keepArchive) fs.rmSync(archive, { force: true });
  t.puzzlesChanged();
  return report;
}

/** Υπάρχει εισαγωγή του Lichess που διακόπηκε; (για την οθόνη πηγών: «συνέχεια») */
export function interruptedLichess(t: Tactics): { frames: number; imported: number; version: string; quality: string } | null {
  const s = t.puzzles.getJson<ImportState>(STATE_KEY);
  return s ? { frames: s.frames, imported: s.stats.accepted, version: s.version, quality: s.quality } : null;
}
