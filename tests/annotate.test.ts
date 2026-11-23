import { describe, expect, it } from 'vitest';
import { moveNag } from '../src/web/annotate.ts';

describe('moveNag', () => {
  it('θέλει και πιθανότητα νίκης και απώλεια cp', () => {
    expect(moveNag(0.35, 250, 30)).toBe(4);
    // μεγάλη απώλεια πιθανότητας αλλά μικρή σε cp → μόνο ?
    expect(moveNag(0.35, 150, 30)).toBe(2);
    expect(moveNag(0.25, 120, 30)).toBe(2);
    expect(moveNag(0.25, 80, 30)).toBe(6);
    expect(moveNag(0.12, 40, 30)).toBe(0);
    expect(moveNag(0.05, 300, 30)).toBe(0);
  });

  it('χωρίς ?! στις 10 πρώτες ημικινήσεις ή με blundersOnly', () => {
    // η περίπτωση του 1.d4 με το παλιό contempt: +0,64 → −0,12
    expect(moveNag(0.139, 76, 1)).toBe(0);
    expect(moveNag(0.15, 60, 10)).toBe(0);
    expect(moveNag(0.15, 60, 11)).toBe(6);
    expect(moveNag(0.15, 60, 11, true)).toBe(0);
    expect(moveNag(0.35, 250, 3)).toBe(4);
  });
});
