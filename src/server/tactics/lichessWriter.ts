/** Worker εγγραφής της εισαγωγής Lichess: δική του σύνδεση στη puzzles.sqlite, ένα frame ανά συναλλαγή μαζί με την κατάσταση συνέχισης (το κύριο νήμα δεν γράφει, άρα ο server δεν «παγώνει»). */
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { Position } from '../../core/chess.ts';
import type { ColumnMap, QualityFilter } from './csv.ts';
import { BatchBuilder, batchGame, emptyStats, type FrameBatch, type FrameResult, IMPORT_STATE_KEY, type ImportState, joinFrame, mergeStats, processLine, sumRejected } from './lichessRows.ts';

export interface WriterInit {
  file: string;
  cols: ColumnMap;
  quality: QualityFilter;
  bits: Record<string, number>;
  /** η κατάσταση από την οποία συνεχίζει (ήδη γραμμένη στο meta) */
  state: ImportState;
}

/** Αιτήματα προς τον worker (ένα τη φορά). */
export type WriterRequest = { type: 'frame'; offset: number; length: number; frame: FrameResult } | { type: 'finish' } | { type: 'close' };

export interface WriterReply {
  type: 'written' | 'finished' | 'closed' | 'error';
  frames?: number;
  accepted?: number;
  filtered?: number;
  rejected?: number;
  /** χρόνος εγγραφής του frame (με το COMMIT) και μόνο του COMMIT */
  writeMs?: number;
  commitMs?: number;
  state?: ImportState;
  error?: string;
}

const init = workerData as WriterInit;
const st = init.state;
const db = new DatabaseSync(init.file);
// χωρίς αυτόματο checkpoint: γίνεται μία φορά στο τέλος (σε worker), όχι σε κάθε COMMIT
db.exec('PRAGMA busy_timeout=60000; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY; PRAGMA wal_autocheckpoint=0;');

const openings = new Map<string, number>();
for (const r of db.prepare('SELECT id, tags FROM opening').all() as Array<{ id: number; tags: string }>) openings.set(r.tags, r.id);
const insOpening = db.prepare('INSERT INTO opening(family, tags) VALUES (?, ?) RETURNING id');
const openingId = (tags: string): number | null => {
  if (!tags) return null;
  let id = openings.get(tags);
  if (id === undefined) {
    const family = tags.split(' ')[0].replace(/_/g, ' ');
    id = (insOpening.get(family, tags) as { id: number }).id;
    openings.set(tags, id);
  }
  return id;
};
const ins = db.prepare(
  `INSERT INTO puzzle(id, source_id, pos, line, rating, rd, pop, plays, th1, th2, opening_id, game, ply, flags) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET source_id = 1, pos = excluded.pos, line = excluded.line, rating = excluded.rating, rd = excluded.rd, pop = excluded.pop,
     plays = excluded.plays, th1 = excluded.th1, th2 = excluded.th2, opening_id = excluded.opening_id, game = excluded.game, ply = excluded.ply, flags = excluded.flags`,
);
const insDaily = db.prepare('INSERT OR REPLACE INTO daily(day, puzzle_id) VALUES (?, ?)');
const saveState = db.prepare('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
const pos = new Position();
let lastSave = Date.now();

function writeBatch(b: FrameBatch): void {
  const dict = b.openingDict.map(openingId);
  for (let i = 0; i < b.n; i++) {
    const oi = b.openingIdx[i];
    ins.run(
      b.ids[i],
      b.pos.subarray(b.posOff[i], b.posOff[i + 1]),
      b.line.subarray(b.lineOff[i], b.lineOff[i + 1]),
      b.rating[i],
      b.rd[i],
      b.pop[i],
      b.plays[i],
      b.th1[i],
      b.th2[i],
      oi >= 0 ? dict[oi] : null,
      batchGame(b, i),
      b.ply[i] || null,
      b.flags[i],
    );
    if (b.daily[i] > 0) insDaily.run(new Date(b.daily[i]).toISOString().slice(0, 10), b.ids[i]);
  }
}

/** Μία συναλλαγή: τα puzzles και η νέα κατάσταση μαζί (όλα ή τίποτα). */
function tx(fn: () => void): { writeMs: number; commitMs: number } {
  const t0 = performance.now();
  db.exec('BEGIN');
  try {
    fn();
    const now = Date.now();
    st.workMs += now - lastSave;
    lastSave = now;
    saveState.run(IMPORT_STATE_KEY, JSON.stringify(st));
    const tc = performance.now();
    db.exec('COMMIT');
    const end = performance.now();
    return { writeMs: Math.round(end - t0), commitMs: Math.round(end - tc) };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const progress = (): Pick<WriterReply, 'frames' | 'accepted' | 'filtered' | 'rejected'> => ({ frames: st.frames, accepted: st.stats.accepted, filtered: st.stats.filtered, rejected: sumRejected(st.stats) });

parentPort!.on('message', (msg: WriterRequest) => {
  try {
    if (msg.type === 'frame') {
      const r = msg.frame;
      if (r.error || !r.batch || !r.stats) throw new Error(`Frame ${st.frames + 1}: ${r.error ?? 'άγνωστο σφάλμα'}`);
      // η γραμμή που μοιράζεται ανάμεσα στο προηγούμενο και σε αυτό το frame
      const joined = new BatchBuilder(4);
      const joinedStats = emptyStats();
      const carry = joinFrame(st.carry, r, st.frames === 0, init.cols, init.quality, init.bits, pos, joined, joinedStats);
      const t = tx(() => {
        writeBatch(r.batch!);
        writeBatch(joined.finish());
        mergeStats(st.stats, r.stats!);
        mergeStats(st.stats, joinedStats);
        st.carry = carry;
        st.nextOffset = msg.offset + msg.length;
        st.frames++;
      });
      parentPort!.postMessage({ type: 'written', ...progress(), ...t } satisfies WriterReply);
    } else if (msg.type === 'finish') {
      // τελευταία γραμμή χωρίς αλλαγή γραμμής στο τέλος του αρχείου
      if (st.carry.trim()) {
        const last = new BatchBuilder(4);
        const lastStats = emptyStats();
        processLine(st.carry, init.cols, init.quality, init.bits, pos, last, lastStats);
        tx(() => {
          writeBatch(last.finish());
          mergeStats(st.stats, lastStats);
          st.carry = '';
        });
      }
      parentPort!.postMessage({ type: 'finished', ...progress(), state: st } satisfies WriterReply);
    } else {
      // κλείσιμο της σύνδεσης· ο worker τερματίζεται από το κύριο νήμα μόλις πάρει την απάντηση
      db.close();
      parentPort!.postMessage({ type: 'closed' } satisfies WriterReply);
    }
  } catch (e) {
    parentPort!.postMessage({ type: 'error', error: (e as Error).message } satisfies WriterReply);
  }
});
