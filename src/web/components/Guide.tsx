/**
 * Οδηγός για νέους χρήστες: μικρά παραθυράκια δίπλα σε κουμπιά και σελίδες, την πρώτη φορά που ανοίγει κάθε
 * μέρος της εφαρμογής (Βάσεις, Φίλοι, σκακιέρα, Βελτίωση, bots, Παίξε με φίλο, Κοινή ανάλυση, Ζωντανά,
 * Προετοιμασία για αντίπαλο, Βιβλίο σε βάση). Τα σημεία έχουν `data-guide="…"`· ένα θέμα εμφανίζεται μόνο
 * όταν φαίνεται το σημείο του (ενεργή καρτέλα, χωρίς ανοιχτό διάλογο). Ό,τι είδε ο χρήστης γράφεται στις
 * ρυθμίσεις (`ui.guide`)· το «?» της πάνω γραμμής τα ξαναδείχνει.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';

interface Step {
  /** πού δείχνει: ο πρώτος επιλογέας που φαίνεται */
  at: string[];
  title: () => string;
  text: () => string;
}

interface Topic {
  id: string;
  /** πότε ισχύει: όταν φαίνεται αυτό το στοιχείο */
  when: string;
  steps: Step[];
}

export interface GuideState {
  seen?: string[];
  off?: boolean;
}

const g = (name: string) => `[data-guide="${name}"]`;

const TOPICS: Topic[] = [
  {
    id: 'welcome',
    when: g('new-db'),
    steps: [
      {
        at: [g('new-db')],
        title: () => L('Καλώς ήρθες στο Ruru!', 'Welcome to Ruru!'),
        text: () =>
          L(
            'Ξεκίνα από εδώ: η «Νέα βάση» φτιάχνει μια δική σου βάση, π.χ. για τις παρτίδες σου. Έτοιμες βάσεις (PGN, ChessBase) ανοίγουν με το «Άνοιγμα αρχείου».',
            'Start here: “New database” creates a database of your own, e.g. for your games. Existing databases (PGN, ChessBase) open with “Open file”.',
          ),
      },
      {
        at: [g('new-game')],
        title: () => L('Νέα παρτίδα', 'New game'),
        text: () =>
          L(
            'Ανοίγει μια άδεια σκακιέρα: παίζεις ή αναλύεις κινήσεις, με τη μηχανή αν θέλεις, και στο τέλος την αποθηκεύεις σε όποια βάση θέλεις.',
            'Opens an empty board: play or analyse moves, with the engine if you like, and save the game to any database when you are done.',
          ),
      },
      {
        at: [g('quick-search')],
        title: () => L('Γρήγορη αναζήτηση', 'Quick search'),
        text: () =>
          L(
            'Ψάχνεις παίκτη, άνοιγμα ή θέση ταυτόχρονα σε όλες τις βάσεις σου και ανοίγεις κατευθείαν τις παρτίδες.',
            'Search for a player, opening or position across all your databases at once and jump straight to the games.',
          ),
      },
      {
        at: [g('friends'), g('friends-toggle')],
        title: () => L('Φίλοι και ομάδες', 'Friends & teams'),
        text: () =>
          L(
            'Φτιάξε προαιρετικό λογαριασμό (χωρίς email/κωδικό, 16+) για μόνιμη λίστα φίλων και ομάδες μελέτης: βλέπεις ποιος είναι online, κάνετε chat, μοιράζεστε αρχεία PGN και στέλνετε προσκλήσεις με ένα κλικ για παιχνίδι ή κοινή ανάλυση.',
            'Create an optional account (no email/password, 16+) for a permanent friends list and study teams: see who is online, chat, share PGN files and send one-click invites to play or analyse together.',
          ),
      },
      {
        at: [g('tab-tactics')],
        title: () => L('Όλες οι λειτουργίες', 'All features'),
        text: () =>
          L(
            'Στις πάνω καρτέλες βρίσκεις Βελτίωση, Bots, Παίξε με φίλο, Κοινή ανάλυση, Ζωντανά, Προετοιμασία και Βιβλίο σε βάση. Την πρώτη φορά που ανοίγεις καθεμία, θα σου δείξω με δυο λόγια τι κάνει.',
            'In the top tabs you will find Improve, Bots, Play a friend, Shared analysis, Watch Live, Prepare and Book to database. The first time you open each one, a short note will explain it.',
          ),
      },
    ],
  },
  {
    id: 'improve',
    when: g('improve'),
    steps: [
      {
        at: [g('improve')],
        title: () => L('Βελτίωση: τρία μέρη', 'Improve: three parts'),
        text: () =>
          L(
            'Τακτικά για να ακονίσεις το μάτι σου, Φινάλε για να τα μάθεις και να τα εξασκήσεις, και Στρατηγικά για να καταλάβεις τα σχέδια των μεγάλων παικτών. Διάλεξε από εδώ.',
            'Tactics to sharpen your eye, Endgames to learn and practise them, and Strategy to understand the plans of great players. Pick one here.',
          ),
      },
    ],
  },
  {
    // νέα εγκατάσταση: πριν από τα επίπεδα, η λήψη των γρίφων
    id: 'puzzles',
    when: `${g('page-tactics')} ${g('puzzles')}`,
    steps: [
      {
        at: [`${g('page-tactics')} ${g('puzzles')}`],
        title: () => L('Τακτικά: πρώτα οι γρίφοι', 'Tactics: first, the puzzles'),
        text: () =>
          L(
            'Οι γρίφοι κατεβαίνουν μία φορά, την πρώτη. Το «Προτεινόμενο» είναι ήδη επιλεγμένο: πάτα «Λήψη και εισαγωγή» και, μόλις τελειώσει, διαλέγεις επίπεδο και ξεκινάς.',
            'Puzzles are downloaded once, the first time. “Recommended” is already selected: press “Download and import”, and when it is done, pick a level and start.',
          ),
      },
    ],
  },
  {
    id: 'tactics',
    when: `${g('page-tactics')} ${g('levels')}`,
    steps: [
      {
        at: [`${g('page-tactics')} ${g('levels')}`],
        title: () => L('Τακτικά', 'Tactics'),
        text: () =>
          L(
            'Γρίφοι για κάθε επίπεδο: διάλεξε από «Πολύ εύκολο» ως «Πολύ δύσκολο» και πάτα «Έναρξη». Αν δεν ξέρεις τι να διαλέξεις, το «Στάνταρ» δίνει απλά τακτικά στα μέτρα σου.',
            'Puzzles for every level: choose from “Easiest” to “Hardest” and press “Start”. Not sure? “Standard” gives plain tactics that match your rating.',
          ),
      },
    ],
  },
  {
    id: 'endgame',
    when: g('page-endgame'),
    steps: [
      {
        at: [g('endgame'), g('nav-endgame')],
        title: () => L('Φινάλε σε δύο στάδια', 'Endgames in two stages'),
        text: () =>
          L(
            '1. Μαθήματα: από τα βασικά ματ ως τις μελέτες, τα βλέπεις βήμα βήμα σαν σχολιασμένη παρτίδα.\n2. Εξάσκηση: παίζεις τη θέση εναντίον του υπολογιστή, για να κερδίσεις ή να κρατήσεις την ισοπαλία.',
            '1. Lessons: from the basic mates to studies, shown step by step like an annotated game.\n2. Practice: play the position against the computer to win it or hold the draw.',
          ),
      },
    ],
  },
  {
    id: 'strategy',
    when: g('page-strategy'),
    steps: [
      {
        at: [g('nav-strategy')],
        title: () => L('Στρατηγικά', 'Strategy'),
        text: () =>
          L(
            'Στη στρατηγική σπάνια υπάρχει μία, αντικειμενικά καλύτερη κίνηση, γι’ αυτό οι ασκήσεις δεν της ταιριάζουν. Τη μαθαίνεις λοιπόν από σχολιασμένες παρτίδες μεγάλων παικτών του παρελθόντος, με ερωτήσεις στα κρίσιμα σημεία.',
            'In strategy there is rarely one objectively best move, so exercises suit it poorly. Instead, you learn it from annotated games of great players of the past, with questions at the key moments.',
          ),
      },
    ],
  },
  {
    id: 'bots',
    when: g('bots'),
    steps: [
      {
        at: [g('bots')],
        title: () => L('Παίξε με bots', 'Play bots'),
        text: () =>
          L(
            'Διάλεξε αντίπαλο στο επίπεδο που θέλεις, από αρχάριο ως πολύ δυνατό, και τον ρυθμό του παιχνιδιού. Ιδανικό για να δοκιμάσεις όσα μαθαίνεις.',
            'Pick an opponent at the level you want, from beginner to very strong, and the time control. A good way to try out what you learn.',
          ),
      },
    ],
  },
  {
    id: 'friend',
    when: g('friend'),
    steps: [
      {
        at: [g('friend')],
        title: () => L('Παίξε με φίλο', 'Play a friend'),
        text: () =>
          L(
            'Διάλεξε χρώμα και ρολόι και φτιάξε ένα link. Ο φίλος σου παίζει από τον browser (υπολογιστή ή κινητό) χωρίς Ruru και χωρίς λογαριασμό — ή προσκάλεσέ τον κατευθείαν από τη λίστα Φίλων. Στο τέλος κάνετε ρεβάνς ή ανάλυση.',
            'Pick colour and clock to create a link. Your friend plays right from their browser (computer or phone) with no Ruru and no account — or invite them straight from your Friends list. Afterwards, play a rematch or analyse the game.',
          ),
      },
    ],
  },
  {
    id: 'share',
    when: g('share'),
    steps: [
      {
        at: [g('share')],
        title: () => L('Κοινή ανάλυση', 'Shared analysis'),
        text: () =>
          L(
            'Αναλύστε μαζί μια παρτίδα, ζωντανά, με ένα link. Ο άλλος μπαίνει από τον browser του χωρίς λογαριασμό και βλέπει σε πραγματικό χρόνο κινήσεις, βαριάντες, βέλη, σχόλια και τη μηχανή σου. Υπάρχει επίσης κρυπτογραφημένος ήχος/κάμερα, chat και ενσωματωμένο βίντεο (YouTube, Twitch, Kick) «Για όλους» ή «Μόνο για μένα».',
            'Analyse a game together, live, with a link. Your guest joins from their browser with no account and sees moves, variations, arrows, comments and your engine in real time. Includes encrypted voice/camera, chat, and an embedded video panel (YouTube, Twitch, Kick) “For everyone” or “Only for me”.',
          ),
      },
    ],
  },
  {
    id: 'watch',
    when: g('watch'),
    steps: [
      {
        at: [g('watch')],
        title: () => L('Ζωντανά τουρνουά', 'Watch Live'),
        text: () =>
          L(
            'Παρακολούθησε ζωντανές παρτίδες από μεγάλα τουρνουά σε όλο τον κόσμο, με πραγματικά ρολόγια. Άνοιξε οποιαδήποτε παρτίδα για δική σου ανάλυση με Stockfish, αποθήκευσέ τη στη βάση σου ή ξεκίνα με ένα κλικ Κοινή ανάλυση με φίλους.',
            'Follow live games from major tournaments worldwide with real clocks. Open any game for local Stockfish analysis, save it to your database, or launch a Shared analysis with friends in one click.',
          ),
      },
    ],
  },
  {
    id: 'prep',
    when: g('prep'),
    steps: [
      {
        at: [g('prep')],
        title: () => L('Προετοιμασία για αντίπαλο', 'Prepare for opponent'),
        text: () =>
          L(
            'Φτιάξε φάκελο αντιπάλου συνδυάζοντας τοπικές βάσεις (FIDE/OTB) με προφίλ Lichess και Chess.com. Δες σκορ με λευκά και μαύρα, Elo και διαδραστικό δέντρο ανοιγμάτων για να βρεις τι παίζει και πού δυσκολεύεται.',
            'Build an opponent dossier combining local databases (FIDE/OTB) with Lichess and Chess.com profiles. See White and Black scores, Elo, and an interactive opening tree to spot what they play and where they struggle.',
          ),
      },
    ],
  },
  {
    id: 'books',
    when: g('books'),
    steps: [
      {
        at: [g('books-pick'), g('books')],
        title: () => L('Βιβλίο σε βάση', 'Book to database'),
        text: () =>
          L(
            'Έχεις σκακιστικό βιβλίο σε PDF; Διάλεξέ το εδώ και γίνεται βάση: κάθε παρτίδα με τις βαριάντες και τα σχόλιά της, έτοιμη για μελέτη στη σκακιέρα. Τα ψηφιακά PDF δίνουν το καλύτερο αποτέλεσμα· υποστηρίζονται πειραματικά και σκαναρισμένα με OCR.',
            'Have a chess book as a PDF? Pick it here and it becomes a database: every game with its variations and comments, ready to study on the board. Digital PDFs give the best results; scanned pages are also supported experimentally via OCR.',
          ),
      },
    ],
  },
  {
    id: 'board',
    when: g('board-tools'),
    steps: [
      {
        at: [g('board-tools')],
        title: () => L('Σκακιέρα & εργαλεία ανάλυσης', 'Board & analysis tools'),
        text: () =>
          L(
            'Από εδώ στήνεις θέση, κάνεις «Εκπαίδευση» (κρύβει τις επόμενες κινήσεις), ξεκινάς «Κοινή ανάλυση» ή ανοίγεις «Βίντεο» δίπλα στη σκακιέρα. Στο «Περισσότερα» θα βρεις πλήρη έλεγχο λαθών και εξαγωγή, ενώ κάτω τη μηχανή Stockfish και την Αναφορά ανοιγμάτων.',
            'From here you can set up a position, use “Training” (hides upcoming moves), start “Shared analysis”, or open “Video” beside the board. Under “More” you’ll find full blunder check and export, and below are Stockfish and the Opening reference.',
          ),
      },
    ],
  },
];

/**
 * Το πρώτο στοιχείο του επιλογέα που φαίνεται στην οθόνη. Με `onTop` (για τα σημεία) και ότι δεν είναι κομμένο
 * από γονέα με overflow ή σκεπασμένο: στο σημείο του βρίσκεται το ίδιο (ή το παραθυράκι μας).
 */
function shown(sel: string, onTop = false): Element | null {
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight)) continue;
    if (onTop) {
      const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 12)));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el.contains(hit) || hit.closest('.guide-pop'))) continue;
    }
    return el;
  }
  return null;
}

const WIDTH = 320;
const GAP = 12;

interface Place {
  key: string;
  topic: Topic;
  step: number;
  /** ο επιλογέας του σημείου: το παραθυράκι μένει σε αυτό όσο φαίνεται */
  sel: string;
  /** πλαίσιο γύρω από το σημείο */
  ring: { left: number; top: number; width: number; height: number };
  left: number;
  /** κάτω από το σημείο (top) ή πάνω από αυτό (bottom) */
  top?: number;
  bottom?: number;
  arrow: number;
}

/** Το σημείο στην οθόνη· για επικεφαλίδες (block, όλο το πλάτος) μόνο το κείμενό τους. */
function rectOf(el: Element): DOMRect {
  if (getComputedStyle(el).display !== 'block') return el.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return r.width > 0 ? r : el.getBoundingClientRect();
}

function placeAt(topic: Topic, step: number, sel: string, el: Element): Place {
  const r = rectOf(el);
  const below = r.bottom + GAP + 220 < window.innerHeight || r.top < 240;
  const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, r.left + r.width / 2 - WIDTH / 2));
  return {
    key: `${topic.id}:${step}:${sel}:${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`,
    topic,
    step,
    sel,
    ring: { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 },
    left,
    ...(below ? { top: r.bottom + GAP } : { bottom: window.innerHeight - r.top + GAP }),
    arrow: Math.max(18, Math.min(WIDTH - 18, r.left + r.width / 2 - left)),
  };
}

export function Guide() {
  const state = (useApp((s) => (s.settings?.ui as Record<string, unknown> | undefined)?.guide) ?? {}) as GuideState;
  const seen = state.seen ?? [];
  const off = state.off === true;
  // σε ποιο βήμα είναι κάθε θέμα με πολλά βήματα (μόνο σε αυτή τη συνεδρία)
  const steps = useRef(new Map<string, number>());
  const [place, setPlace] = useState<Place | null>(null);
  const [bump, setBump] = useState(0);
  const current = useRef<Place | null>(null);
  current.current = place;

  const finish = (topic: Topic) => {
    steps.current.delete(topic.id);
    current.current = null;
    setPlace(null);
    const ui = (useApp.getState().settings?.ui as Record<string, unknown> | undefined) ?? {};
    const now = (ui.guide ?? {}) as GuideState;
    setUiLater({ guide: { ...now, seen: [...new Set([...(now.seen ?? []), topic.id])] } });
  };
  const advance = (topic: Topic, step: number) => {
    if (step >= topic.steps.length - 1) return finish(topic);
    steps.current.set(topic.id, step + 1);
    current.current = null;
    setPlace(null);
    setBump((b) => b + 1);
  };

  useEffect(() => {
    if (off) {
      steps.current.clear();
      setPlace(null);
      return;
    }
    const tick = () => {
      // όχι πάνω από διαλόγους (το θέμα συνεχίζει όταν κλείσουν)
      if (shown('.modal-backdrop, .win-backdrop')) {
        current.current = null;
        return setPlace(null);
      }
      // το παραθυράκι που φαίνεται μένει στο σημείο του· αν αυτό έφυγε στο τελευταίο βήμα, ο χρήστης προχώρησε
      const was = current.current;
      if (was && !seen.includes(was.topic.id)) {
        const el = shown(was.topic.when) && shown(was.sel, true);
        if (el) return setPlace((p) => (p?.key === placeAt(was.topic, was.step, was.sel, el).key ? p : placeAt(was.topic, was.step, was.sel, el)));
        if (was.step === was.topic.steps.length - 1) return finish(was.topic);
      }
      for (const topic of TOPICS) {
        if (seen.includes(topic.id) || !shown(topic.when)) continue;
        const k = steps.current.get(topic.id) ?? 0;
        for (const sel of topic.steps[k].at) {
          const el = shown(sel, true);
          if (el) return setPlace(placeAt(topic, k, sel, el));
        }
      }
      setPlace(null);
    };
    tick();
    const timer = setInterval(tick, 400);
    window.addEventListener('resize', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off, seen.join('|'), bump]);

  // κλικ στο ίδιο το σημείο (π.χ. στη «Νέα βάση»): το βήμα έγινε
  const placeKey = place ? `${place.topic.id}:${place.step}:${place.sel}` : '';
  useEffect(() => {
    const p = current.current;
    const el = p && shown(p.sel, true);
    if (!p || !el) return;
    const fn = () => advance(p.topic, p.step);
    el.addEventListener('click', fn, true);
    return () => el.removeEventListener('click', fn, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  if (!place) return null;
  const { topic, step } = place;
  const s = topic.steps[step];
  const last = step === topic.steps.length - 1;
  return (
    <>
      <div className="guide-ring" style={place.ring} aria-hidden />
      <div
        className={`guide-pop ${place.top !== undefined ? 'below' : 'above'}`}
        style={{ left: place.left, top: place.top, bottom: place.bottom, width: WIDTH, ['--arrow' as string]: `${place.arrow}px` }}
        role="dialog"
        aria-label={s.title()}
      >
        <button className="guide-x" onClick={() => finish(topic)} aria-label={L('Κλείσιμο', 'Close')} title={L('Κλείσιμο', 'Close')}>
          <X size={14} />
        </button>
        <b className="guide-title">{s.title()}</b>
        <p className="guide-text">{s.text()}</p>
        <div className="guide-foot">
          <button
            className="guide-off"
            title={L('Κλείνει όλο τον οδηγό — το «?» πάνω δεξιά τον ξανανοίγει όποτε θέλεις', 'Skips the entire tutorial — click “?” at the top right to restart anytime')}
            onClick={() => setUiLater({ guide: { ...state, off: true } })}
          >
            {L('Παράλειψη οδηγού', 'Skip tutorial')}
          </button>
          {topic.steps.length > 1 && (
            <span className="faint tnum">
              {step + 1} / {topic.steps.length}
            </span>
          )}
          <button className="primary" onClick={() => advance(topic, step)}>
            {last ? L('Κατάλαβα', 'Got it') : L('Επόμενο', 'Next')}
          </button>
        </div>
      </div>
    </>
  );
}

/** «?» της πάνω γραμμής: οι συμβουλές από την αρχή. */
export function restartGuide(): void {
  setUiLater({ guide: { seen: [], off: false } });
}
