/**
 * Ρύθμιση «Οι παρτίδες μου»: οι παρτίδες του χρήστη από Lichess / Chess.com μπαίνουν μόνες τους στη βάση
 * «Οι παρτίδες μου» (ο server ελέγχει κάθε 10′, βλ. src/server/mygames.ts). null = κλειστή.
 */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cleanSiteUser } from '../../core/social.ts';
import { api, onServerEvent } from '../api.ts';
import { L } from '../i18n.ts';
import { reportError } from '../store.ts';
import { useSocial } from '../social/social.ts';
import { loadLichess, useLichess } from '../watch/account.ts';

export type MyGames = { lichess?: string; chesscom?: string } | null;

interface Status {
  on: boolean;
  at: number | null;
  added: number;
  total: number;
  error: string | null;
}

export function MyGamesSetting({ value, saved, onChange }: { value: MyGames | undefined; saved: MyGames | undefined; onChange: (v: MyGames) => void }) {
  const myAcc = useSocial((s) => s.myAcc);
  const lichess = useLichess((s) => (s.connected ? s.username : null));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadLichess();
    api
      .get<Status>('/api/mygames')
      .then(setStatus)
      .catch(() => {});
    return onServerEvent('mygamesStatus', (s: Status) => setStatus(s));
  }, []);

  const v = value ?? null;
  const bad = (u?: string) => Boolean(u?.trim()) && !cleanSiteUser(u);
  const field = (k: 'lichess' | 'chesscom', label: string) => (
    <label className="mygames-field">
      <span>{label}</span>
      <input className="input" value={v?.[k] ?? ''} placeholder="username" onChange={(e) => onChange({ ...v, [k]: e.target.value })} />
      {bad(v?.[k]) && <span className="mygames-bad">{L('λάθος username', 'invalid username')}</span>}
    </label>
  );
  const syncNow = () => {
    setBusy(true);
    api
      .post<Status>('/api/mygames/sync', {})
      .then(setStatus)
      .catch(reportError)
      .finally(() => setBusy(false));
  };
  const time = (t: number) => new Date(t).toLocaleTimeString(L('el-GR', 'en-GB'), { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {/* σε όλο το πλάτος: οι Ρυθμίσεις βάζουν τα κουτάκια ανά δύο (form-grid) */}
      <label className="check wide">
        <input
          type="checkbox"
          checked={v !== null}
          onChange={(e) => {
            const li = myAcc?.lichess ?? (lichess && lichess !== '?' ? lichess : '');
            onChange(e.target.checked ? { lichess: li, chesscom: myAcc?.chesscom ?? '' } : null);
          }}
        />
        {L('Οι παρτίδες μου από Lichess και Chess.com αυτόματα στη βάση «Οι παρτίδες μου»', 'My games from Lichess and Chess.com automatically in the “My games” database')}
      </label>
      {v !== null && (
        <div className="mygames-set">
          {field('lichess', 'Lichess')}
          {field('chesscom', 'Chess.com')}
          <p className="faint small">
            {L(
              'Ελέγχει κάθε 10 λεπτά όσο τρέχει το Ruru. Την πρώτη φορά φέρνει όσες έπαιξες τις τελευταίες 24 ώρες, μετά μόνο τις καινούργιες. Μόνο κλασικό σκάκι (όχι Chess960 ή παραλλαγές).',
              'Checks every 10 minutes while Ruru runs. The first time it brings the games of the last 24 hours, then only new ones. Standard chess only (no Chess960 or variants).',
            )}
          </p>
          {status?.on && JSON.stringify(saved ?? null) === JSON.stringify(v) && (
            <p className="small mygames-status">
              {status.at
                ? L(`Τελευταίος έλεγχος ${time(status.at)}: ${status.added} νέες (σύνολο ${status.total}).`, `Last check ${time(status.at)}: ${status.added} new (total ${status.total}).`)
                : L('Ο πρώτος έλεγχος γίνεται σε λίγα δευτερόλεπτα.', 'The first check runs in a few seconds.')}
              {status.error && <span className="mygames-bad"> {L(`Σφάλμα (${status.error}): θα ξαναδοκιμάσει.`, `Error (${status.error}): will retry.`)}</span>}{' '}
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={syncNow}>
                <RefreshCw className="ic ic-sm" aria-hidden />
                {L('Έλεγχος τώρα', 'Check now')}
              </button>
            </p>
          )}
        </div>
      )}
    </>
  );
}
