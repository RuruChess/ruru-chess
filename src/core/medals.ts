/**
 * Μετάλλια παρτίδας: bit i = MEDALS[i]. Η θέση κάθε bit είναι της μορφής .cbh του ChessBase (πεδίο 0x25) και
 * δεν αλλάζει, για συμβατότητα (δεν επαληθεύτηκε με πολλά δεδομένα). Τα ονόματα είναι του Ruru και αλλάζουν
 * ελεύθερα, τα key όχι: γράφονται στο PGN ως [Medals "novelty,tactics"].
 */
export const MEDALS: Array<{ key: string; el: string; en: string }> = [
  { key: 'best', el: 'Κορυφαία παρτίδα', en: 'Standout game' },
  { key: 'decided', el: 'Έκρινε την κατάταξη', en: 'Settled the standings' },
  { key: 'model', el: 'Μάθημα για το άνοιγμα', en: 'Opening lesson' },
  { key: 'novelty', el: 'Νέα ιδέα στο άνοιγμα', en: 'Fresh opening idea' },
  { key: 'pawns', el: 'Σκελετός πιονιών', en: 'Pawn skeleton' },
  { key: 'strategy', el: 'Μακρόπνοο σχέδιο', en: 'Long-range planning' },
  { key: 'tactics', el: 'Παιχνίδι συνδυασμών', en: 'Combination play' },
  { key: 'attack', el: 'Επιθετικό παιχνίδι', en: 'Attacking play' },
  { key: 'sacrifice', el: 'Υλικό για αντάλλαγμα', en: 'Material given up' },
  { key: 'defense', el: 'Γερή αντίσταση', en: 'Tough resistance' },
  { key: 'material', el: 'Ανισορροπία υλικού', en: 'Uneven material' },
  { key: 'pieces', el: 'Δράση κομματιών', en: 'Lively pieces' },
  { key: 'endgame', el: 'Τεχνική στο φινάλε', en: 'Endgame craft' },
  { key: 'tblunder', el: 'Τακτική αβλεψία', en: 'Tactical oversight' },
  { key: 'sblunder', el: 'Στραβό σχέδιο', en: 'Misguided plan' },
  { key: 'user', el: 'Προσωπική σήμανση', en: 'Personal mark' },
];

export function medalsToText(bits: number): string {
  return MEDALS.filter((_, i) => bits & (1 << i))
    .map((m) => m.key)
    .join(',');
}

export function textToMedals(s: string | undefined): number {
  let bits = 0;
  for (const k of (s ?? '').split(/[\s,;]+/)) {
    const i = MEDALS.findIndex((m) => m.key === k.toLowerCase());
    if (i >= 0) bits |= 1 << i;
  }
  return bits;
}

/** Τα μετάλλια αποθηκεύονται στα bits 16–31 της στήλης flags (θετικός ακέραιος, όχι πρόσημο). */
export const medalsOfFlags = (flags: number): number => Math.floor(flags / 65536) & 0xffff;
