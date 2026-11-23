/** Προτιμήσεις του εκπαιδευτή ανά σελίδα της «Βελτίωσης» (`ui.tactics`, `ui.tacticsEndgame`, `ui.tacticsStrategy`): τρόπος, φίλτρα επιλογής, Rush, Woodpecker, στατιστικά. */
import { NO_FILTERS, type Color, type PickFilters } from './api.ts';
import type { Section } from './sections.ts';

export type TacticsMode = 'rated' | 'review' | 'storm' | 'streak' | 'rush' | 'woodpecker' | 'daily';
export const MODES: TacticsMode[] = ['rated', 'review', 'storm', 'streak', 'rush', 'woodpecker', 'daily'];

export interface TacticsPrefs {
  mode: TacticsMode;
  filters: PickFilters;
  rush: '3' | '5' | 'survival';
  woodpecker: number | null;
  ratingSeries: 'standard' | 'blitz';
  days: number;
}

const DEFAULT_PREFS: TacticsPrefs = { mode: 'rated', filters: NO_FILTERS, rush: '3', woodpecker: null, ratingSeries: 'standard', days: 30 };

/** Το κλειδί των προτιμήσεων μιας σελίδας στο `ui` (τα Τακτικά κρατούν το `ui.tactics`). */
export const prefsKey = (section: Section = 'tactics'): string => (section === 'tactics' ? 'tactics' : section === 'endgame' ? 'tacticsEndgame' : 'tacticsStrategy');

/** Οι προτιμήσεις μιας σελίδας από το `ui` (άγνωστες τιμές → προεπιλογή). */
export function readTacticsPrefs(ui: Record<string, unknown> | undefined | null, section: Section = 'tactics'): TacticsPrefs {
  const raw = (ui?.[prefsKey(section)] ?? {}) as Partial<TacticsPrefs> & { filters?: Partial<PickFilters> };
  const f: Partial<PickFilters> = raw.filters ?? {};
  const color: '' | Color = f.color === 'white' || f.color === 'black' ? f.color : '';
  return {
    mode: MODES.includes(raw.mode as TacticsMode) ? (raw.mode as TacticsMode) : DEFAULT_PREFS.mode,
    filters: {
      difficulty: typeof f.difficulty === 'string' ? f.difficulty : NO_FILTERS.difficulty,
      themes: Array.isArray(f.themes) ? f.themes.filter((x): x is string => typeof x === 'string') : [],
      match: f.match === 'all' ? 'all' : 'any',
      opening: typeof f.opening === 'string' ? f.opening : '',
      color,
      source: typeof f.source === 'string' && /^[a-z0-9-]{1,40}$/.test(f.source) && f.source !== 'lichess' ? f.source : '',
    },
    rush: raw.rush === '5' || raw.rush === 'survival' ? raw.rush : '3',
    woodpecker: typeof raw.woodpecker === 'number' ? raw.woodpecker : null,
    ratingSeries: raw.ratingSeries === 'blitz' ? 'blitz' : 'standard',
    days: typeof raw.days === 'number' ? raw.days : 30,
  };
}

/** Πόσα φίλτρα είναι ενεργά (για τη σήμανση του κουμπιού). */
export function activeFilters(f: PickFilters): number {
  return (f.difficulty !== 'normal' && f.difficulty !== 'standard' ? 1 : 0) + (f.themes.length ? 1 : 0) + (f.opening ? 1 : 0) + (f.color ? 1 : 0) + (f.source ? 1 : 0);
}

/**
 * Τα επίπεδα δυσκολίας των βαθμολογημένων (ίδια με το `difficulty` του `src/data/puzzle-themes.json`): μετατόπιση από
 * τον βαθμό σου. Πρώτο το «Standard»: απλά τακτικά όπως στην παλιά έκδοση (βλ. `effectiveFilters`).
 */
export const DIFFICULTY_LEVELS: Array<{ key: string; delta: number; el: string; en: string }> = [
  { key: 'standard', delta: 0, el: 'Στάνταρ', en: 'Standard' },
  { key: 'easiest', delta: -600, el: 'Πολύ εύκολο', en: 'Easiest' },
  { key: 'easier', delta: -300, el: 'Εύκολο', en: 'Easier' },
  { key: 'normal', delta: 0, el: 'Κανονικό', en: 'Normal' },
  { key: 'harder', delta: 300, el: 'Δύσκολο', en: 'Harder' },
  { key: 'hardest', delta: 600, el: 'Πολύ δύσκολο', en: 'Hardest' },
];

/** Η κλίμακα δυσκολίας (χωρίς το «Standard», που δεν είναι βαθμίδα της). */
export const DIFFICULTY_SCALE = DIFFICULTY_LEVELS.filter((d) => d.key !== 'standard');

/**
 * Τα φίλτρα που στέλνονται για τα βαθμολογημένα / την εξάσκηση μιας σελίδας. Στο «Standard»: απλά τακτικά όπως στην
 * παλιά έκδοση, γύρω από τον βαθμό σου, από την κύρια συλλογή (χωρίς αυτήν: από τη συλλογή της σελίδας), χωρίς
 * θέματα, άνοιγμα και χρώμα. Στα Φινάλε, από την κύρια συλλογή μόνο τα φινάλε.
 */
export function effectiveFilters(f: PickFilters, o: { section: Section; usesMain: boolean; chosen: string; fallback: string }): PickFilters {
  const base: PickFilters = f.difficulty === 'standard' ? { ...NO_FILTERS, difficulty: 'standard', source: o.usesMain ? '' : o.chosen || o.fallback } : { ...f, source: o.chosen || o.fallback };
  if (o.section !== 'endgame' || base.source) return base;
  return { ...base, themes: base.themes.includes('endgame') ? base.themes : ['endgame', ...base.themes], match: 'all' };
}
