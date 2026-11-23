/**
 * Τεστ: μετονομασία SkakiBase → KnightBase. Οι φάκελοι μεταφέρονται, ο κατάλογος κρατά όλες τις βάσεις (με τα
 * ίδια id) και οι ρυθμίσεις δείχνουν στον νέο φάκελο· οι νέες βάσεις είναι .kbdb, χωρίς να συγκρούονται με παλιές .skdb.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GameDatabase } from '../src/server/db/store.ts';
import { migrateFromSkakiBase } from '../src/server/rename.ts';

// ψεύτικος προσωπικός φάκελος, πριν φορτωθούν τα paths.ts / library.ts (διαλέγουν φακέλους στη φόρτωση)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-rename-'));
const env = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA };
Object.assign(process.env, { USERPROFILE: home, HOME: home, LOCALAPPDATA: path.join(home, 'Local'), APPDATA: path.join(home, 'Roaming') });

const docs = path.join(home, 'Documents');
const oldDir = path.join(docs, 'SkakiBase');
const newDir = path.join(docs, 'KnightBase');
const oldDb = (name: string) => path.join(oldDir, `${name}.skdb`);

// η κατάσταση της παλιάς έκδοσης: βάσεις, κατάλογος, ρυθμίσεις (με μηχανή μέσα στον φάκελο), προφίλ παραθύρων
fs.mkdirSync(path.join(oldDir, '.skakibase', 'training'), { recursive: true });
fs.mkdirSync(path.join(home, 'Local', 'SkakiBase', 'browser'), { recursive: true });
for (const name of ['Οι παρτίδες μου', 'Πρόχειρο', 'Greekbase']) new GameDatabase(oldDb(name), { create: true }).close();
fs.writeFileSync(path.join(oldDir, 'Greekbase.pos'), '');
fs.writeFileSync(
  path.join(oldDir, '.skakibase', 'library.json'),
  JSON.stringify([
    { id: 'aaa', name: 'Οι παρτίδες μου', file: oldDb('Οι παρτίδες μου'), kind: 'mygames', created: 1 },
    { id: 'bbb', name: 'Πρόχειρο', file: oldDb('Πρόχειρο'), kind: 'clipboard', created: 1 },
    { id: 'ccc', name: 'Greekbase', file: oldDb('Greekbase').replace(/\\/g, '/'), kind: 'imported', created: 1, source: { path: 'C:\\Σκάκι\\Greekbase.pgn', size: 1, mtime: 1, kind: 'pgn' } },
  ]),
);
const sf = path.join(oldDir, 'engines', 'Stockfish', 'sf.exe');
fs.writeFileSync(path.join(oldDir, '.skakibase', 'settings.json'), JSON.stringify({ databasesDir: oldDir, engines: [{ id: 'sf', name: 'Stockfish', path: sf }], ui: { referenceDb: 'ccc' } }));

afterAll(() => {
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('μετονομασία SkakiBase → KnightBase', () => {
  it('μετονομάζει τους φακέλους (βάσεις, ρυθμίσεις, προφίλ παραθύρων)', () => {
    migrateFromSkakiBase(1); // θύρα 1: δεν τρέχει server
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(path.join(newDir, '.knightbase', 'library.json'))).toBe(true);
    expect(fs.existsSync(path.join(newDir, '.skakibase'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'Local', 'KnightBase', 'browser'))).toBe(true);
    // δεύτερη φορά: τίποτα
    migrateFromSkakiBase(1);
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('ο κατάλογος κρατά όλες τις βάσεις και οι ρυθμίσεις δείχνουν στον νέο φάκελο', async () => {
    const { APP_DIR, defaultDatabasesDir } = await import('../src/server/paths.ts');
    expect(defaultDatabasesDir()).toBe(newDir);
    expect(APP_DIR).toBe(path.join(newDir, '.knightbase'));
    const { Library } = await import('../src/server/library.ts');
    const lib = new Library();
    expect(lib.entries.map((e) => [e.id, e.file])).toEqual([
      ['aaa', path.join(newDir, 'Οι παρτίδες μου.skdb')],
      ['bbb', path.join(newDir, 'Πρόχειρο.skdb')],
      ['ccc', path.join(newDir, 'Greekbase.skdb')],
    ]);
    expect(lib.entries[2].source?.path).toBe('C:\\Σκάκι\\Greekbase.pgn');
    expect(lib.settings.databasesDir).toBe(newDir);
    expect(lib.settings.engines[0].path).toBe(path.join(newDir, 'engines', 'Stockfish', 'sf.exe'));
    // γράφτηκαν και στον δίσκο
    const saved = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'settings.json'), 'utf8')) as { databasesDir: string };
    expect(saved.databasesDir).toBe(newDir);

    // νέες βάσεις: .kbdb, χωρίς να πάρουν το όνομα (και τα .pos/.tree) μιας παλιάς .skdb
    expect(lib.create('Νέα').file).toBe(path.join(newDir, 'Νέα.kbdb'));
    expect(lib.create('Greekbase').file).toBe(path.join(newDir, 'Greekbase (2).kbdb'));
    expect(lib.openFile(path.join(newDir, 'Greekbase.skdb')).entry.id).toBe('ccc');
  });
});
