import { afterAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase } from '../src/server/db/store.ts';
import { importPgnFile, type ImportProgress } from '../src/server/db/importer.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-importprogress-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const pgn = (i: number) => `[Event "E${i}"]\n[White "Λευκός ${i}"]\n[Black "Μαύρος ${i}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n`;

// Στην εισαγωγή σε βάση με παρτίδες, οι παλιές ξαναπερνούν πρώτα στο ευρετήριο θέσεων.
// Ως τώρα δεν στελνόταν τίποτα σε αυτή τη φάση και η λωρίδα έδειχνε «0 παρτίδες».
it('εισαγωγή σε βάση με παρτίδες: πρόοδος και για τις παλιές που ξαναπερνούν στο ευρετήριο', async () => {
  const file = path.join(dir, 'base.kbdb');
  const db = new GameDatabase(file, { create: true });
  for (let i = 0; i < 30; i++) {
    const { game } = parseGame(pgn(i));
    const enc = encodeGame(game);
    db.insertGame({ headers: game.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: 4 });
  }
  const src = path.join(dir, 'new.pgn');
  fs.writeFileSync(src, Array.from({ length: 5 }, (_, i) => pgn(100 + i)).join('\n'));
  const seen: ImportProgress[] = [];
  const res = await importPgnFile(src, db, file.replace(/\.kbdb$/, ''), { onProgress: (p) => seen.push(p) });
  db.close();
  expect(res.phase).toBe('done');
  expect(res.games).toBe(5);
  const existing = seen.filter((p) => p.existing);
  expect(existing.length).toBeGreaterThan(0);
  expect(existing.every((p) => p.phase === 'reading' && p.existing!.total === 30)).toBe(true);
  expect(existing.at(-1)!.existing!.done).toBe(30);
  // μετά τη φάση των παλιών η πρόοδος είναι πάλι των νέων παρτίδων
  expect(seen.findIndex((p) => p.phase === 'indexing')).toBeGreaterThan(seen.indexOf(existing.at(-1)!));
  expect(seen.filter((p) => p.phase !== 'reading' || !p.existing).every((p) => p.existing === undefined)).toBe(true);
});
