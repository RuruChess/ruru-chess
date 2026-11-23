/** Τα μαθήματα της εφαρμογής (ενσωματωμένες συλλογές): τίτλος, στόχος, εισαγωγή, λύση με σχόλια και πηγή, στη γλώσσα του χρήστη. */
import { L, language } from '../i18n.ts';
import type { Puzzle } from './api.ts';

export interface LessonInfo {
  title: string;
  /** τι πρέπει να πετύχει ο λύτης */
  goal: 'win' | 'draw';
  intro: string;
  /** τι κρατάς από το μάθημα */
  summary: string;
  /** η λύση σε PGN με {σχόλια} και (υποβαριάντες) */
  solution: string;
  article: string;
  url: string;
  /** βιβλίο κοινού κτήματος (π.χ. «Chess Fundamentals»): τίτλος, συγγραφέας, έτος */
  book: string;
  author: string;
  year: number;
}

const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const x = o[language()] ?? o.el;
    if (typeof x === 'string') return x;
  }
  return '';
};

export function lessonOf(p: Puzzle): LessonInfo | null {
  const m = p.meta;
  if (!m || m.lesson !== true) return null;
  const en = language() === 'en' && typeof m.solutionEn === 'string';
  return {
    title: text(m.title),
    goal: m.goal === 'draw' ? 'draw' : 'win',
    intro: text(m.intro),
    summary: text(m.summary),
    solution: en ? (m.solutionEn as string) : text(m.solution),
    article: text(m.article),
    url: text(m.url),
    book: text(m.book),
    author: text(m.author),
    year: typeof m.year === 'number' ? m.year : 0,
  };
}

/** «Στόχος: νίκη με τα λευκά». */
export function lessonGoal(color: 'white' | 'black', goal: 'win' | 'draw'): string {
  const w = color === 'white';
  return goal === 'win'
    ? L(`Στόχος: νίκη με τα ${w ? 'λευκά' : 'μαύρα'}.`, `Goal: ${w ? 'White' : 'Black'} wins.`)
    : L(`Στόχος: ισοπαλία με τα ${w ? 'λευκά' : 'μαύρα'}.`, `Goal: ${w ? 'White' : 'Black'} draws.`);
}

/** Αξιολόγηση (από τη σκοπιά του λύτη) που κρατά τον στόχο του μαθήματος, για κινήσεις εκτός της λύσης. */
export function keepsLessonGoal(goal: 'win' | 'draw', v: number | null): boolean {
  if (v === null) return false;
  return goal === 'win' ? v >= 300 : v >= -100;
}

/** Η πλευρά που μαθαίνει: αυτή που παίζει, ή η άλλη όταν πρώτα κινείται ο αντίπαλος. */
export function lessonSide(fen: string, pre?: boolean): 'white' | 'black' {
  const whiteToMove = fen.split(' ')[1] !== 'b';
  return whiteToMove !== Boolean(pre) ? 'white' : 'black';
}
