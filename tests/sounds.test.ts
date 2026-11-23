/** Τεστ: οι ρυθμίσεις ήχου (με το παλιό `ui.sounds`), ο ήχος κάθε κίνησης και ότι υπάρχουν τα αρχεία κάθε σετ. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUND, SOUND_THEMES, moveSoundOf, soundConfig } from '../src/web/sounds.ts';

describe('ήχοι', () => {
  it('ρυθμίσεις: προεπιλογές, παλιός διακόπτης, όρια, παλιά σετ', () => {
    expect(soundConfig(undefined)).toEqual(DEFAULT_SOUND);
    expect(soundConfig({ sounds: false }).on).toBe(false);
    expect(soundConfig({ sounds: false, sound: { on: true } }).on).toBe(true);
    expect(soundConfig({ sound: { theme: 'piano', volume: 140 } })).toEqual({ on: true, theme: 'piano', volume: 100 });
    // σετ που δεν υπάρχουν πια (π.χ. το μεταλλικό sfx) → το Ξύλο
    expect(soundConfig({ sound: { theme: 'sfx', volume: -5 } })).toEqual({ on: true, theme: 'wood', volume: 0 });
  });

  it('κάθε κίνηση: σαχ, αιχμαλωσία, ροκέ, προαγωγή, απλή κίνηση', () => {
    expect(moveSoundOf('e4')).toBe('move');
    expect(moveSoundOf('Nxe5')).toBe('capture');
    expect(moveSoundOf('Bxf7+')).toBe('check');
    expect(moveSoundOf('O-O-O')).toBe('castle');
    expect(moveSoundOf('e8=Q')).toBe('promote');
    expect(moveSoundOf('Qh7#')).toBe('check');
  });

  it('κάθε σετ έχει τα αρχεία του', () => {
    for (const t of SOUND_THEMES)
      for (const f of ['Move', 'Capture', 'GenericNotify', ...(t === 'wood' ? [] : ['Check'])]) {
        const p = path.join('public', 'sounds', t, `${f}.mp3`);
        expect(fs.statSync(p).size, p).toBeGreaterThan(1000);
      }
  });
});
