/**
 * Μικρό παράθυρο «Αποθήκευση; Ναι / Όχι / Άκυρο» για παρτίδα που έκλεισε με το × του δικού της
 * παραθύρου (#closeprompt=<κλειδί>). Έτσι εμφανίζεται μία μόνο ερώτηση, χωρίς το μήνυμα του
 * browser. «Άκυρο» ξανανοίγει την παρτίδα με τις αλλαγές της.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { L } from '../i18n.ts';
import { newTabId, reportError, useApp, type Tab } from '../store.ts';
import { GameController, controllerFor } from '../gameModel.ts';
import { SaveDialog } from '../components/GameDialogs.tsx';
import { Toasts } from '../components/ui.tsx';

type GameTab = Extract<Tab, { kind: 'game' }>;

export function ClosePrompt({ pk }: { pk: string }) {
  const settings = useApp((s) => s.settings);
  const library = useApp((s) => s.library);
  const [tab, setTab] = useState<GameTab | null>(null);
  const [choose, setChoose] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    useApp.getState().loadSettings().catch(reportError);
    useApp.getState().refreshLibrary().catch(reportError);
    api
      .get<{ tab: GameTab }>(`/api/closeprompt/${pk}`)
      .then((r) => setTab(r.tab))
      .catch(() => window.close());
  }, [pk]);

  const theme = ((settings?.ui as Record<string, unknown> | undefined)?.theme as string) ?? 'light';
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    document.title = `${L('Αποθήκευση;', 'Save?')} — Ruru`;
  }, [theme]);

  const ctrl = useMemo(() => (tab?.pgn ? controllerFor(`closeprompt-${pk}`, () => GameController.fromPgn(tab.pgn!).ctrl) : null), [tab, pk]);
  if (!tab || !settings) return <div className="loading-screen">Ruru…</div>;

  const db = tab.source?.dbId ?? tab.targetDb;
  const dbName = library.find((d) => d.id === db)?.name ?? '';
  const finish = async () => {
    await api.post(`/api/closeprompt/${pk}/done`, {}).catch(() => {});
    window.close();
  };
  const yes = async () => {
    if (!db) {
      setChoose(true);
      return;
    }
    setBusy(true);
    try {
      if (tab.source) await api.put(`/api/db/${tab.source.dbId}/game/${tab.source.gameId}`, { pgn: tab.pgn });
      else await api.post(`/api/db/${db}/games`, { pgn: tab.pgn });
      await finish();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };
  // «Άκυρο»: η παρτίδα ξανανοίγει όπως ήταν, με τις αλλαγές της
  const cancel = async () => {
    setBusy(true);
    try {
      await api.post('/api/window', { origin: location.origin, tab: { ...tab, id: newTabId('game'), dirty: true } });
      await finish();
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };

  return (
    <div className="close-prompt">
      <h2>{L('Αποθήκευση;', 'Save?')}</h2>
      <p>{L(`Θέλεις να αποθηκεύσεις τις αλλαγές στην παρτίδα «${tab.title}»;`, `Do you want to save the changes to “${tab.title}”?`)}</p>
      <p className="muted small">{db ? L(`Θα αποθηκευτεί στη βάση «${dbName}».`, `It will be saved to “${dbName}”.`) : L('Στη συνέχεια διαλέγεις σε ποια βάση.', 'Next you choose the database.')}</p>
      <div className="close-prompt-buttons">
        <button disabled={busy} onClick={() => void cancel()}>
          {L('Άκυρο', 'Cancel')}
        </button>
        <button disabled={busy} onClick={() => void finish()}>
          {L('Όχι', 'No')}
        </button>
        <button className="primary" autoFocus disabled={busy} onClick={() => void yes()}>
          {L('Ναι', 'Yes')}
        </button>
      </div>
      {choose && ctrl && <SaveDialog ctrl={ctrl} onClose={() => setChoose(false)} onSaved={() => void finish()} />}
      <Toasts />
    </div>
  );
}
