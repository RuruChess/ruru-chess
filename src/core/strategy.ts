/** Καθαρή λογική προόδου και τρόπων ανοίγματος των Στρατηγικών μαθημάτων (χωρίς browser globals). */

/** Πρόοδος σε ένα μάθημα: ως ποια ημικίνηση φάνηκε η παρτίδα, οι απαντήσεις (ημικίνηση → SAN, '' = «δείξε μου»). */
export interface GameProgress {
  revealed: number;
  answers: Record<string, string>;
  done?: boolean;
  /** έχει απαντήσει όλες τις ερωτήσεις του μαθήματος (σωστά ή λάθος) τουλάχιστον μία φορά */
  allAnswered?: boolean;
}

export type GameLessonMode = 'lesson' | 'again' | 'review';

/** Εμφανίζεται το «Περιήγηση / Review» μόνο όταν ο χρήστης έχει κάνει όλες τις ασκήσεις της παρτίδας (σωστά ή λάθος). */
export function canReviewLesson(p: GameProgress | undefined, totalQuestions: number): boolean {
  if (!p) return false;
  if (p.allAnswered) return true;
  if (totalQuestions > 0) return Object.keys(p.answers ?? {}).length >= totalQuestions;
  return Boolean(p.done);
}
