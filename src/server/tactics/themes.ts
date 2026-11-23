/** Θέματα puzzles (src/data/puzzle-themes.json): ονόματα σε ελληνικά/αγγλικά, bits των μασκών th1/th2, βάρη βαθμού. */
import fs from 'node:fs';
import type { WeightClass } from '../../core/glicko2.ts';

export interface ThemeDef {
  key: string;
  /** bit στη μάσκα (0–51 στο th1, 52+ στο th2)· null για τα εικονικά (mix, playerGames) */
  bit: number | null;
  group: string;
  cat: string;
  weight: WeightClass;
  /** αν μετρά στον πίνακα επιδόσεων (PuzzleDashboard.relevantThemes) */
  dashboard: boolean;
  el: string;
  en: string;
  descEl: string;
  descEn: string;
}

interface ThemeFile {
  groups: Record<string, { el: string; en: string }>;
  categories: Record<string, { el: string; en: string }>;
  difficulty: Record<string, { delta: number; el: string; en: string }>;
  themes: ThemeDef[];
}

const DATA = JSON.parse(fs.readFileSync(new URL('../../data/puzzle-themes.json', import.meta.url), 'utf8')) as ThemeFile;

export const THEMES: readonly ThemeDef[] = DATA.themes;
export const THEME_GROUPS = DATA.groups;
export const THEME_CATEGORIES = DATA.categories;
export const DIFFICULTIES = DATA.difficulty;
export const BY_KEY = new Map(THEMES.map((t) => [t.key, t]));
const BY_BIT: (ThemeDef | undefined)[] = [];
for (const t of THEMES) if (t.bit !== null) BY_BIT[t.bit] = t;

/** Bits ανά μάσκα: 52 ώστε οι τιμές να μένουν ακέραιοι της JavaScript (< 2^53). */
export const BITS_PER_MASK = 52;

/** Χάρτης κλειδί → bit (για τους workers). */
export const themeBits = (): Record<string, number> => Object.fromEntries(THEMES.filter((t) => t.bit !== null).map((t) => [t.key, t.bit as number]));

export interface Mask {
  m1: number;
  m2: number;
}

/** Μάσκα από bit (αριθμητική, όχι bitwise: οι τελεστές bit της JS είναι 32 bit). */
export function addBit(mask: Mask, bit: number): void {
  if (bit < BITS_PER_MASK) {
    const v = 2 ** bit;
    if (Math.floor(mask.m1 / v) % 2 === 0) mask.m1 += v;
  } else {
    const v = 2 ** (bit - BITS_PER_MASK);
    if (Math.floor(mask.m2 / v) % 2 === 0) mask.m2 += v;
  }
}

export const hasBit = (m: number, bit: number): boolean => Math.floor(m / 2 ** bit) % 2 === 1;

/** Μάσκα από κλειδιά θεμάτων· τα άγνωστα επιστρέφονται χωριστά. */
export function maskOf(keys: readonly string[]): Mask & { unknown: string[] } {
  const mask = { m1: 0, m2: 0, unknown: [] as string[] };
  for (const k of keys) {
    const t = BY_KEY.get(k);
    if (t && t.bit !== null) addBit(mask, t.bit);
    else if (!t) mask.unknown.push(k);
  }
  return mask;
}

/** Κλειδιά θεμάτων από τις μάσκες. */
export function keysOf(th1: number, th2: number): string[] {
  const out: string[] = [];
  let a = th1;
  for (let b = 0; a > 0 && b < BITS_PER_MASK; b++) {
    if (a % 2 === 1) {
      const t = BY_BIT[b];
      if (t) out.push(t.key);
      a -= 1;
    }
    a /= 2;
  }
  let c = th2;
  for (let b = 0; c > 0 && b < BITS_PER_MASK; b++) {
    if (c % 2 === 1) {
      const t = BY_BIT[b + BITS_PER_MASK];
      if (t) out.push(t.key);
      c -= 1;
    }
    c /= 2;
  }
  return out;
}

/** Λίστα bits που είναι αναμμένα (για μετρήσεις ανά θέμα). */
export function bitsOf(th1: number, th2: number, out: number[] = []): number[] {
  out.length = 0;
  let a = th1;
  for (let b = 0; a > 0; b++) {
    if (a % 2 === 1) {
      out.push(b);
      a -= 1;
    }
    a /= 2;
  }
  let c = th2;
  for (let b = 0; c > 0; b++) {
    if (c % 2 === 1) {
      out.push(b + BITS_PER_MASK);
      c -= 1;
    }
    c /= 2;
  }
  return out;
}

export interface ThemeName {
  key: string;
  el: string;
  en: string;
}

/** Όνομα θέματος σε ελληνικά και αγγλικά (για όλες τις απαντήσεις του API). */
export function themeName(key: string): ThemeName {
  const t = BY_KEY.get(key);
  return { key, el: t?.el ?? key, en: t?.en ?? key };
}

export const themeNames = (keys: readonly string[]): ThemeName[] => keys.map(themeName);

/**
 * Κατηγορία βάρους για τον βαθμό, από το «θέμα» της συνεδρίας (Lichess angle). Με πολλά θέματα
 * παίρνεται το πιο «προδοτικό» (μικρότερο βάρος νίκης), για να μην κερδίζονται εύκολοι πόντοι.
 */
export function weightClassOf(angle: readonly string[]): WeightClass {
  const order: WeightClass[] = ['obvious', 'hinting', 'neutral', 'mix'];
  let best: WeightClass = 'mix';
  for (const k of angle) {
    const t = BY_KEY.get(k);
    const w = t ? t.weight : 'mix';
    if (order.indexOf(w) < order.indexOf(best)) best = w;
  }
  return best;
}
