/**
 * «Παίζει με κίνητρο»: πώς διαλέγει κίνηση η μηχανή στο «Παίξε τη θέση». Σε πολλές θέσεις φινάλε η μηχανή βλέπει την
 * ίδια αξιολόγηση (π.χ. 0,00) για δεκάδες κινήσεις και παίζει όποια βρει πρώτη, ακόμη και να δώσει τον πύργο για τον
 * ίππο. Εδώ, ανάμεσα στις κινήσεις που δεν χαλάνε τη θέση (λίγα εκατοστά από την καλύτερη), διαλέγει αυτή που κάνει
 * πιο δύσκολη τη ζωή του αντιπάλου: για κάθε υποψήφια κοιτάζει τις απαντήσεις του αντιπάλου και υπολογίζει τι
 * περιμένει απέναντι σε άνθρωπο που καμιά φορά διαλέγει λάθος (όσο περισσότερες και πιο κοντινές οι κακές απαντήσεις,
 * τόσο καλύτερα). Όσο δεν είναι χειρότερα, δεν πάει σε νεκρή ισοπαλία, δεν ξαναφέρνει θέσεις και κρατά υλικό· όταν
 * είναι χειρότερα, η απλούστευση που τη σώζει μένει (τη δείχνει ήδη η αξιολόγηση).
 */
import { Position } from './chess.ts';

/** Αξιολόγηση γραμμής (από τη σκοπιά των λευκών) από τη σκοπιά μιας πλευράς, σε εκατοστά (ματ: ±10000 μείον την απόσταση). */
export function povScore(l: { cp: number | null; mate: number | null }, white: boolean): number {
  const sign = white ? 1 : -1;
  if (l.mate !== null && l.mate !== undefined && l.mate !== 0) return sign * (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate);
  return sign * (l.cp ?? 0);
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Το υλικό κάθε πλευράς (πιόνι 1, ελαφρύ κομμάτι 3, πύργος 5, βασίλισσα 9). */
export function materialOf(fen: string): { white: number; black: number; total: number } {
  let white = 0;
  let black = 0;
  for (const ch of fen.split(' ')[0]) {
    const v = VALUE[ch.toLowerCase()];
    if (!v) continue;
    if (ch === ch.toUpperCase()) white += v;
    else black += v;
  }
  return { white, black, total: white + black };
}

/** Το κλειδί μιας θέσης για τις επαναλήψεις: διάταξη, σειρά, ροκέ, αν πασάν (χωρίς τους μετρητές). */
export const repetitionKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

/** Νεκρή ισοπαλία: κανείς δεν μπορεί να κάνει ματ (ανεπαρκές υλικό) ή πατ. */
export function isDead(p: Position): boolean {
  return p.insufficientMaterial() || (!p.hasLegalMove() && !p.inCheck());
}

/** Η γραμμή (UCI) φτάνει σε νεκρή ισοπαλία μέσα στις πρώτες `plies` ημικινήσεις; (π.χ. «πύργος για ίππο και ο βασιλιάς ξαναπαίρνει») */
export function deadLine(fen: string, uci: string[], plies = 2): boolean {
  try {
    const p = Position.fromFen(fen);
    for (const u of uci.slice(0, plies)) {
      const m = p.parseUci(u);
      if (!m) return false;
      p.makeMove(m);
      if (isDead(p)) return true;
    }
  } catch {
    // άκυρη θέση ή γραμμή: όχι νεκρή
  }
  return false;
}

/** Μία υποψήφια κίνηση της μηχανής, με ό,τι χρειάζεται η επιλογή. */
export interface PressureCand {
  uci: string;
  /** αξιολόγηση μετά την κίνηση, από τη σκοπιά της μηχανής (εκατοστά· ματ ±10000 μείον την απόσταση) */
  score: number;
  /** οι αξιολογήσεις μετά από τις απαντήσεις του αντιπάλου που εξετάστηκαν (σκοπιά της μηχανής, καλύτερη για τον αντίπαλο πρώτη) */
  replies: number[];
  /** όλες οι νόμιμες απαντήσεις του αντιπάλου· όσες δεν εξετάστηκαν είναι γι’ αυτόν χειρότερες από την τελευταία που εξετάστηκε */
  legal: number;
  /** η γραμμή (η κίνηση και η καλύτερη απάντηση) καταλήγει σε νεκρή ισοπαλία */
  dead: boolean;
  /** πόσες φορές έχει ήδη εμφανιστεί η θέση μετά την κίνηση */
  seen: number;
  /** υλικό στη σκακιέρα μετά την κίνηση και την καλύτερη απάντηση */
  material: number;
}

export const PRESSURE = {
  /** εκατοστά: πόσο χειρότερη από την καλύτερη μπορεί να είναι μια υποψήφια (θόρυβος της σύντομης αναζήτησης) */
  band: 35,
  /** πόσο συχνά διαλέγει ο άνθρωπος-αντίπαλος μια χειρότερη απάντηση (εκατοστά: μεγαλύτερο = πιο συχνά) */
  noise: 90,
  /** κλίμακα της αναμενόμενης βαθμολογίας (εκατοστά) */
  scale: 150,
};

/** Η αναμενόμενη βαθμολογία (0..1) της μηχανής για μια αξιολόγηση από τη σκοπιά της. */
export function expectedScore(score: number, scale = PRESSURE.scale): number {
  return 1 / (1 + Math.exp(-Math.max(-3000, Math.min(3000, score)) / scale));
}

/**
 * Πόσο δύσκολη είναι η θέση για τον αντίπαλο μετά την κίνηση: η αναμενόμενη βαθμολογία της μηχανής όταν ο αντίπαλος
 * διαλέγει απάντηση σαν άνθρωπος. Η καλύτερη απάντηση έχει βάρος 1 και κάθε χειρότερη exp(−διαφορά/noise), άρα
 * μετρά και πόσες είναι οι κακές απαντήσεις και πόσο «κοντά» φαίνονται.
 */
export function practicalValue(c: Pick<PressureCand, 'score' | 'replies' | 'legal'>, o = PRESSURE): number {
  const rs = c.replies.length ? c.replies : [c.score];
  const best = Math.min(...rs);
  const last = Math.max(...rs);
  let w = 0;
  let e = 0;
  for (const s of rs) {
    const k = Math.exp(-(s - best) / o.noise);
    w += k;
    e += k * expectedScore(s, o.scale);
  }
  // οι απαντήσεις που δεν εξετάστηκαν: τουλάχιστον τόσο κακές όσο η τελευταία που εξετάστηκε
  const rest = Math.max(0, c.legal - rs.length);
  if (rest > 0) {
    const k = rest * Math.exp(-(last - best) / o.noise);
    w += k;
    e += k * expectedScore(last, o.scale);
  }
  return w > 0 ? e / w : expectedScore(c.score, o.scale);
}

export interface PressureChoice {
  uci: string;
  /** οι υποψήφιες που εξετάστηκαν, με την «πρακτική» αξία τους (η επιλογή πρώτη) */
  ranked: Array<{ uci: string; score: number; value: number }>;
}

/**
 * Η κίνηση με κίνητρο από τις υποψήφιες: ματ → το συντομότερο· αλλιώς, από όσες απέχουν ως `band` από την
 * καλύτερη, αυτή με τη μεγαλύτερη πρακτική αξία. Όταν η μηχανή δεν είναι χειρότερα (≥ −0,3) και δεν κερδίζει
 * ήδη καθαρά (< +2,5), χάνουν πόντους η νεκρή ισοπαλία, η επανάληψη και κάθε πιόνι υλικού που φεύγει από τη σκακιέρα,
 * και κερδίζουν λίγους οι κινήσεις που αφήνουν στον αντίπαλο λιγότερες απαντήσεις.
 */
export function pressurePick(cands: PressureCand[], o = PRESSURE): PressureChoice | null {
  const list = cands.filter((c) => c.uci);
  if (!list.length) return null;
  const best = Math.max(...list.map((c) => c.score));
  if (best >= 9000) {
    const c = list.find((x) => x.score === best)!;
    return { uci: c.uci, ranked: [{ uci: c.uci, score: c.score, value: 1 }] };
  }
  const band = best <= -9000 ? 2 : o.band;
  const pool = list.filter((c) => best - c.score <= band);
  // παίζει για νίκη: δεν είναι χειρότερα, και δεν έχει ήδη καθαρή νίκη (τότε απλώς τη μετατρέπει)
  const plays = best >= -30 && best < 250;
  const maxMat = Math.max(...pool.map((c) => c.material));
  const maxLegal = Math.max(1, ...pool.map((c) => c.legal));
  const ranked = pool
    .map((c) => {
      let v = practicalValue(c, o);
      if (plays) {
        if (c.dead) v -= 0.5;
        v -= c.seen >= 2 ? 0.5 : 0.04 * c.seen;
        v -= 0.004 * (maxMat - c.material);
        // στρίμωγμα: όσο λιγότερες κινήσεις αφήνει στον αντίπαλο, τόσο πιο εύκολα σκοντάφτει (μετρά όταν όλα δείχνουν ίδια)
        v += 0.02 * (1 - c.legal / maxLegal);
      }
      return { uci: c.uci, score: c.score, value: v };
    })
    .sort((a, b) => b.value - a.value || b.score - a.score);
  return { uci: ranked[0].uci, ranked };
}

/**
 * Δέχεται ισοπαλία η μηχανή με κίνητρο; Όχι όσο έχει κάτι να παίξει. Ναι όταν η θέση είναι νεκρή, όταν είναι
 * χειρότερα, ή όταν μετά από 20 κινήσεις (40 ημικινήσεις) δεν έχει ούτε υλικό ούτε αξιολόγηση υπέρ της.
 */
export function pressureAcceptsDraw(botScore: number | null, plies: number, fen: string, botWhite: boolean): boolean {
  try {
    if (isDead(Position.fromFen(fen))) return true;
  } catch {
    return false;
  }
  if (botScore === null) return false;
  if (botScore < -30) return true;
  const m = materialOf(fen);
  const edge = botWhite ? m.white - m.black : m.black - m.white;
  return plies >= 40 && edge <= 0 && botScore <= 30;
}
