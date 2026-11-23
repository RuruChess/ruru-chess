/** Λύση ενός puzzle: η πρώτη κίνηση του αντιπάλου παίζεται με κίνηση στη σκακιέρα, κάθε ματ γίνεται δεκτό, υπόδειξη σε τρία βήματα, «γιατί ήταν λάθος», λύση βήμα βήμα και καταγραφή της προσπάθειας (μία φορά: η αποτυχία γράφεται αμέσως, όπως στο Lichess, ώστε να μη «σβήνεται» με κλείσιμο). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAnswer } from '../../core/puzzle.ts';
import { playMoveSound, playSound, type MoveSound } from '../sounds.ts';
import { L } from '../i18n.ts';
import { reportError } from '../store.ts';
import { tacticsApi, type AttemptResult, type EngineLine, type Hint, type Puzzle, type Refutation } from './api.ts';
import { fenAt, firstSolverPly, moveCode, playUci } from './logic.ts';
import { MATE_CP, evalLabel, gameStatus, hintFromUci, keepsGoal, practiceGoal, sanOf, solverEval, type PracticeGoal } from './practice.ts';
import { keepsLessonGoal, lessonOf } from './lesson.ts';
import { lineNotes, subLines, type SubLine } from './variations.ts';

export type Phase = 'intro' | 'play' | 'opp' | 'done';

export interface WrongMove {
  uci: string;
  san: string;
  /** ημικίνηση της γραμμής όπου παίχτηκε */
  ply: number;
  /** θέση μετά τη λάθος κίνηση */
  fen: string;
  move: number;
}

/** Θέση χωρίς λύση στα δεδομένα: παιχνίδι με τη μηχανή, που κρίνει κάθε κίνηση. */
export interface PracticeInfo {
  goal: PracticeGoal;
  /** αξιολόγηση για τον λύτη πριν από την κίνησή του (null: άγνωστη) */
  base: number | null;
  /** η καλύτερη κίνηση της μηχανής στην τρέχουσα θέση (για την υπόδειξη) */
  best: string | null;
  /** σωστές κινήσεις του λύτη και πόσες χρειάζονται */
  done: number;
  target: number;
  thinking: boolean;
  /** μήνυμα για την τελευταία κίνηση */
  note: { ok: boolean; text: string } | null;
  /** υπάρχει μηχανή (αλλιώς οι κινήσεις δεν κρίνονται) */
  engine: boolean;
  /** η ανάλυση μετά την τελευταία λάθος κίνηση (για το «Γιατί;») */
  refutation: Refutation | null;
  /** οι βαριάντες της μηχανής από τη «Λύση» */
  lines: EngineLine[] | null;
}

/** Χωρίς γραμμή λύσης: η θέση παίζεται με τη μηχανή. */
export const isPractice = (p: Puzzle): boolean => p.kind === 'practice' || p.moves.length === 0;

export interface SessionState {
  p: Puzzle;
  /** παιχνίδι με τη μηχανή (null: κανονικό puzzle με λύση) */
  practice: PracticeInfo | null;
  /** οι υποβαριάντες της λύσης της πηγής που μένουν (άμυνες του αντιπάλου): παίζονται μετά την κύρια γραμμή */
  subs: SubLine[];
  /** η υποβαριάντα που παίζεται τώρα */
  sub: { label: string; n: number; total: number } | null;
  /** η κύρια γραμμή όπως τελείωσε: ξαναφαίνεται στο τέλος */
  mainDone: { p: Puzzle; fen: string; last?: number; played: string[]; sans: string[]; misses: Array<{ ply: number; san: string }>; ply: number; notes: string[] } | null;
  /** μάθημα: τα σχόλια της γραμμής που παίζεται, ένα ανά ημικίνηση */
  notes: string[];
  /** μάθημα: άλλη κίνηση που κρατά κι αυτή το αποτέλεσμα (δεν μετρά λάθος, ζητείται η κίνηση του μαθήματος) */
  alt: { san: string } | null;
  /** μάθημα: η μηχανή κρίνει μια κίνηση εκτός λύσης */
  checking: boolean;
  /** επόμενη ημικίνηση του λύτη στη γραμμή */
  ply: number;
  /** θέση της σκακιέρας */
  fen: string;
  last?: number;
  phase: Phase;
  /** επίπεδα υπόδειξης που φάνηκαν για την τρέχουσα κίνηση (0–3) */
  hint: number;
  /** υποδείξεις σε όλο το puzzle (για την καταγραφή) */
  hintsUsed: number;
  hintInfo: Hint | null;
  mistakes: number;
  firstWrong: string | null;
  /** η τελευταία λάθος κίνηση (για το «γιατί») */
  wrong: WrongMove | null;
  /** η σκακιέρα δείχνει για λίγο τη λάθος κίνηση */
  flash: boolean;
  revealed: boolean;
  /** η τελευταία κίνηση του χρήστη ήταν σωστή (μήνυμα «συνέχισε») */
  good: boolean;
  /** οι κινήσεις που παίχτηκαν στη σκακιέρα από την αρχική θέση (χωρίς τις λάθος) */
  played: string[];
  sans: string[];
  /** λάθος κινήσεις ανά ημικίνηση (για τη γραμμή της λύσης) */
  misses: Array<{ ply: number; san: string }>;
  startedAt: number;
  endedAt: number | null;
}

export interface SessionOptions {
  /** τρόπος της προσπάθειας (rated, review, woodpecker, daily, replay, casual) */
  mode: string;
  deck?: number;
  cycle?: number;
  angle?: string[];
  sounds: boolean;
  /** η κίνηση του αντιπάλου στην αρχή (ms) */
  introMs?: number;
  /** απάντηση του αντιπάλου μετά από σωστή κίνηση (ms) */
  replyMs?: number;
  onResult?: (r: AttemptResult, win: boolean) => void;
}

export interface Session {
  s: SessionState | null;
  result: AttemptResult | null;
  /** το αποτέλεσμα που γράφτηκε (null: τίποτα ακόμη) */
  outcome: 'win' | 'loss' | null;
  refute: { loading: boolean; data: Refutation | null; open: boolean };
  load: (p: Puzzle) => void;
  move: (uci: string) => void;
  hint: () => void;
  reveal: () => void;
  /** παράλειψη / εγκατάλειψη: μετρά ως αποτυχία αν δεν έχει γραφτεί αποτέλεσμα */
  giveUp: () => Promise<void>;
  whyWrong: () => void;
  closeRefute: () => void;
}

const moveSound = (on: boolean, san: string) => {
  if (on) playMoveSound(san);
};
const sound = (on: boolean, k: MoveSound) => {
  if (on) playSound(k);
};

export function usePuzzleSession(opts: SessionOptions): Session {
  const [s, setS] = useState<SessionState | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [outcome, setOutcome] = useState<'win' | 'loss' | null>(null);
  const [refute, setRefute] = useState<Session['refute']>({ loading: false, data: null, open: false });
  const ref = useRef<SessionState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const recorded = useRef<string | null>(null);
  const loadSeq = useRef(0);

  const clear = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => clear, []);

  const update = useCallback((fn: (x: SessionState) => SessionState) => {
    const cur = ref.current;
    if (!cur) return;
    const next = fn(cur);
    ref.current = next;
    setS(next);
  }, []);

  /** Καταγραφή της προσπάθειας (μία φορά ανά puzzle). */
  const record = useCallback(async (win: boolean): Promise<void> => {
    const cur = ref.current;
    if (!cur || recorded.current === cur.p.id) return;
    recorded.current = cur.p.id;
    setOutcome(win ? 'win' : 'loss');
    const o = optsRef.current;
    try {
      const r = await tacticsApi.attempt({
        id: cur.p.id,
        mode: o.mode,
        win,
        ms: (cur.endedAt ?? Date.now()) - cur.startedAt,
        hints: cur.hintsUsed,
        wrong: cur.firstWrong,
        angle: o.angle?.length ? o.angle : undefined,
        deck: o.deck,
        cycle: o.cycle,
      });
      if (ref.current?.p.id === cur.p.id) setResult(r);
      o.onResult?.(r, win);
    } catch (e) {
      reportError(e);
    }
  }, []);

  const finish = useCallback(
    (x: SessionState): SessionState => {
      const done = { ...x, phase: 'done' as Phase, endedAt: x.endedAt ?? Date.now(), good: false, flash: false };
      // λύθηκε χωρίς λάθος και χωρίς να δει τη λύση: νίκη (με υπόδειξη μετρά ως ήττα στον βαθμό)
      if (recorded.current !== x.p.id) {
        const win = x.mistakes === 0 && !x.revealed;
        queueMicrotask(() => void record(win));
      }
      return done;
    },
    [record],
  );

  /** Η κύρια γραμμή όπως ήταν (για την οθόνη του τέλους). */
  const restoreMain = (x: SessionState): SessionState =>
    x.mainDone ? { ...x, p: x.mainDone.p, fen: x.mainDone.fen, last: x.mainDone.last, played: x.mainDone.played, sans: x.mainDone.sans, misses: x.mainDone.misses, ply: x.mainDone.ply, notes: x.mainDone.notes } : x;
  const snapshot = (x: SessionState): NonNullable<SessionState['mainDone']> => x.mainDone ?? { p: x.p, fen: x.fen, last: x.last, played: x.played, sans: x.sans, misses: x.misses, ply: x.ply, notes: x.notes };

  /**
   * Μια γραμμή λύθηκε: πίσω στην επόμενη υποβαριάντα της πηγής (η άμυνα του αντιπάλου παίζεται στη σκακιέρα
   * και ο λύτης βρίσκει τη συνέχεια)· όταν τελειώσουν όλες, τέλος με την κύρια γραμμή στην οθόνη.
   */
  const advance = useCallback(
    (x: SessionState): SessionState => {
      if (!x.subs.length || x.revealed) return finish(restoreMain(x));
      const [next, ...rest] = x.subs;
      const n = (x.sub?.n ?? 0) + 1;
      const total = x.sub?.total ?? x.subs.length;
      const main = snapshot(x);
      const st: SessionState = { ...x, p: { ...main.p, fen: next.fen, moves: next.moves, pre: true }, fen: next.fen, last: undefined, ply: 1, phase: 'intro', played: [], sans: [], misses: [], hint: 0, hintInfo: null, wrong: null, flash: false, good: false, subs: rest, sub: { label: next.label, n, total }, mainDone: main, notes: next.notes, alt: null };
      later(1600, () => {
        const y = ref.current;
        if (!y || y.p.id !== x.p.id || y.sub?.n !== n || y.phase !== 'intro') return;
        const r = playUci(y.fen, next.moves[0]);
        if (!r) return;
        moveSound(optsRef.current.sounds, r.san);
        const z: SessionState = { ...y, fen: r.fen, last: r.move, phase: 'play', played: [next.moves[0]], sans: [r.san] };
        ref.current = z;
        setS(z);
      });
      return st;
    },
    [finish],
  );

  /** «Λύση»: και οι υποβαριάντες που μένουν παίζονται μόνες τους, μία μία, πριν από το τέλος. */
  const revealSubs = useCallback(
    (x: SessionState): SessionState => {
      if (!x.subs.length) return finish(restoreMain(x));
      const [next, ...rest] = x.subs;
      const n = (x.sub?.n ?? 0) + 1;
      const total = x.sub?.total ?? x.subs.length;
      const main = snapshot(x);
      const st: SessionState = { ...x, p: { ...main.p, fen: next.fen, moves: next.moves, pre: true }, fen: next.fen, last: undefined, ply: 0, phase: 'opp', played: [], sans: [], misses: [], hint: 0, hintInfo: null, wrong: null, flash: false, good: false, subs: rest, sub: { label: next.label, n, total }, mainDone: main, notes: next.notes, alt: null };
      next.moves.forEach((u, i) => {
        later(900 + i * 520, () => {
          const y = ref.current;
          if (!y || y.p.id !== x.p.id || y.sub?.n !== n) return;
          const r = playUci(y.fen, u);
          if (!r) return;
          moveSound(optsRef.current.sounds, r.san);
          const z: SessionState = { ...y, fen: r.fen, last: r.move, played: [...y.played, u], sans: [...y.sans, r.san], ply: i + 1 };
          ref.current = z;
          setS(z);
          if (i === next.moves.length - 1)
            later(1200, () => {
              const w = ref.current;
              if (!w || w.p.id !== x.p.id || w.sub?.n !== n) return;
              ref.current = revealSubs(w);
              setS(ref.current);
            });
        });
      });
      return st;
    },
    [finish],
  );

  const load = useCallback(
    (p: Puzzle) => {
      clear();
      const seq = ++loadSeq.current;
      recorded.current = null;
      setResult(null);
      setOutcome(null);
      setRefute({ loading: false, data: null, open: false });
      const prac = isPractice(p);
      const first = prac ? 0 : firstSolverPly(p);
      const lesson = lessonOf(p);
      const sol = lesson ? lesson.solution : typeof p.meta?.solution === 'string' ? p.meta.solution : '';
      const init: SessionState = {
        p,
        subs: prac ? [] : subLines(p.fen, sol, p.color),
        sub: null,
        mainDone: null,
        notes: lesson ? lineNotes(p.fen, sol) : [],
        alt: null,
        checking: false,
        practice: prac ? { goal: practiceGoal(p, null), base: null, best: null, done: 0, target: 10, thinking: true, note: null, engine: true, refutation: null, lines: null } : null,
        ply: first,
        fen: p.fen,
        phase: first || prac ? 'intro' : 'play',
        hint: 0,
        hintsUsed: 0,
        hintInfo: null,
        mistakes: 0,
        firstWrong: null,
        wrong: null,
        flash: false,
        revealed: false,
        good: false,
        played: [],
        sans: [],
        misses: [],
        startedAt: Date.now(),
        endedAt: null,
      };
      ref.current = init;
      setS(init);
      if (prac) {
        tacticsApi
          .engine(p.fen, 1, 900)
          .then((r) => {
            if (seq !== loadSeq.current) return;
            const base = solverEval(r.lines[0], p.color === 'white');
            const goal = practiceGoal(p, base);
            update((x) => ({ ...x, phase: 'play', startedAt: Date.now(), practice: { ...x.practice!, goal, target: goal === 'win' ? 10 : 8, base, best: r.lines[0]?.uci[0] ?? null, thinking: false, engine: r.engine } }));
          })
          .catch((e) => {
            reportError(e);
            if (seq === loadSeq.current) update((x) => ({ ...x, phase: 'play', practice: { ...x.practice!, thinking: false, engine: false } }));
          });
        return;
      }
      if (!first) return;
      // η κίνηση του αντιπάλου, με κίνηση στη σκακιέρα
      later(optsRef.current.introMs ?? 550, () => {
        if (seq !== loadSeq.current) return;
        const r = playUci(p.fen, p.moves[0]);
        if (!r) return;
        moveSound(optsRef.current.sounds, r.san);
        update((x) => ({ ...x, fen: r.fen, last: r.move, phase: 'play', played: [p.moves[0]], sans: [r.san], startedAt: Date.now() }));
      });
    },
    [update],
  );

  /** Κίνηση σε θέση χωρίς λύση: η μηχανή κρίνει αν κρατά τον στόχο και απαντά για τον αντίπαλο. */
  const practiceMove = useCallback(
    (x: SessionState, uci: string) => {
      const pr = x.practice!;
      const mine = playUci(x.fen, uci);
      if (!mine) return;
      const o = optsRef.current;
      moveSound(o.sounds, mine.san);
      if (!pr.engine) {
        // χωρίς μηχανή: η κίνηση γίνεται δεκτή χωρίς κρίση
        update((y) => ({ ...y, fen: mine.fen, last: mine.move, played: [...y.played, uci], sans: [...y.sans, mine.san], ply: y.ply + 1 }));
        return;
      }
      const id = x.p.id;
      const solverWhite = x.p.color === 'white';
      const status = gameStatus(mine.fen);
      const moving: SessionState = { ...x, fen: mine.fen, last: mine.move, phase: 'opp', hint: 0, hintInfo: null, flash: false, good: false, practice: { ...pr, thinking: true, note: null } };
      ref.current = moving;
      setS(moving);
      const ask = status === 'ongoing' ? tacticsApi.engine(mine.fen, 1, 700) : Promise.resolve({ engine: true, lines: [] as EngineLine[] });
      ask
        .then((r) => {
          const y = ref.current;
          if (!y || y.p.id !== id) return;
          const line = r.lines[0];
          const v = status === 'checkmate' ? MATE_CP : status === 'ongoing' ? solverEval(line, solverWhite) : 0;
          if (!keepsGoal(pr.goal, pr.base, v)) {
            // λάθος: η κίνηση πάει πίσω και η πρώτη αποτυχία γράφεται
            sound(o.sounds, 'error');
            const wrong: WrongMove = { uci, san: mine.san, ply: x.ply, fen: mine.fen, move: mine.move };
            const mateIn = v !== null && Math.abs(v) >= MATE_CP - 1000 ? Math.sign(v) * Math.max(1, Math.round((MATE_CP - Math.abs(v)) / 10)) : null;
            const refutation: Refutation = {
              played: mine.san,
              expected: pr.best,
              expectedSan: pr.best ? sanOf(x.fen, pr.best) : null,
              fen: mine.fen,
              engine: Boolean(line),
              reply: line?.uci[0] ?? null,
              replySan: line?.san[0] ?? null,
              line: line?.san ?? [],
              lineUci: line?.uci ?? [],
              cp: mateIn === null ? v : null,
              mate: mateIn,
              depth: line?.depth ?? null,
            };
            const text =
              status === 'ongoing'
                ? L(`Το ${mine.san} χαλάει τη θέση: ${evalLabel(pr.base)} → ${evalLabel(v)}. Δοκίμασε άλλη κίνηση.`, `${mine.san} spoils the position: ${evalLabel(pr.base)} → ${evalLabel(v)}. Try another move.`)
                : L(`Το ${mine.san} δίνει ισοπαλία, ενώ η θέση κερδίζεται. Δοκίμασε άλλη κίνηση.`, `${mine.san} gives away a draw in a winning position. Try another move.`);
            const back: SessionState = { ...y, fen: x.fen, last: x.last, phase: 'play', mistakes: y.mistakes + 1, firstWrong: y.firstWrong ?? uci, wrong, flash: true, misses: [...y.misses, { ply: x.ply, san: mine.san }], practice: { ...pr, thinking: false, note: { ok: false, text }, refutation } };
            ref.current = back;
            setS(back);
            void record(false);
            later(900, () => update((z) => (z.wrong === wrong ? { ...z, flash: false } : z)));
            return;
          }
          const done = pr.done + 1;
          const played = [...x.played, uci];
          const sans = [...x.sans, mine.san];
          if (status !== 'ongoing' || done >= pr.target) {
            const text =
              status === 'checkmate'
                ? L('Ματ!', 'Checkmate!')
                : status !== 'ongoing'
                  ? L('Η παρτίδα τελείωσε ισόπαλη: ο στόχος κρατήθηκε.', 'The game ended in a draw: the goal was kept.')
                  : pr.goal === 'win'
                    ? L(`Κράτησες τη νίκη για ${done} κινήσεις (${evalLabel(v)}).`, `You kept the win for ${done} moves (${evalLabel(v)}).`)
                    : pr.goal === 'draw'
                      ? L(`Κράτησες την ισοπαλία για ${done} κινήσεις (${evalLabel(v)}).`, `You held the draw for ${done} moves (${evalLabel(v)}).`)
                      : L(`Αμύνθηκες σωστά για ${done} κινήσεις (${evalLabel(v)}).`, `You defended well for ${done} moves (${evalLabel(v)}).`);
            const fin = finish({ ...y, fen: mine.fen, last: mine.move, played, sans, ply: x.ply + 1, good: true, practice: { ...pr, done, base: v, thinking: false, note: { ok: true, text }, refutation: null } });
            ref.current = fin;
            setS(fin);
            later(120, () => sound(o.sounds, 'success'));
            return;
          }
          const goodText = pr.goal === 'win' ? L(`Καλά: η θέση μένει κερδισμένη (${evalLabel(v)}).`, `Good: the position stays winning (${evalLabel(v)}).`) : pr.goal === 'draw' ? L(`Καλά: η θέση κρατιέται (${evalLabel(v)}).`, `Good: the position holds (${evalLabel(v)}).`) : L(`Καλά: η καλύτερη άμυνα (${evalLabel(v)}).`, `Good: the best defence (${evalLabel(v)}).`);
          const waiting: SessionState = { ...y, fen: mine.fen, last: mine.move, played, sans, ply: x.ply + 1, good: true, practice: { ...pr, done, base: v, thinking: false, note: { ok: true, text: goodText }, refutation: null } };
          ref.current = waiting;
          setS(waiting);
          const reply = line?.uci[0];
          if (!reply) {
            ref.current = finish(waiting);
            setS(ref.current);
            return;
          }
          later(o.replyMs ?? 380, () => {
            const z = ref.current;
            if (!z || z.p.id !== id) return;
            const rr = playUci(z.fen, reply);
            if (!rr) return;
            moveSound(o.sounds, rr.san);
            const nx: SessionState = { ...z, fen: rr.fen, last: rr.move, played: [...z.played, reply], sans: [...z.sans, rr.san], ply: z.ply + 1, phase: 'play', practice: { ...z.practice!, best: line?.uci[1] ?? null } };
            ref.current = gameStatus(rr.fen) === 'ongoing' ? nx : finish(nx);
            setS(ref.current);
          });
        })
        .catch((e) => {
          reportError(e);
          update((y) => (y.p.id === id ? { ...y, fen: x.fen, last: x.last, phase: 'play', practice: { ...pr, thinking: false } } : y));
        });
    },
    [finish, record, update],
  );

  const move = useCallback(
    (uci: string) => {
      const x = ref.current;
      if (!x || x.phase !== 'play') return;
      setRefute((r) => (r.open ? { ...r, open: false } : r));
      if (x.practice) {
        practiceMove(x, uci);
        return;
      }
      let c: ReturnType<typeof checkAnswer>;
      try {
        c = checkAnswer(x.p.fen, x.p.moves, x.ply, uci);
      } catch (e) {
        reportError(e);
        return;
      }
      if (c.illegal) return;
      const mine = playUci(x.fen, c.uci);
      if (!mine) return;
      const o = optsRef.current;
      if (c.result === 'incorrect') {
        const miss = () => {
          sound(o.sounds, 'error');
          const wrong: WrongMove = { uci: c.uci, san: c.san, ply: x.ply, fen: mine.fen, move: mine.move };
          update((y) => ({ ...y, mistakes: y.mistakes + 1, firstWrong: y.firstWrong ?? c.uci, wrong, flash: true, good: false, alt: null, misses: [...y.misses, { ply: y.ply, san: c.san }] }));
          // η πρώτη αποτυχία γράφεται αμέσως (ο χρήστης μπορεί να συνεχίσει να ψάχνει)
          void record(false);
          later(900, () => update((y) => (y.wrong === wrong ? { ...y, flash: false } : y)));
        };
        const lesson = lessonOf(x.p);
        if (!lesson) {
          miss();
          return;
        }
        // μάθημα: κι άλλες κινήσεις μπορεί να κρατούν το αποτέλεσμα· η μηχανή κρίνει πριν μετρήσει λάθος
        moveSound(o.sounds, c.san);
        update((y) => ({ ...y, phase: 'opp', checking: true, wrong: { uci: c.uci, san: c.san, ply: x.ply, fen: mine.fen, move: mine.move }, flash: true, good: false, alt: null }));
        const judged = (keeps: boolean) => {
          const y = ref.current;
          if (!y || y.p !== x.p || y.ply !== x.ply || !y.checking) return;
          if (keeps) {
            update((z) => ({ ...z, phase: 'play', checking: false, wrong: null, flash: false, alt: { san: c.san } }));
            return;
          }
          update((z) => ({ ...z, phase: 'play', checking: false, flash: false }));
          miss();
        };
        tacticsApi
          .engine(mine.fen, 1, 700)
          .then((r) => judged(r.engine && keepsLessonGoal(lesson.goal, solverEval(r.lines[0], x.p.color === 'white'))))
          .catch((e) => {
            reportError(e);
            judged(false);
          });
        return;
      }
      moveSound(o.sounds, c.san);
      const afterMine: SessionState = { ...x, fen: mine.fen, last: mine.move, played: [...x.played, c.uci], sans: [...x.sans, c.san], flash: false, good: true, alt: null, hint: 0, hintInfo: null };
      if (!c.reply) {
        // λύθηκε (ματ ή τέλος της γραμμής): η επόμενη υποβαριάντα ή τέλος
        ref.current = advance({ ...afterMine, ply: c.next });
        setS(ref.current);
        later(120, () => sound(o.sounds, 'success'));
        return;
      }
      ref.current = { ...afterMine, phase: 'opp' };
      setS(ref.current);
      const reply = c.reply;
      later(o.replyMs ?? 380, () => {
        const y = ref.current;
        if (!y || y.p.id !== x.p.id) return;
        const r = playUci(y.fen, reply);
        if (!r) return;
        moveSound(o.sounds, r.san);
        const next: SessionState = { ...y, fen: r.fen, last: r.move, ply: c.next, played: [...y.played, reply], sans: [...y.sans, r.san], phase: 'play' };
        if (c.result === 'solved') {
          ref.current = advance(next);
          setS(ref.current);
          later(120, () => sound(o.sounds, 'success'));
        } else {
          ref.current = next;
          setS(next);
        }
      });
    },
    [advance, practiceMove, record, update],
  );

  const hint = useCallback(() => {
    const x = ref.current;
    if (!x || x.phase !== 'play' || x.hint >= 3) return;
    const level = x.hint + 1;
    if (x.sub) {
      // υποβαριάντα: η υπόδειξη από τη γραμμή της πηγής
      const exp = x.p.moves[x.ply];
      const h = exp ? hintFromUci(x.fen, exp, level as 1 | 2 | 3) : null;
      if (!h) return;
      update((z) => ({ ...z, hint: Math.max(z.hint, level), hintsUsed: z.hintsUsed + (level > z.hint ? 1 : 0), hintInfo: h }));
      if (level === 3) later(250, () => move(exp));
      return;
    }
    if (x.practice) {
      // υπόδειξη από την καλύτερη κίνηση της μηχανής (κομμάτι, τετράγωνο, κίνηση)
      const give = (best: string) => {
        const y = ref.current;
        if (!y || y.fen !== x.fen) return;
        const h = hintFromUci(x.fen, best, level as 1 | 2 | 3);
        if (!h) return;
        update((z) => ({ ...z, hint: Math.max(z.hint, level), hintsUsed: z.hintsUsed + (level > z.hint ? 1 : 0), hintInfo: h }));
        if (level === 3) later(250, () => move(best));
      };
      if (x.practice.best) give(x.practice.best);
      else
        tacticsApi
          .engine(x.fen, 1, 700)
          .then((r) => {
            const b = r.lines[0]?.uci[0];
            if (!b) return;
            update((z) => (z.fen === x.fen ? { ...z, practice: { ...z.practice!, best: b } } : z));
            give(b);
          })
          .catch(reportError);
      return;
    }
    const id = x.p.id;
    const ply = x.ply;
    tacticsApi
      .hint(id, ply, level)
      .then((h) => {
        const y = ref.current;
        if (!y || y.p.id !== id || y.ply !== ply) return;
        update((z) => ({ ...z, hint: Math.max(z.hint, level), hintsUsed: z.hintsUsed + (level > z.hint ? 1 : 0), hintInfo: h }));
        // τρίτο βήμα: η κίνηση παίζεται στη σκακιέρα
        if (level === 3 && h.uci) later(250, () => move(h.uci!));
      })
      .catch(reportError);
  }, [move, update]);

  const reveal = useCallback(() => {
    const x = ref.current;
    if (!x || x.phase === 'done' || x.phase === 'intro') return;
    clear();
    setRefute({ loading: false, data: null, open: false });
    const revealed: SessionState = { ...x, phase: 'opp', revealed: true, flash: false, good: false, hintInfo: null, endedAt: Date.now(), practice: x.practice ? { ...x.practice, thinking: true, note: null } : null };
    ref.current = revealed;
    setS(revealed);
    void record(false);
    const o = optsRef.current;
    if (x.practice) {
      tacticsApi
        .engine(x.fen, 3, 1500)
        .then((r) => {
          const y = ref.current;
          if (!y || y.p.id !== x.p.id) return;
          const main = r.lines[0]?.uci.slice(0, 8) ?? [];
          const withLines: SessionState = { ...y, practice: { ...y.practice!, thinking: false, lines: r.lines } };
          ref.current = main.length ? withLines : finish(withLines);
          setS(ref.current);
          main.forEach((u, i) => {
            later(250 + i * 520, () => {
              const z = ref.current;
              if (!z || z.p.id !== x.p.id) return;
              const rr = playUci(z.fen, u);
              if (!rr) return;
              moveSound(o.sounds, rr.san);
              const nx: SessionState = { ...z, fen: rr.fen, last: rr.move, played: [...z.played, u], sans: [...z.sans, rr.san], ply: z.ply + 1, phase: 'opp' };
              ref.current = i === main.length - 1 ? finish(nx) : nx;
              setS(ref.current);
            });
          });
        })
        .catch((e) => {
          reportError(e);
          const y = ref.current;
          if (y && y.p.id === x.p.id) {
            ref.current = finish({ ...y, practice: { ...y.practice!, thinking: false } });
            setS(ref.current);
          }
        });
      return;
    }
    // η υπόλοιπη λύση κίνηση-κίνηση από το σημείο όπου έμεινε ο χρήστης
    const from = revealed.played.length;
    const rest = x.p.moves.slice(from);
    if (!rest.length) {
      ref.current = revealSubs(revealed);
      setS(ref.current);
      return;
    }
    rest.forEach((u, i) => {
      later(250 + i * 520, () => {
        const y = ref.current;
        if (!y || y.p.id !== x.p.id) return;
        const r = playUci(y.fen, u);
        if (!r) return;
        moveSound(o.sounds, r.san);
        const next: SessionState = { ...y, fen: r.fen, last: r.move, played: [...y.played, u], sans: [...y.sans, r.san], ply: from + i + 1, phase: 'opp' };
        ref.current = i === rest.length - 1 ? revealSubs(next) : next;
        setS(ref.current);
      });
    });
  }, [finish, record, revealSubs]);

  const giveUp = useCallback(async () => {
    const x = ref.current;
    if (!x || x.phase === 'done') return;
    clear();
    await record(false);
  }, [record]);

  const whyWrong = useCallback(() => {
    const x = ref.current;
    if (!x?.wrong) return;
    const w = x.wrong;
    if (x.practice) {
      setRefute({ loading: false, data: x.practice.refutation, open: true });
      return;
    }
    if (x.sub) {
      // υποβαριάντα: ο server ξέρει μόνο την κύρια γραμμή, άρα η αντίκρουση από τη μηχανή
      setRefute({ loading: true, data: null, open: true });
      const exp = x.p.moves[w.ply] ?? null;
      const before = fenAt({ fen: x.p.fen, moves: x.p.moves }, w.ply);
      tacticsApi
        .engine(w.fen, 1, 900)
        .then((r) => {
          const line = r.lines[0];
          const v = solverEval(line, x.p.color === 'white');
          const mateIn = v !== null && Math.abs(v) >= MATE_CP - 1000 ? Math.sign(v) * Math.max(1, Math.round((MATE_CP - Math.abs(v)) / 10)) : null;
          const d: Refutation = { played: w.san, expected: exp, expectedSan: exp ? sanOf(before, exp) : null, fen: w.fen, engine: Boolean(line), reply: line?.uci[0] ?? null, replySan: line?.san[0] ?? null, line: line?.san ?? [], lineUci: line?.uci ?? [], cp: mateIn === null ? v : null, mate: mateIn, depth: line?.depth ?? null };
          if (ref.current?.wrong === w) setRefute({ loading: false, data: d, open: true });
        })
        .catch((e) => {
          setRefute({ loading: false, data: null, open: false });
          reportError(e);
        });
      return;
    }
    if (refute.data && refute.data.played === w.san) {
      setRefute({ ...refute, open: true });
      return;
    }
    setRefute({ loading: true, data: null, open: true });
    tacticsApi
      .refute(x.p.id, w.ply, w.uci)
      .then((d) => {
        if (ref.current?.wrong === w) setRefute({ loading: false, data: d, open: true });
      })
      .catch((e) => {
        setRefute({ loading: false, data: null, open: false });
        reportError(e);
      });
  }, [refute]);

  const closeRefute = useCallback(() => setRefute((r) => ({ ...r, open: false })), []);

  return { s, result, outcome, refute, load, move, hint, reveal, giveUp, whyWrong, closeRefute };
}

/** Η θέση ενός σημείου της γραμμής που παίχτηκε (για ←/→ μετά τη λύση). */
export function viewAt(s: SessionState, ply: number): { fen: string; last?: number } {
  const k = Math.max(0, Math.min(ply, s.played.length));
  const fen = fenAt({ fen: s.p.fen, moves: s.played }, k);
  if (!k) return { fen };
  const before = fenAt({ fen: s.p.fen, moves: s.played }, k - 1);
  return { fen, last: moveCode(before, s.played[k - 1]) };
}
