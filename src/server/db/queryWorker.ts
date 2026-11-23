/**
 * Worker για βαριές αναζητήσεις/ταξινομήσεις λιστών (π.χ. 12 εκατ. παρτίδες),
 * με δική του σύνδεση στη βάση, ώστε ο server να μένει διαθέσιμος.
 */
import { parentPort } from 'node:worker_threads';
import { GameDatabase, type SearchCriteria } from './store.ts';

interface Msg {
  id: number;
  file: string;
  /** 'doubles': ids διπλών παρτίδων αντί για λίστα */
  op?: 'doubles';
  filter: SearchCriteria | null;
  baseIds: Int32Array | null;
  sort: { col: string; desc: boolean } | null;
  /**
   * βάση που εισάγεται (πλήθος και id πριν από την εισαγωγή): σύνδεση μόνο για ανάγνωση, μόνο για
   * αυτό το αίτημα, ώστε να μη γράφει και να μην κρατά το αρχείο ανοιχτό
   */
  growing?: GameDatabase['growing'];
}

const open = new Map<string, GameDatabase>();

parentPort!.on('message', (m: Msg | { type: 'close'; file: string }) => {
  if ('type' in m) {
    open.get(m.file)?.close();
    open.delete(m.file);
    return;
  }
  let db: GameDatabase | undefined;
  try {
    if (m.growing) {
      db = new GameDatabase(m.file, { reader: true });
      db.growing = m.growing;
    } else {
      db = open.get(m.file);
      if (!db) open.set(m.file, (db = new GameDatabase(m.file)));
      // ο server μπορεί να έγραψε στη βάση από το προηγούμενο αίτημα
      db.syncCounts();
    }
    let ids: Int32Array;
    if (m.op === 'doubles') {
      ids = db.doubleIds((done, total) => parentPort!.postMessage({ id: m.id, progress: { done, total } }));
    } else if (m.filter) {
      ids = db.search(m.filter);
      if (m.baseIds) {
        const allowed = new Set(m.baseIds);
        ids = ids.filter((x) => allowed.has(x));
      }
    } else {
      ids = m.baseIds ?? db.allIds();
    }
    if (m.sort && m.sort.col !== 'id') ids = db.sortIds(ids, m.sort.col, m.sort.desc);
    else if (m.sort?.desc) ids = ids.slice().reverse();
    parentPort!.postMessage({ id: m.id, ids }, [ids.buffer as ArrayBuffer]);
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: (e as Error).message });
  } finally {
    if (m.growing) db?.close();
  }
});
