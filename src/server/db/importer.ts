/**
 * Εισαγωγή αρχείων στη βάση του Ruru: PGN (και μέσα σε .7z/.zip) και
 * ChessBase .cbh. Η ανάλυση γίνεται παράλληλα σε workers· η εγγραφή στη βάση
 * και στο ευρετήριο θέσεων γίνεται εδώ, με τη σειρά του αρχείου.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import type { Readable } from 'node:stream';
import sevenBin from '7zip-bin';
import { GameDatabase } from './store.ts';
import { IndexBuilder, createGameInfo, growGameInfo, type GameInfo } from './posindex.ts';
import type { BatchResult } from './importWorker.ts';
import { CbhDatabase } from '../formats/cbh.ts';
import { ScidDatabase } from '../formats/scid.ts';
import { parseElo, parsePgnDate, parseResult } from '../text.ts';

export interface ImportProgress {
  phase: 'reading' | 'indexing' | 'done' | 'error' | 'cancelled';
  games: number;
  bytes: number;
  totalBytes: number;
  errors: number;
  skipped: number;
  message?: string;
  /** εισαγωγή σε βάση με παρτίδες: πρώτα οι παλιές ξαναπερνούν στο ευρετήριο θέσεων */
  existing?: { done: number; total: number };
}

export interface ImportOptions {
  /** ημικινήσεις κύριας γραμμής στο ευρετήριο θέσεων (0 = αυτόματα) */
  maxPly?: number;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
  /** αρχεία μέσα σε αρχειοθήκη (.7z/.zip) */
  archiveMember?: string;
  /** χωρίς ευρετήριο θέσεων (θα φτιαχτεί αργότερα, π.χ. μετά από πολλά αρχεία) */
  skipIndex?: boolean;
}

const ECO_TSV = fs.readFileSync(new URL('../../data/openings.tsv', import.meta.url), 'utf8');
const WORKER_URL = new URL('./importWorker.ts', import.meta.url);
const INDEX_WORKER_URL = new URL('./indexWorker.ts', import.meta.url);

/** Ευρετήρια SQLite + συγχώνευση ευρετηρίου θέσεων σε ξεχωριστό νήμα. */
function finishInWorker(
  db: GameDatabase,
  base: string,
  builder: IndexBuilder | null,
  info: GameInfo,
  meta: { maxPly: number; games: number },
  sqlIndexes: boolean,
  onMessage: (m: string) => void,
): Promise<{ entries: number; treePositions: number }> {
  const sealed = builder ? builder.seal() : null;
  return new Promise((resolve, reject) => {
    const w = new Worker(INDEX_WORKER_URL);
    w.on('message', (m: { type: string; message?: string; entries?: number; treePositions?: number }) => {
      if (m.type === 'progress') onMessage(m.message ?? '');
      else if (m.type === 'done') {
        resolve({ entries: m.entries ?? 0, treePositions: m.treePositions ?? 0 });
        void w.terminate();
      } else if (m.type === 'error') {
        reject(new Error(m.message));
        void w.terminate();
      }
    });
    w.on('error', reject);
    w.postMessage({ dbFile: db.file, base, runs: sealed?.runs ?? null, total: sealed?.total ?? 0, info, meta, sqlIndexes });
  });
}
const BATCH_BYTES = 4 * 1024 * 1024;

export function sevenZipPath(): string {
  return sevenBin.path7za;
}

class WorkerPool {
  private workers: Worker[] = [];
  private inflight: number[] = [];
  private waiters: Array<() => void> = [];
  private failed: Error | null = null;
  onResult: (r: BatchResult) => void = () => {};
  /** σφάλμα σε μία παρτίδα δουλειάς (η εισαγωγή συνεχίζει) */
  onBatchError: (seq: number, message: string) => void = () => {};

  async start(n: number): Promise<void> {
    const ready: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(WORKER_URL);
      this.workers.push(w);
      this.inflight.push(0);
      ready.push(
        new Promise((res, rej) => {
          const onMsg = (m: { type: string }) => {
            if (m.type === 'ready') {
              w.off('message', onMsg);
              res();
            }
          };
          w.on('message', onMsg);
          w.once('error', rej);
        }),
      );
      w.on('message', (m: { type: string; seq: number; message?: string } & BatchResult) => {
        if (m.type === 'result') {
          this.inflight[i]--;
          this.onResult(m);
          this.wake();
        } else if (m.type === 'error') {
          this.inflight[i]--;
          this.onBatchError(m.seq, m.message ?? 'άγνωστο σφάλμα');
          this.wake();
        }
      });
      w.on('error', (e) => {
        this.failed ??= e as Error;
        this.wake();
      });
      w.postMessage({ type: 'init', ecoTsv: ECO_TSV });
    }
    await Promise.all(ready);
  }

  private wake(): void {
    const w = this.waiters.splice(0);
    for (const f of w) f();
  }

  /** Περιμένει ώσπου κάποιος worker να έχει λιγότερες από 2 δουλειές. */
  async acquire(): Promise<number> {
    for (;;) {
      if (this.failed) throw this.failed;
      let best = -1;
      for (let i = 0; i < this.workers.length; i++) if (this.inflight[i] < 2 && (best < 0 || this.inflight[i] < this.inflight[best])) best = i;
      if (best >= 0) return best;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  send(i: number, msg: unknown, transfer: ArrayBuffer[] = []): void {
    this.inflight[i]++;
    this.workers[i].postMessage(msg, transfer);
  }

  async drain(): Promise<void> {
    while (this.inflight.some((n) => n > 0)) {
      if (this.failed) throw this.failed;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}

/**
 * Ανιχνεύει κωδικοποίηση κειμένου PGN από δείγμα. Το δείγμα μπορεί να κόβει ένα γράμμα στη μέση: με `stream` το μισό
 * γράμμα του τέλους δεν είναι λάθος (ως 22/11 πετιόνταν τα 4 τελευταία bytes, και αν το κόψιμο έπεφτε μέσα σε
 * γράμμα, ένα UTF-8 αρχείο γινόταν windows-1253 με χαλασμένα ελληνικά).
 */
export function detectEncoding(sample: Uint8Array): string {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return 'utf-8';
  } catch {
    // όχι UTF-8: ελληνικά (1253) ή δυτικά (1252);
  }
  let high = 0;
  let letters = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c >= 0xc1 && c <= 0xfe) high++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) letters++;
  }
  return high > letters * 0.05 ? 'windows-1253' : 'windows-1252';
}

/** Θέση όπου αρχίζει η τελευταία (πιθανώς μισή) παρτίδα του buffer. */
function lastGameStart(buf: Buffer, end: number): number {
  for (const pat of ['\n[Event ', '\n\n[', '\r\n\r\n[']) {
    const k = buf.lastIndexOf(pat, end - 1);
    if (k > 0) return k + 1;
  }
  return -1;
}

export function autoMaxPly(estimatedGames: number): number {
  if (estimatedGames > 3_000_000) return 24;
  if (estimatedGames > 1_000_000) return 40;
  if (estimatedGames > 300_000) return 80;
  return 400;
}

interface Sink {
  db: GameDatabase;
  nextId: number;
  builder: IndexBuilder | null;
  info: GameInfo;
  maxPly: number;
  games: number;
  errors: number;
  skipped: number;
  nextSeq: number;
  pending: Map<number, BatchResult>;
  firstError: string | null;
}

function writeBatch(s: Sink, r: BatchResult): void {
  const db = s.db;
  const firstId = s.nextId;
  db.insertBatch(
    r.games.map((g) => ({
      headers: g.headers,
      tokens: r.tokens.subarray(g.tokOff, g.tokOff + g.tokLen),
      comments: null,
      packedComments: g.packedComments,
      fen: g.fen,
      flags: g.flags,
      plies: g.plies,
    })),
    firstId,
  );
  s.nextId += r.games.length;
  const before = Math.floor(s.games / 20000);
  r.games.forEach((g, i) => {
    const id = firstId + i;
    s.info = growGameInfo(s.info, id);
    s.info.result[id] = parseResult(g.headers.Result);
    s.info.welo[id] = parseElo(g.headers.WhiteElo);
    s.info.belo[id] = parseElo(g.headers.BlackElo);
    s.info.year[id] = Math.floor(parsePgnDate(g.headers.Date) / 10000);
    const b = s.builder;
    if (b) for (let k = g.idxOff; k < g.idxOff + g.idxLen; k++) b.add(r.idxHi[k], r.idxLo[k], id, r.idxNext[k], r.idxStm[k]);
    s.games++;
    if (g.error) {
      s.errors++;
      s.firstError ??= `${g.headers.White ?? '?'} – ${g.headers.Black ?? '?'}: ${g.error}`;
    }
  });
  if (Math.floor(s.games / 20000) !== before) db.commitBulk();
  s.skipped += r.skipped;
}

function drainOrdered(s: Sink): void {
  for (;;) {
    const r = s.pending.get(s.nextSeq);
    if (!r) return;
    s.pending.delete(s.nextSeq);
    s.nextSeq++;
    writeBatch(s, r);
  }
}

async function runImport(
  db: GameDatabase,
  base: string,
  opts: ImportOptions,
  estimatedGames: number,
  totalBytes: number,
  feed: (pool: WorkerPool, sink: Sink, report: (bytes: number) => void) => Promise<void>,
): Promise<ImportProgress> {
  const maxPly = opts.maxPly || autoMaxPly(estimatedGames);
  const startCount = db.count();
  const sink: Sink = {
    db,
    nextId: db.maxId() + 1,
    builder: opts.skipIndex ? null : new IndexBuilder(base),
    info: createGameInfo(Math.max(1024, estimatedGames + startCount + 16)),
    maxPly,
    games: 0,
    errors: 0,
    skipped: 0,
    nextSeq: 0,
    pending: new Map(),
    firstError: null,
  };
  const progress: ImportProgress = { phase: 'reading', games: 0, bytes: 0, totalBytes, errors: 0, skipped: 0 };
  let lastReport = 0;
  const report = (bytes: number) => {
    progress.bytes = bytes;
    progress.games = sink.games;
    progress.errors = sink.errors;
    progress.skipped = sink.skipped;
    const now = Date.now();
    if (now - lastReport > 250) {
      lastReport = now;
      opts.onProgress?.({ ...progress });
    }
  };
  // παλιές παρτίδες της βάσης στο ευρετήριο (σε προσθήκη σε υπάρχουσα βάση)
  if (startCount > 0 && sink.builder) await reindexExisting(db, sink, opts.signal, (done) => opts.onProgress?.({ ...progress, existing: { done, total: startCount } }));

  const pool = new WorkerPool();
  let failure: Error | null = null;
  pool.onResult = (r) => {
    sink.pending.set(r.seq, r);
    try {
      drainOrdered(sink);
    } catch (e) {
      failure = e as Error;
    }
  };
  pool.onBatchError = (seq, message) => {
    // χαμένο κομμάτι: συνεχίζουμε με τα υπόλοιπα
    sink.errors++;
    sink.firstError ??= message.split('\n')[0];
    sink.pending.set(seq, {
      seq,
      games: [],
      tokens: new Uint16Array(0),
      idxHi: new Int32Array(0),
      idxLo: new Int32Array(0),
      idxNext: new Uint16Array(0),
      idxStm: new Uint8Array(0),
      bytes: 0,
      skipped: 0,
    });
    try {
      drainOrdered(sink);
    } catch (e) {
      failure = e as Error;
    }
  };
  const threads = Math.max(1, Math.min(os.cpus().length - 2, 12));
  await pool.start(threads);
  if (startCount === 0) db.dropIndexes();
  db.beginBulk();
  try {
    await feed(pool, sink, report);
    await pool.drain();
    drainOrdered(sink);
    if (failure) throw failure;
  } catch (e) {
    await pool.stop();
    db.endBulk();
    db.createIndexes();
    sink.builder?.abort();
    if (opts.signal?.aborted) {
      progress.phase = 'cancelled';
      opts.onProgress?.({ ...progress, games: sink.games });
      return progress;
    }
    throw e;
  }
  await pool.stop();
  db.endBulk();
  progress.phase = 'indexing';
  progress.games = sink.games;
  opts.onProgress?.({ ...progress, message: 'Ευρετήρια βάσης…' });
  const stats = await finishInWorker(db, base, sink.builder, sink.info, { maxPly, games: db.count() }, true, (message) => opts.onProgress?.({ ...progress, message }));
  if (sink.builder) {
    db.setMeta('indexMaxPly', String(maxPly));
    db.setMeta('indexedMaxId', String(db.maxId()));
    db.setMeta('indexEntries', String(stats.entries));
    db.setMeta('indexStale', '0');
  } else {
    db.setMeta('indexStale', '1');
  }
  progress.phase = 'done';
  progress.games = sink.games;
  progress.errors = sink.errors;
  progress.skipped = sink.skipped;
  progress.bytes = totalBytes;
  if (sink.firstError) progress.message = `Πρώτο σφάλμα: ${sink.firstError}`;
  opts.onProgress?.({ ...progress });
  return progress;
}

/** Ξαναπερνά τις υπάρχουσες παρτίδες στο ευρετήριο (για προσθήκη ή ανακατασκευή). */
async function reindexExisting(db: GameDatabase, sink: Sink, signal?: AbortSignal, onDone?: (done: number) => void): Promise<void> {
  const { replayMainline } = await import('../../core/codec.ts');
  const { Position } = await import('../../core/chess.ts');
  const pos = new Position();
  let k = 0;
  let lastReport = Date.now();
  onDone?.(0);
  for (const g of db.iterateMoves()) {
    if (signal?.aborted) throw new Error('Ακυρώθηκε');
    sink.info = growGameInfo(sink.info, g.id);
    sink.info.result[g.id] = g.result;
    sink.info.welo[g.id] = g.welo;
    sink.info.belo[g.id] = g.belo;
    sink.info.year[g.id] = Math.floor(g.date / 10000);
    const startTurn = g.fen ? (g.fen.split(' ')[1] === 'b' ? 1 : 0) : 0;
    let count = 0;
    replayMainline(g.tokens, pos, g.fen, (p, ply, next) => {
      if (count >= sink.maxPly) return true;
      sink.builder!.add(p.hashHi, p.hashLo, g.id, next, (startTurn + ply) & 1);
      count++;
      return false;
    });
    if (++k % 5000 === 0) {
      if (onDone && Date.now() - lastReport > 250) {
        lastReport = Date.now();
        onDone(k);
      }
      await new Promise((r) => setImmediate(r));
    }
  }
  onDone?.(k);
}

/** Ανακατασκευή του ευρετηρίου θέσεων για ολόκληρη τη βάση. */
export async function rebuildIndex(db: GameDatabase, base: string, opts: { maxPly?: number; signal?: AbortSignal; onProgress?: (p: ImportProgress) => void } = {}): Promise<void> {
  const total = db.count();
  const maxPly = opts.maxPly || Number(db.getMeta('indexMaxPly')) || autoMaxPly(total);
  const sink: Sink = {
    db,
    nextId: db.maxId() + 1,
    builder: new IndexBuilder(base),
    info: createGameInfo(Math.max(1024, db.maxId() + 1)),
    maxPly,
    games: 0,
    errors: 0,
    skipped: 0,
    nextSeq: 0,
    pending: new Map(),
    firstError: null,
  };
  opts.onProgress?.({ phase: 'indexing', games: total, bytes: 0, totalBytes: 0, errors: 0, skipped: 0, message: 'Ευρετήριο θέσεων…' });
  try {
    await reindexExisting(db, sink, opts.signal);
  } catch (e) {
    sink.builder!.abort();
    throw e;
  }
  const stats = await finishInWorker(db, base, sink.builder, sink.info, { maxPly, games: total }, false, (message) =>
    opts.onProgress?.({ phase: 'indexing', games: total, bytes: 0, totalBytes: 0, errors: 0, skipped: 0, message }),
  );
  db.setMeta('indexMaxPly', String(maxPly));
  db.setMeta('indexedMaxId', String(db.maxId()));
  db.setMeta('indexEntries', String(stats.entries));
  db.setMeta('indexStale', '0');
  opts.onProgress?.({ phase: 'done', games: total, bytes: 0, totalBytes: 0, errors: 0, skipped: 0 });
}

// ---------------------------------------------------------------------------
// Πηγές

async function feedStream(stream: Readable, pool: WorkerPool, sink: Sink, report: (b: number) => void, signal?: AbortSignal): Promise<void> {
  let carry: Buffer = Buffer.alloc(0);
  let encoding = '';
  let seq = 0;
  let bytes = 0;
  const send = async (chunk: Buffer) => {
    const i = await pool.acquire();
    const copy = new Uint8Array(chunk.length);
    copy.set(chunk);
    pool.send(i, { type: 'pgn', seq: seq++, bytes: copy, encoding, maxPly: sink.maxPly }, [copy.buffer as ArrayBuffer]);
  };
  for await (const part of stream as AsyncIterable<Buffer>) {
    if (signal?.aborted) {
      stream.destroy();
      throw new Error('Ακυρώθηκε');
    }
    bytes += part.length;
    carry = carry.length ? Buffer.concat([carry, part]) : part;
    if (!encoding) {
      if (carry.length < 1 << 20) continue;
      encoding = detectEncoding(carry.subarray(0, 1 << 20));
    }
    while (carry.length >= BATCH_BYTES) {
      const cut = lastGameStart(carry, carry.length);
      if (cut <= 0) break;
      await send(carry.subarray(0, cut));
      carry = carry.subarray(cut);
      if (carry.length >= BATCH_BYTES) {
        // μία τεράστια παρτίδα: περιμένουμε περισσότερα δεδομένα
        break;
      }
    }
    report(bytes);
  }
  if (!encoding) encoding = detectEncoding(carry.subarray(0, 1 << 20));
  if (carry.length) await send(carry);
  report(bytes);
}

/** Εισαγωγή αρχείου PGN. */
export async function importPgnFile(file: string, db: GameDatabase, base: string, opts: ImportOptions = {}): Promise<ImportProgress> {
  const size = fs.statSync(file).size;
  return runImport(db, base, opts, Math.round(size / 900), size, async (pool, sink, report) => {
    const stream = fs.createReadStream(file, { highWaterMark: 2 * 1024 * 1024 });
    await feedStream(stream, pool, sink, report, opts.signal);
  });
}

/** Περιεχόμενα αρχειοθήκης (.7z/.zip): [όνομα, μέγεθος]. */
export async function listArchive(file: string): Promise<Array<{ name: string; size: number }>> {
  const out = await new Promise<string>((res, rej) => {
    const p = spawn(sevenZipPath(), ['l', '-slt', '-ba', file], { windowsHide: true });
    let s = '';
    p.stdout.on('data', (d) => (s += d));
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res(s) : rej(new Error(`7-Zip: κωδικός ${code}`))));
  });
  const items: Array<{ name: string; size: number }> = [];
  let cur: { name?: string; size?: number; dir?: boolean } = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\w[\w ]*?) = (.*)$/.exec(line);
    if (!m) {
      if (cur.name && !cur.dir) items.push({ name: cur.name, size: cur.size ?? 0 });
      cur = {};
      continue;
    }
    if (m[1] === 'Path') cur.name = m[2];
    else if (m[1] === 'Size') cur.size = Number(m[2]) || 0;
    else if (m[1] === 'Folder') cur.dir = m[2] === '+';
  }
  if (cur.name && !cur.dir) items.push({ name: cur.name, size: cur.size ?? 0 });
  return items;
}

/** Εισαγωγή PGN από αρχειοθήκη .7z / .zip χωρίς αποσυμπίεση στον δίσκο. */
export async function importArchive(file: string, db: GameDatabase, base: string, opts: ImportOptions = {}): Promise<ImportProgress> {
  const all = await listArchive(file);
  const members = all.filter((m) => /\.pgn$/i.test(m.name));
  if (!members.length) {
    const si4 = all.find((m) => /\.si4$/i.test(m.name));
    if (si4) return importScidArchive(file, si4.name, db, base, opts);
    throw new Error('Η αρχειοθήκη δεν περιέχει αρχείο PGN ή βάση Scid');
  }
  const chosen = opts.archiveMember ? members.filter((m) => m.name === opts.archiveMember) : members;
  const total = chosen.reduce((a, m) => a + m.size, 0);
  return runImport(db, base, opts, Math.round(total / 1100), total, async (pool, sink, report) => {
    let done = 0;
    for (const m of chosen) {
      const p = spawn(sevenZipPath(), ['e', '-so', '-bd', file, m.name], { windowsHide: true });
      const errChunks: Buffer[] = [];
      p.stderr.on('data', (d: Buffer) => errChunks.push(d));
      const exit = new Promise<number>((res) => p.on('close', (c) => res(c ?? 0)));
      const base0 = done;
      await feedStream(p.stdout, pool, sink, (b) => report(base0 + b), opts.signal);
      const code = await exit;
      if (code !== 0 && !opts.signal?.aborted) throw new Error(`7-Zip: ${Buffer.concat(errChunks).toString().trim() || 'κωδικός ' + code}`);
      done += m.size;
    }
  });
}

/** Εισαγωγή βάσης ChessBase (.cbh). */
export async function importCbh(file: string, db: GameDatabase, base: string, opts: ImportOptions = {}): Promise<ImportProgress> {
  const cb = new CbhDatabase(file);
  const count = cb.count;
  const missing = cb.missing;
  cb.close();
  if (missing.length) throw new Error(`Η βάση ChessBase είναι ελλιπής — λείπουν: ${missing.join(', ')}`);
  return runImport(db, base, opts, count, count, async (pool, sink, report) => {
    const step = 2000;
    let seq = 0;
    for (let from = 1; from <= count; from += step) {
      if (opts.signal?.aborted) throw new Error('Ακυρώθηκε');
      const i = await pool.acquire();
      pool.send(i, { type: 'cbh', seq: seq++, file, from, to: Math.min(count + 1, from + step), maxPly: sink.maxPly });
      report(Math.min(count, from + step - 1));
    }
  });
}

/** Βάση Scid μέσα σε .7z / .zip: τα τρία αρχεία βγαίνουν σε προσωρινό φάκελο, εισάγονται και σβήνονται. */
async function importScidArchive(file: string, si4: string, db: GameDatabase, base: string, opts: ImportOptions): Promise<ImportProgress> {
  const dir = path.join(os.tmpdir(), 'knightbase-scid', crypto.randomUUID().slice(0, 8));
  fs.mkdirSync(dir, { recursive: true });
  try {
    const stem = si4.replace(/\.si4$/i, '');
    await new Promise<void>((res, rej) => {
      const p = spawn(sevenZipPath(), ['e', '-y', `-o${dir}`, file, `${stem}.si4`, `${stem}.sn4`, `${stem}.sg4`], { windowsHide: true });
      const kill = () => p.kill();
      opts.signal?.addEventListener('abort', kill, { once: true });
      p.on('error', rej);
      p.on('close', (code) => {
        opts.signal?.removeEventListener('abort', kill);
        if (opts.signal?.aborted) rej(new Error('Ακυρώθηκε'));
        else if (code === 0) res();
        else rej(new Error(`7-Zip: κωδικός ${code}`));
      });
    });
    return await importScid(path.join(dir, path.basename(`${stem}.si4`)), db, base, opts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Εισαγωγή βάσης Scid (.si4 με τα .sn4 / .sg4 δίπλα). */
export async function importScid(file: string, db: GameDatabase, base: string, opts: ImportOptions = {}): Promise<ImportProgress> {
  const sc = new ScidDatabase(file);
  const count = sc.count;
  const missing = sc.missing;
  sc.close();
  if (missing.length) throw new Error(`Η βάση Scid είναι ελλιπής — λείπουν: ${missing.join(', ')}`);
  return runImport(db, base, opts, count, count, async (pool, sink, report) => {
    const step = 2000;
    let seq = 0;
    for (let from = 0; from < count; from += step) {
      if (opts.signal?.aborted) throw new Error('Ακυρώθηκε');
      const i = await pool.acquire();
      pool.send(i, { type: 'scid', seq: seq++, file, from, to: Math.min(count, from + step), maxPly: sink.maxPly });
      report(Math.min(count, from + step));
    }
  });
}

/** Επιλέγει τη σωστή εισαγωγή από την κατάληξη. */
export async function importAny(file: string, db: GameDatabase, base: string, opts: ImportOptions = {}): Promise<ImportProgress> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pgn') return importPgnFile(file, db, base, opts);
  if (ext === '.7z' || ext === '.zip' || ext === '.gz' || ext === '.bz2' || ext === '.xz') return importArchive(file, db, base, opts);
  if (ext === '.cbh') return importCbh(file, db, base, opts);
  if (ext === '.si4') return importScid(file, db, base, opts);
  throw new Error(`Μη υποστηριζόμενη μορφή αρχείου: ${ext}`);
}
