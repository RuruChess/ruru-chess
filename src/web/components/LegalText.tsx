/**
 * Όροι χρήσης και απόρρητο μέσα στην εφαρμογή και στη σελίδα του relay: το ίδιο κείμενο με τα TERMS.md και
 * PRIVACY.md της ρίζας (αγγλικά, μετά το <!-- el --> ελληνικά).
 */
import privacy from '../../../PRIVACY.md?raw';
import terms from '../../../TERMS.md?raw';
import { L, language } from '../i18n.ts';

export type LegalDoc = 'terms' | 'privacy';

const TEXT: Record<LegalDoc, string> = { terms, privacy };

export const legalTitle = (doc: LegalDoc) => (doc === 'terms' ? L('Όροι χρήσης', 'Terms of use') : L('Πολιτική απορρήτου', 'Privacy policy'));

export function LegalText({ doc }: { doc: LegalDoc }) {
  const [en, el] = TEXT[doc].replace(/\r\n/g, '\n').split('<!-- el -->');
  const blocks = (language() === 'el' ? el : en).trim().split(/\n{2,}/);
  return (
    <div className="legal-text small">
      {blocks.map((b, i) => {
        if (b.startsWith('## ')) return <h3 key={i}>{b.slice(3)}</h3>;
        if (b.startsWith('# ')) return <h2 key={i}>{b.slice(2)}</h2>;
        if (b.startsWith('- '))
          return (
            <ul key={i}>
              {b.split('\n').map((x, j) => (
                <li key={j}>{x.slice(2)}</li>
              ))}
            </ul>
          );
        return <p key={i}>{b}</p>;
      })}
    </div>
  );
}
