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
    version: '3.1.0',
    date: { el: 'Νοέμβριος 2026', en: 'November 2026' },
    headline: { el: 'Ruru Chess 3.1 — Καλύτερη Κοινή Ανάλυση, Βίντεο & Εκδόσεις', en: 'Ruru Chess 3.1 — Better Shared Analysis, Video & Patch Notes' },
    subtitle: {
      el: 'Συγχρονισμένο YouTube βίντεο στην Κοινή Ανάλυση, έξυπνη αποχώρηση & παράδοση Host, επιλογές «Ξανά» και «Περιήγηση» στα Στρατηγικά μαθήματα, νέα καρτέλα Εκδόσεις και σημαντικές διορθώσεις UI.',
      en: 'Synced YouTube video in Shared Analysis, smart Host leave & role transfer, “Again” and “Review” modes in Strategy lessons, the new Patch Notes tab, and key UI fixes.',
    },
    highlights: [
      {
        icon: 'share',
        title: { el: 'Συγχρονισμός YouTube & ελεύθερη προβολή', en: 'YouTube Sync & flexible viewing' },
        desc: {
          el: 'Προαιρετικός συγχρονισμός play/pause και λεπτού για YouTube, συν δυνατότητα να κλείσεις του host και να ανοίξεις δικό σου βίντεο.',
          en: 'Optional play/pause and timestamp sync for YouTube, plus guests can hide the room video and open their own.',
        },
      },
      {
        icon: 'share',
        title: { el: 'Αποχώρηση vs Τερματισμός Host', en: 'Host Leave vs End Session' },
        desc: {
          el: 'Ο host διαλέγει αποχώρηση (αυτόματη μεταφορά στον παλαιότερο), χειροκίνητη παράδοση host ή τερματισμό για όλους.',
          en: 'The host can leave (auto-transferring host to the oldest member), hand off host manually, or end the session for everyone.',
        },
      },
      {
        icon: 'training',
        title: { el: 'Στρατηγικά: «Ξανά» & «Περιήγηση»', en: 'Strategy: “Again” & “Review”' },
        desc: {
          el: 'Ξαναπαίξε ένα μάθημα από την αρχή με όλες τις ασκήσεις ή άνοιξέ το σε ελεύθερη περιήγηση μόλις τις ολοκληρώσεις.',
          en: 'Replay a lesson from move 1 with all exercises fresh, or browse it freely in Review mode once all exercises are completed.',
        },
      },
      {
        icon: 'app',
        title: { el: 'Καρτέλα Εκδόσεις (Patch Notes)', en: 'Patch Notes Tab' },
        desc: {
          el: 'Δες καθαρά τι νέο υπάρχει σε κάθε έκδοση στα Ελληνικά & Αγγλικά — ανοίγει αυτόματα 1 φορά μετά από αναβάθμιση.',
          en: 'See every update clearly in English & Greek — opens automatically once after updating.',
        },
      },
    ],
    sections: [
      {
        category: 'share',
        title: { el: 'Κοινή Ανάλυση & Βίντεο', en: 'Shared Analysis & Video' },
        items: [
          {
            kind: 'new',
            title: { el: 'Συγχρονισμός YouTube (play/pause & λεπτό)', en: 'YouTube sync (play/pause & timestamp)' },
            desc: {
              el: 'Στα κοινά YouTube βίντεο το κουμπί «Συγχρονισμός / Sync» κρατά όλους στο ίδιο σημείο — και όποιος θέλει να πάει μόνος του το απενεργοποιεί με ένα κλικ.',
              en: 'A “Sync” toggle on shared YouTube videos keeps everyone on the same second — turn it off anytime to pause or scrub on your own.',
            },
          },
          {
            kind: 'new',
            title: { el: '2 επιλογές αποχώρησης Host & χειροκίνητη παράδοση', en: 'Host leave options & manual transfer' },
            desc: {
              el: 'Όταν φεύγει ο host επιλέγει «Αποχώρηση» (μεταφορά host στον παλαιότερο συμμετέχοντα) ή «Τερματισμός για όλους» (κλείνει το δωμάτιο και επιστρέφει όλους στην αρχή). Προστέθηκε και «Κάνε host» στο μενού (⋮) κάθε μέλους.',
              en: 'When leaving, the host chooses “Leave session” (auto-transferring host to the oldest member) or “End session for everyone” (closes the room and returns everyone to the start screen). Also adds “Make host” in each member’s menu (⋮).',
            },
          },
          {
            kind: 'fix',
            title: { el: 'Κουμπί «Προβολή» & δικό σου βίντεο για καλεσμένους', en: 'Visible “Watch” button & guest local video' },
            desc: {
              el: 'Διορθώθηκε το λευκό-σε-λευκό κουμπί «Προβολή / Watch» και πλέον όταν ένας καλεσμένος κλείσει (×) το κοινό βίντεο μπορεί να ανοίξει δικό του τοπικό βίντεο ή να επαναφέρει το κοινό.',
              en: 'Fixed the white-on-white “Watch” button, and guests who close (×) the room video can now open their own local video or restore the room video.',
            },
          },
        ],
      },
      {
        category: 'training',
        title: { el: 'Στρατηγικά Μαθήματα', en: 'Strategy Lessons' },
        items: [
          {
            kind: 'new',
            title: { el: 'Ξεχωριστά κουμπιά «Ξανά» και «Περιήγηση»', en: 'Separate “Again” and “Review” buttons' },
            desc: {
              el: 'Το «Ξανά / Again» ξεκινά την παρτίδα από την αρχή με όλες τις ασκήσεις ξανά σαν να μην την έκανες ποτέ, ενώ το «Περιήγηση / Review» εμφανίζεται δίπλα μόλις ολοκληρώσεις όλες τις ασκήσεις για ελεύθερη μελέτη.',
              en: '“Again” restarts the game from the beginning with all exercises fresh, while “Review” appears beside it once all exercises have been completed for free browsing.',
            },
          },
        ],
      },
      {
        category: 'social',
        title: { el: 'Φίλοι & Αποστολή PGN', en: 'Friends & PGN Sharing' },
        items: [
          {
            kind: 'fix',
            title: { el: 'Αυτόματο καθάρισμα ειδοποίησης αιτήματος φιλίας', en: 'Friend request notice auto-cleanup' },
            desc: {
              el: 'Το πράσινο μήνυμα «Στάλθηκε αίτημα φιλίας…» σβήνει πλέον αυτόματα μόλις γίνει αποδοχή/απόρριψη ή μετά από λίγα δευτερόλεπτα αντί να μένει κολλημένο.',
              en: 'The green “Friend request sent…” notice now clears automatically on accept/decline or after a few seconds instead of staying stuck.',
            },
          },
          {
            kind: 'fix',
            title: { el: 'Καθαρά checkboxes στην αποστολή βάσεων PGN', en: 'Crisp checkboxes in PGN send dialog' },
            desc: {
              el: 'Διορθώθηκε το μικροσκοπικό checkbox πνευματικών δικαιωμάτων στο παράθυρο αποστολής PGN σε φίλο ή ομάδα — πλέον είναι ευδιάκριτο, με σωστό μέγεθος και hover/checked πλαίσιο.',
              en: 'Fixed the tiny copyright checkbox in the Send PGN dialog so both checkboxes are crisp, properly sized, and clearly clickable.',
            },
          },
        ],
      },
      {
        category: 'app',
        title: { el: 'Εφαρμογή & Διεπαφή', en: 'App & Interface' },
        items: [
          {
            kind: 'new',
            title: { el: 'Νέα καρτέλα «Εκδόσεις / Patch Notes»', en: 'New “Patch Notes” tab' },
            desc: {
              el: 'Παρουσιάζει καθαρά όλες τις αλλαγές ανά έκδοση στα Ελληνικά & Αγγλικά, με κουκκίδα ειδοποίησης και αυτόματο άνοιγμα 1 φορά μετά από αναβάθμιση.',
              en: 'Shows every release’s changes clearly in English & Greek, with an unread dot and one-time auto-open after updating.',
            },
          },
          {
            kind: 'fix',
            title: { el: 'Καλύτερη προσαρμογή της γραμμής εργαλείων σκακιέρας', en: 'Improved board toolbar responsiveness' },
            desc: {
              el: 'Διορθώθηκε το κόψιμο του κουμπιού «Περισσότερα» στα Ελληνικά σε οθόνες 1920×1080.',
              en: 'Fixed right-edge clipping of the “More” toolbar button on Greek 1920×1080 screens.',
            },
          },
        ],
      },
    ],
  },
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
              el: 'Άνοιξε βίντεο ή live μετάδοση δίπλα στη σκακιέρα σε απλές παρτίδες ή στην Κοινή Ανάλυση («Για όλους» ή «Μόνο για μένα»).',
              en: 'Watch broadcasts or lessons right next to the board in solo games or Shared Analysis (“For everyone” or “Only for me”).',
            },
          },
          {
            kind: 'new',
            title: { el: 'Σύνδεση Ζωντανών (Watch Live) ↔ Κοινή Ανάλυση', en: 'Watch Live ↔ Shared Analysis' },
            desc: {
              el: 'Διάλεξε οποιαδήποτε live παρτίδα τουρνουά και άνοιξέ την κατευθείαν σε Κοινή Ανάλυση με συγχρονισμένα ζωντανά ρολόγια.',
              en: 'Pick any live tournament game and open it directly in Shared Analysis with synchronized live clocks.',
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
              el: 'Προσαρμοστική τακτική Glicko-2 (επανάληψη, χρονομετρημένα, streak, ημερήσιο puzzle), 50 διαδραστικά μαθήματα στρατηγικής και 36 μαθήματα φινάλε με drills.',
              en: 'Adaptive Glicko-2 tactics (spaced repetition, timed runs, streaks, daily puzzle), 50 interactive strategy lessons, and 36 endgame lessons & drills.',
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
              el: 'Χωρίς διαφημίσεις, συνδρομές ή τηλεμετρία. Οι βάσεις σου μένουν τοπικά στον υπολογιστή σου.',
              en: 'No ads, subscriptions, or telemetry. Your databases stay locally on your computer.',
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
