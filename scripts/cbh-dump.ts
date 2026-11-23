// Δοκιμή: διαβάζει βάσεις ChessBase και τυπώνει στατιστικά / PGN
import fs from 'node:fs';
import path from 'node:path';
import { CbhDatabase } from '../src/server/formats/cbh.ts';
import { decodeGame } from '../src/core/codec.ts';
import { writeGame } from '../src/core/pgn.ts';

const dir = process.argv[2];
const show = process.argv[3];
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cbh'));
for (const f of files) {
  let db: CbhDatabase;
  try {
    db = new CbhDatabase(path.join(dir, f));
  } catch (e) {
    console.log(f, 'ΣΦΑΛΜΑ', (e as Error).message);
    continue;
  }
  let games = 0, errors = 0, texts = 0, plies = 0, comments = 0;
  const errs: string[] = [];
  for (let i = 1; i <= db.count; i++) {
    const r = db.record(i);
    if (r.kind !== 'game') { texts++; continue; }
    const h = db.headers(r);
    if (db.missing.includes(path.basename(db.base) + '.cbg')) { games++; continue; }
    const g = db.decodeGame(r);
    games++;
    plies += g.plies;
    comments += g.comments?.length ?? 0;
    if (g.error) { errors++; if (errs.length < 3) errs.push(`#${i} ${h.White}-${h.Black}: ${g.error}`); }
    if (show && f.startsWith(show) && i <= 2) {
      const game = decodeGame(g.tokens, g.comments, g.startFen ?? undefined);
      game.headers = { ...game.headers, ...h };
      console.log(writeGame(game));
    }
  }
  console.log(`${f}: ${games} παρτίδες, ${texts} κείμενα, ${plies} ημικινήσεις, ${comments} σχόλια, ${errors} σφάλματα${db.missing.length ? ' | λείπουν: ' + db.missing.join(', ') : ''}`);
  for (const e of errs) console.log('   ', e);
  db.close();
}
