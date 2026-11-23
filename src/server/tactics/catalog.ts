/** Μετρήσεις της βάσης puzzles (ανά θέμα, άνοιγμα, πηγή) και εγγραφές πηγών μετά από κάθε εισαγωγή. */
import { Worker } from 'node:worker_threads';
import type { Tactics } from './context.ts';
import type { DbOp } from './dbWorker.ts';
import type { TacticsJob } from './jobs.ts';
import type { SourceDef } from './sources.ts';
import { F_INACTIVE, type PuzzleDb } from './store.ts';

const P26 = 2 ** 26;
const DB_WORKER_URL = new URL('./dbWorker.ts', import.meta.url);

export interface DbTaskResult {
  ms: number;
  changes?: number;
  rows?: unknown[][];
  themes?: number[];
  openings?: Array<{ id: number; n: number }>;
}

/**
 * Βαριά εργασία στη puzzles.sqlite σε worker με δική του σύνδεση (ευρετήρια, ANALYZE, μετρήσεις,
 * μαζικά UPDATE), ώστε ο server να απαντά στο μεταξύ. Η σύνδεση του κύριου νήματος δεν πρέπει να
 * έχει ανοιχτή συναλλαγή εγγραφής όσο τρέχει.
 */
export function dbTask(file: string, op: DbOp, sql?: string, args?: Array<number | string>): Promise<DbTaskResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(DB_WORKER_URL, { workerData: { file, op, sql, args } });
    let done = false;
    w.once('message', (m: DbTaskResult & { error?: string }) => {
      done = true;
      if (m.error) reject(new Error(m.error));
      else resolve(m);
    });
    w.once('error', (e) => {
      done = true;
      reject(e);
    });
    w.once('exit', (code) => {
      if (!done) reject(new Error(`Ο worker της βάσης τερμάτισε (${code})`));
    });
  });
}

/**
 * Αν η puzzles.sqlite έμεινε χωρίς ευρετήρια επιλογής (εισαγωγή που κόπηκε με κλείσιμο του server),
 * τα ξαναφτιάχνει σε worker, ως εργασία της ουράς (μία τη φορά με τις εισαγωγές).
 */
export function repairIndexes(t: Tactics): TacticsJob | null {
  if (!t.puzzles.missingIndexes()) return null;
  return t.jobs.enqueue('indexes', 'Ευρετήρια puzzles', async (ctx) => {
    ctx.progress({ phase: 'index', message: 'Ευρετήρια επιλογής' });
    const r = await dbTask(t.puzzles.file, 'indexes');
    t.puzzlesChanged();
    return { ms: r.ms };
  });
}

/** Προσθέτει στο `counts[bit]` κάθε αναμμένο bit μιας μάσκας 52 bit (με offset για το th2). */
export function countBits(m: number, offset: number, counts: Float64Array): void {
  if (!m) return;
  let lo = m % P26;
  let hi = Math.floor(m / P26);
  while (lo) {
    const b = 31 - Math.clz32(lo & -lo);
    counts[offset + b]++;
    lo &= lo - 1;
  }
  while (hi) {
    const b = 31 - Math.clz32(hi & -hi);
    counts[offset + 26 + b]++;
    hi &= hi - 1;
  }
}

/** Γράφει τις μετρήσεις (πλήθος ανά bit θέματος, ανά άνοιγμα) στους πίνακες theme και opening. */
function applyCounts(db: PuzzleDb, counts: ArrayLike<number>, openings: ReadonlyArray<{ id: number; n: number }>): void {
  db.tx(() => {
    db.db.exec('UPDATE theme SET n = 0');
    const up = db.prep('UPDATE theme SET n = ? WHERE id = ?');
    for (let b = 0; b < counts.length; b++) if (counts[b]) up.run(counts[b], b);
    db.db.exec('UPDATE opening SET n = 0');
    const upo = db.prep('UPDATE opening SET n = ? WHERE id = ?');
    for (const o of openings) upo.run(o.n, o.id);
  });
}

/** Ξαναμετρά πόσα ενεργά puzzles έχει κάθε θέμα και κάθε άνοιγμα (στο κύριο νήμα· για μικρές βάσεις και δοκιμές). */
export function refreshCounts(db: PuzzleDb): { ms: number } {
  const t0 = Date.now();
  const counts = new Float64Array(104);
  const st = db.db.prepare(`SELECT th1, th2 FROM puzzle WHERE (flags & ${F_INACTIVE}) = 0`);
  st.setReturnArrays(true);
  for (const r of st.iterate() as Iterable<[number, number]>) {
    countBits(r[0], 0, counts);
    countBits(r[1], 52, counts);
  }
  const openings = db.db.prepare(`SELECT opening_id AS id, count(*) AS n FROM puzzle WHERE opening_id IS NOT NULL AND (flags & ${F_INACTIVE}) = 0 GROUP BY opening_id`).all() as Array<{ id: number; n: number }>;
  applyCounts(db, counts, openings);
  return { ms: Date.now() - t0 };
}

/** Το ίδιο με το `refreshCounts`, αλλά το διάβασμα των εκατομμυρίων γραμμών γίνεται σε worker. */
export async function refreshCountsAsync(db: PuzzleDb): Promise<{ ms: number }> {
  const t0 = Date.now();
  const r = await dbTask(db.file, 'counts');
  applyCounts(db, r.themes ?? [], r.openings ?? []);
  return { ms: Date.now() - t0 };
}

/**
 * Συνθήκη για puzzles μιας πηγής εκτός Lichess: το «source_id <> 1» χρειάζεται για να χρησιμοποιήσει
 * η SQLite το μερικό ευρετήριο ix_puzzle_source (χωρίς αυτό: σάρωση 4,4 εκατ. γραμμών, ~2 s).
 */
export const OTHER_SOURCE = 'source_id = ? AND source_id <> 1';

/** Πλήθος ενεργών puzzles μιας πηγής. */
export function countSource(db: PuzzleDb, sourceId: number): number {
  const where = sourceId === 1 ? 'source_id = 1 AND ?' : OTHER_SOURCE;
  return (db.prep(`SELECT count(*) AS n FROM puzzle WHERE ${where} AND (flags & ${F_INACTIVE}) = 0`).get(sourceId) as { n: number }).n;
}

/** Εγγραφή της πηγής στον πίνακα source (κλειδί, όνομα, άδεια, έκδοση, πλήθος). */
export function saveSource(db: PuzzleDb, def: SourceDef, patch: { version?: string | null; info?: unknown; n?: number }): void {
  const n = patch.n ?? countSource(db, def.id);
  db.prep(
    `INSERT INTO source(id, key, kind, name, license, url, version, imported_at, n, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET key = excluded.key, kind = excluded.kind, name = excluded.name, license = excluded.license, url = excluded.url,
       version = excluded.version, imported_at = excluded.imported_at, n = excluded.n, info = excluded.info`,
  ).run(def.id, def.key, def.kind, def.name.el, def.license, def.url, patch.version ?? def.version ?? null, Date.now(), n, patch.info === undefined ? null : JSON.stringify(patch.info));
}

export interface SourceRow {
  id: number;
  key: string;
  version: string | null;
  imported_at: number | null;
  n: number;
  info: string | null;
}

export function sourceRows(db: PuzzleDb): Map<string, SourceRow> {
  const rows = db.prep('SELECT id, key, version, imported_at, n, info FROM source').all() as unknown as SourceRow[];
  return new Map(rows.map((r) => [r.key, r]));
}
