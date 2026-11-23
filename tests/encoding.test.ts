// Κωδικοποίηση PGN από δείγμα: το δείγμα του 1 MB κόβει συχνά ένα γράμμα στη μέση και δεν πρέπει να αλλάζει την απάντηση.
import { describe, expect, it } from 'vitest';
import { detectEncoding } from '../src/server/db/importer.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
/** Ελληνικά σε windows-1253: τα γράμματα Ά–ώ απέχουν 0x2d0 από το byte τους. */
const greek = (s: string) => Uint8Array.from(s, (c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : c.charCodeAt(0) - 0x2d0));
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** Τι βγαίνει για κάθε σημείο κοπής από το `from` ως το τέλος. */
const atEveryCut = (bytes: Uint8Array, from = 0) =>
  new Set(Array.from({ length: bytes.length - from + 1 }, (_, i) => detectEncoding(bytes.subarray(0, from + i))));

describe('detectEncoding', () => {
  it('UTF-8: κάθε σημείο κοπής (χαρακτήρες 1, 2, 3 και 4 bytes, και BOM)', () => {
    const text = utf8('﻿[White "Παπαδόπουλος, Γιώργος"]\n[Black "Müller"]\n\n1. e4 {καλή ♘ ιδέα 🙂} e5 *\n');
    expect([...atEveryCut(text)]).toEqual(['utf-8']);
  });

  it('UTF-8: δείγμα 1 MB που κόβεται μέσα σε ελληνικό γράμμα', () => {
    const word = utf8('αβγδεζ');
    for (let shift = 0; shift < word.length; shift++) {
      const sample = new Uint8Array(1 << 20).fill(32);
      const start = sample.length - 60 - shift;
      for (let i = start; i < sample.length; i++) sample[i] = word[(i - start) % word.length];
      expect(detectEncoding(sample), `μετατόπιση ${shift}`).toBe('utf-8');
    }
  });

  it('UTF-8: μικρό αρχείο που τελειώνει κοντά σε ελληνικό γράμμα', () => {
    for (const end of ['α', 'α}', 'α} ', 'α} *', 'α} *\n', '♘', '♘}']) expect(detectEncoding(utf8(`1. e4 {ιδέ${end}`)), end).toBe('utf-8');
  });

  it('windows-1253: μένει ελληνικό σε κάθε σημείο κοπής', () => {
    const text = greek('[White "Παπαδόπουλος, Γιώργος"]\n');
    expect([...atEveryCut(text, '[White "Πα'.length)]).toEqual(['windows-1253']);
  });

  it('windows-1253: ελληνικά μόνο στα 4 τελευταία bytes', () => {
    expect(detectEncoding(greek('1. e4 {ιδέα'))).toBe('windows-1253');
    expect(detectEncoding(greek('{ναι'))).toBe('windows-1253');
  });

  it('windows-1252: μένει δυτικό', () => {
    expect(detectEncoding(latin1('[Event "Championship of the city"]\n[White "Müller, Karsten"]\n[Black "Anderssen, Adolf"]\n\n1. e4 e5 *\n'))).toBe('windows-1252');
  });

  it('σκέτο ASCII και κενό: UTF-8', () => {
    expect([...atEveryCut(utf8('1. e4 e5 *\n'))]).toEqual(['utf-8']);
  });
});
