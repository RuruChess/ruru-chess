/** Σύνοψη της τακτικής για όλες τις οθόνες (βαθμός, σερί ημερών, σήμερα, επαναλήψεις) και αλλαγή των προτιμήσεων του εκπαιδευτή (`ui.tactics`). */
import { create } from 'zustand';
import { onServerEvent } from '../api.ts';
import { useApp } from '../store.ts';
import { tacticsApi, type Dashboard, type Ratings, type SourceInfo, type ThemeName } from './api.ts';
import { prefsKey, readTacticsPrefs, type TacticsPrefs } from './prefs.ts';
import type { Section } from './sections.ts';
import { dayStreak, localDay } from './logic.ts';

interface Summary {
  ratings: Ratings | null;
  /** πίνακας επιδόσεων 30 ημερών (πλάγιο πάνελ, Αρχική) */
  dashboard: Dashboard | null;
  streak: number;
  today: { attempts: number; wins: number };
  /** κάρτες για επανάληψη τώρα */
  due: number;
  /** puzzles του Lichess στη βάση (null: άγνωστο ακόμη) */
  puzzles: number | null;
  /** θέσεις από τις άλλες συλλογές (Lucas Chess, Polgár, τεστ, Practice) */
  collections: number;
  /** οι πηγές με θέσεις στη βάση (για το φίλτρο «Πηγή» του εκπαιδευτή) */
  sources: SourceInfo[];
  names: Map<string, ThemeName>;
  loading: boolean;
  refresh: () => Promise<void>;
  checkPuzzles: () => Promise<number>;
}

let pending: Promise<void> | null = null;

export const useTactics = create<Summary>((set, get) => ({
  ratings: null,
  dashboard: null,
  streak: 0,
  today: { attempts: 0, wins: 0 },
  due: 0,
  puzzles: null,
  collections: 0,
  sources: [],
  names: new Map(),
  loading: false,
  refresh: () => {
    if (pending) return pending;
    set({ loading: true });
    pending = (async () => {
      try {
        const [d, due] = await Promise.all([tacticsApi.dashboard(30), tacticsApi.due().catch(() => null)]);
        const now = Date.now();
        const today = d.calendar.find((c) => c.day === localDay(now));
        set({
          dashboard: d,
          ratings: d.ratings,
          streak: dayStreak(
            d.calendar.filter((c) => c.attempts > 0).map((c) => c.day),
            now,
          ),
          today: { attempts: today?.attempts ?? 0, wins: today?.wins ?? 0 },
          due: due?.total ?? get().due,
        });
        if (!get().names.size) {
          const names = await tacticsApi.themeNames().catch(() => [] as ThemeName[]);
          set({ names: new Map(names.map((n) => [n.key, n])) });
        }
      } finally {
        set({ loading: false });
        pending = null;
      }
    })();
    return pending;
  },
  checkPuzzles: async () => {
    const s = await tacticsApi.sources();
    const n = s.sources.find((x) => x.key === 'lichess')?.count ?? 0;
    const others = s.sources.filter((x) => x.key !== 'lichess' && x.kind !== 'mine');
    set({ puzzles: n, collections: others.reduce((a, x) => a + x.count, 0), sources: s.sources.filter((x) => x.count > 0) });
    return n;
  },
}));

// μια προσπάθεια από οποιοδήποτε παράθυρο: η σύνοψη ανανεώνεται (μία φορά για πολλές μαζί)
let timer: ReturnType<typeof setTimeout> | null = null;
onServerEvent('tactics', (e: { type?: string; job?: { source?: string; status?: string } }) => {
  if (e?.type === 'attempt') {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void useTactics.getState().refresh().catch(() => {}), 400);
  } else if (e?.type === 'job' && e.job?.status === 'done') {
    void useTactics.getState().checkPuzzles().catch(() => {});
  }
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsaved: Record<string, unknown> = {};

/** Αλλαγή στο `ui` των ρυθμίσεων: φαίνεται αμέσως, γράφεται με καθυστέρηση (πολλές αλλαγές μαζί). */
export function setUiLater(patch: Record<string, unknown>): void {
  const s = useApp.getState();
  if (!s.settings) return;
  const ui = { ...((s.settings.ui as Record<string, unknown> | undefined) ?? {}), ...patch };
  useApp.setState({ settings: { ...s.settings, ui } });
  unsaved = { ...unsaved, ...patch };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = unsaved;
    unsaved = {};
    void useApp.getState().saveUi(p).catch(() => {});
  }, 500);
}

/** Αλλαγή προτιμήσεων μιας σελίδας της «Βελτίωσης». */
export function setTacticsPrefs(patch: Partial<TacticsPrefs>, section: Section = 'tactics'): void {
  const ui = useApp.getState().settings?.ui;
  setUiLater({ [prefsKey(section)]: { ...readTacticsPrefs(ui, section), ...patch } });
}
