/**
 * Ασκήσεις χωρίς λύση στα δεδομένα (π.χ. θέσεις φινάλε του Lucas Chess): τις παίζεις απέναντι στη μηχανή.
 * Εδώ: αξιολόγηση από τη σκοπιά του λύτη, ο στόχος (νίκη ή ισοπαλία), η κρίση κάθε κίνησης, το τέλος της
 * παρτίδας, και τα θέματα του STS με το πλάνο τους (για το «Από την πηγή»).
 */
import { Position, parseSquare } from '../../core/chess.ts';
import { L } from '../i18n.ts';
import type { EngineLine, Puzzle } from './api.ts';
import { playUci } from './logic.ts';

/** Ματ σε εκατοστά πιονιού: πολύ μεγάλο, και λίγο μικρότερο όσο πιο μακριά είναι το ματ. */
export const MATE_CP = 100_000;

/** νίκη, ισοπαλία ή άμυνα (χειρότερη θέση: να μη χειροτερέψει) */
export type PracticeGoal = 'win' | 'draw' | 'defend';

/** Αξιολόγηση μιας γραμμής από τη σκοπιά του λύτη (η μηχανή μετρά από τη σκοπιά των λευκών). */
export function solverEval(line: Pick<EngineLine, 'cp' | 'mate'> | undefined, solverWhite: boolean): number | null {
  if (!line) return null;
  const sign = solverWhite ? 1 : -1;
  if (line.mate !== null && line.mate !== undefined) return sign * Math.sign(line.mate || 1) * (MATE_CP - Math.abs(line.mate) * 10);
  if (line.cp === null || line.cp === undefined) return null;
  return sign * line.cp;
}

/** «+2,3», «−0,4» ή «ματ σε 3» (από τη σκοπιά του λύτη). */
export function evalLabel(v: number | null): string {
  if (v === null) return '';
  if (Math.abs(v) >= MATE_CP - 1000) {
    const n = Math.max(1, Math.round((MATE_CP - Math.abs(v)) / 10));
    return v > 0 ? L(`ματ σε ${n}`, `mate in ${n}`) : L(`σε ματ σε ${n}`, `mated in ${n}`);
  }
  const x = (Math.abs(v) / 100).toLocaleString(L('el-GR', 'en-US'), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v > 0 ? `+${x}` : v < 0 ? `−${x}` : x;
}

/** Ο στόχος: από τα δεδομένα (αποτέλεσμα της παρτίδας), αλλιώς από την εκτίμηση της μηχανής στην αρχή. */
export function practiceGoal(p: Puzzle, start: number | null): PracticeGoal {
  const r = (p.goal as { result?: string } | null | undefined)?.result;
  if (r === 'win' || r === 'draw') return r;
  if (start !== null && start >= 150) return 'win';
  return start !== null && start <= -150 ? 'defend' : 'draw';
}

export const goalText = (g: PracticeGoal): string =>
  g === 'win' ? L('κέρδισε τη θέση', 'win the position') : g === 'draw' ? L('κράτα την ισοπαλία', 'hold the draw') : L('αμύνσου όσο καλύτερα γίνεται', 'defend as well as you can');

/**
 * Κρατά η κίνηση τον στόχο; Νίκη: δεν χάθηκε σχεδόν τίποτα, ή η θέση μένει συντριπτική (≥ +8), ή μένει
 * κερδισμένη χωρίς να χαθεί πάνω από 1 πιόνι ή το ένα τέταρτο του πλεονεκτήματος (π.χ. όχι +10 → +2).
 * Ισοπαλία: η θέση δεν γίνεται χαμένη (≥ −0,8) ή δεν χάθηκε σχεδόν τίποτα. Άμυνα: η θέση δεν χειροτερεύει
 * πολύ (ως 1 πιόνι), και αν υπάρχει ματ, δεν έρχεται πολύ πιο γρήγορα.
 */
export function keepsGoal(goal: PracticeGoal, before: number | null, after: number | null): boolean {
  if (after === null) return true;
  if (goal === 'win') {
    if (before !== null && before >= MATE_CP - 1000) return after >= 500;
    if (before === null) return after >= 150;
    if (after >= before - 40 || after >= 800) return true;
    return after >= 100 && after >= before - Math.max(100, before / 4);
  }
  if (goal === 'draw') return after >= -80 || (before !== null && after >= before - 40);
  if (before !== null && before <= -(MATE_CP - 1000)) return after >= before - 20;
  return after >= -80 || (before !== null && after >= before - 100);
}

/** Τέλος παρτίδας στη θέση: ματ, πατ, ανεπαρκές υλικό, 50 κινήσεις. */
export function gameStatus(fen: string): ReturnType<Position['status']> {
  try {
    return Position.fromFen(fen).status();
  } catch {
    return 'ongoing';
  }
}

const PIECES: Record<string, { el: string; en: string }> = {
  P: { el: 'Πιόνι', en: 'Pawn' },
  N: { el: 'Ίππος', en: 'Knight' },
  B: { el: 'Αξιωματικός', en: 'Bishop' },
  R: { el: 'Πύργος', en: 'Rook' },
  Q: { el: 'Βασίλισσα', en: 'Queen' },
  K: { el: 'Βασιλιάς', en: 'King' },
};

/** Υπόδειξη από την κίνηση της μηχανής (ίδια μορφή με την υπόδειξη του server). */
export function hintFromUci(fen: string, uci: string, level: 1 | 2 | 3): { level: 1 | 2 | 3; piece: { letter: string; el: string; en: string }; from: string; to?: string; uci?: string; san?: string } | null {
  const r = playUci(fen, uci);
  if (!r) return null;
  const from = uci.slice(0, 2);
  const letter = ' PNBRQK'[Position.fromFen(fen).pieceAt(parseSquare(uci, 0)) & 7] ?? 'P';
  const piece = { letter, ...(PIECES[letter] ?? PIECES.P) };
  return { level, piece, from, ...(level >= 2 ? { to: uci.slice(2, 4) } : {}), ...(level >= 3 ? { uci, san: r.san } : {}) };
}

/** Τα θέματα του Strategic Test Suite, με το πλάνο κάθε θέματος. */
const STS: Record<string, { el: string; en: string; planEl: string; planEn: string }> = {
  Undermine: { el: 'Υπονόμευση', en: 'Undermining', planEl: 'Χτύπα τη βάση της αλυσίδας πιονιών του αντιπάλου, ώστε να αδυνατίσει ή να καταρρεύσει.', planEn: 'Hit the base of the opponent’s pawn chain so that it weakens or collapses.' },
  'Open Files and Diagonals': { el: 'Ανοιχτές στήλες και διαγώνιοι', en: 'Open files and diagonals', planEl: 'Άνοιξε ή κατάλαβε μια στήλη ή διαγώνιο για τα βαριά κομμάτια ή τους αξιωματικούς σου.', planEn: 'Open or seize a file or diagonal for your heavy pieces or bishops.' },
  'Knight Outposts/Repositioning/Centralization': { el: 'Φυλάκια και μετακίνηση ίππων', en: 'Knight outposts and manoeuvres', planEl: 'Βρες στον ίππο ένα σταθερό τετράγωνο (φυλάκιο) στο κέντρο ή κοντά στον αντίπαλο, ή φέρε τον εκεί.', planEn: 'Find the knight a stable square (outpost) in the centre or near the enemy, or bring it there.' },
  'Knight Outposts/Centralization/Repositioning': { el: 'Φυλάκια και μετακίνηση ίππων', en: 'Knight outposts and manoeuvres', planEl: 'Βρες στον ίππο ένα σταθερό τετράγωνο (φυλάκιο) στο κέντρο ή κοντά στον αντίπαλο, ή φέρε τον εκεί.', planEn: 'Find the knight a stable square (outpost) in the centre or near the enemy, or bring it there.' },
  'Square Vacancy': { el: 'Άδειασμα τετραγώνου', en: 'Square vacancy', planEl: 'Άδειασε ένα τετράγωνο ώστε να το χρησιμοποιήσει καλύτερα ένα άλλο κομμάτι σου.', planEn: 'Vacate a square so that another of your pieces can use it better.' },
  'Bishop vs Knight': { el: 'Αξιωματικός ή ίππος', en: 'Bishop vs knight', planEl: 'Κρίνε πότε αλλάζεις αξιωματικό με ίππο (ή το αντίστροφο), ανάλογα με τη δομή των πιονιών.', planEn: 'Judge when to trade bishop for knight (or the reverse), according to the pawn structure.' },
  Recapturing: { el: 'Με ποιο ξαναπαίρνεις', en: 'Recapturing', planEl: 'Διάλεξε με ποιο κομμάτι ή πιόνι ξαναπαίρνεις, με κριτήριο τη δομή και τη δραστηριότητα.', planEn: 'Choose which piece or pawn recaptures, judging structure and activity.' },
  'Offer of Simplification': { el: 'Πρόταση απλοποίησης', en: 'Offer of simplification', planEl: 'Πρότεινε αλλαγές που σε συμφέρουν, π.χ. όταν οδηγούν σε καλύτερο φινάλε.', planEn: 'Offer exchanges that favour you, e.g. when they lead to a better endgame.' },
  AKPC: { el: 'Προώθηση πιονιών f, g, h', en: 'Advancing the f, g, h pawns', planEl: 'Προώθησε τα πιόνια της πτέρυγας του βασιλιά για επίθεση ή χώρο, χωρίς να εκθέσεις τον δικό σου βασιλιά.', planEn: 'Advance the kingside pawns for attack or space without exposing your own king.' },
  'Advancement of a/b/c pawns': { el: 'Προώθηση πιονιών a, b, c', en: 'Advancing the a, b, c pawns', planEl: 'Προώθησε τα πιόνια της πτέρυγας της βασίλισσας για χώρο, ελεύθερο πιόνι ή επίθεση μειονότητας.', planEn: 'Advance the queenside pawns for space, a passed pawn or a minority attack.' },
  Simplification: { el: 'Απλοποίηση', en: 'Simplification', planEl: 'Απλοποίησε με αλλαγές ώστε να μείνει μια θέση που κερδίζεται ή κρατιέται εύκολα.', planEn: 'Simplify with exchanges into a position that is easy to win or hold.' },
  'King Activity': { el: 'Δραστηριότητα του βασιλιά', en: 'King activity', planEl: 'Φέρε τον βασιλιά στο παιχνίδι: όταν φύγουν οι βασίλισσες είναι δυνατό κομμάτι.', planEn: 'Bring the king into play: with the queens gone it is a strong piece.' },
  'Center Control': { el: 'Έλεγχος του κέντρου', en: 'Centre control', planEl: 'Πάρε ή κράτα τον έλεγχο των κεντρικών τετραγώνων.', planEn: 'Take or keep control of the central squares.' },
  'Pawn Play in the Center': { el: 'Πιόνια στο κέντρο', en: 'Pawn play in the centre', planEl: 'Χρησιμοποίησε τα κεντρικά πιόνια: προώθηση, ρήξη ή σταθεροποίηση του κέντρου.', planEn: 'Use the central pawns: advance, break or fix the centre.' },
  '7th Rank': { el: '7η γραμμή', en: 'The 7th rank', planEl: 'Φέρε πύργους ή βασίλισσα στην 7η γραμμή, όπου χτυπούν πιόνια και περιορίζουν τον βασιλιά.', planEn: 'Bring rooks or the queen to the 7th rank, where they hit pawns and confine the king.' },
  AT: { el: 'Χωρίς άσκοπες αλλαγές', en: 'Avoiding pointless exchanges', planEl: 'Μην αλλάζεις κομμάτια χωρίς λόγο: κράτα όσα δουλεύουν καλά.', planEn: 'Do not exchange pieces without reason: keep the ones that work well.' },
};

export function stsTheme(category: unknown): { name: string; plan: string } | null {
  if (typeof category !== 'string') return null;
  const t = STS[category];
  if (!t) return { name: category, plan: '' };
  return { name: L(t.el, t.en), plan: L(t.planEl, t.planEn) };
}

/** UCI → SAN από μια θέση (για τους βαθμούς ανά κίνηση του STS). */
export function sanOf(fen: string, uci: string): string {
  return playUci(fen, uci)?.san ?? uci;
}
