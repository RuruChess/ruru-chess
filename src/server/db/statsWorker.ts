/**
 * Ξαναϋπολογισμός παλιών στατιστικών μιας βάσης (μία σάρωση όλων των παρτίδων: σε βάσεις
 * εκατομμυρίων κρατά δευτερόλεπτα), εκτός του κύριου νήματος του server.
 */
import { workerData } from 'node:worker_threads';
import { GameDatabase } from './store.ts';

const db = new GameDatabase(workerData as string);
try {
  db.refreshStats();
} finally {
  db.close();
}
