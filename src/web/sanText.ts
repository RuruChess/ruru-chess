/** Μορφή σημειογραφίας: εικονίδια (♘f3), αγγλικά (Nf3) ή ελληνικά γράμματα (Ιf3). */

export type NotationStyle = 'figurine' | 'letters' | 'greek';

const FIGURINES: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const GREEK: Record<string, string> = { K: 'Ρ', Q: 'Β', R: 'Π', B: 'Α', N: 'Ι' };

/** SAN ως απλό κείμενο στη μορφή του χρήστη (για tooltips, εκτύπωση, αντιγραφή). */
export function displaySan(san: string, style: NotationStyle): string {
  if (style === 'letters') return san;
  const map = style === 'figurine' ? FIGURINES : GREEK;
  return san.replace(/[KQRBN]/g, (c) => map[c] ?? c);
}
