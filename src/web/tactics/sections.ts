/** Οι σελίδες της «Βελτίωσης»: Τακτικά (μόνο συνδυασμοί), Φινάλε και Στρατηγικά, με τις υποομάδες των συλλογών τους. */
import { L } from '../i18n.ts';
import type { TacticsMode } from './prefs.ts';

export type Section = 'tactics' | 'endgame' | 'strategy';
export const SECTIONS: Section[] = ['tactics', 'endgame', 'strategy'];

export const sectionName = (s: Section): string => (s === 'tactics' ? L('Τακτικά', 'Tactics') : s === 'endgame' ? L('Φινάλε', 'Endgames') : L('Στρατηγικά', 'Strategy'));

export const sectionNote = (s: Section): string =>
  s === 'tactics'
    ? L('Μόνο συνδυασμοί και ματ', 'Combinations and mates only')
    : s === 'endgame'
      ? L('Τεχνική και θεωρία των φινάλε', 'Endgame technique and theory')
      : L('Θέσεις για στρατηγική σκέψη', 'Positions for strategic thinking');

/** Οι τρόποι κάθε σελίδας: τα φινάλε και τα στρατηγικά έχουν μόνο εξάσκηση από τις συλλογές τους. */
export const sectionModes = (s: Section): TacticsMode[] => (s === 'tactics' ? ['rated', 'review', 'storm', 'streak', 'rush', 'woodpecker', 'daily'] : ['rated']);

/** Τι λύση δίνει η πηγή μιας συλλογής (για να ξέρεις τι κατεβάζεις και τι λύνεις). */
export const solutionText = (s: 'lines' | 'best' | 'none'): string =>
  s === 'lines'
    ? L('με λύση από την πηγή', 'with source solutions')
    : s === 'best'
      ? L('η πηγή δίνει μόνο την καλύτερη κίνηση', 'the source gives only the best move')
      : L('χωρίς λύση στην πηγή (μόνο θέσεις)', 'no source solutions (positions only)');

/** Οι υποομάδες των συλλογών (πεδίο `cat` του server) ανά σελίδα, με τη σειρά τους. */
export const CATS: Record<Section, Array<{ id: string; title: () => string; note: () => string }>> = {
  tactics: [
    { id: 'combos', title: () => L('Συνδυασμοί', 'Combinations'), note: () => L('Τακτικά θέματα από παρτίδες, ανά θέμα ή επίπεδο.', 'Tactical themes from games, by theme or level.') },
    { id: 'mates', title: () => L('Ματ', 'Mates'), note: () => L('Ματ από παρτίδες και προβλήματα σύνθεσης. Οι πολύ μεγάλες συλλογές μπαίνουν μόνο μία μία.', 'Mates from games and composed problems. The very large collections are imported one by one only.') },
  ],
  endgame: [
    { id: 'lessons', title: () => L('Μαθήματα με εξηγήσεις', 'Lessons with explanations'), note: () => L('Οι βασικές θέσεις, με λύση, υποβαριάντες και σχόλιο σε κάθε κίνηση. Είναι ήδη μέσα στην εφαρμογή.', 'The basic positions, with solution, sub-variations and a comment on every move. Already inside the app.') },
    { id: 'endgames', title: () => L('Φινάλε', 'Endgames'), note: () => L('Θέσεις που τις παίζεις ως το τέλος απέναντι στη μηχανή.', 'Positions you play to the end against the engine.') },
  ],
  strategy: [
    { id: 'tests', title: () => L('Τεστ: βρες την καλύτερη κίνηση', 'Tests: find the best move'), note: () => L('Κλασικά τεστ θέσεων· κρίνεται μόνο η πρώτη κίνηση.', 'Classic test suites; only the first move is judged.') },
    { id: 'positional', title: () => L('Θέσεις μέσου παιχνιδιού', 'Middlegame positions'), note: () => L('Θέσεις που τις παίζεις απέναντι στη μηχανή.', 'Positions you play against the engine.') },
  ],
};
