/**
 * Εξωτερικοί σύνδεσμοι: με Electron τους ανοίγει το ίδιο το Electron (είναι μπροστά, άρα και ο browser έρχεται μπροστά)·
 * από τον server, που τρέχει στο παρασκήνιο, η σελίδα άνοιγε πίσω από την εφαρμογή.
 */
import { expect, it } from 'vitest';
import { openExternal, setWindowDelegate, type HostMessage } from '../src/server/window.ts';

it('με συνδεδεμένο Electron ο σύνδεσμος πάει σε αυτό, όχι στον browser από τον server', () => {
  const got: HostMessage[] = [];
  const detach = setWindowDelegate((m) => {
    got.push(m);
    return true;
  });
  openExternal('https://github.com/RuruChess/ruru-chess');
  detach();
  expect(got).toEqual([{ type: 'open-link', url: 'https://github.com/RuruChess/ruru-chess' }]);
});
