import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase } from '../src/server/db/store.ts';
import { packJson, unpackJson } from '../src/server/db/pack.ts';
import { parseGame } from '../src/core/pgn.ts';
import { GF_COMMENTS, encodeGame, decodeGame } from '../src/core/codec.ts';
import { searchKey, parsePgnDate } from '../src/server/text.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-test-'));
const db = new GameDatabase(path.join(dir, 'test.skdb'), { create: true });
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function toNew(pgn: string) {
  const { game } = parseGame(pgn);
  const enc = encodeGame(game);
  return { headers: game.headers, tokens: enc.tokens, comments: enc.comments.length ? enc.comments : null, fen: null, flags: enc.flags, plies: game.plyCount() };
}

describe('pack', () => {
  it('συμπιέζει και αποσυμπιέζει', () => {
    const big = Array.from({ length: 200 }, (_, i) => `[%clk 0:${String(i % 60).padStart(2, '0')}:00]`);
    const p = packJson(big);
    expect(p[0]).toBe(1);
    expect(p.length).toBeLessThan(JSON.stringify(big).length / 3);
    expect(unpackJson(p)).toEqual(big);
    expect(unpackJson(packJson({ a: 'β' }))).toEqual({ a: 'β' });
    expect(unpackJson('["παλιό"]')).toEqual(['παλιό']);
  });
});

describe('store', () => {
  const g1 = toNew('[Event "Πρωτάθλημα"]\n[White "Παπαδόπουλος, Γιώργος"]\n[Black "Smith, John"]\n[Result "1-0"]\n[Date "2023.05.01"]\n[WhiteFideId "4200000"]\n\n1. e4 {[%clk 1:00:00]} e5 2. Nf3 {καλή} Nc6 1-0');
  const g2 = toNew('[Event "Open"]\n[White "Smith, John"]\n[Black "Νικολάου, Άννα"]\n[Result "0-1"]\n[WhiteElo "2100"]\n\n1. d4 d5 0-1');

  it('μαζική εισαγωγή και ανάγνωση', () => {
    db.beginBulk();
    db.insertBatch([g1, g2], 1);
    db.endBulk();
    expect(db.count()).toBe(2);
    const a = db.getGame(1)!;
    expect(a.headers.White).toBe('Παπαδόπουλος, Γιώργος');
    expect(a.headers.WhiteFideId).toBe('4200000');
    expect(a.headers.Date).toBe('2023.05.01');
    const game = decodeGame(a.tokens, a.comments);
    expect(game.mainline()[0].clock).toBe('1:00:00');
    expect(game.mainline()[2].comment).toBe('καλή');
    expect(db.getGame(2)!.row.welo).toBe(2100);
  });

  it('αναζήτηση χωρίς τόνους και με αντίστροφα χρώματα', () => {
    expect(Array.from(db.search({ white: 'παπαδοπουλος' }))).toEqual([1]);
    expect(Array.from(db.search({ white: 'Νικολαου', ignoreColors: true }))).toEqual([2]);
    expect(Array.from(db.search({ player: 'smith' }))).toEqual([1, 2]);
    expect(Array.from(db.search({ results: [3] }))).toEqual([2]);
    // όνομα με τη σειρά «Όνομα Επώνυμο», ή επώνυμο και όνομα χωρίς κόμμα, ή με αρχικό
    expect(Array.from(db.search({ white: 'John Smith' }))).toEqual([2]);
    expect(Array.from(db.search({ white: 'Γιώργος Παπαδόπουλος' }))).toEqual([1]);
    expect(Array.from(db.search({ player: 'smith john' }))).toEqual([1, 2]);
    expect(Array.from(db.search({ player: 'J Smith' }))).toEqual([1, 2]);
    expect(Array.from(db.search({ player: 'Mary Smith' }))).toEqual([]);
    expect(db.players('John Smith').map((p) => p.name)).toEqual(['Smith, John']);
    expect(Array.from(db.sortIds(Int32Array.from([1, 2]), 'white', false))).toEqual([2, 1]);
  });

  it('διπλές παρτίδες', () => {
    const dup = db.insertGame(g1);
    // ίδιο κλειδί (παίκτες, αποτέλεσμα, ημικινήσεις, έτος) αλλά άλλες κινήσεις
    db.insertGame(toNew('[White "Παπαδόπουλος, Γιώργος"]\n[Black "Smith, John"]\n[Result "1-0"]\n[Date "2023.09.09"]\n\n1. e4 e5 2. Nf3 Nf6 1-0'));
    expect(Array.from(db.doubleIds())).toEqual([dup]);
    // ποσοστό προόδου: από 0 ως το τέλος, χωρίς να πηγαίνει πίσω, και ίδιο αποτέλεσμα
    const steps: Array<[number, number]> = [];
    expect(Array.from(db.doubleIds((done, total) => steps.push([done, total])))).toEqual([dup]);
    expect(steps[0][0]).toBe(0);
    expect(steps.at(-1)![0]).toBe(steps.at(-1)![1]);
    expect(steps.every(([d, t], i) => t === steps[0][1] && (i === 0 || d >= steps[i - 1][0]))).toBe(true);
    // η διαγραμμένη δεν μετρά: η αντιγραφή μένει μόνη της
    db.setDeleted([1], true);
    expect(Array.from(db.doubleIds())).toEqual([]);
    db.setDeleted([1], false);
  });

  it('αφαίρεση σχολιασμού (UnAnnotateDB)', () => {
    expect(Array.from(db.idsWithFlags(GF_COMMENTS))).toContain(1);
    db.stripGames([1], { comments: true });
    const g = db.getGame(1)!;
    const game = decodeGame(g.tokens, g.comments);
    expect(game.plyCount()).toBe(4);
    expect(game.mainline()[2].comment).toBe('');
    expect(game.mainline()[0].clock).toBe('');
    expect(Array.from(db.idsWithFlags(GF_COMMENTS))).not.toContain(1);
  });

  it('οριστική διαγραφή επιλεγμένων (Delete)', () => {
    const a = db.insertGame(g2);
    const b = db.insertGame(g2);
    const before = db.count();
    // ανύπαρκτη παρτίδα: δεν μετρά
    expect(db.deleteGames([a, 999999])).toBe(1);
    expect(db.count()).toBe(before - 1);
    expect(db.getGame(a)).toBeNull();
    expect(db.getGame(b)).not.toBeNull();
  });

  it('βοηθητικά', () => {
    expect(searchKey('Παπαδόπουλος')).toBe('παπαδοπουλοσ');
    expect(parsePgnDate('2004.??.??')).toBe(20040000);
    expect(parsePgnDate('????.??.??')).toBe(0);
  });
});
