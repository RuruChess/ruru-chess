import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase } from '../src/server/db/store.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';
import { SPEED_BLITZ, SPEED_CLASSICAL, SPEED_CORR, SPEED_RAPID, eventNameSpeed, eventSpeed, timeControlSpeed } from '../src/server/db/speed.ts';

describe('ρυθμός από το όνομα του τουρνουά', () => {
  it('blitz, bullet, rapid, αλληλογραφία', () => {
    expect(eventNameSpeed('World Blitz Championship')).toBe(SPEED_BLITZ);
    expect(eventNameSpeed('Bullet Chess Winners 2023')).toBe(SPEED_BLITZ);
    expect(eventNameSpeed('Norway Chess Armageddon')).toBe(SPEED_BLITZ);
    expect(eventNameSpeed('2025 Speed Chess Championship')).toBe(SPEED_BLITZ);
    expect(eventNameSpeed('Titled Tuesday Blitz')).toBe(SPEED_BLITZ);
    expect(eventNameSpeed('CHN Ch Rapid 2017')).toBe(SPEED_RAPID);
    expect(eventNameSpeed('Deutsche Schnellschach Amateurmeisterschaft')).toBe(SPEED_RAPID);
    expect(eventNameSpeed('37th Dos Hermanas Active')).toBe(SPEED_RAPID);
    expect(eventNameSpeed('GCT Rapid & Blitz Croatia')).toBe(SPEED_RAPID | SPEED_BLITZ);
    expect(eventNameSpeed('FICGS__CHESS__RAPID_A__000084')).toBe(SPEED_CORR);
    expect(eventNameSpeed('Corr GB')).toBe(SPEED_CORR);
    expect(eventNameSpeed('ICCF WC Final')).toBe(SPEED_CORR);
    expect(eventNameSpeed('Πανελλήνιο Ταχύ Σκάκι')).toBe(SPEED_RAPID);
    expect(eventNameSpeed('Ταχυδρομικό Πρωτάθλημα')).toBe(SPEED_CORR);
    expect(eventNameSpeed('Tata Steel Masters')).toBe(0);
    expect(eventNameSpeed('Linares')).toBe(0);
  });
});

describe('ρυθμός από το TimeControl', () => {
  it('λεπτά, δευτερόλεπτα, περίοδοι και κείμενο', () => {
    expect(timeControlSpeed('90+30')).toBe(SPEED_CLASSICAL);
    expect(timeControlSpeed('5400+30')).toBe(SPEED_CLASSICAL);
    expect(timeControlSpeed('40/5400+30:1800+30')).toBe(SPEED_CLASSICAL);
    expect(timeControlSpeed('15+10')).toBe(SPEED_RAPID);
    expect(timeControlSpeed('1500+10')).toBe(SPEED_RAPID);
    // 45′+15″ = ακριβώς 60′ για 60 κινήσεις: κλασικό κατά τη FIDE
    expect(timeControlSpeed('2700+15')).toBe(SPEED_CLASSICAL);
    expect(timeControlSpeed('3+2')).toBe(SPEED_BLITZ);
    expect(timeControlSpeed('180+2')).toBe(SPEED_BLITZ);
    expect(timeControlSpeed('3 mins +2 secs increment')).toBe(SPEED_BLITZ);
    expect(timeControlSpeed('-')).toBe(0);
    expect(timeControlSpeed('?')).toBe(0);
    expect(timeControlSpeed('abc')).toBe(0);
  });

  it('ετικέτες πρώτα, μετά το όνομα, αλλιώς κλασικό', () => {
    expect(eventSpeed('BdF', { Mode: 'Correspondence' })).toBe(SPEED_CORR);
    expect(eventSpeed('Some Open', { TimeControl: '3+2' })).toBe(SPEED_BLITZ);
    expect(eventSpeed('Some Rapid', null)).toBe(SPEED_RAPID);
    expect(eventSpeed('Corr GB', { TimeControl: '3+2' })).toBe(SPEED_CORR);
    // online arena με λάθος Mode: το bullet του ονόματος μετρά πρώτο
    expect(eventSpeed('Daily Bullet Arena', { Mode: 'Correspondence' })).toBe(SPEED_BLITZ);
    expect(eventSpeed('FICGS__CHESS__RAPID_A', { Mode: 'Correspondence' })).toBe(SPEED_CORR);
    expect(eventSpeed('Linares', null)).toBe(SPEED_CLASSICAL);
  });
});

describe('αναζήτηση με ρυθμό', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-speed-'));
  const file = path.join(dir, 'speed.kbdb');
  const db = new GameDatabase(file, { create: true });
  afterAll(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const add = (event: string, extra = '') => {
    const { game } = parseGame(`[Event "${event}"]\n[White "Carlsen, Magnus"]\n[Black "Nakamura, Hikaru"]\n[Result "1-0"]\n${extra}\n1. e4 e5 1-0`);
    const enc = encodeGame(game);
    return db.insertGame({ headers: game.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: game.plyCount() });
  };

  it('κλασικό / rapid / blitz / αλληλογραφία και συνδυασμοί', () => {
    const classical = add('Tata Steel Masters');
    const blitz = add('World Blitz Championship');
    const rapid = add('Some Open', '[TimeControl "15+10"]');
    const corr = add('BdF', '[Mode "Correspondence"]');
    const both = add('GCT Rapid & Blitz Croatia');
    const ids = (speeds: number) => Array.from(db.search({ player: 'Magnus Carlsen', speeds }));
    expect(ids(SPEED_CLASSICAL)).toEqual([classical]);
    expect(ids(SPEED_BLITZ)).toEqual([blitz, both]);
    expect(ids(SPEED_RAPID)).toEqual([rapid, both]);
    expect(ids(SPEED_CORR)).toEqual([corr]);
    expect(ids(SPEED_CLASSICAL | SPEED_RAPID)).toEqual([classical, rapid, both]);
    expect(ids(15)).toEqual([classical, blitz, rapid, corr, both]);
    // το αρχείο ρυθμών γράφτηκε δίπλα στη βάση, και σβήνει με νέα παρτίδα
    expect(fs.existsSync(path.join(dir, 'speed.speed'))).toBe(true);
    const blitz2 = add('Bullet Chess Winners 2023');
    expect(fs.existsSync(path.join(dir, 'speed.speed'))).toBe(false);
    expect(ids(SPEED_BLITZ)).toEqual([blitz, both, blitz2]);
  });
});
