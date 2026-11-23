/** Μαθήματα φινάλε για προβολή (σαν σχολιασμένες παρτίδες): τα δεδομένα από τον server και ποια είδε ο χρήστης ως το τέλος (ρυθμίσεις ui). */
import { api } from '../api.ts';
import { useApp } from '../store.ts';
import { setUiLater } from './store.ts';

type Text2 = { el: string; en: string };

export interface EndgameLesson {
  seq: number;
  /** η θέση στη σειρά του μαθήματος */
  order: number;
  /** το επίπεδο */
  part: Text2;
  fen: string;
  /** η πρώτη κίνηση είναι του αντιπάλου */
  pre?: boolean;
  goal: 'win' | 'draw';
  rating: number;
  title: Text2;
  intro?: Text2;
  summary: Text2;
  /** κινήσεις σε PGN με {σχόλια} και (βαριάντες), ίδιες στις δύο γλώσσες */
  solution: Text2;
  source?: { article: string; oldid: number; url: string } | { book: string; author: string; year: number; chapter?: string };
}

export const endgameLessonsApi = {
  list: () => api.get<{ items: EndgameLesson[] }>('/api/tactics/endgame-lessons'),
};

/** Ποια μαθήματα είδε ο χρήστης ως το τέλος της κύριας γραμμής (seq) και ποιο άνοιξε τελευταίο. */
export interface EndgameSeen {
  seen: number[];
  last?: number;
}
// σταθερό αντικείμενο: ο selector πρέπει να επιστρέφει το ίδιο όταν δεν υπάρχει πρόοδος
const NONE: EndgameSeen = { seen: [] };

const current = (): EndgameSeen => ((useApp.getState().settings?.ui as Record<string, unknown> | undefined)?.endgameLessons as EndgameSeen | undefined) ?? NONE;

export function useEndgameSeen(): EndgameSeen {
  return useApp((s) => ((s.settings?.ui as Record<string, unknown> | undefined)?.endgameLessons as EndgameSeen | undefined) ?? NONE);
}

export function markEndgameSeen(seq: number): void {
  const cur = current();
  if (!cur.seen.includes(seq)) setUiLater({ endgameLessons: { ...cur, seen: [...cur.seen, seq] } });
}

export function setLastEndgame(seq: number): void {
  const cur = current();
  if (cur.last !== seq) setUiLater({ endgameLessons: { ...cur, last: seq } });
}
