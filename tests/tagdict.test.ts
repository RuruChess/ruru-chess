import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_FORMAT, GameDatabase, type NewGame } from '../src/server/db/store.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-tagdict-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function game(h: Record<string, string>, moves = '1. e4 {σχόλιο} e5 (1... c5) 2. Nf3 *'): NewGame {
  const tags = Object.entries(h)
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n');
  const { game: g } = parseGame(`${tags}\n\n${moves}`);
  const enc = encodeGame(g);
  return { headers: g.headers, tokens: enc.tokens, comments: enc.comments.length ? enc.comments : null, fen: null, flags: enc.flags, plies: 3 };
}

/** Ετικέτες όπως της Lumbras/Greekbase (σχεδόν ίδιες σε κάθε παρτίδα) και μερικές μοναδικές. */
function sample(i: number): Record<string, string> {
  const h: Record<string, string> = {
    Event: i % 3 ? 'Πανελλήνιο Ατομικό' : 'Blitz Open',
    Site: 'Αθήνα',
    Date: `20${10 + (i % 10)}.0${1 + (i % 9)}.1${i % 10}`,
    White: `Παίκτης ${i % 17}`,
    Black: `Player ${i % 13}`,
    Result: ['1-0', '0-1', '1/2-1/2'][i % 3],
    Source: 'GreekBase',
    SourceQuality: String(1 + (i % 2)),
    ImportDate: '2026-10-12',
    IdentityEvidenceWhite: i % 4 ? 'Confirmed' : 'NoMatch',
  };
  if (i % 2) h.WhiteFideId = String(4200000 + (i % 17));
  if (i % 5) h.BlackFideId = String(4300000 + (i % 13));
  if (i % 7 === 0) h.WhiteTitle = 'ΓΜ';
  if (i % 3 === 0) h.TimeControl = '180+2';
  h.GameId = String(2046469818446200 + i);
  return h;
}

/** Ό,τι διαβάζει η εφαρμογή από μια παρτίδα (με τη σειρά των ετικετών). */
function readAll(db: GameDatabase): unknown[] {
  return Array.from(db.allIds()).map((id) => {
    const g = db.getGame(id)!;
    return [id, Object.entries(g.headers), Array.from(g.tokens), g.comments, g.fen, g.row];
  });
}

function columns(file: string): { games: string[]; tables: string[] } {
  const db = new DatabaseSync(file);
  const games = (db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>).map((c) => c.name);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
  db.close();
  return { games, tables };
}

describe('λεξικό ετικετών (μορφή 2)', () => {
  it('νέα βάση: στήλη tagdata (όχι tags) και πίνακες λεξικού· οι ετικέτες διαβάζονται ίδιες και με τη σειρά τους', () => {
    expect(DB_FORMAT).toBe(2);
    const file = path.join(dir, 'new.kbdb');
    const db = new GameDatabase(file, { create: true });
    expect(db.format).toBe(2);
    const h = sample(1);
    const id = db.insertGame(game(h));
    db.insertBatch([game(sample(2)), game(sample(3))], id + 1);
    const back = db.getGame(id)!.headers;
    const extra = Object.entries(back).filter(([k]) => !['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'].includes(k));
    expect(extra).toEqual(Object.entries(h).filter(([k]) => !['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'].includes(k)));
    expect(db.getGame(id + 2)!.headers.TimeControl).toBe('180+2');
    db.close();
    const c = columns(file);
    expect(c.games).toContain('tagdata');
    expect(c.games).not.toContain('tags');
    expect(c.tables).toEqual(expect.arrayContaining(['tagkeys', 'tagvals']));
  });

  it('ίδια αποτελέσματα με τη μορφή 1: αλλαγή παρτίδας, addTags, fideIdOf, fideTags, ρυθμός', () => {
    const run = (format: number) => {
      const db = new GameDatabase(path.join(dir, `same-${format}.kbdb`), { create: true, format });
      expect(db.format).toBe(format);
      for (let i = 0; i < 40; i++) db.insertGame(game(sample(i)));
      db.replaceGame(5, game({ ...sample(5), Annotator: 'Μπανίκας', NewTag: 'τιμή «με» εισαγωγικά', Σχόλιο: 'ελληνικό όνομα' }, '1. d4 d5 *'));
      db.addTags([
        { id: 1, tags: { WhiteFideId: '4209999', Extra: 'x' } },
        { id: 2, tags: { BlackFideId: '4300001' } },
      ]);
      const out = {
        games: readAll(db),
        fide: [...db.fideTags()],
        fideOf: [db.fideIdOf(db.playerIdByName('Παίκτης 1')!), db.fideIdOf(db.playerIdByName('Player 1')!)],
        speeds: Array.from(db.eventSpeeds()),
        blitz: Array.from(db.search({ speeds: 4 })),
        added: db.getGame(1)!.headers,
        replaced: db.getGame(5)!.headers,
      };
      db.close();
      return out;
    };
    const v1 = run(1);
    const v2 = run(2);
    expect(v2).toEqual(v1);
    expect(v1.added).toMatchObject({ WhiteFideId: '4209999', Extra: 'x' });
    expect(v1.replaced['Σχόλιο']).toBe('ελληνικό όνομα');
    expect(v1.fideOf[0]).toMatch(/^42000\d\d$/);
    expect(v1.blitz.length).toBeGreaterThan(0);
  });

  it('κλειδιά με μοναδικές τιμές (GameId) περνούν μέσα στην παρτίδα· τα επαναλαμβανόμενα μένουν στο λεξικό', () => {
    const file = path.join(dir, 'inline.kbdb');
    const db = new GameDatabase(file, { create: true });
    db.beginBulk();
    db.insertBatch(
      Array.from({ length: 3000 }, (_, i) => game(sample(i))),
      1,
    );
    db.endBulk();
    for (const id of [1, 2500, 3000]) expect(db.getGame(id)!.headers.GameId).toBe(String(2046469818446200 + id - 1));
    const keys = db.db.prepare('SELECT name, inline FROM tagkeys').all() as Array<{ name: string; inline: number }>;
    expect(keys.find((k) => k.name === 'GameId')?.inline).toBe(1);
    expect(keys.find((k) => k.name === 'Source')?.inline).toBe(0);
    expect(keys.find((k) => k.name === 'WhiteFideId')?.inline).toBe(0);
    const vals = (db.db.prepare('SELECT count(*) AS n FROM tagvals').get() as { n: number }).n;
    // τα πρώτα 2.000 GameId πήγαν στο λεξικό, τα επόμενα μέσα στην παρτίδα
    expect(vals).toBeLessThan(2100);
    db.close();
  });

  it('μετά από ROLLBACK δεν μένουν αναφορές σε τιμές που χάθηκαν', () => {
    const db = new GameDatabase(path.join(dir, 'rollback.kbdb'), { create: true });
    db.db.exec('BEGIN');
    db.insertGame(game({ White: 'A', Black: 'B', Result: '1-0', Unique: 'πρώτη τιμή' }));
    db.rollback();
    const id = db.insertGame(game({ White: 'A', Black: 'B', Result: '1-0', Unique: 'πρώτη τιμή', Other: 'δεύτερη' }));
    expect(db.getGame(id)!.headers).toMatchObject({ White: 'A', Unique: 'πρώτη τιμή', Other: 'δεύτερη' });
    db.close();
    // και από νέα σύνδεση (χωρίς κρυφές μνήμες)
    const again = new GameDatabase(path.join(dir, 'rollback.kbdb'));
    expect(again.getGame(id)!.headers).toMatchObject({ White: 'A', Unique: 'πρώτη τιμή', Other: 'δεύτερη' });
    again.close();
  });

  it('δεύτερη σύνδεση βλέπει κλειδιά/τιμές που πρόσθεσε η πρώτη', () => {
    const file = path.join(dir, 'two.kbdb');
    const a = new GameDatabase(file, { create: true });
    const b = new GameDatabase(file);
    a.insertGame(game({ White: 'A', Black: 'B', Result: '1-0', Common: 'ένα' }));
    expect(b.getGame(1)!.headers.Common).toBe('ένα');
    b.insertGame(game({ White: 'A', Black: 'B', Result: '1-0', Common: 'ένα', Newer: 'δύο' }));
    expect(a.getGame(2)!.headers).toMatchObject({ Common: 'ένα', Newer: 'δύο' });
    a.insertGame(game({ White: 'A', Black: 'B', Result: '1-0', Newer: 'δύο' }));
    expect(b.getGame(3)!.headers.Newer).toBe('δύο');
    a.close();
    b.close();
  });
});

describe('παλιές βάσεις (μορφή 1)', () => {
  it('διαβάζονται και γράφονται όπως πριν, χωρίς πίνακες λεξικού και χωρίς αλλαγή μορφής', () => {
    const file = path.join(dir, 'old.kbdb');
    const make = new GameDatabase(file, { create: true, format: 1 });
    for (let i = 0; i < 10; i++) make.insertGame(game(sample(i)));
    make.close();
    // όπως οι βάσεις ως την 2.2.0: χωρίς «format»
    const raw = new DatabaseSync(file);
    raw.exec("DELETE FROM meta WHERE key = 'format'");
    raw.close();
    const before = columns(file);
    const db = new GameDatabase(file);
    expect(db.format).toBe(1);
    expect(db.getGame(3)!.headers.Source).toBe('GreekBase');
    db.insertGame(game({ ...sample(11), NewTag: 'ναι' }));
    expect(db.getGame(11)!.headers.NewTag).toBe('ναι');
    db.close();
    expect(columns(file)).toEqual(before);
    expect(before.games).toContain('tags');
    expect(before.tables).not.toContain('tagkeys');
    const check = new DatabaseSync(file);
    expect(check.prepare("SELECT value FROM meta WHERE key = 'format'").get()).toBeUndefined();
    check.close();
  });
});

describe('μετατροπή μορφής 1 → 2', () => {
  function oldDb(name: string, n: number): string {
    const file = path.join(dir, name);
    const db = new GameDatabase(file, { create: true, format: 1 });
    for (let i = 0; i < n; i++) db.insertGame(game(sample(i)));
    db.setDeleted([2], true);
    db.close();
    return file;
  }

  it('ίδιες παρτίδες, ίδια id, αντίγραφο ασφαλείας ίδιο με το αρχικό αρχείο', async () => {
    const file = oldDb('conv.kbdb', 120);
    // χαλασμένες ετικέτες σε μία παρτίδα (η ανάγνωση τις αγνοεί και πριν και μετά)
    const raw = new DatabaseSync(file);
    raw.prepare('UPDATE games SET tags = ? WHERE id = 7').run(Uint8Array.from([0, 123, 34]));
    raw.prepare('DELETE FROM games WHERE id = 50').run();
    raw.prepare('DELETE FROM moves WHERE id = 50').run();
    raw.close();
    const old = new GameDatabase(file);
    // (το fideTags της μορφής 1 σκάει σε χαλασμένες ετικέτες· μετά τη μετατροπή είναι απλώς κενές)
    const expected = { games: readAll(old), speeds: Array.from(old.eventSpeeds()) };
    old.close();
    // μετά την ανάγνωση (το count() γράφει το meta «count»)
    const original = fs.readFileSync(file);
    const progress: number[] = [];
    const r = await GameDatabase.convertToCurrentFormat(file, { onProgress: (done) => progress.push(done) });
    expect(r.backup).toBe(`${file}.bak`);
    expect(fs.readFileSync(r.backup).equals(original)).toBe(true);
    expect(fs.existsSync(`${file}.convert`)).toBe(false);
    expect(progress.at(-1)).toBe(119);
    const db = new GameDatabase(file);
    expect(db.format).toBe(2);
    expect({ games: readAll(db), speeds: Array.from(db.eventSpeeds()) }).toEqual(expected);
    expect([...db.fideTags()].length).toBe(118);
    expect(db.getGame(7)!.headers.Source).toBeUndefined();
    expect(db.getMeta('format')).toBe('2');
    db.close();
    expect(columns(file).games).not.toContain('tags');
    await expect(GameDatabase.convertToCurrentFormat(file)).rejects.toThrow(/ήδη/);
    expect(fs.existsSync(`${file}.2.bak`)).toBe(false);
  });

  it('ακύρωση: το αρχικό αρχείο μένει ανέγγιχτο και δεν μένουν μισά αρχεία', async () => {
    const file = oldDb('cancel.kbdb', 30);
    const original = fs.readFileSync(file);
    const ac = new AbortController();
    ac.abort();
    await expect(GameDatabase.convertToCurrentFormat(file, { signal: ac.signal })).rejects.toThrow();
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('cancel.kbdb.'))).toEqual([]);
    const db = new GameDatabase(file);
    expect(db.format).toBe(1);
    db.close();
  });
});
