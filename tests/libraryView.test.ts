/** Τεστ: η αρχική των Βάσεων — αναζήτηση, φίλτρα, ταξινόμηση, ετικέτες είδους και η σήμανση «βιβλίο». */
import { describe, expect, it } from 'vitest';
import { originOf } from '../src/server/library.ts';
import type { DbInfo } from '../src/web/api.ts';
import { dbBadges, inFilter, matchesQuery, sortDbs, visibleDbs } from '../src/web/libraryView.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30);
const db = (id: string, o: Partial<DbInfo> = {}): DbInfo => ({ id, name: id, file: `${id}.skdb`, kind: 'user', games: 10, size: 1, busy: null, indexStale: false, created: NOW - 100 * DAY, ...o });

const LIST: DbInfo[] = [
  db('mine', { name: 'Οι παρτίδες μου', kind: 'mygames', games: 12, lastOpened: NOW - 2 * DAY }),
  db('clip', { name: 'Πρόχειρο', kind: 'clipboard', games: 0, created: NOW - 300 * DAY }),
  db('lumbras', { name: 'Lumbras Elite 2400+', kind: 'imported', games: 1_029_950, lastOpened: NOW - 60 * DAY }),
  db('krykun', { name: 'A Complete Repertoire for Black after 1.e4 e5!', kind: 'imported', games: 44, origin: 'book', lastOpened: NOW - DAY }),
  db('watson', { name: 'Play the French', kind: 'imported', games: 203, origin: 'book', source: { path: 'C:\\Users\\x\\Downloads\\watson-french.pgn', size: 1, mtime: 1, kind: 'pgn' } }),
  db('rep', { name: 'Ρεπερτόριο λευκά', games: 150_000, lastOpened: NOW - 10 * DAY }),
];
const ctx = { favorites: ['rep', 'clip'], now: NOW };

describe('Βάσεις: φίλτρα', () => {
  it('Αγαπημένες, Βιβλία, Μεγάλες (≥100k), Πρόσφατες (30 μέρες)', () => {
    const ids = (f: Parameters<typeof inFilter>[1]) => LIST.filter((d) => inFilter(d, f, ctx)).map((d) => d.id);
    expect(ids('all')).toHaveLength(LIST.length);
    expect(ids('fav')).toEqual(['clip', 'rep']);
    expect(ids('books')).toEqual(['krykun', 'watson']);
    expect(ids('big')).toEqual(['lumbras', 'rep']);
    expect(ids('recent')).toEqual(['mine', 'krykun', 'rep']);
  });
});

describe('Βάσεις: αναζήτηση', () => {
  it('χωρίς τόνους και κεφαλαία, όλες οι λέξεις, και στο όνομα του αρχείου', () => {
    expect(matchesQuery(LIST[0], 'παρτιδες')).toBe(true);
    expect(matchesQuery(LIST[0], 'ΠΑΡΤΊΔΕΣ μου')).toBe(true);
    expect(matchesQuery(LIST[0], 'παρτίδες λευκά')).toBe(false);
    expect(matchesQuery(LIST[4], 'watson')).toBe(true);
    expect(matchesQuery(LIST[2], '')).toBe(true);
  });
  it('μαζί με φίλτρο και ταξινόμηση', () => {
    expect(visibleDbs(LIST, 'e', 'books', 'name', ctx).map((d) => d.id)).toEqual(['krykun', 'watson']);
    expect(visibleDbs(LIST, 'french', 'all', 'recent', ctx).map((d) => d.id)).toEqual(['watson']);
  });
});

describe('Βάσεις: ταξινόμηση', () => {
  it('πρόσφατο άνοιγμα (αλλιώς δημιουργία), όνομα, πλήθος παρτίδων', () => {
    expect(sortDbs(LIST, 'recent').map((d) => d.id)).toEqual(['krykun', 'mine', 'rep', 'lumbras', 'watson', 'clip']);
    expect(sortDbs(LIST, 'games').map((d) => d.id).slice(0, 3)).toEqual(['lumbras', 'rep', 'watson']);
    // ελληνική σειρά: πρώτα τα ελληνικά ονόματα, μετά τα λατινικά
    expect(sortDbs(LIST, 'name').map((d) => d.name)).toEqual(['Οι παρτίδες μου', 'Πρόχειρο', 'Ρεπερτόριο λευκά', 'A Complete Repertoire for Black after 1.e4 e5!', 'Lumbras Elite 2400+', 'Play the French']);
  });
});

describe('Βάσεις: ετικέτες είδους', () => {
  it('Αναφορά, Βιβλίο, Οι παρτίδες μου, Πρόχειρο', () => {
    expect(dbBadges(LIST[2], 'lumbras')).toEqual(['reference']);
    expect(dbBadges(LIST[3], 'lumbras')).toEqual(['book']);
    expect(dbBadges(LIST[0], null)).toEqual(['mygames']);
    expect(dbBadges(LIST[1], undefined)).toEqual(['clipboard']);
    expect(dbBadges(LIST[5], 'lumbras')).toEqual([]);
  });
  it('οι παλιές βάσεις του «Βιβλίο σε βάση» αναγνωρίζονται από το προσωρινό PGN τους', () => {
    expect(originOf({ source: { path: 'C:\\Users\\u\\AppData\\Local\\Temp\\knightbase-book\\ab12\\Krykun.pgn', size: 1, mtime: 1, kind: 'pgn' } })).toBe('book');
    expect(originOf({ source: { path: '/tmp/knightbase-book/ab12/x.pgn', size: 1, mtime: 1, kind: 'pgn' } })).toBe('book');
    // από πριν από τη μετονομασία
    expect(originOf({ source: { path: 'C:\\Users\\u\\AppData\\Local\\Temp\\skakibase-book\\ab12\\Krykun.pgn', size: 1, mtime: 1, kind: 'pgn' } })).toBe('book');
    expect(originOf({ source: { path: 'C:\\Downloads\\games.pgn', size: 1, mtime: 1, kind: 'pgn' } })).toBeUndefined();
    expect(originOf({ origin: 'book' })).toBe('book');
    expect(originOf({})).toBeUndefined();
  });
});
