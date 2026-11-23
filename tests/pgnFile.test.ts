import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { checkPgnFile, pgnForSending, readCapped } from '../src/core/pgnFile.ts';
import { FILE_DAYS, FILE_MAX, cleanFileName } from '../src/core/social.ts';
import { parseGame, writeGame } from '../src/core/pgn.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const GAME = '[Event "Test"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0\n';
const games = (d: Uint8Array) => {
  const r = checkPgnFile(d);
  return 'error' in r ? r.error : r.games;
};

describe('αποστολή αρχείων: μόνο PGN', () => {
  it('τα όρια είναι 1 MB και 7 μέρες', () => {
    expect(FILE_MAX).toBe(1024 * 1024);
    expect(FILE_DAYS).toBe(7);
  });

  it('δέχεται κανονικό PGN', () => {
    const ok: Array<[string, string, number]> = [
      ['απλό', GAME, 1],
      ['δύο παρτίδες, CRLF', `${GAME}\n${GAME}`.replace(/\n/g, '\r\n'), 2],
      ['BOM', `﻿${GAME}`, 1],
      ['ελληνικά και σχόλια', '[White "Παπαδόπουλος, Γιώργος"]\n[Σχόλιο "δικό μου"]\n\n{Πριν} 1. d4 $1 {[%clk 0:03:00] καλό [%cal Gd2d4]} 1... d5 *', 1],
      ['φωλιασμένες βαριάντες', '[Event "v"]\n\n1. e4 (1. d4 d5 (1... Nf6 2. c4 (2. Nf3))) 1... e5 *', 1],
      ['ροκέ, προαγωγή, κενή κίνηση', '[Event "m"]\n\n1. O-O O-O-O+ 2. exd8=Q# -- 3. Nbd2!? R1xa3 *', 1],
      ['μόνο θέση', '[SetUp "1"]\n[FEN "8/8/8/8/8/4k3/4P3/4K3 w - - 0 1"]\n\n*', 1],
      ['εισαγωγικά μέσα σε ετικέτα', '[Event "το \\"κύπελλο\\" \\\\ 2026"]\n\n1. e4 *', 1],
      ['ετικέτα με παύλα', '[Event-Date "2026.11.22"]\n\n1. e4 *', 1],
      ['μακρύ URL με παύλες σε ετικέτα', `[ECOUrl "https://www.chess.com/openings/${'a-b-c-d-'.repeat(40)}"]\n\n1. e4 *`, 1],
      ['κενή παρτίδα δίπλα σε κανονική', `[Event "κενή"]\n\n*\n\n${GAME}`, 2],
    ];
    for (const [name, text, n] of ok) expect(games(bytes(text)), name).toBe(n);
  });

  it('κόβει δυαδικά αρχεία, όπως κι αν λέγονται', () => {
    const cbh = new Uint8Array(46 + 46);
    cbh.set([0x00, 0x00, 0x2c, 0x00, 0x2e, 0x01]);
    const bad: Array<[string, Uint8Array]> = [
      ['PNG', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)],
      ['JPEG', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46)],
      ['GIF', bytes('GIF89a\u0001\u0000\u0001\u0000')],
      ['ZIP', Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0)],
      ['RAR', Uint8Array.of(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0)],
      ['EXE', Uint8Array.of(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0)],
      ['gzip με PGN μέσα', new Uint8Array(zlib.gzipSync(GAME))],
      ['.cbh', cbh],
      ['UTF-16', new Uint8Array(Buffer.from(`﻿${GAME}`, 'utf16le'))],
      ['PGN και μετά ZIP', new Uint8Array([...bytes(GAME), 0x50, 0x4b, 0x03, 0x04, 0, 0])],
      ['PGN και μετά JPEG', new Uint8Array([...bytes(GAME), 0xff, 0xd8, 0xff, 0xe0])],
      ['NUL μέσα σε σχόλιο', bytes('[Event "x"]\n\n1. e4 {a\u0000b} *')],
      ['C1 μέσα σε σχόλιο', bytes('[Event "x"]\n\n1. e4 {a\u0085b} *')],
    ];
    for (const [name, data] of bad) expect(games(data), name).toBe('notpgn');
  });

  it('κόβει κείμενο που δεν είναι PGN', () => {
    const bad: Array<[string, string]> = [
      ['άδειο', ''],
      ['μόνο κενά', ' \n\n'],
      ['σκέτο κείμενο', 'Γεια σου, σου στέλνω τις παρτίδες μου'],
      ['HTML', '<!doctype html><script>alert(1)</script>'],
      ['SVG', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
      ['PDF', '%PDF-1.7\n1 0 obj'],
      ['JSON', '[{"Event":"x"}]'],
      ['κινήσεις χωρίς ετικέτες', '1. e4 e5 *'],
      ['ούτε κίνηση ούτε θέση', '[Event "x"]\n\n{μόνο κείμενο} *'],
      ['κείμενο στις κινήσεις', '[Event "x"]\n\n1. e4 hello *'],
      ['χωρίς αποτέλεσμα', '[Event "x"]\n\n1. e4 e5'],
      ['κείμενο μετά το αποτέλεσμα', `${GAME}περισσευούμενο`],
      ['HTML μετά το αποτέλεσμα', `${GAME}<script>1</script>`],
      ['ανοιχτό σχόλιο', '[Event "x"]\n\n1. e4 {χωρίς τέλος *'],
      ['ανοιχτή βαριάντα', '[Event "x"]\n\n1. e4 (1. d4 *'],
      ['παρένθεση που περισσεύει', '[Event "x"]\n\n1. e4 ) *'],
      ['υπερβολικό βάθος', `[Event "x"]\n\n1. e4 ${'('.repeat(600)}1. d4${')'.repeat(600)} *`],
      ['γραμμή διαφυγής %', '[Event "x"]\n\n%κρυφό\n1. e4 *'],
      ['σχόλιο ;', '[Event "x"]\n\n1. e4 ; κρυφό\n*'],
      ['εικόνα data URI', '[Event "x"]\n\n1. e4 {data:image/png;base64,iVBORw0KGgo=} *'],
      ['base64 σε σχόλιο', `[Event "x"]\n\n1. e4 {${'QUJD'.repeat(80)}} *`],
      ['τεράστια ετικέτα', `[Event "${'α '.repeat(1100)}"]\n\n1. e4 *`],
    ];
    for (const [name, text] of bad) expect(games(bytes(text)), name).toBe('notpgn');
  });

  it('1 MB ακριβώς περνά, ένα byte παραπάνω όχι', () => {
    const head = '[Event "x"]\n\n1. e4 {';
    const tail = '} *';
    const room = FILE_MAX - head.length - tail.length;
    const fill = 'word '.repeat(Math.ceil(room / 5)).slice(0, room);
    expect(games(bytes(head + fill + tail))).toBe(1);
    expect(games(bytes(`${head + fill + tail}\n`))).toBe('large');
  });

  it('κακόβουλο αρχείο 1 MB δεν κολλά τον έλεγχο', () => {
    const n = FILE_MAX - 64;
    const nasty = ['a'.repeat(n), `[Event "x"]\n\n${'1.'.repeat(n / 2)}`, `[E "${'\\\\'.repeat(n / 2)}"]`, `[E "x"]\n\n${'('.repeat(n)}`, `[E "x"]\n\n1. e4 {${'ab/+ '.repeat(n / 5)}} *`];
    for (const s of nasty) {
      const t = performance.now();
      checkPgnFile(bytes(s));
      expect(performance.now() - t).toBeLessThan(3000);
    }
  });

  it('ό,τι εξάγει το Ruru για αποστολή περνά, και διαβάζεται ίδιο', () => {
    const src = '[Event "Club"]\n[Result "1/2-1/2"]\n[Medals "novelty,tactics"]\n\n{Αρχή} 1. e4 $2 (1. d4 {αλλιώς} d5) 1... c5 {Σικελική [%eval 0.3]} 2. Nf3 $140 d6 1/2-1/2';
    const out = pgnForSending(parseGame(src).game);
    expect(games(bytes(out))).toBe(1);
    expect(writeGame(parseGame(out).game)).toBe(writeGame(parseGame(src).game));
  });

  it('παλιά εισαγωγή με σκουπίδια καθαρίζεται πριν από την αποστολή', () => {
    const { game } = parseGame('[Event "x"]\n\n1. e4 {σχόλιο} *');
    game.headers = { ...game.headers, Event: 'δύο\nγραμμές\u0000', 'Κακή ετικέτα': 'x', Result: 'αναβλήθηκε' };
    game.root.children[0].comment = 'πριν\u0007μετά';
    const out = pgnForSending(game);
    expect(games(bytes(out))).toBe(1);
    expect(out).toContain('[Event "δύο γραμμές "]');
    expect(out).not.toContain('Κακή');
  });

  it('pgnForSending με stripClocks αφαιρεί μόνο τα ρολόγια [%clk]', () => {
    const src = '[Event "Lichess"]\n[Result "1-0"]\n\n1. e4 {[%clk 0:05:00]} 1... e5 {[%clk 0:04:58] [%eval 0.2] καλό [%cal Ge2e4]} 1-0';
    const out = pgnForSending(parseGame(src).game, { stripClocks: true });
    expect(games(bytes(out))).toBe(1);
    expect(out).not.toContain('%clk');
    expect(out).toContain('[%eval 0.2]');
    expect(out).toContain('[%cal Ge2e4]');
    expect(out).toContain('καλό');
  });

  it('η ανάγνωση σταματά στο όριο', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 64 * 1024;
        c.enqueue(new Uint8Array(64 * 1024));
      },
    });
    expect(await readCapped(endless, FILE_MAX)).toBeNull();
    expect(pulled).toBeLessThan(FILE_MAX + 256 * 1024);
    expect(await readCapped(new Blob([GAME]).stream(), FILE_MAX)).toEqual(bytes(GAME));
  });

  it('όνομα χωρίς αόρατη αναστροφή κειμένου', () => {
    expect(cleanFileName('games‮npg.exe')).toBe('gamesnpg.exe');
  });
});
