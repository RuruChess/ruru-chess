import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_FORMAT, DbFormatError, GameDatabase } from '../src/server/db/store.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-format-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function metaFormat(file: string): string | null {
  const db = new DatabaseSync(file);
  const r = db.prepare("SELECT value FROM meta WHERE key = 'format'").get() as { value: string } | undefined;
  db.close();
  return r ? r.value : null;
}

function setFormat(file: string, value: string | null): void {
  const db = new DatabaseSync(file);
  if (value === null) db.prepare("DELETE FROM meta WHERE key = 'format'").run();
  else db.prepare("INSERT INTO meta(key, value) VALUES ('format', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
  db.close();
}

describe('μορφή αρχείου βάσης', () => {
  it('μια νέα βάση γράφει την τρέχουσα μορφή', () => {
    const file = path.join(dir, 'new.kbdb');
    new GameDatabase(file, { create: true }).close();
    expect(metaFormat(file)).toBe(String(DB_FORMAT));
  });

  it('μια παλιά βάση χωρίς «format» ανοίγει και δεν γράφεται τίποτα σε αυτήν', () => {
    const file = path.join(dir, 'old.kbdb');
    const g = new GameDatabase(file, { create: true, format: 1 });
    g.insertGame({ headers: { White: 'A', Black: 'B', Result: '1-0' }, tokens: new Uint16Array(0), comments: null, fen: null, flags: 0, plies: 0 });
    g.close();
    setFormat(file, null);
    const db = new GameDatabase(file);
    expect(db.count()).toBe(1);
    db.close();
    expect(metaFormat(file)).toBeNull();
  });

  it('μια βάση νεότερης μορφής δεν ανοίγει, ούτε για ανάγνωση, και μένει ανέγγιχτη', () => {
    const file = path.join(dir, 'future.kbdb');
    new GameDatabase(file, { create: true }).close();
    setFormat(file, String(DB_FORMAT + 1));
    const before = fs.readFileSync(file);
    expect(() => new GameDatabase(file)).toThrow(DbFormatError);
    expect(() => new GameDatabase(file, { reader: true })).toThrow(/νεότερη έκδοση/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});
