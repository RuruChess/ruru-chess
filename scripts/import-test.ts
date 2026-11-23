// Δοκιμή εισαγωγής: node scripts/import-test.ts <αρχείο> <έξοδος.kbdb> [maxPly]
import fs from 'node:fs';
import { GameDatabase } from '../src/server/db/store.ts';
import { importAny } from '../src/server/db/importer.ts';
import { PositionIndex } from '../src/server/db/posindex.ts';
import { Position } from '../src/core/chess.ts';

const [src, out, maxPly] = process.argv.slice(2);
for (const ext of ['', '-wal', '-shm', '.pos', '.tree']) fs.rmSync(out + ext, { force: true });
const base = out.replace(/\.(kbdb|skdb)$/, '');
for (const ext of ['.pos', '.tree']) fs.rmSync(base + ext, { force: true });
const db = new GameDatabase(out, { create: true });
const t0 = performance.now();
const res = await importAny(src, db, base, {
  maxPly: maxPly ? Number(maxPly) : 0,
  onProgress: (p) => {
    const pct = p.totalBytes ? ((p.bytes / p.totalBytes) * 100).toFixed(1) : '?';
    process.stdout.write(`\r${p.phase} ${pct}% παρτίδες ${p.games} σφάλματα ${p.errors} ${p.message ?? ''}          `);
  },
});
console.log('\nΑποτέλεσμα:', res, `σε ${((performance.now() - t0) / 1000).toFixed(1)} δευτ.`);
console.log('Στατιστικά:', db.stats());
const idx = new PositionIndex(base);
const p = Position.start();
console.log('Ευρετήριο:', idx.entries, 'εγγραφές, maxPly', idx.maxPly);
console.log('Αρχική θέση: παρτίδες', idx.count(p.hashHi, p.hashLo));
const tree = idx.tree(p.hashHi, p.hashLo);
console.log('Δέντρο αρχικής θέσης:', tree?.moves.slice(0, 6));
const g = db.getGame(1);
console.log('Παρτίδα 1:', g?.headers, g?.tokens.length, 'tokens');
db.close();
