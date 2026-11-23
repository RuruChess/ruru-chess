/**
 * Λήψη του Lc0 με τη Leela (αντίπαλος που παίζει για νίκη και στις ισόπαλες θέσεις) και τη Maia 1100–1900 (παίζει
 * σαν άνθρωπος): από τις επίσημες σελίδες, με έλεγχο κάθε αρχείου. Χρησιμοποιείται στις Ρυθμίσεις → Μηχανές και,
 * πιο σύντομα, στο «Παίξε με bots» και στο «Παίξε τη θέση».
 */
import { Download, Trash2, X } from 'lucide-react';
import { L, fmtNum } from '../i18n.ts';
import { cancelLc0, installLc0, removeLc0, useLc0 } from '../play/lc0.ts';

const MB = (b: number) => fmtNum(Math.round(b / 1_000_000));

export function Lc0Install({ variant = 'settings', compact = false }: { variant?: 'settings' | 'tx'; compact?: boolean }) {
  const s = useLc0();
  if (!s) return null;
  const st = s.state;
  const busy = st?.status === 'downloading' || st?.status === 'installing';
  const installed = Boolean(s.leela) && s.maia.length > 0;
  const btn = (kind: 'primary' | 'plain') => (variant === 'tx' ? `btn btn-sm ${kind === 'primary' ? 'btn-primary' : 'btn-ghost'}` : kind === 'primary' ? 'primary' : '');
  const pct = st && st.total ? Math.min(100, Math.round((st.got / st.total) * 100)) : 0;
  const stepText =
    st?.step === 'lc0'
      ? L('το Lc0', 'Lc0')
      : st?.step === 'leela'
        ? L('το δίκτυο της Leela', 'the Leela network')
        : st?.step === 'maia'
          ? L('τα βάρη της Maia', 'the Maia weights')
          : L('έλεγχος', 'checking');

  if (installed && compact) return null;
  return (
    <div className={`lc0-install${variant === 'tx' ? ' is-tx' : ''}`}>
      {!compact && (
        <>
          <div className="lc0-title">{L('Leela και Maia (Lc0)', 'Leela and Maia (Lc0)')}</div>
          <p className="muted small">
            {L(
              'Η Leela είναι νευρωνικό δίκτυο που παίζει με σχέδιο και δεν συμβιβάζεται με το 0,00: ψάχνει νίκη και στις ισόπαλες θέσεις. Η Maia παίζει σαν άνθρωπος 1100–1900, με τις ίδιες ιδέες και τα ίδια λάθη.',
              'Leela is a neural network that plays with a plan and is not content with 0.00: it looks for a win even in drawn positions. Maia plays like a 1100–1900 human, with the same ideas and the same mistakes.',
            )}
          </p>
          <p className="faint small">
            {L(
              `Κατεβαίνουν από τις επίσημες σελίδες, με έλεγχο κάθε αρχείου: Lc0 ${s.version} για CPU (github.com/LeelaChessZero, GPL-3.0), το δίκτυο ${s.net} (storage.lczero.org) και τα βάρη Maia (github.com/CSSLab, GPL-3.0). Περίπου ${MB(s.bytes)} MB.`,
              `Downloaded from the official pages, with every file checked: Lc0 ${s.version} for CPU (github.com/LeelaChessZero, GPL-3.0), the ${s.net} network (storage.lczero.org) and the Maia weights (github.com/CSSLab, GPL-3.0). About ${MB(s.bytes)} MB.`,
            )}
          </p>
        </>
      )}
      <div className="lc0-row">
        {installed ? (
          <>
            <span className="small">{L(`Εγκατεστημένα: Leela και Maia ${s.maia.map((m) => m.elo).join(', ')}`, `Installed: Leela and Maia ${s.maia.map((m) => m.elo).join(', ')}`)}</span>
            {!compact && (
              <button type="button" className={btn('plain')} disabled={busy} onClick={() => window.confirm(L('Να αφαιρεθούν η Leela και η Maia;', 'Remove Leela and Maia?')) && removeLc0()}>
                <Trash2 size={14} /> {L('Αφαίρεση', 'Remove')}
              </button>
            )}
          </>
        ) : busy ? (
          <>
            <span className="small tnum">{st?.status === 'installing' ? L(`Εγκατάσταση: ${stepText}…`, `Installing: ${stepText}…`) : L(`Λήψη: ${stepText}… ${pct}%`, `Downloading ${stepText}… ${pct}%`)}</span>
            <button type="button" className={btn('plain')} onClick={cancelLc0}>
              <X size={14} /> {L('Ακύρωση', 'Cancel')}
            </button>
          </>
        ) : (
          <button type="button" className={btn('primary')} onClick={installLc0}>
            <Download size={14} /> {L(`Λήψη Leela και Maia (~${MB(s.bytes)} MB)`, `Download Leela and Maia (~${MB(s.bytes)} MB)`)}
          </button>
        )}
      </div>
      {st?.status === 'error' && <div className="error-text small">{st.error}</div>}
      {st?.status === 'cancelled' && <div className="muted small">{L('Η λήψη ακυρώθηκε· θα συνεχίσει από εκεί που σταμάτησε.', 'Download cancelled; it will resume where it stopped.')}</div>}
    </div>
  );
}
