/** Κατάσταση εφαρμογής: ανοιχτά παράθυρα (καρτέλες), ρυθμίσεις, βάσεις, μηνύματα. */
import { create } from 'zustand';
import { api, onServerEvent, onServerOpen, type DbInfo, type JobInfo, type SearchCriteria, type Settings } from './api.ts';
import { L, setLanguage } from './i18n.ts';
import type { LiveSource } from './watch/useLive.ts';

export type Tab =
  | { id: string; kind: 'library'; title: string }
  | { id: string; kind: 'settings'; title: string }
  | {
      id: string;
      kind: 'db';
      title: string;
      dbId: string;
      /** αναζήτηση θέσης με το άνοιγμα (π.χ. «παρτίδες» από το δέντρο) */
      fen?: string;
      /** φίλτρο με το άνοιγμα (π.χ. παίκτης από την αναζήτηση των Βάσεων) */
      filter?: SearchCriteria;
      /** ανοίγει αμέσως η «Αναζήτηση παρτίδων» */
      openSearch?: boolean;
    }
  | {
      id: string;
      kind: 'game';
      title: string;
      /** από πού ήρθε η παρτίδα (για αποθήκευση / επόμενη παρτίδα) */
      source?: { dbId: string; gameId: number; viewKey?: string };
      /** αρχικό PGN ή FEN */
      pgn?: string;
      fen?: string;
      mode?: 'normal' | 'training' | 'play';
      /** νέα παρτίδα μέσα σε βάση: εκεί αποθηκεύεται χωρίς ερώτηση */
      targetDb?: string;
      /** ξανάνοιγμα με αλλαγές που δεν αποθηκεύτηκαν (μετά το «Άκυρο» στην ερώτηση κλεισίματος) */
      dirty?: boolean;
      /** άνοιγμα σε αυτή την ημικίνηση της κύριας γραμμής (π.χ. puzzle της Τακτικής) */
      ply?: number;
      /** η μηχανή ξεκινά αμέσως */
      engine?: boolean;
      orientation?: 'white' | 'black';
      /** κοινή ανάλυση live: νέο δωμάτιο ή συνέχεια παλιού */
      share?: 'new' | { server: string; id: string; token: string; name?: string };
      /** Watch Live: οι κινήσεις έρχονται live από το Lichess */
      live?: LiveSource;
    }
  | {
      id: string;
      kind: 'trainer';
      title: string;
      /** βάση ρεπερτορίου ('' = να διαλέξει ο χρήστης) */
      dbId: string;
      color?: 'white' | 'black';
      /** αρχική θέση (αλλιώς η αρχική του σκακιού) */
      fen?: string;
    }
  | {
      id: string;
      kind: 'tactics';
      title: string;
      /** τράπουλα επανάληψης με το άνοιγμα */
      deck?: number;
      /** λύση χωρίς σκακιέρα (τυφλά) */
      blind?: boolean;
      /** αλλάζει σε κάθε νέο αίτημα, ώστε μια ανοιχτή καρτέλα να ξαναπάει στην τράπουλα */
      deckSeq?: number;
    }
  | { id: string; kind: 'bots'; title: string }
  | { id: string; kind: 'books'; title: string }
  | { id: string; kind: 'friend'; title: string }
  | { id: string; kind: 'share'; title: string }
  | { id: string; kind: 'watch'; title: string }
  | { id: string; kind: 'prep'; title: string }
  | { id: string; kind: 'notes'; title: string };

/** Η Βελτίωση (Τακτικά, Φινάλε, Στρατηγικά): μόνιμη καρτέλα του κύριου παραθύρου, δίπλα στις Βάσεις. */
export const TACTICS_TAB: Tab = { id: 'tactics', kind: 'tactics', title: 'Βελτίωση' };

/** «Παίξε με bots»: μόνιμη καρτέλα του κύριου παραθύρου, δίπλα στη Βελτίωση. */
export const BOTS_TAB: Tab = { id: 'bots', kind: 'bots', title: 'Παίξε με bots' };

/** «Βιβλίο σε βάση»: μόνιμη καρτέλα του κύριου παραθύρου, δίπλα στο «Παίξε με bots». */
export const BOOKS_TAB: Tab = { id: 'books', kind: 'books', title: 'Βιβλίο σε βάση' };

/** «Παίξε με φίλο» (μέσω link): μόνιμη καρτέλα του κύριου παραθύρου, δίπλα στο «Βιβλίο σε βάση». */
export const FRIEND_TAB: Tab = { id: 'friend', kind: 'friend', title: 'Παίξε με φίλο' };

/** «Κοινή ανάλυση» (live, μέσω link): μόνιμη καρτέλα του κύριου παραθύρου, δίπλα στο «Παίξε με φίλο». */
export const SHARE_TAB: Tab = { id: 'share', kind: 'share', title: 'Κοινή ανάλυση' };

/** «Watch Live» (παρτίδες σε εξέλιξη από το Lichess): μόνιμη καρτέλα του κύριου παραθύρου, δίπλα στην «Κοινή ανάλυση». */
export const WATCH_TAB: Tab = { id: 'watch', kind: 'watch', title: 'Watch Live' };

/** «Προετοιμασία για αντίπαλο» (παρτίδες ενός παίκτη από Lichess, Chess.com και τις βάσεις): μόνιμη καρτέλα, δίπλα στο Watch Live. */
export const PREP_TAB: Tab = { id: 'prep', kind: 'prep', title: 'Prepare for opponent' };

/** «Εκδόσεις / Patch Notes» (σημειώσεις εκδόσεων τύπου LoL): μόνιμη καρτέλα, δίπλα στην Προετοιμασία. */
export const NOTES_TAB: Tab = { id: 'notes', kind: 'notes', title: 'Patch Notes' };

/** Οι μόνιμες καρτέλες του κύριου παραθύρου (δεν κλείνουν). */
export const FIXED_TABS = ['library', 'tactics', 'bots', 'books', 'friend', 'share', 'watch', 'prep', 'notes'];

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
}

/**
 * Ξεχωριστό παράθυρο: ανοίχτηκε με #open=<κλειδί> και έχει μία
 * μόνο καρτέλα, που τη δίνει ο server. Το κύριο παράθυρο κρατά τη Βιβλιοθήκη.
 */
export const OPEN_KEY = /^#open=([\w-]+)/.exec(location.hash)?.[1] ?? null;
/** Μικρό παράθυρο «Αποθήκευση;» για παρτίδα παραθύρου της 0.3.0 που έκλεισε με το × του. */
export const CLOSE_KEY = /^#closeprompt=([\w-]+)/.exec(location.hash)?.[1] ?? null;

interface AppState {
  tabs: Tab[];
  active: string;
  /** καρτέλα παρτίδας που ζητήθηκε να κλείσει ενώ έχει αλλαγές (ερώτηση αποθήκευσης) */
  closeRequest: string | null;
  settings: Settings | null;
  library: DbInfo[];
  jobs: JobInfo[];
  toasts: Toast[];
  /** επιλογή ζωντανής παρτίδας από το Watch Live για να ανοίξει κατευθείαν στην Κοινή ανάλυση */
  watchPickForShare: boolean;
  shareLivePick: { title: string; live: LiveSource; orientation?: 'white' | 'black' } | null;
  openTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  setWatchPickForShare: (on: boolean) => void;
  setShareLivePick: (p: { title: string; live: LiveSource; orientation?: 'white' | 'black' } | null) => void;
  refreshLibrary: () => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  /** αποθήκευση κλειδιών του ui (συγχώνευση στον server· η αλλαγή έρχεται με το SSE «settings») */
  saveUi: (patch: Record<string, unknown>) => Promise<void>;
  toast: (text: string, kind?: Toast['kind']) => void;
}

let toastId = 1;
let tabSeq = 1;

export function newTabId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${tabSeq++}`;
}

export const useApp = create<AppState>((set, get) => ({
  tabs: OPEN_KEY ? [] : [{ id: 'library', kind: 'library', title: 'Βάσεις' }, TACTICS_TAB, BOTS_TAB, BOOKS_TAB, FRIEND_TAB, SHARE_TAB, WATCH_TAB, PREP_TAB, NOTES_TAB],
  active: OPEN_KEY ? '' : 'library',
  closeRequest: null,
  settings: null,
  library: [],
  jobs: [],
  toasts: [],
  watchPickForShare: false,
  shareLivePick: null,
  setWatchPickForShare: (on) => set({ watchPickForShare: on }),
  setShareLivePick: (p) => set({ shareLivePick: p }),

  openTab: (tab) => {
    const existing = get().tabs.find((t) => {
      if (t.id === tab.id) return true;
      if (t.kind === 'db' && tab.kind === 'db') return t.dbId === tab.dbId;
      if (t.kind === 'settings' && tab.kind === 'settings') return true;
      if (t.kind === 'game' && tab.kind === 'game' && t.source && tab.source) {
        return t.source.dbId === tab.source.dbId && t.source.gameId === tab.source.gameId;
      }
      return false;
    });
    if (existing) {
      set({ active: existing.id });
      return;
    }
    // ξεχωριστά παράθυρα (προεπιλογή): ό,τι δεν είναι η Βιβλιοθήκη του κύριου παραθύρου
    const ui = get().settings?.ui as Record<string, unknown> | undefined;
    if (ui?.windows !== 'tabs' && (tab.kind !== 'library' || OPEN_KEY)) {
      api.post('/api/window', { origin: location.origin, tab }).catch(() => set((s) => ({ tabs: [...s.tabs, tab], active: tab.id })));
      return;
    }
    set((s) => ({ tabs: [...s.tabs, tab], active: tab.id }));
  },

  closeTab: (id) => {
    if (FIXED_TABS.includes(id) && !OPEN_KEY) return;
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const active = s.active === id ? (tabs[Math.max(0, i - 1)]?.id ?? 'library') : s.active;
      return { tabs, active, closeRequest: s.closeRequest === id ? null : s.closeRequest };
    });
    // ξεχωριστό παράθυρο χωρίς καρτέλες: κλείνει
    if (OPEN_KEY && !get().tabs.length) window.close();
  },

  activate: (id) => set({ active: id }),

  updateTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) })),

  refreshLibrary: async () => {
    const r = await api.get<{ databases: DbInfo[]; jobs: JobInfo[] }>('/api/library');
    set({ library: r.databases, jobs: r.jobs });
  },

  loadSettings: async () => {
    const s = await api.get<Settings>('/api/settings');
    setLanguage(s.language);
    set({ settings: s });
  },

  saveSettings: async (patch) => {
    const s = await api.put<Settings>('/api/settings', patch);
    setLanguage(s.language);
    set({ settings: s });
  },

  saveUi: async (patch) => {
    await api.put('/api/settings/ui', patch);
  },

  toast: (text, kind = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 4000);
  },
}));

// ενημερώσεις εργασιών από τον server
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
onServerEvent('job', (job: JobInfo) => {
  useApp.setState((s) => {
    const jobs = s.jobs.filter((j) => j.id !== job.id);
    jobs.push(job);
    return { jobs };
  });
  if (job.status !== 'running') {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void useApp.getState().refreshLibrary(), 200);
  }
});

// εργασία που ξεκίνησε πριν συνδεθεί το SSE (π.χ. εισαγωγή αμέσως μετά τη φόρτωση): το γεγονός της χάθηκε
onServerOpen(() => void useApp.getState().refreshLibrary().catch(() => {}));

// αλλαγές σε βάση (από οποιοδήποτε παράθυρο): ανανέωση καταλόγου και λιστών
let dbTimer: ReturnType<typeof setTimeout> | null = null;
onServerEvent('db', (d: { id: string }) => {
  window.dispatchEvent(new CustomEvent('knightbase:db-changed', { detail: d.id }));
  if (dbTimer) clearTimeout(dbTimer);
  dbTimer = setTimeout(() => void useApp.getState().refreshLibrary(), 300);
});

// ρυθμίσεις: η αποθήκευση και η «Εφαρμογή» από το παράθυρο ρυθμίσεων φτάνουν σε όλα τα παράθυρα
onServerEvent('settings', (s: Settings) => {
  setLanguage(s.language);
  useApp.setState({ settings: s });
});

// μηχανή που κατέβηκε (π.χ. το Stockfish στην πρώτη εκκίνηση): μήνυμα μόνο στο κύριο παράθυρο
onServerEvent('engineDownload', (s: { status: string; name?: string; upToDate?: boolean; error?: string }) => {
  if (OPEN_KEY) return;
  if (s.status === 'done' && !s.upToDate) useApp.getState().toast(L(`Η μηχανή ${s.name ?? 'Stockfish'} είναι έτοιμη`, `Engine ${s.name ?? 'Stockfish'} is ready`), 'ok');
  else if (s.status === 'error') useApp.getState().toast(L(`Λήψη Stockfish: ${s.error}`, `Stockfish download: ${s.error}`), 'error');
});

/** Σφάλμα → μήνυμα στον χρήστη. */
export function reportError(e: unknown): void {
  useApp.getState().toast((e as Error).message ?? String(e), 'error');
}
