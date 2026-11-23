/**
 * Bots με προσωπικότητα και επίπεδο Elo: ορισμοί, επιλογή κίνησης ανά στυλ, βιβλίο από τη βάση αναφοράς,
 * αποδοχή ισοπαλίας και αποτέλεσμα. Από το RealChessBase (Λάζαρος Μπατσής, GPL-3.0)· στο Ruru
 * προστέθηκαν ενδιάμεσα επίπεδα, όριο κόμβων και «χοντρά λάθη» για τα αδύναμα bots.
 */
import { deadLine } from '../../core/pressure.ts';

export type BotStyle = 'beginner' | 'balanced' | 'aggressive' | 'solid';

export interface BotSpec {
  id: string;
  /** μηχανή UCI (Stockfish κ.λπ.), Leela (Lc0 με δίκτυο που παίζει για νίκη) ή Maia (Lc0, ένας κόμβος ανά κίνηση) */
  kind?: 'engine' | 'leela' | 'maia';
  /** για τη Maia: το Elo των βαρών */
  maiaElo?: number;
  /** όνομα [ελληνικά, αγγλικά] */
  name: [string, string];
  /** μία φράση για τον χαρακτήρα του */
  blurb: [string, string];
  /** περίπου πόσο δυνατός είναι (για εμφάνιση) */
  elo: number;
  style: BotStyle;
  /** δύναμη της μηχανής: UCI_Elo (από 1320 στη Stockfish) ή Skill Level 0–20· τίποτα = πλήρης δύναμη */
  strength: { elo?: number; skill?: number };
  /** χρόνος σκέψης ανά κίνηση χωρίς ρολόι (ms) */
  movetime: number;
  /** όριο κόμβων της αναζήτησης (τα αδύναμα bots βλέπουν λίγο μπροστά)· 0 = με χρόνο */
  nodes: number;
  /** πόσες γραμμές ζητά από τη μηχανή για να διαλέξει με το στυλ του */
  multipv: number;
  /** πόσο χειρότερη (σε εκατοστά πιονιού) μπορεί να είναι η κίνηση που διαλέγει από την καλύτερη */
  window: number;
  /** πιθανότητα για μια εντελώς τυχαία κίνηση (χοντρό λάθος αρχαρίου) */
  blunder: number;
  /** ημικινήσεις «από βιβλίο» (κινήσεις από το δέντρο της βάσης αναφοράς)· 0 = χωρίς */
  book: number;
  /** τι λέει στην αρχή και στο τέλος [ελληνικά, αγγλικά] */
  says: { hi: [string, string]; won: [string, string]; lost: [string, string]; draw: [string, string] };
}

/** Η σκάλα των αντιπάλων, από τον αρχάριο ως την πλήρη μηχανή (Stockfish ή όποια μηχανή είναι προεπιλογή). */
export const ENGINE_BOTS: BotSpec[] = [
  {
    id: 'beginner',
    name: ['Mark ο αρχάριος', 'Mark the beginner'],
    blurb: ['Μόλις έμαθε τις κινήσεις. Αφήνει κομμάτια και χάνει ευκαιρίες.', 'Has just learned the moves. Hangs pieces and misses chances.'],
    elo: 800,
    style: 'beginner',
    strength: { skill: 0 },
    movetime: 80,
    nodes: 600,
    multipv: 5,
    window: 450,
    blunder: 0.14,
    book: 0,
    says: {
      hi: ['Γεια! Ελπίζω να μη με κερδίσεις πολύ γρήγορα…', 'Hi! I hope you won’t beat me too quickly…'],
      won: ['Κέρδισα; Δεν το πιστεύω!', 'I won? I can’t believe it!'],
      lost: ['Μπράβο! Θα ξαναπροσπαθήσω.', 'Well done! I’ll try again.'],
      draw: ['Ισοπαλία! Δεν είναι κι άσχημα.', 'A draw! Not bad at all.'],
    },
  },
  {
    id: 'kid',
    name: ['Lily η μικρή', 'Lily the youngster'],
    blurb: ['Παίζει στο σχολικό πρωτάθλημα. Βλέπει απειλές ενός βήματος, όχι δύο.', 'Plays in the school championship. Sees one-move threats, not two.'],
    elo: 1000,
    style: 'beginner',
    strength: { skill: 1 },
    movetime: 120,
    nodes: 2500,
    multipv: 4,
    window: 230,
    blunder: 0.06,
    book: 2,
    says: {
      hi: ['Γεια σου! Η δασκάλα μου λέει να βγάζω πρώτα τα κομμάτια.', 'Hello! My teacher says to develop my pieces first.'],
      won: ['Ναι! Θα το πω στην τάξη μου!', 'Yes! I’m telling my whole class!'],
      lost: ['Ωχ… Μου δείχνεις μετά τι έκανα λάθος;', 'Oh… Will you show me what I did wrong?'],
      draw: ['Ισοπαλία! Καλή παρτίδα.', 'A draw! Good game.'],
    },
  },
  {
    id: 'cafe',
    name: ['Jack του καφενείου', 'Jack from the café'],
    blurb: ['Παίζει γρήγορα και του αρέσουν οι αλλαγές και τα σαχ. Συχνά ξεχνά ένα κομμάτι.', 'Plays fast and loves trades and checks. Often forgets a piece.'],
    elo: 1200,
    style: 'aggressive',
    strength: { skill: 3 },
    movetime: 200,
    nodes: 7000,
    multipv: 4,
    window: 130,
    blunder: 0.03,
    book: 4,
    says: {
      hi: ['Έλα, μια γρήγορη πριν κρυώσει ο καφές!', 'Come on, a quick one before the coffee gets cold!'],
      won: ['Χα! Άλλη μία για τη συλλογή μου.', 'Ha! Another one for my collection.'],
      lost: ['Καλά, καλά… Ρεβάνς;', 'Alright, alright… Rematch?'],
      draw: ['Ισοπαλία. Κερνάω εγώ τον επόμενο.', 'A draw. Next coffee’s on me.'],
    },
  },
  {
    id: 'student',
    name: ['Leo ο μαθητής', 'Leo the student'],
    blurb: ['Ξέρει τα βασικά ανοίγματα· στο μέσο της παρτίδας κάνει λάθη.', 'Knows the main openings; makes mistakes in the middlegame.'],
    elo: 1350,
    style: 'balanced',
    strength: { elo: 1350 },
    movetime: 300,
    nodes: 18_000,
    multipv: 3,
    window: 80,
    blunder: 0.015,
    book: 8,
    says: {
      hi: ['Γεια! Διάβασα χθες για το ισπανικό άνοιγμα.', 'Hi! I read about the Spanish opening yesterday.'],
      won: ['Τελικά το διάβασμα βοηθά!', 'So studying does pay off!'],
      lost: ['Πρέπει να δω ξανά το μέσο της παρτίδας.', 'I need to work on my middlegame.'],
      draw: ['Δίκαιο αποτέλεσμα.', 'A fair result.'],
    },
  },
  {
    id: 'club',
    name: ['Emma του ομίλου', 'Emma from the club'],
    blurb: ['Τακτική παίκτρια ομίλου. Ξέρει το ρεπερτόριό της· στο φινάλε δυσκολεύεται.', 'A regular club player. Knows her repertoire; struggles in endgames.'],
    elo: 1550,
    style: 'balanced',
    strength: { elo: 1550 },
    movetime: 400,
    nodes: 45_000,
    multipv: 3,
    window: 55,
    blunder: 0.008,
    book: 10,
    says: {
      hi: ['Καλή παρτίδα! Παίζουμε σοβαρά όμως.', 'Have a good game! We play seriously, though.'],
      won: ['Ωραία μάχη. Ευχαριστώ για την παρτίδα!', 'A nice fight. Thanks for the game!'],
      lost: ['Έπαιξες καλά. Μπράβο σου.', 'You played well. Well done.'],
      draw: ['Ισοπαλία· σφιχτή παρτίδα.', 'A draw; a tight game.'],
    },
  },
  {
    id: 'attacker',
    name: ['Max ο επιθετικός', 'Max the attacker'],
    blurb: ['Ψάχνει σαχ και αιχμαλωσίες· ρισκάρει για να επιτεθεί στον βασιλιά.', 'Looks for checks and captures; takes risks to attack the king.'],
    elo: 1700,
    style: 'aggressive',
    strength: { elo: 1700 },
    movetime: 500,
    nodes: 90_000,
    multipv: 4,
    window: 70,
    blunder: 0,
    book: 10,
    says: {
      hi: ['Ο βασιλιάς σου ας προσέχει!', 'Your king had better watch out!'],
      won: ['Επίθεση! Αυτό είναι σκάκι!', 'Attack! That’s what chess is about!'],
      lost: ['Η επίθεση δεν πέρασε αυτή τη φορά…', 'The attack didn’t get through this time…'],
      draw: ['Ισοπαλία; Ήθελα ματ!', 'A draw? I wanted mate!'],
    },
  },
  {
    id: 'solid',
    name: ['Sophie η σταθερή', 'Sophie the solid'],
    blurb: ['Παίζει ασφαλή θεωρία, ανταλλάσσει όταν προηγείται και σπάνια ρισκάρει.', 'Plays safe theory, trades when ahead and rarely takes risks.'],
    elo: 2000,
    style: 'solid',
    strength: { elo: 2000 },
    movetime: 700,
    nodes: 0,
    multipv: 3,
    window: 35,
    blunder: 0,
    book: 12,
    says: {
      hi: ['Ας δούμε ποιος θα κάνει το πρώτο λάθος.', 'Let’s see who makes the first mistake.'],
      won: ['Υπομονή και καθαρό παιχνίδι.', 'Patience and clean play.'],
      lost: ['Δεν σου άφησα πολλά· μπράβο που τα βρήκες.', 'I didn’t give you much; well done for finding it.'],
      draw: ['Ισοπαλία, όπως συνήθως με σωστό παιχνίδι.', 'A draw, as usual with correct play.'],
    },
  },
  {
    id: 'expert',
    name: ['Daniel ο υποψήφιος μάστερ', 'Daniel the candidate master'],
    blurb: ['Ακριβής και υπομονετικός. Περιμένει το πρώτο σου λάθος και δεν το συγχωρεί.', 'Precise and patient. Waits for your first mistake and does not forgive it.'],
    elo: 2250,
    style: 'balanced',
    strength: { elo: 2250 },
    movetime: 900,
    nodes: 0,
    multipv: 2,
    window: 25,
    blunder: 0,
    book: 14,
    says: {
      hi: ['Καλή επιτυχία. Θα τη χρειαστείς.', 'Good luck. You’ll need it.'],
      won: ['Ένα λάθος ήταν αρκετό.', 'One mistake was enough.'],
      lost: ['Εντυπωσιακό. Σε υποτίμησα.', 'Impressive. I underestimated you.'],
      draw: ['Σωστή παρτίδα και από τους δύο.', 'Correct play from both of us.'],
    },
  },
  {
    id: 'master',
    name: ['Elena η μάστερ', 'Elena the master'],
    blurb: ['Δυνατή και ακριβής· τιμωρεί τα λάθη και ξέρει πολλή θεωρία.', 'Strong and precise; punishes mistakes and knows a lot of theory.'],
    elo: 2500,
    style: 'balanced',
    strength: { elo: 2500 },
    movetime: 1200,
    nodes: 0,
    multipv: 2,
    window: 15,
    blunder: 0,
    book: 16,
    says: {
      hi: ['Σε ακούω. Η πρώτη κίνηση είναι δική σου.', 'I’m listening. The first move is yours.'],
      won: ['Καλή προσπάθεια. Δες ξανά την παρτίδα με τη μηχανή.', 'A good try. Go through the game with the engine.'],
      lost: ['Συγχαρητήρια! Αυτή η νίκη αξίζει πολλά.', 'Congratulations! That win is worth a lot.'],
      draw: ['Ισοπαλία με μάστερ: ωραίο αποτέλεσμα.', 'A draw against a master: a fine result.'],
    },
  },
  {
    id: 'full',
    name: ['Η μηχανή στο φουλ', 'Full-strength engine'],
    blurb: ['Χωρίς όριο δύναμης: για εξάσκηση σε θέσεις που πρέπει να κρατήσεις.', 'No strength limit: for practising positions you must hold.'],
    elo: 3500,
    style: 'balanced',
    strength: {},
    movetime: 1500,
    nodes: 0,
    multipv: 1,
    window: 0,
    blunder: 0,
    book: 0,
    says: {
      hi: ['Έτοιμη.', 'Ready.'],
      won: ['1-0. Ή 0-1. Πάντως όχι υπέρ σου.', 'Game over. Not in your favour.'],
      lost: ['Αδύνατον… Έλεγξε μήπως έπαιζε άλλη μηχανή!', 'Impossible… Check whether another engine was playing!'],
      draw: ['Ισοπαλία. Πολύ καλή άμυνα.', 'A draw. Very good defence.'],
    },
  },
];

/** Η Leela (Lc0 με το δίκτυο της): νευρωνικό δίκτυο που δεν συμβιβάζεται με την ισοπαλία. */
export const LEELA_BOT: BotSpec = {
  id: 'leela',
  kind: 'leela',
  name: ['Leela', 'Leela'],
  blurb: ['Νευρωνικό δίκτυο (Lc0): παίζει με σχέδιο και ψάχνει νίκη ακόμη και σε ισόπαλες θέσεις.', 'A neural network (Lc0): plays with a plan and looks for a win even in drawn positions.'],
  elo: 2600,
  style: 'balanced',
  strength: {},
  movetime: 2500,
  nodes: 0,
  multipv: 1,
  window: 0,
  blunder: 0,
  book: 0,
  says: {
    hi: ['Ας δούμε τι έχει η θέση.', 'Let’s see what the position holds.'],
    won: ['Η πίεση απέδωσε.', 'The pressure paid off.'],
    lost: ['Καλή άμυνα και καλή επίθεση. Μπράβο.', 'Good defence and good attack. Well done.'],
    draw: ['Δεν βρήκα δρόμο. Καλά κράτησες.', 'I found no way through. Well held.'],
  },
};

/** Bot Maia για ένα επίπεδο (παίζει σαν άνθρωπος με αυτό το Elo: ίδιες ιδέες, ίδια λάθη). Από το RealChessBase. */
export function maiaBot(elo: number): BotSpec {
  return {
    id: `maia-${elo}`,
    kind: 'maia',
    maiaElo: elo,
    name: [`Maia ${elo}`, `Maia ${elo}`],
    blurb: [`Παίζει σαν άνθρωπος με ${elo}: τις ίδιες ιδέες και τα ίδια λάθη.`, `Plays like a ${elo}-rated human: the same ideas and the same mistakes.`],
    elo,
    style: 'balanced',
    strength: {},
    movetime: 0,
    nodes: 0,
    multipv: 1,
    window: 0,
    blunder: 0,
    book: 0,
    says: {
      hi: ['Καλή παρτίδα!', 'Have a good game!'],
      won: ['Ωραία παρτίδα, ευχαριστώ!', 'Nice game, thanks!'],
      lost: ['Μπράβο, έπαιξες καλύτερα.', 'Well played, you were better.'],
      draw: ['Ισοπαλία, καλή παρτίδα.', 'A draw, good game.'],
    },
  };
}

/** Γεννήτρια τυχαίων αριθμών 0..1 (στις δοκιμές: σταθερή). */
export type Rng = () => number;

export interface BotLine {
  /** αξιολόγηση από την πλευρά των λευκών */
  cp: number | null;
  mate: number | null;
  uci: string[];
  san: string[];
}

/** Αξιολόγηση γραμμής από την πλευρά που παίζει, σε εκατοστά (ματ: ±10000). */
export function lineScore(l: { cp: number | null; mate: number | null }, whiteToMove: boolean): number {
  const sign = whiteToMove ? 1 : -1;
  if (l.mate !== null && l.mate !== undefined && l.mate !== 0) return sign * (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate);
  return sign * (l.cp ?? 0);
}

/** Μπόνους του στυλ για την πρώτη κίνηση μιας γραμμής (σε εκατοστά). */
function styleBonus(style: BotStyle, san: string, uci: string, ahead: boolean, whiteToMove: boolean): number {
  const check = /[+#]/.test(san);
  const capture = san.includes('x');
  const toRank = Number(uci[3]);
  const forward = whiteToMove ? toRank >= 5 : toRank <= 4;
  switch (style) {
    case 'aggressive':
      return (check ? 35 : 0) + (capture ? 20 : 0) + (forward ? 10 : 0);
    case 'solid':
      // ανταλλαγές όταν προηγείται, ροκέ, όχι κυνήγι με σαχ
      return (capture && ahead ? 25 : 0) + (san.startsWith('O-O') ? 20 : 0) - (check && !ahead ? 10 : 0);
    default:
      return 0;
  }
}

/**
 * Η κίνηση του bot από τις γραμμές της μηχανής: μόνο κινήσεις ως `window` εκατοστά χειρότερες από την
 * καλύτερη· ο «αρχάριος» διαλέγει σχεδόν τυχαία, ο «ισορροπημένος» με βάρη που προτιμούν τις καλύτερες,
 * ο «επιθετικός» και ο «σταθερός» με μπόνους στυλ. Χωρίς γραμμές: null (θα παίξει το bestmove).
 */
export function chooseBotMove(lines: BotLine[], spec: Pick<BotSpec, 'style' | 'window'>, whiteToMove: boolean, rng: Rng = Math.random): string | null {
  const cands = lines.filter((l) => l.uci.length > 0);
  if (!cands.length) return null;
  const scored = cands.map((l) => ({ l, s: lineScore(l, whiteToMove) }));
  const best = Math.max(...scored.map((x) => x.s));
  // ματ για εμάς: πάντα η καλύτερη (κανένα bot δεν αφήνει ματ που βλέπει)
  if (best >= 9000) return scored.find((x) => x.s === best)!.l.uci[0];
  const pool = scored.filter((x) => best - x.s <= spec.window && x.s > -9000);
  const list = pool.length ? pool : [scored.find((x) => x.s === best)!];
  if (list.length === 1) return list[0].l.uci[0];
  const ahead = best > 150;
  if (spec.style === 'aggressive' || spec.style === 'solid') {
    let pick = list[0];
    let top = -Infinity;
    for (const x of list) {
      const v = x.s + styleBonus(spec.style, x.l.san[0] ?? '', x.l.uci[0], ahead, whiteToMove) + rng() * 8;
      if (v > top) {
        top = v;
        pick = x;
      }
    }
    return pick.l.uci[0];
  }
  // βάρη: ο αρχάριος σχεδόν ίσα, ο ισορροπημένος εκθετικά υπέρ των καλύτερων
  const k = spec.style === 'beginner' ? 400 : Math.max(10, spec.window / 2);
  const weights = list.map((x) => Math.exp(-(best - x.s) / k));
  return list[weighted(weights, rng)].l.uci[0];
}

/**
 * Χωρίς άσκοπη απλούστευση: όσο το bot δεν είναι χειρότερα, βγαίνουν οι γραμμές που καταλήγουν αμέσως σε νεκρή
 * ισοπαλία (π.χ. πύργος για ίππο σε 0,00), αρκεί να μένει άλλη γραμμή ως 0,6 πιο κάτω. Αλλιώς οι γραμμές μένουν ως έχουν.
 */
export function keepAlive<T extends BotLine>(fen: string, lines: T[], whiteToMove: boolean): T[] {
  const cands = lines.filter((l) => l.uci.length > 0);
  if (cands.length < 2) return lines;
  const best = Math.max(...cands.map((l) => lineScore(l, whiteToMove)));
  if (best < -30 || best >= 9000) return lines;
  const dead = cands.map((l) => deadLine(fen, l.uci));
  if (!dead.some(Boolean)) return lines;
  const alive = cands.filter((l, i) => !dead[i]);
  return alive.some((l) => best - lineScore(l, whiteToMove) <= 60) ? alive : lines;
}

/** Μια υποψήφια κίνηση του bot: η αξιολόγηση από τη δική του σκοπιά και πόσες φορές έχει ήδη εμφανιστεί η θέση που φέρνει. */
export interface RepCandidate {
  uci: string;
  score: number;
  seen: number;
  /** η γραμμή της καταλήγει αμέσως σε νεκρή ισοπαλία (δεν διαλέγεται όσο υπάρχει άλλη ισάξια) */
  dead?: boolean;
}

/**
 * Αποφυγή επανάληψης: όταν το bot δεν είναι χειρότερα (≥ −0,2), ανάμεσα στις κινήσεις ως `tol` εκατοστά από την
 * καλύτερη διαλέγει μία που φέρνει θέση που δεν έχει ξαναεμφανιστεί, με βάρη υπέρ των καλύτερων (ώστε σε ισόπαλες
 * θέσεις να δοκιμάζει κι άλλες ιδέες αντί να παίζει πάντα την πρώτη)· αν δεν υπάρχει τέτοια, αυτή με τις λιγότερες
 * επαναλήψεις. Όταν είναι χειρότερα ή βλέπει ματ: null (κρατά τη δική του επιλογή).
 */
export function avoidRepetition(cands: RepCandidate[], tol: number, rng: Rng = Math.random): string | null {
  if (!cands.length) return null;
  const best = Math.max(...cands.map((c) => c.score));
  if (best < -20 || best >= 9000) return null;
  const near = cands.filter((c) => best - c.score <= tol);
  // όχι νεκρή ισοπαλία όταν υπάρχει άλλη ισάξια κίνηση
  const pool = near.some((c) => !c.dead) ? near.filter((c) => !c.dead) : near;
  const fewest = Math.min(...pool.map((c) => c.seen));
  const list = pool.filter((c) => c.seen === fewest);
  const k = Math.max(4, tol / 2);
  return list[weighted(list.map((c) => Math.exp(-(best - c.score) / k)), rng)].uci;
}

/** Δείκτης με πιθανότητα ανάλογη του βάρους. */
export function weighted(weights: number[], rng: Rng = Math.random): number {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(sum > 0)) return 0;
  let r = rng() * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Κίνηση Maia από τις πιθανότητες του δικτύου: όπως ένας άνθρωπος, συνήθως η πιο πιθανή, αλλά όχι πάντα. Οι
 * πιθανότητες «οξύνονται» (θερμοκρασία 0,5) και αγνοούνται οι κινήσεις κάτω από 3%. Από το RealChessBase.
 */
export function sampleHuman(moves: Array<{ uci: string; p: number }>, rng: Rng = Math.random, temperature = 0.5): string | null {
  if (!moves.length) return null;
  const top = Math.max(...moves.map((m) => m.p));
  const pool = moves.filter((m) => m.p >= 0.03 || m.p === top);
  return pool[weighted(pool.map((m) => Math.pow(m.p, 1 / temperature)), rng)].uci;
}

export interface BookCandidate {
  uci: string;
  games: number;
  /** σκορ της πλευράς που παίζει 0..1 */
  score: number;
}

/**
 * Κίνηση «από βιβλίο» από το δέντρο μιας βάσης: μόνο κινήσεις με αρκετές παρτίδες (≥ 3 και ≥ 3% των
 * παρτίδων της θέσης) και όχι κακό σκορ (≥ 35%). Ο επιθετικός προτιμά τα καλά σκορ, ο σταθερός τις
 * δημοφιλείς. Καμία κατάλληλη: null (παίζει η μηχανή).
 */
export function pickBookMove(moves: BookCandidate[], style: BotStyle, rng: Rng = Math.random): string | null {
  const total = moves.reduce((a, m) => a + m.games, 0);
  if (total < 10) return null;
  const ok = moves.filter((m) => m.uci && m.games >= 3 && m.games >= total * 0.03 && m.score >= 0.35);
  if (!ok.length) return null;
  const weights = ok.map((m) => {
    const pop = m.games / total;
    if (style === 'aggressive') return pop * Math.pow(m.score + 0.2, 4);
    if (style === 'solid') return Math.pow(pop, 1.6);
    return pop;
  });
  return ok[weighted(weights, rng)].uci;
}

/**
 * Δέχεται το bot ισοπαλία; Ναι όταν δεν είναι καλύτερα (η αξιολόγηση από τη δική του πλευρά ≤ 0,3,
 * ή ≤ 0,1 τις πρώτες 30 ημικινήσεις)· η πλήρης μηχανή μόνο όταν είναι χειρότερα ή η θέση είναι νεκρή.
 */
export function acceptsDraw(botScore: number | null, plies: number, full = false): boolean {
  if (botScore === null) return false;
  if (full) return botScore <= 0 || Math.abs(botScore) < 15;
  return botScore <= (plies < 30 ? 10 : 30);
}

export type GameOutcome = 'win' | 'loss' | 'draw';

/** Το αποτέλεσμα για τον χρήστη από το PGN «1-0» / «0-1» / «1/2-1/2». */
export function outcomeFor(result: string, color: 'white' | 'black'): GameOutcome | null {
  if (result === '1/2-1/2') return 'draw';
  if (result === '1-0') return color === 'white' ? 'win' : 'loss';
  if (result === '0-1') return color === 'black' ? 'win' : 'loss';
  return null;
}

/** Πέτυχε ο στόχος της θέσης; «Νίκη»: μόνο νίκη. «Κράτα την ισοπαλία»: ισοπαλία ή νίκη. */
export function practiceSuccess(target: 'win' | 'draw', outcome: GameOutcome): boolean {
  return target === 'win' ? outcome === 'win' : outcome !== 'loss';
}

/** Τα αποτελέσματα του χρήστη απέναντι σε ένα bot. */
export interface BotRecord {
  w: number;
  d: number;
  l: number;
}

/** Νέο σύνολο αποτελεσμάτων μετά από μια παρτίδα. */
export function addOutcome(r: BotRecord | undefined, o: GameOutcome): BotRecord {
  const x = { w: r?.w ?? 0, d: r?.d ?? 0, l: r?.l ?? 0 };
  if (o === 'win') x.w++;
  else if (o === 'draw') x.d++;
  else x.l++;
  return x;
}

/** Το κλειδί μιας θέσης για την τριπλή επανάληψη: διάταξη, σειρά, ροκέ, αν πασάν (χωρίς τους μετρητές). */
export function repetitionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/** Πόσες φορές εμφανίστηκε η τελευταία θέση της σειράς (FEN από την αρχή ως την άκρη). */
export function repetitions(fens: string[]): number {
  if (!fens.length) return 0;
  const last = repetitionKey(fens[fens.length - 1]);
  return fens.filter((f) => repetitionKey(f) === last).length;
}

// ---------------------------------------------------------------------------
// ανθρώπινος ρυθμός: πόσο «σκέφτεται» κάθε αντίπαλος πριν παίξει

export interface ThinkStyle {
  /** μέσος χρόνος ανά κίνηση (ms) */
  avg: number;
  /** όρια (ms) */
  min: number;
  max: number;
  /** πόσο σκέφτεται παραπάνω στις δύσκολες θέσεις (0 = καθόλου, 1 = κανονικά, 2 = πολύ) */
  depth: number;
}

/** Ο ρυθμός κάθε χαρακτήρα: ο Jack του καφενείου παίζει γρήγορα, η Sophie και ο Daniel παίρνουν τον χρόνο τους. */
const THINK: Record<string, ThinkStyle> = {
  beginner: { avg: 1400, min: 500, max: 4000, depth: 0.6 },
  kid: { avg: 1200, min: 400, max: 3500, depth: 0.5 },
  cafe: { avg: 700, min: 300, max: 2000, depth: 0.3 },
  student: { avg: 2200, min: 600, max: 7000, depth: 1.1 },
  club: { avg: 2600, min: 700, max: 8000, depth: 1.2 },
  attacker: { avg: 1600, min: 500, max: 6000, depth: 1 },
  solid: { avg: 3200, min: 900, max: 10000, depth: 1.4 },
  expert: { avg: 3600, min: 800, max: 12000, depth: 1.6 },
  master: { avg: 3000, min: 600, max: 12000, depth: 1.8 },
  full: { avg: 1000, min: 400, max: 2500, depth: 0.4 },
  leela: { avg: 2800, min: 2000, max: 5000, depth: 0.5 },
  maia: { avg: 1800, min: 500, max: 6000, depth: 1 },
};

export function thinkStyle(bot: BotSpec): ThinkStyle {
  const s = THINK[bot.kind === 'maia' ? 'maia' : bot.id];
  if (s) return s;
  // δικές σου ρυθμίσεις: πιο δυνατός, πιο σκεπτικός
  const avg = Math.round(Math.min(3500, Math.max(1000, bot.elo * 1.3)));
  return { avg, min: 400, max: avg * 3, depth: 1 };
}

export interface ThinkContext {
  /** πόσες νόμιμες κινήσεις έχει */
  legal: number;
  /** ημικινήσεις της παρτίδας ως εδώ */
  ply: number;
  /** κίνηση από τη θεωρία (βιβλίο) */
  book?: boolean;
  /** είναι σε σαχ */
  inCheck?: boolean;
  /** ξαναπαίρνει το κομμάτι που μόλις πάρθηκε */
  recapture?: boolean;
  /** οι αξιολογήσεις των γραμμών της μηχανής από την πλευρά του (εκατοστά), η καλύτερη πρώτη */
  scores?: number[];
  /** η αξιολόγηση της προηγούμενης κίνησής του (για τις απότομες αλλαγές) */
  prevScore?: number | null;
  /** με ρολόι: πόσος χρόνος του μένει και η προσαύξηση (ms) */
  clock?: { left: number; inc: number };
}

/**
 * Πόσο σκέφτεται (ms) σε αυτή τη θέση: γρήγορα στη θεωρία, στη μόνη κίνηση και όταν ξαναπαίρνει κομμάτι·
 * περισσότερο όταν έχει πολλές ισάξιες επιλογές, όταν μόνο μία κίνηση κρατά τη θέση ή όταν κάτι άλλαξε
 * απότομα. Με ρολόι ποτέ τόσο που να κινδυνεύει η σημαία του.
 */
export function thinkMs(style: ThinkStyle, c: ThinkContext, rng: () => number = Math.random): number {
  // οι περισσότερες σκέψεις κοντά στον μέσο όρο, μερικές πολύ πιο γρήγορες ή πιο αργές
  const noise = Math.exp((rng() + rng() + rng() - 1.5) * 0.7);
  let t: number;
  if (c.legal <= 1) t = style.min * 0.6 + rng() * 300;
  else if (c.book) t = style.avg * (0.25 + rng() * 0.35);
  else {
    let k = c.ply < 12 ? 0.6 : c.ply < 50 ? 1.1 : 1;
    const best = c.scores?.[0];
    if (best !== undefined && c.scores!.length > 1) {
      if (c.scores!.filter((s) => best - s <= 35).length >= 3) k *= 1 + 0.35 * style.depth;
      if (best - c.scores![1] >= 150 && Math.abs(best) < 600) k *= 1 + 0.5 * style.depth;
    }
    if (best !== undefined && c.prevScore != null && Math.abs(best - c.prevScore) >= 120) k *= 1 + 0.6 * style.depth;
    // ξεκάθαρη θέση (κερδισμένη ή χαμένη): πιο γρήγορα
    if (best !== undefined && Math.abs(best) >= 700) k *= 0.7;
    if (c.inCheck) k *= 0.8;
    if (c.recapture) k *= 0.45;
    t = style.avg * k * noise;
  }
  t = Math.max(c.legal <= 1 ? style.min * 0.5 : style.min, Math.min(style.max, t));
  if (c.clock) t = Math.min(t, c.clock.left / 25 + c.clock.inc * 0.8, c.clock.left * 0.2);
  return Math.max(150, Math.round(t));
}
