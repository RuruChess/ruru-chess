import { describe, expect, it } from 'vitest';
import type { BookStats } from '../src/core/bookparse.ts';
import { bookVerdict, moveTokens, textWarning, worstPages } from '../src/core/bookquality.ts';

const stats = (o: Partial<BookStats>): BookStats => ({ games: 10, moves: 0, variations: 0, comments: 0, nags: 0, arrows: 0, circles: 0, unplaced: 0, ...o });

describe('ποιότητα ανάγνωσης βιβλίου', () => {
  it('καθαρές και χαλασμένες κινήσεις στο κείμενο', () => {
    expect(moveTokens('1.e4 e5 2.Nf3 Nc6 3.Bc4 (3.d4 exd4) 12...Rxh4! 0-0-0 ♘f3 ¤f6†')).toEqual({ squares: 10, clean: 10 });
    expect(moveTokens('Ei:d1 illb1 lt\'le4 33...uc1+ and the e4-e5 push')).toEqual({ squares: 5, clean: 1 });
  });

  it('έγκαιρη ένδειξη: σκαναρισμένο, χαλασμένο κείμενο, κανονικό', () => {
    expect(textWarning({ read: 10, ocr: 10, squares: 0, clean: 0 })).toBe('scanned');
    expect(textWarning({ read: 100, ocr: 1, squares: 184, clean: 78 })).toBe('garbled');
    expect(textWarning({ read: 100, ocr: 1, squares: 10043, clean: 9347 })).toBeNull();
    expect(textWarning({ read: 3, ocr: 3, squares: 20, clean: 2 })).toBeNull(); // πολύ νωρίς
    expect(textWarning(undefined)).toBeNull();
  });

  it('ετυμηγορία: ψηφιακά βιβλία καλή, σκαναρισμένα πειραματική', () => {
    expect(bookVerdict(stats({ moves: 27127, unplaced: 130, ocrPages: 1 }), 303).level).toBe('good');
    expect(bookVerdict(stats({ moves: 5721, unplaced: 42, ocrPages: 2 }), 470).level).toBe('good');
    expect(bookVerdict(stats({ moves: 51614, unplaced: 1330, ocrPages: 1 }), 875).level).toBe('good');
    const ex = bookVerdict(stats({ moves: 15, unplaced: 187, diagrams: 494, verified: 3, ocrPages: 2 }), 126);
    expect(ex.level).toBe('experimental');
    expect(ex.issues).toEqual(['moves', 'diagrams']);
    expect(bookVerdict(stats({ moves: 22, unplaced: 590, diagrams: 207, verified: 9, ocrPages: 141 }), 141).level).toBe('experimental');
    expect(bookVerdict(stats({ moves: 2376, unplaced: 880, diagrams: 314, verified: 29, ocrPages: 114 }), 116).level).toBe('experimental');
    const ko = bookVerdict(stats({ moves: 17030, unplaced: 13000, ocrPages: 7 }), 722, [], { read: 722, ocr: 7, squares: 1000, clean: 400 });
    expect(ko.level).toBe('partial');
    expect(ko.issues).toEqual(['moves', 'text']);
  });

  it('σελίδες με τα περισσότερα προβλήματα', () => {
    const w = [5, 9, 9, 3, 9, 5, 7].map((page) => ({ page, text: '' }));
    expect(worstPages(w, 3)).toEqual([
      { page: 9, count: 3 },
      { page: 5, count: 2 },
      { page: 3, count: 1 },
    ]);
    expect(bookVerdict(stats({ moves: 100, unplaced: 100 }), 10, w).worst[0]).toEqual({ page: 9, count: 3 });
  });
});
