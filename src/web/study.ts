/**
 * «Συνέχεια μελέτης»: η τελευταία παρτίδα βάσης που μελέτησε ο χρήστης και η κίνηση όπου έμεινε (στις ρυθμίσεις ui,
 * `lastStudy`). Τη γράφει η καρτέλα της παρτίδας και τη δείχνουν οι Βάσεις με κουμπί «Συνέχεια».
 */
import { useApp } from './store.ts';
import { setUiLater } from './tactics/store.ts';

export interface StudyRecord {
  dbId: string;
  gameId: number;
  /** «Λευκά – Μαύρα» (ή το γεγονός) */
  title: string;
  event: string;
  /** η ημικίνηση της κύριας γραμμής */
  ply: number;
  /** πότε (ms) */
  at?: number;
}

const same = (a: StudyRecord | null | undefined, b: StudyRecord) => Boolean(a && a.dbId === b.dbId && a.gameId === b.gameId && a.ply === b.ply && a.title === b.title);

export function rememberStudy(r: StudyRecord): void {
  const cur = (useApp.getState().settings?.ui as Record<string, unknown> | undefined)?.lastStudy as StudyRecord | null | undefined;
  // ίδια παρτίδα και κίνηση μέσα σε ένα λεπτό: τίποτα (να μη γράφονται οι ρυθμίσεις χωρίς λόγο)
  if (same(cur, r) && Date.now() - (cur?.at ?? 0) < 60_000) return;
  setUiLater({ lastStudy: { ...r, at: Date.now() } });
}

export function forgetStudy(): void {
  setUiLater({ lastStudy: null });
}

export function useLastStudy(): StudyRecord | null {
  return useApp((s) => ((s.settings?.ui as Record<string, unknown> | undefined)?.lastStudy as StudyRecord | null | undefined) ?? null);
}
