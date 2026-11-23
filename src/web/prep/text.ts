/** Κείμενα της «Προετοιμασίας» που χρειάζονται και η φόρμα και η αναφορά. */
import type { PrepColor, PrepOpts, PrepSpeed } from '../../core/prep.ts';
import { L, fmtNum } from '../i18n.ts';

export const speedName = (s: PrepSpeed) => (s === 'classical' ? L('Κλασικό', 'Classical') : s === 'daily' ? L('Daily / αλληλογραφία', 'Daily / correspondence') : s[0].toUpperCase() + s.slice(1));
export const sourceName = (s: string) => (s === 'lichess' ? 'Lichess' : s === 'chesscom' ? 'Chess.com' : 'OTB');
export const colorName = (c: PrepColor) => (c === 'white' ? L('Λευκά', 'As White') : c === 'black' ? L('Μαύρα', 'As Black') : L('Και τα δύο', 'Both colors'));

/** Σφάλμα μιας πηγής: rate, auth, notfound, net (sites), failed (βάσεις). `local`: παλιές προετοιμασίες. */
export function errText(code: string, src: string): string {
  if (src === 'otb' || src === 'local') return L('FIDE / OTB: η αναζήτηση στις βάσεις σου δεν ολοκληρώθηκε.', 'FIDE / OTB: searching your databases did not finish.');
  const site = sourceName(src);
  if (code === 'notfound') return L(`${site}: δεν υπάρχει αυτός ο χρήστης.`, `${site}: no such user.`);
  if (code === 'rate') return L(`${site}: πολλά αιτήματα — περίμενε ένα λεπτό και πάτα «Ενημέρωση».`, `${site}: too many requests — wait a minute and press “Update”.`);
  if (code === 'auth') return L(`${site}: η σύνδεση απορρίφθηκε.`, `${site}: the connection was rejected.`);
  return L(`${site}: δεν απάντησε (δίκτυο).`, `${site}: no response (network).`);
}

/** Τα φίλτρα μιας προετοιμασίας σε μία γραμμή. */
export function scopeText(o: PrepOpts): string {
  const period = o.after ? L(`μετά από ${o.after}`, `after ${o.after}`) : o.months ? L(`τελευταίοι ${o.months} μήνες`, `last ${o.months} months`) : L('όλες οι ημερομηνίες', 'all time');
  return [
    period,
    o.max ? L(`ως ${fmtNum(o.max)} παρτίδες`, `up to ${fmtNum(o.max)} games`) : '',
    o.color === 'white' ? L('με λευκά', 'as White') : o.color === 'black' ? L('με μαύρα', 'as Black') : '',
    o.speeds.map(speedName).join(', '),
    o.rated ? L('μόνο rated', 'rated only') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
