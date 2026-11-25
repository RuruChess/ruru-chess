import { describe, expect, it } from 'vitest';
import { RELEASE_NOTES, findReleaseNote, latestReleaseVersion, shouldAutoShowReleaseNotes } from '../src/core/releaseNotes.ts';

describe('release notes data and auto-show logic', () => {
  it('has complete bilingual (el & en) user-facing notes for 3.0.0', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThanOrEqual(1);
    expect(latestReleaseVersion()).toBe('3.0.0');
    const seen = new Set<string>();
    for (const r of RELEASE_NOTES) {
      expect(seen.has(r.version)).toBe(false);
      seen.add(r.version);
      expect(r.headline.el.trim().length).toBeGreaterThan(0);
      expect(r.headline.en.trim().length).toBeGreaterThan(0);
      expect(r.subtitle.el.trim().length).toBeGreaterThan(0);
      expect(r.subtitle.en.trim().length).toBeGreaterThan(0);
      expect(r.highlights.length).toBeGreaterThanOrEqual(2);
      expect(r.sections.length).toBeGreaterThanOrEqual(3);
      for (const h of r.highlights) {
        expect(h.title.el && h.title.en && h.desc.el && h.desc.en).toBeTruthy();
      }
      for (const s of r.sections) {
        expect(s.title.el && s.title.en).toBeTruthy();
        expect(s.items.length).toBeGreaterThan(0);
        for (const item of s.items) {
          expect(item.title.el && item.title.en && item.desc.el && item.desc.en).toBeTruthy();
        }
      }
    }
    expect(findReleaseNote('3.0.0').version).toBe('3.0.0');
    expect(findReleaseNote('3.0.0-rc1').version).toBe('3.0.0');
    expect(findReleaseNote('9.9.9').version).toBe(latestReleaseVersion());
  });

  it('auto-shows once after an update and skips popups, already-seen, or brand-new guide runs', () => {
    // αναβάθμιση από παλιότερη έκδοση: ανοίγει 1 φορά
    expect(shouldAutoShowReleaseNotes({ appVersion: '3.0.0', seenVersion: '2.6.1', isPopup: false, guideWelcomeDone: false })).toBe(true);
    // πρώτη φορά χωρίς seenVersion, αλλά ο χρήστης έχει ήδη τελειώσει τον Οδηγό: ανοίγει 1 φορά
    expect(shouldAutoShowReleaseNotes({ appVersion: '3.0.0', seenVersion: undefined, isPopup: false, guideWelcomeDone: true })).toBe(true);
    // brand-new χρήστης με τον Οδηγό ανοιχτό: δεν μπλοκάρει το «Καλώς ήρθες»
    expect(shouldAutoShowReleaseNotes({ appVersion: '3.0.0', seenVersion: undefined, isPopup: false, guideWelcomeDone: false })).toBe(false);
    // ήδη είδε την τρέχουσα έκδοση: δεν ξανανοίγει
    expect(shouldAutoShowReleaseNotes({ appVersion: '3.0.0', seenVersion: '3.0.0', isPopup: false, guideWelcomeDone: true })).toBe(false);
    // δευτερεύον παράθυρο (popup): ποτέ
    expect(shouldAutoShowReleaseNotes({ appVersion: '3.0.0', seenVersion: '2.6.1', isPopup: true, guideWelcomeDone: true })).toBe(false);
    // απενεργοποιημένο (π.χ. e2e): ποτέ
    expect(shouldAutoShowReleaseNotes({ appVersion: '3.0.0', seenVersion: '2.6.1', isPopup: false, off: true, guideWelcomeDone: true })).toBe(false);
  });
});
