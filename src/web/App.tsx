/**
 * Πλαίσιο εφαρμογής: καρτέλες παραθύρων (βάσεις, βάση, σκακιέρα, ρυθμίσεις). Με τα
 * ξεχωριστά παράθυρα (προεπιλογή) το κύριο κρατά τη Βιβλιοθήκη και κάθε άλλο έχει μία καρτέλα.
 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Bot, Database, LayoutGrid, Settings as SettingsIcon, X, Swords, FilePlus2, GraduationCap, TrendingUp, Users, Radio, Eye, Target, Sparkles } from 'lucide-react';
import { START_FEN } from '../core/chess.ts';
import { L, language } from './i18n.ts';
import { FIXED_TABS, NOTES_TAB, OPEN_KEY, newTabId, reportError, useApp, type Tab } from './store.ts';
import { api, onServerEvent } from './api.ts';
import { dropController } from './gameModel.ts';
import { Toasts } from './components/ui.tsx';
import { Guide, restartGuide } from './components/Guide.tsx';
import { HelpButton } from './components/HelpMenu.tsx';
import { ReleaseNotesWindow, useReleaseNotesAutoOpen, useUnseenReleaseNotes } from './components/ReleaseNotes.tsx';
import { SoundButton } from './components/SoundControl.tsx';
import { setSoundConfig, soundConfig } from './sounds.ts';
import { LibraryWindow } from './windows/LibraryWindow.tsx';
import { DatabaseWindow } from './windows/DatabaseWindow.tsx';
import { BoardWindow } from './windows/BoardWindow.tsx';
import { SettingsWindow } from './windows/SettingsWindow.tsx';
import { TrainerWindow } from './windows/TrainerWindow.tsx';
import { ImproveWindow } from './windows/ImproveWindow.tsx';
import { BotsWindow } from './windows/BotsWindow.tsx';
import { BooksWindow } from './windows/BooksWindow.tsx';
import { FriendWindow } from './windows/FriendWindow.tsx';
import { ShareWindow } from './windows/ShareWindow.tsx';
import { WatchWindow } from './watch/WatchWindow.tsx';
import { PrepWindow } from './prep/PrepWindow.tsx';
import { markEventsSeen, unseenEvents, useBigEvents, useBigEventsPoll } from './watch/events.ts';
import { ChatDock, SocialNotices } from './social/ChatDock.tsx';
import { InviteGameDialog } from './social/InviteGame.tsx';
import { InviteAnalysisDialog } from './social/InviteAnalysis.tsx';
import { TeamDialogs } from './social/TeamDialog.tsx';
import { SendFileDialog } from './social/SendFile.tsx';
import { accountOf, connectSocial } from './social/social.ts';
import { SOCIAL } from '../core/features.ts';
import { SafetyDialogs } from './social/Safety.tsx';

/** Ο τίτλος των μόνιμων καρτελών (και του παραθύρου) στη γλώσσα της εφαρμογής. */
function fixedTitle(t: Tab): string {
  switch (t.kind) {
    case 'library':
      return L('Βάσεις', 'Databases');
    case 'settings':
      return L('Ρυθμίσεις', 'Settings');
    case 'tactics':
      return L('Βελτίωση', 'Improve');
    case 'bots':
      return L('Παίξε με bots', 'Play bots');
    case 'books':
      return L('Βιβλίο σε βάση', 'Book to database');
    case 'friend':
      return L('Παίξε με φίλο', 'Play a friend');
    case 'share':
      return L('Κοινή ανάλυση', 'Shared analysis');
    case 'watch':
      return L('Ζωντανά', 'Watch Live');
    case 'prep':
      return L('Προετοιμασία', 'Prepare for opponent');
    case 'notes':
      return L('Εκδόσεις', 'Patch Notes');
    default:
      return t.title;
  }
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === 'library') return <LayoutGrid size={15} />;
  if (tab.kind === 'db') return <Database size={15} />;
  if (tab.kind === 'settings') return <SettingsIcon size={15} />;
  if (tab.kind === 'trainer') return <GraduationCap size={15} />;
  if (tab.kind === 'tactics') return <TrendingUp size={15} />;
  if (tab.kind === 'bots') return <Bot size={15} />;
  if (tab.kind === 'books') return <BookOpen size={15} />;
  if (tab.kind === 'friend') return <Users size={15} />;
  if (tab.kind === 'share') return <Radio size={15} />;
  if (tab.kind === 'watch') return <Eye size={15} />;
  if (tab.kind === 'prep') return <Target size={15} />;
  if (tab.kind === 'notes') return <Sparkles size={15} />;
  return <Swords size={15} />;
}

/**
 * Νέα έκδοση στον server (π.χ. μετά από ενημέρωση και επανεκκίνηση) ενώ το παράθυρο τρέχει ακόμη τον παλιό κώδικα: το
 * index.html δείχνει άλλο bundle από αυτό που φορτώθηκε. Έλεγχος όταν το παράθυρο ξαναπαίρνει την εστίαση και κάθε λεπτό.
 */
function useNewVersion(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = [...document.scripts].map((s) => s.src).find((src) => /\/assets\/index-[\w-]+\.js$/.test(src));
    // στο Vite (ανάπτυξη) δεν υπάρχει bundle
    if (!mine) return;
    const check = () => {
      fetch('/', { cache: 'no-store' })
        .then((r) => r.text())
        .then((html) => {
          const m = /\/assets\/index-[\w-]+\.js/.exec(html);
          if (m && !mine.endsWith(m[0])) setStale(true);
        })
        .catch(() => {});
    };
    const onVisible = () => document.visibilityState === 'visible' && check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 60_000);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);
  return stale;
}

export function App() {
  const newVersion = useNewVersion();
  const { tabs, active, activate, closeTab, openTab, settings, loadSettings, refreshLibrary } = useApp();
  const unseenNotes = useUnseenReleaseNotes();
  useReleaseNotesAutoOpen(() => activate('notes'));

  useEffect(() => {
    loadSettings().catch(reportError);
    refreshLibrary().catch(reportError);
    // ξεχωριστό παράθυρο: η καρτέλα του από τον server
    if (OPEN_KEY) {
      api
        .get<{ tab: Tab }>(`/api/window/${OPEN_KEY}`)
        .then((r) => useApp.setState({ tabs: [r.tab], active: r.tab.id }))
        .catch(() => useApp.setState({ tabs: [{ id: 'library', kind: 'library', title: 'Βάσεις' }], active: 'library' }));
    }
    const t = setInterval(() => {
      if (useApp.getState().jobs.some((j) => j.status === 'running')) void refreshLibrary();
    }, 5000);
    return () => clearInterval(t);
  }, [loadSettings, refreshLibrary]);

  // «Οι παρτίδες μου» από Lichess / Chess.com: ειδοποίηση όταν μπουν νέες (μόνο στο κύριο παράθυρο)
  useEffect(() => {
    if (OPEN_KEY) return;
    return onServerEvent('mygames', (e: { added: number }) =>
      useApp
        .getState()
        .toast(
          e.added === 1 ? L('1 νέα παρτίδα σου στη βάση «Οι παρτίδες μου».', '1 new game of yours in “My games”.') : L(`${e.added} νέες παρτίδες σου στη βάση «Οι παρτίδες μου».`, `${e.added} new games of yours in “My games”.`),
          'ok',
        ),
    );
  }, []);

  // Watch Live: κόκκινη τελεία στην καρτέλα όταν παίζεται μεγάλο event που δεν είδε ακόμη ο χρήστης
  useBigEventsPoll(!OPEN_KEY);
  const bigEvents = useBigEvents((s) => unseenEvents(s).map((e) => e.name).join(' · '));
  const activeKind = tabs.find((t) => t.id === active)?.kind;
  useEffect(() => {
    if (activeKind === 'watch') markEventsSeen();
  }, [activeKind, bigEvents]);

  // ήχος: διακόπτης, σετ και ένταση από τις ρυθμίσεις (και όταν αλλάξουν σε άλλο παράθυρο)
  const uiSettings = settings?.ui as Record<string, unknown> | undefined;
  useEffect(() => setSoundConfig(soundConfig(uiSettings)), [uiSettings]);

  // Φίλοι: μία σύνδεση, στο κύριο παράθυρο
  const social = settings && !OPEN_KEY ? accountOf(uiSettings) : null;
  useEffect(() => {
    if (settings) connectSocial(social);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(settings), social?.server, social?.userId, social?.key]);

  // θέμα εμφάνισης
  const theme = ((settings?.ui as Record<string, unknown> | undefined)?.theme as string) ?? 'light';
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  // γενικές συντομεύσεις
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openTab({ id: newTabId('game'), kind: 'game', title: L('Νέα παρτίδα', 'New game'), fen: START_FEN });
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        const id = useApp.getState().active;
        close(id);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  });

  const close = (id: string) => {
    const tab = useApp.getState().tabs.find((t) => t.id === id);
    if (!tab || (FIXED_TABS.includes(tab.id) && !OPEN_KEY)) return;
    // παρτίδα με αλλαγές: «Αποθήκευση / Χωρίς αποθήκευση / Άκυρο» (στο παράθυρο της σκακιέρας)
    if (tab.kind === 'game' && tab.title.startsWith('• ')) {
      useApp.setState({ closeRequest: id, active: id });
      return;
    }
    dropController(id);
    closeTab(id);
  };

  // Το × του ίδιου του παραθύρου με αλλαγές: η σελίδα ζητά επιβεβαίωση και ο server (browser.ts)
  // απορρίπτει αμέσως το μήνυμα του browser, οπότε το παράθυρο μένει ανοιχτό και εμφανίζεται μόνο η
  // δική μας ερώτηση «Αποθήκευση;» στο κέντρο. (Χωρίς τον server: πρώτα το μήνυμα του browser.)
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      const dirty = useApp.getState().tabs.find((t) => t.kind === 'game' && t.title.startsWith('• '));
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
      setTimeout(() => {
        useApp.setState({ closeRequest: dirty.id, active: dirty.id });
        void api.post('/api/window/asked', { key: OPEN_KEY ?? 'main' }).catch(() => {});
      }, 150);
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, []);

  // τίτλος του παραθύρου (ξεχωρίζει στη γραμμή εργασιών)
  const current = tabs.find((t) => t.id === active);
  const name = !current || (current.kind === 'library' && !OPEN_KEY) ? '' : fixedTitle(current);
  useEffect(() => {
    document.title = name ? `${name} — Ruru Chess` : 'Ruru Chess';
  }, [name]);

  // ξεχωριστό παράθυρο που έκλεισε η τελευταία του καρτέλα (αν το browser δεν το κλείσει)
  const hadTabs = useRef(false);
  if (tabs.length) hadTabs.current = true;
  // η Βελτίωση φορτώνεται την πρώτη φορά που ανοίγει (όχι με την εκκίνηση)
  const visited = useRef(new Set<string>());
  visited.current.add(active);
  if (OPEN_KEY && !tabs.length && hadTabs.current) {
    return (
      <div className="loading-screen">
        {L('Μπορείς να κλείσεις αυτό το παράθυρο.', 'You can close this window.')}
      </div>
    );
  }
  if (!settings || !tabs.length) return <div className="loading-screen">Ruru…</div>;

  return (
    <div className="app" key={language()}>
      <header className="tabbar">
        <div
          className="brand"
          title={OPEN_KEY ? L('Βάσεις (κύριο παράθυρο)', 'Databases (main window)') : 'Ruru Chess'}
          onClick={() => (OPEN_KEY ? openTab({ id: 'library', kind: 'library', title: 'Βάσεις' }) : activate('library'))}
        >
          <img src="/icon.png?v=3.0.0" alt="" />
        </div>
        <div className="tabs">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab${t.id === active ? ' active' : ''}`}
              data-guide={FIXED_TABS.includes(t.id) ? `tab-${t.kind}` : undefined}
              onClick={() => activate(t.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(t.id);
                }
              }}
              title={t.title}
            >
              <TabIcon tab={t} />
              <span className="tab-title">{fixedTitle(t)}</span>
              {t.kind === 'watch' && bigEvents && <span className="tab-dot" title={L(`Live τώρα: ${bigEvents}`, `Live now: ${bigEvents}`)} aria-label={L(`Live τώρα: ${bigEvents}`, `Live now: ${bigEvents}`)} />}
              {t.kind === 'notes' && unseenNotes && <span className="tab-dot" title={L('Νέα έκδοση — δες τι άλλαξε', 'New version — see what changed')} aria-label={L('Νέα έκδοση', 'New version')} />}
              {t.kind !== 'library' && !(FIXED_TABS.includes(t.id) && !OPEN_KEY) && (
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    close(t.id);
                  }}
                  aria-label={L('Κλείσιμο', 'Close')}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="tabbar-actions">
          <button className="icon-btn" title={L('Νέα παρτίδα (Ctrl+N)', 'New game (Ctrl+N)')} onClick={() => openTab({ id: newTabId('game'), kind: 'game', title: L('Νέα παρτίδα', 'New game'), fen: START_FEN })}>
            <FilePlus2 size={17} />
          </button>
          <SoundButton />
          <HelpButton
            canRestartGuide={!OPEN_KEY}
            onRestartGuide={() => {
              restartGuide();
              activate('library');
            }}
            onOpenReleaseNotes={() => openTab(NOTES_TAB)}
            onOpenSettings={() => openTab({ id: 'settings', kind: 'settings', title: 'Settings' })}
          />
          <button className="icon-btn" title={L('Ρυθμίσεις', 'Settings')} onClick={() => openTab({ id: 'settings', kind: 'settings', title: 'Settings' })}>
            <SettingsIcon size={17} />
          </button>
        </div>
      </header>
      {newVersion && (
        <div className="new-version" role="status">
          {L('Το Ruru ενημερώθηκε σε νέα έκδοση. Ανανέωσε το παράθυρο για να τη δεις.', 'Ruru has been updated. Reload the window to see the new version.')}
          <button className="primary" onClick={() => location.reload()}>
            {L('Ανανέωση', 'Reload')}
          </button>
        </div>
      )}
      <main className="windows">
        {tabs.map((t) => (
          <section key={t.id} className={`window${t.id === active ? ' active' : ''}`}>
            {t.kind === 'library' && <LibraryWindow />}
            {t.kind === 'db' && <DatabaseWindow tab={t} />}
            {t.kind === 'game' && <BoardWindow tab={t} active={t.id === active} />}
            {t.kind === 'settings' && <SettingsWindow />}
            {t.kind === 'trainer' && <TrainerWindow tab={t} active={t.id === active} />}
            {t.kind === 'tactics' && visited.current.has(t.id) && <ImproveWindow tab={t} active={t.id === active} />}
            {t.kind === 'bots' && visited.current.has(t.id) && <BotsWindow active={t.id === active} />}
            {t.kind === 'books' && visited.current.has(t.id) && <BooksWindow active={t.id === active} />}
            {t.kind === 'friend' && visited.current.has(t.id) && <FriendWindow active={t.id === active} />}
            {t.kind === 'share' && visited.current.has(t.id) && <ShareWindow active={t.id === active} />}
            {t.kind === 'watch' && visited.current.has(t.id) && <WatchWindow active={t.id === active} />}
            {t.kind === 'prep' && visited.current.has(t.id) && <PrepWindow active={t.id === active} />}
            {t.kind === 'notes' && visited.current.has(t.id) && <ReleaseNotesWindow active={t.id === active} />}
          </section>
        ))}
      </main>
      {SOCIAL && !OPEN_KEY && <ChatDock />}
      {SOCIAL && !OPEN_KEY && <SocialNotices />}
      {SOCIAL && !OPEN_KEY && <InviteGameDialog />}
      {SOCIAL && !OPEN_KEY && <InviteAnalysisDialog />}
      {SOCIAL && !OPEN_KEY && <TeamDialogs />}
      {SOCIAL && <SendFileDialog />}
      {SOCIAL && !OPEN_KEY && <SafetyDialogs />}
      <Toasts />
      <Guide />
    </div>
  );
}
