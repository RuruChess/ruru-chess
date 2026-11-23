/** Σύμβολα σχολιασμού (NAG) όπως τα δείχνει το Ruru. */

export const NAG_SYMBOLS: Record<number, string> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
  7: '□',
  8: '□',
  10: '=',
  11: '=',
  12: '=',
  13: '∞',
  14: '⩲',
  15: '⩱',
  16: '±',
  17: '∓',
  18: '+−',
  19: '−+',
  20: '+−',
  21: '−+',
  22: '⨀',
  23: '⨀',
  32: '⟳',
  33: '⟳',
  36: '↑',
  37: '↑',
  40: '→',
  41: '→',
  44: '=/∞',
  45: '=/∞',
  132: '⇆',
  133: '⇆',
  138: '⊕',
  139: '⊕',
  140: '∆',
  141: '∇',
  142: '⌓',
  143: '≤',
  144: '=',
  145: 'RR',
  146: 'N',
};

/** Ονόματα NAG για την παλέτα σχολίων. */
export const NAG_NAMES: Record<number, { el: string; en: string }> = {
  1: { el: 'Καλή κίνηση', en: 'Good move' },
  2: { el: 'Λάθος', en: 'Mistake' },
  3: { el: 'Εξαιρετική κίνηση', en: 'Brilliant move' },
  4: { el: 'Σοβαρό λάθος', en: 'Blunder' },
  5: { el: 'Ενδιαφέρουσα κίνηση', en: 'Interesting move' },
  6: { el: 'Αμφίβολη κίνηση', en: 'Dubious move' },
  7: { el: 'Μοναδική κίνηση', en: 'Only move' },
  10: { el: 'Ίση θέση', en: 'Equal' },
  13: { el: 'Ασαφής θέση', en: 'Unclear' },
  14: { el: 'Ελαφρά καλύτερα τα λευκά', en: 'White is slightly better' },
  15: { el: 'Ελαφρά καλύτερα τα μαύρα', en: 'Black is slightly better' },
  16: { el: 'Καλύτερα τα λευκά', en: 'White is better' },
  17: { el: 'Καλύτερα τα μαύρα', en: 'Black is better' },
  18: { el: 'Κερδίζουν τα λευκά', en: 'White is winning' },
  19: { el: 'Κερδίζουν τα μαύρα', en: 'Black is winning' },
  22: { el: 'Τσουγκτσβάνγκ', en: 'Zugzwang' },
  32: { el: 'Προβάδισμα ανάπτυξης', en: 'Development advantage' },
  36: { el: 'Πρωτοβουλία', en: 'Initiative' },
  40: { el: 'Έχει την επίθεση', en: 'Has the attack' },
  44: { el: 'Αντιστάθμισμα', en: 'Compensation' },
  132: { el: 'Αντεπίθεση', en: 'Counterplay' },
  138: { el: 'Πίεση χρόνου (Zeitnot)', en: 'Time trouble (zeitnot)' },
  140: { el: 'Σχεδιάζει', en: 'Planning' },
  141: { el: 'Για να εμποδίσει', en: 'To prevent' },
  142: { el: 'Προτιμότερη επιλογή', en: 'Stronger option' },
  143: { el: 'Κατώτερη επιλογή', en: 'Weaker option' },
  144: { el: 'Εξίσου καλή επιλογή', en: 'Equally good option' },
  145: { el: 'Σχόλιο σύνταξης', en: 'Editorial comment' },
  146: { el: 'Καινοτομία', en: 'Novelty' },
};

/** Ομάδες της παλέτας: κίνηση / αξιολόγηση / λοιπά. */
export const MOVE_NAGS = [1, 2, 3, 4, 5, 6, 7];
export const EVAL_NAGS = [18, 16, 14, 10, 13, 44, 15, 17, 19];
export const OTHER_NAGS = [146, 22, 32, 36, 40, 132, 138, 140, 142, 145];

/**
 * Ομάδες συμβόλων: κάθε κίνηση έχει το πολύ ένα σύμβολο κίνησης, μία
 * αξιολόγηση θέσης και ένα πρόθεμα (μαζί και οι παραλλαγές λευκών/μαύρων του PGN).
 * Η καινοτομία μένει χωριστά, για να συνυπάρχει με την αξιολόγηση.
 */
export const NAG_GROUPS = {
  move: [1, 2, 3, 4, 5, 6, 7, 8, 9, 22, 23],
  eval: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 32, 33, 36, 37, 40, 41, 44, 45, 132, 133, 138, 139],
  novelty: [146],
  prefix: [140, 141, 142, 143, 144, 145],
};

/** Τα υπομενού του δεξιού κλικ, με τη σειρά των αριθμών NAG του PGN. */
export const MENU_NAGS = {
  move: [1, 2, 3, 4, 5, 6, 7, 22],
  eval: [10, 13, 14, 15, 16, 17, 18, 19, 32, 36, 40, 44, 132, 138, 146],
  prefix: [140, 141, 142, 143, 144, 145],
};

/** Η ομάδα στην οποία ανήκει ένα NAG (μόνο του, αν δεν ανήκει σε καμία). */
export function nagGroup(n: number): number[] {
  return Object.values(NAG_GROUPS).find((g) => g.includes(n)) ?? [n];
}

/** Ίδιο σύμβολο της ίδιας ομάδας (π.χ. $40 και $41 «με επίθεση»). */
export function sameNag(a: number, b: number): boolean {
  return a === b || (nagGroup(a) === nagGroup(b) && nagSymbol(a) === nagSymbol(b));
}

const TEXT_TO_NAG: Record<string, number> = {
  '!': 1,
  '?': 2,
  '!!': 3,
  '??': 4,
  '!?': 5,
  '?!': 6,
  '□': 7,
  '=': 10,
  '∞': 13,
  '+=': 14,
  '+/=': 14,
  '⩲': 14,
  '=+': 15,
  '=/+': 15,
  '⩱': 15,
  '+/-': 16,
  '±': 16,
  '-/+': 17,
  '∓': 17,
  '+-': 18,
  '+−': 18,
  '-+': 19,
  '−+': 19,
  '=/∞': 44,
  '=∞': 44,
  '~': 13,
  '=/~': 44,
  N: 146,
};

/** Μετατρέπει σύμβολο κειμένου σε NAG (0 αν δεν αναγνωρίζεται). */
export function textToNag(s: string): number {
  return TEXT_TO_NAG[s] ?? 0;
}

/** Αν το κείμενο είναι αρχή κάποιου συμβόλου (για πληκτρολόγηση όπως «+», «+/», «+/-»). */
export function isNagTextPrefix(s: string): boolean {
  return Object.keys(TEXT_TO_NAG).some((k) => k.startsWith(s));
}

export function nagSymbol(n: number): string {
  return NAG_SYMBOLS[n] ?? `$${n}`;
}

/** Αν το NAG αφορά την κίνηση (εμφανίζεται κολλητά στο SAN). */
export function isMoveNag(n: number): boolean {
  return (n >= 1 && n <= 9) || n === 22 || n === 23;
}

/** Πρόθεμα (∆, ⌓, …): εμφανίζεται πριν από την κίνηση. */
export function isPrefixNag(n: number): boolean {
  return n >= 140 && n <= 145;
}
