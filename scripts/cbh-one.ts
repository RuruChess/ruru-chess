// Δοκιμή: λεπτομέρειες για τις πρώτες εγγραφές μιας βάσης ChessBase
import { CbhDatabase } from '../src/server/formats/cbh.ts';

const db = new CbhDatabase(process.argv[2]);
const n = Math.min(db.count, Number(process.argv[3] ?? 3));
for (let i = 1; i <= n; i++) {
  const r = db.record(i);
  const g = db.decodeGame(r);
  const h = db.headers(r);
  console.log(i, r.kind, h.White, '-', h.Black, '| ημικινήσεις', g.plies, '| tokens', g.tokens.length, '| σφάλμα', g.error, '| FEN', g.startFen, '| σχόλια', g.comments);
}
db.close();
