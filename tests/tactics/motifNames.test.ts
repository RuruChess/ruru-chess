/** Τα ονόματα μοτίβων των εξηγήσεων είναι τα ίδια με τα ελληνικά θέματα του εκπαιδευτή τακτικής. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATE_NAMES, MOTIF_NAMES, NON_LICHESS_MOTIFS } from '../../src/core/motifNames.ts';

const themes = (JSON.parse(fs.readFileSync(new URL('../../src/data/puzzle-themes.json', import.meta.url), 'utf8')) as { themes: Array<{ key: string; el: string }> }).themes;
const byKey = new Map(themes.map((t) => [t.key, t.el]));

/** «Πιρούνι – Διπλό χτύπημα» → «πιρούνι»· «To ματ της Αναστασίας» → «ματ της αναστασίας». */
const canon = (s: string) =>
  s
    .split(' – ')[0]
    .toLowerCase()
    .replace(/^(το|to) /, '')
    .trim();

describe('ονόματα μοτίβων (puzzle-themes.json)', () => {
  it('κάθε μοτίβο των εξηγήσεων λέγεται όπως στον εκπαιδευτή', () => {
    for (const [key, name] of Object.entries(MOTIF_NAMES)) {
      if (NON_LICHESS_MOTIFS.includes(key)) continue;
      const el = byKey.get(key);
      expect(el, key).toBeDefined();
      expect(name.el, key).toBe(canon(el!));
      // η αιτιατική τελειώνει με την ονομαστική ή με την αιτιατική της (αρσενικά σε -ός → -ό)
      expect(name.acc.endsWith(name.el) || name.acc.endsWith(name.el.replace(/ός$/, 'ό')), key).toBe(true);
    }
  });

  it('κάθε σχήμα ματ λέγεται όπως στον εκπαιδευτή', () => {
    for (const [key, name] of Object.entries(MATE_NAMES)) {
      const el = byKey.get(key);
      expect(el, key).toBeDefined();
      expect(name.el.toLowerCase(), key).toBe(canon(el!));
    }
  });

  it('η υπερφόρτωση είναι η μόνη δική μας', () => {
    expect(byKey.has('overloading')).toBe(false);
    expect(MOTIF_NAMES.overloading.el).toBe('υπερφόρτωση');
  });
});
