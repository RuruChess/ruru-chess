/** Watch Live: ο λογαριασμός Lichess του χρήστη (το token μένει στον server· εδώ μόνο αν υπάρχει και το όνομα). */
import { create } from 'zustand';
import { api, onServerEvent } from '../api.ts';
import { reportError, useApp } from '../store.ts';
import { L } from '../i18n.ts';

interface LichessAccount {
  loaded: boolean;
  enabled: boolean;
  connected: boolean;
  username: string | null;
  /** πότε λήγει το token (ms· null: άγνωστο) */
  expires?: number | null;
  /** περιμένει την έγκριση στη σελίδα του Lichess */
  waiting: boolean;
}

export const useLichess = create<LichessAccount>(() => ({ loaded: false, enabled: true, connected: false, username: null, waiting: false }));

let started = false;
/** Φόρτωση μία φορά, μετά ενημερώσεις από τον server (γεγονός «lichess», π.χ. όταν ολοκληρωθεί η σύνδεση στον browser). */
export function loadLichess(): void {
  if (started) return;
  started = true;
  api
    .get<Omit<LichessAccount, 'loaded' | 'waiting'>>('/api/watch/account')
    .then((a) => useLichess.setState({ ...a, loaded: true }))
    .catch(() => (started = false));
  onServerEvent('lichess', (a: Omit<LichessAccount, 'loaded' | 'waiting'>) => {
    const was = useLichess.getState().connected;
    useLichess.setState({ ...a, loaded: true, waiting: false });
    if (a.connected && !was) useApp.getState().toast(L(`Συνδέθηκες με το Lichess ως ${a.username}.`, `Connected to Lichess as ${a.username}.`), 'ok');
  });
}

/** Ανοίγει τη σελίδα έγκρισης του Lichess στον browser του χρήστη (OAuth, μόνο ανάγνωση). */
export function lichessLogin(): void {
  loadLichess();
  useLichess.setState({ waiting: true });
  api.post('/api/watch/login', {}).catch((e) => {
    useLichess.setState({ waiting: false });
    reportError(e);
  });
}

export function lichessLogout(): void {
  api
    .post<Omit<LichessAccount, 'loaded' | 'waiting'>>('/api/watch/logout', {})
    .then((a) => useLichess.setState({ ...a, loaded: true }))
    .catch(reportError);
}
