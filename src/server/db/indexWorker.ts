/**
 * Worker για τα βαριά βήματα μετά την εισαγωγή: ευρετήρια SQLite και συγχώνευση
 * του ευρετηρίου θέσεων. Έτσι ο server (και το περιβάλλον) δεν «παγώνει».
 */
import { parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mergeRuns, type GameInfo } from './posindex.ts';
import { GameDatabase, INDEXES } from './store.ts';

interface Msg {
  dbFile: string;
  base: string;
  runs: string[] | null;
  total: number;
  info: GameInfo;
  meta: { maxPly: number; games: number };
  sqlIndexes: boolean;
}

parentPort!.on('message', (msg: Msg) => {
  try {
    if (msg.sqlIndexes) {
      parentPort!.postMessage({ type: 'progress', message: 'Ευρετήρια βάσης…' });
      const db = new DatabaseSync(msg.dbFile);
      db.exec('PRAGMA busy_timeout = 60000;');
      db.exec(INDEXES);
      db.exec('ANALYZE;');
      db.close();
      // μετρήσεις και στατιστικά υπολογίζονται εδώ, όχι στον server
      parentPort!.postMessage({ type: 'progress', message: 'Στατιστικά βάσης…' });
      const g = new GameDatabase(msg.dbFile);
      g.count();
      g.stats();
      g.close();
    }
    let res = { entries: 0, treePositions: 0 };
    if (msg.runs) {
      parentPort!.postMessage({ type: 'progress', message: 'Ευρετήριο θέσεων…' });
      res = mergeRuns(msg.base, msg.runs, msg.total, msg.info, msg.meta, (done, total) => {
        parentPort!.postMessage({ type: 'progress', message: `Ευρετήριο θέσεων ${Math.round((done / Math.max(1, total)) * 100)}%` });
      });
    }
    parentPort!.postMessage({ type: 'done', ...res });
  } catch (e) {
    parentPort!.postMessage({ type: 'error', message: (e as Error).message });
  }
});
