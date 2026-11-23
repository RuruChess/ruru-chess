/** Λήψη / ενημέρωση της τελευταίας έκδοσης του Stockfish (επίσημες εκδόσεις στο GitHub, GPLv3). */
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, onServerEvent } from '../api.ts';
import { L } from '../i18n.ts';
import { reportError } from '../store.ts';

interface EngineDownload {
  status: 'downloading' | 'installing' | 'done' | 'error';
  got: number;
  total: number;
  name?: string;
  upToDate?: boolean;
  error?: string;
}

export function StockfishInstall() {
  const [state, setState] = useState<EngineDownload | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ state: EngineDownload | null; installed: { name: string } | null }>('/api/stockfish')
      .then((r) => {
        setState(r.state);
        setInstalled(r.installed?.name ?? null);
      })
      .catch(() => {});
    return onServerEvent('engineDownload', (s: EngineDownload) => {
      setState(s);
      if (s.status === 'done' && s.name) setInstalled(s.name);
    });
  }, []);

  const busy = state?.status === 'downloading' || state?.status === 'installing';
  const start = () => {
    api
      .post<EngineDownload>('/api/stockfish/install', {})
      .then(setState)
      .catch(reportError);
  };

  let status = '';
  if (state?.status === 'downloading') status = `${L('Λήψη', 'Downloading')}… ${state.total ? Math.round((state.got / state.total) * 100) : 0}%`;
  else if (state?.status === 'installing') status = L('Εγκατάσταση…', 'Installing…');
  else if (state?.status === 'done') status = state.upToDate ? L(`Έχεις ήδη την τελευταία έκδοση (${state.name})`, `Already the latest version (${state.name})`) : L(`Εγκαταστάθηκε: ${state.name}`, `Installed: ${state.name}`);
  else if (installed) status = L(`Εγκατεστημένο: ${installed}`, `Installed: ${installed}`);

  return (
    <div className="stockfish-install">
      <button className={installed ? '' : 'primary'} disabled={busy} onClick={start}>
        <Download size={15} /> {installed ? L('Ενημέρωση Stockfish', 'Update Stockfish') : L('Λήψη Stockfish (τελευταία έκδοση)', 'Download Stockfish (latest)')}
      </button>
      {status && <span className="muted small">{status}</span>}
      {state?.status === 'error' && <span className="error-text small">{state.error}</span>}
    </div>
  );
}
