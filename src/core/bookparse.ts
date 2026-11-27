/**
 * Σκακιστικό βιβλίο σε παρτίδες PGN: οι παράγραφοι του βιβλίου (από PDF ή κείμενο) γίνονται παρτίδες, μία ανά
 * ενότητα κεφαλαίου, με την κύρια γραμμή, τις βαριάντες και υποβαριάντες, τα σχόλια, τα σύμβολα αξιολόγησης και,
 * από τα σχόλια, βέλη για τα πλάνα (π.χ. «0-0, a4 και Rc1») και κύκλους για αδυναμίες και κρίσιμα τετράγωνα.
 *
 * Πώς τοποθετείται μια κίνηση: ο αριθμός της («13...h6») δίνει την ημικίνηση· η κίνηση μπαίνει στον πρώτο κόμβο
 * αυτής της ημικίνησης όπου είναι νόμιμη, ψάχνοντας με τη σειρά: στη γραμμή που διαβάζεται, στην κύρια γραμμή,
 * σε όλο το δέντρο (ο πιο πρόσφατος πρώτα). Οι κινήσεις της κύριας γραμμής (έντονα στο βιβλίο) πάνε πάντα στην
 * κύρια γραμμή. Κινήσεις χωρίς αριθμό μετρούν μόνο αν συνεχίζουν μια σειρά κινήσεων· αλλιώς είναι αναφορές μέσα
 * στο κείμενο (πλάνα). Οι αγκύλες [ ] και οι παρενθέσεις με κινήσεις είναι υποβαριάντες.
 *
 * Μορφή χωρίς τελεία στους αριθμούς (αναγνωρίζεται από το ίδιο το βιβλίο: «10 h4», «10 ... Nh4»): μία
 * παρτίδα ανά κεφάλαιο («Chapter One»), οι ενότητες («1.41 6 Be2») και οι ετικέτες «(a)» είναι βαριάντες μέσα του, οι
 * μεγάλες κινήσεις της κύριας γραμμής και οι υπότιτλοι («Others:») δεν είναι επικεφαλίδες.
 */
import { BLACK, F_CAPTURE, F_NULL, NULL_MOVE, Position, parseSquare } from './chess.ts';
import { DESC_SRC, descriptiveMove, squeezeDescriptive } from './descriptive.ts';
import { Game, GameNode, type Shape } from './game.ts';
import { writeGame } from './pgn.ts';

export interface BookRun {
  text: string;
  /** γραμμένο με τη γραμματοσειρά της κύριας γραμμής (συνήθως έντονα) */
  main: boolean;
  /** η κύρια γραμμή του κεφαλαίου, όταν το βιβλίο έχει και δεύτερη (των ενοτήτων) σε άλλη γραμματοσειρά· πάντα και main */
  top?: boolean;
}

/** Διάγραμμα του βιβλίου: η θέση και ό,τι γράφει δίπλα του. */
export interface BookDiagram {
  /** τα κομμάτια (πρώτο πεδίο του FEN), από τη μεριά του Λευκού */
  placement: string;
  /** ποιος παίζει, όταν το δείχνει το διάγραμμα */
  turn: 'w' | 'b' | null;
  /** ο αριθμός της άσκησης δίπλα στο διάγραμμα */
  label: string | null;
  /** η επικεφαλίδα πάνω από το διάγραμμα (π.χ. «Capablanca – Mieses, Bad Kissingen 1928») */
  caption: string;
  /** η θέση του στη σελίδα (αριστερά, πάνω), για τη σειρά ανάγνωσης */
  x?: number;
  y?: number;
  /** διάγραμμα-εικόνα: ο αριθμός του στο βιβλίο (η θέση βγήκε από αναγνώριση εικόνας, άρα μπορεί να έχει λάθη) */
  id?: number;
}
export interface BookParagraph {
  page: number;
  indent: number;
  heading: boolean;
  caption: boolean;
  runs: BookRun[];
  text: string;
  diagram?: BookDiagram;
  /** γραμμή στο κέντρο της σελίδας (όνομα ενότητας, ρητό): τέλος μιας λύσης */
  centered?: boolean;
  /** πού αρχίζει κάθε γραμμή του βιβλίου μετά την πρώτη (θέσεις στο `text`) */
  lineStarts?: number[];
}

export interface BookOptions {
  title: string;
  author: string;
  year?: number;
  /** λίγα βέλη και κύκλοι από τα σχόλια (μόνο ρητά πλάνα, διαδρομές και αδύνατα τετράγωνα)· προεπιλογή: όχι */
  shapes?: boolean;
  /**
   * Διαγράμματα-εικόνες (με `id`): τι λέει το κείμενο για τη θέση τους, για τη διόρθωση της αναγνώρισης.
   */
  probe?: (id: number, e: DiagramEvidence) => void;
  /** διαγράμματα-εικόνες που επιβεβαίωσε το κείμενο: μόνο αυτά ξεκινούν απόσπασμα ή παρτίδα από τη θέση τους */
  trusted?: (id: number) => boolean;
  /** διαγράμματα-εικόνες με θέση από το πακέτο διαγραμμάτων (`diagramnet.ts`): ξεκινούν απόσπασμα όπως τα ψηφιακά */
  fixed?: (id: number) => boolean;
}

/** Κίνηση του κειμένου μετά από διάγραμμα (για τον έλεγχο της θέσης του). */
export interface ProbeMove {
  san: string;
  num: number | null;
  black: boolean;
}

/** Τι λέει το κείμενο για ένα διάγραμμα-εικόνα. */
export interface DiagramEvidence {
  /** οι θέσεις της παρτίδας εκεί (πρώτο πεδίο του FEN): η γραμμή που διαβάζεται και η κύρια γραμμή */
  positions?: string[];
  /** οι πρώτες κινήσεις που ακολουθούν (λύση άσκησης ή απόσπασμα από το διάγραμμα) */
  moves?: ProbeMove[];
  turn?: 'w' | 'b' | null;
}

export interface BookStats {
  games: number;
  moves: number;
  variations: number;
  comments: number;
  nags: number;
  arrows: number;
  circles: number;
  /** κινήσεις με αριθμό που δεν χώρεσαν πουθενά (έμειναν ως κείμενο) */
  unplaced: number;
  /** ασκήσεις (διαγράμματα με αριθμό) και πόσες έχουν τη λύση τους σε κινήσεις */
  exercises?: number;
  solved?: number;
  /** διαγράμματα-εικόνες που έγιναν θέσεις, και πόσα από αυτά επιβεβαίωσε το κείμενο */
  diagrams?: number;
  verified?: number;
  /** σελίδες που διαβάστηκαν με OCR */
  ocrPages?: number;
}

export interface BookWarning {
  page: number;
  text: string;
}

export interface BookResult {
  games: Game[];
  stats: BookStats;
  warnings: BookWarning[];
  pgn: string;
}

// ---------------------------------------------------------------------------
// κείμενο σε λεκτικές μονάδες

/** Τα σύμβολα κομματιών (figurines) σε γράμματα. */
const FIGURINES: Record<string, string> = { '♔': 'K', '♚': 'K', '♕': 'Q', '♛': 'Q', '♖': 'R', '♜': 'R', '♗': 'B', '♝': 'B', '♘': 'N', '♞': 'N', '♙': '', '♟': '' };
/** Τα σύμβολα της γραμματοσειράς FigurineCB: «¤f6†» = Nf6+. */
const FIGURINES_CB: Record<string, string> = { '¢': 'K', '£': 'Q', '¤': 'N', '¥': 'B', '¦': 'R', '§': '' };

/** Σε πόσα τετράγωνα διαφέρουν δύο θέσεις (το πρώτο πεδίο του FEN). */
function squaresApart(a: string, b: string): number {
  const expand = (pl: string) => pl.replace(/\d/g, (n) => '.'.repeat(Number(n))).replace(/\//g, '');
  const x = expand(a);
  const y = expand(b);
  let k = 0;
  for (let i = 0; i < 64; i++) if (x[i] !== y[i]) k++;
  return k;
}

/** FEN από τη θέση ενός διαγράμματος· ροκέ όταν βασιλιάς και πύργος είναι στα αρχικά τους τετράγωνα. */
export function diagramFen(placement: string, turn: 'w' | 'b', fullmove = 1): string {
  const rows = placement.split('/').map((r) => r.replace(/\d/g, (d) => '1'.repeat(Number(d))));
  const at = (sq: string) => rows[8 - Number(sq[1])]?.[sq.charCodeAt(0) - 97];
  let c = '';
  if (at('e1') === 'K') c += (at('h1') === 'R' ? 'K' : '') + (at('a1') === 'R' ? 'Q' : '');
  if (at('e8') === 'k') c += (at('h8') === 'r' ? 'k' : '') + (at('a8') === 'r' ? 'q' : '');
  return `${placement} ${turn} ${c || '-'} - 0 ${Math.max(1, fullmove)}`;
}

/**
 * Σύμβολα κομματιών που το PDF δεν μεταφράζει σε γράμματα (γραμματοσειρές figurine χωρίς σωστό ToUnicode): βγαίνουν
 * «σκουπίδια» όπως «liJ» (ίππος), «'ii'» (βασίλισσα), «i..» (αξιωματικός) ή «�». Μπροστά
 * από τετράγωνο γίνονται ένας χαρακτήρας ιδιωτικής χρήσης ανά μορφή· το κομμάτι το βρίσκει η νομιμότητα της κίνησης
 * (`sanIn`), με βοήθεια από τη μορφή όταν χωρούν δύο κομμάτια.
 */
const GLYPH_RE = /(^|[\s([.…,;])([iIlLtJD:.'’*r1�@%>W]{1,5})(?=[a-h]?[1-8]?x?[a-h][1-8])/g;
/** ένα «σκουπίδι» έχει πάντα γράμμα ή σύμβολο (όχι μόνο τελείες, αποστρόφους, ψηφία: «1.e4», «'e4'») */
const GLYPH_MARK_RE = /[iIlLtJDrW�:*@%>]/;
const PUA_RE = /[\uE100-\uF8FF]/;
/**
 * \u03A3\u03CD\u03BC\u03B2\u03BF\u03BB\u03B1 \u03BA\u03BF\u03BC\u03BC\u03B1\u03C4\u03B9\u03CE\u03BD \u03B1\u03C0\u03CC \u03C4\u03BF\u03BD \u03B1\u03BD\u03B1\u03B3\u03BD\u03CE\u03C3\u03C4\u03B7 \u03B5\u03B9\u03BA\u03CC\u03BD\u03B1\u03C2 (`server/books/figurines.ts`): \u03AD\u03BD\u03B1\u03C2 \u03C7\u03B1\u03C1\u03B1\u03BA\u03C4\u03AE\u03C1\u03B1\u03C2 U+E000\u2013U+E0FF \u03B1\u03BD\u03AC \u03BF\u03BC\u03AC\u03B4\u03B1
 * \u03C3\u03C7\u03AE\u03BC\u03B1\u03C4\u03BF\u03C2 \u03C4\u03BF\u03C5 \u03B2\u03B9\u03B2\u03BB\u03AF\u03BF\u03C5 (U+E0FF: \u03C3\u03CD\u03BC\u03B2\u03BF\u03BB\u03BF \u03C7\u03C9\u03C1\u03AF\u03C2 \u03BF\u03BC\u03AC\u03B4\u03B1). \u0395\u03AF\u03BD\u03B1\u03B9 \u00AB\u03C3\u03BA\u03BF\u03C5\u03C0\u03AF\u03B4\u03B9\u03B1\u00BB \u03BC\u03B5 \u03C3\u03C4\u03B1\u03B8\u03B5\u03C1\u03AE \u03BC\u03BF\u03C1\u03C6\u03AE: \u03C4\u03BF \u03BA\u03BF\u03BC\u03BC\u03AC\u03C4\u03B9 \u03BA\u03AC\u03B8\u03B5 \u03BF\u03BC\u03AC\u03B4\u03B1\u03C2 \u03C4\u03BF
 * \u03BC\u03B1\u03B8\u03B1\u03AF\u03BD\u03B5\u03B9 \u03C4\u03BF \u03B2\u03B9\u03B2\u03BB\u03AF\u03BF \u03B1\u03C0\u03CC \u03C4\u03B9\u03C2 \u03BA\u03B9\u03BD\u03AE\u03C3\u03B5\u03B9\u03C2 \u03CC\u03C0\u03BF\u03C5 \u03BC\u03CC\u03BD\u03BF \u03AD\u03BD\u03B1 \u03BA\u03BF\u03BC\u03BC\u03AC\u03C4\u03B9 \u03B5\u03AF\u03BD\u03B1\u03B9 \u03BD\u03CC\u03BC\u03B9\u03BC\u03BF.
 */
const IMG_FIG_RE = /[\uE000-\uE0FF]/g;
const PUA_RANK_RE = new RegExp(String.raw`(${PUA_RE.source}[a-h]?[1-8]?x?[a-h])[lI](?![a-z\d])`, 'g');
/** σκαναρισμένα βιβλία (OCR): το ψηφίο του τετραγώνου διαβάστηκε γράμμα, σε κίνηση αμέσως μετά από αριθμό */
const OCR_RANK_RE = /((?:^|\s)\d{1,3}\s?(?:…|\.)?\s?)([^\s\d]{0,6}?[a-h]?x?[a-h])([lIS])(?=[+#!?]*(?:\s|$|[,;:)]))/g;
const OCR_DIGIT: Record<string, string> = { l: '1', I: '1', S: '5', '?': '7' };
const glyphCode = new Map<string, string>();
const glyphText = new Map<string, string>();
const PIECES = ['N', 'B', 'R', 'Q', 'K'];
/** Το βιβλίο έχει κείμενο από OCR (σκαναρισμένο, με στρώμα κειμένου): επιπλέον διορθώσεις (`ocrRepair`). Το ορίζει η `parseBook`. */
let ocrText = false;
/**
 * Το OCR διάβασε τα σύμβολα των κομματιών ως άλλα γράμματα (OCR των Windows: ♗ = «A», ♕ = «V», ♘ = «Q»): κάθε γράμμα
 * κομματιού, και τα K/Q/R/B/N, είναι «σκουπίδι» που μαθαίνει το βιβλίο. Το ορίζει η `parseBook` (`isLetterCipher`).
 */
let letterCipher = false;
/**
 * Το κείμενο διαβάστηκε από την εικόνα της σελίδας με σύμβολα κομματιών από το σχήμα (χαρακτήρες U+E000–U+E0FF): ένα
 * σύμβολο μπορεί να έχει χαθεί εντελώς («19 e2» = 19.♕e2) και μια ομάδα σχήματος να έχει μέσα και άλλο κομμάτι.
 */
let imageText = false;
/**
 * Το βιβλίο γράφει τις αιχμαλωσίες των πιονιών χωρίς «x» («3.d4 cd4 4.♘d4», «13.cd5 ed5»). Το ορίζει η `parseBook`
 * (`hasShortCaptures`)· τότε «cd4» = cxd4.
 */
let shortCaptures = false;
const SHORT_CAPTURE_RE = /(^|[\s(.…,;:[])([a-h])([a-h][1-8])(?![a-z\d])/g;
const adjacentFiles = (f: string, to: string): boolean => Math.abs(f.charCodeAt(0) - to.charCodeAt(0)) === 1;

/** Αιχμαλωσίες πιονιών χωρίς «x»: τουλάχιστον 20, και τριπλάσιες από όσες γράφονται με «x». */
function hasShortCaptures(paragraphs: BookParagraph[]): boolean {
  let short = 0;
  let full = 0;
  for (const p of paragraphs) {
    for (const m of p.text.matchAll(SHORT_CAPTURE_RE)) if (adjacentFiles(m[2], m[3])) short++;
    full += p.text.match(/(?:^|[\s(.…,;:[])[a-h]x[a-h][1-8]/g)?.length ?? 0;
  }
  return short >= 20 && short >= 3 * full;
}
/** σύμβολο κομματιού από εικόνα που δεν ανήκει σε ομάδα σχήματος (όπως το `FIG_LONE` του αναγνώστη εικόνας) */
const IMG_LONE = '';
const IMG_SAN_SRC = String.raw`(?:(?:[-]|[KQRBN])?[a-h]?[1-8]?x?[a-h][1-8]|[0O]-[0O](?:-[0O])?)[+#]?[!?]{0,2}`;
/** δύο κινήσεις κολλημένες, χωρίς το κενό ανάμεσα («21.g5hg5», «24.h5♗f6», «1.e4c52.♘f3», και χωρίς τελεία «1 e4e5») */
const IDEO_DOTS_RE = new RegExp(String.raw`(^|[\s(])(\d{1,3}) ?[㐀-鿿]{2,3} ?(?=${IMG_SAN_SRC})`, 'g');
const GLUED_RE = new RegExp(String.raw`((?:^|[\s(])\d{1,3}(?:\.\s?|\s)${IMG_SAN_SRC})(?=${IMG_SAN_SRC}(?:\d{1,3}\.|[\s,;:.)]|$))`, 'g');

/**
 * Κείμενο από την εικόνα της σελίδας (αναγνώστης εικόνας): κινήσεις κολλημένες χωρίς κενό, και χαρακτήρες άλλης γραφής
 * εκεί όπου το μοντέλο δεν ήξερε το σύμβολο («9.盒c4» = σύμβολο κομματιού, «d5!干» = ∓, «土» = ±).
 */
function imageRepair(s: string): string {
  if (/[㐀-鿿！？]/.test(s)) {
    s = s
      // τα αποσιωπητικά του Μαύρου διαβάστηκαν ως ιδεογράμματα ανάμεσα στον αριθμό και την κίνηση («4 香香 ♘fd7», «50 串串串
      // ♔c5»): έμενε κείμενο και έμπαινε μια κίνηση του σχολίου στη θέση της
      .replace(IDEO_DOTS_RE, '$1$2 … ')
      .replace(/！/g, '!')
      .replace(/？/g, '?')
      .replace(/[㐀-鿿](?=[a-h]?[1-8]?x?[a-h][1-8](?![a-z\d]))/g, IMG_LONE)
      .replace(/([a-h][1-8]|[!?+#]|0-0)\s?([㐀-鿿])/g, (_m, pre: string, c: string) => pre + (/[土士王主]/.test(c) ? '±' : /[干年平千汗元午牛]/.test(c) ? '∓' : ''));
  }
  s = s
    // «22..♘xe4»: η μία από τις τρεις τελείες της κίνησης του Μαύρου χάθηκε
    .replace(/(^|[\s(])(\d{1,3})\.\.(?=[a-hKQRBN-0O])/g, '$1$2...')
    // «23...♖f52 White is still better», «14.cd4? f57 15.e5»: σύμβολο αξιολόγησης που διαβάστηκε ως ψηφίο κολλημένο στην
    // κίνηση (όχι αριθμός επόμενης κίνησης: ακολουθεί λέξη, αριθμός με τελεία, ή τελειώνουν εκεί τα έντονα)
    .replace(/((?:[-]|[KQRBN])?[a-h]?[1-8]?x?[a-h][1-8][+#]?[!?]{0,2})[2-9](?=\s+(?:\p{Lu}\p{Ll}|\d{1,3}\.)|\s*$)/gu, '$1')
    // «18.xh7†!!»: το σύμβολο του κομματιού χάθηκε όλο· αιχμαλωσία από κομμάτι με άγνωστο σύμβολο (το κομμάτι από τη
    // νομιμότητα), αλλιώς η λύση της άσκησης χανόταν από την πρώτη κίνηση
    .replace(/(^|[\s(.…])(?=x[a-h][1-8](?![a-z\d]))/g, '$1' + IMG_LONE)
    // «22f3», «23♕xd1» (βιβλία με αριθμούς χωρίς τελεία): ο αριθμός κόλλησε στην κίνηση
    .replace(/(^|[\s(])(\d{1,3})(?=(?:[a-h]x?[a-h]?[1-8]|[-][a-h1-8]?x?[a-h][1-8])(?![a-z\d]))/g, '$1$2 ');
  // «6...♔c57 ♘f6! ♔d48 ♘e8!» (αριθμοί χωρίς τελεία): το τετράγωνο κόλλησε στον αριθμό της επόμενης κίνησης· μόνο
  // όταν είναι ο επόμενος από τον πιο πρόσφατο αριθμό (μία διόρθωση κάθε φορά: η επόμενη βλέπει τον αριθμό που χώρισε)
  for (let k = 0; k < 12; k++) {
    let done = false;
    const next = s.replace(/([a-h][1-8][+#]?[!?]{0,2})(\d{1,3})(?=\s?(?:[-KQRBN]|[a-h]x?[a-h]?[1-8]|O-O|0-0))/g, (m, sq: string, num: string, off: number) => {
      if (done) return m;
      const nums = [...s.slice(Math.max(0, off - 80), off + sq.length).matchAll(/(?:^|[\s(])(\d{1,3})(?=\s?(?:\.{2,3})?\s?[-KQRBNa-hO0])/g)];
      if (!nums.length || Number(num) !== Number(nums[nums.length - 1][1]) + 1) return m;
      done = true;
      return `${sq} ${num}`;
    });
    if (next === s) break;
    s = next;
  }
  // (πρώτα το τετράγωνο που κόλλησε στον αριθμό της επόμενης κίνησης, «c52.♘f3»: αλλιώς η «2.♘f3e6» δεν αρχίζει λέξη)
  // (και το ροκέ που κόλλησε στο τετράγωνο, «4.♗g20–0 5.0–0»: η σειρά κινήσεων σταματούσε εκεί· όχι
  // «♗a70-019.f», όπου ακολουθεί ψηφίο)
  return s.replace(/([a-h][1-8][+#]?[!?]{0,2})(?=\d{1,3}\.\s?(?:[-KQRBNa-h]|[0O]-[0O]))/g, '$1 ')
    .replace(/([a-h][1-8][+#]?[!?]{0,2})(?=[0O][-–][0O](?:\s|$))/g, '$1 ')
    .replace(GLUED_RE, '$1 ');
}

/** Το βιβλίο δεν έχει καθόλου γραμματοσειρά κύριας γραμμής (π.χ. OCR των Windows): ορίζεται από την `parseBook`. */
let boldless = false;
const LETTER_RE = /(^|[\s([.…,;])([A-Z#*ÄÉÖÜovmz]\)?)(?=[a-h]?[1-8]?x?[a-h](?:[1-8]|[lI])(?![a-z\d]))/g;
/** Ανά βιβλίο: τα κομμάτια κάθε «σκουπιδιού» (κατά το κείμενό του), με σειρά από τις ψήφους της πρώτης ανάγνωσης. */
let glyphPieces: Map<string, string[]> | null = null;
/** Ψήφοι στην πρώτη ανάγνωση: «σκουπίδι» → κομμάτι → κινήσεις όπου ήταν το μόνο νόμιμο. */
let glyphVotes: Map<string, Map<string, number>> | null = null;

/**
 * OCR: τα σύμβολα των κομματιών βγαίνουν με πολλές μορφές («lLl», «ttl», «ti:l», «c\Ll» = ♘· «i.», «.i», «!» = ♗·
 * «l"!:», «E:» = ♖· «W», «Wl'» = ♕· «'it>», «<;t>» = ♔) και το ψηφίο του τετραγώνου ως γράμμα («el», «b 1», «d?»).
 * Κάθε μορφή γίνεται χαρακτήρας ιδιωτικής χρήσης· το κομμάτι το μαθαίνει η `parseBook` από όλο το βιβλίο.
 */
const OCR_GLYPH_RE = /(^|[\s([.…,;])([^\s\d()[\]{}\-–—…][^\s([{\-–—…]{0,4}?)([a-h]?[1-8]?x?[a-h])( ?)([1-8]|[lIS?])(?![a-z\d])/g;
/** «σκουπίδι», κενό, τετράγωνο («ltl f6», «tLl 8h7») */
const OCR_GAP_RE = /(^|[\s([.…,;])([^\s\d()[\]{}\-–—…][^\s\d([{\-–—…]{0,4}) (?=[a-h]?[1-8]?x?[a-h] ?(?:[1-8]|[lIS?])(?![a-z\d]))/g;
/** αριθμός κίνησης με κενά ή γράμματα («1 0.», «l l .», «IO.», «2 l .», «l?.», «1S.») πριν από κίνηση */
const OCR_NUM_RE = /(^|[\s(\[{])([1-9lIS](?: ?[\dlIOoS?]){0,2}) ?(?=\.(?: ?\.){0,2} ?(?:\S{0,6}?[a-h] ?(?:[1-8]|[lIS?](?![a-z\d]))|O-O|0-0))/g;

/**
 * Μορφή που δεν είναι λέξη: με σύμβολο, κεφαλαίο στη μέση («lLl»), χωρίς φωνήεν («ttl»), «W», ή μορφή που έμαθε ήδη
 * το βιβλίο («i» = ♗ στο «ifl»).
 */
const ocrStrong = (g: string): boolean =>
  /[^A-Za-z]/.test(g.replace(/^[.…]+/, '')) || /[a-z][A-Z]/.test(g) || (g.length >= 2 && !/[aeiouyAEIOUY]/.test(g)) || g === 'W' || Boolean(glyphPieces?.has(g));

function ocrGlyph(all: string, pre: string, g: string, body: string, sp: string, d: string): string {
  const real = /\d/.test(d);
  const digit = OCR_DIGIT[d] ?? d;
  // κανονικό γράμμα κομματιού, ή κίνηση πιονιού («exd5»): μόνο το ψηφίο
  if (/^[KQRBN]$/.test(g)) return pre + g + body + digit;
  // «hd5» = ♗xd5: στήλη και τετράγωνο που δεν είναι διπλανά δεν είναι αιχμαλωσία πιονιού, άρα σύμβολο
  const far = /^[a-h]$/.test(g) && /^[a-h]$/.test(body) && Math.abs(g.charCodeAt(0) - body.charCodeAt(0)) !== 1;
  if (/^[a-h]+$/.test(g) && !far) return !sp && (real || /[S?]/.test(d)) ? pre + g + body + digit : all;
  // ψηφία μόνο μέσα σε σύμβολα («\1;!l», «:1!»), όχι κίνηση ή αριθμός («e4.», «12»)
  if (/\d/.test(g) && (/\./.test(g) || !/[:;!\\'"<>@%*]/.test(g))) return all;
  // λέξη («and 6», «the e4»): όχι
  if (!ocrStrong(g) && (!real || sp || g.length > 3)) return all;
  const c = glyphChar(g);
  return c === g ? all : pre + c + body + digit;
}

/** Διορθώσεις σε κείμενο από OCR: σημεία («•»), αριθμοί κινήσεων και χρονιές με κενά, τετράγωνα, αξιολογήσεις. */
function ocrRepair(s: string): string {
  // ο προηγούμενος αριθμός κίνησης: το «S» είναι 5 ή 8 («1S.» μετά το 17 = 18)
  let last = 0;
  return s
    .replace(/[•·]/g, '.')
    // «18J�acl» = 18.♖ac1: η τελεία έγινε «J» (που μένει στη μορφή του συμβόλου)
    .replace(/(^|[\s(])(\d{1,3})J(?=\S)/g, '$1$2.J')
    .replace(/£(?=\s?(?:[1-8]|[lIS?](?![a-z\d])))/g, 'f')
    .replace(OCR_NUM_RE, (m, pre: string, n: string) => {
      // και χωρίς τα πρώτα ψηφία, που μπορεί να είναι η γραμμή της προηγούμενης κίνησης («e 1 18.gxf4»)
      const parts = n.split(' ');
      const alts: Array<{ num: number; skip: number }> = [];
      for (let k = 0; k < parts.length; k++) {
        const d = parts.slice(k).join('').replace(/[lI]/g, '1').replace(/[Oo]/g, '0').replace(/\?/g, '7');
        for (const x of [d.replace(/S/g, '5'), d.replace(/S/g, '8')]) if (/^[1-9]\d{0,2}$/.test(x)) alts.push({ num: Number(x), skip: k });
      }
      if (!alts.length) return m;
      const fits = (x: { num: number }) => x.num === last || x.num === last + 1;
      const a = alts.find((x) => !x.skip && fits(x)) ?? (last ? alts.find((x) => x.skip && fits(x)) : undefined) ?? alts[0];
      last = a.num;
      return pre + (a.skip ? parts.slice(0, a.skip).join(' ') + ' ' : '') + a.num;
    })
    .replace(/\.(?: ?\.){2}/g, '...')
    // «8.. J'le8»: δύο τελείες και κενό = μαύρη κίνηση («14..if4» χωρίς κενό είναι λευκή με «.i» = ♗)
    .replace(/(\d) ?\.\. (?=[^\s.])/g, '$1...')
    .replace(/(^|[\s(,])(1 ?[89]|2 ?0) ?(\d) ?(\d)(?=[\s.,;)]|$)/g, (m, pre: string, a: string, b: string, c: string) => (/ /.test(m.slice(pre.length)) ? pre + a.replace(' ', '') + b + c : m))
    // αξιολογήσεις κολλημένες στην κίνηση: «00»/«oo» = ∞, «;!;» = ±, «t» = ⩱· «�» σβήνει
    .replace(/([a-h](?:[1-8]|[S?])[+#]?[!?]{0,2})(00|oo|;!;|t|�)(?=$|[\s,;.)\]])/g, (_m, mv: string, e: string) => mv + ({ '00': '∞', oo: '∞', ';!;': '±', t: '⩱' }[e] ?? ''))
    // πιόνι: «eS» = e5, «b?» = b7
    .replace(/(^|[\s(.…])([a-h](?:x[a-h])?)([S?])(?=$|[\s,;:.!?)\]=+±∓⩱⩲∞#])/g, (_m, pre: string, sq: string, d: string) => pre + sq + OCR_DIGIT[d])
    .replace(OCR_GAP_RE, (m, pre: string, g: string) => (ocrStrong(g) && !/^[KQRBN]$/.test(g) ? pre + g : m));
}
/**
 * Περιγραφική σημειογραφία («P-K4», βλ. descriptive.ts): κάθε κίνηση γίνεται χαρακτήρας ιδιωτικής χρήσης (U+E800…)
 * με ψεύτικο τετράγωνο («a1»), ώστε να περνά από την ανάγνωση σαν κίνηση· η `sanIn` τη λύνει στη θέση.
 */
const DESC_RE = new RegExp(String.raw`(^|[\s(\[.…,;:])(${DESC_SRC})(\s?(?:dis\.?\s?|dbl\.?\s?)?ch(?![a-z])|\+)?(?=$|[\s,;:.!?)\]])`, 'g');
const descCode = new Map<string, string>();
const descText = new Map<string, string>();

function descChar(t: string): string | null {
  let c = descCode.get(t);
  if (!c) {
    if (descCode.size >= 0x800) return null;
    c = String.fromCharCode(0xe800 + descCode.size);
    descCode.set(t, c);
    descText.set(c, t);
  }
  return c;
}

function glyphChar(g: string): string {
  let c = glyphCode.get(g);
  if (!c) {
    // (ως U+E7FF· από το U+E800 είναι η περιγραφική)
    if (glyphCode.size >= 0x700) return g;
    c = String.fromCharCode(0xe100 + glyphCode.size);
    glyphCode.set(g, c);
    glyphText.set(c, g);
  }
  return c;
}

/** Το κομμάτι από τη μορφή των «σκουπιδιών» (παλιές γραμματοσειρές figurine), όταν μοιάζει γνωστή. */
function glyphHint(g: string): string | null {
  if (/^[KQRBN]\)?$/.test(g)) return g[0];
  if (/'i[i*r]|i\*'|^W/.test(g)) return 'Q';
  if (/'it|@/.test(g)) return 'K';
  if (/[:%]/.test(g) && !/J/.test(g)) return 'R';
  if (/\./.test(g)) return 'B';
  if (/[JDL]/.test(g)) return 'N';
  return null;
}

/** Το κομμάτι ενός «σκουπιδιού» για το κείμενο: αυτό που έμαθε το βιβλίο (αν είναι σαφές), αλλιώς της μορφής του. */
function glyphLetter(g: string): string | null {
  return learnedOf(g)?.[0] ?? glyphHint(g);
}

/** Ό,τι έμαθε το βιβλίο για μια μορφή· για πεζό γράμμα του OCR («v»), αν δεν έχει δικές του ψήφους, του κεφαλαίου («V»). */
function learnedOf(g: string): string[] | undefined {
  return glyphPieces?.get(g) ?? (g.length === 1 && g !== g.toUpperCase() ? glyphPieces?.get(g.toUpperCase()) : undefined);
}

const SHOWN_RE = new RegExp(PUA_RE.source + '(?:a1)?', 'g');
/** Για το κείμενο (σχόλια): το σύμβολο ξανά γράμμα, ή όπως ήταν. */
const glyphShown = (s: string): string =>
  s.replace(SHOWN_RE, (m) => {
    const desc = descText.get(m[0]);
    if (desc) return desc;
    const g = glyphText.get(m[0]) ?? '';
    // (σύμβολο από εικόνα που το βιβλίο δεν έμαθε: «?», όχι ο εσωτερικός χαρακτήρας)
    return (glyphLetter(g) ?? (/^[-]$/.test(g) ? '?' : g)) + m.slice(1);
  });

/**
 * `parseSan`, και για κομμάτι με άγνωστο σύμβολο: τα κομμάτια που έμαθε το βιβλίο για τη μορφή του, αλλιώς το κομμάτι
 * της μορφής και μετά όποιο κάνει την κίνηση νόμιμη.
 */
/** πόσες κινήσεις παραπάνω πρέπει να παίζονται για να κερδίσει κομμάτι που το βιβλίο δεν έμαθε για το σύμβολο */
const PICK_MARGIN = 3;
function sanIn(pos: Position, san: string, ahead: string[] = [], far?: () => string[]): number {
  const ph = PUA_RE.exec(san)?.[0];
  // ανάμεσα σε πολλές υποψήφιες: αυτή που κρατά νόμιμες τις περισσότερες από τις κινήσεις που ακολουθούν (η πρώτη σε ισοπαλία)
  // (`known`: τα κομμάτια που έμαθε το βιβλίο για το σύμβολο. Ένα άλλο κομμάτι κερδίζει μόνο όταν με αυτό παίζονται
  // καθαρά περισσότερες κινήσεις: αλλιώς ένα άσχετο λάθος πιο κάτω στη γραμμή έκανε τον αξιωματικό βασίλισσα)
  const pick = (cands: number[], known?: string[]): number => {
    if (cands.length < 2) return cands[0] ?? 0;
    const seq = far ? far() : ahead;
    if (!seq.length) return cands[0];
    let best = cands[0];
    let most = -1;
    let bestKnown = 0;
    let mostKnown = -1;
    for (const c of cands) {
      const q = pos.clone();
      q.makeMove(c);
      const k = playable(q, seq);
      if (k > most) {
        best = c;
        most = k;
      }
      if (known?.includes(pos.san(c)[0]) && k > mostKnown) {
        bestKnown = c;
        mostKnown = k;
      }
    }
    return bestKnown && most < mostKnown + PICK_MARGIN ? bestKnown : best;
  };
  if (!ph && (ocrText || imageText) && /^[a-h]?[1-8]?[a-h][1-8][+#]?$/.test(san)) {
    // OCR: σύμβολο κομματιού που χάθηκε εντελώς («6 e2» = 6.♗e2, «13 b1» = 13.♖b1): η κίνηση πιονιού δεν γίνεται,
    // (μόνο σε κείμενο από OCR: στα ψηφιακά με σύμβολα-γράμματα έβαζε λάθος κινήσεις στο δέντρο)
    // άρα κάποιο κομμάτι πάει εκεί (αν χωρούν πολλά, αυτό που κρατά νόμιμες τις κινήσεις που ακολουθούν)
    try {
      const m = pos.parseSan(san);
      if (m) return m;
    } catch {
      // όχι πιόνι
    }
    const cands: number[] = [];
    for (const p of PIECES) {
      try {
        const m = pos.parseSan(p + san);
        if (m && !cands.includes(m)) cands.push(m);
      } catch {
        // όχι αυτό το κομμάτι
      }
    }
    if (!cands.length) return pos.parseSan(san);
    return pick(cands);
  }
  if (!ph) return imageText && far ? pick(sameSan(pos, san)) : pos.parseSan(san);
  const desc = descText.get(ph);
  if (desc) return descriptiveMove(pos, desc);
  const g = glyphText.get(ph) ?? '';
  const hint = glyphHint(g);
  const learned = learnedOf(g);
  // (σε κείμενο από OCR τα σύμβολα μπερδεύονται κάποτε: μετά τα κομμάτια που έμαθε το βιβλίο, και τα υπόλοιπα)
  const order = learned ? (ocrText || letterCipher || imageText ? [...learned, ...PIECES.filter((p) => !learned.includes(p))] : learned) : hint ? [hint, ...PIECES] : PIECES;
  const all = (s: string) => {
    const out: number[] = [];
    for (const p of order) {
      try {
        for (const m of imageText && far ? sameSan(pos, s.replace(ph, p)) : [pos.parseSan(s.replace(ph, p))]) if (m && !out.includes(m)) out.push(m);
      } catch {
        // άλλο κομμάτι
      }
    }
    return out;
  };
  let cands = all(san);
  // OCR: γράμμα του συμβόλου που διαβάστηκε ως στήλη («Wfd1» = ♕d1)
  if (!cands.length && ocrText && /^.[a-h1-8]x?[a-h][1-8]/.test(san)) cands = all(ph + san.slice(2));
  // «x»: πρώτα όσα κομμάτια παίρνουν πράγματι κάτι
  if (cands.length > 1 && san.includes('x')) {
    const caps = cands.filter((m) => pos.san(m).includes('x'));
    if (caps.length) cands = caps;
  }
  // χωρούν πολλά κομμάτια (π.χ. «�» για ♘ και ♕): αυτό που κρατά νόμιμες τις κινήσεις που ακολουθούν
  return pick(cands, imageText ? learned : undefined);
}

/**
 * Όλες οι νόμιμες κινήσεις που γράφονται `san` όταν το βιβλίο δεν ξεχωρίζει το κομμάτι («♘b1» με ίππους στο a3 και στο
 * c3: το κείμενο από εικόνα χάνει κάποτε το γράμμα της στήλης)· το `parseSan` κρατά την πρώτη.
 */
function sameSan(pos: Position, san: string): number[] {
  const first = pos.parseSan(san);
  if (!first || !/^[KQRBN]x?[a-h][1-8]/.test(san)) return first ? [first] : [];
  const out = [first];
  for (const c of 'abcdefgh12345678') {
    try {
      const m = pos.parseSan(san[0] + c + san.slice(1));
      if (m && !out.includes(m)) out.push(m);
    } catch {
      // κανένα τέτοιο κομμάτι εκεί
    }
  }
  return out;
}

/**
 * Πόσες από τις κινήσεις `seq` παίζονται η μία μετά την άλλη από τη θέση `pos` (που αλλάζει)· με `strict`, κίνηση με «x»
 * πρέπει να είναι αιχμαλωσία (το `parseSan` δέχεται και «♗xc3» για «♗c3»: για τη χαμένη κίνηση θα έκανε ίσες κινήσεις που
 * δεν είναι, π.χ. 2.g3 με 2.♘c3 πριν από «7…♗xc3»).
 */
function playable(pos: Position, seq: string[], strict = false): number {
  let n = 0;
  for (const s of seq) {
    let m = 0;
    try {
      m = sanIn(pos, s);
      if (strict && m && s.includes('x') && !pos.san(m).includes('x')) m = 0;
    } catch {
      m = 0;
    }
    if (!m) break;
    pos.makeMove(m);
    n++;
  }
  return n;
}

/** Πρώτη ανάγνωση: ψήφος για το κομμάτι ενός «σκουπιδιού», όταν μόνο ένα κομμάτι κάνει την κίνηση νόμιμη εκεί. */
function voteGlyph(fen: string, san: string): void {
  const ph = PUA_RE.exec(san)?.[0];
  if (!glyphVotes || !ph || descText.has(ph)) return;
  const g = glyphText.get(ph);
  if (!g) return;
  const pos = Position.fromFen(fen);
  const ok = PIECES.filter((p) => {
    try {
      return pos.parseSan(san.replace(ph, p)) !== 0;
    } catch {
      return false;
    }
  });
  if (ok.length !== 1) return;
  const v = glyphVotes.get(g) ?? new Map<string, number>();
  v.set(ok[0], (v.get(ok[0]) ?? 0) + 1);
  glyphVotes.set(g, v);
}

/** Από τις ψήφους: για κάθε μορφή τα κομμάτια με ≥ 10% των ψήφων, το πιο συχνό πρώτο (χρειάζονται ≥ 2 ψήφοι). */
function learnGlyphs(votes: Map<string, Map<string, number>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [g, v] of votes) {
    const total = [...v.values()].reduce((a, b) => a + b, 0);
    if (total < 2) continue;
    out.set(g, [...v].filter(([, n]) => n >= total * 0.1).sort((a, b) => b[1] - a[1]).map(([p]) => p));
  }
  return out;
}

/** Γράμματα κομματιών που δεν είναι K/Q/R/B/N πριν από τετράγωνο («Ac4», «Vh5»): ≥ 30 και ≥ 15% όλων. */
function isLetterCipher(paragraphs: BookParagraph[]): boolean {
  let foreign = 0;
  let real = 0;
  for (const p of paragraphs) for (const m of p.text.matchAll(LETTER_RE)) if (/^[KQRBN]$/.test(m[2])) real++;
  else foreign++;
  return foreign >= 30 && foreign >= (foreign + real) * 0.15;
}

/** Κείμενο από OCR: πολλοί αριθμοί κινήσεων με κενό ή γράμμα («1 0.», «l l .», «IO.»). */
function isOcrText(paragraphs: BookParagraph[]): boolean {
  let n = 0;
  for (const p of paragraphs) n += p.text.match(/(?:^|[\s(])(?:1 \d|[lI] ?[lI\d]|\d ?[lIO]) ?\.\s?\S/g)?.length ?? 0;
  return n >= 20;
}

/**
 * Πόσες από τις κινήσεις που ακολουθούν ένα διάγραμμα παίζονται στη θέση του, η μία μετά την άλλη (ως 6· σταματά σε
 * αριθμό που δεν συνεχίζει, δηλαδή σε βαριάντα). Για τη διόρθωση της αναγνώρισης των διαγραμμάτων-εικόνων.
 */
export function movesFit(placement: string, turn: 'w' | 'b' | null, moves: ProbeMove[]): number {
  const first = moves[0];
  if (!first) return 0;
  const plyOf = (m: ProbeMove) => (m.num === null ? null : (m.num - 1) * 2 + (m.black ? 1 : 0));
  const sides: Array<'w' | 'b'> = first.num !== null ? [first.black ? 'b' : 'w'] : turn ? [turn] : ['w', 'b'];
  let best = 0;
  for (const side of sides) {
    let pos: Position;
    try {
      pos = Position.fromFen(diagramFen(placement, side, first.num ?? 1));
    } catch {
      continue;
    }
    let n = 0;
    let ply = plyOf(first);
    for (const m of moves.slice(0, 6)) {
      const at = plyOf(m);
      if (n > 0 && at !== null && ply !== null && at !== ply) break;
      let mv = 0;
      try {
        mv = sanIn(pos, m.san);
      } catch {
        mv = 0;
      }
      if (!mv) break;
      pos.makeMove(mv);
      n++;
      ply = (at ?? ply ?? 0) + 1;
    }
    best = Math.max(best, n);
  }
  return best;
}

/**
 * Πόσες διαφορετικές εναλλακτικές της πρώτης κίνησης (ίδιος αριθμός: «8.♕d2! Much stronger than 8.♘xf6+», «18…♘g6,
 * 18…♖g8 or 18…♗d7») παίζονται στη θέση του διαγράμματος· το `movesFit` σταματά στη δεύτερη, γιατί δεν τη συνεχίζει.
 */
export function altsFit(placement: string, moves: ProbeMove[]): number {
  const first = moves[0];
  if (!first || first.num === null) return 0;
  let pos: Position;
  try {
    pos = Position.fromFen(diagramFen(placement, first.black ? 'b' : 'w', first.num));
  } catch {
    return 0;
  }
  const seen = new Set<number>();
  for (const m of moves.slice(0, 6)) {
    if (m.num !== first.num || m.black !== first.black) continue;
    // (όχι κομμάτι-σύμβολο που δεν αναγνωρίστηκε, OCR: εκεί κάποιο κομμάτι ταιριάζει σχεδόν πάντα, άρα δεν αποδεικνύει τη θέση)
    if (PUA_RE.test(m.san)) return 0;
    try {
      const mv = sanIn(pos.clone(), m.san);
      if (mv) seen.add(mv);
    } catch {
      // δεν παίζεται
    }
  }
  return seen.size;
}

/** Σε πόσα τετράγωνα διαφέρουν δύο θέσεις (πρώτο πεδίο του FEN). */
export function placementDiff(a: string, b: string): number {
  const cells = (p: string) => p.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(Number(d)))).join('');
  const x = cells(a);
  const y = cells(b);
  let d = 0;
  for (let i = 0; i < 64; i++) if (x[i] !== y[i]) d++;
  return d;
}

/**
 * Κανονικοποίηση: figurines (και «σκουπίδια» κομματιών, βλ. GLYPH_RE), αποσιωπητικά (και «•••»), «×», ειδικά κενά,
 * και αριθμοί κινήσεων που το PDF έσπασε στο στενό «1» («1 2 Nf3» → «12 Nf3»).
 */
export function normalizeBookText(s: string): string {
  if (imageText) s = imageRepair(s);
  if (/[KQRBNPt]\s?[—–xX×-]/.test(s)) s = squeezeDescriptive(s);
  if (ocrText) s = ocrRepair(s);
  if (letterCipher) {
    s = s
      // τετράγωνο κολλημένο στον αριθμό της επόμενης κίνησης («♘g412» = ♘g4 12)
      .replace(/([a-h][1-8])(\d{1,3})(?=[\s,;.)]|$)/g, '$1 $2')
      .replace(LETTER_RE, (_m, pre: string, g: string) => pre + glyphChar(g))
      // «l»/«I» για 1 στη γραμμή του τετραγώνου μετά από σύμβολο («Xde l» → «Xdel» = ♖de1)
      .replace(PUA_RANK_RE, (_m, mv: string) => `${mv}1`)
      // αιχμαλωσία χωρίς το σύμβολο («21…xc6»): άγνωστο κομμάτι, από τη νομιμότητα
      .replace(/(^|[\s([.…,;])(?=x[a-h][1-8](?![a-z\d]))/g, (_m, pre: string) => pre + glyphChar(''))
      // σύμβολο που διαβάστηκε ως στήλη («ae7», «axc3»): δεν είναι κίνηση πιονιού αν οι στήλες δεν είναι διπλανές
      .replace(/(^|[\s([.…,;])([a-h])(?=x?([a-h])[1-8](?![a-z\d]))/g, (m, pre: string, f: string, to: string) => (Math.abs(f.charCodeAt(0) - to.charCodeAt(0)) !== 1 ? pre + glyphChar(f) : m));
  }
  if (shortCaptures) s = s.replace(SHORT_CAPTURE_RE, (m, pre: string, f: string, to: string) => (adjacentFiles(f, to) ? `${pre}${f}x${to}` : m));
  return s
    .replace(/[♔♚♕♛♖♜♗♝♘♞♙♟]/g, (c) => FIGURINES[c])
    // σύμβολα από τον αναγνώστη εικόνας: προαγωγή («e8=♕», σχεδόν πάντα βασίλισσα αν το βιβλίο δεν έμαθε τη μορφή),
    // αλλιώς «σκουπίδι» με τη δική του μορφή
    .replace(/([a-h][18])=([-])/g, (_m, sq: string, c: string) => `${sq}=${learnedOf(c)?.[0] ?? 'Q'}`)
    .replace(IMG_FIG_RE, (c) => glyphChar(c))
    // σύμβολα γραμματοσειράς «symbol» (U+F0xx) που δεν είναι κομμάτι πριν από τετράγωνο: κενό διαστήματος ή σημάδι
    .replace(/[-](?![a-h1-8]?x?[a-h][1-8])/g, ' ')
    .replace(/([!?†‡+#]|[a-h][1-8])(?=[¢£¤¥¦][a-h1-8]?x?[a-h][1-8])/g, '$1 ')
    .replace(/([¢£¤¥¦§])\s?(?=[a-h1-8]?x?[a-h][1-8])/g, (_m, c: string) => FIGURINES_CB[c])
    // προαγωγή («31.g8=£†» = g8=Q+)
    .replace(/([a-h][18])=([£¤¥¦])/g, (_m, sq: string, c: string) => `${sq}=${FIGURINES_CB[c]}`)
    // σύμβολο αξιολόγησης χωρισμένο με κενό από την κίνηση («22.Bxf8 ±»): ανήκει στην κίνηση
    .replace(/([a-h][1-8](?:=?[QRBN])?[+#†‡]?[!?]{0,2}|O-O(?:-O)?[+#†‡]?[!?]{0,2})\s+(?=(?:[²³±μµ∞÷]|\+[-–−]|[-–−]\+)(?:\s|$|[.,;)]))/g, '$1')
    // «f632...Ne5»: τετράγωνο κολλημένο στον αριθμό της επόμενης κίνησης
    .replace(/([a-h][1-8][+#†‡!?]*)(?=\d{1,3}\s?\.)/g, '$1 ')
    .replace(/[   ]/g, ' ')
    .replace(/×/g, 'x')
    // ροκέ με μεγάλη παύλα, από εικόνα («10.0–0–0 0–0»: αλλιώς έμενε κείμενο και η γραμμή σταματούσε εκεί)
    .replace(/(^|[\s(\[.…;,])([0O])[–—−]([0O])(?:[–—−]([0O]))?(?![\w–—−])/g, (_m, pre: string, a: string, b: string, c: string | undefined) => `${pre}${a}-${b}${c ? `-${c}` : ''}`)
    // από εικόνα: ο αριθμός κόλλησε στο ροκέ («80-0» = 8 0-0, «200-0»)· όχι πριν από την 4η κίνηση (δεν γίνεται ροκέ)
    .replace(/(^|[\s(])(\d{1,2})(0-0(?:-0)?)(?=[\s,;.!?)]|$)/g, (m, pre: string, n: string, c: string) => (Number(n) >= 4 ? `${pre}${n} ${c}` : m))
    // από εικόνα, βιβλία με γράμματα: «O» αντί για «Q» («19 Of4», «27 Og3+»)
    .replace(/(^|[\s(.…])O(x?[a-h][1-8])(?![a-z\d])/g, '$1Q$2')
    // από εικόνα: κενό ανάμεσα στο γράμμα του κομματιού και στο τετράγωνο μετά από αριθμό («5 N b5 d6»)
    .replace(/((?:^|[\s(])\d{1,3}(?:\s?\.{1,3}|\s?…)?\s?[KQRBN]) (?=x?[a-h][1-8](?![a-z\d]))/g, '$1')
    .replace(/•••|···|\.\.\./g, '…')
    // αποσιωπητικά του Μαύρου με δύο τελείες, από εικόνα («7.. h6», «13..♗d6?!»: αλλιώς η επόμενη κίνηση κολλούσε σε λάθος σημείο)
    .replace(/(^|[\s(\[;,])(\d{1,3})\.\.(?![.…])\s?(?=[KQRBNa-h-¢£¤¥¦]|O-O|0-0)/g, '$1$2…')
    .replace(OCR_RANK_RE, (m, num: string, body: string, d: string) => (/[:.'*@%>�IJDLW]/.test(body) ? num + body + OCR_DIGIT[d] : m))
    // OCR: ο αριθμός κίνησης 1 διαβάστηκε «I» ή «l» («I.Qa4+», «as I ...bxa5»)
    .replace(/(^|[\s([])[Il](?=\s?\.(?:\s?\.\.)?\s?(?:[KQRBN][a-h1-8x]|[a-h][1-8x]|O-O))/g, '$11')
    .replace(ocrText ? OCR_GLYPH_RE : GLYPH_RE, ocrText ? ocrGlyph : (all: string, pre: string, g: string) => (GLYPH_MARK_RE.test(g) ? pre + glyphChar(g) : all))
    // περιγραφική σημειογραφία: χαρακτήρας + «a1» (+ «+» για το «ch»)
    .replace(DESC_RE, (all, pre: string, mv: string, ch: string | undefined) => {
      const c = descChar(mv.replace(/\s+/g, ''));
      return c ? `${pre}${c}a1${ch ? '+' : ''}` : all;
    })
    .replace(/…/g, '...')
    .replace(/(^|[\s(])1 (\d)(?=\s?\.\.\.|\s+(?:[a-h]x?[a-h]?[1-8]|[KQRBN\uE100-\uF8FF]|O-O))/g, (_m, pre: string, d: string) => `${pre}1${d}`);
}

const SAN_SRC = String.raw`(?:O-O-O|O-O|0-0-0|0-0|[KQRBN\uE100-\uF8FF][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h](?:[18]=?[QRBN]|[1-8])|[a-h](?:[18]=?[QRBN]|[1-8]))`;
// το «+» πριν από «/» είναι αξιολόγηση («+/=», όπως γράφουν τα ηλεκτρονικά βιβλία το ⩲), όχι σαχ
const SUFFIX_SRC = String.raw`((?:[#†‡]|\+(?!\/|[-–−](?!\+)))?)((?:!!|\?\?|!\?|\?!|!|\?)?)((?:\+\/[-–−=]|[-–−=]\/\+|\+[-–−]|[-–−]\+|[²³±μµ∞™„‚ƒ©⩲⩱∓□=→↑⇄⇆⊡]|N(?![a-h1-8x]))*)`;
const SAN_RE = new RegExp(SAN_SRC + SUFFIX_SRC, 'y');
const NUM_RE = /(\d{1,3})\s?\.(\s?(?:\.\.\.|\.\.))?\s?/y;
const DOTS_RE = /\.\.\.\s?/y;
/** αριθμοί χωρίς τελεία: αριθμός πριν από κίνηση των λευκών («10 h4») */
const NUM_BARE_RE = /(\d{1,3})\s/y;
/** αριθμοί χωρίς τελεία: αριθμός ενότητας πριν από κίνηση («1.2 4 Qg4»), σημάδι της δομής του βιβλίου και όχι κείμενο */
const SECTION_NUM_RE = /\d{1,2}\.\d{1,3}\s(?=\d{1,3}\s)/y;
/** αριθμοί χωρίς τελεία: ετικέτα βαριάντας μέσα στην παράγραφο («… (b) 4 f4 …», «(a2) 5 ... Nc6») */
const PAREN_LABEL_TOKEN_RE = /\(([A-Za-z]{1,2}\d{0,2})\)\s+(?=\d{1,3}\s)/y;
/** «a) 27...hxg6», «B2) 12.Nf3», «C11) 13.♘g5» μέσα στην παράγραφο (πριν από κίνηση με αριθμό και τελεία) */
const INLINE_LABEL_RE = /([a-hA-H]\d{0,3})\)\s+(?=\d{1,3}\s?\.)/y;

export type Token =
  | { k: 'move'; num: number | null; black: boolean; dots: boolean; san: string; nags: string; raw: string; main: boolean; top?: boolean }
  | { k: 'open'; ch: string; raw: string; main: boolean }
  | { k: 'close'; ch: string; raw: string; main: boolean }
  | { k: 'label'; name: string; raw: string; main: boolean }
  | { k: 'text'; raw: string; main: boolean };

const isBoundaryBefore = (s: string, i: number) => i === 0 || /[\s([{"'“‘,;:]/.test(s[i - 1]);
const isBoundaryAfter = (s: string, j: number) => j >= s.length || !(/[A-Za-z0-9]/.test(s[j]) || (s[j] === '-' && /[A-Za-z0-9]/.test(s[j + 1] ?? '')));

/**
 * Λεκτικές μονάδες μιας παραγράφου: κινήσεις (με αριθμό, με «...» ή σκέτες), αγκύλες και κείμενο.
 * `bare`: το βιβλίο γράφει τους αριθμούς χωρίς τελεία («10 h4»).
 */
export function tokenize(runs: BookRun[], bare = false): Token[] {
  const out: Token[] = [];
  // αριθμός κίνησης που τον έκοψε η αλλαγή γραμματοσειράς («reaction 1» κανονικά + «2.d4!» έντονα = 12.d4!): τα
  // ψηφία πάνε με τη συνέχειά τους
  runs = runs.map((r) => ({ ...r }));
  for (let i = 1; i < runs.length; i++) {
    const m = /(?:^|[\s(\[;,])(\d{1,2})( ?)$/.exec(runs[i - 1].text);
    // (αριθμός χωρίς τελεία, «…exd4 4» + « Nxd4», όταν το πάχος της γραμμής από εικόνα αλλάζει στη μέση,
    // και «…b5 9 » + «Nd5» στα ίδια έντονα)
    const glued = !m?.[2] && /^\d{0,2}\s?(?:\.|…)/.test(runs[i].text);
    if (!m || !(glued || (bare && /^\s?(?:[KQRBN-][a-h1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O|0-0)/.test(runs[i].text) && (m[2] ? runs[i].main === runs[i - 1].main && !/^\s/.test(runs[i].text) : /^\s/.test(runs[i].text))))) continue;
    runs[i - 1].text = runs[i - 1].text.slice(0, runs[i - 1].text.length - m[1].length - m[2].length);
    runs[i].text = m[1] + m[2] + runs[i].text;
  }
  // αριθμός με τελείες μόνος του στο τέλος ενός κομματιού και η κίνηση στην αρχή του επόμενου («[[14...]][[Rc8 15 h4!]]»,
  // κείμενο από εικόνα όπου το πάχος αλλάζει στη μέση, και με κενό «[[9...]][[ Bd7 10]]»): μαζί,
  // αλλιώς η κίνηση έμενε χωρίς αριθμό και η παρτίδα χανόταν
  for (let i = 1; i < runs.length; i++) {
    const m = /(?:^|[\s(\[;,])(\d{1,3}\s?(?:\.\.\.|…|\.))\s?$/.exec(runs[i - 1].text);
    if (!m || !/^\s?(?:[KQRBN-♔-♟][a-h1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O|0-0)/.test(runs[i].text) || (/^\s/.test(runs[i].text) && !/…|\.\.\./.test(m[1]))) continue;
    runs[i - 1].text = runs[i - 1].text.slice(0, m.index + m[0].length - m[0].trimStart().length);
    runs[i].text = m[1] + runs[i].text;
  }
  // ετικέτα στο τέλος ενός κομματιού και η κίνηση της στο επόμενο («and now: C11)» + «13.♘g5» έντονα): μαζί, για να
  // αναγνωριστεί η ετικέτα όπως όταν είναι στο ίδιο κομμάτι
  for (let i = 1; i < runs.length; i++) {
    const m = /(?:^|\s)([a-hA-H]\d{0,3}\))\s*$/.exec(runs[i - 1].text);
    if (!m || !/^\s*\d{1,3}\s?[.…]/.test(runs[i].text)) continue;
    runs[i - 1].text = runs[i - 1].text.slice(0, runs[i - 1].text.length - m[0].length + (m[0].length - m[0].trimStart().length));
    runs[i].text = `${m[1]} ${runs[i].text.trimStart()}`;
  }
  // τα αποσιωπητικά του Μαύρου ως ιδεογράμματα σε δικό τους κομμάτι, ανάμεσα στον αριθμό και την κίνηση («16» έντονο,
  // « 电电申», « ♕f8» έντονο): ο αριθμός και τα αποσιωπητικά μαζί με την κίνηση
  for (let i = 1; i + 1 < runs.length; i++) {
    const m = /(?:^|\s)(\d{1,3})\s*$/.exec(runs[i - 1].text);
    if (!m || !/^\s*[㐀-鿿]{2,3}\s*$/.test(runs[i].text) || !new RegExp(String.raw`^\s*${IMG_SAN_SRC}`).test(runs[i + 1].text)) continue;
    runs[i - 1].text = runs[i - 1].text.slice(0, m.index + (m[0].length - m[0].trimStart().length));
    runs[i].text = '';
    runs[i + 1].text = `${m[1]} … ${runs[i + 1].text.trimStart()}`;
  }
  for (const run of runs) {
    const s = normalizeBookText(run.text);
    const move = (sm: RegExpExecArray, num: number | null, black: boolean, dots: boolean, from: number) =>
      out.push({ k: 'move', num, black, dots, san: sm[0].slice(0, sm[0].length - (sm[1] + sm[2] + sm[3]).length), nags: sm[2] + sm[3], raw: s.slice(from, SAN_RE.lastIndex), main: run.main, ...(run.top ? { top: true } : {}) });
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) {
        let j = i;
        while (j < s.length && /\s/.test(s[j])) j++;
        out.push({ k: 'text', raw: ' ', main: run.main });
        i = j;
        continue;
      }
      if (bare && ch === '(') {
        PAREN_LABEL_TOKEN_RE.lastIndex = i;
        const lm = PAREN_LABEL_TOKEN_RE.exec(s);
        if (lm) {
          out.push({ k: 'label', name: lm[1], raw: lm[0], main: run.main });
          i = PAREN_LABEL_TOKEN_RE.lastIndex;
          continue;
        }
      }
      if ('[('.includes(ch)) {
        out.push({ k: 'open', ch, raw: ch, main: run.main });
        i++;
        continue;
      }
      if ('])'.includes(ch)) {
        out.push({ k: 'close', ch, raw: ch, main: run.main });
        i++;
        continue;
      }
      if (isBoundaryBefore(s, i)) {
        if (bare) {
          SECTION_NUM_RE.lastIndex = i;
          if (SECTION_NUM_RE.exec(s)) {
            i = SECTION_NUM_RE.lastIndex;
            continue;
          }
        }
        // «13.Nf3», «13...Nf6», «13. Nf3» (και «13 ... Nf6» χωρίς τελεία)
        NUM_RE.lastIndex = i;
        const nm = NUM_RE.exec(s);
        if (nm) {
          SAN_RE.lastIndex = NUM_RE.lastIndex;
          const sm = SAN_RE.exec(s);
          if (sm && isBoundaryAfter(s, SAN_RE.lastIndex)) {
            move(sm, Number(nm[1]), Boolean(nm[2]), Boolean(nm[2]), i);
            i = SAN_RE.lastIndex;
            continue;
          }
        }
        // «13 Nf3» (αριθμοί χωρίς τελεία)
        if (bare) {
          NUM_BARE_RE.lastIndex = i;
          const nb = NUM_BARE_RE.exec(s);
          if (nb) {
            SAN_RE.lastIndex = NUM_BARE_RE.lastIndex;
            const sm = SAN_RE.exec(s);
            if (sm && isBoundaryAfter(s, SAN_RE.lastIndex)) {
              move(sm, Number(nb[1]), false, false, i);
              i = SAN_RE.lastIndex;
              continue;
            }
          }
        }
        // «...Nf6» (μαύρη κίνηση χωρίς αριθμό)
        DOTS_RE.lastIndex = i;
        if (DOTS_RE.exec(s)) {
          SAN_RE.lastIndex = DOTS_RE.lastIndex;
          const sm = SAN_RE.exec(s);
          if (sm && isBoundaryAfter(s, SAN_RE.lastIndex)) {
            move(sm, null, true, true, i);
            i = SAN_RE.lastIndex;
            continue;
          }
        }
        SAN_RE.lastIndex = i;
        const sm = SAN_RE.exec(s);
        if (sm && isBoundaryAfter(s, SAN_RE.lastIndex)) {
          move(sm, null, false, false, i);
          i = SAN_RE.lastIndex;
          continue;
        }
        // ετικέτα μέσα στην παράγραφο («White has three options: a) 18.♗h6? … b) 18.♗e5!»)· όχι «(a)», που είναι αγκύλη
        if (!bare && (i === 0 || /\s/.test(s[i - 1]))) {
          INLINE_LABEL_RE.lastIndex = i;
          const lm = INLINE_LABEL_RE.exec(s);
          if (lm) {
            out.push({ k: 'label', name: lm[1], raw: lm[0], main: run.main });
            i = INLINE_LABEL_RE.lastIndex;
            continue;
          }
        }
      }
      // κείμενο ως το επόμενο κενό ή αγκύλη
      let j = i + 1;
      while (j < s.length && !/[\s[\]()]/.test(s[j])) j++;
      out.push({ k: 'text', raw: s.slice(i, j), main: run.main });
      i = j;
    }
  }
  // το κείμενο (σχόλια, κινήσεις που δεν ταιριάζουν) με γράμματα αντί για τα σύμβολα· η `san` τα κρατά
  // σύμβολο αξιολόγησης χωριστά από την κίνηση (κενό ή αλλαγή γραμμής: «15.♕xa7» / «±»): της κίνησης, όχι κείμενο
  for (let i = 0; i + 2 < out.length; i++) {
    const t = out[i];
    const sp = out[i + 1];
    const ev = out[i + 2];
    if (t.k !== 'move' || sp.k !== 'text' || sp.raw !== ' ' || ev.k !== 'text') continue;
    const m = /^((?:[±∓⩲⩱∞]|\+[-–−]|[-–−]\+)+)([.,;:)]*)$/.exec(ev.raw);
    if (!m) continue;
    t.nags += m[1];
    t.raw += ` ${m[1]}`;
    out.splice(i + 1, 2, ...(m[2] ? [{ k: 'text' as const, raw: m[2], main: ev.main }] : []));
  }
  for (const t of out) if (PUA_RE.test(t.raw)) t.raw = glyphShown(t.raw);
  return out;
}

const upcomingCache = new WeakMap<BookParagraph, Token[]>();
/** Οι λεκτικές μονάδες μιας από τις επόμενες παραγράφους (μία φορά η καθεμιά: τις κοιτάζει κάθε κίνηση της κύριας γραμμής). */
function upcomingTokens(p: BookParagraph, bare: boolean): Token[] {
  let t = upcomingCache.get(p);
  if (!t) upcomingCache.set(p, (t = tokenize(p.runs, bare)));
  return t;
}

/** Τα σύμβολα μετά από μια κίνηση σε NAG· όσα αφορούν πλευρά (πρωτοβουλία, επίθεση…) ανάλογα με το ποιος έπαιξε. */
export function nagsOf(s: string, white: boolean): number[] {
  const out: number[] = [];
  let rest = s;
  const take = (re: RegExp, n: number | ((w: boolean) => number)) => {
    const m = re.exec(rest);
    if (m && m.index === 0) {
      out.push(typeof n === 'number' ? n : n(white));
      rest = rest.slice(m[0].length);
      return true;
    }
    return false;
  };
  for (let guard = 0; rest && guard < 12; guard++) {
    if (
      take(/^!!/, 3) ||
      take(/^\?\?/, 4) ||
      take(/^!\?/, 5) ||
      take(/^\?!/, 6) ||
      take(/^!/, 1) ||
      take(/^\?/, 2) ||
      take(/^\+\/=/, 14) ||
      take(/^=\/\+/, 15) ||
      take(/^\+\/[-–−]/, 16) ||
      take(/^[-–−]\/\+/, 17) ||
      take(/^\+[-–−]/, 18) ||
      take(/^[-–−]\+/, 19) ||
      take(/^[²⩲]/, 14) ||
      take(/^[³⩱]/, 15) ||
      take(/^±/, 16) ||
      take(/^[μµ∓]/, 17) ||
      take(/^∞/, 13) ||
      take(/^[™□]/, 7) ||
      take(/^=/, 10) ||
      take(/^[„↑]/, (w) => (w ? 36 : 37)) ||
      take(/^[‚→]/, (w) => (w ? 40 : 41)) ||
      take(/^[ƒ⇄⇆]/, (w) => (w ? 132 : 133)) ||
      take(/^⊡/, 22) ||
      take(/^©/, (w) => (w ? 44 : 45)) ||
      take(/^N/, 146)
    )
      continue;
    rest = rest.slice(1);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// δέντρο μιας παρτίδας

const CAPTION_RE = /^\s*(position after|(?:analysis )?diagram|θέση μετά|stellung nach)\b:?/i;
const LABEL_RE = /^\s*([A-Za-z]{1,2}\d{0,2}(?:\.\d{1,2}){0,3})\)\s+/;
/** αριθμοί χωρίς τελεία: ετικέτα σε παρένθεση («(a) 4 b4») και αριθμός ενότητας στην αρχή της παραγράφου («1.41 6 Be2») */
const PAREN_LABEL_RE = /^\s*\(([A-Za-z]{1,2}\d{0,2})\)\s+/;
/** ετικέτα με τελεία πριν από κίνηση με αριθμό («A. 8.a3», «B1. 11.f4»)· μόνο σε κείμενο από εικόνα */
const DOT_LABEL_RE = /^\s*([A-Z]\d{0,2}[a-z]?)\.\s*(?=\d{1,3}\s?\.)/;
const SECTION_RE = /^\s*(\d{1,2}\.\d{1,3})\s+(?=\d{1,3}\s)/;
/** ο τίτλος μιας ενότητας: ο αριθμός της και η πρώτη της κίνηση («1.41 6 Be2», «2.1 6 ... Bd7») */
const SECTION_TITLE_RE = /^\s*(\d{1,2}\.\d{1,3})\s+(\d{1,3}\s*(?:\.\.\.\s*)?[^\s,;:]+)/;
/** κατάλογος ενοτήτων («1.1 4 dxc5 1.2 4 Qg4 1.3 4 Nf3»): δύο τουλάχιστον αριθμοί ενότητας με κίνηση */
const SECTION_GUIDE_RE = /\d{1,2}\.\d{1,3}\s+\d{1,3}\s.*\s\d{1,2}\.\d{1,3}\s+\d{1,3}\s/;

class Builder {
  game: Game;
  mainTip: GameNode;
  /** το τέλος της κύριας γραμμής του κεφαλαίου (κινήσεις 'top'): εκεί συνεχίζει η επόμενη, όχι στην τελευταία ενότητα */
  topTip: GameNode;
  cursor: GameNode;
  /** κόμβοι που έφτιαξε ή πέρασε η κύρια γραμμή */
  private mainNodes = new Set<GameNode>();

  /**
   * Ενότητα χωρίς δικές της κινήσεις: μόνο μία-δύο κινήσεις που αναφέρει η πρόζα (όχι της κύριας γραμμής, χωρίς
   * βαριάντες: «…that will be a Sicilian if you start with 1.e4.»)· γίνονται πάλι κείμενο και το δέντρο αδειάζει.
   */
  foldMentions(): void {
    const line: GameNode[] = [];
    for (let n = this.game.root; n.children.length; n = n.children[0]) {
      if (n.children.length > 1) return;
      line.push(n.children[0]);
    }
    if (!line.length || line.length > 2 || line.some((n) => this.mainNodes.has(n)) || this.exercise || this.fromImage) return;
    if (!this.game.root.fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR ') || !this.game.root.comment.trim()) return;
    const parts = [this.game.root.comment];
    for (const n of line) parts.push(n.preComment, `${Math.ceil(n.ply / 2)}${n.ply % 2 ? '.' : '…'}${n.san}`, n.comment);
    this.game.root.comment = parts.filter((t) => t.trim()).join(' ');
    this.game.root.children = [];
  }
  /** όλοι οι κόμβοι με τη σειρά που φτιάχτηκαν (για την αναζήτηση σε όλο το δέντρο) */
  private order: GameNode[] = [];
  /** οι γραμμές από τις οποίες ξεκίνησαν οι παρεκβάσεις της παραγράφου (εκεί επιστρέφει η ανάγνωση) */
  private contexts: GameNode[] = [];
  /** οι ετικέτες της παρτίδας («A)», «A1)»): η πρώτη τους κίνηση και η θέση όπου έμεινε η ανάγνωσή τους */
  labels = new Map<string, { first: GameNode; end: GameNode }>();
  private activeLabel: string | null = null;
  /** θέσεις που δοκιμάζονται πρώτες για την πρώτη κίνηση μιας παραγράφου με ετικέτα */
  private hints: GameNode[] = [];
  unplaced: BookWarning[] = [];
  /** οι κινήσεις που ακολουθούν στη σειρά αυτήν που τοποθετείται (για σύμβολο που χωρά σε πολλά κομμάτια) */
  private ahead: string[] = [];
  /** κείμενο από εικόνα: η κύρια γραμμή πιο μπροστά (πέρα από σχόλια), για να διαλέξει η `sanIn` ανάμεσα σε υποψήφιες */
  private far: (() => string[]) | undefined;
  /** η προηγούμενη παράγραφος τελείωσε με κινήσεις (βιβλία χωρίς τελεία / OCR: η επόμενη μπορεί να τις συνεχίζει) */
  private tail = false;
  /** οι επόμενες παράγραφοι της ίδιας ενότητας (για τη `lineAhead`)· τις ορίζει η `parseBook` */
  upcoming: BookParagraph[] = [];
  /** οι θέσεις των διαγραμμάτων της σελίδας και της επόμενης (για χαμένη κίνηση με ίσες υποψήφιες) */
  pageBoards: string[] = [];
  /** αριθμοί κινήσεων χωρίς τελεία */
  private readonly bare: boolean;
  /**
   * αριθμοί χωρίς τελεία: η εναλλακτική όπου έμεινε η σημείωση μιας παραγράφου της κύριας γραμμής, και αν η παράγραφος
   * τελείωσε με «:». Η επόμενη παράγραφος συνεχίζει από εκεί αν ξεκινά με μικρό γράμμα ή μετά από «:».
   */
  private resume: { at: GameNode; colon: boolean } | null = null;
  /** αριθμοί χωρίς τελεία: οι ενότητες του κεφαλαίου («1.41 6 Be2») και η πρώτη τους κίνηση, με τη σειρά του βιβλίου */
  sections: Array<{ title: string; node: GameNode }> = [];
  /** οι ετικέτες στην αρχή παραγράφου («A», «A21», «B1»: ενότητες, όχι αναφορές της πρόζας «A) 6.♘f3 and B) 6.♗g5») */
  labelNames = new Set<string>();
  /** οι προηγούμενες παρτίδες του βιβλίου, η πιο πρόσφατη πρώτη (για ενότητα που αρχίζει από τη μέση, `seedLine`) */
  seeds: Game[] = [];
  /** η ημικίνηση της αρχικής θέσης (παρτίδα από διάγραμμα): οι αριθμοί κινήσεων του κειμένου μετρούν από εκεί */
  private base = 0;
  /** παρτίδα από διάγραμμα: ποιος παίζει και ο αριθμός κίνησης φαίνονται στην πρώτη κίνηση του κειμένου */
  private lazy: { placement: string; turn: 'w' | 'b' | null } | null = null;
  /** άσκηση: μπαίνει στις παρτίδες και χωρίς λύση */
  exercise = false;
  /** διάγραμμα-εικόνα στην αρχή: οι κινήσεις του κειμένου που ακολουθούν (για τον έλεγχο της θέσης του) */
  probe: { id: number; turn: 'w' | 'b' | null; moves: ProbeMove[] } | null = null;
  /** η αρχική θέση είναι διάγραμμα-εικόνα (αναγνώριση, όχι σίγουρη) */
  fromImage = false;
  /** η τελευταία ημικίνηση εναλλακτικής με έντονα που έγινε βαριάντα στο τέλος της προηγούμενης παραγράφου (`demoteAlternatives`) */
  private altRun: number | null = null;
  /** εισαγωγή κεφαλαίου ή ενότητα από επικεφαλίδα: χωρίς κινήσεις γίνεται σχόλιο της επόμενης παρτίδας (όχι παρτίδα που δεν διαβάστηκε) */
  section = false;
  /** οι κινήσεις που ακολουθούν στη σειρά την κίνηση που τοποθετείται (για να διαλέξει η `where` θέση) */
  seq: string[] = [];

  constructor(headers: Record<string, string>, bare = false) {
    this.bare = bare;
    this.game = new Game();
    Object.assign(this.game.headers, headers);
    this.mainTip = this.game.root;
    this.topTip = this.game.root;
    this.cursor = this.game.root;
    this.mainNodes.add(this.game.root);
  }

  /** Η παρτίδα ξεκινά από τη θέση ενός διαγράμματος (όσο δεν έχει κινήσεις). */
  startFrom(placement: string, turn: 'w' | 'b' | null): boolean {
    // θέση που δεν στέκει (π.χ. διάγραμμα-εικόνα χωρίς βασιλιά): η παρτίδα μένει στην αρχική θέση
    try {
      Position.fromFen(diagramFen(placement, turn ?? 'w'));
    } catch {
      return false;
    }
    this.lazy = { placement, turn };
    this.reset(diagramFen(placement, turn ?? 'w'));
    return true;
  }

  get empty(): boolean {
    return !this.game.root.children.length;
  }

  /**
   * Διάγραμμα μέσα στην παρτίδα που δείχνει θέση μιας βαριάντας της («…60.♘g3† ♔xf4 61.h5! ♔xg3»,
   * διάγραμμα, «62.♔c2! …»): ο πιο πρόσφατος κόμβος με αυτή τη θέση (από τους τελευταίους 400). Η επόμενη παράγραφος
   * συνεχίζει από εκεί αν η πρώτη της κίνηση το επιτρέπει (`resume`). Χωρίς κόμβο: null (νέο απόσπασμα).
   */
  /**
   * Διάγραμμα 1–2 ημικινήσεις μετά από το τέλος της κύριας γραμμής (κινήσεις που χάθηκαν στην ανάγνωση, π.χ. «23...O-O»
   * χωρίς έντονα, και από κάτω η θέση): οι κινήσεις που λείπουν μπαίνουν στην κύρια γραμμή, αν είναι μοναδικές και η
   * επόμενη αριθμημένη κίνηση του κειμένου (`next`) συνεχίζει από εκεί. Αλλιώς η παρτίδα έσπαγε σε απόσπασμα από το
   * διάγραμμα (η υπόλοιπη παρτίδα ως δεύτερη «παρτίδα»).
   */
  bridge(placement: string, turn: 'w' | 'b' | null, next: { num: number; black: boolean } | null): boolean {
    if (!next || this.lazy) return false;
    const tip = this.mainTip;
    const found: number[][] = [];
    const walk = (fen: string, path: number[], depth: number) => {
      const [place, side] = fen.split(' ');
      if (path.length && place === placement && (!turn || side === turn)) {
        found.push(path);
        return;
      }
      if (!depth || found.length > 1) return;
      const pos = Position.fromFen(fen);
      for (const m of pos.legalMoves()) {
        const p2 = Position.fromFen(fen);
        p2.makeMove(m);
        walk(p2.fen(), [...path, m], depth - 1);
      }
    };
    try {
      walk(tip.fen, [], 2);
    } catch {
      return false;
    }
    if (found.length !== 1) return false;
    const path = found[0];
    if ((next.num - 1) * 2 + (next.black ? 2 : 1) - this.base !== tip.ply + path.length + 1) return false;
    let n = tip;
    for (const m of path) n = this.play(n, m, true);
    this.cursor = n;
    return true;
  }

  atPlacement(placement: string, turn: 'w' | 'b' | null): GameNode | null {
    for (let i = this.order.length - 1; i >= Math.max(0, this.order.length - 400); i--) {
      const n = this.order[i];
      const [board, side] = n.fen.split(' ');
      if (board !== placement || (turn && side !== turn)) continue;
      if (!this.mainNodes.has(n)) this.resume = { at: n, colon: false };
      return n;
    }
    return null;
  }

  private reset(fen: string): void {
    const headers = this.game.headers;
    // (το κείμενο πριν από το διάγραμμα, π.χ. η εισαγωγή μιας ενότητας, μένει: χανόταν όλο)
    const lead = this.game.root.children.length ? '' : this.game.root.comment;
    this.game = new Game(fen);
    Object.assign(this.game.headers, headers);
    this.game.root.comment = lead;
    this.mainTip = this.topTip = this.cursor = this.game.root;
    this.mainNodes = new Set([this.game.root]);
    this.order = [];
    this.contexts = [this.game.root];
    const f = fen.split(' ');
    this.base = (Math.max(1, Number(f[5]) || 1) - 1) * 2 + (f[1] === 'b' ? 1 : 0);
  }

  /** Η πρώτη κίνηση μετά από διάγραμμα ορίζει το FEN (ποιος παίζει, αριθμός κίνησης) αν είναι νόμιμη εκεί. */
  private settle(t: Extract<Token, { k: 'move' }>, next?: Extract<Token, { k: 'move' }>): boolean | 'text' {
    const lazy = this.lazy;
    if (!lazy || !this.empty) return false;
    // κίνηση χωρίς αριθμό πριν από την πρώτη με αριθμό: συνήθως κίνηση της πρόζας («Black threatens ...♔c5, so the first
    // move is forced: 1 ♘c7+!» ή όνομα που διαβάστηκε ως κίνηση). Η θέση ορίζεται από την πρώτη κίνηση με
    // αριθμό και αυτή μένει κείμενο· εκτός αν είναι η κίνηση ακριβώς πριν από εκείνη («…♔c5 2 ♔b7»)
    if (t.num === null && next && next.num !== null) {
      try {
        const before = next.black ? next.num : next.num - 1;
        if (before >= 1) {
          const fen = diagramFen(lazy.placement, next.black ? 'w' : 'b', before);
          const pos = Position.fromFen(fen);
          const m = sanIn(pos, t.san);
          if (m) {
            pos.makeMove(m);
            if (sanIn(pos, next.san)) {
              this.reset(fen);
              this.lazy = null;
              return true;
            }
          }
        }
        const fen = diagramFen(lazy.placement, next.black ? 'b' : 'w', next.num);
        if (sanIn(Position.fromFen(fen), next.san)) {
          this.reset(fen);
          this.lazy = null;
          return 'text';
        }
      } catch {
        // η θέση δεν στέκει: όπως πριν
      }
    }
    const sides: Array<'w' | 'b'> = t.num !== null ? [t.black ? 'b' : 'w'] : lazy.turn ? [lazy.turn, lazy.turn === 'w' ? 'b' : 'w'] : ['w', 'b'];
    for (const side of sides) {
      const fen = diagramFen(swapColors(lazy.placement, side), side, t.num ?? 1);
      try {
        if (!sanIn(Position.fromFen(fen), t.san)) continue;
      } catch {
        continue;
      }
      this.reset(fen);
      this.lazy = null;
      return true;
    }
    return false;
  }

  /** Η κίνηση `san` στην ημικίνηση `ply` παίζεται πάνω στη γραμμή του κεφαλαίου (κύρια γραμμή ή γραμμή των ενοτήτων). */
  fitsLine(ply: number, san: string): boolean {
    for (const tip of [this.topTip, this.mainTip]) {
      const n = this.ancestorAt(tip, ply - 1);
      if (n && this.legal(n, san)) return true;
    }
    return false;
  }

  /**
   * Συνεχίζει το κείμενο μετά από ένα διάγραμμα αυτή την παρτίδα, ή ξεκινά από τη θέση του διαγράμματος; Πόσες από τις
   * κινήσεις που ακολουθούν (ως την επικεφαλίδα ή το επόμενο διάγραμμα) παίζονται η μία μετά την άλλη, με συνεχή αρίθμηση,
   * από το τέλος της κύριας γραμμής (ή τον δρομέα), και πόσες από τη θέση του διαγράμματος.
   */
  runsAfter(ps: BookParagraph[], placement: string, turn: 'w' | 'b' | null): { tip: number; diagram: number } {
    const toks: Array<Extract<Token, { k: 'move' }>> = [];
    for (const p of ps) {
      if (p.heading || p.diagram || toks.length >= 12) break;
      for (const t of upcomingTokens(p, this.bare)) if (t.k === 'move' && toks.length < 12) toks.push(t);
    }
    // (όχι σκέτα τετράγωνα χωρίς αριθμό στην αρχή: «a weakness on d5 and pressure on f7» μοιάζουν με κινήσεις πιονιού)
    while (toks.length && toks[0].num === null && /^[a-h][1-8]$/.test(toks[0].san)) toks.shift();
    const abs = (t: Extract<Token, { k: 'move' }>) => (t.num === null ? null : (t.num - 1) * 2 + (t.black ? 2 : 1));
    const run = (fen: string, ply: number | null): number => {
      let pos: Position;
      try {
        pos = Position.fromFen(fen);
      } catch {
        return 0;
      }
      let n = 0;
      for (const t of toks) {
        const at = abs(t);
        if (at !== null && ply !== null && at !== ply + 1) break;
        const m = sanIn(pos, t.san);
        if (!m) break;
        pos.makeMove(m);
        ply = at ?? (ply === null ? null : ply + 1);
        if (++n >= 8) break;
      }
      return n;
    };
    const tip = Math.max(run(this.mainTip.fen, this.mainTip.ply + this.base), run(this.cursor.fen, this.cursor.ply + this.base));
    const side = turn ?? (toks.find((t) => t.num !== null)?.black ? 'b' : 'w');
    return { tip, diagram: run(diagramFen(placement, side), null) };
  }

  /**
   * Συνεχίζει πιο κάτω η κύρια γραμμή από το τέλος της; Η πρώτη κίνηση της κύριας γραμμής (έντονα) με αριθμό στις
   * παραγράφους `ps` (ως την επικεφαλίδα) παίζεται εκεί με τον σωστό αριθμό. Διάγραμμα σε θέση μιας υποβαριάντας που δεν
   * μπήκε στο δέντρο: η βαριάντα πάει σε απόσπασμα και η παρτίδα περιμένει την κύρια γραμμή της («8.c3 d5 … 10.cxd5 ♗f5»,
   * διάγραμμα, «11.♕b5 …», και μετά «9.e3»).
   */
  mainResumes(ps: BookParagraph[]): boolean {
    // (μόνο όταν πριν από αυτήν υπάρχουν άλλες κινήσεις, η βαριάντα του διαγράμματος· αλλιώς είναι η πρώτη κίνηση ενός
    // νέου παραδείγματος από τη θέση του διαγράμματος)
    let before = 0;
    for (const p of ps) {
      if (p.heading) return false;
      if (p.diagram) continue;
      const toks = upcomingTokens(p, this.bare).filter((q): q is Extract<Token, { k: 'move' }> => q.k === 'move');
      const t = toks.find((q) => q.main && q.num !== null);
      if (!t) {
        before += toks.length;
        continue;
      }
      before += toks.indexOf(t);
      const ply = (t.num! - 1) * 2 + (t.black ? 2 : 1) - this.base;
      return before > 0 && ply === this.mainTip.ply + 1 && this.legal(this.mainTip, t.san) > 0;
    }
    return false;
  }

  /** Η πρώτη κίνηση της κύριας γραμμής (έντονα) με αριθμό στην παράγραφο `p` συνεχίζει το τέλος της κύριας γραμμής. */
  continuesMain(p: BookParagraph): boolean {
    const t = upcomingTokens(p, this.bare).find((q): q is Extract<Token, { k: 'move' }> => q.k === 'move' && q.main && q.num !== null);
    if (!t) return false;
    const ply = (t.num! - 1) * 2 + (t.black ? 2 : 1) - this.base;
    return ply === this.mainTip.ply + 1 && this.legal(this.mainTip, t.san) > 0;
  }

  private legal(node: GameNode, san: string): number {
    try {
      return sanIn(Position.fromFen(node.fen), san, this.ahead, this.far);
    } catch {
      return 0;
    }
  }

  /**
   * Ενότητα που αρχίζει από τη μέση, χωρίς τις πρώτες κινήσεις (π.χ. «…after 2 Nf3, which is 2...d5»): η κύρια γραμμή
   * μιας προηγούμενης παρτίδας ως την ημικίνηση πριν από αυτήν, εκεί όπου
   * παίζονται η κίνηση και οι περισσότερες από όσες ακολουθούν (σε ισοπαλία η πιο πρόσφατη παρτίδα).
   */
  private seedLine(ply: number, san: string, seq: string[]): GameNode[] | null {
    let best: GameNode[] | null = null;
    let most = -1;
    for (const g of this.seeds) {
      if (g.root.fen !== this.game.root.fen) continue;
      let n = g.root;
      const path: GameNode[] = [];
      while (n.children[0] && n.ply < ply - 1) path.push((n = n.children[0]));
      if (n.ply !== ply - 1) continue;
      const m = this.legal(n, san);
      if (!m) continue;
      let k = 0;
      try {
        const pos = Position.fromFen(n.fen);
        pos.makeMove(m);
        k = playable(pos, seq, !ocrText && !letterCipher);
      } catch {
        continue;
      }
      if (k > most) [best, most] = [path, k];
    }
    return best;
  }

  /** Είναι νόμιμη η `san` μετά την κίνηση `move` από τον κόμβο `parent`; */
  /** Η μόνη νόμιμη κίνηση από τον `node` μετά την οποία η `san` είναι νόμιμη (αλλιώς 0). */
  /**
   * Χαμένη κίνηση (κακό κείμενο ή OCR που παρέλειψε μια λέξη): η νόμιμη κίνηση μετά από την οποία παίζονται οι
   * περισσότερες από τις επόμενες της σειράς (`san` και `ahead`)· μόνο αν είναι μία και παίζονται τουλάχιστον `min`.
   */
  private gapMove(node: GameNode, san: string, ahead: string[] = [], min = 1): number {
    if (1 + ahead.length < min) return 0;
    let root: Position;
    try {
      root = Position.fromFen(node.fen);
    } catch {
      return 0;
    }
    const seq = [san, ...ahead];
    const scored = root.legalMoves().map((m) => {
      const q = root.clone();
      q.makeMove(m);
      return { m, n: playable(q, seq, true) };
    });
    const most = Math.max(0, ...scored.map((s) => s.n));
    if (most < min) return 0;
    const tops = scored.filter((s) => s.n === most);
    if (tops.length === 1) return tops[0].m;
    // πολλές ίσες (π.χ. όποια κίνηση του ♘f3 πριν από «9…♘d6 10.♗xb7»): αυτή που φτάνει σε θέση ενός διαγράμματος της
    // σελίδας («2b: after 11 ♕f3», ♘ στο e5), αν ταιριάζει σαφώς καλύτερα από τις άλλες
    if (!this.pageBoards.length) return 0;
    // (για κάθε διάγραμμα η πιο κοντινή θέση της σειράς· τα διαγράμματα με σειρά συνάφειας, πρώτα όσα μοιάζουν περισσότερο
    // με τη γραμμή: όπου ισοβαθμούν οι υποψήφιες, αποφασίζει το επόμενο· άσχετα διαγράμματα και λάθη αναγνώρισης δεν μετρούν)
    const near = tops.map(({ m }) => {
      const q = root.clone();
      q.makeMove(m);
      const at = [q.fen().split(' ')[0]];
      for (const s of seq.slice(0, most)) {
        try {
          q.makeMove(sanIn(q, s));
        } catch {
          break;
        }
        at.push(q.fen().split(' ')[0]);
      }
      return { m, per: this.pageBoards.map((b) => Math.min(...at.map((pl) => placementDiff(pl, b)))) };
    });
    const boards = this.pageBoards.map((_, k) => k).sort((a, b) => Math.min(...near.map((x) => x.per[a])) - Math.min(...near.map((x) => x.per[b])));
    for (const k of boards) {
      const by = [...near].sort((a, b) => a.per[k] - b.per[k]);
      // (διάγραμμα πολύ μακριά από κάθε θέση της γραμμής: άλλης παρτίδας)
      if (by[0].per[k] > 16) break;
      // ένα τετράγωνο διαφορά μπορεί να είναι λάθος της αναγνώρισης (♕ για ♘): χρειάζονται δύο
      if (by[1].per[k] - by[0].per[k] >= 2) return by[0].m;
    }
    return 0;
  }

  /**
   * Σειρά κινήσεων που δεν βρήκε θέση: ο πιο πρόσφατος κόμβος του δέντρου (από τους τελευταίους 400, στην ημικίνηση
   * πριν από αυτήν) όπου παίζονται τουλάχιστον 3 από αυτές στη σειρά· εκεί μπαίνει ως βαριάντα, για να παίζεται στη
   * σκακιέρα και όχι μόνο ως κείμενο.
   */
  private anchor(ply: number, seq: string[]): { parent: GameNode; move: number } | null {
    if (seq.length < 3) return null;
    for (let i = this.order.length - 1; i >= Math.max(-1, this.order.length - 400); i--) {
      const n = i < 0 ? this.game.root : this.order[i];
      if (n.ply !== ply - 1) continue;
      let pos: Position;
      try {
        pos = Position.fromFen(n.fen);
      } catch {
        // (θέση διαγράμματος που δεν είναι νόμιμη, π.χ. χωρίς βασιλιά)
        continue;
      }
      let first = 0;
      try {
        first = sanIn(pos.clone(), seq[0]);
      } catch {
        first = 0;
      }
      if (first && playable(pos, seq) >= 3) return { parent: n, move: first };
    }
    return null;
  }

  /** Μετά από λευκή κίνηση `node` (χωρίς σαχ), η λευκή κίνηση `san` παίζεται αν ο μαύρος «πασάρει». */
  private nullFits(node: GameNode, san: string): boolean {
    try {
      const pos = Position.fromFen(node.fen);
      if (pos.turn !== BLACK || node.isRoot || node.move & F_NULL) return false;
      const m = pos.parseSan('--');
      if (!m) return false;
      pos.makeMove(m);
      return sanIn(pos, san) !== 0;
    } catch {
      return false;
    }
  }

  private legalAfter(parent: GameNode, move: number, san: string): boolean {
    try {
      const pos = Position.fromFen(parent.fen);
      pos.makeMove(move);
      return sanIn(pos, san) !== 0;
    } catch {
      return false;
    }
  }

  /** Πιο κάτω στην κύρια γραμμή (κινήσεις της κύριας γραμμής του βιβλίου), στην ημικίνηση `ply`. */
  private mainAt(node: GameNode, ply: number): GameNode | null {
    let n: GameNode | undefined = node;
    while (n && n.ply < ply) n = n.children.find((c) => this.mainNodes.has(c));
    return n && n.ply === ply ? n : null;
  }

  private ancestorAt(node: GameNode, ply: number): GameNode | null {
    let n: GameNode | null = node;
    while (n && n.ply > ply) n = n.parent;
    return n && n.ply === ply ? n : null;
  }

  /** Η κίνηση της κύριας γραμμής του κεφαλαίου στη θέση της, πάνω στη γραμμή αυτή (null: δεν χωρά εκεί). */
  private topSpot(ply: number, san: string): { parent: GameNode; move: number } | null {
    const n = this.ancestorAt(this.topTip, ply - 1);
    const m = n ? this.legal(n, san) : 0;
    return n && m ? { parent: n, move: m } : null;
  }

  /** Ο κόμβος όπου πάει μια κίνηση με αριθμό (ο γονιός της) και η κίνηση· null αν δεν χωράει πουθενά. */
  private where(ply: number, san: string, main: boolean, global = false, back = false, free = false): { parent: GameNode; move: number } | null {
    const tries: GameNode[] = [];
    const add = (n: GameNode | null) => {
      if (n && !tries.includes(n)) tries.push(n);
    };
    if (main) {
      // (ή πιο κάτω στην κύρια γραμμή, όταν η ανάγνωση γύρισε σε προηγούμενη κίνηση της: «1.e4 Normal. … 2.♘c3» μετά
      // από το «1.e4 c5» της αρχής του κεφαλαίου)
      add(this.ancestorAt(this.mainTip, ply - 1) ?? this.mainAt(this.mainTip, ply - 1));
      // (κείμενο από εικόνα: η κίνηση της κύριας γραμμής πριν από αυτήν έχασε τα έντονα: οι συνέχειες του τέλους της με τη
      // σειρά που γράφτηκαν, πριν από τη γραμμή που διαβάζεται τώρα· η πρώτη είναι συνήθως η κίνηση της παρτίδας, οι άλλες
      // εναλλακτικές («7...g6 … 7...♗g4 is the main line…», μετά «8.h3»: όχι 7...♗g4 8.h3)
      if (imageText && this.mainTip.ply === ply - 2) for (const c of this.mainTip.children) add(c);
      // (κι εκεί όπου διαβάζουμε, αν μόνο εκεί παίζεται η σειρά που ακολουθεί: «9.♘xc4⩲ 9.dxc4 is also possible … 9…♖e8
      // 10.♘f1» = η έντονη συνέχεια της εναλλακτικής 9.dxc4)
      if (this.seq.length) {
        if (this.cursor.ply === ply - 1) add(this.cursor);
        add(this.ancestorAt(this.cursor, ply - 1));
      }
    } else {
      for (const h of this.hints) add(this.ancestorAt(h, ply - 1));
      // συνέχεια της γραμμής που διαβάζεται· αλλιώς επιστροφή από παρέκβαση («…after 6...Nxc3 7.bxc3!? … 7.Bxc3»)
      if (this.cursor.ply === ply - 1) add(this.cursor);
      // (όχι μέσα σε αγκύλες: εκεί η πρώτη κίνηση είναι εναλλακτική της γραμμής που διαβάζεται)
      if (back) for (let i = this.contexts.length - 1; i >= 0; i--) if (this.contexts[i].ply === ply - 1) add(this.contexts[i]);
      // η γραμμή που διαβάζεται, οι γραμμές από όπου ξεκίνησαν οι παρεκβάσεις, η κύρια γραμμή
      add(this.ancestorAt(this.cursor, ply - 1));
      for (let i = this.contexts.length - 1; i >= 0; i--) add(this.ancestorAt(this.contexts[i], ply - 1));
      add(this.ancestorAt(this.mainTip, ply - 1));
    }
    // το `parseSan` δέχεται «♘xh4» και για «♘h4»: όπου το «x» δεν ταιριάζει, μόνο αν δεν χωρά αλλού (η βαριάντα
    // «21.♘xh4» πάει εκεί όπου υπάρχει κομμάτι στο h4, όχι στην πιο πρόσφατη γραμμή όπου το h4 είναι άδειο)
    // (το «x» μιας κίνησης που δεν είναι αλλαγή: όχι σε βιβλίο με καθαρό κείμενο, «♗xe6» δεν είναι «♗e6»· εκτός από
    // θέση διαγράμματος-εικόνας, όπου μπορεί να λείπει το κομμάτι που αλλάζεται)
    const strict = !ocrText && !letterCipher && !this.fromImage;
    // πόσες από τις κινήσεις που ακολουθούν στη σειρά παίζονται μετά από αυτή
    const fit = (n: GameNode, m: number): number => {
      if (!this.seq.length) return 0;
      try {
        const pos = Position.fromFen(n.fen);
        pos.makeMove(m);
        return playable(pos, this.seq, strict);
      } catch {
        return 0;
      }
    };
    // ανάμεσα στις υποψήφιες θέσεις (με σειρά προτεραιότητας) εκείνη όπου παίζονται οι περισσότερες από τις επόμενες
    // κινήσεις· σε ισοπαλία η πρώτη. `need`: τουλάχιστον τόσες (για την αναζήτηση σε όλο το δέντρο)
    const search = (nodes: Iterable<GameNode>, need = 0, max = Infinity) => {
      let loose: { parent: GameNode; move: number } | null = null;
      let best: { parent: GameNode; move: number } | null = null;
      let most = -1;
      let seen = 0;
      for (const n of nodes) {
        if (++seen > max) break;
        const m = this.legal(n, san);
        if (!m) continue;
        // (βιβλίο που δεν γράφει καθόλου το «x», «17…♖a8» = ♖xa8: η αιχμαλωσία χωρίς «x» είναι η κανονική του γραφή)
        if (Boolean(m & F_CAPTURE) === san.includes('x') || (shortCaptures && !san.includes('x'))) {
          const k = fit(n, m);
          if (k >= need && k > most) [best, most] = [{ parent: n, move: m }, k];
          if (best && most >= this.seq.length) break;
          continue;
        }
        if (san.includes('x') && strict) continue;
        if (fit(n, m) >= need) loose ??= { parent: n, move: m };
      }
      return best ?? loose;
    };
    // (αλλιώς σε όλο το δέντρο, ο πιο πρόσφατος κόμβος πρώτα, π.χ. «A1)» μέσα σε άλλη βαριάντα): μια σειρά κινήσεων μόνο
    // εκεί όπου παίζεται και η συνέχειά της (ως 2 κινήσεις)· αλλιώς κολλούσε σε όποια άσχετη βαριάντα τύχαινε να είναι
    // νόμιμη η πρώτη της
    const need = Math.min(2, this.seq.length);
    const hit = search(tries) ?? (global ? search(this.recent(ply - 1, tries), free ? 0 : need, free ? Infinity : 600) : null);
    if (hit) voteGlyph(hit.parent.fen, san);
    return hit;
  }

  /** Οι κόμβοι της ημικίνησης `ply` εκτός από τους `skip`, ο πιο πρόσφατος πρώτα. */
  private *recent(ply: number, skip: GameNode[]): Generator<GameNode> {
    for (let i = this.order.length - 1; i >= -1; i--) {
      const n = i < 0 ? this.game.root : this.order[i];
      if (n.ply === ply && !skip.includes(n)) yield n;
    }
  }

  /** Η σειρά `seq` παίζεται περισσότερο μετά την κίνηση `m0` απ' ό,τι στη θέση `spot` (ή το ίδιο, με `tie`); */
  private fitsAfter(m0: { parent: GameNode; move: number }, spot: { parent: GameNode; move: number }, seq: string[], tie: boolean): boolean {
    try {
      const pos = Position.fromFen(m0.parent.fen);
      pos.makeMove(m0.move);
      const here = playable(pos, seq, true);
      const there = playable(Position.fromFen(spot.parent.fen), seq, true);
      return here > there || (here === there && tie);
    } catch {
      return false;
    }
  }



  private play(parent: GameNode, move: number, main: boolean): GameNode {
    const existed = parent.children.find((c) => c.move === move);
    const node = existed ?? this.game.addMove(parent, move);
    if (!existed) this.order.push(node);
    if (main) {
      // η κύρια γραμμή πρώτη, εκτός αν εκεί υπάρχει ήδη άλλη κίνηση της κύριας γραμμής
      const first = parent.children[0];
      if (first !== node && !this.mainNodes.has(first)) {
        parent.children.splice(parent.children.indexOf(node), 1);
        parent.children.unshift(node);
      }
      this.mainNodes.add(node);
      this.mainTip = node;
    }
    return node;
  }

  private addComment(node: GameNode, text: string, before = false): void {
    const t = cleanComment(text);
    if (!t || /^[\s.,;:!?–-]*$/.test(t)) return;
    if (before && !node.isRoot) node.preComment = node.preComment ? `${node.preComment} ${t}` : t;
    else node.comment = node.comment ? `${node.comment} ${t}` : t;
  }

  /**
   * Κείμενο από εικόνα: τα έντονα βγαίνουν από το πάχος της γραμμής και μια σύντομη κίνηση («13.♗f3», «17.♘ab1») χάνει
   * κάποτε τα δικά της. Κινήσεις χωρίς έντονα (έξω από αγκύλες) που γεμίζουν ακριβώς το κενό ανάμεσα σε δύο κινήσεις της
   * κύριας γραμμής («[11...f6] … 12.♖e1 ♗d7 13.♖b1 (13.ef6 ♗f6) [13...♖ac8]») είναι κι αυτές της κύριας γραμμής: αλλιώς
   * η κύρια γραμμή θα είχε κενό.
   */
  private bridgeMain(toks: Token[]): void {
    type Move = Extract<Token, { k: 'move' }>;
    // η ημικίνηση της τελευταίας κίνησης της κύριας γραμμής, και οι υποψήφιες που τη συνεχίζουν
    let lastMain = this.mainTip.ply + this.base;
    let run: Move[] = [];
    let first = 0;
    let end = 0;
    let depth = 0;
    // μόνο κενά από την προηγούμενη κίνηση (η κίνηση χωρίς αριθμό ανήκει στη σειρά της)
    let glued = false;
    for (const t of toks) {
      if (t.k === 'open') depth++;
      else if (t.k === 'close') depth = Math.max(0, depth - 1);
      if (depth || t.k === 'open' || t.k === 'close') continue;
      if (t.k === 'text') {
        if (t.raw !== ' ' && !/^[,;]$/.test(t.raw)) glued = false;
        continue;
      }
      if (t.k !== 'move') {
        glued = false;
        continue;
      }
      const at = t.num === null ? null : (t.num - 1) * 2 + (t.black ? 2 : 1);
      if (t.main) {
        const ply = at ?? (run.length && glued ? end + 1 : lastMain + 1);
        if (run.length && first === lastMain + 1 && ply === end + 1) for (const r of run) r.main = true;
        lastMain = ply;
        run = [];
      } else if (at === null) {
        if (run.length && glued) {
          run.push(t);
          end++;
        } else run = [];
      } else if (run.length && at === end + 1) {
        run.push(t);
        end = at;
      } else if (at === lastMain + 1) {
        run = [t];
        first = end = at;
      } else run = [];
      glued = true;
    }
  }

  /**
   * Κείμενο από εικόνα: έντονη κίνηση μέσα στο σχόλιο που ξαναπαίζει την ημικίνηση της τελευταίας κίνησης της κύριας
   * γραμμής (ή την προηγούμενη) είναι εναλλακτική, όχι η κύρια γραμμή («6...a6 This move is more flexible than the
   * alternative 6...d6 which allows 7.♘db5»: ορισμένα βιβλία τυπώνουν έντονες και αυτές, και το πάχος μιας μόνης
   * λέξης βγαίνει κάποτε έντονο κατά λάθος). Αυτή και οι έντονες που την ακολουθούν ως το τέλος της παραγράφου (ή ως την
   * επόμενη ετικέτα) γίνονται βαριάντα· η κύρια γραμμή συνεχίζει στην επόμενη παράγραφο.
   */
  private demoteAlternatives(toks: Token[]): void {
    let last = this.mainTip.ply + this.base;
    // πεζό κείμενο από την αρχή της παραγράφου ή από την τελευταία κίνηση της κύριας γραμμής
    let prose = false;
    let off = false;
    // η θέση στο τέλος της κύριας γραμμής όπως προχωρά στην παράγραφο, και πριν από την τελευταία της κίνηση
    let pos: Position | null = null;
    let prev: Position | null = null;
    try {
      pos = Position.fromFen(this.mainTip.fen);
    } catch {
      pos = null;
    }
    // η τελευταία ημικίνηση της εναλλακτικής που έγινε βαριάντα: στην επόμενη παράγραφο (μετά από διάγραμμα) οι έντονες
    // που συνεχίζουν την αρίθμησή της είναι ακόμη αυτή (παρτίδα-παράδειγμα μέσα στο σχόλιο ως το «28...h3+ 0-1»: αλλιώς
    // έμπαινε ως κύρια γραμμή και το αποτέλεσμά της έκλεινε την παρτίδα)
    // (μόνο όταν η κύρια γραμμή ξαναβρίσκεται έντονη πιο κάτω στην παράγραφο· αλλιώς η «εναλλακτική» ήταν ο κλάδος που
    // συνεχίζει το βιβλίο: «8...♘d4!? 9.♘d4 ♗d7» + «More testing is: 10.♖d1»)
    const resumes = toks.some((t) => t.k === 'move' && t.main && t.num !== null && (t.num - 1) * 2 + (t.black ? 2 : 1) === last + 1);
    let altLast = resumes ? this.altRun : null;
    let offLast: number | null = null;
    let anyMain = false;
    for (const t of toks) {
      if (t.k === 'label') {
        off = false;
        prose = false;
        altLast = null;
        continue;
      }
      if (t.k === 'text') {
        if (/\p{L}{2}/u.test(t.raw)) prose = true;
        continue;
      }
      if (t.k !== 'move' || !t.main) continue;
      anyMain = true;
      let at = t.num === null ? null : (t.num - 1) * 2 + (t.black ? 2 : 1);
      if (altLast !== null && !off) {
        if ((at ?? altLast + 1) === altLast + 1 && altLast >= last + 2) {
          altLast++;
          t.main = false;
          continue;
        }
        altLast = null;
      }
      if (off) {
        offLast = at ?? (offLast === null ? null : offLast + 1);
        t.main = false;
        continue;
      }
      if (at !== null && prose && at <= last && last - at <= 1) {
        // (κίνηση του Μαύρου που έχασε τα αποσιωπητικά στο OCR, «2 ♘f3 For comments… 2 e6 In earlier games»: δεν
        // παίζεται ως εναλλακτική του Λευκού, παίζεται ως απάντηση· αλλιώς η συνέχεια έμενε βαριάντες)
        if (!t.black && !t.dots && at === last && pos && prev && !sanIn(prev, t.san) && sanIn(pos, t.san)) {
          t.black = true;
          at++;
        } else {
          off = true;
          offLast = at;
          t.main = false;
          continue;
        }
      }
      const ply = at ?? last + 1;
      const m = pos && ply === last + 1 ? sanIn(pos, t.san) : 0;
      if (pos && m) {
        prev = pos.clone();
        pos.makeMove(m);
      } else pos = null;
      last = ply;
      prose = false;
    }
    if (anyMain) this.altRun = off ? offLast : altLast;
  }

  /** Μία παράγραφος του βιβλίου. */
  paragraph(p: BookParagraph): void {
    const text = p.text.trim();
    if (!text || turnMarks.has(p)) return;
    if (p.caption || CAPTION_RE.test(text)) return this.caption(p);
    const section = this.bare ? SECTION_RE.exec(text) : null;
    const label = LABEL_RE.exec(text) ?? (this.bare ? PAREN_LABEL_RE.exec(text) : null) ?? (imageText ? DOT_LABEL_RE.exec(text) : null) ?? section;
    let runs = p.runs;
    if (label) {
      // η ετικέτα («A)», «b)») δεν μπαίνει στο σχόλιο· η βαριάντα ξεκινά από την κύρια γραμμή
      let cut = label[0].length;
      runs = runs.map((r) => ({ ...r }));
      for (const r of runs) {
        const n = Math.min(cut, r.text.length);
        r.text = r.text.slice(n);
        cut -= n;
        if (!cut) break;
      }
      this.hints = this.labelHints(label[1]);
    }
    const toks = tokenize(runs, this.bare);
    if (imageText) {
      this.demoteAlternatives(toks);
      this.bridgeMain(toks);
    }
    if (this.probe) for (const t of toks) if (t.k === 'move' && this.probe.moves.length < 12) this.probe.moves.push({ san: t.san, num: t.num, black: t.black });
    const isMainPara = toks.some((t) => t.k === 'move' && t.main);
    if (this.resume && this.bare && (this.resume.colon || /^[a-z]/.test(text))) this.cursor = this.resume.at;
    else if (this.resume && !this.bare && !label) {
      // η παράγραφος συνεχίζει τη γραμμή όπου τελείωσε η προηγούμενη («E311) 10…♖ab8 … 13.b4 a6.», διάγραμμα, «Here I
      // should not have rushed with 14.b5…»), όταν η πρώτη της κίνηση τη συνεχίζει και δεν παίζεται στην κύρια γραμμή
      const first = toks.find((t) => t.k === 'move' && t.num !== null);
      const at = this.resume.at;
      if (first?.k === 'move' && first.num !== null && !first.main) {
        const ply = (first.num - 1) * 2 + (first.black ? 2 : 1) - this.base;
        const onMain = this.ancestorAt(this.mainTip, ply - 1) ?? this.mainAt(this.mainTip, ply - 1);
        if (ply === at.ply + 1 && this.legal(at, first.san) && !(onMain && this.legal(onMain, first.san))) this.cursor = at;
      }
    }
    this.resume = null;
    this.contexts = [this.cursor];
    const stack: GameNode[] = [];
    const bracketIsVar: boolean[] = [];
    let last: GameNode | null = null;
    let pending = '';
    // (σειρά κινήσεων που συνεχίζει από την προηγούμενη παράγραφο: γραμμή που έσπασε το OCR, «4 Bc4» / «Be7?? 5 Qh5!»)
    let seq = this.tail;
    const flush = (before: GameNode | null) => {
      if (!pending.trim()) {
        pending = '';
        return;
      }
      if (last) this.addComment(last, pending);
      else if (before) this.addComment(before, pending, true);
      else this.addComment(this.cursor, pending);
      pending = '';
      mention = null;
    };
    // ακολουθεί κι άλλη κίνηση χωρίς κείμενο ανάμεσα (σειρά κινήσεων, όχι μεμονωμένη αναφορά)
    const plyOf = (t: Extract<Token, { k: 'move' }>) => (t.num === null ? null : (t.num - 1) * 2 + (t.black ? 2 : 1));
    const nextIsSeq = (i: number) => {
      const cur = toks[i];
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j];
        if (t.k === 'text' && (t.raw === ' ' || /^[,;]$/.test(t.raw))) continue;
        if (t.k !== 'move') return false;
        // αριθμοί χωρίς τελεία: «in 4 a3, 5 ... Ne7» δεν είναι σειρά· η επόμενη κίνηση με αριθμό πρέπει να τη συνεχίζει
        if (this.bare && cur.k === 'move' && cur.num !== null && t.num !== null && plyOf(t) !== plyOf(cur)! + 1) return false;
        return true;
      }
      return false;
    };
    // οι κινήσεις που συνεχίζουν τη σειρά μετά από την i (ως 4· σταματά σε κείμενο, αγκύλη ή αριθμό που δεν συνεχίζει)
    const aheadOf = (i: number, from?: number | null, max = 4): string[] => {
      const out: string[] = [];
      const cur = toks[i];
      let next = from !== undefined ? from : cur.k === 'move' ? plyOf(cur) : null;
      for (let j = i + 1; j < toks.length && out.length < max; j++) {
        const t = toks[j];
        if (t.k === 'text' && (t.raw === ' ' || /^[,;]$/.test(t.raw))) continue;
        if (t.k !== 'move') break;
        const at = plyOf(t);
        if (at !== null && next !== null && at !== next + 1) break;
        next = at ?? (next === null ? null : next + 1);
        out.push(t.san);
      }
      return out;
    };
    // η γραμμή που συνεχίζει μετά την ημικίνηση `from`, πέρα από σχόλια, αγκύλες και βαριάντες (κινήσεις με αριθμό που
    // δεν τη συνεχίζουν, και όσες ακολουθούν χωρίς αριθμό), και στις επόμενες παραγράφους· σταματά σε κίνηση πιο μπροστά
    // (λείπει κάτι) ή στις 16: για τη συμπλήρωση χαμένης κίνησης («2 ♗b7 … 6 a3? Natural… 6 d3 is correct. 6…♘c5 7 ♕c2 …
    // 7…♗xc3» = 2.♘c3)
    const lineAhead = (i: number, from: number): string[] => {
      const out: string[] = [];
      let next = from + 1;
      let skipping = false;
      let depth = 0;
      const take = (t: Token): boolean => {
        if (t.k === 'open') depth++;
        else if (t.k === 'close') depth = Math.max(0, depth - 1);
        else if (t.k === 'move' && !depth) {
          const at = plyOf(t);
          if (at === null) {
            if (!skipping) {
              out.push(t.san);
              next++;
            }
          } else if (at === next) {
            out.push(t.san);
            next++;
            skipping = false;
          } else if (at > next) return false;
          else skipping = true;
        }
        return out.length < 16;
      };
      for (let j = i + 1; j < toks.length; j++) if (!take(toks[j])) return out;
      for (const q of this.upcoming) for (const t of tokenize(q.runs, this.bare)) if (!take(t)) return out;
      return out;
    };
    // κείμενο από εικόνα: η κύρια γραμμή μετά την κίνηση `i`, δηλαδή οι επόμενες έντονες κινήσεις με αριθμούς που
    // συνεχίζουν (και όσες τις ακολουθούν αμέσως), πέρα από σχόλια και βαριάντες, και στις επόμενες παραγράφους (ως 30):
    // ένα σύμβολο που το βιβλίο δεν έμαθε, ή «17.♘b1» με δύο ίππους, κρίνεται από το αν παίζεται η συνέχεια της παρτίδας
    const mainAhead = (i: number): string[] => {
      const out: string[] = [];
      const cur = toks[i];
      let next = cur.k === 'move' ? plyOf(cur) : null;
      let direct = true;
      const take = (t: Token): boolean => {
        if (t.k === 'text') {
          if (t.raw !== ' ' && !/^[,;]$/.test(t.raw)) direct = false;
          return true;
        }
        if (t.k !== 'move' || !(t.main || direct)) {
          direct = false;
          return true;
        }
        const at = plyOf(t);
        if (at === null) {
          if (direct) {
            out.push(t.san);
            if (next !== null) next++;
          }
        } else if (next === null || at === next + 1) {
          out.push(t.san);
          next = at;
          direct = true;
        } else if (t.main) return false;
        else direct = false;
        return out.length < 30;
      };
      for (let j = i + 1; j < toks.length; j++) if (!take(toks[j])) return out;
      for (const q of this.upcoming) {
        direct = false;
        for (const t of upcomingTokens(q, this.bare)) if (!take(t)) return out;
      }
      return out;
    };
    // αγκύλη με κινήσεις μέσα (ως την αντίστοιχη που κλείνει): υποβαριάντα, ακόμη κι αν ξεκινά με λέξη («[After 10.Qxd5+? …]»)
    const bracketHasMove = (i: number) => {
      let depth = 0;
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j];
        if (t.k === 'open') depth++;
        else if (t.k === 'close') {
          if (depth === 0) return false;
          depth--;
        } else if (t.k === 'move' && t.num !== null) return true;
      }
      return false;
    };
    // μπήκε ήδη κίνηση της παραγράφου (η ετικέτα «B1)» αφορά μόνο την πρώτη)
    let placed = false;
    let firstPlaced: GameNode | null = null;
    // πού τελείωσε (μέσα στο εκκρεμές κείμενο) η τελευταία κίνηση-αναφορά, για τις λίστες «6...d6 or 6...Nf6»
    let mentionAt = -1;
    // η τελευταία αναφορά που έμεινε κείμενο (και πού είναι μέσα στο εκκρεμές κείμενο), αν τελικά ξεκινά γραμμή
    // (`far`: έμεινε κείμενο μόνο επειδή είναι πιο πίσω ή πιο μπροστά από τη γραμμή, όχι λόγω «the», «see», λίστας…)
    type Mention = { tok: Extract<Token, { k: 'move' }>; ply: number; start: number; end: number; far: boolean };
    let mention: Mention | null = null;
    // όλες οι αναφορές του εκκρεμούς κειμένου (για μια παλιότερη της ίδιας πρότασης: «9.♘c3 is good against 9…♘g8 with
    // the idea 10.♘d5, but Black plays 9…♗g4! 10.h3» = 9.♘c3 ♗g4)
    let mentions: Mention[] = [];
    // το κείμενο μετά από μια αναφορά, χωρίς τις αναφορές που ακολουθούν (οι τελείες των αριθμών τους δεν τελειώνουν πρόταση)
    const gapAfter = (m: Mention): string => {
      let gap = '';
      let at = m.end;
      for (const o of mentions) {
        if (o.start < m.end) continue;
        gap += pending.slice(at, o.start);
        at = o.end;
      }
      return gap + pending.slice(at);
    };
    // νέα κίνηση στο δέντρο, με το κείμενο που περίμενε
    const put = (at: { parent: GameNode; move: number }, from: GameNode, main: boolean): GameNode => {
      const existed = at.parent.children.some((c) => c.move === at.move);
      // παρέκβαση από άλλο σημείο: η ανάγνωση μπορεί να επιστρέψει στη γραμμή όπου ήταν
      if (at.parent !== from && !this.contexts.includes(from)) this.contexts.push(from);
      const node = this.play(at.parent, at.move, main);
      if (label && !placed) {
        this.labels.set(label[1], { first: node, end: node });
        this.activeLabel = label[1];
        this.hints = [];
        // η γραμμή της ετικέτας είναι πια η βάση της παραγράφου
        this.contexts = [];
        // η ενότητα («1.41 6 Be2») γίνεται στο τέλος δική της παρτίδα
        if (section) this.sections.push({ title: SECTION_TITLE_RE.exec(text)?.slice(1, 3).join(' ') ?? section[1], node });
      }
      firstPlaced ??= node;
      placed = true;
      if (pending.trim()) {
        // κείμενο ανάμεσα σε κινήσεις: μετά την προηγούμενη· πριν από την πρώτη κίνηση της παραγράφου: πριν από
        // μια νέα βαριάντα («Η κύρια εναλλακτική είναι…»), αλλιώς στη θέση από όπου ξεκινά
        if (last && at.parent !== last && !existed) {
          // «… Or 31...Rxb6»: η σύντομη εισαγωγή μιας βαριάντας πάει μπροστά από την πρώτη της κίνηση
          // («♖xf2 mate» : το «mate» ανήκει στην προηγούμενη κίνηση)
          const mate = /^\s*(?:check)?mate\b[.!]?/i.exec(pending)?.[0].length ?? 0;
          let cut = Math.max(...[...pending.replace(/:\s*$/, '').matchAll(/[.;:!?]["”)]?\s+/g)].map((m) => m.index + m[0].length), mate);
          // (η πηγή σε παρένθεση μένει στην κίνηση πριν: «9.♗b3 ♗f5 (Odeev-Buker, Adana 2006) 9…♘a5?»)
          cut += /^\s*\([^()]*\p{Lu}[^()]*\b(?:1[5-9]|20)\d\d\b[^()]*\)[.;,]?\s*/u.exec(pending.slice(cut))?.[0].length ?? 0;
          const head = pending.slice(0, cut);
          const tail = pending.slice(cut);
          // (και μια πρόταση που τελειώνει σε άνω και κάτω τελεία: «White had a defence, … for a young player: 10.♗xg7!»)
          const words = tail.trim().split(/\s+/).length;
          if (tail.trim() && (words <= 8 || (words <= 40 && /:\s*$/.test(tail))) && !/[.!?]\s*$/.test(tail)) {
            this.addComment(last, head);
            this.addComment(node, tail, true);
          } else this.addComment(last, pending);
        } else if (last) this.addComment(last, pending);
        else if (!existed && !main) {
          // οι ολοκληρωμένες προτάσεις μένουν εκεί όπου διαβάζαμε· η τελευταία οδηγεί στη νέα κίνηση
          const [head, tail] = splitLead(pending);
          if (head) this.addComment(from, head);
          this.addComment(node, tail, true);
        } else if (existed && !from.isRoot) {
          // κίνηση που υπάρχει ήδη («Now let us detail the first four white moves… 1.e4»): το κείμενο πριν από αυτήν
          // μένει εκεί όπου διαβάζαμε, όχι πριν από την πρώτη κίνηση της παρτίδας
          this.addComment(from, pending);
        } else this.addComment(at.parent, pending);
      }
      pending = '';
      return node;
    };
    // ετικέτα μέσα στην παράγραφο («(b) 4 f4»): η επόμενη κίνηση ξεκινά βαριάντα δίπλα στις αδελφές της ετικέτες
    let labelNext: string | null = null;
    // η αγκύλη άνοιξε αμέσως μετά από κίνηση της κύριας γραμμής (ανά αγκύλη), και μόλις έκλεισε μια τέτοια
    const seqAtOpen: boolean[] = [];
    let afterVar = false;
    // η ετικέτα της γραμμής που διαβάζεται (το τέλος της είναι η βάση για τις υπο-ετικέτες, π.χ. «(a2)» μέσα στην «(a)»)
    let inLabel: string | null = null;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === 'text') {
        pending += t.raw;
        if (t.raw !== ' ' && !/^[,;]$/.test(t.raw)) seq = afterVar = false;
        continue;
      }
      if (t.k === 'label') {
        labelNext = t.name;
        this.hints = this.labelHints(t.name);
        seq = false;
        continue;
      }
      if (t.k === 'open') {
        const isVar = bracketHasMove(i);
        bracketIsVar.push(isVar);
        if (!isVar) {
          pending += t.raw;
          continue;
        }
        flush(null);
        // «15.♕xd5 (Fedorov-Murtazin, Kazan 2014; 15.g3 …)»: η πηγή είναι σχόλιο της κίνησης πριν από την αγκύλη,
        // και μετά το «;» ξεκινά η βαριάντα
        let j = i + 1;
        let lead = '';
        while (j < toks.length && toks[j].k === 'text') lead += toks[j++].raw;
        if (toks[j]?.k === 'move' && /^\s*[^;()]*\b(?:1[5-9]|20)\d\d\b[^;()]*;\s*$/.test(lead) && /\p{Lu}/u.test(lead)) {
          this.addComment(last ?? this.cursor, lead.replace(/;\s*$/, ''));
          i = j - 1;
        }
        stack.push(this.cursor);
        seqAtOpen.push(seq && last !== null && this.mainNodes.has(last));
        last = null;
        seq = false;
        continue;
      }
      if (t.k === 'close') {
        const isVar = bracketIsVar.pop() ?? false;
        if (!isVar || !stack.length) {
          pending += t.raw;
          continue;
        }
        flush(null);
        this.cursor = stack.pop()!;
        last = this.cursor.isRoot ? null : this.cursor;
        seq = false;
        afterVar = seqAtOpen.pop() ?? false;
        continue;
      }
      // κίνηση· η πρώτη μετά από διάγραμμα ορίζει ποιος παίζει
      // (η πρώτη κίνηση με αριθμό και στις επόμενες παραγράφους: «White has a weakness on b3…» και μετά «19...d4!»)
      const numbered = (q: Token): q is Extract<Token, { k: 'move' }> => q.k === 'move' && q.num !== null;
      const firstNumbered = () => toks.slice(i + 1).find(numbered) ?? this.upcoming.map((u) => upcomingTokens(u, this.bare).find(numbered)).find(Boolean);
      // τετράγωνο της πρόζας, όχι κίνηση: «develop their bishop to b5», «pushing the d pawn to d4» (αλλιώς γινόταν «1.d4»)
      // (και σε κείμενο από εικόνα με σύμβολα κομματιών, όπου «to g3» είναι σπάνια «to ♕g3» που έχασε το σύμβολο)
      if (t.num === null && !t.main && /^[a-h][1-8]$/.test(t.san) && /\b(?:to|on|at|onto|into|from|towards|squares?)\s*$/i.test(pending)) {
        pending += t.raw;
        continue;
      }
      const settled = this.lazy ? this.settle(t, firstNumbered()) : false;
      if (settled) {
        stack.length = 0;
        last = null;
        seq = true;
      }
      if (settled === 'text') {
        pending += t.raw;
        continue;
      }
      let ply: number | null = null;
      if (t.num !== null) ply = (t.num - 1) * 2 + (t.black ? 2 : 1) - this.base;
      else if (seq) ply = this.cursor.ply + 1;
      // κείμενο από εικόνα: η απάντηση της κύριας γραμμής χωρίς αριθμό μετά από βαριάντα σε παρένθεση
      // («7.0-0 (7.f4 ♘d4 8.♕d4 ♗c5) ♘f6»)
      else if (afterVar && imageText && t.main && !stack.length) ply = this.cursor.ply + 1;
      // η πρώτη κίνηση της παρτίδας χωρίς το «1» (OCR: «d4 ♘f6 2 ♘f3 g6»): στην αρχή της, από την
      // αρχική θέση, όταν η επόμενη κίνηση με αριθμό είναι η 2 του Λευκού και η σειρά παίζεται από εκεί
      else if ((ocrText || imageText) && t.main && !stack.length && this.cursor === this.game.root && !this.game.root.children.length && !this.base && !this.lazy) {
        const nx = toks.slice(i + 1).find((q): q is Extract<Token, { k: 'move' }> => q.k === 'move');
        const second = nx && nx.num === null ? toks.slice(toks.indexOf(nx) + 1).find((q): q is Extract<Token, { k: 'move' }> => q.k === 'move') : undefined;
        if (nx?.main && second?.main && second.num === 2 && !second.black && this.legal(this.cursor, t.san)) ply = 1;
      }
      afterVar = false;
      if (ply === null) {
        // αναφορά μέσα στο κείμενο (π.χ. «με ...Kf7 και ...Re8»): μένει κείμενο, για τα βέλη
        pending += t.raw;
        continue;
      }
      // μια μεμονωμένη αναφορά σε κίνηση πιο πίσω ή πιο μπροστά από τη γραμμή («θα μπορούσε να παίξει 1.h4»), ή μετά από
      // «μεταθέτει στο», «βλ.», «αντί για» μένει κείμενο· μόνο μέσα σε αγκύλες ή όταν ακολουθούν κι άλλες κινήσεις είναι βαριάντα
      const lone = !t.main && t.num !== null && !nextIsSeq(i) && !(label && !placed) && !labelNext;
      const named = lone && toks[i + 1]?.k === 'text' && MENTION_NEXT.test(toks.slice(i + 1, i + 5).map((x) => x.raw).join(''));
      // λίστα αναφορών στην ίδια ημικίνηση («6...d6 or 6...Nf6»)· σε αριθμούς χωρίς τελεία όχι «in 4 a3, 5 ... Ne7 is…»
      const listed = mentionAt >= 0 && LIST_GAP.test(pending.slice(mentionAt)) && (!this.bare || mention?.ply === ply);
      const far = !stack.length && (ply < this.cursor.ply || ply > this.cursor.ply + 1);
      // (μετά από άνω και κάτω τελεία η κίνηση παρουσιάζεται, δεν αναφέρεται: «White nevertheless had a defence: 10.♗xg7!.»)
      const presented = /:\s*$/.test(pending) && !named;
      // σειρά κινήσεων που είναι παραπομπή σε άλλη γραμμή («transposes to 4…♕e7 5.d4», «usually arising after 3…♘f6
      // 4.d4»): όλη κείμενο (εκτός αγκυλών, όπου η βαριάντα είναι ρητή)
      if (!t.main && t.num !== null && !stack.length && !lone && !(label && !placed) && !labelNext && REFERENCE_SEQ_RE.test(pending)) {
        // (η σειρά συνεχίζει μόνο με κενά και με αριθμούς που ακολουθούν: «4…♕e7; 5…d6?!» είναι άλλη βαριάντα)
        let j = i;
        let at = plyOf(t)!;
        while (j + 1 < toks.length) {
          const q = toks[j + 1];
          if (q.k === 'text' && q.raw === ' ') j++;
          else if (q.k === 'move' && (plyOf(q) ?? at + 1) === at + 1) {
            at++;
            j++;
          } else break;
        }
        while (j > i && toks[j].k === 'text') j--;
        for (let k = i; k <= j; k++) pending += toks[k].raw;
        i = j;
        seq = false;
        continue;
      }
      const prev = MENTION_PREV.test(pending) || MENTION_GAP.test(pending);
      if (lone && !presented && (listed || named || prev || far)) {
        mention = { tok: t, ply, start: pending.length, end: pending.length + t.raw.length, far: false };
        mention.far = far && !listed && !named && !prev;
        mentions = mentions.filter((o) => pending.slice(o.start, o.end) === o.tok.raw);
        mentions.push(mention);
        pending += t.raw;
        mentionAt = pending.length;
        seq = false;
        continue;
      }
      mentionAt = -1;
      let before = this.cursor;
      this.ahead = PUA_RE.test(t.san) || imageText ? aheadOf(i, undefined, 12) : [];
      if (imageText && t.main) {
        let memo: string[] | null = null;
        const near = this.ahead;
        this.far = () => {
          if (!memo) {
            const a = mainAhead(i);
            memo = a.length > near.length ? a : near;
          }
          return memo;
        };
      }
      // στην ίδια πρόταση με την προηγούμενη κίνηση («…29.♔f1 c4 or win a pawn with 27...fxe4†»): εναλλακτική μέσα στη
      // γραμμή που διαβάζεται, όχι επιστροφή από παρέκβαση
      const joined = last !== null && !/[.!?;:]/.test(pending);
      // κίνηση της κύριας γραμμής του κεφαλαίου: πρώτα στο τέλος της (μετά από τις ενότητες A)…E) η «4.d4» συνεχίζει
      // την 3…g6 του κεφαλαίου, όχι το 4.d4 της ενότητας E) 3…♗e7)
      let spot = t.top ? this.topSpot(ply, t.san) : null;
      this.seq = aheadOf(i);
      spot ??= this.where(ply, t.san, t.main, Boolean(label) || t.main || Boolean(labelNext), !stack.length && !joined);
      this.seq = [];
      this.ahead = [];
      this.far = undefined;
      if (!t.main && !(mention && mention.ply === ply - 1) && nextIsSeq(i)) {
        // (μια παλιότερη αναφορά της ίδιας πρότασης, που έμεινε κείμενο μόνο επειδή ήταν πιο πίσω από τη γραμμή)
        mentions = mentions.filter((o) => pending.slice(o.start, o.end) === o.tok.raw);
        const want = ply - 1;
        const old = [...mentions].reverse().find((o) => o.ply === want);
        if (old?.far && !/[.!?;:]/.test(gapAfter(old))) mention = old;
      }
      if (mention && mention.ply === ply - 1 && !t.main) {
        // η αναφορά λίγο πριν ήταν τελικά η αρχή της γραμμής («we will only study the 5.Bxc6 line… 5...dxc6 6.d3»)· και
        // όταν η κίνηση χωρά κι αλλού, μια μεμονωμένη κίνηση πιο πίσω στη γραμμή («Relatively best is 27.♘g2 when Black can
        // take back the pawn with 27...♖d3† 28.♔e2»), αν η σειρά παίζεται εκεί περισσότερο, ή το ίδιο και στην ίδια πρόταση
        // (η θέση της αναφοράς: όπου παίζεται περισσότερο η σειρά που ακολουθεί)
        this.seq = [t.san, ...aheadOf(i)];
        const m0 = this.where(mention.ply, mention.tok.san, false, false, !stack.length);
        this.seq = [];
        const near = !/[.!?;:]/.test(gapAfter(mention));
        // (η σύγκριση με τη γραμμή πέρα από αγκύλες και σχόλια· ισοπαλία: στην ίδια πρόταση, ή η κίνηση υπάρχει ήδη στη
        // `spot` και η αναφορά είναι νέα γραμμή: «But 17...f5!? is trickier. White has three options: a) 18.♗h6?»)
        const sp = spot;
        const tie = near || Boolean(sp && sp.parent.children.some((c) => c.move === sp.move));
        const fits = m0 && this.legalAfter(m0.parent, m0.move, t.san) && (!sp || this.fitsAfter(m0, sp, [t.san, ...lineAhead(i, ply + this.base)], tie));
        // (αναφορά σε κίνηση που υπάρχει ήδη, «9...Bd7 also clears the c-file, so that 10 Nc3? …»: μόνο η θέση της
        // συνέχειας· το κείμενο με την αναφορά μένει μπροστά της)
        const known = fits && sp && m0 ? m0.parent.children.find((c) => c.move === m0.move) : undefined;
        if (known) spot = { parent: known, move: this.legal(known, t.san) };
        else if (fits && m0) {
          const after = pending.slice(mention.end);
          pending = pending.slice(0, mention.start);
          const n0 = put(m0, before, false);
          this.after(n0, mention.tok, mention.ply);
          last = n0;
          pending = after;
          before = n0;
          spot = this.where(ply, t.san, false, false, !stack.length);
        }
      }
      mention = null;
      // κείμενο από εικόνα: κίνηση της κύριας γραμμής με αριθμό που διαβάστηκε λάθος (οι κουκκίδες του Μαύρου ως ψηφία:
      // «6 222 cxd4», «022 ♗g7»)· μπαίνει αμέσως μετά το τέλος της κύριας γραμμής, αν παίζεται εκεί και η επόμενη
      // αριθμημένη κίνηση της κύριας γραμμής τη συνεχίζει
      if (!spot && imageText && t.main && t.num !== null && ply !== this.mainTip.ply + 1) {
        const m = this.legal(this.mainTip, t.san);
        let nx: Extract<Token, { k: 'move' }> | undefined;
        for (let j = i + 1; j < toks.length && !nx; j++) {
          const q = toks[j];
          if (q.k === 'move' && q.main && q.num !== null) nx = q;
        }
        for (const up of this.upcoming) {
          if (nx) break;
          nx = upcomingTokens(up, this.bare).find((q): q is Extract<Token, { k: 'move' }> => q.k === 'move' && q.main && q.num !== null);
        }
        if (m && nx && plyOf(nx)! - this.base === this.mainTip.ply + 2 && this.legalAfter(this.mainTip, m, nx.san)) {
          spot = { parent: this.mainTip, move: m };
          ply = this.mainTip.ply + 1;
        }
      }
      if (!spot && t.num !== null && (t.main || ocrText || letterCipher)) {
        // μία κίνηση χάθηκε πριν από αυτήν (κακό κείμενο σκαναρισμένου βιβλίου, λέξη που παρέλειψε το OCR): μπαίνει η
        // μόνη νόμιμη μετά από την οποία παίζονται αυτή και οι επόμενες· σε βαριάντα (βιβλία από OCR) και όταν ο αριθμός
        // μιας λευκής κίνησης που χάθηκε έμεινε στη μαύρη («2 ♗b7» αντί για «2 ♘c3 ♗b7»)
        const anchor = t.top ? this.topTip : t.main ? this.mainTip : this.cursor;
        const shift = !t.main && !t.black && ply === anchor.ply + 1;
        if (ply === anchor.ply + 2 || shift) {
          const at = shift ? ply + 1 : ply;
          // (ως 12 κινήσεις μπροστά: «17 ♕e7 18 ♘xg5 … 21 ♖de1» ξεχωρίζει το 17.♔b1 από το 17.♖d2)
          const from = plyOf(t)! + (shift ? 1 : 0);
          // πρώτα η σειρά όπως είναι· αν δεν φτάνει για να ξεχωρίσει μία κίνηση, η γραμμή πέρα από σχόλια και βαριάντες
          let fill = this.gapMove(anchor, t.san, aheadOf(i, from, 12), t.main ? 1 : 3) || (ocrText || letterCipher ? this.gapMove(anchor, t.san, lineAhead(i, from), 4) : 0);
          // (μόνο οι λευκές κινήσεις του στησίματος, η καθεμιά με το σχόλιό της: «1.e4 Normal. 2.♘c3 … 3.f4 One of the key
          // moves… 4.♘f3»· ο μαύρος δεν έχει κίνηση στο βιβλίο, άρα κενή κίνηση «--», όχι μια τυχαία νόμιμη)
          if (!fill && t.main && !t.black && !shift && !ocrText && !letterCipher && !nextIsSeq(i) && this.nullFits(anchor, t.san)) fill = NULL_MOVE;
          if (fill) {
            before = put({ parent: anchor, move: fill }, before, t.main);
            last = before;
            spot = this.where(at, t.san, t.main, true, !stack.length, true);
            if (spot) ply = at;
          }
        }
      }
      // λάθος αριθμός μέσα σε σειρά κινήσεων («The Petroff, 1 e4 e5 3 Nf3 Nf6»): αμέσως μετά από την κίνηση που μόλις
      // μπήκε, χωρίς κείμενο ανάμεσα, με το σωστό χρώμα, αν παίζονται εκεί αυτή και η επόμενη
      const prevTok = i >= 2 && toks[i - 1].k === 'text' && !toks[i - 1].raw.trim() ? toks[i - 2] : null;
      const glued = prevTok?.k === 'move' && last !== null && last.san.replace(/[+#!?]/g, '') === prevTok.san.replace(/[+#!?]/g, '');
      if (!spot && t.num !== null && last && glued && !pending.trim() && ply === last.ply + 3) {
        const m = this.legal(last, t.san);
        const nx = aheadOf(i)[0];
        if (m && nx && this.legalAfter(last, m, nx)) {
          spot = { parent: last, move: m };
          ply = last.ply + 1;
        }
      }
      // ενότητα χωρίς τις πρώτες κινήσεις: η αρχή της από μια προηγούμενη παρτίδα (`seedLine`)
      if (!spot && t.main && t.num !== null && ply > 1 && this.bare && !this.exercise && !this.lazy && !this.fromImage && this.seeds.length && !this.game.root.children.length) {
        const path = this.seedLine(ply, t.san, aheadOf(i));
        if (path) {
          let at = this.game.root;
          for (const s of path) at = this.play(at, s.move, true);
          const m = this.legal(at, t.san);
          if (m) spot = { parent: at, move: m };
        }
      }
      // βαριάντα που ξεκινά από άλλο σημείο της ανάλυσης: εκεί όπου παίζονται τουλάχιστον 3 κινήσεις της στη σειρά
      if (!spot && t.num !== null) spot = this.anchor(ply, [t.san, ...aheadOf(i)]);
      if (!spot) {
        if (t.num !== null) this.unplaced.push({ page: p.page, text: snippet(text, t.raw) });
        pending += t.raw;
        seq = false;
        if (labelNext) {
          labelNext = null;
          this.hints = [];
        }
        continue;
      }
      const known = spot.parent.children.find((c) => c.move === spot.move);
      if (lone && known && this.descends(this.cursor, known)) {
        pending += t.raw;
        mentionAt = pending.length;
        seq = false;
        continue;
      }
      const node = put(spot, before, t.main);
      if (t.top) this.topTip = node;
      this.after(node, t, ply);
      // βιβλίο χωρίς έντονα για την κύρια γραμμή (OCR των Windows): μία εναλλακτική κίνηση και μετά σχόλιο («6 d3 is correct»)
      // είναι βαριάντα· η ανάγνωση συνεχίζει από την κίνηση της γραμμής («6…♘c5» μετά το 6.a3?)
      if (lone && letterCipher && boldless && !before.isRoot && spot.parent === before.parent && node !== before) this.cursor = before;
      last = node;
      seq = true;
      if (labelNext) {
        this.labels.set(labelNext, { first: node, end: node });
        inLabel = labelNext;
        labelNext = null;
        this.hints = [];
      } else if (this.bare) {
        // η γραμμή της ετικέτας προχωρά: εκεί ξεκινούν οι υπο-ετικέτες που ακολουθούν στην ίδια παράγραφο
        const l = this.labels.get(inLabel ?? this.activeLabel ?? '');
        if (l && this.descends(node, l.first)) l.end = node;
      }
    }
    this.tail = (this.bare || ocrText || letterCipher) && seq && !stack.length && !pending.trim() && !isMainPara;
    // ό,τι έμεινε: στην τελευταία κίνηση της παραγράφου ή στον κόμβο όπου βρισκόμαστε
    while (stack.length) this.cursor = stack.pop()!;
    if (pending.trim()) {
      if (last) this.addComment(last, pending);
      else this.addComment(this.cursor, pending);
    }
    this.hints = [];
    if (isMainPara) {
      if (!this.mainNodes.has(this.cursor)) this.resume = { at: this.cursor, colon: /:\s*$/.test(text) };
      this.cursor = this.mainTip;
      this.activeLabel = null;
      // αριθμοί χωρίς τελεία: μετά από κατάλογο ενοτήτων η ανάγνωση γυρίζει εκεί όπου διακλαδίζονται
      const first = firstPlaced as GameNode | null;
      if (this.bare && first?.parent && SECTION_GUIDE_RE.test(text)) this.cursor = this.mainTip = first.parent;
    } else if (this.activeLabel) {
      // η γραμμή της ετικέτας προχωρά όσο οι επόμενες παράγραφοι τη συνεχίζουν
      const l = this.labels.get(this.activeLabel);
      if (l && this.descends(this.cursor, l.first)) l.end = this.cursor;
    }
  }

  private descends(n: GameNode | null, of: GameNode): boolean {
    for (; n; n = n.parent) if (n === of) return true;
    return false;
  }

  /**
   * Πού ξεκινά η ετικέτα `name`: «A2)» δίπλα στην «A1)» (ίδιος γονιός), «A1)» μέσα στη γραμμή της «A)».
   * Μια ετικέτα που ξαναβγαίνει ξεκινά νέο σύνολο (νέο σημείο διακλάδωσης).
   */
  private labelHints(name: string): GameNode[] {
    const parentOf = (l: string) => (l.includes('.') ? l.replace(/\.\d+$/, '') : l.length > 1 ? l.slice(0, -1) : null);
    // αριθμοί χωρίς τελεία: κάθε σημείωση έχει τις δικές της ετικέτες, άρα η «(a)» ξεκινά νέα ομάδα (οι παλιές «(b)», «(c)»
    // θα έστελναν την κίνηση στο σημείο διακλάδωσης μιας άλλης σημείωσης)
    if (this.bare && /^[aA]$/.test(name)) this.labels.clear();
    if (this.labels.has(name)) {
      if (parentOf(name) === null) this.labels.clear();
      else for (const k of [...this.labels.keys()]) if (k.startsWith(name)) this.labels.delete(k);
    }
    const out: GameNode[] = [];
    const parent = parentOf(name);
    const sibs = [...this.labels.entries()].filter(([k]) => k !== name && parentOf(k) === parent).reverse();
    for (const [, v] of sibs) if (v.first.parent) out.push(v.first.parent);
    for (let p = parent; p; p = parentOf(p)) {
      const v = this.labels.get(p);
      if (v) out.push(v.end, v.first);
    }
    return out;
  }

  private after(node: GameNode, t: Extract<Token, { k: 'move' }>, ply: number): void {
    const white = ply % 2 === 1;
    for (const n of nagsOf(t.nags, white)) if (!node.nags.includes(n)) node.nags.push(n);
    this.cursor = node;
  }

  /** «Position after: 13.0-0»: η θέση του διαγράμματος· η ανάγνωση συνεχίζει από εκεί. */
  private caption(p: BookParagraph): void {
    const mv = tokenize(p.runs, this.bare).find((t): t is Extract<Token, { k: 'move' }> => t.k === 'move' && t.num !== null);
    if (!mv) return;
    const ply = (mv.num! - 1) * 2 + (mv.black ? 2 : 1);
    const same = (n: GameNode | null) => n && n.ply === ply && sanKey(n.san) === sanKey(mv.san);
    const onPath = (from: GameNode) => {
      let n: GameNode | null = from;
      while (n && n.ply > ply) n = n.parent;
      return same(n) ? n : null;
    };
    let hit = onPath(this.cursor) ?? onPath(this.mainTip);
    if (!hit) for (let i = this.order.length - 1; i >= 0 && !hit; i--) if (same(this.order[i])) hit = this.order[i];
    if (hit) this.cursor = hit;
  }

  /** Όπου η πρώτη συνέχεια είναι μία κίνηση χωρίς τίποτε μετά, ενώ μια άλλη αναλύεται, πρώτη γίνεται η αναλυμένη. */
  promoteLines(): void {
    const size = (n: GameNode): number => n.children.reduce((s, c) => s + 1 + size(c), 0);
    const walk = (n: GameNode) => {
      const first = n.children[0];
      if (first && !this.mainNodes.has(first) && !first.children.length && n.children.length > 1) {
        let best = first;
        for (const c of n.children) if (!this.mainNodes.has(c) && size(c) > size(best)) best = c;
        if (best !== first) {
          n.children.splice(n.children.indexOf(best), 1);
          n.children.unshift(best);
        }
      }
      // κείμενο πριν από κίνηση που έμεινε πρώτη συνέχεια: σχόλιο της προηγούμενης (όχι «{…} {…}»)
      const lead = n.children[0];
      if (lead?.preComment && !n.isRoot) {
        n.comment = n.comment ? `${n.comment} ${lead.preComment}` : lead.preComment;
        lead.preComment = '';
      }
      for (const c of n.children) walk(c);
    };
    walk(this.game.root);
  }

  /**
   * Τελικό καθάρισμα των σχολίων: το «mate» μετά από κίνηση που είναι ματ (το δείχνει το «#») και ένα σκέτο
   * αποτέλεσμα («1–0») φεύγουν· το αποτέλεσμα της κύριας γραμμής γίνεται το αποτέλεσμα της παρτίδας.
   */
  tidy(): void {
    const walk = (n: GameNode, main: boolean) => {
      if (n.comment && !n.isRoot && /^mate\b/i.test(n.comment)) {
        try {
          // (και ό,τι μένει μόνο από σημεία στίξης: «mate ;» πριν από την επόμενη βαριάντα)
          if (Position.fromFen(n.fen).isCheckmate()) n.comment = n.comment.replace(/^mate\b[.!]?\s*/i, '').replace(/^[\s.,;:]+$/, '');
        } catch {
          // άκυρη θέση: το σχόλιο μένει
        }
      }
      const res = /^(1[–-]0|0[–-]1|½[–-]½|1\/2[–-]1\/2)(?![\d,])[.]?\s*/.exec(n.comment);
      // (σε βαριάντα μένει: είναι το αποτέλεσμα της παρτίδας που αναφέρεται, «16…♔xh7 0-1 (Sikula-Marzolo)»)
      if (res && main) {
        if (this.game.headers.Result === '*') this.game.headers.Result = res[1].replace(/–/g, '-').replace('½-½', '1/2-1/2');
        n.comment = n.comment.slice(res[0].length);
      }
      n.children.forEach((c, i) => walk(c, main && i === 0));
    };
    walk(this.game.root, true);
    // παρτίδα (με τόπο ή χρονιά) που τελειώνει σε ματ ή με εγκατάλειψη χωρίς γραμμένο αποτέλεσμα
    const h = this.game.headers;
    if (h.Result !== '*' || (h.Site === '?' && h.Date === '????.??.??') || this.exercise) return;
    let end = this.game.root;
    while (end.children[0]) end = end.children[0];
    if (end.isRoot) return;
    let mate = false;
    try {
      mate = Position.fromFen(end.fen).isCheckmate();
    } catch {
      mate = false;
    }
    const resigned = /\b(white|black)\s+(?:resigned|resigns|gave up)\b/i.exec(end.comment);
    if (mate) h.Result = end.ply % 2 ? '1-0' : '0-1';
    else if (resigned) h.Result = resigned[1].toLowerCase() === 'black' ? '1-0' : '0-1';
  }

  /** Κείμενο στο τέλος της κύριας γραμμής (το συμπέρασμα ενός κεφαλαίου), χωρίς ανάγνωση κινήσεων. */
  noteEnd(text: string): void {
    let n = this.game.root;
    while (n.children[0]) n = n.children[0];
    this.addComment(n, text);
  }

  /** Κείμενο χωρίς κινήσεις (εισαγωγή ενότητας, ασκήσεις): στον κόμβο όπου βρισκόμαστε. */
  note(text: string): void {
    this.addComment(this.cursor, text);
  }
}

/** «Πρόταση. Πρόταση. Αν ο Μαύρος παίξει» → [«Πρόταση. Πρόταση.», «Αν ο Μαύρος παίξει»]. */
function splitLead(s: string): [string, string] {
  let cut = -1;
  const re = /[.!?]["”)]?\s+(?=[A-ZΑ-Ω"“(])/g;
  for (let m = re.exec(s); m; m = re.exec(s)) cut = m.index + m[0].length;
  return cut < 0 ? ['', s] : [s.slice(0, cut), s.slice(cut)];
}

const sanKey = (s: string) => s.replace(/[+#!?]/g, '').replace(/0/g, 'O');

function cleanComment(s: string): string {
  return s
    .replace(/[¢£¤¥¦]\s?(?=[a-h1-8]?x?[a-h][1-8])/g, (c) => FIGURINES_CB[c.trim()])
    .replace(/[¢£¤¥¦]/g, (c) => FIGURINES_CB[c])
    .replace(/†/g, '+')
    .replace(/‡/g, '#')
    .replace(/[²³μµ÷]/g, (c) => ({ '²': '⩲', '³': '⩱', μ: '∓', µ: '∓', '÷': '∞' })[c] ?? c)
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\s+/g, ' ')
    // (όχι πριν από τα «...» μιας μαύρης κίνησης: «idea is ...Nh4»)
    .replace(/\s+(?!\.\.\.)([,.;:!?)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/^[\s,;:]+/, '')
    // μία τελεία στην αρχή (το τέλος της πρότασης της κίνησης), όχι τα «...» μιας μαύρης κίνησης
    .replace(/^\.(?!\.)\s*/, '')
    // το «;» που χωρίζει δύο βαριάντες στο βιβλίο («…♘xc2=; 10…0-0-0») δεν ανήκει στο σχόλιο
    .replace(/\s*;$/, '')
    .trim();
}

/**
 * Θέση διαγράμματος που δεν γίνεται: σε σαχ ο παίκτης που δεν έχει σειρά (`side`), ή χωρίς `side` και οι δύο
 * βασιλιάδες. Συνήθως δύο ίδια κομμάτια με ανάποδα χρώματα, όπως οι βασίλισσες στα d8/d1
 * («rnbQkb1r/…/RNBqKB1R»). Αλλάζει το χρώμα σε ένα τέτοιο ζευγάρι όταν έτσι κανένας βασιλιάς δεν είναι σε σαχ· αλλιώς
 * η θέση μένει ως έχει.
 */
export function swapColors(placement: string, side?: 'w' | 'b'): string {
  const check = (pl: string, s: 'w' | 'b') => {
    try {
      return Position.fromFen(`${pl} ${s} - - 0 1`).inCheck();
    } catch {
      return true;
    }
  };
  if (side ? !check(placement, side === 'w' ? 'b' : 'w') : !(check(placement, 'w') && check(placement, 'b'))) return placement;
  const grid = [...placement.split('/').join('').replace(/\d/g, (d) => '.'.repeat(Number(d)))];
  if (grid.length !== 64) return placement;
  const text = (g: string[]) => [0, 1, 2, 3, 4, 5, 6, 7].map((r) => g.slice(r * 8, r * 8 + 8).join('').replace(/\.+/g, (m) => String(m.length))).join('/');
  for (const t of 'QRBNP')
    for (let a = 0; a < 64; a++) {
      if (grid[a] !== t) continue;
      for (let b = 0; b < 64; b++) {
        if (grid[b] !== t.toLowerCase()) continue;
        const g = [...grid];
        g[a] = t.toLowerCase();
        g[b] = t;
        const pl = text(g);
        if (!check(pl, 'w') && !check(pl, 'b')) return pl;
      }
    }
  return placement;
}

function snippet(text: string, raw: string): string {
  const i = text.indexOf(raw);
  // (κείμενο που άλλαξε η κανονικοποίηση, π.χ. από OCR: η κίνηση και η αρχή της παραγράφου)
  if (i < 0) return `${raw.trim()} — ${text.slice(0, 60).replace(/\s+/g, ' ')}${text.length > 60 ? '…' : ''}`;
  const from = Math.max(0, i - 40);
  return (from > 0 ? '…' : '') + text.slice(from, i + raw.length + 40).replace(/\s+/g, ' ') + (i + raw.length + 40 < text.length ? '…' : '');
}

// ---------------------------------------------------------------------------
// βέλη και κύκλοι από τα σχόλια

type Board = Array<string | null>;

function boardOf(fen: string): Board {
  const b: Board = new Array(128).fill(null);
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r] ?? '') {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        b[(7 - r) * 16 + f] = ch;
        f++;
      }
    }
  }
  return b;
}

const DIRS: Record<string, number[]> = { N: [33, 31, 18, 14, -14, -18, -31, -33], B: [15, 17, -15, -17], R: [1, -1, 16, -16], Q: [1, -1, 16, -16, 15, 17, -15, -17], K: [1, -1, 16, -16, 15, 17, -15, -17] };

/** Φτάνει το κομμάτι από `from` στο `to` με μία κίνηση (χωρίς σαχ και καρφώματα); */
function reaches(b: Board, type: string, from: number, to: number): boolean {
  for (const d of DIRS[type]) {
    let s = from + d;
    while (!(s & 0x88)) {
      if (s === to) return true;
      if (type === 'N' || type === 'K' || b[s]) break;
      s += d;
    }
  }
  return false;
}

/** Η γεωμετρία της κίνησης χωρίς να κοιτά τα εμπόδια (π.χ. «Rc1» με τον ίππο ακόμη στο b1). */
function lines(type: string, from: number, to: number): boolean {
  const df = Math.abs((from & 7) - (to & 7));
  const dr = Math.abs((from >> 4) - (to >> 4));
  if (type === 'R') return df === 0 || dr === 0;
  if (type === 'B') return df === dr;
  if (type === 'Q') return df === 0 || dr === 0 || df === dr;
  if (type === 'N') return (df === 1 && dr === 2) || (df === 2 && dr === 1);
  return df <= 1 && dr <= 1;
}

const dist = (a: number, b: number) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));

/** Το βέλος μιας κίνησης-πλάνου πάνω σε πρόχειρη σκακιέρα (που μετά «παίζει» την κίνηση, για τις επόμενες του πλάνου). */
export function planArrow(b: Board, san: string, white: boolean): [number, number] | 'there' | null {
  const s = san.replace(/[+#!?]/g, '').replace(/0/g, 'O');
  const own = (p: string | null) => p !== null && (p === p.toUpperCase()) === white;
  const move = (from: number, to: number): [number, number] => {
    b[to] = b[from];
    b[from] = null;
    return [from, to];
  };
  if (s === 'O-O' || s === 'O-O-O') {
    const k = b.findIndex((p) => p === (white ? 'K' : 'k'));
    if (k < 0 || (k & 7) !== 4) return null;
    const short = s === 'O-O';
    const rook = k + (short ? 3 : -4);
    if (b[rook] === (white ? 'R' : 'r')) {
      b[k + (short ? 1 : -1)] = b[rook];
      b[rook] = null;
    }
    return move(k, k + (short ? 2 : -2));
  }
  const m = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])/.exec(s);
  if (!m) return null;
  const to = parseSquare(m[4]);
  if (to < 0) return null;
  if (!m[1]) {
    // πιόνι: στην ίδια στήλη πίσω από το τετράγωνο ή, σε αιχμαλωσία, στη στήλη που δίνεται
    const file = m[2] ? m[2].charCodeAt(0) - 97 : to & 7;
    const step = white ? -16 : 16;
    if (m[2] && m[2].charCodeAt(0) - 97 !== (to & 7)) {
      const from = to + step + (file - (to & 7));
      return !(from & 0x88) && b[from] === (white ? 'P' : 'p') ? move(from, to) : null;
    }
    const pawn = white ? 'P' : 'p';
    const one = to + step;
    if (one & 0x88) return null;
    if (b[one] === pawn) return move(one, to);
    const two = one + step;
    if (!b[one] && !(two & 0x88) && b[two] === pawn && two >> 4 === (white ? 1 : 6)) return move(two, to);
    return null;
  }
  const letter = white ? m[1] : m[1].toLowerCase();
  const cands: number[] = [];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88 || b[sq] !== letter || !own(b[sq])) continue;
    if (m[2] && (sq & 7) !== m[2].charCodeAt(0) - 97) continue;
    if (m[3] && sq >> 4 !== Number(m[3]) - 1) continue;
    cands.push(sq);
  }
  if (!cands.length) return null;
  if (cands.includes(to)) return 'there';
  const one = cands.filter((sq) => reaches(b, m[1], sq, to));
  const lined = cands.filter((sq) => lines(m[1], sq, to));
  const from = (one.length ? one : lined).sort((x, y) => dist(x, to) - dist(y, to))[0];
  if (from === undefined || from === to) return null;
  return move(from, to);
}

const WEAK_RES = [
  /\bweak(?:ness(?:es)?|ened|est)?\s+(?:on\s+|of\s+|at\s+)?(?:the\s+)?([a-h][1-8])\b/gi,
  /\b([a-h][1-8])[- ](?:pawn|square)\s+(?:is|was|becomes|became|remains|will\s+be)\s+(?:very\s+|quite\s+|a\s+|rather\s+)?(?:weak|vulnerable|a\s+target)/gi,
  /\b(?:backward|isolated|hanging|weak|vulnerable)\s+([a-h][1-8])\b/gi,
  /\bhole\s+(?:on|at)\s+([a-h][1-8])\b/gi,
  /\bαδυναμ\w*\s+(?:στο\s+|στα\s+|του\s+)?([a-h][1-8])/gi,
  /\bαδύναμ\w*\s+(?:τετράγωνο\s+|πιόνι\s+)?([a-h][1-8])/gi,
  /\bSchwäche\w*\s+(?:auf\s+)?([a-h][1-8])/gi,
  /\bschwach\w*\s+(?:Feld\s+|Bauer\s+|Punkt\s+)?([a-h][1-8])/gi,
];
const THREAT_RE = /\bthreat|\bthreaten|απειλ|droh/i;
/** Λέξεις ρητού πλάνου ακριβώς πριν από μια κίνηση μέσα στο κείμενο. */
const STRICT_PLAN_RE = /(?:\bplan(?:s|ning)?(?:\s+is)?|\bidea(?:\s+of)?|\bintending|\bthreat(?:en(?:s|ing)?)?|\bprepar(?:e|es|ing)|σχέδιο|ιδέα|απειλ\p{L}*|\bIdee|\bPlan)\s*(?:\.\.\.)?\s*$/iu;
/** Λέξεις πριν από μια κίνηση που είναι μόνο αναφορά («transposes to 6.Nxf7», «see 9.Qe2», «instead of 9...d6»). */
// (και «the move 2.f4», «counter move 2…d5!», «than», «As after», «avoids», «prevents», «threatens»· όχι σκέτο «after»,
// που συχνά εισάγει βαριάντα που συνεχίζεται στην επόμενη πρόταση)
const MENTION_PREV = /(?:\bthe|\bmoves?|\bthan|\bas\s+after|\bavoids?|\bprevents?|\bthreaten(?:s|ing)?(?:\s+to\s+play)?|\bthreat\s+(?:is|of)|\bintending|\bidea\s+of|\bsuch\s+as|\btranspos\w*\s+(?:back\s+)?(?:in)?to|\bsee(?:\s+also)?|\bcompare(?:\s+with)?|\bcf\.?|\binstead\s+of|\bsimilar\s+to|\banalogous\s+to|\bas\s+in|(?<!\p{L})μεταθέτει\s+(?:σ(?:ε|το|τη|την))?|(?<!\p{L})(?:δες|βλ\.|αντί\s+(?:για|του|της)))\s*$/iu;
// το ίδιο με λίγες λέξεις ανάμεσα, χωρίς στίξη («prevents the central advance 6…d5», «besides 4…♗c5», «avoids the main
// black option 7…♘a5»)· όχι «prevent the check by playing 16…a5» (η κίνηση είναι το μέσο)
const MENTION_GAP = /(?:\bavoids?|\bprevents?|\bbesides|\bapart\s+from|\bother\s+than|\binstead\s+of|(?<!\p{L})εκτός\s+από|(?<!\p{L})αποτρέπει|(?<!\p{L})αποφεύγει)(?:\s+(?!(?:by|with|play\w*|after|via|through|and|or|but|when|then|if|is|was|since|με|παίζοντας|μετά)(?!\p{L}))[\p{L}’'-]+){0,4}\s*$/iu;
/** Πριν από σειρά κινήσεων που είναι παραπομπή σε άλλη γραμμή («transposes to», «usually arising after», «reached after»). */
const REFERENCE_SEQ_RE = /(?:\btranspos\w*\s+(?:back\s+)?(?:in)?to|\b(?:arising|reached|occurring)\s+(?:after|via|from|by)|\bsee|\bcompare(?:\s+with)?|\bcf\.?|(?<!\p{L})μεταθέτει\s+(?:σ(?:ε|το|τη|την))?|(?<!\p{L})(?:δες|βλ\.))\s*(?:the\s+(?:line|variation)\s+)?$/iu;
/** Λέξη μετά από κίνηση που είναι μόνο αναφορά («the 9.d4 line», «το σύστημα με 3.Bc4»). */
const MENTION_NEXT = /^\s*(?:line|lines|variation|system|move order|branch|γραμμή|βαριάντα|σύστημα)(?!\p{L})/iu;
/** Ανάμεσα σε δύο αναφορές μιας λίστας («6...d6 or 6...Nf6», «9.Qe2, 9.Qf3 and 9.h3»). */
const LIST_GAP = /^\s*(?:,|or|and|ή|και|oder|und|,\s*(?:or|and))\s*$/i;
/** Διαδρομή κομματιού («Nb1-d2-f1-g3»). */
const ROUTE_RE = /(?:^|[\s(])(\.\.\.)?([KQRBN])([a-h1-8])??([a-h][1-8])((?:-[a-h][1-8])+)/g;

/**
 * Τα σχήματα ενός σχολίου πάνω στη θέση του κόμβου: βέλη για τις κινήσεις-πλάνα που αναφέρει (χωρίς αριθμό· με
 * «...» για τα μαύρα), βέλη για διαδρομές κομματιών («Nd2-f1-g3»), κόκκινα όταν μιλά για απειλή, και κύκλους:
 * κόκκινους στις αδυναμίες, πράσινους στα προκεχωρημένα/δυνατά τετράγωνα, κίτρινους στα τετράγωνα που τονίζει.
 */
export function commentShapes(text: string, fen: string, bare = false): Shape[] {
  const shapes: Shape[] = [];
  const has = (s: Shape) => shapes.some((x) => x.from === s.from && x.to === s.to);
  const push = (s: Shape) => {
    if (!has(s)) shapes.push(s);
  };
  const sentences = normalizeBookText(text).split(/(?<=[.;!?])\s+(?=[A-ZΑ-Ω"“(])/);
  for (const sentence of sentences) {
    const color = THREAT_RE.test(sentence) ? 'R' : 'G';
    const boards = { w: boardOf(fen), b: boardOf(fen) };
    // διαδρομές κομματιών: «Nb1-d2-f1-g3» από εκεί που είναι το κομμάτι, «Nbd2-f1-g3» / «Nd2-f1-g3» με πρώτη την κίνηση ως τη d2
    ROUTE_RE.lastIndex = 0;
    for (let m = ROUTE_RE.exec(sentence); m; m = ROUTE_RE.exec(sentence)) {
      const first = parseSquare(m[4]);
      const rest = m[5].split('-').filter(Boolean).map((x) => parseSquare(x));
      const black = Boolean(m[1]) || boards.w[first] === m[2].toLowerCase();
      const b = black ? boards.b : boards.w;
      const squares = [first, ...rest];
      if (m[3] || b[first] !== (black ? m[2].toLowerCase() : m[2])) {
        const lead = planArrow(b, m[2] + (m[3] ?? '') + m[4], !black);
        if (Array.isArray(lead)) squares.unshift(lead[0]);
      }
      for (let i = 0; i + 1 < squares.length; i++) push({ color, from: squares[i], to: squares[i + 1] });
    }
    // κινήσεις που αναφέρονται χωρίς αριθμό (όσες με αριθμό είναι ήδη βαριάντες στο δέντρο)
    const toks = tokenize([{ text: sentence, main: false }], bare);
    let seq = false;
    // λίστα κινήσεων μετά από λέξη πλάνου («the plan is 0-0, a4 and Rc1»)
    let inPlan = false;
    for (const t of toks) {
      if (t.k !== 'move') {
        if (t.k === 'text' && t.raw !== ' ' && !/^(and|or|και|ή|und|oder|,|then)$/i.test(t.raw)) {
          seq = false;
          inPlan = false;
        }
        continue;
      }
      if (t.num !== null) {
        seq = true;
        continue;
      }
      if (seq) continue;
      // μόνο ρητό πλάνο («the plan is Nd2», «with the idea …Qh4», «threatening Bxh7»): οι υπόλοιπες αναφορές σε
      // κινήσεις μέσα στο κείμενο έβγαζαν πάρα πολλά βέλη
      const before = toks.slice(Math.max(0, toks.indexOf(t) - 6), toks.indexOf(t)).map((x) => x.raw).join('');
      if (!inPlan && !STRICT_PLAN_RE.test(before)) continue;
      inPlan = true;
      let arrow = t.dots ? null : planArrow(boards.w, t.san, true);
      if (arrow === null) arrow = planArrow(boards.b, t.san, false);
      if (arrow && arrow !== 'there') push({ color, from: arrow[0], to: arrow[1] });
    }
  }
  const circle = (res: RegExp[], color: string) => {
    for (const re of res) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const sq = parseSquare(m[1]);
        if (sq >= 0 && !shapes.some((x) => x.from === sq && x.to === sq)) shapes.push({ color, from: sq, to: sq });
      }
    }
  };
  circle(WEAK_RES, 'R');
  // λίγα: τρία βέλη και ένας κύκλος το πολύ ανά σχόλιο
  const arrows = shapes.filter((s) => s.from !== s.to).slice(0, 3);
  const circles = shapes.filter((s) => s.from === s.to).slice(0, 1);
  return [...arrows, ...circles];
}

// ---------------------------------------------------------------------------
// το βιβλίο σε παρτίδες

const PART_RE = /^(part|μέρος|teil)\s+([IVXLC\d]+)\b/i;
const CHAPTER_RE = /^(chapter|κεφάλαιο|kapitel|глава)\s+(\d+|[a-z]+(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?)\b/i;
/** ενότητα «Game 7» (μία παρτίδα ανά ενότητα) */
const GAME_RE = /^game\s+(\d{1,3})\b/i;
/** «Game 10» και οι παίκτες με παύλα (ή «■») στην ίδια γραμμή, ίσως και ο τόπος με τη χρονιά. */
const GAME_LINE_RE = /^game\s+\d{1,3}\s+[A-Z][^!?\d]{0,40}?\s[–—■-]\s?[A-Z][^!?\d]{0,60}?(?:\b(?:1[5-9]|20)\d\d\b\.?)?$/i;
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40 };

/** Ο αριθμός του κεφαλαίου μιας επικεφαλίδας («Chapter 3», «Chapter Three», «Chapter III»)· null αν δεν είναι κεφάλαιο. */
function chapterOf(text: string): string | null {
  const m = CHAPTER_RE.exec(text);
  if (!m) return null;
  const w = m[2].toLowerCase().replace(/\s+/g, '-');
  if (/^\d+$/.test(w)) return w;
  const word = NUMBER_WORDS.indexOf(w);
  if (word >= 0) return String(word + 1);
  const tens = /^(twenty|thirty|forty)(?:-(\w+))?$/.exec(w);
  if (tens) {
    const unit = tens[2] ? NUMBER_WORDS.indexOf(tens[2]) + 1 : 0;
    return tens[2] && (unit < 1 || unit > 9) ? null : String(TENS[tens[1]] + unit);
  }
  const roman = /^(xl|x{0,3})(ix|iv|v?i{0,3})$/.exec(w);
  if (!roman) return null;
  const units = roman[2] === 'ix' ? 9 : roman[2] === 'iv' ? 4 : (roman[2].startsWith('v') ? 5 : 0) + (roman[2].match(/i/g)?.length ?? 0);
  return String((roman[1] === 'xl' ? 40 : roman[1].length * 10) + units);
}

/** Γράφει το βιβλίο τους αριθμούς των κινήσεων χωρίς τελεία («10 h4», «10 ... Nh4»); */
/**
 * Μια επικεφαλίδα συνεχίζει την προηγούμενη (τίτλος σε δύο γραμμές): η δεύτερη αρχίζει με πεζό, ή η πρώτη τελειώνει
 * σε παύλα, άνω και κάτω τελεία, κόμμα ή σε λέξη που δεν κλείνει φράση («of», «the», «and»)· όχι αν η δεύτερη είναι
 * ετικέτα ή νέα ενότητα («A) 4.d4», «II. …», «1.e4 e5»).
 */
function titleGoesOn(prev: string, next: string): boolean {
  if (LABEL_RE.test(next) || /^(?:[IVXLC]+|[A-Z]\d{0,2})\.\s/.test(next) || MOVE_HEAD_RE.test(normalizeBookText(next)) || chapterOf(next) !== null || PART_RE.test(next)) return false;
  if (/^\p{Ll}/u.test(next)) return true;
  return /(?:[\p{L}\d]-|[:,]|\b(?:of|the|and|or|to|with|a|an|in|on|for|by|against|versus|vs\.?|at|from|into|after|before))$/iu.test(prev.trim());
}

function bareNumbering(paragraphs: BookParagraph[]): boolean {
  const bare = new RegExp(String.raw`(?:^|\s)\d{1,3}\s${SAN_SRC}(?=[\s,;:!?+#)]|$)`, 'g');
  const dotted = new RegExp(String.raw`(?:^|[\s([])\d{1,3}\.\s?${SAN_SRC}(?=[\s,;:!?+#)\]]|$)`, 'g');
  let b = 0;
  let d = 0;
  for (const p of paragraphs) {
    const t = normalizeBookText(p.text);
    b += t.match(bare)?.length ?? 0;
    d += t.match(dotted)?.length ?? 0;
  }
  return b >= 20 && b > 3 * d;
}

/** Αριθμοί χωρίς τελεία: «επικεφαλίδα» που είναι κίνηση της κύριας γραμμής σε μεγάλα γράμματα («11 Nxh4», «10.1 7 Nf3»). */
const MOVE_HEAD_RE = new RegExp(String.raw`^\d{1,3}\s?\.(?:\s?\.\.)?\s?${SAN_SRC}`);
// (αριθμός ως 2 και πάνω ή «1...», ή κίνηση χωρίς αριθμό στην αρχή· και σύμβολο που χάθηκε, «34...gf5», «49.♗5 ♖e8»)
const MID_MOVE_HEAD_RE = new RegExp(String.raw`^(?:(?:[2-9]|\d{2,3})\s?\.(?:\s?\.\.)?\s?\S|1\s?\.\s?\.\.\s?\S|${SAN_SRC}[!?†‡+#±∓=∞□]*(?:\s|$))(?=.*[a-h][1-8])`);
function midMoveHead(text: string): boolean {
  const norm = normalizeBookText(text);
  return MID_MOVE_HEAD_RE.test(norm) && !/(?<![\p{L}\d])\p{L}{3,}(?![\p{L}\d])/u.test(norm.replace(/[KQRBN-]/g, ' '));
}
const BARE_MOVE_HEAD_RE = new RegExp(String.raw`^(?:\d{1,2}\.\d{1,3}\s+)?\d{1,3}\s*(?:\.\.\.\s*)?${SAN_SRC}`);
// το «Conclusion» ενός κεφαλαίου
const CONCLUSION_RE = /^(?:conclusions?|summary|in conclusion|verdict|final remarks|συμπέρασμα|συμπεράσματα|σύνοψη|fazit|zusammenfassung)[.:]?$/i;
// (και τα ευρετήρια και η βιβλιογραφία στο τέλος του βιβλίου)
const TOC_RE = /^(table of contents|contents|spis treści|περιεχόμενα|inhalt|inhaltsverzeichnis|содержание|index of (?:games|players|variations|openings|names)|bibliography)\b/i;
const SKIP_RE = /^(chapter guide|show in text mode|show\/hide solution|show\/hide|solution)$/i;
/** Γραμμή παικτών πριν από παρτίδα: «Kochiev — Ivanov USSR 1976», «B. Schneider – Kirst, Porz 1992» */
const PLAYERS_RE = /^((?:[A-Z][\p{L}'.]*\.?\s)?[A-Z][\p{L}'-]+(?:\s[A-Z][\p{L}'-]+)?)(?:\s[—–-]\s|\s?[—–]\s?)([A-Z][\p{L}'-]+)(?:,?\s+([^\d]*?))?(?:,?\s*((?:1[5-9]|20)\d\d))?\.?$/u;
const EXERCISE_HEAD_RE =/^[^\d[\]]{2,40},\s?[A-ZΑ-Ω][^\d]{0,4}\s?[–-]\s?[^\d[\]]{2,40}(,\s?[A-ZΑ-Ω][^\d]{0,4})?$/;

/** Μετρήσεις ενός δέντρου. */
function countTree(root: GameNode, st: BookStats): void {
  const walk = (n: GameNode) => {
    if (n.comment) st.comments++;
    if (n.preComment) st.comments++;
    st.nags += n.nags.length;
    for (const s of n.shapes) {
      if (s.from === s.to) st.circles++;
      else st.arrows++;
    }
    n.children.forEach((c, i) => {
      st.moves++;
      if (i > 0) st.variations++;
      walk(c);
    });
  };
  walk(root);
}

/**
 * Αριθμοί χωρίς τελεία: κάθε ενότητα του κεφαλαίου («1.41 6 Be2») σε δική της παρτίδα, με τις κινήσεις ως εκεί όπου
 * ξεκινά (χωρίς τα σχόλιά τους) και όλη την ανάλυσή της· στο κεφάλαιο μένει ό,τι δεν ανήκει σε ενότητα. Οι βαθύτερες
 * ενότητες πρώτες, ώστε μια υπο-ενότητα να μη μείνει και μέσα στη γονική της. Η σειρά του βιβλίου κρατιέται.
 */
function splitSections(chapter: Game, sections: Array<{ title: string; node: GameNode }>): Array<{ title: string; game: Game }> {
  // μία φορά κάθε ενότητα (ο κατάλογος στην αρχή του κεφαλαίου την αναφέρει και πριν από την ανάλυσή της)
  const byNode = new Map<GameNode, string>();
  for (const s of sections) byNode.set(s.node, s.title);
  const made = new Map<GameNode, Game>();
  const inTree = (n: GameNode) => {
    let x: GameNode = n;
    while (x.parent) {
      if (!x.parent.children.includes(x)) return false;
      x = x.parent;
    }
    return x === chapter.root;
  };
  for (const node of [...byNode.keys()].sort((a, b) => b.ply - a.ply)) {
    if (!node.parent || !inTree(node)) continue;
    const g = new Game();
    let at = g.root;
    const path: GameNode[] = [];
    for (let n = node.parent; !n.isRoot; n = n.parent!) path.unshift(n);
    for (const n of path) at = g.addMove(at, n.move);
    const copy = (src: GameNode, parent: GameNode) => {
      const c = g.addMove(parent, src.move);
      c.comment = src.comment;
      c.preComment = src.preComment;
      c.nags = [...src.nags];
      c.shapes = [...src.shapes];
      for (const k of src.children) copy(k, c);
    };
    copy(node, at);
    node.parent.children.splice(node.parent.children.indexOf(node), 1);
    made.set(node, g);
  }
  return [...byNode.entries()].filter(([node]) => made.has(node)).map(([node, title]) => ({ title, game: made.get(node)! }));
}

/** Τα σχήματα των σχολίων σε όλο το δέντρο (`bare`: αριθμοί χωρίς τελεία). */
/** Ερώτηση άσκησης που μένει σχόλιο στην αρχή της («White to play and win», «Black to move»). */
const QUESTION_RE = /\b(?:to (?:move|play)|wins?|draws?|mate in \d|find|παίζει|κερδίζει|ισοπαλία|ματ σε|zieht|gewinnt)\b|\?\s*$/i;
/** Αρχή λύσης: ο αριθμός της άσκησης («29.», «29)», «(29)***», «Exercise 29:») και μετά επικεφαλίδα ή κινήσεις. */
const SOLUTION_RE = /^\s*(?:(?:exercise|ex\.|position|puzzle|problem|test|diagram|άσκηση|θέση|aufgabe)\s*)?\(?(\d{1,4})\s*([.):])?\**\s+(\S.*)$/i;
/** Κωδικός άσκησης με γράμμα και κεφάλαιο («E3.01 **»): κάτω από το διάγραμμα, και στην αρχή της λύσης. */
const CODE_LABEL_RE = /^\s*(?:[WB]\s+)?([A-Z]\d{1,2}\.\d{1,3})(?=[\s*/]|$)/;
const CODE_SOLUTION_RE = /^\s*([A-Z]\d{1,2}\.\d{1,3})()\s+(\S.*)$/;
/** Ο αριθμός της άσκησης όπως τον κρατά η `diagram.label`: «07» = «7», ο κωδικός «E3.01» όπως είναι. */
const labelOf = (s: string) => (/^\d+$/.test(s) ? String(Number(s)) : s);
/** Η πρώτη κίνηση με αριθμό μέσα στο κείμενο (και με σύμβολα κομματιών). */
/** Η πρώτη κίνηση και με αριθμό χωρίς τελεία («1 ♖a8»): μόνο μετά από κωδικό άσκησης. */
const BARE_FIRST_MOVE_RE = /(?:^|\s)\d{1,3}\s?(?:\.(?:\s?\.\.)?|…)?\s?(?:[KQRBN¢£¤¥¦-♔-♟]\s?[a-h1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O|0-0)/;
const FIRST_MOVE_RE = /(?:^|\s)\d{1,3}\s?\.(?:\s?\.\.|…)?\s?(?:[KQRBN-¢£¤¥¦-♔-♟]\s?[a-h1-8]?x?[a-h][1-8]|[a-h]x?[a-h]?[1-8]|O-O|0-0)/;
/** Το τέλος της επικεφαλίδας μιας λύσης («Capablanca – Mieses, Bad Kissingen 1928»): μετά τη χρονιά. */
const HEAD_END_RE = /^[^\d]{2,80}?\s[–—-]\s?[^\d]{2,80}?,[^\d]*?(?:\(\d{1,2}[^)]*\)[^\d]*?)?\b(?:1[5-9]|20)\d\d\b\.?/;

/** «Jose Raul Capablanca – T.A. Carter, Saint Louis (simul) 1909» → παίκτες, τόπος, χρονιά. */
const NAME_PARTICLE_RE = /^(?:van|von|de|der|den|da|di|du|le|la|ter|ten|dos|del|della|zu)$/i;
/**
 * Όνομα παίκτη όπως στις PGN, «Επώνυμο, Όνομα» («Mikhail Tal» → «Tal, Mikhail», «H.V. von Hartingsveldt» → «von
 * Hartingsveldt, H.V.»): η αναζήτηση της βάσης ψάχνει από την αρχή του επωνύμου.
 */
export function pgnName(name: string): string {
  // (βιβλίο από εικόνα: ονόματα κολλημένα, «ShakhriyarMamedyarov», «LeifErlandJohannessen»· όχι «McDonald», «MacKenzie»)
  const t = imageText ? name.trim().replace(/(\p{Lu}\p{Ll}{3,})(?=\p{Lu}\p{Ll}{2,})/gu, '$1 ') : name.trim();
  const w = t.split(/\s+/);
  if (w.length < 2 || t.includes(',') || /^(?:jr|sr)\.?$/i.test(w[w.length - 1])) return t;
  let k = w.length - 1;
  while (k > 1 && NAME_PARTICLE_RE.test(w[k - 1])) k--;
  return `${w.slice(k).join(' ')}, ${w.slice(0, k).join(' ')}`;
}

export function exerciseHeaders(head: string): { white: string; black: string; site: string; year: string } {
  const t = head.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  const m = /^(.+?)\s[–—-]\s?([^,]+?)(?:,\s*(.*?))?(?:,?\s*\b((?:1[5-9]|20)\d\d)\b)?\.?$/.exec(t);
  if (!m || m[1].length > 60 || /\d\s?\.\s?[a-hKQRBNO]/.test(t)) return { white: '', black: '', site: '', year: '' };
  return { white: pgnName(m[1]), black: pgnName(m[2]), site: (m[3] ?? '').trim(), year: m[4] ?? '' };
}

const NAME_LINE_RE = /^(\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|van|von|de|der|den|da|di|du|le|la|ter|ten|dos|del|della|zu)){0,3})(?:\s+(\d{4}))?$/u;
const SITE_LINE_RE = /^(.*?),?\s*((?:1[5-9]|20)\d\d)(?:\/\d\d)?(?:\s*\([\d.]+\))?\.?$/;

/**
 * Κεφαλίδα παρτίδας σε χωριστές γραμμές («Game 4» / «White» / «Black» / «City Year» / «1.e4 e5 …», και με Elo): οι
 * παίκτες, ο τόπος, η χρονιά, και πού αρχίζουν οι κινήσεις.
 */
export function gameHeadOf(p: BookParagraph): { white: string; black: string; whiteElo: string; blackElo: string; site: string; year: string; end: number } | null {
  const starts = p.lineStarts;
  if (!starts || starts.length < 2) return null;
  const line = (i: number) => p.text.slice(i ? starts[i - 1] : 0, starts[i] ?? p.text.length).trim();
  const w = NAME_LINE_RE.exec(line(0));
  const b = NAME_LINE_RE.exec(line(1));
  if (!w || !b) return null;
  const moves = (from: number) => /^\d{1,3}\s?\./.test(normalizeBookText(p.text.slice(from).trimStart()));
  // (μετά τον τόπο και τη χρονιά μπορεί να ακολουθεί εισαγωγή σε πρόζα πριν από τις κινήσεις)
  const s = starts.length >= 2 ? SITE_LINE_RE.exec(line(2)) : null;
  const end = s ? (starts[2] ?? p.text.length) : moves(starts[1] ?? p.text.length) ? (starts[1] ?? p.text.length) : -1;
  if (end < 0 || /^\d/.test(line(1))) return null;
  const site = s ? s[1].trim() : '';
  const year = s ? s[2] : '';
  return { white: w[1], black: b[1], whiteElo: w[2] ?? '', blackElo: b[2] ?? '', site, year, end };
}

// δύο ονόματα με παύλα, ως 4 λέξεις το καθένα («S.P. Sethuraman», «Vallejo Pons», «N.N.», κολλημένα από εικόνα «SuatAtalik»)
const EXAMPLE_NAME = String.raw`\p{Lu}[\p{L}'’.-]*(?:\s(?:\p{Lu}[\p{L}'’.-]*|van|von|de|der|den|da|di|du|le|la|ter|ten|dos|del|della|zu)){0,3}`;
const EXAMPLE_PAIR_RE = new RegExp(String.raw`^(${EXAMPLE_NAME})(?:\s?[–—]\s?|\s-\s)(${EXAMPLE_NAME})$`, 'u');
const EXERCISE_SOURCE_RE = /^(?:[a-hA-H]\s){0,8}(\p{Lu}[\p{L}'’. -]{1,40}?)\s?[–—]\s?(\p{Lu}[\p{L}'’. -]{1,40}?),\s*([^\d,]{1,40}?),?\s*((?:1[5-9]|20)\d\d)\b\.?\s*/u;
const NUMBERED_PAIR_RE = /^\d{1,3}\s?[.)]\s*(\p{Lu}[\p{L}'’. ]{1,30}?)\s[-–—]\s(\p{Lu}[\p{L}'’. ]{1,30})$/u;

/**
 * Αριθμημένη ολόκληρη παρτίδα («Complete Games»): «1. Enklaar - Andersson» / «Amsterdam 1973» /
 * «1.e4 c5 …», σε μία παράγραφο (γραμμές) ή σε τρεις (`next`, `after`: οι επόμενες παράγραφοι). `end`: πού αρχίζουν οι
 * κινήσεις στην παράγραφο· `skip`: πόσες επόμενες παράγραφοι είναι ακόμη κεφαλίδα.
 */
export function numberedGameHead(p: BookParagraph, next?: BookParagraph, after?: BookParagraph): { white: string; black: string; site: string; year: string; end: number; skip: number } | null {
  const fromOne = (t: string) => /^1\s?\.\s?\S/.test(normalizeBookText(t.trimStart()));
  const starts = p.lineStarts ?? [];
  const line = (i: number) => p.text.slice(i ? starts[i - 1] : 0, starts[i] ?? p.text.length).trim();
  const pair = NUMBERED_PAIR_RE.exec(line(0));
  if (!pair) return null;
  const out = (site: RegExpExecArray, end: number, skip: number) => ({ white: pair[1].trim(), black: pair[2].trim(), site: site[1].trim(), year: site[2], end, skip });
  if (starts.length >= 2) {
    const s = SITE_LINE_RE.exec(line(1));
    return s && fromOne(p.text.slice(starts[1])) ? out(s, starts[1], 0) : null;
  }
  if (starts.length === 1) {
    // (οι παίκτες και ο τόπος μαζί, οι κινήσεις στην επόμενη παράγραφο)
    const s = SITE_LINE_RE.exec(line(1));
    return s && next && !next.heading && fromOne(next.text) ? out(s, p.text.length, 0) : null;
  }
  const s = next && !next.heading && !next.diagram ? SITE_LINE_RE.exec(next.text.trim()) : null;
  if (!s || s[1].length > 60) return null;
  return after && !after.heading && fromOne(after.text) ? out(s, p.text.length, 1) : null;
}

/**
 * Οι παίκτες μιας παρτίδας «Game N» («□ G.Greco ■ anonymous», «A.White ■ B.Black City 2005»), ίσως με τόπο και χρονιά.
 * Από εικόνα τα τετράγωνα συχνά χάνονται («G.Greco anonymous»): τότε δύο ονόματα με αρχικά («X.Επώνυμο»). Τα ονόματα σε
 * μορφή PGN («Greco, G.»).
 */
export function gamePlayers(text: string): { white: string; black: string; site: string; year: string } | null {
  // (κολλημένα από εικόνα: «L.NisipeanuZ.Hracek»)
  const t = text.replace(/[□☐]/g, ' ').replace(/\s*■\s*/g, ' ■ ').replace(/(\p{Ll})(\p{Lu}\.)/gu, '$1 $2').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 90 || /\d\s?\.?\s?(?:\.\.\.)?\s?[KQRBN]?[a-h][1-8]/.test(t)) return null;
  const words = t.split(' ');
  // (και αρχικά με περισσότερα γράμματα: «Kir.Georgiev», «Ki.Georgiev»)
  const INITIALS = /^((?:\p{Lu}\p{Ll}{0,2}\.-?){1,3})(\p{L}[\p{L}'’-]*)$/u;
  const anon = (w: string) => /^(?:anonymous|NN|N\.N\.?)$/i.test(w);
  // πόσες λέξεις έχει το όνομα που αρχίζει στη λέξη `at` (0: δεν είναι όνομα)· «N.De Firmian», «J.van der Wiel»
  const nameAt = (at: number): number => {
    const w = words[at];
    if (!w) return 0;
    if (anon(w)) return 1;
    const m = INITIALS.exec(w);
    if (!m || !/^\p{Lu}/u.test(m[2]) && !NAME_PARTICLE_RE.test(m[2])) return 0;
    let k = 1;
    let last = m[2];
    while (NAME_PARTICLE_RE.test(last) && words[at + k] && /^\p{L}/u.test(words[at + k])) last = words[at + k++];
    return k;
  };
  const pgn = (ws: string[]): string => {
    const s = ws.join(' ');
    if (anon(s)) return s;
    const m = /^((?:\p{Lu}\p{Ll}{0,2}\.-?){1,3})\s?(.+)$/u.exec(s);
    return m ? `${m[2]}, ${m[1]}` : s;
  };
  let white: string[];
  let at: number;
  const box = words.indexOf('■');
  if (box > 0) {
    // (με το τετράγωνο: ο λευκός είναι ό,τι προηγείται, και χωρίς αρχικά)
    white = words.slice(0, box);
    if (white.length > 4 || !white.every((w) => /^\p{Lu}/u.test(w) || NAME_PARTICLE_RE.test(w) || anon(w))) return null;
    at = box + 1;
  } else {
    const k = nameAt(0);
    if (!k) return null;
    white = words.slice(0, k);
    at = k;
  }
  const kb = nameAt(at);
  if (!kb) return null;
  let black = words.slice(at, at + kb);
  const rest = words.slice(at + kb).join(' ');
  let site = '';
  let year = '';
  if (rest) {
    const s = SITE_LINE_RE.exec(rest);
    // (με το τετράγωνο και χωρίς χρονιά, ο μαύρος είναι ό,τι ακολουθεί: «M.Adams ■ M.Santo Roman»)
    if (!s && box > 0 && words.length - at <= 3 && words.slice(at).every((w) => /^\p{Lu}/u.test(w) || NAME_PARTICLE_RE.test(w))) black = words.slice(at);
    else if (!s || s[1].length > 50) return null;
    else {
      site = s[1].trim();
      year = s[2];
    }
  }
  return { white: pgn(white), black: pgn(black), site, year };
}

/** Τα κομμάτια μιας παραγράφου χωρίς τους πρώτους `from` χαρακτήρες. */
/** Τα κομμάτια ως τη θέση `to` του κειμένου (το αντίστροφο της `sliceRuns`). */
function runsUpTo(runs: BookRun[], to: number): BookRun[] {
  const out: BookRun[] = [];
  for (const r of runs) {
    if (to <= 0) break;
    out.push({ ...r, text: r.text.slice(0, to) });
    to -= r.text.length;
  }
  return out;
}

/** «If Black is to move, he draws: 1...♔e5!» σε θέση όπου ξεκίνησε ο Λευκός, και το αντίστροφο (θέσεις «W/B»). */
// (μόνο «to move» κοντά στο χρώμα, και «1» ολόκληρος αριθμός: όχι «would allow Black to play 21...♗h6»)
const WB_BLACK_RE = /\bBlack\b[^.;]{0,12}?\bto move\b[^.;]{0,40}?(?=\s?\b1\s?(?:\.\.\.|…)\s?\S)/;
const WB_WHITE_RE = /\bWhite\b[^.;]{0,12}?\bto move\b[^.;]{0,40}?(?=\s?\b1\s?\.?\s?(?![.…\d])\S)/;

function sliceRuns(runs: BookRun[], from: number): BookRun[] {
  const out: BookRun[] = [];
  for (const r of runs) {
    if (from >= r.text.length) {
      from -= r.text.length;
      continue;
    }
    out.push({ ...r, text: r.text.slice(from) });
    from = 0;
  }
  return out;
}

/** Ταιριάζει η πρώτη κίνηση του κειμένου στη θέση του διαγράμματος; `null`: το κείμενο δεν έχει κίνηση. */
function firstMoveFits(d: BookDiagram, text: string, bare: boolean): boolean | null {
  const t = tokenize([{ text: normalizeBookText(text), main: false }], bare).find((x): x is Extract<Token, { k: 'move' }> => x.k === 'move');
  if (!t) return null;
  const sides: Array<'w' | 'b'> = t.num !== null ? [t.black ? 'b' : 'w'] : ['w', 'b'];
  return sides.some((side) => {
    try {
      return sanIn(Position.fromFen(diagramFen(d.placement, side, t.num ?? 1)), t.san) !== 0;
    } catch {
      return false;
    }
  });
}

/**
 * Βιβλία ασκήσεων: οι λύσεις (συνήθως στο τέλος του βιβλίου ή του κεφαλαίου) με τον αριθμό της άσκησης στην
 * αρχή («29. Capablanca – Carter, Saint Louis 1909 28.Qg7+! …»). Κάθε λύση πάει στο πρώτο διάγραμμα με αυτόν τον
 * αριθμό που δεν έχει ακόμη λύση και όπου η πρώτη κίνησή της είναι νόμιμη. Οι παράγραφοι που ακολουθούν, ως την
 * επόμενη λύση ή επικεφαλίδα, είναι κι αυτές της λύσης.
 */
/**
 * Αριθμοί ασκήσεων με τυπογραφικό λάθος στο PDF (στη σελίδα 625, 262, 267, 628, 629, 630 ή 878, 878, 879…): σε κάθε
 * σελίδα οι αριθμοί είναι συνεχόμενοι με τη σειρά ανάγνωσης (κατά στήλες ή κατά γραμμές)· όταν ταιριάζουν όλοι εκτός
 * από έναν ή δύο, αυτοί παίρνουν τον αριθμό της θέσης τους.
 */
function repairLabels(paras: BookParagraph[]): void {
  const pages = new Map<number, number[]>();
  paras.forEach((p, i) => {
    // (όχι διαγράμματα-εικόνες: εκεί η σειρά ανάγνωσης από τις θέσεις τους σε δύο στήλες βγαίνει λάθος και άλλαζε
    // σωστούς αριθμούς· τα λάθη τους λύνονται από τους παίκτες της λεζάντας, `linkExercises`)
    if (p.diagram?.label && p.diagram.x !== undefined && p.diagram.id === undefined) pages.set(p.page, [...(pages.get(p.page) ?? []), i]);
  });
  for (const idx of pages.values()) {
    if (idx.length < 4) continue;
    const d = (i: number) => paras[i].diagram!;
    const width = Math.max(...idx.map((i) => d(i).x!)) - Math.min(...idx.map((i) => d(i).x!));
    const col = (i: number) => Math.round((d(i).x! - Math.min(...idx.map((j) => d(j).x!))) / Math.max(1, width / 2));
    const orders = [
      [...idx].sort((a, b) => col(a) - col(b) || d(b).y! - d(a).y!),
      [...idx].sort((a, b) => d(b).y! - d(a).y! || d(a).x! - d(b).x!),
    ];
    let best: { order: number[]; lo: number; hits: number } | null = null;
    for (const order of orders) {
      for (let k = 0; k < order.length; k++) {
        const lo = Number(d(order[k]).label) - k;
        const hits = order.filter((i, j) => Number(d(i).label) === lo + j).length;
        if (!best || hits > best.hits) best = { order, lo, hits };
      }
    }
    if (!best || best.hits < 3 || best.hits < idx.length - 2 || best.hits === idx.length) continue;
    const { order, lo } = best;
    order.forEach((i, j) => {
      if (Number(d(i).label) !== lo + j) paras[i] = { ...paras[i], diagram: { ...d(i), label: String(lo + j) } };
    });
  }
}

/** Οι ασκήσεις κάθε σελίδας με τη σειρά των αριθμών τους (στις δύο στήλες η σειρά ανάγνωσης βγάζει 1, 4, 2, 5…). */
function orderExercises(paras: BookParagraph[]): void {
  const pages = new Map<number, number[]>();
  paras.forEach((p, i) => {
    if (p.diagram?.label) pages.set(p.page, [...(pages.get(p.page) ?? []), i]);
  });
  for (const slots of pages.values()) {
    const sorted = slots.map((i) => paras[i]).sort((a, b) => Number(a.diagram!.label) - Number(b.diagram!.label));
    slots.forEach((i, k) => (paras[i] = sorted[k]));
  }
}

/**
 * Ο τίτλος μιας λύσης («Player Year ...») ξεκινά με τις πρώτες (ως 3) λέξεις της λεζάντας
 * του διαγράμματος `d` ή μιας επικεφαλίδας της σελίδας του (δύο διαγράμματα δίπλα δίπλα: οι επικεφαλίδες τους
 * ενώνονται σε μία γραμμή, και η `orderExercises` αλλάζει τη σειρά των διαγραμμάτων, άρα αρκεί να περιέχεται).
 */
function repeatsTitle(paras: BookParagraph[], d: number, rest: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const words = norm(rest).split(' ');
  const page = paras[d].page;
  const titles = [paras[d].diagram?.caption ?? ''];
  for (let j = d - 1, seen = 0; j >= 0 && (seen < 3 || paras[j].page === page); j--) {
    if (paras[j].diagram) continue;
    seen++;
    if (paras[j].heading) titles.push(paras[j].text);
  }
  for (let j = d + 1; j < paras.length && paras[j].page === page; j++) if (paras[j].heading) titles.push(paras[j].text);
  // οι πρώτες 3 ή 2 λέξεις (μετά τον τίτλο μπορεί να ακολουθεί το πλαίσιο του περιθωρίου: «Pál Benkö There is…»)
  for (const n of [3, 2]) {
    const key = words.slice(0, n).join(' ');
    if (words.length < n || key.length < 8 || /^\d/.test(key)) continue;
    if (titles.some((t) => norm(t).includes(key))) return true;
  }
  return false;
}

/** Τα επώνυμα των δύο παικτών μιας επικεφαλίδας ή λεζάντας («S. Savchenko – Svidler, Kjellerup 1993» → «savchenko|svidler»). */
function playersKey(text: string): string {
  const m = /^\s*(?:\d{1,3}[.)]\s*)?(.+?)\s[–—-]\s*([^,]+)/.exec(text.replace(/\s+/g, ' '));
  if (!m) return '';
  const last = (s: string) => (s.trim().split(' ').pop() ?? '').toLowerCase().replace(/[^\p{L}]/gu, '');
  const a = last(m[1]);
  const b = last(m[2]);
  return a.length >= 3 && b.length >= 3 ? `${a}|${b}` : '';
}

function linkExercises(paras: BookParagraph[], bare: boolean): { solutions: Map<number, { head: string; paras: BookParagraph[]; loose?: boolean; intro?: string }>; consumed: Set<number> } {
  const solutions = new Map<number, { head: string; paras: BookParagraph[]; loose?: boolean; intro?: string }>();
  const consumed = new Set<number>();
  const byLabel = new Map<string, number[]>();
  // (και με τους παίκτες της λεζάντας: σε δύο στήλες διαγραμμάτων από εικόνα ο αριθμός πάει καμιά φορά στη διπλανή
  // σκακιέρα)
  const byPlayers = new Map<string, number[]>();
  // κωδικοί ασκήσεων κάτω από το διάγραμμα («W», «E3.01 **», ερώτηση): η ετικέτα του διαγράμματος,
  // όταν το βιβλίο έχει τουλάχιστον 3 τέτοιους
  const codes: Array<[number, string]> = [];
  const codeLines = new Set<number>();
  paras.forEach((p, i) => {
    if (!p.diagram || p.diagram.label) return;
    for (let j = i + 1; j <= i + 2 && j < paras.length && !paras[j].diagram; j++) {
      const c = CODE_LABEL_RE.exec(paras[j].text);
      if (c) {
        codes.push([i, c[1]]);
        codeLines.add(j);
        break;
      }
      if (!/^\s*[WB]\s*$/.test(paras[j].text)) {
        // (ο κωδικός μπλεγμένος στο κείμενο της διπλανής στήλης, «…advanced to E6.20 the seventh rank. /** 1 ♖h7+»:
        // όταν η παράγραφος έχει ακριβώς έναν)
        const inline = j === i + 1 ? [...paras[j].text.matchAll(/(?:^|\s)([A-Z]\d{1,2}\.\d{2,3})(?=\s)/g)] : [];
        if (inline.length === 1) {
          codes.push([i, inline[0][1]]);
          codeLines.add(j);
        }
        break;
      }
    }
  });
  if (codes.length >= 3) for (const [i, code] of codes) paras[i] = { ...paras[i], diagram: { ...paras[i].diagram!, label: code } };
  paras.forEach((p, i) => {
    if (p.diagram?.label) byLabel.set(p.diagram.label, [...(byLabel.get(p.diagram.label) ?? []), i]);
    // (διάγραμμα-εικόνα χωρίς λεζάντα: η σύντομη παράγραφος ακριβώς από πάνω του, «Nebolsina – N. Kosintseva, Moscow
    // 2010», όταν η διάταξη τη χώρισε από το διάγραμμα)
    const above = p.diagram && !p.diagram.caption && p.diagram.id !== undefined && i > 0 && !paras[i - 1].diagram && paras[i - 1].text.length < 90 && !/\d\s?\.\s?[a-hKQRBNO-]/.test(paras[i - 1].text) ? paras[i - 1].text : '';
    const key = p.diagram?.caption ? playersKey(p.diagram.caption) : above ? playersKey(above) : '';
    if (key) byPlayers.set(key, [...(byPlayers.get(key) ?? []), i]);
  });
  if (byLabel.size < 2) return { solutions, consumed };
  let cur: { head: string; paras: BookParagraph[]; titled?: boolean; intro?: string; d?: number } | null = null;
  let lastLabel = -1;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    // (όχι η ίδια η γραμμή του κωδικού κάτω από το διάγραμμα)
    const code = byLabel.size && !codeLines.has(i) && CODE_SOLUTION_RE.exec(p.text);
    const m = code && byLabel.has(code[1]) ? code : SOLUTION_RE.exec(p.text);
    const ds = m ? (byLabel.get(labelOf(m[1])) ?? []).filter((d) => d < i && !solutions.has(d)) : [];
    // λύση με επικεφαλίδα («3. Title Year»): δεκτή μόνο όταν επαναλαμβάνει τον τίτλο
    // πάνω από το διάγραμμα της άσκησης (όχι αριθμημένη επικεφαλίδα κεφαλαίου)
    const titled = p.heading && !p.diagram && m ? ds.find((d) => repeatsTitle(paras, d, m[3])) : undefined;
    if (titled !== undefined) {
      cur = { head: m![3].trim(), paras: [], titled: true, d: titled };
      solutions.set(titled, cur);
      consumed.add(i);
      lastLabel = Number(m![1]);
      continue;
    }
    if (p.diagram || p.heading || p.centered) {
      // (λεζάντα στο περιθώριο αμέσως μετά την επικεφαλίδα της λύσης: μένει στη λύση)
      if (cur?.titled && !cur.paras.length && p.centered && !p.heading && !p.diagram) {
        cur.intro = [cur.intro, p.text].filter(Boolean).join(' ');
        consumed.add(i);
        continue;
      }
      cur = null;
      continue;
    }
    // πλαίσιο στο περιθώριο δίπλα στην επικεφαλίδα της λύσης («There is 1 extra exercise… 1) After 5.♔b3? …»): σχόλιο
    // στην αρχή, όχι κινήσεις της λύσης (θα ξεκινούσαν τη γραμμή από λάθος θέση)
    if (cur?.titled && !cur.paras.length && p.indent >= 100) {
      // (η πρώτη παράγραφος της λύσης μπορεί να ενώθηκε με το πλαίσιο: «…in Chapter 6. 1.♘f3 ♔c4 2.♔g5!»· χωρίζεται
      // στην πρώτη κίνηση της κύριας γραμμής μετά από τέλος πρότασης που παίζεται στη θέση της άσκησης)
      let at = 0;
      let split = -1;
      for (const r of p.runs) {
        if (r.main && /^\s*\d{1,3}\s?\./.test(r.text) && /[.:!?]\s*$/.test(p.text.slice(0, at)) && firstMoveFits(paras[cur.d!].diagram!, r.text, bare)) {
          split = at;
          break;
        }
        at += r.text.length;
      }
      cur.intro = [cur.intro, split < 0 ? p.text : p.text.slice(0, split)].filter(Boolean).join(' ').trim();
      if (split >= 0) cur.paras.push({ ...p, runs: sliceRuns(p.runs, split), text: p.text.slice(split), indent: 0 });
      consumed.add(i);
      continue;
    }
    if (m && (ds.length || byPlayers.size)) {
      const rest = m[3];
      const restAt = p.text.length - rest.length;
      const moveFirst = /^(?:\d{1,3}\s?\.|[KQRBN¢£¤¥¦♔-♟]\s?x?[a-h1-8]|[a-h]x?[a-h]?[1-8]|O-O|0-0)/.test(rest);
      // «29. Qg7+» μπορεί να είναι και η κίνηση 29 της προηγούμενης λύσης: δεκτό μόνο ως ο επόμενος αριθμός ή με «)» / «:»
      const plausible = !moveFirst || m[2] === ')' || m[2] === ':' || Number(m[1]) === lastLabel + 1 || /^\d{1,3}\s?\./.test(rest);
      const mv = moveFirst ? { index: 0 } : (HEAD_END_RE.exec(rest)?.[0] ? { index: HEAD_END_RE.exec(rest)![0].length } : (FIRST_MOVE_RE.exec(rest) ?? (m === code ? BARE_FIRST_MOVE_RE.exec(rest) : null)));
      const at = mv ? mv.index : rest.length;
      const head = rest.slice(0, at).trim();
      const sol = rest.slice(at);
      if (plausible && (head || sol.trim())) {
        const key = head ? playersKey(head) : '';
        const named = key ? (byPlayers.get(key) ?? []).filter((x) => x < i && !solutions.has(x) && (paras[x].diagram!.label || paras[x].diagram!.id !== undefined)).reverse() : [];
        // (σε διάγραμμα-εικόνα, όπου ο αριθμός είναι ανάγνωση, «22» → «2», πρώτα οι παίκτες· αλλιώς πρώτα ο αριθμός όταν η
        // πρώτη κίνηση παίζεται εκεί, και οι παίκτες μόνο με κοντινό αριθμό, ανταλλαγή στην ίδια σελίδα: σε βιβλίο
        // τακτικής οι ίδιοι παίκτες ξαναβγαίνουν)
        const fitsAt = (x: number) => firstMoveFits(paras[x].diagram!, sol, bare) === true;
        const named2 = (image: boolean) => named.find((x) => (paras[x].diagram!.id !== undefined) === image && (image || Math.abs(Number(paras[x].diagram!.label) - Number(m[1])) <= 4) && firstMoveFits(paras[x].diagram!, sol, bare) !== false);
        // (ο κωδικός «E3.01» είναι σίγουρος: η πρώτη άσκηση με αυτόν που δεν έχει λύση)
        let d = m === code ? ds[0] : named2(true) ?? ds.find(fitsAt) ?? named2(false) ?? ds.find((x) => {
          const fits = firstMoveFits(paras[x].diagram!, sol, bare);
          // χωρίς τελεία/παρένθεση μετά τον αριθμό («44 Euwe – Solutions page 231» είναι κεφαλίδα σελίδας): μόνο με κίνηση που ταιριάζει
          return fits ?? (Boolean(head) && Boolean(m[2]));
        });
        // λύση με κανονική επικεφαλίδα («11. Mackenzie – Steinitz, Vienna 1882») που δεν ταιριάζει στο διάγραμμα (λάθος
        // του βιβλίου ή του PDF): πάει στην άσκηση ως κείμενο, όχι σε άλλη λύση
        const loose = d === undefined && Boolean(m[2]) && Boolean(exerciseHeaders(head).white);
        if (loose) d = ds[0];
        if (d !== undefined) {
          // (διάγραμμα που βρέθηκε από τους παίκτες χωρίς αριθμό: παίρνει τον αριθμό της λύσης, για να γίνει άσκηση)
          if (!paras[d].diagram!.label) paras[d] = { ...paras[d], diagram: { ...paras[d].diagram!, label: labelOf(m[1]) } };
          const from = restAt + at;
          cur = { head, paras: sol.trim() ? [{ ...p, runs: sliceRuns(p.runs, from), text: p.text.slice(from) }] : [], ...(loose ? { loose } : {}) };
          solutions.set(d, cur);
          consumed.add(i);
          lastLabel = Number(m[1]);
          continue;
        }
      }
    }
    if (cur) {
      cur.paras.push(p);
      consumed.add(i);
    }
  }
  return { solutions, consumed };
}

function addShapes(root: GameNode, bare: boolean): void {
  const walk = (n: GameNode) => {
    const text = [n.preComment, n.comment].filter(Boolean).join(' ');
    // το σχόλιο πριν από μια κίνηση αφορά τη θέση πριν από αυτήν
    // όχι στη θέση πριν από την πρώτη κίνηση: η εισαγωγή (ή μια άσκηση) δεν αφορά την αρχική θέση
    if (n.comment && !n.isRoot) for (const s of commentShapes(n.comment, n.fen, bare)) if (!n.shapes.some((x) => x.from === s.from && x.to === s.to)) n.shapes.push(s);
    if (n.preComment && n.parent && !n.parent.isRoot) for (const s of commentShapes(n.preComment, n.parent.fen, bare)) if (!n.parent.shapes.some((x) => x.from === s.from && x.to === s.to)) n.parent.shapes.push(s);
    void text;
    for (const c of n.children) walk(c);
  };
  walk(root);
}

/**
 * Οι παράγραφοι ενός βιβλίου σε παρτίδες: μία παρτίδα για την εισαγωγή κάθε κεφαλαίου και μία για κάθε ενότητα
 * («a) 3.Bc4»), με επικεφαλίδες Event (τίτλος του βιβλίου), White (κεφάλαιο), Black (ενότητα), Round, Annotator.
 * Τα περιεχόμενα στην αρχή και στο τέλος παραλείπονται.
 */
/** Ό,τι έμαθε η πρώτη ανάγνωση ενός βιβλίου (η `parseWithBoards` το διαβάζει ως 3 φορές). */
const IMAGE_GLYPH_RE = /[\ue000-\ue0ff]/;
const learned = new WeakMap<BookParagraph[], { ocr: boolean; letters: boolean; image: boolean; shortx: boolean; pieces: Map<string, string[]> | null }>();
const GLYPHY_RE = /[iIlLtJD:'’*r�@%>W!"\\<;]\s?[a-h]?[1-8]?x?[a-h][1-8lIS]|[-]/;

/**
 * Το βιβλίο σε παρτίδες. Αν τα σύμβολα των κομματιών βγαίνουν «σκουπίδια», μια πρώτη ανάγνωση μαθαίνει ποιο κομμάτι
 * είναι κάθε μορφή (από τις κινήσεις όπου μόνο ένα κομμάτι είναι νόμιμο), και η κανονική ανάγνωση το χρησιμοποιεί
 * σταθερά, και στα σχόλια.
 */
/**
 * Η ένδειξη «W» / «B» κάτω από τα διαγράμματα (ένδειξη σειράς), όταν έμεινε δική της παράγραφος: είναι η σειρά του
 * διαγράμματος (πιο αξιόπιστη από τη θέση ενός σημαδιού στα δεξιά) και όχι σχόλιο («{B}» στις παρτίδες· η παράγραφος
 * μένει στη θέση της, γιατί χωρίζει το διάγραμμα από ό,τι ακολουθεί). Με δύο διαγράμματα στη σειρά, οι ενδείξεις με
 * τη σειρά τους.
 */
const turnMarks = new WeakSet<BookParagraph>();
function turnMarkers(paragraphs: BookParagraph[]): void {
  let open: BookDiagram[] = [];
  let below = false;
  for (const p of paragraphs) {
    if (p.diagram) {
      open.push(p.diagram);
      below = true;
      continue;
    }
    const m = /^\(?([WB])\)?$/.exec(p.text.trim());
    if (!m) {
      // (από εικόνα: γράμματα των συντεταγμένων της σκακιέρας αμέσως κάτω από το διάγραμμα, «g», «a C e g»· έμεναν σχόλιο
      // «{g}»)
      if (below && /^(?:[a-hA-H]\s+){0,7}[a-hA-H]$/.test(p.text.trim())) {
        turnMarks.add(p);
        continue;
      }
      if (p.text.trim()) {
        open = [];
        below = false;
      }
      continue;
    }
    const d = open.shift();
    if (!d) continue;
    d.turn = m[1] === 'W' ? 'w' : 'b';
    turnMarks.add(p);
  }
}

// Κεφάλαια με «Variation Index» από εικόνα: το «Chapter N» είναι εικόνα και χάνεται («Chapr Lineswithoutc4»), άρα
// κανένα κεφάλαιο δεν αναγνωριζόταν. Κάθε κεφάλαιο αρχίζει με «Variation Index»· ο τίτλος του είναι η επικεφαλίδα
// ακριβώς πριν. Και οι ασκήσεις της αρχής: διάγραμμα με λεζάντα «Page 41, Chapter 2» ή «Page 200, Ch. 8, (after 11.♖e1)»
// = η λύση είναι στη θεωρία εκείνης της σελίδας (γίνονταν τίτλοι κεφαλαίων και ενοτήτων, ένα «κομμάτι» ανά διάγραμμα).
const exerciseRefs = new WeakMap<BookDiagram, { no: number; page: string; chapter: string; title: string }>();
const exerciseOf = new WeakMap<Game, { no: number; page: string; chapter: string; title: string }>();
const CHAPTER_EXERCISE_RE = /^Pag\w*\s*(\d{1,3})(?:\s*\/\s*\d{1,3})?\s*,\s*(?:Chapter|Ch\.?)\s*(\d{1,2})\b(?:\s*,?\s*\(\s*after\b.*)?$/i;
function variationIndexFrame(paragraphs: BookParagraph[]): void {
  const index = paragraphs.flatMap((p, i) => (p.heading && /^variation index$/i.test(p.text.trim()) ? [i] : []));
  // (όχι όταν τα κεφάλαια διαβάζονται ήδη κανονικά)
  if (index.length < 3 || paragraphs.filter((p) => p.heading && chapterOf(p.text.trim()) !== null).length * 2 >= index.length) return;
  const titles = new Map<string, string>();
  index.forEach((vi, n) => {
    let k = vi - 1;
    while (k >= 0 && !paragraphs[k].diagram && !paragraphs[k].text.trim()) k--;
    const t = paragraphs[k];
    if (!t?.heading || t.diagram || /^variation index$/i.test(t.text.trim())) return;
    const title = t.text.replace(/\s+/g, ' ').trim();
    const text = `Chapter ${n + 1} – ${title}`;
    Object.assign(t, { text, runs: [{ text, main: false }], lineStarts: undefined });
    titles.set(String(n + 1), title);
    framedChapters.add(t);
    // (το «Variation Index» δεν είναι ενότητα: η εισαγωγή του κεφαλαίου συνεχίζει· και η επικεφαλίδα πριν από τον τίτλο
    // είναι το «Chapter» με το μέρος του βιβλίου, διαβασμένα σκουπίδι, «Chapr Lineswithoutc4»: γινόταν όνομα ενότητας)
    const skip = (q: BookParagraph) => {
      q.heading = false;
      turnMarks.add(q);
    };
    skip(paragraphs[vi]);
    // ο ίδιος ο κατάλογος, ως το τέλος της σελίδας: η σειρά κινήσεων και οι ενότητες «B21) 12...♘h5» είναι ο σκελετός του
    // δέντρου με τις ετικέτες του (απλές παράγραφοι, όχι ενότητες-παρτίδες· χωρίς τους αριθμούς σελίδων, «14.h3 ♗d7N 513»,
    // που γίνονταν σχόλιο-σκουπίδι)· οι λεζάντες των μικρών διαγραμμάτων του, «After A) 7.d5?! B1) after 14.♘d2!», και οι
    // κινήσεις κάτω από αυτά δεν δένουν με τίποτα: παραλείπονται
    let caption = false;
    for (let x = vi + 1; x < paragraphs.length && paragraphs[x].page === paragraphs[vi].page; x++) {
      const q = paragraphs[x];
      if (q.diagram) continue;
      caption ||= /\b(?:after|note to)\b/i.test(q.text);
      if (caption) {
        skip(q);
        continue;
      }
      const runs = q.runs.map((r) => ({ ...r, text: r.text.replace(/(?<![\d–-])\s\d{1,3}(?![\d.–-])(?=\s|$)/g, '') }));
      Object.assign(q, { heading: false, runs, text: runs.map((r) => r.text).join(''), lineStarts: undefined });
      indexLines.add(q);
    }
    let j = k - 1;
    while (j >= 0 && !paragraphs[j].diagram && !paragraphs[j].text.trim()) j--;
    if (paragraphs[j]?.heading && !paragraphs[j].diagram && !/^variation index$/i.test(paragraphs[j].text.trim())) skip(paragraphs[j]);
  });
  // κεφαλίδα σελίδας με τον τίτλο του κεφαλαίου και τον αριθμό της σελίδας («– 9.♕c2 509», το «Chapter 30» χάθηκε):
  // γινόταν επικεφαλίδα και όνομα ενότητας σε 24 παρτίδες
  const key = (t: string) => t.replace(/\s+/g, '').replace(/[-?]/g, '*');
  const known = new Set([...titles.values()].map(key));
  for (const p of paragraphs) {
    const m = /^(?:Cha\S*\s*\d{0,2}\s*)?[–-]\s*(.+?)\s+\d{1,3}$/.exec(p.text.replace(/\s+/g, ' ').trim());
    if (m && known.has(key(m[1]))) {
      p.heading = false;
      turnMarks.add(p);
    }
  }
  let no = 0;
  const coords = (t: string) => !t || /^(?:[a-hA-H]\s+){0,7}[a-hA-H]$/.test(t);
  // διαγράμματα μιας σειράς χωρίς λεζάντα ακόμη: οι λεζάντες τους μπορεί να διαβάστηκαν σε μία γραμμή («Page 422, Chapter
  // 24 Page 445, Chapter 26 Page 476, Chapter 28»)
  let row: BookDiagram[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const d = paragraphs[i].diagram;
    if (!d) {
      const t = paragraphs[i].text.replace(/\s+/g, ' ').trim();
      if (coords(t)) continue;
      const caps = [...t.matchAll(CHAPTER_EXERCISES_RE)];
      if (caps.length >= 2 && caps.length === row.length && !t.replace(CHAPTER_EXERCISES_RE, '').trim()) {
        // (από αριστερά προς τα δεξιά: η σειρά της ανάγνωσης των διαγραμμάτων, όχι η σειρά τους στο κείμενο)
        [...row].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)).forEach((x, n) => exerciseRefs.set(x, { no: ++no, page: caps[n][1], chapter: caps[n][2], title: titles.get(caps[n][2]) ?? '' }));
        paragraphs[i].heading = false;
        turnMarks.add(paragraphs[i]);
      }
      row = [];
      continue;
    }
    let k = i + 1;
    while (k < paragraphs.length && !paragraphs[k].diagram && coords(paragraphs[k].text.trim())) k++;
    const c = paragraphs[k];
    const m = c && !c.diagram ? CHAPTER_EXERCISE_RE.exec(c.text.replace(/\s+/g, ' ').trim()) : null;
    if (!m) {
      row.push(d);
      continue;
    }
    exerciseRefs.set(d, { no: ++no, page: m[1], chapter: m[2], title: titles.get(m[2]) ?? '' });
    c.heading = false;
    turnMarks.add(c);
  }
}

/** Οι τίτλοι κεφαλαίων με πλαίσιο «Variation Index» (`variationIndexFrame`): το βιβλίο έχει κεφάλαια-δέντρα (`joinChapters`). */
const framedChapters = new WeakSet<BookParagraph>();
/** Οι γραμμές του καταλόγου («Variation Index») ενός κεφαλαίου: σκελετός του δέντρου με τις ετικέτες. */
const indexLines = new WeakSet<BookParagraph>();
/** Κόμβοι που μπήκαν μόνο από τον κατάλογο: αν η θεωρία δεν τους συνεχίσει, φεύγουν (`joinChapters`). */
const indexNodes = new WeakSet<GameNode>();
const CHAPTER_EXERCISES_RE = /Pag\w*\s*(\d{1,3})(?:\s*\/\s*\d{1,3})?\s*,\s*(?:Chapter|Ch\.?)\s*(\d{1,2})\b(?:\s*,?\s*\(\s*after\b[^)]*\))?/gi;
/** Η ετικέτα της ενότητας («B21») στον κόμβο όπου ξεκινά, σε βιβλίο με κεφάλαια-δέντρα. */
const nodeLabel = new WeakMap<GameNode, string>();
const SQUARES = Array.from({ length: 64 }, (_, i) => (i >> 3) * 16 + (i & 7));
/** Μία θέση για όλους τους υπολογισμούς του `joinChapters` (κάθε `Position` δεσμεύει μεγάλο buffer). */
const scratch = new Position();
const boardDiff = (a: Int8Array, b: Int8Array): number => {
  let d = 0;
  for (const s of SQUARES) if (a[s] !== b[s]) d++;
  return d;
};

/**
 * Κεφάλαια με «Variation Index» (`variationIndexFrame`): κάθε κεφάλαιο ΕΝΑ δέντρο, όπως στο ψηφιακό βιβλίο, όχι ~18 κομμάτια (κάθε διάγραμμα
 * που δεν «έδενε» με τη γραμμή άνοιγε νέο). Με τη σειρά του βιβλίου, κάθε κομμάτι του κεφαλαίου μπαίνει στο δέντρο όπου
 * υπάρχει ήδη η θέση του, ή ως 3 ημικινήσεις πριν από αυτήν (κινήσεις που χάθηκαν στην ανάγνωση: συμπληρώνονται)· όσα
 * δεν βρίσκουν θέση μένουν χωριστά. Οι ετικέτες των ενοτήτων («B21)») γράφονται πριν από την κίνησή τους.
 */
function joinChapters(games: Game[]): number {
  const groups = new Map<string, Game[]>();
  for (const g of games) {
    const m = /^(\d{1,3})(?:\.\d+)?$/.exec(g.headers.Round ?? '');
    if (!m || g.headers.Exercise !== undefined || !g.headers.White?.startsWith(`${m[1]}. `)) continue;
    groups.set(m[1], [...(groups.get(m[1]) ?? []), g]);
  }
  const gone = new Set<Game>();
  const joinedIn = new Map<string, Game[]>();
  for (const [no, gs] of groups) {
    const base = gs.find((g) => g.isStandardStart) ?? gs[0];
    const key = (fen: string) => fen.split(' ').slice(0, 2).join(' ');
    const at = new Map<string, GameNode[]>();
    const pool: Array<{ n: GameNode; owner: Game; board: Int8Array }> = [];
    const add = (n: GameNode, owner: Game) => {
      const k = key(n.fen);
      at.set(k, [...(at.get(k) ?? []), n]);
      scratch.setFen(n.fen);
      pool.push({ n, owner, board: scratch.board.slice() });
    };
    const owners = new Map<GameNode, Game>();
    const index = (n: GameNode, owner: Game) => {
      add(n, owner);
      owners.set(n, owner);
      for (const c of n.children) index(c, owner);
    };
    // (`san`: η θέση του κομματιού διαφέρει λίγο, διάγραμμα διαβασμένο λάθος· οι κινήσεις ξαναβρίσκονται από το SAN τους)
    const sanMove = (at: GameNode, san: string): number => {
      const pos = scratch;
      pos.setFen(at.fen);
      const m = pos.parseSan(san);
      return m && pos.legalMoves().includes(m) ? m : 0;
    };
    const merge = (src: GameNode, dst: GameNode, owner: Game, san = false) => {
      if (src.comment && !dst.comment.includes(src.comment)) dst.comment = dst.comment ? `${dst.comment} ${src.comment}` : src.comment;
      for (const c of src.children) {
        const move = san ? sanMove(dst, c.san) : c.move;
        let n = dst.children.find((x) => x.move === move);
        if (!n) {
          n = owner.addMove(dst, move);
          Object.assign(n, { preComment: c.preComment, nags: [...c.nags], shapes: [...c.shapes] });
          add(n, owner);
          owners.set(n, owner);
        } else if (c.preComment && !n.preComment.includes(c.preComment)) n.preComment = n.preComment ? `${n.preComment} ${c.preComment}` : c.preComment;
        const l = nodeLabel.get(c);
        if (l && !nodeLabel.has(n)) nodeLabel.set(n, l);
        merge(c, n, owner, san);
      }
    };
    // από κόμβο του κεφαλαίου ως τη θέση σε ως `depth` ημικινήσεις (κάθε κίνηση αλλάζει ως 2 τετράγωνα, το ροκέ 4)· πρώτα
    // οι πιο πρόσφατοι κόμβοι, που είναι κοντά στο κείμενο του διαγράμματος
    const bridge = (want: Position, depth: number, ok: (n: GameNode) => boolean): GameNode | null => {
      for (let i = pool.length - 1; i >= 0; i--) {
        const { n, owner, board } = pool[i];
        if (boardDiff(board, want.board) > depth * 2 + 2 || !ok(n)) continue;
        const pos = scratch;
        pos.setFen(n.fen);
        const path: number[] = [];
        const go = (d: number): boolean => {
          const left = boardDiff(pos.board, want.board);
          if (d > 0 && !left && pos.turn === want.turn) return true;
          if (d === depth || left > (depth - d) * 2 + 2) return false;
          for (const m of pos.legalMoves()) {
            // (κινείται μόνο κομμάτι που δεν είναι ήδη όπως στη θέση-στόχο: χωρίς αυτό ~10″ ανά ανάλυση)
            if (pos.board[m & 0x7f] === want.board[m & 0x7f]) continue;
            pos.makeMove(m);
            path.push(m);
            const ok = go(d + 1);
            pos.unmakeMove();
            if (ok) return true;
            path.pop();
          }
          return false;
        };
        if (!go(0)) continue;
        let x = n;
        for (const m of path) {
          const had = x.children.find((c) => c.move === m);
          x = had ?? owner.addMove(x, m);
          if (!had) {
            add(x, owner);
            owners.set(x, owner);
          }
        }
        return x;
      }
      return null;
    };
    // (όχι στο ίδιο το κομμάτι, ούτε σε κομμάτι που έχει ήδη μπει σε άλλο δέντρο)
    const find = (g: Game): GameNode | null => {
      const ok = (n: GameNode) => owners.get(n) !== g && !gone.has(owners.get(n)!);
      const same = at.get(key(g.root.fen)) ?? [];
      for (let i = same.length - 1; i >= 0; i--) if (ok(same[i])) return same[i];
      const want = Position.fromFen(g.root.fen);
      for (let d = 1; d <= 3; d++) {
        const n = bridge(want, d, ok);
        if (n) return n;
      }
      return null;
    };
    // διάγραμμα με ένα κομμάτι διαβασμένο λάθος (ως 2 τετράγωνα): η θέση του δέντρου που διαφέρει τόσο, αν είναι μία, και
    // μόνο αν όλες οι κινήσεις του κομματιού παίζονται από εκεί
    const misread = (g: Game): GameNode | null => {
      const want = Position.fromFen(g.root.fen);
      let best: GameNode | null = null;
      for (const { n, board } of pool) {
        const d = boardDiff(board, want.board);
        if (!d || d > 2 || owners.get(n) === g || gone.has(owners.get(n)!) || n.fen.split(' ')[1] !== g.root.fen.split(' ')[1]) continue;
        if (best && best.fen.split(' ')[0] !== n.fen.split(' ')[0]) return null;
        best ??= n;
      }
      const fits = (src: GameNode, at: GameNode): boolean =>
        src.children.every((c) => {
          const m = sanMove(at, c.san);
          if (!m) return false;
          const x = new GameNode();
          scratch.setFen(at.fen);
          scratch.makeMove(m);
          x.fen = scratch.fen();
          return fits(c, x);
        });
      return best && g.root.children.length && fits(g.root, best) ? best : null;
    };
    index(base.root, base);
    let joined = 0;
    const left: Game[] = [];
    for (const g of gs) {
      if (g === base) continue;
      const n = find(g);
      if (!n) {
        index(g.root, g);
        left.push(g);
        continue;
      }
      merge(g.root, n, owners.get(n)!);
      gone.add(g);
      joined++;
    }
    // (ξανά όσα έμειναν: η θέση τους μπορεί να ήρθε με κομμάτι που ακολουθεί στο βιβλίο)
    for (let again = true; again; ) {
      again = false;
      for (const g of left) {
        const n = gone.has(g) ? null : find(g);
        if (!n) continue;
        merge(g.root, n, owners.get(n)!);
        gone.add(g);
        joined++;
        again = true;
      }
    }
    for (const g of left) {
      const n = gone.has(g) ? null : misread(g);
      if (!n) continue;
      merge(g.root, n, owners.get(n)!, true);
      gone.add(g);
      joined++;
    }
    // (κομμάτι που δεν βρήκε θέση: όχι «Εισαγωγή», που ήταν το όνομα του κομματιού πριν από το διάγραμμα)
    for (const g of left) if (!gone.has(g) && g.headers.Black === 'Εισαγωγή' && !g.isStandardStart) g.headers.Black = 'Από διάγραμμα';
    if (joined) joinedIn.set(no, gs);
  }
  const kept = games.filter((g) => !gone.has(g));
  games.splice(0, games.length, ...kept);
  // κλαδιά μόνο του καταλόγου που η θεωρία δεν συνέχισε (χωρίς σχόλιο, χωρίς κομμάτι δεμένο εκεί): συνήθως σύμβολο
  // κομματιού που χάθηκε στα μεγάλα γράμματα του καταλόγου, «1.d4 f6» αντί «1.d4 ♘f6», άρα λάθος κίνηση
  let pruned = 0;
  const prune = (n: GameNode) => {
    for (const c of [...n.children]) {
      prune(c);
      if (indexNodes.has(c) && !c.children.length && !c.comment && !c.preComment) {
        n.children.splice(n.children.indexOf(c), 1);
        pruned++;
      }
    }
  };
  for (const g of games) prune(g.root);
  // το δέντρο του κεφαλαίου είναι το μεγαλύτερο που έμεινε (όχι απαραίτητα αυτό από την αρχική θέση: αν η σειρά κινήσεων
  // χάθηκε, μπορεί να είχε μόνο κλαδιά του καταλόγου, που κόπηκαν)· κομμάτια χωρίς τίποτα πια φεύγουν
  const size = (n: GameNode): number => n.children.reduce((k, c) => k + 1 + size(c), 0);
  const empty = new Set<Game>();
  for (const [no, gs] of joinedIn) {
    const live = gs.filter((g) => !gone.has(g));
    for (const g of live) if (!g.root.children.length && !g.root.comment.trim()) empty.add(g);
    const big = live.filter((g) => !empty.has(g)).sort((a, b) => size(b.root) - size(a.root))[0];
    if (big?.root.children.length) Object.assign(big.headers, { Round: no, Black: 'Όλο το κεφάλαιο' });
  }
  if (empty.size) games.splice(0, games.length, ...games.filter((g) => !empty.has(g)));
  for (const g of games) {
    const walk = (n: GameNode) => {
      for (const c of n.children) {
        const l = nodeLabel.get(c);
        if (l) c.preComment = c.preComment ? `${l}) ${c.preComment}` : `${l})`;
        walk(c);
      }
    };
    walk(g.root);
  }
  return pruned;
}

/** Κόβει τα διαστήματα `[από, ως)` του κειμένου μιας παραγράφου (και από τα κομμάτια της και τις αρχές των γραμμών). */
function cutText(p: BookParagraph, cuts: Array<[number, number]>): void {
  let at = 0;
  const runs = p.runs.map((r) => {
    const a = at;
    const b = at + r.text.length;
    at = b;
    let t = '';
    let i = a;
    for (const [s, e] of cuts) {
      if (e <= i || s >= b) continue;
      t += r.text.slice(i - a, Math.max(i, s) - a);
      i = Math.min(e, b);
    }
    return { ...r, text: t + r.text.slice(i - a) };
  });
  const gone = (x: number) => cuts.reduce((k, [s, e]) => k + Math.max(0, Math.min(e, x) - s), 0);
  Object.assign(p, { runs, text: runs.map((r) => r.text).join(''), lineStarts: p.lineStarts?.map((s) => s - gone(s)) });
}

/**
 * Κεφαλίδες σελίδας σε βιβλίο από εικόνα, όπου κι αν βρίσκονται: «538 9.h3» (ζυγή σελίδα: αριθμός και τίτλος του μέρους) και
 * «Chapter 30 – 9.♕c2 505» (μονή: τίτλος του κεφαλαίου και αριθμός), μόνες τους ή κολλημένες σε παράγραφο που συνεχίζει
 * στην επόμενη σελίδα («…23.a4 ♖ae8↑ 506 8.e4 c6 without 9.h3», «A) 11.h3!? – 9.♕c2 505»): γίνονταν σχόλια-σκουπίδια
 * και ΛΑΘΟΣ βαριάντες (π.χ. «(9.h3)» στην αρχή ενός κεφαλαίου). Μαθαίνονται από το ίδιο το βιβλίο: φράση με
 * τον αριθμό της σελίδας (σταθερή διαφορά από τη σελίδα του PDF) σε τουλάχιστον 3 σελίδες.
 */
function pageHeaders(paragraphs: BookParagraph[]): void {
  const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
  const key = (t: string) => t.replace(/\s+/g, '');
  const EVEN_RE = /^(\d{1,3}) (\S.{1,50})$/;
  const ODD_RE = /(?:^|\s)[–-] ?([^\s–-][^–]{0,40}?) (\d{1,3})(?= |$)/g;
  const found: Array<{ kind: 'e' | 'o'; page: number; num: number; phrase: string }> = [];
  for (const p of paragraphs) {
    if (p.diagram) continue;
    const t = flat(p.text);
    const e = EVEN_RE.exec(t);
    if (e && Math.abs(Number(e[1]) - p.page) <= 3) found.push({ kind: 'e', page: p.page, num: Number(e[1]), phrase: e[2] });
    for (const m of t.matchAll(ODD_RE)) if (Math.abs(Number(m[2]) - p.page) <= 3 && /\p{L}/u.test(m[1])) found.push({ kind: 'o', page: p.page, num: Number(m[2]), phrase: m[1] });
  }
  // η διαφορά του αριθμού της σελίδας του βιβλίου από τη σελίδα του PDF (η πιο συχνή)
  const offs = new Map<number, number>();
  for (const f of found) offs.set(f.num - f.page, (offs.get(f.num - f.page) ?? 0) + 1);
  const [d, hits] = [...offs].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  if (hits < 5) return;
  // (και ο αριθμός της επόμενης σελίδας: η παράγραφος συνεχίζει εκεί, πάνω από την κεφαλίδα της)
  const fits = (page: number, num: number) => num - page === d || num - page === d + 1;
  const pages = new Map<string, Set<number>>();
  for (const f of found) if (fits(f.page, f.num)) pages.set(f.kind + key(f.phrase), (pages.get(f.kind + key(f.phrase)) ?? new Set()).add(f.num));
  // (και όλοι οι αριθμοί της ίδιας ισοτιμίας: η κεφαλίδα είναι μόνο στις ζυγές ή μόνο στις μονές σελίδες· όχι παραπομπή
  // «– page 152» που έτυχε να είναι η ίδια σελίδα)
  const known = [...pages].filter(([, s]) => s.size >= 3 && new Set([...s].map((n) => n % 2)).size === 1).map(([k]) => k);
  const alts = (kind: string) =>
    known
      .filter((k) => k[0] === kind)
      .map((k) => [...k.slice(1)].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'))
      .join('|');
  const even = alts('e');
  const odd = alts('o');
  const res = [
    even && new RegExp(String.raw`(^|\s)(\d{1,3})\s+(?:${even})(?=\s|$)`, 'g'),
    odd && new RegExp(String.raw`(^|\s)(?:Cha\S*\s*\d{0,2}\s*)?[–-]\s?(?:${odd})\s+(\d{1,3})(?=\s|$)`, 'g'),
  ].filter((r): r is RegExp => !!r);
  if (!res.length) return;
  for (const p of paragraphs) {
    if (p.diagram || p.runs.map((r) => r.text).join('') !== p.text) continue;
    const cuts: Array<[number, number]> = [];
    for (const re of res) {
      for (const m of p.text.matchAll(re)) {
        const num = Number(m[2]);
        if (fits(p.page, num)) cuts.push([m.index + m[1].length, m.index + m[0].length]);
      }
    }
    if (!cuts.length) continue;
    cuts.sort((a, b) => a[0] - b[0]);
    cutText(p, cuts);
    if (!p.text.trim()) {
      p.heading = false;
      turnMarks.add(p);
    }
  }
}

export function parseBook(paragraphs: BookParagraph[], opts: BookOptions): BookResult {
  let book = learned.get(paragraphs);
  if (!book) {
    turnMarkers(paragraphs);
    if (paragraphs.some((p) => IMAGE_GLYPH_RE.test(p.text))) pageHeaders(paragraphs);
    variationIndexFrame(paragraphs);
    if (glyphCode.size > 0x600) {
      glyphCode.clear();
      glyphText.clear();
    }
    const ocr = isOcrText(paragraphs);
    book = { ocr, letters: !ocr && isLetterCipher(paragraphs), image: paragraphs.some((p) => IMAGE_GLYPH_RE.test(p.text)), shortx: hasShortCaptures(paragraphs), pieces: null };
    if (book.ocr || book.letters || paragraphs.some((p) => GLYPHY_RE.test(p.text))) {
      ocrText = book.ocr;
      letterCipher = book.letters;
      imageText = book.image;
      shortCaptures = book.shortx;
      glyphVotes = new Map();
      try {
        // (με τις έμπιστες θέσεις των διαγραμμάτων: σε βιβλία με παραδείγματα από διαγράμματα-εικόνες,
        // χωρίς αυτές καμία κίνηση δεν έμπαινε στο δέντρο σε αυτό το πέρασμα και τα σύμβολα έμεναν άγνωστα)
        parseBookOnce(paragraphs, { title: opts.title, author: opts.author, trusted: opts.trusted, fixed: opts.fixed });
        book.pieces = learnGlyphs(glyphVotes);
      } finally {
        glyphVotes = null;
        ocrText = false;
        letterCipher = false;
        imageText = false;
        shortCaptures = false;
      }
    }
    learned.set(paragraphs, book);
  }
  ocrText = book.ocr;
  letterCipher = book.letters;
  imageText = book.image;
  shortCaptures = book.shortx;
  boldless = !paragraphs.some((p) => p.runs.some((r) => r.main && r.text.trim()));
  glyphPieces = book.pieces;
  try {
    return parseBookOnce(paragraphs, opts);
  } finally {
    ocrText = false;
    letterCipher = false;
    imageText = false;
    shortCaptures = false;
    boldless = false;
    glyphPieces = null;
  }
}

function parseBookOnce(paragraphs: BookParagraph[], opts: BookOptions): BookResult {
  const framed = paragraphs.some((p) => framedChapters.has(p));
  const games: Game[] = [];
  const warnings: BookWarning[] = [];
  let builder: Builder | null = null;
  let chapterNo = '';
  let chapterTitle = '';
  let waitChapterTitle = false;
  let waitPartTitle = false;
  let inToc = false;
  let varIndex = false;
  let tocPage = 0;
  let gameChapter = false;
  let section = 0;
  let exercises = false;
  let started = false;
  let lastHeading = '';
  /** το κεφάλαιο του βιβλίου όσο διαβάζονται παρτίδες «Game N» (που είναι κι αυτές «κεφάλαια») */
  let outer: { no: string; title: string; section: number } | null = null;
  // «Trap 12 – Τίτλος», «Example 3», «Lesson 7»: λέξη με αριθμό που επαναλαμβάνεται (≥ 3) στις επικεφαλίδες = ενότητα,
  // όπως το «Chapter N»
  const sectionCount = new Map<string, number>();
  for (const p of paragraphs) {
    const m = p.heading ? /^([A-Z][a-z]{2,14})\s+\d{1,3}\b/.exec(p.text.trim()) : null;
    if (m && !/^(?:chapter|part|game)$/i.test(m[1])) sectionCount.set(m[1], (sectionCount.get(m[1]) ?? 0) + 1);
  }
  const sectionWord = [...sectionCount].sort((a, b) => b[1] - a[1]).find(([, n]) => n >= 3)?.[0];
  const SECTION_HEAD_RE = sectionWord ? new RegExp(String.raw`^${sectionWord}\s+(\d{1,3})\b`) : null;
  // οι θέσεις των διαγραμμάτων ανά σελίδα (για χαμένη κίνηση με ίσες υποψήφιες, `gapMove`)
  const boardsByPage = new Map<number, string[]>();
  for (const p of paragraphs) if (p.diagram?.placement) boardsByPage.set(p.page, [...(boardsByPage.get(p.page) ?? []), p.diagram.placement]);
  // γραμμή ευρετηρίου: ετικέτα, κινήσεις και στο τέλος ο αριθμός σελίδας· μόνο όταν και μια διπλανή είναι τέτοια
  // (και «A. 8.a3 – page 79»)
  const INDEX_ENTRY_RE = /^[A-Za-z]{1,2}\d{0,6}[).]\s*\d{1,3}\s?\.(?:\s?\.\.\.)?\s?\S.*\s(?:page\s)?\d{1,3}$/;
  // (μία γραμμή ανά παράγραφο· οι πολλές σε μία παράγραφο, «B1) 5.dxc5?! 27 B2) 5.♘f3 cxd4 29», μένουν όπως ήταν)
  const isIndexLine = (k: number) => {
    if (k < 0 || k >= paragraphs.length || paragraphs[k].diagram) return false;
    const t = normalizeBookText(paragraphs[k].text).replace(/\s+/g, ' ').trim();
    return INDEX_ENTRY_RE.test(t) && !/\s[A-Za-z]{1,2}\s?\d{0,6}\s?[)}]\s/.test(t);
  };
  const indexEntry = (k: number) => isIndexLine(k) && (isIndexLine(k - 1) || isIndexLine(k + 1));
  // παρτίδα μέσα στο κείμενο: γραμμή με παίκτες («Kochiev — Ivanov USSR 1976») και μετά κινήσεις από την πρώτη
  const FIRST_NUM_RE = new RegExp(String.raw`(?:^|\s)(\d{1,3})\s?\.?\s?(?:\.\.\.)?\s?(?=${SAN_SRC})`);
  const startsGame = (at: number): boolean => {
    for (let k = at + 1; k < Math.min(paragraphs.length, at + 5); k++) {
      const t = normalizeBookText(paragraphs[k].text);
      const m = FIRST_NUM_RE.exec(t);
      if (m) return m[1] === '1' && m.index < 3;
    }
    return false;
  };
  // πόσες φορές εμφανίζεται κάθε επικεφαλίδα (κεφαλίδες σελίδας σε βιβλίο από OCR)
  // και σύντομες γραμμές χωρίς κινήσεις: «Chapter 8 -», «a b c d e f g h» των διαγραμμάτων)
  const headKey = (t: string) => t.replace(/[\s\d]+/g, '').toLowerCase();
  const headCount = new Map<string, number>();
  const shortLine = (t: string) => t.length < 40 && !/[a-h][1-8]/.test(t);
  if (ocrText) for (const p of paragraphs) if (p.heading || shortLine(p.text.trim())) headCount.set(headKey(p.text), (headCount.get(headKey(p.text)) ?? 0) + 1);
  const date = opts.year ? `${opts.year}.??.??` : '????.??.??';
  const bare = bareNumbering(paragraphs);
  // αριθμοί χωρίς τελεία: ο τίτλος του κεφαλαίου μπορεί να συνεχίζει σε επόμενη επικεφαλίδα
  let titleOpen = false;
  // η τελευταία επικεφαλίδα που έγινε τίτλος (του κεφαλαίου ή μιας ενότητας): μια επικεφαλίδα αμέσως μετά μπορεί να
  // είναι η συνέχειά της σε δεύτερη γραμμή («II. Black develops his king’s bishop to e7 and adopts the structure» /
  // «known as the ‘little centre’»)
  let headTitle: { kind: 'chapter' | 'section'; pi: number; text: string } | null = null;
  // μέσα στο «Conclusion» ενός κεφαλαίου (ο τίτλος του, ως την επόμενη επικεφαλίδα ή διάγραμμα)
  let conclusion: string | null = null;
  // ενότητα ή εισαγωγή χωρίς κινήσεις (μόνο κείμενο, π.χ. επισκόπηση των συστημάτων): όχι χωριστή «παρτίδα», αλλά το
  // πρώτο σχόλιο της επόμενης παρτίδας του κεφαλαίου με κινήσεις (ή μόνη της, αν δεν ακολουθεί καμία)
  let held: Game | null = null;
  // οι παρτίδες του κεφαλαίου αρχίζουν εδώ στο `games`
  let chapterFrom = 0;
  // (στο τέλος του κεφαλαίου: το συμπέρασμα πάει στο τέλος της τελευταίας παρτίδας του, αλλιώς μένει μόνο του)
  const release = (attach = false) => {
    const last = games.length > chapterFrom ? games[games.length - 1] : null;
    if (held && attach && last?.root.children.length) {
      let n = last.root;
      while (n.children[0]) n = n.children[0];
      n.comment = n.comment ? `${n.comment} ${held.root.comment}` : held.root.comment;
    } else if (held) games.push(held);
    held = null;
  };

  /** οι κινήσεις που καταγράφηκαν μετά από ένα διάγραμμα-εικόνα */
  const flushProbe = () => {
    const b = builder as Builder | null;
    if (b?.probe) opts.probe?.(b.probe.id, { moves: b.probe.moves, turn: b.probe.turn });
    if (b) b.probe = null;
  };
  const finish = () => {
    flushProbe();
    // (κεφάλαιο που περίμενε μια παρτίδα στη μέση του: οι παρτίδες του μπαίνουν στη θέση όπου ξεκίνησε η παρτίδα)
    const slot = builder ? slots.get(builder) : undefined;
    const from = games.length;
    if (builder) {
      const g = builder.game;
      if (framed && !builder.exercise) for (const [name, l] of builder.labels) nodeLabel.set(l.first, name);
      if (!exercises) builder.foldMentions();
      // καμία κίνηση στο δέντρο ενώ το κείμενο έχει κινήσεις (ή κεφάλαιο ασκήσεων): η θέση είναι διάγραμμα
      // (εικόνα) στο βιβλίο, άρα θα ήταν άδεια σκακιέρα με λάθος βέλη
      if (!g.root.children.length && !builder.exercise && (exercises || builder.unplaced.length > 0)) {
        skippedDiagrams++;
        diagramPage ||= builder.unplaced[0]?.page ?? 0;
      } else {
        warnings.push(...builder.unplaced);
        builder.promoteLines();
        builder.tidy();
        // αριθμοί χωρίς τελεία: οι ενότητες σε δικές τους παρτίδες (μια παρτίδα-κεφάλαιο με χιλιάδες κινήσεις αργεί στην οθόνη)
        const parts = splitSections(g, builder.sections);
        // μόνο αν έχει κάτι: κινήσεις ή σχόλιο· χωρίς κινήσεις περιμένει την επόμενη παρτίδα (`held`)
        if (!g.root.children.length && !builder.exercise && !parts.length && !exercises && builder.section) {
          if (g.root.comment) {
            const title = g.headers.Black && !/^(?:Εισαγωγή|Ασκήσεις)$/.test(g.headers.Black) ? g.headers.Black : '';
            const lead = title ? `${title}${/[.:!?]$/.test(title) ? '' : ':'} ${g.root.comment}` : g.root.comment;
            // (αμέσως μετά την εισαγωγή του κεφαλαίου, που έχει κινήσεις: η επισκόπηση «I. … IV. …» είναι το τέλος της)
            const prev = games.length > chapterFrom ? games[games.length - 1] : null;
            if (!held && prev && prev === intro && prev.root.children.length) {
              let n = prev.root;
              while (n.children[0]) n = n.children[0];
              n.comment = n.comment ? `${n.comment} ${lead}` : lead;
            } else if (held) held.root.comment = `${held.root.comment} ${lead}`;
            else {
              held = g;
              g.root.comment = lead;
            }
          }
        } else if (g.root.children.length || g.root.comment || builder.exercise) {
          if (held && g.root.children.length && !builder.exercise) {
            g.root.comment = g.root.comment ? `${held.root.comment} ${g.root.comment}` : held.root.comment;
            held = null;
          }
          release();
          games.push(g);
        }
        for (const part of parts) {
          // ο γύρος είναι ο αριθμός της ενότητας στο βιβλίο («1.41»), η εισαγωγή του κεφαλαίου ο αριθμός του
          Object.assign(part.game.headers, headersFor(chapterName(), part.title), { Round: part.title.split(' ')[0] });
          games.push(part.game);
        }
        if (parts.length) {
          introAlone = false;
          if (chapterNo) g.headers.Round = chapterNo;
        }
      }
    }
    if (slot !== undefined) games.splice(slot, 0, ...games.splice(from));
    builder = null;
  };
  // παρτίδα «GAME 12» στη μέση κεφαλαίου θεωρίας («A) 6.♘f3 …», η παρτίδα, μετά «B) 6.♗g5»): το κεφάλαιο
  // περιμένει (χωρίς `finish`), γιατί η επόμενη ενότητά του μπορεί να συνεχίζει μετά την παρτίδα
  type Suspended = { builder: Builder; gameChapter: boolean; chapterNo: string; chapterTitle: string; section: number; intro: Game | null; introAlone: boolean; lastHeading: string };
  let suspended: Suspended | null = null;
  /** η `suspended` είναι παρτίδα που περιμένει όσο διαβάζεται η βαριάντα ενός διαγράμματος (βλ. «παράκαμψη») */
  let detour = false;
  /** μέσα σε αριθμημένες ολόκληρες παρτίδες (`numberedGameHead`), με τη θεωρία να περιμένει */
  let numberedRun = false;
  const slots = new Map<Builder, number>();
  const restore = (s: Suspended) => {
    suspended = null;
    detour = false;
    ({ gameChapter, chapterNo, chapterTitle, section, intro, introAlone, lastHeading } = s);
    exercises = false;
    builder = s.builder;
  };
  // (νέο κεφάλαιο ή τέλος του βιβλίου: τελειώνει η παρτίδα και μετά το κεφάλαιο που περίμενε)
  const finalize = () => {
    if (!suspended) return;
    finish();
    restore(suspended);
    finish();
  };
  let skippedDiagrams = 0;
  let diagramPage = 0;
  // η «Εισαγωγή» του κεφαλαίου· αν δεν ακολουθήσουν ενότητες, είναι όλο το κεφάλαιο
  let intro: Game | null = null;
  let introAlone = false;
  // (στα βιβλία με μία παρτίδα ανά «Game N» το κείμενο ανάμεσα σε δύο παρτίδες πάει στην επόμενη)
  const closeChapter = (keep = false) => {
    if (!keep) release(true);
    chapterFrom = games.length;
    // (όχι η εισαγωγή κεφαλαίου που συνεχίζει με παρτίδες «Game N»: δεν είναι όλο το κεφάλαιο)
    if (intro && introAlone && !(keep && bare && !gameChapter && chapterNo)) intro.headers.Black = 'Όλο το κεφάλαιο';
    intro = null;
  };
  const headersFor = (white: string, black: string): Record<string, string> => {
    section++;
    return {
      Event: opts.title || 'Βιβλίο',
      Site: '?',
      Date: date,
      // («Game 4»: γύρος 4, όχι 4.1 που είναι η εισαγωγή του κεφαλαίου 4)
      Round: chapterNo ? (gameChapter && section === 1 ? chapterNo : `${chapterNo}.${section}`) : String(section),
      White: white,
      Black: black,
      Result: '*',
      ...(opts.author ? { Annotator: opts.author } : {}),
    };
  };
  const start = (white: string, black: string, section = false) => {
    finish();
    builder = new Builder(headersFor(white, black), bare);
    builder.section = section;
    builder.seeds = games.slice(-6).reverse();
    if (black === 'Εισαγωγή') {
      intro = builder.game;
      introAlone = true;
    } else introAlone = false;
  };
  // κομμάτι μιας παρτίδας από διάγραμμα που δείχνει άλλη θέση: η ενότητα της παρτίδας· σε βιβλίο από εικόνα, παρτίδα
  // με παίκτες κρατά τους παίκτες, τον τόπο και τη χρονιά της (έδειχνε «7. Evolution/Revolution – Petrik, Tomas»)
  const withPlayers = new WeakSet<Builder>();
  const startPart = (b: Builder) => {
    if (!imageText || !withPlayers.has(b)) {
      start(chapterName(), b.game.headers.Black || '');
      return;
    }
    const { White, Black, Site, Date, Event } = b.game.headers;
    start(White, Black);
    Object.assign(builder!.game.headers, { Site, Date, Event });
    withPlayers.add(builder!);
  };
  // «8. Jakovenko – Eljanov» (ή χωρίς αριθμό) και στην επόμενη γραμμή ο τόπος και η χρονιά, μετά διάγραμμα
  const exampleHead = (at: number, text: string): { white: string; black: string; site: string; year: string; at: number } | null => {
    const m = EXAMPLE_PAIR_RE.exec(text.replace(/^\d{1,3}\s?\.\s?/, ''));
    if (!m) return null;
    let k = at + 1;
    while (k < paragraphs.length && !paragraphs[k].diagram && !paragraphs[k].text.trim()) k++;
    const q = paragraphs[k];
    const s = q && !q.diagram ? SITE_LINE_RE.exec(q.text.replace(/\s+/g, ' ').trim()) : null;
    if (!s || s[1].length > 50 || /\d\s?\.\s?\S*[a-h][1-8]/.test(s[1])) return null;
    let d = k + 1;
    while (d < paragraphs.length && !paragraphs[d].diagram && !paragraphs[d].text.trim()) d++;
    const dg = paragraphs[d]?.diagram;
    if (!dg) return null;
    // (όχι διάγραμμα με λεζάντα «Position after 15...f6»: θέση-εικόνα μέσα στη θεωρία, που συνεχίζει από κάτω)
    let e = d + 1;
    while (e < paragraphs.length && !paragraphs[e].diagram && !paragraphs[e].text.trim()) e++;
    if (/^Position after \d/i.test(paragraphs[e]?.text.trim() ?? '')) return null;
    // (και μόνο από διάγραμμα που η θέση του είναι έμπιστη: αλλιώς η παρτίδα δεν ξεκινά από εκεί και το παράδειγμα έμενε
    // άδειο, χάνοντας και τους παίκτες του)
    if (dg.id !== undefined && !(opts.trusted?.(dg.id) ?? false)) return null;
    return { white: m[1], black: m[2], site: s[1].trim(), year: s[2], at: k };
  };
  // παρτίδα «Game N» με τους παίκτες της (`gamePlayers`)· ο τόπος και η χρονιά και στην επόμενη γραμμή («Kiev 2005»)
  const startPlayers = (pl: NonNullable<ReturnType<typeof gamePlayers>>, at: number) => {
    waitChapterTitle = false;
    chapterTitle = `${pl.white} – ${pl.black}`;
    start(pl.white, pl.black);
    let { site, year } = pl;
    const q = paragraphs[at + 1];
    const s = !site && q && !q.heading && !q.diagram ? SITE_LINE_RE.exec(q.text.replace(/\s+/g, ' ').trim()) : null;
    if (s && s[1].length <= 50 && !FIRST_NUM_RE.test(normalizeBookText(q.text))) {
      site = s[1].trim();
      year = s[2];
      ex.consumed.add(at + 1);
    }
    const h = builder!.game.headers;
    if (site) h.Site = site;
    if (year) h.Date = `${year}.??.??`;
  };
  // επικεφαλίδα που μοιάζει με τίτλο ενότητας («Petroff Defence», «Black plays 7...e5!?»), όχι σκουπίδι από εικόνα
  const sectionLike = (t: string) =>
    t.length >= 4 && t.length <= 70 && /^[\p{Lu}\d'‘(]/u.test(t) && !/[;⺀-鿿-■]/u.test(t) && (t.match(/\p{L}/gu)?.length ?? 0) >= t.replace(/\s/g, '').length * 0.6 && !gamePlayers(t);
  // η παρτίδα τελείωσε: αποτέλεσμα μετά την τελευταία κίνηση της κύριας γραμμής («20 Nc4 1-0», το `tidy` το βάζει στις
  // επικεφαλίδες μόνο στο τέλος) ή «Black resigned at move 30»
  const ended = (b: Builder): boolean => {
    if (b.game.headers.Result !== '*') return true;
    let n = b.game.root;
    while (n.children[0]) n = n.children[0];
    const c = n.comment.trim();
    return /^(?:1[–-]0|0[–-]1|½[–-]½|1\/2[–-]1\/2)(?![\d,])/.test(c) || /\b(?:resigned|gave up|draw agreed|agreed (?:to )?a draw)\b[^.]*\.?$/i.test(c);
  };
  // μετά την επικεφαλίδα: «Game N» πριν από κινήσεις, ή η πρώτη κίνηση είναι η 1 του Λευκού (νέα γραμμή από την αρχή)
  const restarts = (at: number): boolean => {
    for (let k = at + 1; k < Math.min(paragraphs.length, at + 40); k++) {
      const q = paragraphs[k];
      if (q.diagram || q.heading) continue;
      const t = q.text.replace(/\s+/g, ' ').trim();
      if (/^game\s+\d{1,3}$/i.test(t) || GAME_LINE_RE.test(t)) return true;
      const mv = tokenize(q.runs, bare).find((x): x is Extract<Token, { k: 'move' }> => x.k === 'move');
      if (mv) return mv.num === 1 && !mv.black;
    }
    return false;
  };
  // («Trap 12 – Τίτλος» έχει ήδη τον αριθμό του)
  const chapterName = () => (chapterNo && !SECTION_HEAD_RE?.test(chapterTitle) ? `${chapterNo}. ${chapterTitle || ''}`.trim() : chapterTitle || opts.title || 'Βιβλίο');

  // διαγράμματα που «αιωρούνται»: το κείμενο τα καλεί με αριθμό, «…3 exd5 (Diagram 7)», και η
  // σελιδοποίηση τα βάζει όπου χωρούν· η θέση τους στη ροή δεν λέει πού βρίσκεται η παρτίδα, άρα δεν ξεκινούν απόσπασμα
  // (πριν σβηστούν οι παραπομπές από το κείμενο, πιο κάτω)
  const floating = paragraphs.filter((q) => /\(\s*Diagram\s+\d{1,4}\s*\)/.test(q.text)).length >= 3;
  // λεζάντες διαγραμμάτων μέσα στο κείμενο («3b: after 10...Qxf6», από τη διάταξη της σελίδας) και παραπομπές σε
  // διαγράμματα («(1a)», OCR «(la)»): δεν είναι κινήσεις ούτε σχόλια
  // (και «(diagram 4)» κάτω από τα διαγράμματα)
  const DIAGRAM_REF_RE = /(?:^|\s)[\dlI]{1,3}[a-z]:\s?after\s+\d{1,3}\s?(?:\.\.\.|…)?\s?\S+|\s?\((?:\d{1,3}|[lI]\d?)[a-z]\)|\s?\([Dd]iagram\s\d{1,3}[a-z]?\)/g;
  paragraphs = paragraphs.map((p) => {
    if (!DIAGRAM_REF_RE.test(p.text)) return p;
    DIAGRAM_REF_RE.lastIndex = 0;
    // (οι αρχές των γραμμών μετακινούνται όσο κόβεται πριν από αυτές)
    const cuts: Array<[number, number]> = [];
    let at = 0;
    const runs = p.runs.map((r) => {
      const t = r.text.replace(DIAGRAM_REF_RE, (m: string, off: number) => {
        cuts.push([at + off, m.length]);
        return '';
      });
      at += r.text.length;
      return { ...r, text: t };
    });
    const lineStarts = p.lineStarts?.map((s) => s - cuts.filter(([o, n]) => o + n <= s).reduce((k, [, n]) => k + n, 0));
    return { ...p, runs, text: runs.map((r) => r.text).join(''), lineStarts };
  });
  repairLabels(paragraphs);
  orderExercises(paragraphs);
  const ex = linkExercises(paragraphs, bare);
  let exerciseGames = 0;
  // μετά από διάγραμμα άσκησης: το κείμενο χωρίς κινήσεις ως την επόμενη άσκηση είναι της σελίδας (κεφαλίδες κ.λπ.)
  let afterExercise = false;
  const exerciseGame = (d: BookDiagram, solution: { head: string; paras: BookParagraph[]; loose?: boolean } | undefined) => {
    finish();
    const h = exerciseHeaders(solution?.head || d.caption);
    // (άσκηση με τη λύση στη θεωρία: «Άσκηση 3» και το κεφάλαιο όπου είναι η λύση)
    const ref = exerciseRefs.get(d);
    const label = d.label ?? (ref ? String(ref.no) : '');
    const b = new Builder(
      {
        Event: opts.title || 'Βιβλίο',
        Site: h.site || '?',
        Date: h.year ? `${h.year}.??.??` : '????.??.??',
        Round: label,
        White: ref ? `Άσκηση ${ref.no}` : h.white || '?',
        Black: ref ? `${ref.chapter}. ${ref.title}`.replace(/\.\s*$/, '') : h.black || '?',
        Result: '*',
        ...(opts.author ? { Annotator: opts.author } : {}),
        Exercise: label,
      },
      bare,
    );
    if (ref) {
      b.note(`Η λύση είναι στη θεωρία του κεφαλαίου ${ref.chapter}${ref.title ? ` (${ref.title})` : ''}, σελίδα ${ref.page} του βιβλίου.`);
    }
    b.exercise = true;
    if (!b.startFrom(d.placement, d.turn)) b.note('(Η θέση του διαγράμματος δεν αναγνωρίστηκε.)');
    if (d.id !== undefined) Object.assign(b, { probe: { id: d.id, turn: d.turn, moves: [] }, fromImage: true });
    if (!h.white && !ref && (solution?.head || d.caption)) b.note(solution?.head || d.caption);
    // (μετά το `startFrom`, που φτιάχνει νέα παρτίδα)
    if (ref) exerciseOf.set(b.game, ref);
    return b;
  };

  for (let pi = 0; pi < paragraphs.length; pi++) {
    if (ex.consumed.has(pi)) continue;
    let p = paragraphs[pi];
    if (p.heading || p.diagram) conclusion = null;
    const d = p.diagram;
    if (d) {
      started = true;
      if (d.label || exerciseRefs.has(d)) {
        // άσκηση: η λύση της (από τις σελίδες των λύσεων) ή το κείμενο που ακολουθεί
        const sol = d.label ? ex.solutions.get(pi) : undefined;
        builder = exerciseGame(d, sol);
        exerciseGames++;
        afterExercise = true;
        if (sol) {
          if (sol.intro) builder.note(sol.intro);
          if (sol.loose) builder.note('(Η λύση του βιβλίου δεν ταιριάζει στη θέση του διαγράμματος: λάθος του βιβλίου ή του PDF.)');
          for (const sp of sol.paras) builder.paragraph(sp);
          finish();
        }
      } else {
        // διάγραμμα-εικόνα: η θέση του είναι αναγνώριση, άρα ορίζει την αρχή μιας παρτίδας μόνο όταν την επιβεβαιώνει
        // το κείμενο (`trusted`)· πάντα καταγράφονται οι κινήσεις που ακολουθούν (`probe`)
        const image = d.id !== undefined;
        const trusted = !image || (opts.trusted?.(d.id!) ?? false);
        const record = () => {
          if (image && builder) (builder as Builder).probe = { id: d.id!, turn: d.turn, moves: [] };
        };
        if (builder && !(builder as Builder).empty) {
          // διάγραμμα μέσα σε παρτίδα: αν δείχνει άλλη θέση, ξεκινά απόσπασμα (νέα παρτίδα από εκεί)
          const b = builder as Builder;
          const at = (n: GameNode) => n.fen.split(' ')[0];
          flushProbe();
          // (όχι σε παρτίδα που ξεκίνησε από διάγραμμα-εικόνα: η θέση της είναι κι αυτή αναγνώριση)
          if (image && !b.fromImage) opts.probe?.(d.id!, { positions: [...new Set([at(b.cursor), at(b.mainTip)])] });
          // (ένα διάγραμμα-εικόνα μόνο όταν η θέση του ήρθε από το πακέτο διαγραμμάτων· αλλιώς συνήθως δείχνει θέση της
          // παρτίδας ή μιας βαριάντας της, και το κείμενο συνεχίζει την ίδια παρτίδα· κάθε παράδειγμα «παίκτες, τόπος, διάγραμμα, 32.h6!» είναι απόσπασμα από τη θέση του)
          const same = (n: GameNode) => at(n) === d.placement;
          const sure = !image || ((opts.fixed?.(d.id!) ?? false) && !floating);
          // (όχι όταν το κείμενο που ακολουθεί συνεχίζει την παρτίδα καλύτερα απ' ό,τι ξεκινά από τη θέση του διαγράμματος, ή
          // εξίσου όταν το διάγραμμα διαφέρει σε ως 2 τετράγωνα, κομμάτι που διαβάστηκε λάθος: η θέση του πακέτου είναι
          // συνήθως σωστή, αλλά δείχνει και θέσεις βαριάντας)
          const keep = () => {
            const next: BookParagraph[] = [];
            for (let j = pi + 1; j < paragraphs.length && next.length < 4; j++) if (!ex.consumed.has(j)) next.push(paragraphs[j]);
            const { tip, diagram } = b.runsAfter(next, d.placement, d.turn);
            return tip > diagram || (tip === diagram && tip > 0 && Math.min(squaresApart(at(b.mainTip), d.placement), squaresApart(at(b.cursor), d.placement)) <= 2);
          };
          // (κινήσεις που χάθηκαν λίγο πριν από το διάγραμμα: συμπληρώνονται, `bridge`)
          if (sure && image && !same(b.mainTip) && !same(b.cursor) && squaresApart(at(b.mainTip), d.placement) <= 6 && !b.atPlacement(d.placement, d.turn)) {
            let next: { num: number; black: boolean } | null = null;
            for (let j = pi + 1; j < paragraphs.length && j < pi + 6 && !next; j++) {
              const q = paragraphs[j];
              if (q.heading) break;
              if (q.diagram || ex.consumed.has(j)) continue;
              const mv = tokenize(q.runs, bare).find((x): x is Extract<Token, { k: 'move' }> => x.k === 'move' && x.num !== null);
              if (mv?.num != null) next = { num: mv.num, black: mv.black };
            }
            b.bridge(d.placement, d.turn, next);
          }
          if (sure && !same(b.mainTip) && !same(b.cursor) && !b.atPlacement(d.placement, d.turn) && !(image && keep())) {
            // (παράκαμψη: όταν η κύρια γραμμή συνεχίζει πιο κάτω, η παρτίδα περιμένει και η βαριάντα του διαγράμματος
            // πάει σε απόσπασμα· με την πρώτη κίνηση της κύριας γραμμής που ταιριάζει, η ανάγνωση γυρίζει σε αυτήν)
            const more: BookParagraph[] = [];
            for (let j = pi + 1; j < paragraphs.length && more.length < 8; j++) if (!ex.consumed.has(j)) more.push(paragraphs[j]);
            if (image && !suspended && b.mainResumes(more)) {
              flushProbe();
              if (!slots.has(b)) slots.set(b, games.length);
              suspended = { builder: b, gameChapter, chapterNo, chapterTitle, section, intro, introAlone, lastHeading };
              detour = true;
              builder = null;
            }
            startPart(b);
          }
          if (sure && builder !== b) {
            (builder as Builder | null)?.startFrom(d.placement, d.turn);
            if (builder) (builder as Builder).fromImage = image;
          }
          record();
        } else {
          // διάγραμμα μετά από διάγραμμα-εικόνα που έχει μόνο κείμενο, χωρίς κινήσεις («This is called the Ruy López…» κάτω
          // από το διάγραμμά του και μετά το διάγραμμα της Σικελικής): το προηγούμενο μένει δική του παρτίδα με το
          // κείμενό του (αλλιώς η νέα θέση έπαιρνε το κείμενο του προηγούμενου διαγράμματος)
          const prev = builder as Builder | null;
          if (prev && prev.fromImage && !prev.exercise && prev.game.root.comment.trim() && trusted && !(image && floating) && prev.game.root.fen.split(' ')[0] !== d.placement) startPart(prev);
          if (!builder) start(chapterName(), '');
          flushProbe();
          // (όχι διάγραμμα που «αιωρείται»: η θέση του είναι αλλού στην παρτίδα)
          if (trusted && !(image && floating)) {
            (builder as Builder | null)?.startFrom(d.placement, d.turn);
            if (builder) (builder as Builder).fromImage = image;
          }
          record();
        }
      }
      continue;
    }
    if (afterExercise && !p.heading && !/\d\s?\.\s?(?:\.\.\s?)?[KQRBNa-h¢£¤¥¦O0]/.test(p.text)) {
      // ερώτηση της άσκησης («White to play and win»): σχόλιο στην αρχή της· άλλο κείμενο χωρίς κινήσεις φεύγει
      const cur = builder as Builder | null;
      if (cur?.exercise && cur.empty && QUESTION_RE.test(p.text)) cur.note(p.text.trim());
      continue;
    }
    if (p.heading) afterExercise = false;
    // «Variation Index» από εικόνα: οι γραμμές του, ετικέτες και κινήσεις χωρίς πρόζα, επαναλαμβάνουν
    // το δέντρο του κεφαλαίου και οι αριθμοί σελίδων τους χάθηκαν· δεν διαβάζονται (το ευρετήριο τελειώνει στην πρώτη
    // παράγραφο με πρόζα ή στην επόμενη επικεφαλίδα)
    if (p.heading) varIndex = imageText && /^variation index$/i.test(p.text.trim());
    else if (varIndex && !p.diagram) {
      if (!/\b[A-Za-z]{4,}\b/.test(p.text.replace(/\b[A-Z]\d{0,3}\)/g, ''))) continue;
      varIndex = false;
    }
    // «Game 3» και από κάτω «G.Greco ■ anonymous» / «Europe 1620» (όχι επικεφαλίδα)
    if (!p.heading && !p.diagram && gameChapter && waitChapterTitle && !inToc) {
      const pl = gamePlayers(p.text);
      if (pl) {
        startPlayers(pl, pi);
        continue;
      }
    }
    // «Game 4» και μετά οι παίκτες σε χωριστές γραμμές, χωρίς παύλα: οι επικεφαλίδες της παρτίδας
    const head = !p.heading && gameChapter && waitChapterTitle && !inToc ? gameHeadOf(p) : null;
    if (head) {
      waitChapterTitle = false;
      chapterTitle = `${head.white} – ${head.black}`;
      start(pgnName(head.white), pgnName(head.black));
      const h = (builder as Builder | null)!.game.headers;
      if (head.site) h.Site = head.site;
      if (head.year) h.Date = `${head.year}.??.??`;
      if (head.whiteElo) h.WhiteElo = head.whiteElo;
      if (head.blackElo) h.BlackElo = head.blackElo;
      const runs = sliceRuns(p.runs, head.end);
      p = { ...p, runs, text: runs.map((r) => r.text).join(''), lineStarts: undefined };
    }
    // αριθμημένη ολόκληρη παρτίδα μέσα σε κεφάλαιο: νέα παρτίδα από την αρχή, με τους παίκτες της
    const numbered = !head && !p.heading && !p.diagram && !inToc ? numberedGameHead(p, paragraphs[pi + 1], paragraphs[pi + 2]) : null;
    if (numbered) {
      // (η θεωρία του κεφαλαίου περιμένει: το κείμενο μετά τις παρτίδες συνεχίζει εκεί)
      if (!suspended && !numberedRun && builder && !(builder as Builder).empty) {
        const theory = builder as Builder;
        flushProbe();
        if (!slots.has(theory)) slots.set(theory, games.length);
        suspended = { builder: theory, gameChapter, chapterNo, chapterTitle, section, intro, introAlone, lastHeading };
        builder = null;
      }
      numberedRun = true;
      start(pgnName(numbered.white), pgnName(numbered.black));
      const h = (builder as Builder | null)!.game.headers;
      if (numbered.site) h.Site = numbered.site;
      if (numbered.year) h.Date = `${numbered.year}.??.??`;
      pi += numbered.skip;
      const runs = sliceRuns(p.runs, numbered.end);
      p = { ...p, runs, text: runs.map((r) => r.text).join(''), lineStarts: undefined };
    }
    const text = p.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // αριθμοί χωρίς τελεία: οι μεγάλες κινήσεις της κύριας γραμμής και οι υπότιτλοι («Others:») δεν είναι επικεφαλίδες
    if (bare && p.heading && (BARE_MOVE_HEAD_RE.test(normalizeBookText(text)) || text.endsWith(':'))) p = { ...p, heading: false };
    // βιβλίο από εικόνα: έντονη γραμμή κινήσεων στη μέση της παρτίδας που διαβάστηκε ως επικεφαλίδα («8.exf5! gxf5»,
    // «26...fxg6 27.♕xg6 hxg6», «g6 36.♖e6 ♕xg3†») είναι κινήσεις, όχι ενότητα· όχι τίτλος με λέξεις («6.♘a4 and 6.♘b3», «10.♖e1 Introduction»)
    // (όχι ανάμεσα σε δύο τίτλους: δεύτερη γραμμή του τίτλου του κεφαλαίου, «7.0–0 e5 Sidelines» / «8.e3» / «Variation Index»)
    const titled = (dir: 1 | -1, words: boolean) => {
      for (let k = pi + dir; k >= 0 && k < paragraphs.length; k += dir) {
        const q = paragraphs[k];
        if (!q.diagram && !q.text.trim()) continue;
        return !!q.heading && !q.diagram && (!words || !midMoveHead(q.text));
      }
      return false;
    };
    if (!bare && !ocrText && p.heading && imageText && midMoveHead(text) && !(titled(-1, true) && titled(1, false))) p = { ...p, heading: false };
    // κεφάλαιο με «Variation Index» (`variationIndexFrame`): η σειρά κινήσεων του κεφαλαίου από την πρώτη κίνηση («1.d4 ♘f6 2.♘f3 g6
    // 3.g3 ♗g7 4.♗g2 0–0 5.0–0», πάνω από το πρώτο διάγραμμα) είναι κινήσεις, όχι ενότητα (ο τίτλος είναι ήδη του κεφαλαίου):
    // αλλιώς δεν παιζόταν και όλο το κεφάλαιο ξεκινούσε από το διάγραμμα, χωρίς δέντρο από την αρχή
    if (framed && p.heading && /^1\s?\.\s?\S/.test(normalizeBookText(text)) && !/(?<![\p{L}\d])\p{L}{3,}(?![\p{L}\d])/u.test(normalizeBookText(text).replace(/[KQRBN-]/g, ' '))) p = { ...p, heading: false };
    // πρόζα με κινήσεις σε έντονα που διαβάστηκε επικεφαλίδα («Equality results from: 22.♘fd5 ♘xd5 23.♘xd5»): όχι όνομα ενότητας
    if (!bare && !ocrText && p.heading && imageText && /^[^:\d]{3,40}:\s*\d{1,3}\s?\.\s?\S/.test(normalizeBookText(text))) p = { ...p, heading: false };
    if (ocrText && !p.heading && !p.diagram) {
      if (shortLine(text) && (headCount.get(headKey(text)) ?? 0) >= 4) continue;
    }
    if (!bare && p.heading && ocrText) {
      // βιβλίο από OCR: η αρχική γραμμή του κεφαλαίου σε μεγάλα γράμματα («1.d4 Nf6 2.c4 g6») είναι κινήσεις της κύριας
      // γραμμής· διάγραμμα που διαβάστηκε ως κείμενο («k�:fj;;;:�%�t») δεν είναι τίτλος
      // και η ενότητα με κινήσεις («A) 6.b4?!») είναι ετικέτα μέσα στην παρτίδα του κεφαλαίου (όχι νέα παρτίδα από την
      // αρχή)· κεφαλίδες σελίδας που επαναλαμβάνονται («Lines without c4») σβήνουν
      const norm = normalizeBookText(text);
      const moves = /\d\s?\.\S*[a-h][1-8]|\dO-O/.test(norm);
      if (MOVE_HEAD_RE.test(norm) || (LABEL_RE.test(text) && moves)) p = { ...p, heading: false, runs: p.runs.map((r) => ({ ...r, main: true })) };
      else if (/�/.test(text) || (!LABEL_RE.test(text) && !moves && (text.match(/\p{L}/gu)?.length ?? 0) < text.replace(/\s/g, '').length * 0.6)) continue;
      else if (!/^variation index$/i.test(text) && (headCount.get(headKey(text)) ?? 0) >= 4) continue;
    }
    if (p.heading && TOC_RE.test(text)) {
      // περιεχόμενα: στην αρχή του βιβλίου ως το πρώτο κεφάλαιο, στο τέλος ως το τέλος
      inToc = true;
      tocPage = p.page;
      continue;
    }
    // βιβλίο χωρίς επικεφαλίδες «Chapter N»: τα περιεχόμενα δεν είναι πάνω από 6 σελίδες
    if (inToc && p.page - tocPage > 6 && tocPage < paragraphs[paragraphs.length - 1].page - 20) inToc = false;
    if (p.heading && PART_RE.test(text)) {
      inToc = false;
      waitPartTitle = true;
      continue;
    }
    if (p.heading && waitPartTitle && chapterOf(text) === null) {
      waitPartTitle = false;
      continue;
    }
    // βιβλία με μία παρτίδα ανά ενότητα «Game 7»: κι αυτή κεφάλαιο, και ας μην είναι επικεφαλίδα
    // (και «Game 10 A.White ■ B.Black City 2002» σε μία γραμμή, από εικόνα: η παύλα διαβάστηκε «■»)
    const gameNo = p.heading || /^game\s+\d{1,3}$/i.test(text) || GAME_LINE_RE.test(text.replace(/\s*■\s*/g, ' ■ ')) || (/^game\s+\d{1,3}\s/i.test(text) && gamePlayers(text.replace(GAME_RE, '')) !== null) ? (GAME_RE.exec(text)?.[1] ?? null) : null;
    const sectionNo = p.heading && SECTION_HEAD_RE ? (SECTION_HEAD_RE.exec(text)?.[1] ?? null) : null;
    // «Chapter One» σε έντονα αλλά όχι επικεφαλίδα (από εικόνα), με τον τίτλο από κάτω ως επικεφαλίδα («1 e4 e5»)
    const titleNext = paragraphs[pi + 1]?.heading && !paragraphs[pi + 1].diagram ? paragraphs[pi + 1] : null;
    const chapterLine = !p.heading && text.length <= 24 && /^chapter\s+[\w-]+$/i.test(text) && titleNext !== null;
    const chapter = gameNo ?? sectionNo ?? (p.heading || chapterLine ? chapterOf(text) : null);
    // (στα ευρετήρια του τέλους τα «Chapter N» είναι κατάλογος, όχι κεφάλαια)
    if (chapter !== null && inToc && tocPage >= paragraphs[paragraphs.length - 1].page - 20) continue;
    if (chapter !== null) {
      inToc = false;
      waitPartTitle = false;
      // (το «Conclusion» του προηγούμενου κεφαλαίου τελειώνει εδώ, και ας μην είναι επικεφαλίδα το «GAME 3»)
      conclusion = null;
      const theory = builder as Builder | null;
      if (gameNo !== null && (!gameChapter || theory?.section || theory?.game === intro) && !exercises && theory && !theory.exercise && theory.labelNames.size && theory.game.root.children.length) {
        finalize();
        flushProbe();
        if (!slots.has(theory)) slots.set(theory, games.length);
        suspended = { builder: theory, gameChapter, chapterNo, chapterTitle, section, intro, introAlone, lastHeading };
        builder = null;
      } else if (gameNo === null) finalize();
      finish();
      closeChapter(gameNo !== null);
      // (το κεφάλαιο του βιβλίου, για τις ενότητες ανάμεσα σε παρτίδες «Game N», βλ. πιο κάτω)
      if (gameNo === null) outer = null;
      else if (!gameChapter) outer = { no: chapterNo, title: chapterTitle, section };
      chapterNo = chapter;
      gameChapter = gameNo !== null;
      chapterTitle = sectionNo !== null ? text : text.replace(gameChapter ? GAME_RE : CHAPTER_RE, '').replace(/^[\s–:-]+/, '').trim();
      if (chapterLine && !chapterTitle && titleNext) {
        chapterTitle = titleNext.text.replace(/\s+/g, ' ').trim();
        ex.consumed.add(pi + 1);
      }
      waitChapterTitle = !chapterTitle;
      section = 0;
      exercises = false;
      started = true;
      const pl = gameChapter && chapterTitle ? gamePlayers(chapterTitle) : null;
      if (pl) startPlayers(pl, pi);
      else if (!waitChapterTitle) {
        exercises = /exercis|ασκήσ|aufgab|test your/i.test(chapterTitle);
        start(chapterName(), exercises ? 'Ασκήσεις' : 'Εισαγωγή', !gameChapter);
        titleOpen = bare;
        // («Chapter two» και από κάτω ο τίτλος σε δύο γραμμές, «How to Start the Game with the» / «White Pieces»: η
        // δεύτερη γραμμή συνεχίζει την πρώτη, που διαβάστηκε μαζί με το «Chapter two»)
        headTitle = chapterLine ? { kind: 'chapter', pi: pi + 1, text: chapterTitle } : { kind: 'chapter', pi, text };
      }
      continue;
    }
    if (inToc) continue;
    // ευρετήριο βαριαντών με αριθμούς σελίδων στην αρχή του κεφαλαίου («A2) 7.cxd5 Nxd5 8.Qb3 216»): όχι
    // κινήσεις ούτε ετικέτες (η «B)» του ευρετηρίου δεν είναι ακόμη η ενότητα B)
    if (indexEntry(pi)) continue;
    if (p.heading && waitChapterTitle && gameChapter && !inToc) {
      const pl = gamePlayers(text);
      if (pl) {
        startPlayers(pl, pi);
        continue;
      }
    }
    if (p.heading && waitChapterTitle) {
      chapterTitle = text;
      waitChapterTitle = false;
      exercises = /exercis|ασκήσ|aufgab|test your/i.test(chapterTitle);
      // «Game 7» και μετά «Spielmann - Wahle»: οι παίκτες της παρτίδας
      const players = gameChapter ? /^(.+?)\s+[-–]\s+(.+)$/.exec(chapterTitle) : null;
      if (players) start(players[1], players[2]);
      else start(chapterName(), exercises ? 'Ασκήσεις' : 'Εισαγωγή', !gameChapter);
      titleOpen = bare && !players;
      if (!players) headTitle = { kind: 'chapter', pi, text };
      continue;
    }
    // τίτλος σε δύο γραμμές: «Ready for the pole position:» / «The Grand Prix Attack against the Sicilian»
    const open = builder as Builder | null;
    if (p.heading && !bare && headTitle && pi === headTitle.pi + 1 && open?.empty && !open.game.root.comment && titleGoesOn(headTitle.text, text)) {
      const sep = /[\p{L}\d]-$/u.test(headTitle.text) ? '' : ' ';
      if (headTitle.kind === 'chapter') {
        chapterTitle = `${chapterTitle}${sep}${text}`;
        open.game.headers.White = chapterName();
      } else {
        open.game.headers.Black = `${open.game.headers.Black}${sep}${text}`;
        lastHeading = open.game.headers.Black;
      }
      headTitle = { kind: headTitle.kind, pi, text };
      continue;
    }
    // αριθμοί χωρίς τελεία: ο τίτλος σε δύο γραμμές («Advance Variation: Introduction and» / «Traditional Lines»)
    const current = builder as Builder | null;
    if (p.heading && titleOpen && current) {
      chapterTitle = `${chapterTitle} ${text}`;
      current.game.headers.White = chapterName();
      continue;
    }
    titleOpen = false;
    if (SKIP_RE.test(text)) continue;
    // «Conclusion» (τίτλος στο κέντρο ή επικεφαλίδα): το κείμενο ως την επόμενη επικεφαλίδα είναι το συμπέρασμα του
    // κεφαλαίου, στο τέλος της κύριας γραμμής, και οι κινήσεις που αναφέρει μένουν κείμενο (έσπαγε σε κομμάτια, ένα σε
    // κάθε κίνηση που ανέφερε)
    const open2 = builder as Builder | null;
    if (CONCLUSION_RE.test(text) && (p.heading || p.centered || text.length < 20) && open2 && !open2.empty && !open2.exercise) {
      conclusion = text.replace(/[.:]$/, '');
      continue;
    }
    if (conclusion !== null && open2 && !p.heading) {
      open2.noteEnd(normalizeBookText(conclusion ? `${conclusion}: ${text}` : text));
      conclusion = '';
      continue;
    }
    // παρτίδα του βιβλίου: «Kochiev — Ivanov USSR 1976» και κινήσεις από την πρώτη (τόπος/χρονιά και στην επόμενη
    // γραμμή: «Club Match 1988»)· τα διαγράμματά της μένουν μέσα της
    // βιβλίο από εικόνα: παράδειγμα από διάγραμμα με τους παίκτες του («8. White – Black» / «City Year» /
    // διάγραμμα): νέα παρτίδα με τους παίκτες (ήταν όνομα ενότητας ή σχόλιο της προηγούμενης)
    const example = imageText && !exercises && !bare && text.length <= 80 ? exampleHead(pi, text) : null;
    if (example) {
      const prev = builder as Builder | null;
      const lead = prev && !prev.game.root.children.length && !prev.exercise ? prev.game.root.comment : '';
      if (lead) prev!.game.root.comment = '';
      started = true;
      start(pgnName(example.white), pgnName(example.black));
      if (lead) builder!.game.root.comment = lead;
      withPlayers.add(builder!);
      const h = builder!.game.headers;
      h.Event = chapterName();
      if (example.site) h.Site = example.site;
      h.Date = `${example.year}.??.??`;
      ex.consumed.add(example.at);
      continue;
    }
    const players = !exercises && text.length <= 80 ? PLAYERS_RE.exec(text) : null;
    if (players && startsGame(pi)) {
      let site = players[3]?.trim() ?? '';
      let year = players[4] ?? '';
      let black = players[2];
      let ni = pi + 1;
      while (ni < paragraphs.length && !paragraphs[ni].text.trim() && !paragraphs[ni].diagram) ni++;
      const next = paragraphs[ni]?.text.trim() ?? '';
      const nextYear = /^(.*?),?\s*((?:1[5-9]|20)\d\d)\.?$/.exec(next);
      if (!year && next.length < 40 && nextYear && !FIRST_NUM_RE.test(normalizeBookText(next))) {
        // (όταν ο τόπος και η χρονιά είναι στην επόμενη γραμμή, ό,τι ακολουθεί τον μαύρο στην ίδια είναι το υπόλοιπο όνομά
        // του: π.χ. «First Last – First Last» / «City 2011»)
        if (site && nextYear[1].trim() && /^\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?$/u.test(site)) {
          black = `${black} ${site}`;
          site = '';
        }
        site = site || nextYear[1].trim();
        year = nextYear[2];
        ex.consumed.add(ni);
      }
      // η εισαγωγή του κεφαλαίου χωρίς κινήσεις (μόνο κείμενο) γίνεται το πρώτο σχόλιο της παρτίδας, όχι χωριστή παρτίδα
      const prev = builder as Builder | null;
      const lead = prev && !prev.game.root.children.length && !prev.exercise ? prev.game.root.comment : '';
      if (lead) prev!.game.root.comment = '';
      started = true;
      start(pgnName(players[1]), pgnName(black));
      if (lead) builder!.game.root.comment = lead;
      withPlayers.add(builder!);
      const h = builder!.game.headers;
      h.Event = chapterName();
      if (site) h.Site = site;
      if (year) h.Date = `${year}.??.??`;
      continue;
    }
    if (!started) {
      // πριν από το πρώτο κεφάλαιο: εξώφυλλο, πνευματικά δικαιώματα, περιεχόμενα· αλλά αν το κείμενο αρχίζει
      // κατευθείαν με κινήσεις (χωρίς κεφάλαια), ξεκινά μία παρτίδα (και σε περιγραφική σημειογραφία: «1. P-K4»)
      if (!p.heading && (bare ? /\b1\s(e4|d4|c4|Nf3|g3|b3|f4|[\uE800-\uEFFF]a1)(?!\w)/ : /\b1\.\s?(e4|d4|c4|Nf3|g3|b3|f4|[\uE800-\uEFFF]a1)(?!\w)/).test(normalizeBookText(text))) {
        started = true;
        start(opts.title || 'Βιβλίο', '');
      } else continue;
    }
    if (p.heading) {
      // αριθμοί χωρίς τελεία: μία παρτίδα ανά κεφάλαιο, άρα ένας άλλος τίτλος μένει σχόλιο μέσα της· το ίδιο σε παρτίδα
      // «Game N» που δεν τελείωσε ακόμη (χωρίς αποτέλεσμα: υπότιτλος του σχολιασμού)
      // (όχι ενότητα με ετικέτα, «B. Black plays …d7-d6…», «II. …»: αυτή ξεκινά, και το κείμενό της πάει στην επόμενη παρτίδα)
      const labelled = /^(?:[A-H]|[IVX]{1,4})\.\s+\p{Lu}/u.test(text);
      // παρτίδες «Game N» μέσα στα κεφάλαια (αριθμοί χωρίς τελεία): ανάμεσα στις παρτίδες οι ενότητες του κεφαλαίου
      // («Philidor Defence», «Petroff Defence»). Επικεφαλίδα μετά από παρτίδα που τελείωσε, ή όταν το κείμενο ξαναρχίζει
      // από την πρώτη κίνηση, ξεκινά ενότητα του κεφαλαίου του βιβλίου (όχι σχόλιο της παρτίδας, ούτε τίτλος της)
      if (bare && gameChapter && current && !current.empty && !current.exercise && sectionLike(text) && (ended(current) || restarts(pi))) {
        gameChapter = false;
        chapterNo = outer?.no ?? '';
        chapterTitle = outer?.title ?? '';
        section = outer?.section ?? 0;
        start(chapterName(), text, true);
        lastHeading = text;
        headTitle = { kind: 'section', pi, text };
        continue;
      }
      const inGame = gameChapter && current && !current.empty && current.game.headers.Result === '*' && !current.exercise && !labelled;
      if (bare || inGame) p = { ...p, heading: false };
      else {
        // ενότητα κεφαλαίου («a) 3.Bc4») ή άλλος τίτλος: νέα παρτίδα· το «Variation Index» παίρνει τον
        // τίτλο του κεφαλαίου πριν από αυτό
        const index = /^variation index$/i.test(text);
        // (μετά από αριθμημένες ολόκληρες παρτίδες: τέλος τους, όπως πιο κάτω· αλλιώς η θεωρία που περίμενε έμενε
        // «σε αναμονή» ως το τέλος του βιβλίου και καμία παράκαμψη διαγράμματος δεν γινόταν πια)
        if (suspended && numberedRun) {
          finish();
          restore(suspended);
          numberedRun = false;
        }
        start(chapterName(), index && lastHeading ? lastHeading : text, true);
        if (!index) {
          lastHeading = text;
          headTitle = { kind: 'section', pi, text };
        }
        continue;
      }
    }
    if (exercises && EXERCISE_HEAD_RE.test(text) && !p.runs.some((r) => !r.main && r.text.trim())) {
      const [w, b] = text.split(/\s[–-]\s/);
      start(w?.trim() || chapterName(), b?.trim() || '');
      builder!.note('Η θέση της άσκησης είναι διάγραμμα (εικόνα) στο βιβλίο· εδώ μένουν η ερώτηση και η λύση ως κείμενο.');
      continue;
    }
    // μετά τις αριθμημένες ολόκληρες παρτίδες: κείμενο που ξαναρχίζει από την πρώτη κίνηση («1.e4 c5 2.♘f3 …», η θεωρία
    // του επόμενου μέρους) ή επικεφαλίδα επιστρέφει στην παρτίδα της θεωρίας που περίμενε
    if (suspended && numberedRun && !numbered) {
      const mv = p.heading ? null : tokenize(p.runs, bare).find((t) => t.k === 'move');
      if (p.heading || (mv?.k === 'move' && mv.num === 1 && !mv.black && builder && !(builder as Builder).empty)) {
        finish();
        restore(suspended);
        numberedRun = false;
      }
    }
    // η επόμενη ενότητα του κεφαλαίου που περίμενε («B) 6.♗g5» μετά από «A)…»), αν χωρά στη γραμμή του: εκεί συνεχίζει
    if (suspended && gameChapter && builder) {
      const toks = tokenize(p.runs, bare);
      const lab = toks.find((t) => t.k !== 'text' || t.raw.trim());
      const mv = toks.find((t) => t.k === 'move');
      const name = lab?.k === 'label' && /^[B-Z]$/.test(lab.name) ? lab.name : '';
      const prevLabel = name ? String.fromCharCode(name.charCodeAt(0) - 1) : '';
      if (prevLabel && suspended.builder.labelNames.has(prevLabel) && !suspended.builder.labelNames.has(name) && !(builder as Builder).labelNames.has(prevLabel) && mv?.k === 'move' && mv.num !== null && suspended.builder.fitsLine((mv.num - 1) * 2 + (mv.black ? 2 : 1), mv.san)) {
        finish();
        restore(suspended);
      }
    }
    if (!builder) start(chapterName(), '');
    // (οι επόμενες παράγραφοι ως την επόμενη επικεφαλίδα ή παρτίδα, ως 4: για τη συμπλήρωση χαμένης κίνησης)
    if (ocrText || letterCipher) {
      const up: BookParagraph[] = [];
      for (let k = pi + 1; k < paragraphs.length && up.length < 4; k++) {
        const q = paragraphs[k];
        if (q.heading || q.diagram || PLAYERS_RE.test(q.text.trim())) break;
        if (q.text.trim()) up.push(q);
      }
      builder!.upcoming = up;
      builder!.pageBoards = [p.page, p.page + 1].flatMap((pg) => boardsByPage.get(pg) ?? []);
    } else if (imageText) {
      // (κείμενο από εικόνα: η συνέχεια της κύριας γραμμής, πέρα από διαγράμματα, ως την επόμενη επικεφαλίδα ή παρτίδα)
      const up: BookParagraph[] = [];
      for (let k = pi + 1; k < paragraphs.length && up.length < 12; k++) {
        const q = paragraphs[k];
        if (q.diagram) continue;
        if (q.heading || PLAYERS_RE.test(q.text.trim()) || numberedGameHead(q, paragraphs[k + 1], paragraphs[k + 2])) break;
        if (q.text.trim()) up.push(q);
      }
      builder!.upcoming = up;
    }
    const lead = /^([A-Za-z]{1,2}\d{0,6})\)\s/.exec(text) ?? (imageText ? DOT_LABEL_RE.exec(text) : null);
    if (lead) builder!.labelNames.add(lead[1]);
    // (τέλος της παράκαμψης: η κύρια γραμμή της παρτίδας που περίμενε συνεχίζει)
    if (detour && suspended && suspended.builder.continuesMain(p)) {
      finish();
      restore(suspended);
      detour = false;
    }
    // θέση «W/B» («With White to move… 1 ♔b7! … If Black is to move, he draws: 1...♔e5! 2 ♔b7»): η γραμμή όπου
    // ξεκινά ο άλλος είναι δεύτερη παρτίδα από την ίδια θέση (σε μία παρτίδα η αρχική θέση έχει έναν που παίζει)
    // (η πρώτη γραμμή μπορεί να είναι στην ίδια παράγραφο: ο χωρισμός γίνεται όταν, αφού παιχτεί αυτή, η αρχική θέση έχει
    // τον άλλο να παίζει)
    const cur = builder as Builder;
    const pl = cur.game.root.fen.split(' ')[0];
    // (το πρώτο σημείο όπου πριν από αυτό έχει παιχτεί ήδη η πρώτη κίνηση του άλλου: «With White to move… 1 ♔b7!» δεν
    // χωρίζει, το «If Black is to move… 1...♔e5!» που ακολουθεί ναι)
    const cands =
      pl === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
        ? []
        : ([['b', WB_BLACK_RE.exec(p.text)], ['w', WB_WHITE_RE.exec(p.text)]] as const)
            .flatMap(([side, m]) => (m ? [{ side, at: m.index + m[0].length }] : []))
            .filter(({ side, at }) => !cur.empty || (side === 'b' ? /(?:^|\s)1\s?\.?\s?(?![.…\d])\S/ : /(?:^|\s)1\s?(?:\.\.\.|…)\s?\S/).test(normalizeBookText(p.text.slice(0, at))))
            .sort((a, b) => a.at - b.at);
    const { side, at } = cands[0] ?? { side: null, at: -1 };
    if (side) {
      cur.paragraph({ ...p, runs: runsUpTo(p.runs, at), text: p.text.slice(0, at) });
      p = { ...p, runs: sliceRuns(p.runs, at), text: p.text.slice(at) };
      const root = cur.game.root.fen.split(' ');
      if (!cur.empty && root[1] !== side) {
        startPart(cur);
        const next = builder as Builder;
        next.startFrom(root[0], side);
        Object.assign(next, { fromImage: cur.fromImage, upcoming: cur.upcoming });
      }
    }
    if (indexLines.has(paragraphs[pi])) {
      // γραμμή του καταλόγου του κεφαλαίου (`variationIndexFrame`): μόνο οι κινήσεις και οι ετικέτες της· ό,τι δεν δένει
      // (σύμβολο κομματιού που δεν διαβάστηκε στα μεγάλα γράμματα του καταλόγου) δεν γίνεται σχόλιο ούτε κίνηση «εκτός»
      // (η θεωρία το επαναλαμβάνει)· το κεφάλαιο μόλις ξεκίνησε, άρα το δέντρο είναι μικρό
      const b = builder as Builder;
      const keep = new Map<GameNode, [string, string]>();
      const all = (n: GameNode, f: (n: GameNode) => void) => {
        f(n);
        for (const c of n.children) all(c, f);
      };
      all(b.game.root, (n) => keep.set(n, [n.comment, n.preComment]));
      const u = b.unplaced.length;
      b.paragraph(p);
      b.unplaced.length = u;
      all(b.game.root, (n) => {
        const k = keep.get(n);
        if (!k) indexNodes.add(n);
        [n.comment, n.preComment] = k ?? ['', ''];
      });
      continue;
    }
    builder!.paragraph(p);
  }
  finalize();
  finish();
  closeChapter();
  if (skippedDiagrams && !exerciseGames) warnings.push({ page: diagramPage, text: `${skippedDiagrams} ασκήσεις ή ενότητες δεν μπήκαν: ξεκινούν από θέση που υπάρχει μόνο ως εικόνα (διάγραμμα) στο βιβλίο.` });

  // βιβλίο από εικόνα: άσκηση χωρίς παίκτες που η λύση της αρχίζει με την πηγή («g Baadur Jobava – Alexander Grischuk,
  // Calvia (ol) 2004 White's attack…», το «g» από τις συντεταγμένες του διαγράμματος): οι παίκτες, ο τόπος και η χρονιά
  // από εκεί (αλλιώς έμενε «? – ?»)
  if (imageText) {
    for (const g of games) {
      const h = g.headers;
      if (h.Exercise === undefined || h.White !== '?' || h.Black !== '?') continue;
      const m = EXERCISE_SOURCE_RE.exec(g.root.comment);
      if (!m) continue;
      Object.assign(h, { White: pgnName(m[1]), Black: pgnName(m[2]), Site: m[3].trim(), Date: `${m[4]}.??.??` });
      g.root.comment = g.root.comment.slice(m[0].length);
    }
  }
  if (opts.shapes) for (const g of games) addShapes(g.root, bare);
  // βιβλίο από εικόνα: τα σύμβολα κομματιών στους τίτλους ως γράμματα («6.♘a4 and 6.♘b3» φαινόταν «6. a4 and 6. b3» ή
  // με κουτάκια)
  if (imageText) {
    for (const g of games) {
      for (const k of ['White', 'Black', 'Event']) {
        const v = g.headers[k];
        if (v && /[-]/.test(v)) g.headers[k] = glyphShown(normalizeBookText(v));
      }
    }
  }
  const stats: BookStats = { games: games.length, moves: 0, variations: 0, comments: 0, nags: 0, arrows: 0, circles: 0, unplaced: warnings.length };
  for (const g of games) countTree(g.root, stats);
  // (μετά τις μετρήσεις: οι κινήσεις που συμπληρώνονται για να δέσουν τα κομμάτια δεν είναι κινήσεις του βιβλίου)
  // (όχι στο πέρασμα που μόνο μαθαίνει τα σύμβολα των κομματιών: το αποτέλεσμά του δεν κρατιέται)
  if (framed && !glyphVotes) {
    stats.moves -= joinChapters(games);
    stats.games = games.length;
  }
  // ασκήσεις με τη λύση στη θεωρία: η συνέχεια της θεωρίας από την ίδια θέση γίνεται η λύση τους (μετά
  // τις μετρήσεις: δεν είναι νέες κινήσεις του βιβλίου). Η θέση συγκρίνεται χωρίς τη σειρά, που το διάγραμμα δεν δείχνει.
  const open = games.flatMap((g, i) => (exerciseOf.has(g) && !g.root.children.length ? [i] : []));
  if (open.length) {
    const at = new Map<string, GameNode>();
    const walk = (n: GameNode) => {
      for (const c of n.children) {
        const k = c.fen.split(' ')[0];
        if (c.children.length && !at.has(k)) at.set(k, c);
        walk(c);
      }
    };
    for (const g of games) if (!g.headers.Exercise) walk(g.root);
    const copy = (from: GameNode, to: GameNode) => {
      for (const c of from.children) {
        const n = new GameNode();
        Object.assign(n, { parent: to, move: c.move, san: c.san, comment: c.comment, preComment: c.preComment, nags: [...c.nags], fen: c.fen, ply: to.ply + 1 });
        to.children.push(n);
        copy(c, n);
      }
    };
    // (διάγραμμα-εικόνα με 1–2 κομμάτια διαβασμένα λάθος: η θέση της θεωρίας του ίδιου κεφαλαίου που διαφέρει μόνο στο
    // όνομα των κομματιών, όχι σε θέση, και είναι μία· η θέση της άσκησης γίνεται η σωστή της θεωρίας)
    const board = (pl: string) => pl.split('/').flatMap((r) => [...r].flatMap((c) => (/\d/.test(c) ? Array<string>(Number(c)).fill('.') : [c])));
    const misread = (old: Game): GameNode | undefined => {
      const ref = exerciseOf.get(old)!;
      const a = board(old.root.fen.split(' ')[0]);
      let best: GameNode | undefined;
      let tie = false;
      for (const g of games) {
        if (g.headers.Exercise || !g.headers.White?.startsWith(`${ref.chapter}. `)) continue;
        const look = (n: GameNode) => {
          for (const c of n.children) {
            const b = board(c.fen.split(' ')[0]);
            let diff = 0;
            for (let q = 0; q < 64 && diff <= 2; q++) if (a[q] !== b[q]) diff += a[q] === '.' || b[q] === '.' ? 3 : 1;
            if (diff <= 2 && c.children.length) {
              if (best && best.fen.split(' ')[0] !== c.fen.split(' ')[0]) tie = true;
              best ??= c;
            }
            look(c);
          }
        };
        look(g.root);
      }
      return tie ? undefined : best;
    };
    for (const i of open) {
      const old = games[i];
      const src = at.get(old.root.fen.split(' ')[0]) ?? misread(old);
      if (!src) continue;
      const g = new Game(src.fen);
      for (const [k, v] of Object.entries(old.headers)) if (k !== 'FEN' && k !== 'SetUp') g.headers[k] = v;
      g.root.comment = old.root.comment;
      copy(src, g.root);
      games[i] = g;
    }
  }
  if (exerciseGames) {
    stats.exercises = exerciseGames;
    stats.solved = games.filter((g) => g.headers.Exercise && g.root.children.length).length;
  }
  const pgn = games.map((g) => writeGame(g)).join('\n\n') + '\n';
  return { games, stats, warnings, pgn };
}
