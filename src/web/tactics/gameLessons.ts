/** Μαθήματα στρατηγικής: σχολιασμένες παρτίδες από τον server, και η πρόοδος του χρήστη σε καθεμιά (στις ρυθμίσεις ui). */
import { api } from '../api.ts';
import { language } from '../i18n.ts';
import { useApp } from '../store.ts';
import { setUiLater } from './store.ts';

type Text2 = { el: string; en: string };

export interface GameLessonInfo {
  id: string;
  seq: number;
  white: string;
  black: string;
  event: string;
  year: number;
  result: string;
  opening: Text2;
  title: Text2;
  theme: Text2;
  intro: Text2;
  summary: Text2;
  annotator: string;
  /** lang: η γλώσσα του βιβλίου, αν δεν είναι τα αγγλικά (τότε και τα αγγλικά είναι μετάφραση) */
  source: { book: string; author: string; year: number; game: number; lang?: 'de' };
}

export interface GameQuestion {
  /** η ημικίνηση της κύριας γραμμής που ζητείται (1 = η πρώτη κίνηση των λευκών) */
  ply: number;
  ask: Text2;
  /** όσες κινήσεις προτείνει ο σχολιαστής (κενό: καμία συγκεκριμένη) */
  best: string[];
  /** ο σχολιαστής επικρίνει την κίνηση που παίχτηκε */
  criticised?: boolean;
}

export interface GameLesson extends GameLessonInfo {
  pgn: Text2;
  questions: GameQuestion[];
}

export const gamesApi = {
  /** fen: η θέση πριν από την πρώτη ερώτηση (διάγραμμα της λίστας) */
  list: () => api.get<{ items: Array<GameLessonInfo & { questions: number; fen: string }> }>('/api/tactics/games'),
  get: (id: string) => api.get<GameLesson>(`/api/tactics/games/${encodeURIComponent(id)}`),
};

/** Κείμενο στη γλώσσα του χρήστη. */
export const tr = (t: Text2): string => (language() === 'en' ? t.en : t.el);

/** Πρόοδος σε ένα μάθημα: ως ποια ημικίνηση φάνηκε η παρτίδα, οι απαντήσεις (ημικίνηση → SAN, '' = «δείξε μου»). */
export interface GameProgress {
  revealed: number;
  answers: Record<string, string>;
  done?: boolean;
}

type ProgressMap = Record<string, GameProgress>;
// σταθερό αντικείμενο: ο selector πρέπει να επιστρέφει το ίδιο όταν δεν υπάρχει πρόοδος
const NONE: ProgressMap = {};

export function useGameProgress(): ProgressMap {
  return useApp((s) => ((s.settings?.ui as Record<string, unknown> | undefined)?.gameLessons as ProgressMap | undefined) ?? NONE);
}

export function saveGameProgress(id: string, p: GameProgress): void {
  const cur = ((useApp.getState().settings?.ui as Record<string, unknown> | undefined)?.gameLessons as ProgressMap | undefined) ?? {};
  setUiLater({ gameLessons: { ...cur, [id]: p } });
}

/** Ο τίτλος ενός βιβλίου-πηγής μεταφρασμένος, όπου βοηθά (στα αγγλικά μόνο για τα γερμανικά βιβλία). */
const BOOK_TITLES: Record<string, Text2> = {
  'Chess Fundamentals': { el: 'Οι βάσεις του σκακιού', en: '' },
  'My Chess Career': { el: 'Η σκακιστική μου καριέρα', en: '' },
  'Der Schachwettkampf Lasker–Tarrasch': { el: 'Ο αγώνας Lasker–Tarrasch για το παγκόσμιο πρωτάθλημα', en: 'The Lasker–Tarrasch world championship match' },
  'Das Champion-Turnier zu Ostende im Jahre 1907': { el: 'Το τουρνουά πρωταθλητών της Οστάνδης, 1907', en: 'The Ostend championship tournament, 1907' },
};
export const bookTitle = (book: string): string => (BOOK_TITLES[book] ? tr(BOOK_TITLES[book]) : '');
