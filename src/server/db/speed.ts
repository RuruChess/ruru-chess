/**
 * Ρυθμός παιχνιδιού ανά τουρνουά: κλασικό, rapid, blitz (μαζί bullet/armageddon) ή αλληλογραφία.
 * Οι μεγάλες βάσεις (π.χ. Lumbra's Gigabase) σπάνια έχουν TimeControl (≈3%), άρα το κύριο στοιχείο είναι
 * το όνομα του τουρνουά· όπου υπάρχει, μετρά πρώτα η ετικέτα της παρτίδας (Mode / TimeControl).
 * Τα όρια του TimeControl είναι της FIDE: χρόνος για 60 κινήσεις ≤ 10′ blitz, < 60′ rapid, αλλιώς κλασικό.
 */
import { searchKey } from '../text.ts';

export const SPEED_CLASSICAL = 1;
export const SPEED_RAPID = 2;
export const SPEED_BLITZ = 4;
export const SPEED_CORR = 8;
export const SPEED_ALL = SPEED_CLASSICAL | SPEED_RAPID | SPEED_BLITZ | SPEED_CORR;

const CORR_RE = /\bcorr|iccf|ficgs|fernschach|\bfern\b|e-?mail|\blss\b|correspond|iecg|iecc|webchess|\bcc[- ]?ch|postal|\bkorr|αλληλογραφ|ταχυδρομ/;
const BLITZ_RE = /blitz|bullet|lightning|armageddon|speed ?chess|titled tue|titled arena|блиц|μπλιτ/;
const RAPID_RE = /rapid|quick ?play|\bquick\b|\bactive\b|aktiv|schnell|snabb|быстр|ραπιντ|ταχυ/;

/** Ρυθμός από το όνομα του τουρνουά (μάσκα· 0 = δεν φαίνεται). «Rapid & Blitz» → και τα δύο. */
export function eventNameSpeed(name: string): number {
  const s = searchKey(name);
  if (!s) return 0;
  if (CORR_RE.test(s)) return SPEED_CORR;
  return (BLITZ_RE.test(s) ? SPEED_BLITZ : 0) | (RAPID_RE.test(s) ? SPEED_RAPID : 0);
}

/**
 * Ρυθμός από ετικέτα TimeControl: «90+30» (λεπτά), «5400+30» / «180+2» (δευτερόλεπτα· βάση πάνω από 120 =
 * δευτερόλεπτα), «40/5400+30:1800+30» (μετρά η πρώτη περίοδος), «3 mins +2 secs increment». 0 = άγνωστο.
 */
export function timeControlSpeed(tc: string): number {
  const t = tc.trim().toLowerCase();
  if (!t || t === '-' || t === '?') return 0;
  let base: number;
  let inc = 0;
  const words = /(\d+(?:\.\d+)?)\s*min/.exec(t);
  if (words) {
    base = Number(words[1]) * 60;
    const s = /(\d+)\s*sec/.exec(t);
    inc = s ? Number(s[1]) : 0;
  } else {
    const first = t.split(':')[0].replace(/^\d+\//, '');
    const m = /^(\d+(?:\.\d+)?)(?:\+(\d+(?:\.\d+)?))?$/.exec(first);
    if (!m) return 0;
    const b = Number(m[1]);
    base = b <= 120 ? b * 60 : b;
    inc = m[2] ? Number(m[2]) : 0;
  }
  if (!base && !inc) return 0;
  const total = base + 60 * inc;
  return total <= 600 ? SPEED_BLITZ : total < 3600 ? SPEED_RAPID : SPEED_CLASSICAL;
}

/** Το όνομα αρκεί (αλληλογραφία ή blitz/bullet): οι ετικέτες δεν χρειάζονται. */
export function nameDecides(byName: number): boolean {
  return byName === SPEED_CORR || (byName & SPEED_BLITZ) !== 0;
}

/**
 * Ρυθμός τουρνουά: όνομα με αλληλογραφία ή blitz/bullet (bullet δι' αλληλογραφίας δεν υπάρχει: τα online
 * «Daily Bullet Arena» έχουν λάθος Mode Correspondence), μετά οι ετικέτες μιας παρτίδας του (Mode,
 * TimeControl), μετά το υπόλοιπο όνομα (rapid), αλλιώς κλασικό.
 */
export function eventSpeed(name: string, tags: Record<string, string> | null): number {
  const byName = eventNameSpeed(name);
  if (nameDecides(byName)) return byName;
  if (tags && /corr/i.test(tags.Mode ?? '')) return SPEED_CORR;
  const byTc = tags?.TimeControl ? timeControlSpeed(tags.TimeControl) : 0;
  return byTc || byName || SPEED_CLASSICAL;
}
