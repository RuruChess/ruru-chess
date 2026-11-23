/**
 * Watch Live (φάση 3): κόκκινη τελεία στην καρτέλα όταν παίζεται τώρα ένα μεγάλο event (broadcast του Lichess με
 * tier 5, π.χ. Candidates, Grand Chess Tour) που ο χρήστης δεν έχει δει ακόμη. Έλεγχος κάθε 5′, μόνο όσο το παράθυρο
 * φαίνεται και το Watch Live είναι ανοιχτό στις ρυθμίσεις (ο server κρατά τη λίστα στην cache του 1′).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../api.ts';
import { useApp } from '../store.ts';

export interface BigEvent {
  id: string;
  name: string;
}

const SEEN_KEY = 'knightbase.watch.seenEvents';
/** «κορυφαία» broadcasts του Lichess */
const BIG_TIER = 5;
const EVERY = 5 * 60_000;

function readSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-50) : [];
  } catch {
    return [];
  }
}

export const useBigEvents = create<{ live: BigEvent[]; seen: string[] }>(() => ({ live: [], seen: readSeen() }));

/** Τα μεγάλα events που παίζονται τώρα και δεν τα έχει δει ο χρήστης (για την κόκκινη τελεία). */
export const unseenEvents = (s: { live: BigEvent[]; seen: string[] }) => s.live.filter((e) => !s.seen.includes(e.id));

/** Ο χρήστης άνοιξε το Watch Live: τα τωρινά events μετρούν ως «τα είδε». */
export function markEventsSeen(): void {
  const { live, seen } = useBigEvents.getState();
  if (live.every((e) => seen.includes(e.id))) return;
  const next = [...new Set([...seen, ...live.map((e) => e.id)])].slice(-50);
  useBigEvents.setState({ seen: next });
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* χωρίς αποθήκευση: θα ξαναφανεί στο επόμενο άνοιγμα */
  }
}

interface Tour {
  tour: { id: string; name: string; tier: number };
  round: { ongoing: boolean } | null;
}

/** Μία φορά στο App (μόνο στο κύριο παράθυρο, όπου είναι η καρτέλα): έλεγχος για μεγάλα events. */
export function useBigEventsPoll(main: boolean): void {
  const enabled = useApp((s) => main && s.settings !== null && s.settings.watchLive !== false);
  useEffect(() => {
    if (!enabled) {
      useBigEvents.setState({ live: [] });
      return;
    }
    let last = 0;
    let stop = false;
    const poll = () => {
      if (stop || document.hidden || Date.now() - last < EVERY - 5000) return;
      last = Date.now();
      api
        .get<{ active: Tour[] }>('/api/watch/broadcasts')
        .then((r) => {
          if (stop) return;
          const live = r.active.filter((t) => t.tour.tier >= BIG_TIER && t.round?.ongoing).map((t) => ({ id: t.tour.id, name: t.tour.name }));
          useBigEvents.setState({ live });
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 30_000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [enabled]);
}
