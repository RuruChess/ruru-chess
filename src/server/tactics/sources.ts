/** Κατάλογος πηγών puzzles: η κύρια συλλογή (CC0), συλλογές του Lucas Chess, τεστ EPD και τα μαθήματα της εφαρμογής (σταθερά ids, άδειες, καρφωμένες εκδόσεις). */

export type SourceKind = 'lichess' | 'lucas' | 'epd' | 'bundled' | 'mine';

/** Οι σελίδες της «Βελτίωσης»: τακτικά (μόνο συνδυασμοί), φινάλε και στρατηγικά. */
export type Section = 'tactics' | 'endgame' | 'strategy';
export const SECTIONS: readonly Section[] = ['tactics', 'endgame', 'strategy'];

export interface LucasFile {
  /** διαδρομή μέσα στο repo του Lucas Chess */
  path: string;
  /** θέματα που δίνει το αρχείο (π.χ. Pin → pin) */
  themes?: string[];
  /** επίπεδο δυσκολίας 1–5 (για βαθμό κατά προσέγγιση) */
  level?: number;
  /** μορφή γραμμών «τοποθέτηση,uci|…» (.lst) */
  lst?: boolean;
}

export interface SourceDef {
  key: string;
  /** σταθερό id (μπαίνει στα αναγνωριστικά των puzzles: 1e9 + id·1e7 + αύξων) */
  id: number;
  kind: SourceKind;
  /** ομάδα για το «εισαγωγή όλων» (π.χ. 'lucas') */
  group: string;
  name: { el: string; en: string };
  /** σελίδα της «Βελτίωσης» όπου ανήκει */
  section: Section;
  /** υποομάδα μέσα στη σελίδα (main, combos, mates, endgames, positional, tests, mine) */
  cat: string;
  /** τι ακριβώς περιέχει (για την οθόνη λήψης) */
  about: { el: string; en: string };
  /**
   * Τι λύση δίνει η ίδια η πηγή: πλήρεις γραμμές (lines), μόνο την καλύτερη κίνηση, με βαθμούς ανά κίνηση
   * στο STS (best), ή καμία, μόνο θέσεις (none)
   */
  solution: 'lines' | 'best' | 'none';
  license: string;
  url: string;
  /** μεγάλη/προαιρετική συλλογή: δεν μπαίνει με το «όλα» της ομάδας */
  optional?: boolean;
  /** περίπου πόσες θέσεις (για την οθόνη εισαγωγής πριν από τη λήψη) */
  approx: number;
  /** καρφωμένη έκδοση (commit) ώστε τα αναγνωριστικά να μένουν σταθερά */
  version?: string;
  files?: LucasFile[];
  /** ενσωματωμένη συλλογή: το αρχείο της στο src/data/lessons (μπαίνει μόνη της, χωρίς λήψη) */
  data?: string;
  /** βαθμός κατά προσέγγιση (όταν δεν υπάρχει επίπεδο) */
  baseRating?: number;
  /** τι είδους puzzles: λύση με κινήσεις, εξάσκηση με μηχανή, τεστ */
  mode?: 'solve' | 'practice' | 'test';
}

const LUCAS_SHA = 'b3ab7678077d6433e45d85f55acac2102e13e82e';
export const LUCAS_RAW = `https://raw.githubusercontent.com/lukasmonk/lucaschessR2/${LUCAS_SHA}/`;
const LUCAS_LICENSE = 'GPL-3.0 (Lucas Chess R2· οι συγγραφείς των συλλογών αναφέρονται στο όνομα)';
const LUCAS_URL = 'https://github.com/lukasmonk/lucaschessR2';

const auerswald: Array<[string, string[]]> = [
  ['Decoy', ['attraction']],
  ['Deflection', ['deflection']],
  ['Different themes', []],
  ['Drawing Combinations', ['equality']],
  ['Interference', ['interference']],
  ['Pawn promotion', ['promotion', 'advancedPawn']],
  ['Pin', ['pin']],
  ['Removal of defence', ['capturingDefender']],
  // «Räumung» στο γερμανικό πρωτότυπο: άδειασμα τετραγώνου/γραμμής
  ['Removal', ['clearance']],
];

const uned: Array<[string, string[]]> = [
  ['Annihilation of defense', ['capturingDefender']],
  ['Attacking Defender', ['deflection']],
  ['Decoy', ['attraction']],
  ['Discovered attack', ['discoveredAttack']],
  ['Double attack', ['fork']],
  ['Interception-blocade', ['interference']],
  ['Pawn promotion', ['promotion']],
  ['Pin', ['pin']],
  ['X-ray attack', ['xRayAttack']],
];

const tumbarello: Array<[string, string[]]> = [
  ['Endings, bishops and pawns', ['endgame', 'bishopEndgame']],
  ['Endings, generic positions', ['endgame']],
  ['Endings, knights and pawns', ['endgame', 'knightEndgame']],
  ['Endings, major pieces and pawns', ['endgame']],
  ['Endings, minor pieces and pawns', ['endgame']],
  ['Endings, pawns', ['endgame', 'pawnEndgame']],
  ['Endings, queens and pawns', ['endgame', 'queenEndgame']],
  ['Endings, rooks and pawns', ['endgame', 'rookEndgame']],
  ['Middlegames, attack against castling', ['middlegame', 'kingsideAttack']],
  ['Middlegames, complicated positions', ['middlegame']],
  ['Middlegames, king in the center', ['middlegame', 'exposedKing']],
  ['Middlegames, transition to favourable endgame', ['middlegame']],
];

const pawnEndings = ['KPK', 'KPKP', 'KPPK', 'KPPKP', 'KPPKPP', 'KPPKPPP', 'KPPPKP', 'KPPPKPP', 'KPPPKPPP', 'KPPPPKPPP'];

const grafino = [
  'Famous Studies/Arabic.Manuscript.Position.1140.[White always win]',
  'Famous Studies/Centurini.Position.[White to play and win]',
  'Famous Studies/Lucena.Position.[White to play and win]',
  'Famous Studies/Philidor.Position.[Black to play and White draws]',
  'Famous Studies/Reti.Position.[White to play and draw]',
  'Famous Studies/Saavedra.Position.[White to play and win]',
  'Famous Studies/Vancura.Position.[White to play and Black draws]',
  'Major Pieces Endings/King.And.Two.Rooks.Vs.King.And.Queen',
  'Major Pieces Endings/King.And.Two.Rooks.Vs.King.And.Rook',
  'Major Pieces Endings/King.And.Two.Rooks',
  'Major Vs Minor Pieces Endings/King.And.Queen.Versus.King.And.Bishop',
  'Major Vs Minor Pieces Endings/King.And.Queen.Versus.King.And.Knight',
  'Major Vs Minor Pieces Endings/King.And.Rook.Versus.King.And.Bishop',
  'Major Vs Minor Pieces Endings/King.And.Rook.Versus.King.And.Knight',
  'Pawns Breaks/Complex.Pawns.Break.[Black to play and win]',
  'Pawns Breaks/Four.Pawns.Break.[White to play and win]',
  'Pawns Breaks/Outside.Passed.Pawn.Break.[White to play and win]',
  'Pawns Breaks/Three.Pawns.Easy.Break.[White to play and win]',
  'The Four Basic Mates/2 Bishops Mate',
  'The Four Basic Mates/King and Queen Mate',
  'The Four Basic Mates/King and Rook Mate',
  'The Four Basic Mates/Knight and Bishop Mate',
];

const T = 'Resources/Trainings/';

export const SOURCES: SourceDef[] = [
  {
    key: 'lichess',
    id: 1,
    kind: 'lichess',
    group: 'lichess',
    name: { el: 'Κύρια συλλογή puzzles', en: 'Main puzzle collection' },
    section: 'tactics',
    cat: 'main',
    about: { el: 'Εκατομμύρια συνδυασμοί από πραγματικές παρτίδες, με βαθμό δυσκολίας, θέματα και άνοιγμα.', en: 'Millions of combinations from real games, with difficulty rating, themes and opening.' },
    solution: 'lines',
    license: 'CC0',
    url: '',
    approx: 4_433_190,
    mode: 'solve',
  },
  {
    key: 'lucas-auerswald',
    id: 10,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Τακτική του Uwe Auerswald', en: 'Tactics by Uwe Auerswald' },
    section: 'tactics',
    cat: 'combos',
    about: { el: 'Συνδυασμοί από παρτίδες δασκάλων, ανά θέμα: έλξη, εκτροπή, παρεμβολή, κάρφωμα, κατάργηση της άμυνας, εκκένωση, προαγωγή και συνδυασμοί για ισοπαλία. Με αστεράκια δυσκολίας.', en: 'Combinations from master games, by theme: decoy, deflection, interference, pin, removing the defender, clearance, promotion and drawing combinations. Rated with difficulty stars.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 3518,
    version: LUCAS_SHA,
    files: auerswald.map(([f, themes]) => ({ path: `${T}Tactics by Uwe Auerswald/${f}.fns`, themes })),
    mode: 'solve',
  },
  {
    key: 'lucas-uned',
    id: 11,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Τακτική της σχολής UNED', en: 'Tactics by UNED chess school' },
    section: 'tactics',
    cat: 'combos',
    about: { el: 'Βασικές ασκήσεις τακτικής της σχολής σκακιού UNED, ανά θέμα: διπλή επίθεση, κάρφωμα, αποκάλυψη, ακτίνες Χ, έλξη, εκτροπή, προαγωγή. Καλές για αρχή.', en: 'Basic tactics exercises from the UNED chess school, by theme: double attack, pin, discovered attack, X-ray, decoy, deflection, promotion. Good for a start.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 540,
    version: LUCAS_SHA,
    baseRating: 1400,
    files: uned.map(([f, themes]) => ({ path: `${T}Tactics by UNED chess school/${f}.fns`, themes })),
    mode: 'solve',
  },
  {
    key: 'lucas-gm-mates',
    id: 12,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Ματ σε παρτίδες GM (σε 1–9)', en: 'Checkmates in GM games (mate in 1–9)' },
    section: 'tactics',
    cat: 'mates',
    about: { el: 'Ματ σε 1 έως 9 κινήσεις από παρτίδες γκρανμέτρ.', en: 'Mates in 1 to 9 moves from grandmaster games.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 13_940,
    version: LUCAS_SHA,
    files: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ path: `${T}Checkmates in GM games/Mate in ${n}.fns`, themes: ['mate'], level: Math.min(5, n) })),
    mode: 'solve',
  },
  {
    key: 'lucas-singular-win',
    id: 13,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Μοναδικές κινήσεις για νίκη', en: 'Singular moves to win' },
    section: 'tactics',
    cat: 'combos',
    about: { el: 'Θέσεις από online παρτίδες όπου μόνο μία κίνηση κερδίζει, σε 5 επίπεδα δυσκολίας.', en: 'Positions from online games where only one move wins, in 5 difficulty levels.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 7740,
    version: LUCAS_SHA,
    files: [1, 2, 3, 4, 5].map((n) => ({ path: `${T}Singular moves to win/Level ${n}.fns`, level: n })),
    mode: 'solve',
  },
  {
    key: 'lucas-singular-equal',
    id: 14,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Μοναδικές κινήσεις για ισοφάριση', en: 'Singular moves to equalize' },
    section: 'tactics',
    cat: 'combos',
    about: { el: 'Θέσεις από online παρτίδες όπου μόνο μία κίνηση σώζει (συχνά διαρκές σαχ ή ακριβής άμυνα).', en: 'Positions from online games where only one move saves the game (often perpetual check or an exact defence).' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 792,
    version: LUCAS_SHA,
    files: [1, 2, 3, 4, 5].map((n) => ({ path: `${T}Singular moves to equalize/Level ${n}.fns`, level: n, themes: ['equality', 'defensiveMove'] })),
    mode: 'solve',
  },
  {
    // μέσα στην εφαρμογή, χωρίς λήψη: θέσεις από άρθρα της Wikipedia με λύση, υποβαριάντες και σχόλια (src/data/lessons)
    key: 'wiki-endgame',
    id: 25,
    kind: 'bundled',
    group: 'bundled',
    name: { el: 'Μαθήματα φινάλε', en: 'Endgame lessons' },
    section: 'endgame',
    cat: 'lessons',
    about: {
      el: '36 μαθήματα με τη σειρά, από τα βασικά ματ (δύο πύργοι, βασίλισσα, πύργος, δύο αξιωματικοί) ως τις μελέτες, με λύση, υποβαριάντες και εξήγηση σε κάθε κίνηση: αντιπαράθεση, κρίσιμα τετράγωνα, τρίγωνο, η μελέτη του Réti, Lucena, Philidor και οι άμυνες στο φινάλε πύργου, βασίλισσα εναντίον πιονιού και πύργου, Saavedra. Με βάση άρθρα της Wikipedia και το «Chess Fundamentals» του Capablanca (1921). Είναι ήδη μέσα στην εφαρμογή.',
      en: '36 lessons in order, from the basic mates (two rooks, queen, rook, two bishops) to the studies, with solution, sub-variations and an explanation for every move: opposition, key squares, triangulation, the Réti study, Lucena, Philidor and the rook-ending defences, queen against pawn and rook, Saavedra. Based on Wikipedia articles and Capablanca’s “Chess Fundamentals” (1921). Already inside the app.',
    },
    solution: 'lines',
    license: 'CC BY-SA 4.0 (κείμενο από άρθρα της Wikipedia· οι συντάκτες τους)· τα βασικά ματ με βάση το «Chess Fundamentals» (1921, κοινό κτήμα)',
    url: 'https://en.wikipedia.org/',
    approx: 36,
    data: 'endgame.json',
    baseRating: 1500,
    mode: 'solve',
  },
  {
    key: 'lucas-pawn-endings',
    id: 15,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Φινάλε πιονιών', en: 'Pawn endings' },
    section: 'endgame',
    cat: 'endgames',
    about: { el: 'Φινάλε με βασιλιάδες και πιόνια (από ένα πιόνι εναντίον κανενός ως τέσσερα εναντίον τριών), από πραγματικές παρτίδες. Τα παίζεις ως το τέλος απέναντι στη μηχανή.', en: 'King and pawn endings (from one pawn against none to four against three), from real games. You play them to the end against the engine.' },
    solution: 'none',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 4317,
    version: LUCAS_SHA,
    baseRating: 1600,
    files: pawnEndings.map((f) => ({ path: `${T}Pawn endings/${f}.fns`, themes: ['endgame', 'pawnEndgame'] })),
    mode: 'practice',
  },
  {
    key: 'lucas-tumbarello',
    id: 16,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Τεχνική Tumbarello: φινάλε', en: 'Tumbarello technique: endings' },
    section: 'endgame',
    cat: 'endgames',
    about: { el: 'Θέσεις τεχνικής στα φινάλε: πύργοι, αξιωματικοί, ίπποι, βασίλισσες και πιόνια (συλλογή του Michele Tumbarello). Παίζεις τη θέση απέναντι στη μηχανή.', en: 'Endgame technique positions: rooks, bishops, knights, queens and pawns (collected by Michele Tumbarello). You play the position against the engine.' },
    solution: 'none',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 240,
    version: LUCAS_SHA,
    baseRating: 1900,
    files: tumbarello.filter(([f]) => f.startsWith('Endings')).map(([f, themes]) => ({ path: `${T}Technique by Michele Tumbarello/${f}.fns`, themes })),
    mode: 'practice',
  },
  {
    key: 'lucas-tumbarello-mid',
    id: 24,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Τεχνική Tumbarello: μέσο παιχνίδι', en: 'Tumbarello technique: middlegames' },
    section: 'strategy',
    cat: 'positional',
    about: { el: 'Θέσεις μέσου παιχνιδιού: επίθεση στο ροκέ, περίπλοκες θέσεις, βασιλιάς στο κέντρο, πέρασμα σε ευνοϊκό φινάλε (συλλογή του Michele Tumbarello). Παίζεις τη θέση απέναντι στη μηχανή.', en: 'Middlegame positions: attacking the castled king, complicated positions, king in the centre, transition to a favourable endgame (collected by Michele Tumbarello). You play the position against the engine.' },
    solution: 'none',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 103,
    version: LUCAS_SHA,
    baseRating: 1900,
    files: tumbarello.filter(([f]) => f.startsWith('Middlegames')).map(([f, themes]) => ({ path: `${T}Technique by Michele Tumbarello/${f}.fns`, themes })),
    mode: 'practice',
  },
  {
    key: 'lucas-transsiberian',
    id: 17,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Υπερσιβηρικός (επίπεδα 1–5)', en: 'Transsiberian route (levels 1–5)' },
    section: 'tactics',
    cat: 'combos',
    about: { el: 'Διαδρομή τακτικής του Lucas Chess σε 5 επίπεδα: από ματ σε 1 σε online παρτίδες ως δύσκολους συνδυασμούς από παρτίδες δασκάλων.', en: 'Lucas Chess tactics route in 5 levels: from mate in 1 in online games to hard combinations from master games.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 3568,
    version: LUCAS_SHA,
    files: [1, 2, 3, 4, 5].map((n) => ({ path: `Resources/IntFiles/Routes/Transsiberian/level${n}/tactics.fns`, level: n })),
    mode: 'solve',
  },
  {
    key: 'lucas-fics-mates',
    id: 18,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Ματ από τη βάση του FICS', en: 'Checkmates from FICS database' },
    section: 'tactics',
    cat: 'mates',
    about: { el: 'Ματ από online παρτίδες (FICS): επίθεση στον βασιλιά μετά το ροκέ, ματ με ίππο, ματ σε φινάλε με πιόνια και πύργους.', en: 'Mates from online games (FICS): attacks on the castled king, knight mates, mates in pawn and rook endings.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 813,
    version: LUCAS_SHA,
    baseRating: 1400,
    files: [
      ['Attacking the king in the castle M1', ['kingsideAttack']],
      ['Attacking the king in the castle M2-7', ['kingsideAttack']],
      ['Endings with just pawns', ['endgame']],
      ['Endings with pawns and rooks', ['endgame']],
      ['The kick of the knight', []],
    ].map(([f, themes]) => ({ path: `${T}Checkmates from FICS database/${f as string}.fns`, themes: themes as string[] })),
    mode: 'solve',
  },
  {
    key: 'lucas-mate2-pieces',
    id: 19,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Ματ σε 2 με συγκεκριμένα κομμάτια', en: 'Mate in two with specific pieces' },
    section: 'tactics',
    cat: 'mates',
    about: { el: 'Προβλήματα σύνθεσης «ματ σε 2», ανά ζεύγος κομματιών (π.χ. αξιωματικός και ίππος, βασίλισσα και πύργος).', en: 'Composed “mate in 2” problems, sorted by pair of pieces (e.g. bishop and knight, queen and rook).' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 7132,
    version: LUCAS_SHA,
    baseRating: 1500,
    files: ['BN', 'BQ', 'BR', 'NQ', 'NR', 'QR'].map((f) => ({ path: `Resources/Tactics/Mate in two with specific pieces/${f}.fns`, themes: ['mate', 'mateIn2'] })),
    mode: 'solve',
  },
  {
    key: 'lucas-endgames',
    id: 20,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Κλασικά φινάλε (Grafino, Pérez, Álvarez)', en: 'Classic endgames (Grafino, Pérez, Álvarez)' },
    section: 'endgame',
    cat: 'endgames',
    about: { el: 'Κλασικές θέσεις φινάλε: διάσημες μελέτες (Lucena, Philidor, Saavedra, Réti, Vančura), τα βασικά ματ (βασίλισσα, πύργος, δύο αξιωματικοί, αξιωματικός και ίππος), ρήξεις πιονιών, φινάλε βαρέων κομματιών και θέσεις των Capablanca και Nunn.', en: 'Classic endgame positions: famous studies (Lucena, Philidor, Saavedra, Réti, Vančura), the basic mates (queen, rook, two bishops, bishop and knight), pawn breakthroughs, major-piece endings and positions by Capablanca and Nunn.' },
    solution: 'none',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 111,
    version: LUCAS_SHA,
    baseRating: 1700,
    files: [
      ...grafino.map((f) => ({ path: `${T}Endgames by Rui Grafino/${f}.fns`, themes: ['endgame'] })),
      { path: `${T}Endgames by Victor Perez/Various positions.fns`, themes: ['endgame'] },
      ...['Capablanca positions', 'Giri-Nakamura', 'Nunn positions'].map((f) => ({ path: `${T}Varied positions by Joaquin Alvarez/${f}.fns` })),
    ],
    mode: 'practice',
  },
  {
    key: 'lucas-sadier-m2',
    id: 21,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Ματ σε 2 του Eduardo Sadier', en: 'Mate in two by Eduardo Sadier' },
    section: 'tactics',
    cat: 'mates',
    about: { el: 'Η μεγάλη συλλογή του Eduardo Sadier: προβλήματα σύνθεσης «ματ σε 2» από σκακιστικά περιοδικά και βιβλία, από το 1849 και μετά.', en: 'Eduardo Sadier’s large collection: composed “mate in 2” problems from chess magazines and books, from 1849 on.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 180_805,
    version: LUCAS_SHA,
    optional: true,
    baseRating: 1700,
    files: [{ path: `${T}Checkmates by Eduardo Sadier/180805 positions of mate in two.fns`, themes: ['mate', 'mateIn2'] }],
    mode: 'solve',
  },
  {
    key: 'lucas-sadier-m1',
    id: 22,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Ματ σε 1 του Eduardo Sadier', en: 'Mate in one by Eduardo Sadier' },
    section: 'tactics',
    cat: 'mates',
    about: { el: '«Ματ σε 1» που προέκυψαν από τα προβλήματα «ματ σε 2» του Sadier.', en: '“Mate in 1” positions derived from Sadier’s “mate in 2” problems.' },
    solution: 'lines',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 175_275,
    version: LUCAS_SHA,
    optional: true,
    baseRating: 1100,
    files: [{ path: `${T}Checkmates by Eduardo Sadier/Mate in one (derived from mate in two).fns`, themes: ['mate', 'mateIn1'] }],
    mode: 'solve',
  },
  {
    key: 'lucas-mates-generated',
    id: 23,
    kind: 'lucas',
    group: 'lucas',
    name: { el: 'Ματ σε 1–4 (παραγόμενα, Lucas Chess)', en: 'Training mates in 1–4 (generated, Lucas Chess)' },
    section: 'tactics',
    cat: 'mates',
    about: { el: 'Ματ σε 1 έως 4 κινήσεις σε θέσεις φτιαγμένες από υπολογιστή, όχι από παρτίδες. Στα ματ σε 2–4 μετρά μόνο η πρώτη κίνηση.', en: 'Mates in 1 to 4 moves in computer-made positions, not from games. In mates in 2–4 only the first move counts.' },
    solution: 'best',
    license: LUCAS_LICENSE,
    url: LUCAS_URL,
    approx: 32_100,
    version: LUCAS_SHA,
    optional: true,
    files: [1, 2, 3, 4].map((n) => ({ path: `Resources/IntFiles/Mate/mate${n}.lst`, lst: true, themes: ['mate', `mateIn${n}`], level: n + 1 })),
    mode: 'solve',
  },
  {
    key: 'epd-bk',
    id: 42,
    kind: 'epd',
    group: 'epd',
    name: { el: 'Τεστ Bratko–Kopec', en: 'Bratko–Kopec test' },
    section: 'strategy',
    cat: 'tests',
    about: { el: 'Το κλασικό τεστ Bratko–Kopec (1982): 24 θέσεις, μισές τακτικές και μισές με ρήξη πιονιών. Βρες την καλύτερη κίνηση.', en: 'The classic Bratko–Kopec test (1982): 24 positions, half tactical and half about pawn levers. Find the best move.' },
    solution: 'best',
    license: 'BSD-2 (thgreiner/amy)',
    url: 'https://raw.githubusercontent.com/thgreiner/amy/067cc5890d47de36a4d76343af838c427cc2d958/EPD/BK.epd',
    approx: 24,
    version: '067cc5890d47de36a4d76343af838c427cc2d958',
    baseRating: 2300,
    mode: 'test',
  },
  {
    key: 'epd-sts',
    id: 43,
    kind: 'epd',
    group: 'epd',
    name: { el: 'Strategic Test Suite (STS)', en: 'Strategic Test Suite (STS)' },
    section: 'strategy',
    cat: 'tests',
    about: { el: '1.500 θέσεις σε 15 στρατηγικά θέματα, 100 στο καθένα: υπονόμευση, ανοιχτές στήλες και διαγώνιοι, φυλάκια ίππων, αξιωματικός ή ίππος, προώθηση πιονιών, έλεγχος του κέντρου, δραστηριότητα του βασιλιά, 7η γραμμή, απλοποίηση κ.ά. Βρες την καλύτερη κίνηση.', en: '1,500 positions in 15 strategic themes, 100 each: undermining, open files and diagonals, knight outposts, bishop or knight, pawn advances, centre control, king activity, the 7th rank, simplification and more. Find the best move.' },
    solution: 'best',
    license: 'MIT (fsmosca/STS-Rating)',
    url: 'https://raw.githubusercontent.com/fsmosca/STS-Rating/4e36977090c3a93ea57d5f34e13e42df422634d3/STS1-STS15_LAN_v3.epd',
    approx: 1500,
    version: '4e36977090c3a93ea57d5f34e13e42df422634d3',
    baseRating: 2200,
    mode: 'test',
  },
  {
    key: 'epd-arasan2023',
    id: 44,
    kind: 'epd',
    group: 'epd',
    name: { el: 'Τεστ Arasan 2023', en: 'Arasan 2023 test' },
    section: 'strategy',
    cat: 'tests',
    about: { el: 'Πολύ δύσκολες θέσεις από παρτίδες κορυφαίων παικτών και μηχανών (τεστ Arasan 2023): βαθιές ιδέες, θυσίες και ήσυχες κινήσεις. Μικτό, για προχωρημένους. Βρες την καλύτερη κίνηση.', en: 'Very hard positions from games of top players and engines (Arasan 2023 test): deep ideas, sacrifices and quiet moves. Mixed, for advanced players. Find the best move.' },
    solution: 'best',
    license: 'Arasan (Jon Dart)· αρχείο από namebrandon/seajay-chess',
    url: 'https://raw.githubusercontent.com/namebrandon/seajay-chess/1c64dbc4348a0b0073e2b0c9dab4bbe1cb09223d/tests/positions/arasan2023.epd',
    approx: 200,
    version: '1c64dbc4348a0b0073e2b0c9dab4bbe1cb09223d',
    baseRating: 2700,
    mode: 'test',
  },
  {
    // η Τράπεζα λαθών (Κύμα 6): γεμίζει μόνη της από την ανάλυση των παρτίδων του χρήστη, δεν εισάγεται
    key: 'mine',
    id: 60,
    kind: 'mine',
    group: 'mine',
    name: { el: 'Τα λάθη μου', en: 'My mistakes' },
    section: 'tactics',
    cat: 'mine',
    about: { el: 'Τα δικά σου λάθη από την ανάλυση των παρτίδων σου.', en: 'Your own mistakes from the analysis of your games.' },
    solution: 'lines',
    license: 'Οι δικές σου παρτίδες',
    url: '',
    approx: 0,
    mode: 'solve',
  },
];

export const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));
export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

/** Πηγές για ένα αίτημα εισαγωγής: κλειδί πηγής, ομάδα (π.χ. «lucas», χωρίς τις προαιρετικές), «section-<σελίδα>» ή «extras». */
export function resolveSources(key: string, includeOptional = false): SourceDef[] {
  const one = SOURCE_BY_KEY.get(key);
  // «Τα λάθη μου» δεν εισάγεται ποτέ (μια κενή εισαγωγή θα έσβηνε τις κάρτες)
  if (one) return one.kind === 'mine' ? [] : [one];
  // οι ενσωματωμένες (μαθήματα) μπαίνουν μόνες τους: όχι στις ομαδικές εισαγωγές
  const many = (s: SourceDef) => s.kind !== 'mine' && s.kind !== 'bundled' && (includeOptional || !s.optional);
  if (key.startsWith('section-')) {
    const sec = key.slice('section-'.length);
    return SOURCES.filter((s) => s.section === sec && s.kind !== 'lichess' && many(s));
  }
  if (key === 'extras' || key === 'all') {
    return SOURCES.filter((s) => (key === 'all' || s.kind !== 'lichess') && many(s));
  }
  return SOURCES.filter((s) => s.group === key && many(s));
}
