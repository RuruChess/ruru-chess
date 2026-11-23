/** Επανάληψη σε διαστήματα με FSRS-6 (ts-fsrs, MIT): κάρτες puzzles σε ημέρες, χωρίς «θόρυβο» στα διαστήματα. */
import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs';
import type { ReviewGrade } from '../../core/puzzle.ts';

/** Παράμετροι: προεπιλογές FSRS-6 (21 βάρη, διατήρηση 0,9), χωρίς βήματα λεπτών (μία επανάληψη τη μέρα το πολύ). */
export const FSRS_PARAMS = generatorParameters({ enable_fuzz: false, enable_short_term: false, request_retention: 0.9, maximum_interval: 36500 });
const scheduler = fsrs(FSRS_PARAMS);

/** Γραμμή του πίνακα card. */
export interface CardRow {
  deck_id: number;
  puzzle_id: number;
  due: number;
  stability: number;
  difficulty: number;
  scheduled: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning */
  state: number;
  last: number | null;
  added: number;
  ord: number;
}

export const STATE_NAMES = ['new', 'learning', 'review', 'relearning'] as const;

function toCard(r: CardRow | null, now: number): Card {
  if (!r || r.state === 0) return createEmptyCard(new Date(now));
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: 0,
    scheduled_days: r.scheduled,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as Card['state'],
    last_review: r.last ? new Date(r.last) : undefined,
  };
}

/** Νέα κατάσταση κάρτας μετά από μια επανάληψη με βαθμό 1–4 (Again/Hard/Good/Easy). */
export function scheduleCard(r: CardRow | null, grade: ReviewGrade, now: number): Pick<CardRow, 'due' | 'stability' | 'difficulty' | 'scheduled' | 'learning_steps' | 'reps' | 'lapses' | 'state' | 'last'> {
  const { card } = scheduler.next(toCard(r, now), new Date(now), grade as Grade);
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    last: now,
  };
}

/** Πιθανότητα ανάκλησης τώρα (0–1)· null για νέα κάρτα. */
export function retrievability(r: CardRow, now: number): number | null {
  if (r.state === 0) return null;
  return scheduler.get_retrievability(toCard(r, now), new Date(now), false);
}
