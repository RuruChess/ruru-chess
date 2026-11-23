/**
 * «Παίξε τη θέση»: θέσεις φινάλε που τις παίζεις ως το τέλος απέναντι στη μηχανή ή σε φίλο, με στόχο νίκη ή
 * ισοπαλία. Τα δεδομένα (`src/data/lessons/playouts.json`) είναι δική μας επιλογή: θέσεις από παρτίδες της
 * βάσης Lumbras (οι θέσεις και οι κινήσεις είναι γεγονότα) και κλασικές θεωρητικές θέσεις, ελεγμένες με τη
 * Stockfish 19 και, όπου έχουν ως 7 κομμάτια, με πίνακα φινάλε.
 */
import data from '../../data/lessons/playouts.json';
import { L } from '../i18n.ts';

export type PlayoutCat = 'pawns' | 'knight' | 'bishop' | 'bn' | 'rook' | 'exchange' | 'queen' | 'theory';

export interface Playout {
  id: string;
  cat: PlayoutCat;
  fen: string;
  goal: 'win' | 'draw';
  /** δυσκολία 1–3 (πόσο στενός είναι ο δρόμος προς τον στόχο) */
  level: number;
  /** τίτλος και ιδέα, μόνο στις θεωρητικές θέσεις */
  title?: { el: string; en: string };
  idea?: { el: string; en: string };
  source: { kind: 'theory' } | { kind: 'game'; white: string; black: string; event: string; year: number; result: string };
  /** αξιολόγηση στον έλεγχο, από τη σκοπιά της πλευράς που παίζει (εκατοστά· ματ = ±100000) */
  eval: number;
  /** η γραμμή της μηχανής από τη θέση (SAN) */
  pv: string[];
}

export const PLAYOUTS = (data as unknown as { items: Playout[] }).items;

export const CAT_ORDER: PlayoutCat[] = ['theory', 'pawns', 'knight', 'bishop', 'bn', 'rook', 'exchange', 'queen'];

/** Όλες οι θέσεις σε μία σειρά: από τις πιο εύκολες στις πιο δύσκολες, με τα είδη ανακατεμένα (μία από κάθε είδος με τη σειρά). */
export function mixedOrder(items: Playout[]): Playout[] {
  const out: Playout[] = [];
  for (const level of [1, 2, 3]) {
    const queues = CAT_ORDER.map((c) => items.filter((p) => p.level === level && p.cat === c));
    while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  }
  return out;
}

/** Η σειρά της ενιαίας λίστας. */
export const MIXED = mixedOrder(PLAYOUTS);

const CATS: Record<PlayoutCat, { name: [string, string]; tip: [string, string] }> = {
  theory: {
    name: ['Κλασική θεωρία', 'Classical theory'],
    tip: ['Θέσεις που πρέπει να ξέρει κάθε σκακιστής. Παίξ’ τες ξανά και ξανά μέχρι να βγαίνουν χωρίς σκέψη.', 'Positions every player should know. Play them again and again until they come without thinking.'],
  },
  pawns: {
    name: ['Βασιλιάδες και πιόνια', 'King and pawn endings'],
    tip: ['Μέτρα τα τέμπι. Η αντιπαράθεση, τα κρίσιμα τετράγωνα και ένα μακρινό ελεύθερο πιόνι αποφασίζουν.', 'Count the tempi. The opposition, the key squares and an outside passed pawn decide.'],
  },
  knight: {
    name: ['Ίπποι (και ίππος εναντίον πιονιών)', 'Knights (and knight versus pawns)'],
    tip: ['Ο ίππος δυσκολεύεται με τα πιόνια των άκρων και με ελεύθερα πιόνια σε δύο πτέρυγες. Μέτρα πόσα άλματα χρειάζεται.', 'A knight struggles against rook pawns and passed pawns on both wings. Count how many jumps it needs.'],
  },
  bishop: {
    name: ['Αξιωματικοί', 'Bishop endings'],
    tip: ['Με ανόμοιους αξιωματικούς ο αμυνόμενος συχνά στήνει φρούριο. Με όμοιους, βάλε τα πιόνια σου σε τετράγωνα άλλου χρώματος από τον αξιωματικό σου.', 'With opposite-coloured bishops the defender can often build a fortress. With same-coloured ones, put your pawns on the other colour from your bishop.'],
  },
  bn: {
    name: ['Αξιωματικός εναντίον ίππου', 'Bishop versus knight'],
    tip: ['Ο αξιωματικός θέλει ανοιχτή θέση και πιόνια και στις δύο πτέρυγες· ο ίππος θέλει σταθερά τετράγωνα και κλειστή θέση.', 'The bishop wants an open position and pawns on both wings; the knight wants fixed squares and a closed position.'],
  },
  rook: {
    name: ['Πύργοι (και πύργος εναντίον πιονιών)', 'Rook endings (and rook versus pawns)'],
    tip: ['Ο πύργος ανήκει πίσω από τα ελεύθερα πιόνια, και ένας ενεργός πύργος αξίζει συχνά ένα πιόνι. Απέναντι σε πιόνια, μέτρα αν προλαβαίνει ο βασιλιάς.', 'Rooks belong behind passed pawns, and an active rook is often worth a pawn. Against pawns, count whether your king arrives in time.'],
  },
  exchange: {
    name: ['Πύργος εναντίον ελαφρού κομματιού', 'Rook versus minor piece'],
    tip: ['Με την ποιότητα παραπάνω ψάξε ζουγκτσβάνγκ και χτύπα τα πιόνια· με την ποιότητα λιγότερη, κράτα τα πιόνια ενωμένα και το κομμάτι κοντά στον βασιλιά.', 'The exchange up, look for zugzwang and attack the pawns; the exchange down, keep the pawns together and the piece close to the king.'],
  },
  queen: {
    name: ['Βασίλισσες (και βασίλισσα εναντίον πιονιών)', 'Queen endings (and queen versus pawns)'],
    tip: ['Ο βασιλιάς πρέπει να κρυφτεί από τα σαχ, και το πιο προχωρημένο ελεύθερο πιόνι μετρά συχνά περισσότερο από το υλικό.', 'The king must hide from the checks, and the most advanced passed pawn often counts for more than material.'],
  },
};

export const catName = (c: PlayoutCat): string => L(CATS[c].name[0], CATS[c].name[1]);
export const catTip = (c: PlayoutCat): string => L(CATS[c].tip[0], CATS[c].tip[1]);

/** Η πλευρά που παίζει στη θέση (= η πλευρά του χρήστη). */
export const sideOf = (p: Playout): 'white' | 'black' => (p.fen.split(' ')[1] === 'b' ? 'black' : 'white');

/** «Κέρδισε με τα λευκά» / «Κράτα την ισοπαλία με τα μαύρα». */
export function goalLine(p: Playout): string {
  const white = sideOf(p) === 'white';
  if (p.goal === 'win') return white ? L('Κέρδισε με τα λευκά', 'Win with White') : L('Κέρδισε με τα μαύρα', 'Win with Black');
  return white ? L('Κράτα την ισοπαλία με τα λευκά', 'Hold the draw with White') : L('Κράτα την ισοπαλία με τα μαύρα', 'Hold the draw with Black');
}

/** Το υλικό με σύμβολα: «♖ + 3♙ – ♜ + 2♟». */
export function materialLine(fen: string): string {
  const w: Record<string, number> = {};
  const b: Record<string, number> = {};
  for (const ch of fen.split(' ')[0]) {
    if (!/[pnbrqPNBRQ]/.test(ch)) continue;
    const t = ch === ch.toUpperCase() ? w : b;
    t[ch.toLowerCase()] = (t[ch.toLowerCase()] ?? 0) + 1;
  }
  const side = (t: Record<string, number>, white: boolean) => {
    const sym: Record<string, string> = white ? { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' } : { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
    const pieces = ['q', 'r', 'b', 'n'].map((k) => sym[k].repeat(t[k] ?? 0)).join('');
    const pawns = t.p ? `${t.p}${sym.p}` : '';
    return [pieces, pawns].filter(Boolean).join(' + ') || (white ? '♔' : '♚');
  };
  return `${side(w, true)} – ${side(b, false)}`;
}

/** Από πού είναι η θέση: «Παρτίδα X – Y, τουρνουά 2019» ή «κλασική θεωρία». */
export function sourceLine(p: Playout): string {
  if (p.source.kind === 'theory') return L('Κλασική θεωρία', 'Classical theory');
  const s = p.source;
  const name = (n: string) => n.split(',')[0].trim();
  return `${name(s.white)} – ${name(s.black)}${s.event ? `, ${s.event}` : ''} ${s.year || ''}`.trim();
}

/** Τα αποτελέσματα του χρήστη σε μια θέση. */
export interface PlayoutRecord {
  /** προσπάθειες */
  t: number;
  /** επιτυχίες */
  ok: number;
}
