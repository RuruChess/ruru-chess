/** Worker συντήρησης της puzzles.sqlite (δική του σύνδεση): ευρετήρια, ANALYZE, μετρήσεις και μαζικές εντολές, χωρίς να «παγώνει» ο server. */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { countBits } from './catalog.ts';
import { F_INACTIVE, PUZZLE_INDEXES } from './store.ts';

export type DbOp = 'indexes' | 'analyze' | 'counts' | 'exec' | 'all' | 'checkpoint';

const { file, op, sql, args } = workerData as { file: string; op: DbOp; sql?: string; args?: Array<number | string> };
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=60000; PRAGMA cache_size=-262144; PRAGMA temp_store=MEMORY;');
const t0 = Date.now();
try {
  if (op === 'indexes') {
    for (const s of PUZZLE_INDEXES) db.exec(s);
    db.exec('ANALYZE');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    parentPort!.postMessage({ ms: Date.now() - t0 });
  } else if (op === 'analyze') {
    db.exec('ANALYZE');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    parentPort!.postMessage({ ms: Date.now() - t0 });
  } else if (op === 'checkpoint') {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    parentPort!.postMessage({ ms: Date.now() - t0 });
  } else if (op === 'exec') {
    // χωρίς παραμέτρους: μία ή περισσότερες εντολές· με παραμέτρους: μία προετοιμασμένη
    let changes = 0;
    if (args) changes = Number(db.prepare(sql!).run(...args).changes);
    else db.exec(sql!);
    parentPort!.postMessage({ ms: Date.now() - t0, changes });
  } else if (op === 'all') {
    const st = db.prepare(sql!);
    st.setReturnArrays(true);
    parentPort!.postMessage({ ms: Date.now() - t0, rows: st.all(...(args ?? [])) });
  } else {
    const counts = new Float64Array(104);
    const st = db.prepare(`SELECT th1, th2 FROM puzzle WHERE (flags & ${F_INACTIVE}) = 0`);
    st.setReturnArrays(true);
    for (const r of st.iterate() as Iterable<[number, number]>) {
      countBits(r[0], 0, counts);
      countBits(r[1], 52, counts);
    }
    const openings = db.prepare(`SELECT opening_id AS id, count(*) AS n FROM puzzle WHERE opening_id IS NOT NULL AND (flags & ${F_INACTIVE}) = 0 GROUP BY opening_id`).all() as Array<{ id: number; n: number }>;
    parentPort!.postMessage({ ms: Date.now() - t0, themes: Array.from(counts), openings });
  }
} catch (e) {
  parentPort!.postMessage({ error: (e as Error).message });
} finally {
  db.close();
}
