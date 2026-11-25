/**
 * Σημειώσεις εκδόσεων (Release Notes / Patch Notes) σε Ελληνικά και Αγγλικά, γραμμένες καθαρά για
 * τους σκακιστές-χρήστες της εφαρμογής. Νεότερη έκδοση πάντα πρώτη.
 */

export type Localized = { el: string; en: string };
export type NoteKind = 'new' | 'improved' | 'fix';
export type NoteCategory = 'share' | 'social' | 'db' | 'prep' | 'training' | 'app';

export interface ReleaseHighlight {
  icon: NoteCategory;
  title: Localized;
  desc: Localized;
}

export interface ReleaseItem {
  kind: NoteKind;
  title: Localized;
  desc: Localized;
}

export interface ReleaseSection {
  category: NoteCategory;
  title: Localized;
  items: ReleaseItem[];
}

export interface ReleaseNote {
  version: string;
  date: Localized;
  headline: Localized;
  subtitle: Localized;
  highlights: ReleaseHighlight[];
  sections: ReleaseSection[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '3.0.0',
    date: { el: 'Νοέμβριος 2026', en: 'November 2026' },
    headline: { el: 'Καλώς ήρθες στο Ruru Chess 3.0', en: 'Welcome to Ruru Chess 3.0' },
    subtitle: {
      el: 'Η μεγάλη έκδοση: αυτόνομη desktop εφαρμογή για Windows, ζωντανή Κοινή Ανάλυση με φωνή/κάμερα/βίντεο, Φίλοι & Ομάδες μελέτης, Προετοιμασία αντιπάλου και Watch Live.',
      en: 'The flagship release: standalone Windows desktop app, Live Shared Analysis with voice/camera/video, Friends & Study Teams, Opponent Preparation, and Watch Live.',
    },
    highlights: [
      {
        icon: 'share',
        title: { el: 'Κοινή Ανάλυση & Βίντεο', en: 'Shared Analysis & Video' },
        desc: {
          el: 'Αναλύστε ζωντανά με link, κρυπτογραφημένη φωνή/κάμερα και ενσωματωμένο YouTube, Twitch ή Kick.',
          en: 'Analyze together live via link with encrypted voice/camera and embedded YouTube, Twitch, or Kick.',
        },
      },
      {
        icon: 'social',
        title: { el: 'Φίλοι & Ομάδες Μελέτης', en: 'Friends & Study Teams' },
        desc: {
          el: 'Λίστα φίλων, chat, ομάδες με ρόλους, προσκλήσεις με ένα κλικ και αποστολή PGN βάσεων.',
          en: 'Friends list, chat, teams with roles, one-click invites, and direct PGN database sharing.',
        },
      },
      {
        icon: 'prep',
        title: { el: 'Προετοιμασία & Ζωντανά', en: 'Opponent Prep & Watch Live' },
        desc: {
          el: 'Φάκελος αντιπάλου από τοπικές βάσεις + Lichess/Chess.com και παρακολούθηση live τουρνουά.',
          en: 'Opponent dossier from local databases + Lichess/Chess.com, plus live tournament broadcasts.',
        },
      },
      {
        icon: 'app',
        title: { el: 'Αυτόνομη Εφαρμογή Windows', en: 'Standalone Windows App' },
        desc: {
          el: 'Δικό της παράθυρο χωρίς browser, Light & Dark θέμα, Ελληνικά & Αγγλικά, χωρίς διαφημίσεις.',
          en: 'Native desktop window without browser chrome, Light & Dark themes, English & Greek, zero ads.',
        },
      },
    ],
    sections: [
      {
        category: 'share',
        title: { el: 'Κοινή Ανάλυση & Ενσωματωμένο Βίντεο', en: 'Shared Live Analysis & Video' },
        items: [
          {
            kind: 'new',
            title: { el: 'Ζωντανή ανάλυση με link', en: 'Live analysis via link' },
            desc: {
              el: 'Μοιράσου οποιαδήποτε παρτίδα με ένα link — οι καλεσμένοι μπαίνουν κατευθείαν από τον browser χωρίς λογαριασμό και βλέπουν κινήσεις, βαριάντες, βέλη, σχόλια και τη μηχανή σου σε πραγματικό χρόνο.',
              en: 'Share any game with a link — guests join right from their browser with no account and see moves, variations, arrows, comments, and your engine in real time.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Φωνή, κάμερα & δικαιώματα host', en: 'Voice, camera & host controls' },
            desc: {
              el: 'Κρυπτογραφημένη φωνή και κάμερα με ένταση ανά άτομο, καρφίτσωμα κάμερας, κλείδωμα δωματίου και έλεγχο ποιος κάνει αλλαγές ή ανοίγει κάμερα.',
              en: 'End-to-end encrypted voice and camera with per-person volume, camera pinning, room lock, and controls for who can edit or use camera.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Πάνελ βίντεο YouTube, Twitch & Kick', en: 'YouTube, Twitch & Kick video panel' },
            desc: {
              el: 'Άνοιξε βίντεο ή live μετάδοση δίπλα στη σκακιέρα σε απλές παρτίδες ή στην Κοινή Ανάλυση («Για όλους» ή «Μόνο για μένα») — με συγχρονισμό play/pause & λεπτού για YouTube.',
              en: 'Watch broadcasts or lessons right next to the board in solo games or Shared Analysis (“For everyone” or “Only for me”) — with optional YouTube play/pause & timestamp sync.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Αποχώρηση host, παράδοση ρόλου & τερματισμός', en: 'Host leave, role transfer & end session' },
            desc: {
              el: 'Όταν φεύγει ο host μπορεί να αποχωρήσει μεταφέροντας αυτόματα τον ρόλο στον παλαιότερο συμμετέχοντα, να παραδώσει τον ρόλο χειροκίνητα ή να τερματίσει τη συνεδρία για όλους.',
              en: 'When leaving, the host can transfer host automatically to the oldest member, hand off host manually from the member menu, or end the session for everyone.',
            },
          },
        ],
      },
      {
        category: 'social',
        title: { el: 'Φίλοι & Ομάδες Μελέτης', en: 'Friends & Study Teams' },
        items: [
          {
            kind: 'new',
            title: { el: 'Προαιρετικός λογαριασμός Φίλων (16+)', en: 'Optional Friends account (16+)' },
            desc: {
              el: 'Χωρίς email ή κωδικό (μόνο κωδικός ανάκτησης), με μόνιμη λίστα φίλων, live κατάσταση, άμεσο chat και προσκλήσεις με ένα κλικ σε παρτίδα ή κοινή ανάλυση.',
              en: 'No email or password (recovery code only), with a permanent friends list, live presence, direct chat, and one-click invites to play or analyze.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Ομάδες μελέτης & αποστολή PGN', en: 'Study teams & PGN file sharing' },
            desc: {
              el: 'Φτιάξε ομάδες με ρόλους (ιδιοκτήτης, προπονητής, μέλος), ομαδικό chat, κοινή ανάλυση ομάδας και αποστολή βάσεων ή επιλεγμένων παρτίδων ως PGN με εισαγωγή με ένα κλικ.',
              en: 'Create teams with roles (owner, coach, member), team chat, team shared analysis, and send databases or selected games as PGN with one-click import.',
            },
          },
        ],
      },
      {
        category: 'db',
        title: { el: 'Βάσεις Δεδομένων & Ανάλυση με Μηχανή', en: 'Databases & Engine Analysis' },
        items: [
          {
            kind: 'new',
            title: { el: 'Άνοιγμα .cbh, .cbv, .si4 & .pgn (και σε .7z/.zip)', en: 'Open .cbh, .cbv, .si4 & .pgn (even in .7z/.zip)' },
            desc: {
              el: 'Διάβασε βάσεις PGN, ChessBase και Scid τοπικά χωρίς να αλλάζουν τα αρχικά αρχεία, με γρήγορα ευρετήρια για εκατομμύρια παρτίδες και εξαγωγή PGN όποτε θέλεις.',
              en: 'Read PGN, ChessBase, and Scid files locally without altering originals, with fast indexes for millions of games and standard PGN export anytime.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Προχωρημένη αναζήτηση & καθάρισμα βάσεων', en: 'Advanced search & database cleanup' },
            desc: {
              el: 'Αναζήτηση με παίκτη, Elo, ECO, έτος, ακριβή θέση, δομή πιονιών, υλικό ή ελιγμούς κομματιών, εντοπισμός διπλών παρτίδων και ενοποίηση ονομάτων.',
              en: 'Search by player, Elo, ECO, year, exact position, pawn structure, material balance, or piece maneuvers, plus duplicate detection and name cleanup.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Πλήρης ανάλυση UCI (Stockfish, Lc0, Maia)', en: 'Full UCI analysis (Stockfish, Lc0, Maia)' },
            desc: {
              el: 'Πολλές γραμμές ανάλυσης, δεύτερη μηχανή, μπάρα αξιολόγησης, βέλη στη σκακιέρα, αυτόματο blunder check με ακρίβεια & γράφημα, δέντρο ανοιγμάτων, εύρεση καινοτομίας και Syzygy 7 κομματιών.',
              en: 'Multi-line analysis, second engine, evaluation bar, board arrows, full-game blunder check with accuracy & graph, opening reference tree, novelty finder, and 7-piece Syzygy tablebases.',
            },
          },
        ],
      },
      {
        category: 'prep',
        title: { el: 'Προετοιμασία Αντιπάλου, Ζωντανά & Βιβλία PDF', en: 'Opponent Prep, Watch Live & PDF Books' },
        items: [
          {
            kind: 'new',
            title: { el: 'Προετοιμασία για αντίπαλο', en: 'Prepare for opponent' },
            desc: {
              el: 'Συνδύασε τις τοπικές σου βάσεις με δημόσια προφίλ Lichess και Chess.com σε έναν ενιαίο φάκελο με ποσοστά Λευκών/Μαύρων, γράφημα Elo και διαδραστικό δέντρο ανοιγμάτων.',
              en: 'Combine local databases with public Lichess and Chess.com accounts into one dossier with White/Black scores, Elo chart, and an interactive opening repertoire tree.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Ζωντανά τουρνουά (Watch Live) & Παίξε με φίλο', en: 'Watch Live tournaments & Play a friend' },
            desc: {
              el: 'Παρακολούθησε live παρτίδες μεγάλων τουρνουά με πραγματικά ρολόγια, άνοιξέ τες με ένα κλικ σε ανάλυση ή Κοινή Ανάλυση, ή προκάλεσε φίλο με link από οποιονδήποτε browser.',
              en: 'Follow major live tournaments with real clocks, open any game into Stockfish or Shared Analysis in one click, or challenge a friend by link in any browser.',
            },
          },
          {
            kind: 'new',
            title: { el: 'Βιβλίο σε βάση (PDF σε παρτίδες)', en: 'Book to database (PDF importer)' },
            desc: {
              el: 'Μετάτρεψε τα ψηφιακά σου σκακιστικά PDF (και βασικό OCR για σκαναρισμένες σελίδες) σε βάσεις με βαριάντες, σχόλια και λειτουργία ασκήσεων — 100% τοπικά.',
              en: 'Turn your digital chess PDF books (plus basic OCR for scanned pages) into playable databases with variations, commentary, and exercise mode — 100% locally.',
            },
          },
        ],
      },
      {
        category: 'training',
        title: { el: 'Βελτίωση, Μαθήματα & Bots', en: 'Training, Lessons & Bots' },
        items: [
          {
            kind: 'new',
            title: { el: 'Τακτική, Στρατηγική & Φινάλε', en: 'Tactics, Strategy & Endgames' },
            desc: {
              el: 'Προσαρμοστική τακτική Glicko-2 (επανάληψη, χρονομετρημένα, streak, ημερήσιο puzzle), 50 διαδραστικά μαθήματα στρατηγικής με επιλογές «Ξανά» και «Περιήγηση», και 36 μαθήματα φινάλε με drills.',
              en: 'Adaptive Glicko-2 tactics (spaced repetition, timed runs, streaks, daily puzzle), 50 interactive strategy lessons with “Again” and “Review” modes, and 36 endgame lessons & drills.',
            },
          },
          {
            kind: 'new',
            title: { el: '10 Bots & εκπαίδευση ρεπερτορίου', en: '10 Bots & opening repertoire trainer' },
            desc: {
              el: 'Παίξε με 10 ανθρώπινα bots (και προαιρετικά δίκτυα Maia) ή εξάσκησε το δικό σου ρεπερτόριο ανοιγμάτων από οποιαδήποτε βάση σου.',
              en: 'Play against 10 human-like bots (plus optional Maia networks) or drill your own opening repertoire from any of your databases.',
            },
          },
        ],
      },
      {
        category: 'app',
        title: { el: 'Εφαρμογή & Εμπειρία Χρήσης', en: 'Desktop App & Experience' },
        items: [
          {
            kind: 'improved',
            title: { el: 'Αυτόνομο παράθυρο Windows, θέματα & γλώσσες', en: 'Standalone Windows app, themes & languages' },
            desc: {
              el: 'Καθαρό desktop παράθυρο (καρτέλες ή ξεχωριστά παράθυρα), Light & Dark θέμα, Ελληνικά & Αγγλικά, επιλογή σημειογραφίας, μενού Προβολή, Οδηγός νέου χρήστη και συντομεύσεις (?).',
              en: 'Clean native desktop window (tabs or separate windows), Light & Dark themes, English & Greek UI and notation, customizable View menu, Getting Started Guide, and shortcuts menu (?).',
            },
          },
          {
            kind: 'improved',
            title: { el: 'Δωρεάν, ανοιχτού κώδικα & με σεβασμό στο απόρρητο', en: 'Free, open-source & privacy-first' },
            desc: {
              el: 'Χωρίς διαφημίσεις, συνδρομές ή τηλεμετρία. Οι βάσεις σου μένουν στον υπολογιστή σου και οι σημειώσεις εκδόσεων εμφανίζονται μία φορά μετά από κάθε αναβάθμιση.',
              en: 'No ads, subscriptions, or telemetry. Your databases stay on your computer, and Release Notes appear once automatically after each update.',
            },
          },
        ],
      },
    ],
  },
];

/** Η νεότερη έκδοση που έχει καταχωρηθεί στις σημειώσεις εκδόσεων. */
export const latestReleaseVersion = (): string => RELEASE_NOTES[0]?.version ?? '';

/** Βρίσκει την εγγραφή για συγκεκριμένη έκδοση (ή επιστρέφει τη νεότερη). */
export function findReleaseNote(version?: string | null): ReleaseNote {
  if (version) {
    const clean = version.split('-')[0];
    const hit = RELEASE_NOTES.find((r) => r.version === version || r.version === clean);
    if (hit) return hit;
  }
  return RELEASE_NOTES[0];
}

/**
 * Πότε πρέπει να ανοίξει αυτόματα (1 φορά) το παράθυρο «Τι νέο υπάρχει»:
 * - Ποτέ σε δευτερεύοντα παράθυρα (`isPopup`) ή αν απενεργοποιήθηκε (`off`).
 * - Ποτέ αν ο χρήστης έχει ήδη δει την τρέχουσα έκδοση (`seenVersion === latest`).
 * - Πάντα σε αναβάθμιση (όταν υπάρχει παλιότερο `seenVersion`).
 * - Στην πρώτη φορά χωρίς `seenVersion`: μόνο αν ο χρήστης έχει ήδη περάσει τον αρχικό Οδηγό (ώστε να μη συγκρούεται με το «Καλώς ήρθες» νέου χρήστη).
 */
export function shouldAutoShowReleaseNotes(opts: {
  appVersion: string | null | undefined;
  seenVersion: string | null | undefined;
  isPopup: boolean;
  off?: boolean;
  guideWelcomeDone: boolean;
}): boolean {
  if (opts.isPopup || opts.off) return false;
  const current = opts.appVersion?.split('-')[0]?.trim();
  const latest = latestReleaseVersion();
  if (!current || !latest) return false;
  // αν η εγκατεστημένη έκδοση έχει ήδη ιδωθεί, δεν ξανανοίγει
  if (opts.seenVersion === current || opts.seenVersion === latest) return false;
  // αναβάθμιση από παλιότερη έκδοση που είχε καταγράψει seenVersion: εμφάνιση αμέσως
  if (opts.seenVersion) return true;
  // πρώτη φορά που υπάρχει η λειτουργία: εμφάνιση μόνο αφού έχει τελειώσει/κλείσει ο αρχικός Οδηγός
  return opts.guideWelcomeDone;
}
