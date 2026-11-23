/** Τεστ: οι πηγές puzzles χωρίζονται στις σελίδες της «Βελτίωσης» (Τακτικά, Φινάλε, Στρατηγικά). */
import { describe, expect, it } from 'vitest';
import { SOURCES, SOURCE_BY_KEY, resolveSources } from '../../src/server/tactics/sources.ts';

describe('σελίδες της Βελτίωσης', () => {
  it('κάθε πηγή έχει σελίδα, υποομάδα και περιγραφή', () => {
    for (const s of SOURCES) {
      expect(['tactics', 'endgame', 'strategy'], s.key).toContain(s.section);
      expect(s.cat, s.key).toBeTruthy();
      expect(s.about.el.length, s.key).toBeGreaterThan(10);
      expect(s.about.en.length, s.key).toBeGreaterThan(10);
    }
  });

  it('τα Τακτικά έχουν μόνο συνδυασμούς και ματ', () => {
    const cats = new Set(SOURCES.filter((s) => s.section === 'tactics' && s.kind !== 'mine').map((s) => s.cat));
    expect([...cats].sort()).toEqual(['combos', 'main', 'mates']);
  });

  it('η Τεχνική Tumbarello: τα φινάλε στα Φινάλε, το μέσο παιχνίδι στα Στρατηγικά', () => {
    const end = SOURCE_BY_KEY.get('lucas-tumbarello')!;
    const mid = SOURCE_BY_KEY.get('lucas-tumbarello-mid')!;
    expect(end.section).toBe('endgame');
    expect(mid.section).toBe('strategy');
    expect(end.files!.every((f) => f.path.includes('/Endings'))).toBe(true);
    expect(mid.files!.every((f) => f.path.includes('/Middlegames'))).toBe(true);
    expect(end.files!.length + mid.files!.length).toBe(12);
  });

  it('«εισαγωγή όλων» μιας σελίδας: μόνο οι συλλογές της, χωρίς τις μεγάλες, την κύρια και τα λάθη μου', () => {
    expect(
      resolveSources('section-endgame')
        .map((s) => s.key)
        .sort(),
    ).toEqual(['lucas-endgames', 'lucas-pawn-endings', 'lucas-tumbarello']);
    expect(
      resolveSources('section-strategy')
        .map((s) => s.key)
        .sort(),
    ).toEqual(['epd-arasan2023', 'epd-bk', 'epd-sts', 'lucas-tumbarello-mid']);
    const tactics = resolveSources('section-tactics');
    expect(tactics.length).toBeGreaterThan(5);
    expect(tactics.some((s) => s.optional || s.kind === 'lichess' || s.kind === 'mine' || s.section !== 'tactics')).toBe(false);
  });

  it('τα ids των πηγών είναι μοναδικά', () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });
});

describe('επίπεδα δυσκολίας της οθόνης έναρξης', () => {
  it('ίδια με του server (puzzle-themes.json)', async () => {
    const { DIFFICULTY_LEVELS } = await import('../../src/web/tactics/prefs.ts');
    const { DIFFICULTIES } = await import('../../src/server/tactics/themes.ts');
    expect(DIFFICULTY_LEVELS.map((d) => [d.key, d.delta, d.el, d.en])).toEqual(Object.entries(DIFFICULTIES).map(([k, d]) => [k, d.delta, d.el, d.en]));
  });
});

describe('«Στάνταρ»: απλά τακτικά όπως στην παλιά έκδοση', () => {
  it('γύρω από τον βαθμό σου, από την κύρια συλλογή, χωρίς θέματα, άνοιγμα και χρώμα', async () => {
    const { effectiveFilters, DIFFICULTY_LEVELS, DIFFICULTY_SCALE, activeFilters } = await import('../../src/web/tactics/prefs.ts');
    const mine = { difficulty: 'standard', themes: ['fork', 'mateIn2'], match: 'all' as const, opening: 'Sicilian', color: 'white' as const, source: 'lucas-gm-mates' };
    expect(effectiveFilters(mine, { section: 'tactics', usesMain: true, chosen: 'lucas-gm-mates', fallback: '' })).toEqual({ difficulty: 'standard', themes: [], match: 'any', opening: '', color: '', source: '' });
    // χωρίς κύρια συλλογή: από τη συλλογή της σελίδας
    expect(effectiveFilters(mine, { section: 'tactics', usesMain: false, chosen: '', fallback: 'auerswald' }).source).toBe('auerswald');
    // Φινάλε από την κύρια συλλογή: μόνο τα φινάλε
    expect(effectiveFilters(mine, { section: 'endgame', usesMain: true, chosen: '', fallback: '' }).themes).toEqual(['endgame']);
    // τα άλλα επίπεδα κρατούν τα φίλτρα
    const harder = effectiveFilters({ ...mine, difficulty: 'harder' }, { section: 'tactics', usesMain: true, chosen: 'lucas-gm-mates', fallback: '' });
    expect(harder).toMatchObject({ difficulty: 'harder', themes: ['fork', 'mateIn2'], opening: 'Sicilian', color: 'white', source: 'lucas-gm-mates' });
    // πρώτο στη λίστα, όχι βαθμίδα της κλίμακας, και δεν μετρά ως φίλτρο
    expect(DIFFICULTY_LEVELS[0].key).toBe('standard');
    expect(DIFFICULTY_SCALE.map((d) => d.key)).toEqual(['easiest', 'easier', 'normal', 'harder', 'hardest']);
    expect(activeFilters({ difficulty: 'standard', themes: [], match: 'any', opening: '', color: '', source: '' })).toBe(0);
  });
});
