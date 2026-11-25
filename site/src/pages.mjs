// Στοχευμένες SEO σελίδες (EN στη ρίζα /<slug>/, και EL στο /el/<slug>/ όσες έχουν el).
// Κάθε σελίδα χρησιμοποιεί το ίδιο εικαστικό της αρχικής (renderLanding στο page.mjs)
// και μπαίνει αυτόματα σε sitemap.xml, llms.txt και footer.
export default [
  {
    slug: 'live-chess-analysis',
    img: 'share',
    homeSection: 'study',
    en: {
      navLabel: 'Shared Live Chess Analysis',
      title: 'Free Shared Live Chess Analysis with Voice, Camera & Video | Ruru Chess',
      description:
        'Analyze chess games live with friends, students, or study teams for free. Real-time shared board where everyone can move pieces, plus Stockfish engine, arrows, encrypted WebRTC voice & camera, and embedded YouTube/Twitch/Kick video.',
      keywords:
        'shared live chess analysis, analyze chess together online, chess coaching board voice video, collaborative chess board free, play.ruruchess.com',
      eyebrow: 'Live Study & Coaching · play.ruruchess.com',
      h1: 'Analyze chess live together — with voice, camera &amp; video.',
      lead: 'Send a single link on <strong>play.ruruchess.com</strong>: your friend or student joins straight in their browser with no account, or inside Ruru Chess. Everyone can move pieces and explore variations together on a crisp synced board — with Stockfish lines, encrypted WebRTC voice/camera, and embedded YouTube, Twitch, or Kick streams.',
      cta: 'Download Ruru Chess Free',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 · Friends join free in browser',
      imgAlt: 'Ruru Chess Shared Live Analysis showing Kasparov vs Topalov with Stockfish, embedded video panel, voice controls, and room chat',
      stepsEyebrow: 'Study together in seconds',
      stepsTitle: 'Host a live chess analysis session in 4 steps',
      steps: [
        [
          'Open any game or live broadcast',
          'Start from a database game, a tournament game you just finished, a blank board, or any live tournament broadcast in Watch Live.',
        ],
        [
          'Create a Shared Analysis room',
          'Click Shared Analysis in Ruru Chess to get a private room link on play.ruruchess.com — or invite friends and study teams in one click.',
        ],
        [
          'Friends join in browser or in Ruru',
          'Guests click your link and join immediately in any browser with zero account setup, or open it directly inside their Ruru Chess desktop app.',
        ],
        [
          'Move pieces together with voice & video',
          'Everyone can test variations and draw arrows live, see host Stockfish lines, talk over encrypted WebRTC voice/camera, and watch YouTube/Twitch/Kick side by side.',
        ],
      ],
      featuresEyebrow: 'Built for coaches, clubs & friends',
      featuresTitle: 'No more juggling Discord, screen share & static boards',
      featuresLead:
        'Everything needed for a live chess lesson, post-mortem, or tournament watch party works smoothly in one clean workspace.',
      cards: [
        {
          tag: 'Interactive Synced Board',
          title: 'Everyone moves pieces & explores lines live',
          text: 'Students and friends do not just watch a blurry screen share. Guests click your link in any browser (no account needed) and interact directly on a crisp, real-time chessboard.',
        },
        {
          tag: 'Encrypted Voice & Camera',
          title: 'Built-in WebRTC audio & video with TURN',
          text: 'Talk naturally while analyzing with end-to-end encrypted WebRTC voice and camera backed by Cloudflare TURN for reliable connections behind strict firewalls.',
        },
        {
          tag: 'Watch Together',
          title: 'Embedded YouTube, Twitch & Kick video',
          text: 'Open a live tournament stream or chess lecture right inside Ruru Chess — choose “For everyone” to watch with Ruru participants or “Only for me”.',
        },
        {
          tag: 'Friends & Study Teams',
          title: 'Permanent teams & one-click PGN sharing',
          text: 'Create an optional account (no email or password, 16+) for a permanent friends list, study teams with roles, live presence, direct PGN file import in chat, and one-click team invites.',
        },
      ],
      compareEyebrow: 'Better than screen sharing',
      compareTitle: 'Screen sharing a chess app vs. Ruru Shared Analysis',
      compareCols: ['Feature', 'Zoom / Discord screen share', 'Ruru Shared Analysis'],
      compareRows: [
        ['Everyone can move pieces & suggest lines', 'Only the host controls the board', 'Real-time synced board, variations & arrows'],
        ['Board & notation sharpness', 'Blurry video compression', 'Native crisp board for every participant'],
        ['Voice & camera included', 'Separate app required', 'Built-in encrypted WebRTC voice & camera'],
        ['Share host Stockfish lines', 'Only as video pixels', 'Live shared engine lines & evaluation'],
        ['Save the analyzed game directly to DB', 'Manual export & send later', 'Save straight into your local database / PGN'],
      ],
      faqEyebrow: 'Questions & Answers',
      faqTitle: 'Shared live chess analysis FAQ',
      faq: [
        [
          'Do my friends or students need to install Ruru Chess to join?',
          'No. Anyone with your play.ruruchess.com room link can join directly in their web browser with no download and no account required.',
        ],
        [
          'Can guests move pieces and try variations too?',
          'Yes. Participants share the live board in real time, so coaches, students, and friends can test moves, branches, and colored arrows together.',
        ],
        [
          'Is Shared Live Analysis free for coaches and study groups?',
          'Yes. Hosting rooms, sharing Stockfish lines, and using encrypted voice/camera is free with no time limits or paywalls.',
        ],
        [
          'Can we analyze live tournament broadcasts together?',
          'Yes. Open Watch Live in Ruru Chess, pick any live tournament game, and turn it into a Shared Analysis room in one click — even with an embedded stream alongside.',
        ],
        [
          'Is the voice and camera call encrypted?',
          'Yes. Voice and camera streams use encrypted WebRTC connections, with Cloudflare TURN fallback when direct peer-to-peer connections are blocked by a network.',
        ],
      ],
      ctaTitle: 'Host your next chess lesson or study session in one click.',
      ctaLead: 'Free, open-source Windows app with live synced analysis, encrypted voice, and browser guest access.',
    },
    el: {
      navLabel: 'Κοινή Ζωντανή Ανάλυση',
      title: 'Δωρεάν Κοινή Ζωντανή Ανάλυση Σκακιού με Φωνή, Κάμερα & Βίντεο | Ruru Chess',
      description:
        'Ανάλυσε παρτίδες σκακιού ζωντανά με φίλους, μαθητές ή ομάδες μελέτης δωρεάν. Συγχρονισμένη σκακιέρα όπου όλοι κινούν κομμάτια, Stockfish, κρυπτογραφημένη φωνή & κάμερα WebRTC και ενσωματωμένο YouTube/Twitch/Kick.',
      keywords:
        'κοινή ανάλυση σκακιού online, ζωντανή ανάλυση σκακιού, μάθημα σκακιού online σκακιέρα φωνή, κοινή σκακιέρα δωρεάν, play.ruruchess.com',
      eyebrow: 'Ζωντανή Μελέτη & Προπόνηση · play.ruruchess.com',
      h1: 'Αναλύστε σκάκι ζωντανά μαζί — με φωνή, κάμερα &amp; βίντεο.',
      lead: 'Στείλε ένα link στο <strong>play.ruruchess.com</strong>: ο φίλος ή ο μαθητής σου μπαίνει κατευθείαν από τον browser χωρίς λογαριασμό, ή μέσα από το Ruru Chess. Όλοι μπορούν να κινούν κομμάτια και να δοκιμάζουν βαριάντες ζωντανά σε πεντακάθαρη σκακιέρα — με γραμμές Stockfish, κρυπτογραφημένη φωνή/κάμερα WebRTC και ενσωματωμένο YouTube, Twitch ή Kick.',
      cta: 'Κατέβασε το Ruru Chess Δωρεάν',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 · Οι φίλοι μπαίνουν δωρεάν από browser',
      imgAlt: 'Κοινή ζωντανή ανάλυση στο Ruru Chess με Stockfish, ενσωματωμένο βίντεο, φωνή, κάμερα και chat',
      stepsEyebrow: 'Μελέτη μαζί σε δευτερόλεπτα',
      stepsTitle: 'Άνοιξε δωμάτιο κοινής ανάλυσης σε 4 βήματα',
      steps: [
        [
          'Άνοιξε παρτίδα ή ζωντανή μετάδοση',
          'Ξεκίνα από παρτίδα βάσης, από παρτίδα που μόλις έπαιξες, από άδεια σκακιέρα ή από οποιοδήποτε ζωντανό τουρνουά στο «Ζωντανά».',
        ],
        [
          'Φτιάξε δωμάτιο Κοινής Ανάλυσης',
          'Πάτα «Κοινή ανάλυση» στο Ruru Chess για να πάρεις ιδιωτικό link στο play.ruruchess.com — ή κάλεσε φίλους και ομάδες με ένα κλικ.',
        ],
        [
          'Οι φίλοι μπαίνουν από browser ή Ruru',
          'Όποιος πάρει το link μπαίνει αμέσως από οποιονδήποτε browser χωρίς εγγραφή, ή το ανοίγει απευθείας στην εφαρμογή Ruru Chess.',
        ],
        [
          'Κινείτε κομμάτια μαζί με φωνή & βίντεο',
          'Δοκιμάστε βαριάντες και βέλη όλοι μαζί, μοιραστείτε τη μηχανή Stockfish, μιλήστε με κρυπτογραφημένη φωνή/κάμερα και δείτε YouTube/Twitch/Kick δίπλα στη σκακιέρα.',
        ],
      ],
      featuresEyebrow: 'Για προπονητές, συλλόγους & φίλους',
      featuresTitle: 'Τέλος το μπέρδεμα με Discord, screen share & θολές σκακιέρες',
      featuresLead:
        'Όλα όσα χρειάζεσαι για ένα μάθημα σκακιού, ανάλυση μετά την παρτίδα ή παρακολούθηση τουρνουά με παρέα σε ένα καθαρό περιβάλλον.',
      cards: [
        {
          tag: 'Διαδραστική Σκακιέρα',
          title: 'Όλοι κινούν κομμάτια & δοκιμάζουν ιδέες live',
          text: 'Οι φίλοι και οι μαθητές δεν βλέπουν απλώς ένα θολό screen share. Μπαίνουν με ένα link από τον browser (χωρίς λογαριασμό) και κινούν κομμάτια σε πραγματικό χρόνο.',
        },
        {
          tag: 'Κρυπτογραφημένη Φωνή & Κάμερα',
          title: 'Ενσωματωμένο WebRTC audio/video με TURN',
          text: 'Μιλάτε φυσικά ενώ αναλύετε, με κρυπτογραφημένη φωνή και κάμερα WebRTC και Cloudflare TURN για σταθερή σύνδεση ακόμα και πίσω από αυστηρά δίκτυα.',
        },
        {
          tag: 'Παρακολούθηση Μαζί',
          title: 'Ενσωματωμένο YouTube, Twitch & Kick',
          text: 'Άνοιξε ζωντανή μετάδοση τουρνουά ή σκακιστικό βίντεο μέσα στο Ruru Chess — διάλεξε «Για όλους» για τους χρήστες Ruru ή «Μόνο για μένα».',
        },
        {
          tag: 'Φίλοι & Ομάδες Μελέτης',
          title: 'Μόνιμες ομάδες & άμεση ανταλλαγή PGN',
          text: 'Με προαιρετικό λογαριασμό (χωρίς email ή κωδικό, 16+) έχεις λίστα φίλων, ομάδες μελέτης με ρόλους, εισαγωγή αρχείων PGN με ένα κλικ στο chat και άμεσες προσκλήσεις.',
        },
      ],
      compareEyebrow: 'Καλύτερο από screen share',
      compareTitle: 'Κοινή χρήση οθόνης vs. Κοινή Ανάλυση Ruru',
      compareCols: ['Δυνατότητα', 'Zoom / Discord screen share', 'Κοινή Ανάλυση Ruru'],
      compareRows: [
        ['Όλοι κινούν κομμάτια & προτείνουν βαριάντες', 'Μόνο ένας ελέγχει τη σκακιέρα', 'Συγχρονισμένη σκακιέρα, βαριάντες & βέλη σε πραγματικό χρόνο'],
        ['Καθαρότητα σκακιέρας & σημειογραφίας', 'Θολή συμπίεση βίντεο', 'Πεντακάθαρη σκακιέρα σε κάθε συσκευή'],
        ['Φωνή & κάμερα μαζί', 'Χρειάζεται ξεχωριστή εφαρμογή', 'Ενσωματωμένη κρυπτογραφημένη φωνή & κάμερα WebRTC'],
        ['Κοινή μηχανή Stockfish', 'Μόνο ως εικόνα οθόνης', 'Ζωντανές γραμμές μηχανής & αξιολόγηση'],
        ['Αποθήκευση της ανάλυσης σε βάση', 'Χειροκίνητη αποστολή μετά', 'Άμεση αποθήκευση στην τοπική σου βάση / PGN'],
      ],
      faqEyebrow: 'Συχνές Ερωτήσεις',
      faqTitle: 'Απορίες για την κοινή ζωντανή ανάλυση',
      faq: [
        [
          'Χρειάζεται να κατεβάσουν το Ruru Chess οι φίλοι ή οι μαθητές μου;',
          'Όχι. Όποιος έχει το link του δωματίου στο play.ruruchess.com μπαίνει απευθείας από τον browser του, χωρίς εγκατάσταση και χωρίς λογαριασμό.',
        ],
        [
          'Μπορούν και οι καλεσμένοι να κινούν κομμάτια και βαριάντες;',
          'Ναι. Όλοι μοιράζονται τη σκακιέρα σε πραγματικό χρόνο, ώστε προπονητές, μαθητές και φίλοι να δοκιμάζουν κινήσεις, βαριάντες και χρωματιστά βέλη μαζί.',
        ],
        [
          'Είναι δωρεάν η κοινή ζωντανή ανάλυση για προπονητές και ομάδες;',
          'Ναι. Η δημιουργία δωματίων, η κοινή μηχανή Stockfish και η κρυπτογραφημένη φωνή/κάμερα είναι δωρεάν χωρίς χρονικό όριο.',
        ],
        [
          'Μπορούμε να αναλύσουμε ζωντανές παρτίδες τουρνουά μαζί;',
          'Ναι. Από το «Ζωντανά» του Ruru Chess επιλέγεις οποιαδήποτε παρτίδα μεγάλου τουρνουά και τη μετατρέπεις σε δωμάτιο Κοινής Ανάλυσης με ένα κλικ.',
        ],
        [
          'Είναι κρυπτογραφημένη η φωνή και η κάμερα;',
          'Ναι. Ο ήχος και το βίντεο μεταδίδονται με κρυπτογραφημένο WebRTC και υποστήριξη Cloudflare TURN όταν ένα δίκτυο μπλοκάρει απευθείας συνδέσεις.',
        ],
      ],
      ctaTitle: 'Ξεκίνα το επόμενο μάθημα ή κοινή ανάλυση με ένα κλικ.',
      ctaLead: 'Δωρεάν, ανοιχτού κώδικα εφαρμογή Windows με συγχρονισμένη σκακιέρα, κρυπτογραφημένη φωνή και είσοδο φίλων από browser.',
    },
  },

  {
    slug: 'free-chess-database-windows',
    img: 'analysis',
    homeSection: 'analysis',
    en: {
      navLabel: 'Free Chess Database (Windows)',
      title: 'Free Open-Source Chess Database Software for Windows | Ruru Chess',
      description:
        'A fast, free, open-source desktop chess database for Windows 10 & 11. Handle millions of games locally in SQLite, open .pgn, .cbh, .cbv & .si4 files, search positions, and train repertoires offline.',
      keywords:
        'free chess database, free chess database software Windows, open source chess database, local chess database PC, PGN database manager Windows, Ruru Chess',
      eyebrow: 'Free & Open-Source Desktop Database · Windows 10 & 11',
      h1: 'A fast, free chess database built for Windows.',
      lead: '<strong>Ruru Chess</strong> gives tournament players, coaches, and club players a modern local chess database with no subscriptions, no ads, and no cloud lock-in. Index millions of games on your PC, open <code>.pgn</code>, <code>.cbh</code>, <code>.cbv</code>, and <code>.si4</code> files, search by exact position or maneuver, and build your opening repertoire offline.',
      cta: 'Download Ruru Chess Free',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · GPL / AGPL',
      imgAlt: 'Ruru Chess desktop workspace analyzing Kasparov vs Topalov 1999 with multi-PV lines, board arrows, and figurine notation',
      stepsEyebrow: 'Get started in minutes',
      stepsTitle: 'Set up your local chess library in 4 steps',
      steps: [
        [
          'Install on Windows 10 or 11',
          'Download the 64-bit installer or portable ZIP. Runs as a standalone desktop app — no account, no license key, and no telemetry.',
        ],
        [
          'Import or open your game collections',
          'Open .pgn, .cbh, .cbv, and .si4 databases directly — even inside .7z or .zip archives — without modifying your original files.',
        ],
        [
          'Set a reference database',
          'Point Ruru to any large collection (such as Lumbra’s Gigabase) for instant opening move statistics, Elo performance, and novelty detection.',
        ],
        [
          'Search, annotate & train repertoires',
          'Filter millions of games by player, Elo, ECO, position, or material balance, annotate games cleanly, and drill your repertoire with spaced repetition.',
        ],
      ],
      featuresEyebrow: 'Built for big databases',
      featuresTitle: 'Local desktop speed with zero subscriptions',
      featuresLead:
        'Your games stay on your own computer in fast SQLite indexes, ready whenever you are — even completely offline at a tournament.',
      cards: [
        {
          tag: 'Multi-Format Support',
          title: 'Reads .pgn, .cbh, .cbv & .si4 natively',
          text: 'Open your existing game collections without converting everything first. Clean up duplicates, unify player name spellings, and export standard PGN anytime.',
        },
        {
          tag: 'Deep Search Engine',
          title: 'Position, material & maneuver search',
          text: 'Filter millions of games by player, Elo, ECO, year, exact board position, material balance, or specific piece maneuvers in seconds.',
        },
        {
          tag: 'Opening Reference & Repertoire',
          title: 'Move trees, novelties & Polyglot export',
          text: 'Inspect win/draw/loss scores and performance ratings per move, detect novelties automatically, practice your lines with spaced repetition, and export to PGN or Polyglot (.bin).',
        },
        {
          tag: 'Complete Study Suite',
          title: 'Engines, opponent prep, live rooms & tactics',
          text: 'Includes Stockfish/Lc0/Maia analysis, opponent prep dossiers, shared live study rooms, tournament crosstables, printable scoresheets, and millions of offline puzzles.',
        },
      ],
      compareEyebrow: 'Why local & open source',
      compareTitle: 'Cloud-only chess sites vs. Ruru Chess on Windows',
      compareCols: ['Feature', 'Cloud-only chess sites', 'Ruru Chess (Free)'],
      compareRows: [
        ['Millions of games offline on your PC', 'Requires internet & storage limits', 'Fast local SQLite indexes, 100% offline'],
        ['Opens .pgn, .cbh, .cbv & .si4 files', 'Usually PGN only with size caps', 'Opens all four formats, even inside .7z/.zip'],
        ['Deep position & material search', 'Often limited or paywalled', 'Full local search + duplicate cleanup'],
        ['Price & ownership', 'Recurring subscriptions', 'Free forever (GPL / AGPL open source)'],
        ['Privacy & telemetry', 'Accounts & tracking', 'Zero ads, zero cookies, zero telemetry'],
      ],
      faqEyebrow: 'Questions & Answers',
      faqTitle: 'Free chess database FAQ',
      faq: [
        [
          'Can Ruru Chess handle databases with millions of games?',
          'Yes. Ruru Chess indexes games locally in SQLite directly on your Windows PC so position search, opening reference, and player filters stay fast on huge collections.',
        ],
        [
          'Does Ruru Chess come with a game database bundled?',
          'No game database is bundled with the installer so it stays small and clean. You can open any database you already own or free non-commercial collections such as Lumbra’s Gigabase from its official site.',
        ],
        [
          'Which chess file formats does Ruru Chess open?',
          'Ruru Chess opens .pgn, .cbh, .cbv, and .si4 files — including inside .7z and .zip archives — without altering your original files.',
        ],
        [
          'Is there any paid pro version or game limit?',
          'No. Ruru Chess is 100% free and open source (GPL / AGPL) with no game limits and no paid tiers.',
        ],
      ],
      ctaTitle: 'Organize your entire chess library locally — for free.',
      ctaLead: 'Fast, open-source Windows chess database with zero subscriptions, zero ads, and full offline support.',
    },
    el: {
      navLabel: 'Δωρεάν Βάση Σκακιού (Windows)',
      title: 'Δωρεάν Πρόγραμμα Βάσης Σκακιού για Windows (Ανοιχτός Κώδικας) | Ruru Chess',
      description:
        'Γρήγορη, δωρεάν και ανοιχτού κώδικα βάση δεδομένων σκακιού για Windows 10 & 11. Διαχείριση εκατομμυρίων παρτίδων τοπικά, άνοιγμα .pgn, .cbh, .cbv & .si4, αναζήτηση θέσεων και ρεπερτόριο offline.',
      keywords:
        'δωρεάν βάση σκακιού, πρόγραμμα βάσης σκακιού Windows, βάση παρτίδων σκακιού δωρεάν, διαχείριση PGN Windows, Ruru Chess',
      eyebrow: 'Δωρεάν Βάση Σκακιού · Windows 10 & 11',
      h1: 'Μια γρήγορη, δωρεάν βάση σκακιού για Windows.',
      lead: 'Το <strong>Ruru Chess</strong> δίνει σε παίκτες τουρνουά, προπονητές και φίλους του σκακιού μια σύγχρονη τοπική βάση παρτίδων χωρίς συνδρομές, διαφημίσεις ή υποχρεωτικό cloud. Διαχειρίσου εκατομμύρια παρτίδες στον υπολογιστή σου, άνοιξε αρχεία <code>.pgn</code>, <code>.cbh</code>, <code>.cbv</code> και <code>.si4</code>, ψάξε θέσεις ή μανούβρες και χτίσε το ρεπερτόριό σου offline.',
      cta: 'Κατέβασε το Ruru Chess Δωρεάν',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · GPL / AGPL',
      imgAlt: 'Το Ruru Chess σε ανάλυση παρτίδας Kasparov εναντίον Topalov 1999 με γραμμές μηχανής, βέλη και σημειογραφία',
      stepsEyebrow: 'Ξεκίνα σε λίγα λεπτά',
      stepsTitle: 'Οργάνωσε τη σκακιστική σου βιβλιοθήκη σε 4 βήματα',
      steps: [
        [
          'Εγκατάσταση σε Windows 10 ή 11',
          'Κατέβασε τον εγκαταστάτη 64-bit ή το φορητό ZIP. Τρέχει ως αυτόνομη εφαρμογή — χωρίς λογαριασμό, κλειδιά άδειας ή τηλεμετρία.',
        ],
        [
          'Άνοιξε τις υπάρχουσες βάσεις σου',
          'Άνοιξε αρχεία .pgn, .cbh, .cbv και .si4 απευθείας — ακόμα και μέσα από .7z ή .zip — χωρίς να πειραχτούν τα αρχικά σου αρχεία.',
        ],
        [
          'Όρισε βάση αναφοράς ανοιγμάτων',
          'Σύνδεσε οποιαδήποτε μεγάλη βάση (π.χ. τη Lumbra’s Gigabase) για άμεσα στατιστικά ανοιγμάτων, επίδοση Elo και εντοπισμό καινοτομίας.',
        ],
        [
          'Αναζήτηση, σχολιασμός & ρεπερτόριο',
          'Φιλτράρισε εκατομμύρια παρτίδες κατά παίκτη, Elo, ECO, θέση ή υλικό, σχολίασε καθαρά και εξασκήσου στο ρεπερτόριό σου με επανάληψη σε διαστήματα.',
        ],
      ],
      featuresEyebrow: 'Για μεγάλες βάσεις',
      featuresTitle: 'Ταχύτητα τοπικού υπολογιστή χωρίς συνδρομές',
      featuresLead:
        'Οι παρτίδες σου μένουν στον δικό σου δίσκο με γρήγορα ευρετήρια SQLite, έτοιμες ανά πάσα στιγμή — ακόμα και χωρίς ίντερνετ σε τουρνουά.',
      cards: [
        {
          tag: 'Πολλαπλές Μορφές',
          title: 'Διαβάζει .pgn, .cbh, .cbv & .si4 απευθείας',
          text: 'Άνοιξε τις συλλογές σου χωρίς προηγούμενη μετατροπή. Καθάρισε διπλότυπες παρτίδες, ενοποίησε ορθογραφίες ονομάτων και κάνε εξαγωγή σε στάνταρ PGN.',
        },
        {
          tag: 'Βαθιά Αναζήτηση',
          title: 'Αναζήτηση θέσης, υλικού & μανούβρας',
          text: 'Φιλτράρισε εκατομμύρια παρτίδες κατά παίκτη, Elo, ECO, έτος, ακριβή θέση στη σκακιέρα, ισορροπία υλικού ή συγκεκριμένες μανούβρες κομματιών.',
        },
        {
          tag: 'Θεωρία & Ρεπερτόριο',
          title: 'Δέντρα ανοιγμάτων, καινοτομίες & Polyglot',
          text: 'Δες ποσοστά νίκης/ισοπαλίας/ήττας και επίδοση ανά κίνηση, εντόπισε καινοτομίες, εξασκήσου με επανάληψη σε διαστήματα και εξήγαγε σε PGN ή Polyglot (.bin).',
        },
        {
          tag: 'Πλήρης Σουίτα Μελέτης',
          title: 'Μηχανές, προετοιμασία, live ανάλυση & τακτική',
          text: 'Περιλαμβάνει ανάλυση Stockfish/Lc0/Maia, προετοιμασία αντιπάλου, κοινή ζωντανή ανάλυση, πίνακες τουρνουά, εκτυπώσιμα φύλλα αγώνα και εκατομμύρια offline ασκήσεις.',
        },
      ],
      compareEyebrow: 'Γιατί τοπικά & open source',
      compareTitle: 'Online σκακιστικά sites vs. Ruru Chess στα Windows',
      compareCols: ['Δυνατότητα', 'Μόνο online sites', 'Ruru Chess (Δωρεάν)'],
      compareRows: [
        ['Εκατομμύρια παρτίδες offline στο PC σου', 'Θέλει ίντερνετ & όρια αποθήκευσης', 'Γρήγορα τοπικά ευρετήρια SQLite, 100% offline'],
        ['Άνοιγμα .pgn, .cbh, .cbv & .si4', 'Συνήθως μόνο μικρά PGN', 'Ανοίγει και τις 4 μορφές, ακόμα και σε .7z/.zip'],
        ['Βαθιά αναζήτηση θέσης & υλικού', 'Περιορισμένη ή επί πληρωμή', 'Πλήρης τοπική αναζήτηση + καθαρισμός διπλότυπων'],
        ['Κόστος & ιδιοκτησία', 'Μηνιαίες συνδρομές', 'Δωρεάν για πάντα (GPL / AGPL ανοιχτός κώδικας)'],
        ['Ιδιωτικότητα', 'Λογαριασμοί & tracking', 'Χωρίς διαφημίσεις, cookies ή τηλεμετρία'],
      ],
      faqEyebrow: 'Συχνές Ερωτήσεις',
      faqTitle: 'Απορίες για τη δωρεάν βάση σκακιού',
      faq: [
        [
          'Αντέχει το Ruru Chess βάσεις με εκατομμύρια παρτίδες;',
          'Ναι. Ευρετηριάζει τις παρτίδες τοπικά σε SQLite στον υπολογιστή σου, ώστε η αναζήτηση θέσεων, η αναφορά ανοιγμάτων και τα φίλτρα να μένουν γρήγορα και σε τεράστιες βάσεις.',
        ],
        [
          'Περιλαμβάνει έτοιμη βάση παρτίδων μέσα στον εγκαταστάτη;',
          'Όχι, ώστε το αρχείο λήψης να μένει μικρό και καθαρό. Μπορείς να ανοίξεις όποια βάση έχεις ήδη ή δωρεάν μη εμπορικές συλλογές όπως τη Lumbra’s Gigabase από τη σελίδα της.',
        ],
        [
          'Ποιες μορφές σκακιστικών αρχείων ανοίγει;',
          'Ανοίγει αρχεία .pgn, .cbh, .cbv και .si4 — ακόμα και μέσα από συμπιεσμένα .7z και .zip — χωρίς να αλλοιώνει τα αρχικά σου αρχεία.',
        ],
        [
          'Υπάρχει πληρωμένη έκδοση ή όριο παρτίδων;',
          'Όχι. Το Ruru Chess είναι 100% δωρεάν και ανοιχτού κώδικα (GPL / AGPL), χωρίς όρια παρτίδων και χωρίς πληρωμένα πακέτα.',
        ],
      ],
      ctaTitle: 'Οργάνωσε όλη τη σκακιστική σου βιβλιοθήκη τοπικά — δωρεάν.',
      ctaLead: 'Γρήγορη, ανοιχτού κώδικα βάση σκακιού για Windows χωρίς συνδρομές, χωρίς διαφημίσεις και 100% offline.',
    },
  },

  {
    slug: 'open-cbh-cbv-files',
    img: 'reference',
    homeSection: 'analysis',
    en: {
      navLabel: 'Open .cbh & .cbv Files Free',
      title: 'How to Open .cbh and .cbv Chess Files for Free on Windows | Ruru Chess',
      description:
        'Open .cbh and .cbv chess database files for free on Windows. Browse games, search positions, analyze with Stockfish, and export to standard PGN offline with Ruru Chess.',
      keywords:
        'open cbh file free, open cbv file free, cbh to pgn converter, cbv to pgn free, free cbh viewer Windows, read cbh files offline',
      eyebrow: 'Free .cbh & .cbv Viewer · Windows 10 & 11',
      h1: 'Open .cbh and .cbv chess files for free on Windows.',
      lead: 'Have chess databases saved in <code>.cbh</code> or <code>.cbv</code> format? <strong>Ruru Chess</strong> opens them directly on Windows — even when packed inside <code>.7z</code> or <code>.zip</code> archives — without modifying your original files, and lets you browse, analyze with Stockfish, or export to standard PGN.',
      cta: 'Download Free .cbh / .cbv Viewer',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · 100% Free',
      imgAlt: 'Ruru Chess opening reference view displaying move statistics and master games from a local chess database',
      stepsEyebrow: 'Quick guide',
      stepsTitle: 'Open any .cbh or .cbv file in 4 steps',
      steps: [
        [
          'Download & install Ruru Chess',
          'Grab the free Windows installer or portable ZIP. Runs completely offline on Windows 10 and 11 (64-bit).',
        ],
        [
          'Open your .cbh or .cbv archive',
          'Select your .cbh database or compressed .cbv bundle directly from Ruru Chess — even if it is still inside a .zip or .7z file.',
        ],
        [
          'Browse, search & analyze games',
          'Filter by player, Elo, ECO code, year, or exact board position, and inspect any game with multi-line Stockfish, Leela, or Maia.',
        ],
        [
          'Export to standard PGN anytime',
          'Need the games in another app? Export individual games or collections cleanly to standard .pgn with comments, NAG symbols, and variations intact.',
        ],
      ],
      featuresEyebrow: 'What you can do',
      featuresTitle: 'More than a read-only file viewer',
      featuresLead:
        'Ruru Chess keeps your original .cbh and .cbv files untouched while giving you full database search, engine analysis, and clean PGN export.',
      cards: [
        {
          tag: 'Non-Destructive',
          title: 'Your original files stay untouched',
          text: 'Ruru Chess reads your .cbh, .cbv, Scid .si4, and .pgn files safely without overwriting or corrupting the original archive on disk.',
        },
        {
          tag: 'Archives Supported',
          title: 'Works inside .7z & .zip files too',
          text: 'No need to unpack huge tournament archives manually first — open supported chess database formats straight from compressed archives.',
        },
        {
          tag: 'Deep Search & Stats',
          title: 'Position search & opening reference',
          text: 'Use any opened database as an opening reference to see win/draw/loss percentages, Elo performance per move, and recent high-level games.',
        },
        {
          tag: 'Standard PGN Export',
          title: 'Convert .cbh / .cbv games to clean PGN',
          text: 'Export annotated games with nested variations, text commentary, colored arrows, and highlighted squares to portable standard PGN.',
        },
      ],
      compareEyebrow: 'File format support',
      compareTitle: 'Supported chess formats in Ruru Chess',
      compareCols: ['Format', 'Typical source', 'Support in Ruru Chess'],
      compareRows: [
        ['.cbh (multi-file database)', 'Legacy desktop chess collections', 'Direct read, search, analyze & export to PGN'],
        ['.cbv (compressed archive)', 'Single-file database bundles', 'Direct import without needing separate unpackers'],
        ['.si4 (Scid database)', 'Scid / Scid vs. PC collections', 'Native read, search & reference support'],
        ['.pgn (Portable Game Notation)', 'Lichess, Chess.com, TWIC, tournaments', 'Full read, edit, annotate & fast SQLite indexing'],
        ['.7z & .zip archives', 'Downloaded tournament packs', 'Opens supported chess databases inside archives'],
      ],
      faqEyebrow: 'Questions & Answers',
      faqTitle: 'Opening .cbh & .cbv files FAQ',
      faq: [
        [
          'What is the difference between .cbh and .cbv files?',
          'A .cbh file is the header file of a multi-file database folder, while a .cbv file is a single compressed archive bundling those database files together. Ruru Chess opens both.',
        ],
        [
          'Can I convert .cbh or .cbv files to PGN for free?',
          'Yes. Open your .cbh or .cbv database in Ruru Chess and export the games you need to standard .pgn format at no cost and with no game limits.',
        ],
        [
          'Will Ruru Chess modify my original .cbh files?',
          'No. Ruru Chess reads your original .cbh, .cbv, and .si4 files without altering them.',
        ],
        [
          'Are my databases uploaded anywhere to be converted?',
          'Never. Everything happens locally on your Windows PC — zero file uploads, zero cloud limits, and 100% offline.',
        ],
      ],
      ctaTitle: 'Open your .cbh and .cbv collections in seconds.',
      ctaLead: 'Free, open-source Windows app with fast local indexing, Stockfish analysis, and clean PGN export.',
    },
    el: {
      navLabel: 'Άνοιγμα αρχείων .cbh & .cbv',
      title: 'Πώς να ανοίξεις αρχεία σκακιού .cbh και .cbv δωρεάν στα Windows | Ruru Chess',
      description:
        'Άνοιξε σκακιστικά αρχεία .cbh και .cbv δωρεάν στα Windows. Δες παρτίδες, ψάξε θέσεις, ανάλυσε με Stockfish και κάνε εξαγωγή σε στάνταρ PGN offline με το Ruru Chess.',
      keywords:
        'άνοιγμα αρχείου cbh δωρεάν, άνοιγμα αρχείου cbv δωρεάν, μετατροπή cbh σε pgn, μετατροπή cbv σε pgn, πρόγραμμα για αρχεία cbh Windows',
      eyebrow: 'Δωρεάν Προβολή .cbh & .cbv · Windows 10 & 11',
      h1: 'Άνοιξε αρχεία σκακιού .cbh και .cbv δωρεάν στα Windows.',
      lead: 'Έχεις σκακιστικές βάσεις αποθηκευμένες σε μορφή <code>.cbh</code> ή <code>.cbv</code>; Το <strong>Ruru Chess</strong> τις ανοίγει απευθείας στα Windows — ακόμα και μέσα από συμπιεσμένα <code>.7z</code> ή <code>.zip</code> — χωρίς να πειράξει τα αρχικά σου αρχεία, και σου επιτρέπει αναζήτηση, ανάλυση με Stockfish και εξαγωγή σε στάνταρ PGN.',
      cta: 'Κατέβασε Δωρεάν για .cbh / .cbv',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · 100% Δωρεάν',
      imgAlt: 'Καρτέλα αναφοράς ανοιγμάτων στο Ruru Chess με στατιστικά κινήσεων και παρτίδες από τοπική βάση',
      stepsEyebrow: 'Γρήγορος οδηγός',
      stepsTitle: 'Άνοιξε οποιοδήποτε .cbh ή .cbv σε 4 βήματα',
      steps: [
        [
          'Κατέβασε & εγκατέστησε το Ruru Chess',
          'Πάρε τον δωρεάν εγκαταστάτη για Windows ή το φορητό ZIP. Δουλεύει πλήρως offline σε Windows 10 και 11 (64-bit).',
        ],
        [
          'Επίλεξε το αρχείο .cbh ή .cbv',
          'Άνοιξε τη βάση .cbh ή το πακέτο .cbv κατευθείαν από το Ruru Chess — ακόμα κι αν βρίσκεται μέσα σε .zip ή .7z.',
        ],
        [
          'Περιήγηση, αναζήτηση & ανάλυση',
          'Φιλτράρισε κατά παίκτη, Elo, κωδικό ECO, έτος ή ακριβή θέση, και έλεγξε κάθε παρτίδα με Stockfish, Leela ή Maia.',
        ],
        [
          'Εξαγωγή σε στάνταρ PGN όποτε θες',
          'Θέλεις τις παρτίδες σε άλλη εφαρμογή; Κάνε εξαγωγή μεμονωμένων παρτίδων ή ολόκληρων συλλογών σε καθαρό .pgn με σχόλια, σύμβολα και βαριάντες.',
        ],
      ],
      featuresEyebrow: 'Τι μπορείς να κάνεις',
      featuresTitle: 'Πολύ περισσότερα από απλή προβολή αρχείων',
      featuresLead:
        'Το Ruru Chess αφήνει άθικτα τα αρχικά σου αρχεία .cbh και .cbv, δίνοντάς σου πλήρη αναζήτηση, μηχανές ανάλυσης και καθαρή εξαγωγή PGN.',
      cards: [
        {
          tag: 'Ασφαλής Ανάγνωση',
          title: 'Τα αρχικά σου αρχεία μένουν άθικτα',
          text: 'Διαβάζει αρχεία .cbh, .cbv, Scid .si4 και .pgn με ασφάλεια, χωρίς να γράφει πάνω στα πρωτότυπα αρχεία σου.',
        },
        {
          tag: 'Συμπιεσμένα Πακέτα',
          title: 'Δουλεύει και μέσα από .7z & .zip',
          text: 'Δεν χρειάζεται να αποσυμπιέζεις πρώτα μεγάλα πακέτα τουρνουά — άνοιξε τις υποστηριζόμενες βάσεις κατευθείαν από το αρχείο.',
        },
        {
          tag: 'Αναζήτηση & Στατιστικά',
          title: 'Αναζήτηση θέσης & αναφορά ανοιγμάτων',
          text: 'Χρησιμοποίησε οποιαδήποτε βάση ως αναφορά ανοιγμάτων για να βλέπεις ποσοστά αποτελεσμάτων, Elo επίδοσης και πρόσφατες παρτίδες.',
        },
        {
          tag: 'Εξαγωγή σε PGN',
          title: 'Μετατροπή .cbh / .cbv σε καθαρό PGN',
          text: 'Εξήγαγε σχολιασμένες παρτίδες με βαριάντες, σχόλια κειμένου, βέλη και χρωματιστά τετράγωνα σε φορητό στάνταρ PGN.',
        },
      ],
      compareEyebrow: 'Υποστηριζόμενες μορφές',
      compareTitle: 'Τύποι σκακιστικών αρχείων στο Ruru Chess',
      compareCols: ['Μορφή', 'Συνήθης προέλευση', 'Υποστήριξη στο Ruru Chess'],
      compareRows: [
        ['.cbh (βάση πολλών αρχείων)', 'Κλασικές desktop συλλογές σκακιού', 'Ανάγνωση, αναζήτηση, ανάλυση & εξαγωγή PGN'],
        ['.cbv (συμπιεσμένο πακέτο)', 'Μοναδικό αρχείο πακέτου βάσης', 'Άμεση εισαγωγή χωρίς ξεχωριστό πρόγραμμα'],
        ['.si4 (βάση Scid)', 'Συλλογές Scid / Scid vs. PC', 'Εγγενής ανάγνωση, αναζήτηση & αναφορά'],
        ['.pgn (Portable Game Notation)', 'Lichess, Chess.com, TWIC, τουρνουά', 'Πλήρης ανάγνωση, επεξεργασία & SQLite ευρετήριο'],
        ['.7z & .zip αρχεία', 'Κατεβασμένα πακέτα τουρνουά', 'Ανοίγει υποστηριζόμενες βάσεις μέσα από το αρχείο'],
      ],
      faqEyebrow: 'Συχνές Ερωτήσεις',
      faqTitle: 'Απορίες για τα αρχεία .cbh & .cbv',
      faq: [
        [
          'Ποια είναι η διαφορά ανάμεσα σε .cbh και .cbv;',
          'Το .cbh είναι το κύριο αρχείο μιας βάσης που αποτελείται από πολλά αρχεία σε έναν φάκελο, ενώ το .cbv είναι ένα συμπιεσμένο πακέτο που τα περιέχει όλα μαζί. Το Ruru Chess ανοίγει και τα δύο.',
        ],
        [
          'Μπορώ να μετατρέψω αρχεία .cbh ή .cbv σε PGN δωρεάν;',
          'Ναι. Ανοίγεις τη βάση .cbh ή .cbv στο Ruru Chess και εξάγεις όσες παρτίδες θέλεις σε στάνταρ .pgn δωρεάν και χωρίς όριο.',
        ],
        [
          'Θα τροποποιήσει το Ruru Chess τα αρχικά μου αρχεία .cbh;',
          'Όχι. Διαβάζει τα πρωτότυπα αρχεία .cbh, .cbv και .si4 χωρίς να τα αλλοιώνει.',
        ],
        [
          'Ανεβαίνουν οι βάσεις μου σε κάποιον server για να μετατραπούν;',
          'Ποτέ. Όλα γίνονται τοπικά στον υπολογιστή σου — μηδέν αποστολές αρχείων, 100% offline.',
        ],
      ],
      ctaTitle: 'Άνοιξε τις συλλογές .cbh και .cbv σε δευτερόλεπτα.',
      ctaLead: 'Δωρεάν, ανοιχτού κώδικα εφαρμογή Windows με γρήγορο τοπικό ευρετήριο, Stockfish και καθαρή εξαγωγή PGN.',
    },
  },

  {
    slug: 'chess-opponent-preparation',
    img: 'prep',
    homeSection: 'study',
    en: {
      navLabel: 'Chess Opponent Preparation',
      title: 'Free Chess Opponent Preparation (FIDE, Lichess & Chess.com) | Ruru Chess',
      description:
        'Prepare for your next chess opponent for free on Windows. Combine your local FIDE/OTB databases with any Lichess or Chess.com usernames you know into one interactive opening repertoire tree.',
      keywords:
        'chess opponent preparation free, scout chess opponent, FIDE Lichess Chess.com preparation, chess opening tree opponent, tournament chess prep software',
      eyebrow: 'Opponent Dossier · FIDE/OTB + Lichess + Chess.com',
      h1: 'Prepare for your next chess opponent in one place.',
      lead: '<strong>Ruru Chess</strong> combines games from your local FIDE/OTB databases with any public Lichess or Chess.com usernames you enter into a single opponent dossier. Inspect White and Black win rates, rating breakdown, and a playable opening repertoire tree — completely free on Windows.',
      cta: 'Download Opponent Prep Tool Free',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · No Subscription',
      imgAlt: 'Ruru Chess Prepare for opponent screen showing FIDE statistics, score bars, and an interactive opening repertoire tree',
      stepsEyebrow: 'Tournament workflow',
      stepsTitle: 'Build an opponent dossier in 4 steps',
      steps: [
        [
          'Pick the player & add known handles',
          'Select your opponent from your local FIDE/OTB database and optionally add any public Lichess or Chess.com usernames you already know for them.',
        ],
        [
          'Inspect their White & Black repertoire tree',
          'See exact move frequencies, win/draw/loss score bars, and rating breakdowns across every opening line they play.',
        ],
        [
          'Find ideas with Stockfish & reference stats',
          'Click straight into any line of their repertoire tree to test concrete ideas and practical sidelines with Stockfish and your reference database.',
        ],
        [
          'Refresh in one click before the round',
          'One-click updates pull only the newest online games from those handles so your dossier stays current before every tournament round.',
        ],
      ],
      featuresEyebrow: 'Complete scouting',
      featuresTitle: 'OTB and online games side by side',
      featuresLead:
        'Many players test new openings online before playing them over the board. When you know their handles, Ruru brings both sources into one interactive tree.',
      cards: [
        {
          tag: 'Combined Sources',
          title: 'Local FIDE/OTB DB + known online handles',
          text: 'Stop switching between separate websites and desktop tools. Combine your local tournament databases (.pgn, .cbh, .cbv, .si4) with the public Lichess and Chess.com handles you enter.',
        },
        {
          tag: 'Interactive Tree',
          title: 'Playable White & Black repertoire trees',
          text: 'Click through your opponent’s opening choices move by move with clear win/draw/loss score bars and game counts at every branch.',
        },
        {
          tag: 'Fast Incremental Updates',
          title: 'One-click refresh before your game',
          text: 'Already prepared against a rival earlier in the season? Refresh their dossier in one click to fetch only their latest games without starting over.',
        },
        {
          tag: 'Coach & Team Ready',
          title: 'Save prep & review live with your coach',
          text: 'Turn your preparation lines into a personal repertoire database, drill them with spaced repetition, or review them live with your coach in Shared Analysis.',
        },
      ],
      compareEyebrow: 'Why Ruru Chess',
      compareTitle: 'Web scouting tools vs. Ruru Chess opponent prep',
      compareCols: ['Capability', 'Web-only prep sites', 'Ruru Chess (Free)'],
      compareRows: [
        ['Combine local FIDE/OTB DB + Lichess + Chess.com', 'Usually online-only or paywalled', 'Combined in one local dossier for free'],
        ['Analyze opponent lines with local Stockfish', 'Limited depth or paid', 'Full local Stockfish, Lc0 & Maia'],
        ['Keep your preparation private on your PC', 'Stored on third-party servers', '100% local on your Windows computer'],
        ['Train your prep lines before the round', 'Separate tool needed', 'Built-in spaced-repetition repertoire trainer'],
        ['Cost & game limits', 'Monthly subscriptions / caps', 'Free forever, open source'],
      ],
      faqEyebrow: 'Questions & Answers',
      faqTitle: 'Chess opponent preparation FAQ',
      faq: [
        [
          'Does Ruru Chess automatically find a player’s Lichess or Chess.com account?',
          'No. You enter the public Lichess or Chess.com usernames you already know (or use only your local FIDE/OTB database), and Ruru combines those public games into one opening tree.',
        ],
        [
          'Do I need a paid account or API key to pull Lichess and Chess.com games?',
          'No. Ruru Chess fetches public games directly using standard public endpoints with no paid subscription required.',
        ],
        [
          'Can I keep my opponent preparation private and offline?',
          'Yes. Once fetched, your opponent dossier and preparation lines are stored locally on your computer and work completely offline at the tournament venue.',
        ],
        [
          'Can I share my preparation live with a coach or training partner?',
          'Yes. You can open a Shared Analysis room on play.ruruchess.com with encrypted voice and review the exact lines together in real time.',
        ],
      ],
      ctaTitle: 'Walk into your next tournament round organized and prepared.',
      ctaLead: 'Free, open-source opponent scouting on Windows combining your local FIDE/OTB databases with Lichess and Chess.com.',
    },
    el: {
      navLabel: 'Προετοιμασία Αντιπάλου',
      title: 'Δωρεάν Προετοιμασία Αντιπάλου στο Σκάκι (FIDE, Lichess & Chess.com) | Ruru Chess',
      description:
        'Προετοιμάσου για τον επόμενο αντίπαλό σου δωρεάν στα Windows. Συνδύασε τις τοπικές βάσεις FIDE/OTB με τα usernames Lichess ή Chess.com που γνωρίζεις σε ένα διαδραστικό δέντρο ανοιγμάτων.',
      keywords:
        'προετοιμασία αντιπάλου σκάκι, ανάλυση αντιπάλου σκάκι FIDE Lichess Chess.com, δέντρο ανοιγμάτων αντιπάλου, δωρεάν πρόγραμμα προετοιμασίας σκακιού',
      eyebrow: 'Φάκελος Αντιπάλου · FIDE/OTB + Lichess + Chess.com',
      h1: 'Προετοιμάσου για τον επόμενο αντίπαλο σε ένα μέρος.',
      lead: 'Το <strong>Ruru Chess</strong> συνδυάζει παρτίδες από τις τοπικές σου βάσεις FIDE/OTB με τα δημόσια usernames Lichess ή Chess.com που θα εισάγεις, σε έναν ενιαίο φάκελο αντιπάλου. Δες ποσοστά με Λευκά και Μαύρα, κατανομή Elo και ένα διαδραστικό δέντρο ρεπερτορίου — δωρεάν στα Windows.',
      cta: 'Κατέβασε Δωρεάν για Προετοιμασία',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · Χωρίς συνδρομή',
      imgAlt: 'Οθόνη προετοιμασίας αντιπάλου στο Ruru Chess με στατιστικά FIDE, μπάρες αποτελεσμάτων και δέντρο ρεπερτορίου',
      stepsEyebrow: 'Ροή τουρνουά',
      stepsTitle: 'Φτιάξε φάκελο αντιπάλου σε 4 βήματα',
      steps: [
        [
          'Διάλεξε παίκτη & πρόσθεσε γνωστά handles',
          'Επίλεξε τον αντίπαλο από την τοπική σου βάση FIDE/OTB και, αν γνωρίζεις τα δημόσια usernames του σε Lichess ή Chess.com, πρόσθεσέ τα στον ίδιο φάκελο.',
        ],
        [
          'Δες το δέντρο του με Λευκά & Μαύρα',
          'Εξέτασε συχνότητα κινήσεων, μπάρες νίκης/ισοπαλίας/ήττας και κατανομή αξιολόγησης σε κάθε άνοιγμα που παίζει.',
        ],
        [
          'Βρες ιδέες με Stockfish & στατιστικά',
          'Κάνε κλικ σε οποιαδήποτε γραμμή του δέντρου για να ελέγξεις συγκεκριμένες ιδέες και πρακτικές απαντήσεις με Stockfish και τη βάση αναφοράς σου.',
        ],
        [
          'Ανανέωση με ένα κλικ πριν τον γύρο',
          'Με ένα κλικ κατεβάζει μόνο τις πιο πρόσφατες online παρτίδες από τα handles αυτά, ώστε ο φάκελος να μένει ενημερωμένος πριν από κάθε γύρο.',
        ],
      ],
      featuresEyebrow: 'Ολοκληρωμένη εικόνα',
      featuresTitle: 'Παρτίδες τουρνουά και online δίπλα-δίπλα',
      featuresLead:
        'Πολλοί σκακιστές δοκιμάζουν νέα ανοίγματα online πριν τα παίξουν σε τουρνουά. Όταν ξέρεις τα usernames τους, το Ruru φέρνει και τις δύο πηγές σε ένα διαδραστικό δέντρο.',
      cards: [
        {
          tag: 'Συνδυασμός Πηγών',
          title: 'Τοπική βάση FIDE/OTB + γνωστά online handles',
          text: 'Τέλος οι αλλαγές ανάμεσα σε διαφορετικά sites και προγράμματα. Συνδύασε τοπικές βάσεις (.pgn, .cbh, .cbv, .si4) με τα δημόσια handles Lichess και Chess.com που θα βάλεις.',
        },
        {
          tag: 'Διαδραστικό Δέντρο',
          title: 'Δέντρα ρεπερτορίου με Λευκά & Μαύρα',
          text: 'Περιηγήσου στις επιλογές ανοιγμάτων του αντιπάλου κίνηση προς κίνηση, με καθαρές μπάρες αποτελεσμάτων και πλήθος παρτίδων σε κάθε κλάδο.',
        },
        {
          tag: 'Γρήγορη Ενημέρωση',
          title: 'Ανανέωση με ένα κλικ πριν τον αγώνα',
          text: 'Έχεις ήδη ετοιμάσει φάκελο για κάποιον αντίπαλο; Κάνε ανανέωση με ένα κλικ για να φέρει μόνο τις νεότερες παρτίδες χωρίς να ξεκινάς από την αρχή.',
        },
        {
          tag: 'Για Προπονητές & Ομάδες',
          title: 'Αποθήκευσε γραμμές & δείξ’ τες ζωντανά',
          text: 'Κράτα τις γραμμές προετοιμασίας στο προσωπικό σου ρεπερτόριο, εξασκήσου με επανάληψη σε διαστήματα ή δες τες live με τον προπονητή σου στην Κοινή Ανάλυση.',
        },
      ],
      compareEyebrow: 'Γιατί Ruru Chess',
      compareTitle: 'Online εργαλεία vs. Προετοιμασία στο Ruru Chess',
      compareCols: ['Δυνατότητα', 'Μόνο online εργαλεία', 'Ruru Chess (Δωρεάν)'],
      compareRows: [
        ['Συνδυασμός τοπικής βάσης FIDE/OTB + Lichess + Chess.com', 'Συνήθως μόνο online ή επί πληρωμή', 'Συνδυασμένα σε έναν τοπικό φάκελο δωρεάν'],
        ['Ανάλυση γραμμών με τοπικό Stockfish', 'Περιορισμένο βάθος ή συνδρομή', 'Πλήρες τοπικό Stockfish, Lc0 & Maia'],
        ['Ιδιωτικότητα προετοιμασίας στο PC σου', 'Αποθηκευμένη σε ξένους servers', '100% τοπικά στον υπολογιστή σου'],
        ['Εξάσκηση στις γραμμές πριν τον γύρο', 'Θέλει ξεχωριστό εργαλείο', 'Ενσωματωμένη προπόνηση ρεπερτορίου'],
        ['Κόστος & όρια', 'Μηνιαίες συνδρομές / όρια', 'Δωρεάν για πάντα, ανοιχτός κώδικας'],
      ],
      faqEyebrow: 'Συχνές Ερωτήσεις',
      faqTitle: 'Απορίες για την προετοιμασία αντιπάλου',
      faq: [
        [
          'Βρίσκει το Ruru Chess αυτόματα τον λογαριασμό Lichess ή Chess.com ενός παίκτη;',
          'Όχι. Εσύ εισάγεις τα δημόσια usernames Lichess ή Chess.com που ήδη γνωρίζεις (ή δουλεύεις μόνο με την τοπική σου βάση FIDE/OTB), και το Ruru τα συνδυάζει σε ένα δέντρο ανοιγμάτων.',
        ],
        [
          'Χρειάζεται πληρωμένος λογαριασμός ή API key για Lichess και Chess.com;',
          'Όχι. Το Ruru Chess κατεβάζει τις δημόσιες παρτίδες απευθείας χωρίς καμία συνδρομή.',
        ],
        [
          'Μένει η προετοιμασία μου ιδιωτική και διαθέσιμη offline;',
          'Ναι. Μόλις κατέβουν οι παρτίδες, ο φάκελος και οι γραμμές σου μένουν τοπικά στο PC σου και ανοίγουν κανονικά χωρίς ίντερνετ στον χώρο των αγώνων.',
        ],
        [
          'Μπορώ να δω την προετοιμασία ζωντανά με τον προπονητή μου;',
          'Ναι. Ανοίγεις ένα δωμάτιο Κοινής Ανάλυσης στο play.ruruchess.com με κρυπτογραφημένη φωνή και βλέπετε τις γραμμές μαζί σε πραγματικό χρόνο.',
        ],
      ],
      ctaTitle: 'Μπες στον επόμενο γύρο τουρνουά οργανωμένος και έτοιμος.',
      ctaLead: 'Δωρεάν, ανοιχτού κώδικα προετοιμασία αντιπάλου στα Windows που συνδυάζει τις τοπικές βάσεις FIDE/OTB με Lichess και Chess.com.',
    },
  },

  {
    slug: 'stockfish-gui-windows',
    img: 'blunder',
    homeSection: 'analysis',
    en: {
      navLabel: 'Offline Analysis & Stockfish GUI',
      title: 'Modern Offline Chess Analysis & Stockfish GUI for Windows | Ruru Chess',
      description:
        'A clean, modern Windows chess analysis GUI for Stockfish, Leela Chess Zero (Lc0), and Maia. Unlimited offline blunder checks, accuracy graphs, multi-PV arrows, two-engine comparison, and 7-piece Syzygy.',
      keywords:
        'Stockfish GUI Windows, offline chess analysis software Windows, free chess blunder check, Leela Chess Zero GUI, Maia chess GUI, chess game review offline',
      eyebrow: 'Modern Analysis Workspace · Stockfish, Lc0 & Maia',
      h1: 'Clean, offline chess game analysis for Windows.',
      lead: 'Stockfish is free for everyone — what is hard to find is a fast, clutter-free Windows interface around it. <strong>Ruru Chess</strong> puts Stockfish, Leela Chess Zero, and human-like Maia engines into a modern workspace with one-click blunder checks, accuracy graphs, dual-engine comparison, and 7-piece Syzygy lookups — completely free and offline.',
      cta: 'Download Analysis Workspace Free',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · Optional Stockfish setup',
      imgAlt: 'Full-game blunder check in Ruru Chess showing evaluation graph, accuracy, and Stockfish annotations',
      stepsEyebrow: 'Zero friction setup',
      stepsTitle: 'Analyze your games offline in 4 steps',
      steps: [
        [
          'Install with optional Stockfish',
          'Run the Windows installer and leave Stockfish ticked to download it on first start — or load any UCI engine binary already on your PC.',
        ],
        [
          'Open a game or paste a PGN / FEN',
          'Load a game from any local database, paste a PGN/FEN from Lichess or Chess.com, or enter moves directly on the board.',
        ],
        [
          'Run a one-click blunder check',
          'Spot inaccuracies (?!), mistakes (?), and blunders (??) with an evaluation curve, accuracy percentage, average centipawn loss, and stronger continuations.',
        ],
        [
          'Compare with Lc0, Maia & Syzygy',
          'Run two engines side by side, test human-like moves with Maia (1100–1900), and check exact 7-piece Syzygy endgame evaluations.',
        ],
      ],
      featuresEyebrow: 'Modern desktop workflow',
      featuresTitle: 'Engine analysis without cluttered 1990s menus',
      featuresLead:
        'Board, multi-PV lines, evaluation bar, figurine notation, annotations, and opening reference sit cleanly side by side in light or dark mode.',
      cards: [
        {
          tag: 'Blunder Check & Accuracy',
          title: 'Unlimited offline game reviews',
          text: 'Analyze any tournament or online game in one click. Ruru plots the evaluation graph, computes accuracy and average centipawn loss for both sides, and annotates turning points.',
        },
        {
          tag: 'Dual-Engine & Human Nets',
          title: 'Stockfish + Leela Chess Zero + Maia',
          text: 'Run two UCI engines side by side with multi-PV board arrows, or add Maia neural networks for realistic club-level analysis and sparring.',
        },
        {
          tag: 'Clean Annotations',
          title: 'Variations, NAG symbols & colored arrows',
          text: 'Write comments before or after any move, create nested variations, add !, ?, !!, ??, !?, ± symbols, and draw colored arrows saved directly to standard PGN.',
        },
        {
          tag: 'Endgame & Opening Context',
          title: '7-piece Syzygy & local reference stats',
          text: 'Combine engine evaluations with optional 7-piece Syzygy tablebase lookups and live opening reference statistics from your own database.',
        },
      ],
      compareEyebrow: 'Why desktop analysis',
      compareTitle: 'Browser-only game review vs. Ruru Chess on Windows',
      compareCols: ['Feature', 'Browser-only game review', 'Ruru Chess (Windows)'],
      compareRows: [
        ['Unlimited blunder checks & accuracy', 'Often capped behind paid subscriptions', 'Unlimited, free & offline'],
        ['Full native CPU speed', 'Limited by browser WASM or cloud queue', 'Native Windows binaries at full local speed'],
        ['Run two engines side by side', 'Rarely available', 'Supported natively (Stockfish + Lc0 / Maia)'],
        ['Annotated PGN & local database', 'Tied to one website', 'Your PC, standard PGN + .cbh/.cbv/.si4'],
        ['Privacy & offline use', 'Requires internet & account', '100% offline, zero ads, zero tracking'],
      ],
      faqEyebrow: 'Questions & Answers',
      faqTitle: 'Offline analysis & Stockfish GUI FAQ',
      faq: [
        [
          'Does Ruru Chess set up Stockfish automatically?',
          'During installation you choose whether Ruru downloads Stockfish automatically on first launch. You can also connect any custom UCI engine binary you already have.',
        ],
        [
          'Can I run Leela Chess Zero (Lc0) and Maia in Ruru Chess?',
          'Yes. Ruru Chess supports Leela Chess Zero and Maia neural networks (1100–1900) both for analysis and for human-like bot sparring.',
        ],
        [
          'Are blunder checks and game reviews really unlimited?',
          'Yes. Everything runs locally on your Windows CPU with zero daily caps, no account required, and no subscription.',
        ],
        [
          'Can I export my analysis and annotations to standard PGN?',
          'Yes. Variations, evaluations, NAG symbols, comments, and board arrows save cleanly to standard PGN files.',
        ],
      ],
      ctaTitle: 'Review unlimited games offline in a clean Windows workspace.',
      ctaLead: 'Free, open-source desktop app combining Stockfish, Lc0, Maia, blunder checks, databases, and live shared study.',
    },
    el: {
      navLabel: 'Offline Ανάλυση & Stockfish GUI',
      title: 'Σύγχρονη Offline Ανάλυση Σκακιού & Stockfish GUI για Windows | Ruru Chess',
      description:
        'Καθαρό, σύγχρονο περιβάλλον ανάλυσης σκακιού για Windows με Stockfish, Leela Chess Zero (Lc0) και Maia. Απεριόριστος έλεγχος λαθών offline, ακρίβεια, βέλη, 2η μηχανή και 7-piece Syzygy.',
      keywords:
        'ανάλυση σκακιού Stockfish Windows, δωρεάν πρόγραμμα ανάλυσης σκακιού offline, Stockfish GUI Windows, έλεγχος λαθών σκάκι, Leela Chess Zero, Maia σκάκι',
      eyebrow: 'Σύγχρονος Χώρος Ανάλυσης · Stockfish, Lc0 & Maia',
      h1: 'Καθαρή, offline ανάλυση παρτίδων σκακιού για Windows.',
      lead: 'Το Stockfish είναι δωρεάν για όλους — αυτό που λείπει είναι ένα γρήγορο, καθαρό περιβάλλον Windows γύρω του. Το <strong>Ruru Chess</strong> βάζει Stockfish, Leela Chess Zero και Maia σε ένα σύγχρονο workspace με έλεγχο λαθών με ένα κλικ, γράφημα αξιολόγησης, σύγκριση δύο μηχανών και 7-piece Syzygy — εντελώς δωρεάν και offline.',
      cta: 'Κατέβασε Δωρεάν για Ανάλυση',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · Προαιρετικό Stockfish',
      imgAlt: 'Έλεγχος λαθών ολόκληρης παρτίδας στο Ruru Chess με γράφημα αξιολόγησης, ακρίβεια και σημάδια Stockfish',
      stepsEyebrow: 'Χωρίς πολύπλοκες ρυθμίσεις',
      stepsTitle: 'Ανάλυσε τις παρτίδες σου offline σε 4 βήματα',
      steps: [
        [
          'Εγκατάσταση με προαιρετικό Stockfish',
          'Τρέξε τον εγκαταστάτη και άφησε τικαρισμένο το Stockfish για αυτόματη λήψη στην πρώτη εκκίνηση — ή σύνδεσε όποια μηχανή UCI έχεις ήδη.',
        ],
        [
          'Άνοιξε παρτίδα ή κάνε επικόλληση PGN / FEN',
          'Φόρτωσε παρτίδα από οποιαδήποτε βάση, επικόλλησε PGN/FEN από Lichess ή Chess.com ή παίξε κινήσεις απευθείας στη σκακιέρα.',
        ],
        [
          'Έλεγχος λαθών με ένα κλικ',
          'Εντόπισε ανακρίβειες (?!), λάθη (?) και γκάφες (??) με γράφημα αξιολόγησης, ποσοστό ακρίβειας, μέσο centipawn loss και την καλύτερη συνέχεια.',
        ],
        [
          'Σύγκριση με Lc0, Maia & Syzygy',
          'Τρέξε δύο μηχανές ταυτόχρονα, δες ανθρώπινες κινήσεις με τα νευρωνικά δίκτυα Maia (1100–1900) και έλεγξε ακριβή φινάλε 7 κομματιών Syzygy.',
        ],
      ],
      featuresEyebrow: 'Σύγχρονη εμπειρία desktop',
      featuresTitle: 'Δύναμη μηχανών χωρίς παλιομοδίτικα μενού του ’90',
      featuresLead:
        'Σκακιέρα, πολλαπλές γραμμές, μπάρα αξιολόγησης, σύμβολα κομματιών, σχόλια και αναφορά ανοιγμάτων κάθονται καθαρά δίπλα-δίπλα σε φωτεινό ή σκοτεινό θέμα.',
      cards: [
        {
          tag: 'Έλεγχος Λαθών & Ακρίβεια',
          title: 'Απεριόριστος έλεγχος παρτίδων offline',
          text: 'Ανάλυσε όσες παρτίδες τουρνουά ή online θες με ένα κλικ. Το Ruru σχεδιάζει το γράφημα αξιολόγησης, υπολογίζει ακρίβεια και centipawn loss και σημειώνει τα κρίσιμα σημεία.',
        },
        {
          tag: 'Δύο Μηχανές & Maia',
          title: 'Stockfish + Leela Chess Zero + Maia',
          text: 'Τρέξε δύο μηχανές UCI ταυτόχρονα με βέλη στη σκακιέρα, ή πρόσθεσε Maia για ρεαλιστικές ανθρώπινες κινήσεις και εξάσκηση.',
        },
        {
          tag: 'Καθαρός Σχολιασμός',
          title: 'Βαριάντες, σύμβολα NAG & χρωματιστά βέλη',
          text: 'Γράψε σχόλια πριν ή μετά από κάθε κίνηση, φτιάξε βαριάντες, βάλε σύμβολα !, ?, !!, ??, !?, ± και σχεδίασε βέλη που αποθηκεύονται σε στάνταρ PGN.',
        },
        {
          tag: 'Φινάλε & Θεωρία',
          title: '7-piece Syzygy & τοπική αναφορά ανοιγμάτων',
          text: 'Συνδύασε την αξιολόγηση της μηχανής με προαιρετικούς πίνακες φινάλε 7 κομματιών Syzygy και ζωντανά στατιστικά από τη βάση αναφοράς σου.',
        },
      ],
      compareEyebrow: 'Γιατί desktop ανάλυση',
      compareTitle: 'Ανάλυση στον browser vs. Ruru Chess στα Windows',
      compareCols: ['Δυνατότητα', 'Ανάλυση σε browser', 'Ruru Chess (Windows)'],
      compareRows: [
        ['Απεριόριστος έλεγχος λαθών & ακρίβεια', 'Συχνά με ημερήσιο όριο ή συνδρομή', 'Απεριόριστα, δωρεάν & offline'],
        ['Πλήρης ταχύτητα επεξεργαστή', 'Περιορισμένη από browser WASM / ουρά', 'Εγγενές Stockfish σε πλήρη τοπική ταχύτητα'],
        ['Δύο μηχανές ταυτόχρονα', 'Σπάνια διαθέσιμο', 'Υποστηρίζεται εγγενώς (Stockfish + Lc0 / Maia)'],
        ['Σχολιασμένα PGN & τοπικές βάσεις', 'Δεμένα με ένα site', 'Στο PC σου, στάνταρ PGN + .cbh/.cbv/.si4'],
        ['Ιδιωτικότητα & χρήση offline', 'Θέλει ίντερνετ & λογαριασμό', '100% offline, χωρίς διαφημίσεις ή tracking'],
      ],
      faqEyebrow: 'Συχνές Ερωτήσεις',
      faqTitle: 'Απορίες για την offline ανάλυση & το Stockfish GUI',
      faq: [
        [
          'Ρυθμίζει το Ruru Chess το Stockfish αυτόματα;',
          'Κατά την εγκατάσταση επιλέγεις αν θέλεις να κατέβει αυτόματα το Stockfish στην πρώτη εκκίνηση. Μπορείς επίσης να προσθέσεις όποια άλλη μηχανή UCI έχεις ήδη.',
        ],
        [
          'Μπορώ να τρέξω Leela Chess Zero (Lc0) και Maia στο Ruru Chess;',
          'Ναι. Υποστηρίζει Leela Chess Zero και τα νευρωνικά δίκτυα Maia (1100–1900) τόσο για ανάλυση όσο και για παιχνίδι με bots ανθρώπινου στιλ.',
        ],
        [
          'Είναι όντως απεριόριστος ο έλεγχος λαθών;',
          'Ναι. Όλα τρέχουν τοπικά στον επεξεργαστή σου χωρίς ημερήσια όρια, χωρίς λογαριασμό και χωρίς συνδρομή.',
        ],
        [
          'Μπορώ να εξάγω την ανάλυση και τα σχόλιά μου σε PGN;',
          'Ναι. Βαριάντες, αξιολογήσεις, σύμβολα NAG, σχόλια και βέλη αποθηκεύονται καθαρά σε στάνταρ αρχεία PGN.',
        ],
      ],
      ctaTitle: 'Έλεγξε απεριόριστες παρτίδες offline σε ένα καθαρό περιβάλλον Windows.',
      ctaLead: 'Δωρεάν, ανοιχτού κώδικα εφαρμογή με Stockfish, Lc0, Maia, έλεγχο λαθών, βάσεις και ζωντανή κοινή μελέτη.',
    },
  },

  {
    slug: 'pdf-chess-book-to-pgn',
    img: 'book',
    insetImg: 'bookpage.webp',
    homeSection: 'books',
    en: {
      navLabel: 'PDF Chess Book to PGN',
      title: 'Convert PDF Chess Books to Playable PGN & Databases — Free | Ruru Chess',
      description:
        'Import digital PDF chess books into playable games and PGN on Windows — free and 100% offline. Extracts games, variations, notes, diagrams, and exercises so you can study and refine them on a live board.',
      keywords:
        'PDF chess book to PGN, convert chess PDF to PGN, chess book PDF reader, chess PDF to database, interactive chess book viewer, free chess software Windows',
      eyebrow: 'PDF Chess Book Importer · Free & Offline',
      h1: 'Turn digital PDF chess books into playable games &amp; PGN.',
      lead: 'Stop flipping back and forth between a PDF reader and a chessboard. Open a digital PDF chess book you own in <strong>Ruru Chess</strong> to extract games, variations, commentary, and diagrams onto an interactive board — completely offline on Windows, with easy editing and PGN export.',
      cta: 'Download Ruru Chess Free',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · 100% Offline',
      imgAlt: 'Chess game extracted from a PDF chess book into Ruru Chess with variations and commentary',
      insetAlt: 'Original PDF chess book page converted into a playable game in Ruru Chess',
      pdfTag: 'PDF Page',
      stepsEyebrow: 'How it works',
      stepsTitle: 'From PDF chess book to playable board in 4 steps',
      steps: [
        [
          'Open a digital PDF chess book',
          'Import a text-based PDF chess book you own directly from your Windows PC. Nothing is ever uploaded to a server.',
        ],
        [
          'Automatic notation & diagram parsing',
          'Ruru reads algebraic and figurine notation, main lines, variations, author notes, and board diagrams straight from the pages.',
        ],
        [
          'Review, edit & study with Stockfish',
          'Step through every line on an interactive board, fix any tricky layout spot in seconds, check claims with Stockfish, or solve exercise books in hidden-solution mode.',
        ],
        [
          'Save locally or export to PGN',
          'Keep your imported book as a searchable local database inside Ruru Chess or export clean standard PGN files.',
        ],
      ],
      featuresEyebrow: 'Practical & transparent',
      featuresTitle: 'Designed to save hours of manual move entry',
      featuresLead:
        'Clean digital chess PDFs give the best results; complex multi-column layouts or scans may still need quick touch-ups right on the board.',
      cards: [
        {
          tag: 'Notation & Variations',
          title: 'Main lines, variations & commentary',
          text: 'Captures move trees, annotations (!, ?, !!, ??), and prose comments so you can follow the author’s ideas while stepping through positions interactively.',
        },
        {
          tag: 'Exercise Books',
          title: 'Training mode without spoilers',
          text: 'Exercise books open in training mode, hiding the solution moves until you try finding them on the board yourself.',
        },
        {
          tag: 'Diagrams & Scans',
          title: 'Digital PDFs first + basic Windows OCR',
          text: 'Works best on clean digital text-based PDFs. Basic support for scanned pages via built-in Windows OCR is also included, though scan accuracy varies with print quality.',
        },
        {
          tag: 'Private & Offline',
          title: '100% local, free & open source',
          text: 'Your PDF books never leave your PC. No page limits, no subscriptions, and full editing plus PGN export under GPL/AGPL open-source licensing.',
        },
      ],
      compareEyebrow: 'Why Ruru Chess',
      compareTitle: 'Reading a chess PDF manually vs. importing into Ruru Chess',
      compareCols: ['Capability', 'Standard PDF reader', 'Ruru Chess (Free)'],
      compareRows: [
        ['Play through variations & sub-variations', 'Manual setup on a separate board', 'Interactive board & editable move tree'],
        ['Check author claims with Stockfish', 'Re-enter positions by hand', 'Built-in Stockfish, Lc0 & Maia analysis'],
        ['Solve exercises without spoilers', 'Answers sit right below the diagram', 'Training mode hides solutions until solved'],
        ['Export book games to standard PGN', 'Not possible', 'Direct export to clean .pgn or local DB'],
        ['Privacy & cost', 'Free but static', 'Free, open source & 100% offline'],
      ],
      faqEyebrow: 'Questions & Answers',
      faqTitle: 'PDF chess book import FAQ',
      faq: [
        [
          'How accurate is the PDF chess book importer?',
          'Clean digital (text-based) chess PDFs import cleanly and save hours of manual typing. Unusual layouts, older fonts, or scanned pages can require quick manual fixes directly in Ruru’s board editor.',
        ],
        [
          'Is converting PDF chess books to PGN completely free?',
          'Yes. Ruru Chess is 100% free and open source (GPL / AGPL) with no page caps and no paid pro tier.',
        ],
        [
          'Are my PDF chess books uploaded to any server?',
          'No. All PDF parsing, diagram reading, and indexing run locally on your Windows PC, completely offline.',
        ],
        [
          'Does it work with scanned PDF chess books?',
          'Digital text-based PDFs give much cleaner results. Basic support for scanned pages via Windows OCR is included, though results depend heavily on scan sharpness.',
        ],
        [
          'Can I edit and export the imported book to standard PGN?',
          'Yes. You can edit moves, comments, or variations right inside Ruru Chess, analyze with Stockfish, and export standard PGN files anytime.',
        ],
      ],
      ctaTitle: 'Study your digital PDF chess books on a live board.',
      ctaLead: 'Free, open source, and 100% offline on Windows 10 & 11 — along with databases, Stockfish, opponent prep, and live shared study.',
    },
    el: {
      navLabel: 'Μετατροπή βιβλίου PDF σε PGN',
      title: 'Μετατροπή Σκακιστικού Βιβλίου PDF σε PGN & Βάση — Δωρεάν | Ruru Chess',
      description:
        'Εισαγωγή ψηφιακών σκακιστικών βιβλίων PDF σε ζωντανή βάση και PGN δωρεάν στα Windows — 100% offline. Εξαγωγή παρτίδων, βαριάντων, σχολίων και ασκήσεων με εύκολη επεξεργασία στο Ruru Chess.',
      keywords:
        'μετατροπή βιβλίου σκακιού PDF σε PGN, σκακιστικό βιβλίο PDF σε βάση, διάβασμα σκακιστικού βιβλίου PDF, δωρεάν πρόγραμμα σκακιού Windows, Ruru Chess',
      eyebrow: 'Εισαγωγή Βιβλίων PDF · Δωρεάν & Offline',
      h1: 'Κάνε ψηφιακά σκακιστικά βιβλία PDF ζωντανή βάση &amp; PGN.',
      lead: 'Τέλος το μπρος-πίσω ανάμεσα στο PDF και τη σκακιέρα. Άνοιξε ένα ψηφιακό σκακιστικό βιβλίο PDF που έχεις στο <strong>Ruru Chess</strong> για να περάσεις παρτίδες, βαριάντες, σχόλια και διαγράμματα σε διαδραστική σκακιέρα — εντελώς τοπικά στα Windows, με εύκολη διόρθωση και εξαγωγή PGN.',
      cta: 'Κατέβασε το Ruru Chess Δωρεάν',
      ctaSub: 'v{version} · {setupMB} MB · Windows 10 & 11 (64-bit) · 100% Offline',
      imgAlt: 'Παρτίδα που εξήχθη από σκακιστικό βιβλίο PDF μέσα στο Ruru Chess με βαριάντες και σχόλια',
      insetAlt: 'Αρχική σελίδα σκακιστικού βιβλίου PDF που μετατράπηκε σε ζωντανή παρτίδα στο Ruru Chess',
      pdfTag: 'Σελίδα PDF',
      stepsEyebrow: 'Πώς λειτουργεί',
      stepsTitle: 'Από ψηφιακό PDF σε ζωντανή σκακιέρα σε 4 βήματα',
      steps: [
        [
          'Άνοιξε ένα ψηφιακό σκακιστικό PDF',
          'Επίλεξε ένα ψηφιακό (text-based) σκακιστικό βιβλίο PDF από τον υπολογιστή σου. Το αρχείο δεν ανεβαίνει ποτέ σε server.',
        ],
        [
          'Αυτόματη ανάγνωση κινήσεων & διαγραμμάτων',
          'Το Ruru διαβάζει σημειογραφία, κύριες γραμμές, βαριάντες, σχόλια του συγγραφέα και διαγράμματα σκακιέρας.',
        ],
        [
          'Έλεγχος, διόρθωση & μελέτη με Stockfish',
          'Παίξε κάθε γραμμή στη σκακιέρα, διόρθωσε εύκολα όποιο σημείο χρειαστεί, έλεγξε θέσεις με Stockfish ή λύσε ασκήσεις χωρίς να βλέπεις τη λύση.',
        ],
        [
          'Αποθήκευση σε βάση ή εξαγωγή PGN',
          'Κράτα το βιβλίο ως γρήγορη τοπική βάση στο Ruru Chess ή κάνε εξαγωγή σε καθαρό στάνταρ αρχείο PGN.',
        ],
      ],
      featuresEyebrow: 'Πρακτικό & ειλικρινές',
      featuresTitle: 'Γλιτώνει ώρες χειροκίνητης πληκτρολόγησης',
      featuresLead:
        'Αποδίδει καλύτερα σε καθαρά ψηφιακά PDF· σε σύνθετες σελίδες ή σκαναρισμένα βιβλία μπορεί να χρειαστούν μικρές διορθώσεις πάνω στη σκακιέρα.',
      cards: [
        {
          tag: 'Σημειογραφία & Βαριάντες',
          title: 'Κύριες γραμμές, βαριάντες & σχόλια',
          text: 'Διατηρεί δέντρα κινήσεων, σύμβολα (!, ?, !!, ??) και σχόλια κειμένου, ώστε να διαβάζεις τις εξηγήσεις του συγγραφέα ενώ κινείς τα κομμάτια.',
        },
        {
          tag: 'Βιβλία Ασκήσεων',
          title: 'Λειτουργία εκπαίδευσης χωρίς spoilers',
          text: 'Τα βιβλία ασκήσεων ανοίγουν σε λειτουργία εκπαίδευσης, κρύβοντας τη λύση μέχρι να δοκιμάσεις να τη βρεις μόνος σου.',
        },
        {
          tag: 'Ψηφιακά PDF & OCR',
          title: 'Καλύτερο σε ψηφιακά PDF + βασικό Windows OCR',
          text: 'Δουλεύει πολύ πιο καθαρά σε ψηφιακά PDF με κείμενο. Υπάρχει και βασική υποστήριξη για σκαναρισμένες σελίδες με το OCR των Windows, ανάλογα με την ποιότητα της σάρωσης.',
        },
        {
          tag: 'Ιδιωτικότητα & Ελευθερία',
          title: '100% τοπικά, δωρεάν & ανοιχτός κώδικας',
          text: 'Τα βιβλία σου μένουν στο PC σου. Χωρίς όριο σελίδων, χωρίς συνδρομές και με πλήρη επεξεργασία και εξαγωγή PGN.',
        },
      ],
      compareEyebrow: 'Γιατί Ruru Chess',
      compareTitle: 'Απλό PDF reader vs. εισαγωγή στο Ruru Chess',
      compareCols: ['Δυνατότητα', 'Απλό PDF reader', 'Ruru Chess (Δωρεάν)'],
      compareRows: [
        ['Παίξιμο βαριάντων & υποβαριάντων', 'Στήσιμο με το χέρι σε άλλη σκακιέρα', 'Διαδραστική σκακιέρα & εύκολη επεξεργασία'],
        ['Έλεγχος ανάλυσης με Stockfish', 'Αντιγραφή θέσης με το χέρι', 'Ενσωματωμένα Stockfish, Lc0 & Maia'],
        ['Λύση ασκήσεων χωρίς να δεις την απάντηση', 'Η λύση φαίνεται κάτω από το διάγραμμα', 'Λειτουργία εκπαίδευσης που κρύβει τη λύση'],
        ['Εξαγωγή παρτίδων σε στάνταρ PGN', 'Δεν γίνεται', 'Άμεση εξαγωγή σε .pgn ή τοπική βάση'],
        ['Ιδιωτικότητα & κόστος', 'Δωρεάν αλλά στατικό', 'Δωρεάν, open source & 100% offline'],
      ],
      faqEyebrow: 'Συχνές Ερωτήσεις',
      faqTitle: 'Απορίες για την εισαγωγή σκακιστικών PDF',
      faq: [
        [
          'Πόσο ακριβής είναι η μετατροπή από PDF;',
          'Σε καθαρά ψηφιακά (text-based) σκακιστικά PDF η μετατροπή είναι πολύ πρακτική και γλιτώνει ώρες πληκτρολόγησης. Σε δύσκολες σελίδες, παλιές γραμματοσειρές ή σκαναρισμένα PDF μπορεί να χρειαστούν γρήγορες διορθώσεις απευθείας στη σκακιέρα.',
        ],
        [
          'Είναι εντελώς δωρεάν η μετατροπή βιβλίων PDF σε PGN;',
          'Ναι. Το Ruru Chess είναι 100% δωρεάν και ανοιχτού κώδικα (GPL / AGPL), χωρίς όριο σελίδων και χωρίς πληρωμένη έκδοση.',
        ],
        [
          'Ανεβαίνουν τα PDF βιβλία μου σε κάποιον server;',
          'Όχι. Όλη η ανάγνωση και η δημιουργία της βάσης γίνονται τοπικά στον υπολογιστή σου, εντελώς offline.',
        ],
        [
          'Δουλεύει με σκαναρισμένα σκακιστικά βιβλία PDF;',
          'Τα ψηφιακά PDF με κείμενο δίνουν πολύ πιο καθαρά αποτελέσματα. Υπάρχει και βασική υποστήριξη για σκαναρισμένα PDF μέσω Windows OCR, ανάλογα με την ποιότητα σάρωσης.',
        ],
        [
          'Μπορώ να διορθώσω και να εξάγω το βιβλίο σε στάνταρ PGN;',
          'Ναι. Μπορείς να επεξεργαστείς κινήσεις, σχόλια και βαριάντες μέσα στο Ruru Chess, να αναλύσεις με Stockfish και να εξάγεις σε στάνταρ PGN.',
        ],
      ],
      ctaTitle: 'Μελέτησε τα ψηφιακά σκακιστικά σου PDF πάνω σε ζωντανή σκακιέρα.',
      ctaLead: 'Δωρεάν, ανοιχτού κώδικα και 100% offline σε Windows 10 & 11 — μαζί με βάσεις, Stockfish, προετοιμασία και κοινή ανάλυση.',
    },
  },
];
