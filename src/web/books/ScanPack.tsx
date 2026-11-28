/**
 * Λήψη του πακέτου σκαναρισμένων βιβλίων (server: books/scanpack.ts): ο αναγνώστης εικόνας διαβάζει τα σκαναρισμένα πολύ
 * καλύτερα από το OCR των Windows. `hint`: κάτω από το «Διάλεξε PDF…» (και «εγκατεστημένο» όταν υπάρχει)· `offer`: στην
 * κάρτα ενός βιβλίου που διαβάστηκε με OCR, μόνο όσο το πακέτο λείπει.
 */
import { useEffect, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { api, onServerEvent } from '../api.ts';
import { L, fmtBytes } from '../i18n.ts';
import { reportError } from '../store.ts';

interface PackState {
  status: 'downloading' | 'installing' | 'done' | 'error';
  got: number;
  total: number;
  error?: string;
  vcRedist?: boolean;
}
interface PackInfo {
  supported: boolean;
  installed: boolean;
  bytes: number;
  vcRedistUrl: string;
  ramGB: number;
  state: PackState | null;
}

export function ScanPack({ variant }: { variant: 'hint' | 'offer' }) {
  const [info, setInfo] = useState<PackInfo | null>(null);

  useEffect(() => {
    api
      .get<PackInfo>('/api/book/scanpack')
      .then(setInfo)
      .catch(() => {});
    return onServerEvent('scanPack', (s: PackState | null) => setInfo((i) => (i ? { ...i, state: s, installed: i.installed || s?.status === 'done' } : i)));
  }, []);

  if (!info?.supported) return null;
  const st = info.state;
  if (info.installed && st?.status !== 'done') {
    return variant === 'hint' ? (
      <p className="scanpack ok">
        <Check size={14} aria-hidden /> {L('Βελτιωμένη ανάγνωση σκαναρισμένων: εγκατεστημένη', 'Improved reading of scanned books: installed')}
      </p>
    ) : null;
  }

  const busy = st?.status === 'downloading' || st?.status === 'installing';
  const start = () => {
    api
      .post<PackState>('/api/book/scanpack/install', {})
      .then((s) => setInfo((i) => (i ? { ...i, state: s } : i)))
      .catch(reportError);
  };

  let status = '';
  if (st?.status === 'downloading') status = `${L('Λήψη', 'Downloading')}… ${st.total ? Math.round((st.got / st.total) * 100) : 0}%`;
  else if (st?.status === 'installing') status = L('Εγκατάσταση και έλεγχος…', 'Installing and checking…');

  return (
    <div className={`scanpack${variant === 'offer' ? ' offer' : ''}`}>
      {st?.status === 'done' ? (
        <p className="scanpack-done">
          <Check size={14} aria-hidden />{' '}
          {variant === 'offer'
            ? L('Εγκαταστάθηκε. Ξαναδιάβασε το βιβλίο για να το διαβάσει ο νέος αναγνώστης.', 'Installed. Read the book again to use the new reader.')
            : L('Εγκαταστάθηκε: τα σκαναρισμένα βιβλία διαβάζονται πια με τον νέο αναγνώστη.', 'Installed: scanned books are now read with the new reader.')}
        </p>
      ) : (
        <>
          {variant === 'offer' && (
            <p>{L('Τα σκαναρισμένα διαβάζονται πολύ καλύτερα με τον βελτιωμένο αναγνώστη (δωρεάν, τοπικά στον υπολογιστή σου).', 'Scanned books read much better with the improved reader (free, runs locally on your PC).')}</p>
          )}
          <div className="scanpack-row">
            <button type="button" className="kb-btn ghost sm" disabled={busy} onClick={start}>
              <Download aria-hidden />
              {L(`Βελτιωμένη ανάγνωση σκαναρισμένων (λήψη ${fmtBytes(info.bytes)})`, `Improved reading of scanned books (${fmtBytes(info.bytes)} download)`)}
            </button>
            {status && <span>{status}</span>}
          </div>
          {/* μέτρηση 28/11 (1 διεργασία, 2 νήματα): ~2,7″ ανά σελίδα και ~1,2 GB, έναντι 0,4″ και ~0,6 GB με το OCR των Windows */}
          <p className="scanpack-note">
            {L(
              'Θέλει περίπου 1 GB μνήμης και είναι πιο αργός από το OCR των Windows (λίγα δευτερόλεπτα ανά σελίδα).',
              'Needs about 1 GB of memory and is slower than Windows OCR (a few seconds per page).',
            )}
          </p>
          {info.ramGB > 0 && info.ramGB < 7 && (
            <p className="scanpack-warn">
              {L(
                `Αυτός ο υπολογιστής έχει ${info.ramGB} GB μνήμης: η ανάγνωση μπορεί να είναι πολύ αργή.`,
                `This PC has ${info.ramGB} GB of memory: reading may be very slow.`,
              )}
            </p>
          )}
          {st?.status === 'error' && (
            <p className="scanpack-error" role="alert">
              {st.error}{' '}
              {st.vcRedist && (
                <a href={info.vcRedistUrl} target="_blank" rel="noreferrer">
                  {L('Σελίδα της Microsoft', 'Microsoft page')}
                </a>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
