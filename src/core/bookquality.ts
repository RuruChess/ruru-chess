// Πόσο καλά διαβάστηκε ένα βιβλίο στο «Βιβλίο σε βάση» (beta): έγκαιρη ένδειξη όσο διαβάζεται το PDF και
// ετυμηγορία μετά την ανάλυση. Τα ψηφιακά PDF (κανονικό κείμενο) διαβάζονται καλά· τα σκαναρισμένα ή με
// χαλασμένο κείμενο είναι πειραματικά και το αποτέλεσμα έχει κενά.
import type { BookStats, BookWarning } from './bookparse.ts';

/**
 * Η ποιότητα του κειμένου όσο διαβάζεται το βιβλίο, πριν από το OCR και την ανάλυση: σελίδες που διαβάστηκαν, πόσες
 * πάνε σε OCR (σκαναρισμένες ή με κείμενο-«σκουπίδια»), και στις υπόλοιπες οι λέξεις με τετράγωνο σκακιέρας και πόσες
 * από αυτές είναι καθαρές κινήσεις. Σκαναρισμένο βιβλίο με δικό του κακό OCR («Ei:d1», «illb1») ή σύμβολα κομματιών
 * χωρίς ToUnicode («lt'le4») περνά για κανονικό κείμενο, αλλά έχει λίγες καθαρές κινήσεις.
 */
export interface TextScan {
  read: number;
  ocr: number;
  squares: number;
  clean: number;
}

/** Μια κίνηση όπως γράφεται σε βιβλίο: αριθμός, κομμάτι (γράμμα ή σύμβολο), τετράγωνα, προαγωγή, σύμβολα αξιολόγησης. */
const CLEAN_MOVE_RE = /^[([]?(?:\d{1,3}\s?\.{1,3}|…)?(?:[KQRBN♔♕♖♗♘♚♛♜♝♞¢£¤¥¦]?[a-h]?[1-8]?[x:×-]?[a-h][1-8](?:=?[QRBN♕♖♗♘♛♜♝♞])?|[O0]-[O0](?:-[O0])?)(?:e\.p\.)?[+#†‡]?[!?]{0,2}[)\],;:.]*$/;

/** Λέξεις με τετράγωνο σκακιέρας στο κείμενο και πόσες από αυτές είναι καθαρές κινήσεις (για το `TextScan`). */
export function moveTokens(text: string): { squares: number; clean: number } {
  let squares = 0;
  let clean = 0;
  for (const w of text.split(/\s+/)) {
    if (!/[a-h][1-8]/.test(w)) continue;
    squares++;
    if (CLEAN_MOVE_RE.test(w)) clean++;
  }
  return { squares, clean };
}

/**
 * Έγκαιρη ένδειξη από την ανάγνωση: «scanned» όταν ≥30% των σελίδων πάνε σε OCR, «garbled» όταν κάτω από 60% των
 * λέξεων με τετράγωνο είναι καθαρές κινήσεις. Χρειάζεται λίγες σελίδες ή λέξεις πριν αποφασίσει, ώστε η αρχή του
 * βιβλίου να μην το παραπλανά.
 */
export function textWarning(s: TextScan | undefined): 'scanned' | 'garbled' | null {
  if (!s) return null;
  if (s.read >= 5 && s.ocr >= s.read * 0.3) return 'scanned';
  if (s.squares >= 50 && s.clean < s.squares * 0.6) return 'garbled';
  return null;
}

export type BookLevel = 'good' | 'partial' | 'experimental';
/** τι χάλασε την ανάγνωση: κινήσεις εκτός δέντρου, σελίδες με OCR, ανεπιβεβαίωτα διαγράμματα, χαλασμένο κείμενο */
export type BookIssue = 'moves' | 'ocr' | 'diagrams' | 'text';

export interface BookVerdict {
  level: BookLevel;
  /** κινήσεις που μπήκαν στο δέντρο, από όσες βρέθηκαν (0–1) */
  placed: number;
  /** σελίδες με OCR, από όλες (0–1) */
  ocr: number;
  /** διαγράμματα-εικόνες που επιβεβαίωσαν οι κινήσεις (0–1), όταν υπάρχουν */
  confirmed?: number;
  issues: BookIssue[];
  /** οι σελίδες με τις περισσότερες κινήσεις εκτός δέντρου */
  worst: Array<{ page: number; count: number }>;
}

/** Οι σελίδες με τις περισσότερες προειδοποιήσεις (κινήσεις που έμειναν ως κείμενο), οι πρώτες `n`. */
export function worstPages(warnings: BookWarning[], n = 5): Array<{ page: number; count: number }> {
  const by = new Map<number, number>();
  for (const w of warnings) by.set(w.page, (by.get(w.page) ?? 0) + 1);
  return [...by]
    .map(([page, count]) => ({ page, count }))
    .sort((a, b) => b.count - a.count || a.page - b.page)
    .slice(0, n);
}

/**
 * Ετυμηγορία μετά την ανάλυση. Καλή: ≥90% των κινήσεων στο δέντρο, <20% σελίδες με OCR, τα διαγράμματα-εικόνες
 * (όταν είναι ≥20) επιβεβαιωμένα τουλάχιστον κατά το μισό και κείμενο χωρίς χαλασμένες κινήσεις. Πειραματική: κάτω
 * από 50 κινήσεις, ή κάτω από τις μισές στο δέντρο, ή βιβλίο κυρίως με OCR χωρίς ≥90% στο δέντρο. Αλλιώς μερική.
 */
export function bookVerdict(stats: BookStats, pages: number, warnings: BookWarning[] = [], scan?: TextScan): BookVerdict {
  const found = stats.moves + stats.unplaced;
  const placed = found ? stats.moves / found : 0;
  const ocr = pages ? Math.min(1, (stats.ocrPages ?? 0) / pages) : 0;
  const diagrams = stats.diagrams ?? 0;
  const confirmed = diagrams ? (stats.verified ?? 0) / diagrams : undefined;
  const issues: BookIssue[] = [];
  if (placed < 0.9) issues.push('moves');
  if (ocr >= 0.2) issues.push('ocr');
  if (diagrams >= 20 && confirmed! < 0.5) issues.push('diagrams');
  if (textWarning(scan) === 'garbled') issues.push('text');
  const level: BookLevel = stats.moves < 50 || placed < 0.5 || (ocr >= 0.5 && placed < 0.9) ? 'experimental' : issues.length ? 'partial' : 'good';
  return { level, placed, ocr, ...(confirmed === undefined ? {} : { confirmed }), issues, worst: worstPages(warnings) };
}
