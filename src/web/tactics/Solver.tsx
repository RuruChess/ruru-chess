/** Οθόνη λύσης για τους τρόπους με ένα puzzle τη φορά (βαθμολογημένα, επανάληψη, Woodpecker, της ημέρας, χαμένα): σκακιέρα, «Βρες την καλύτερη συνέχεια», υπόδειξη σε τρία βήματα, «γιατί ήταν λάθος», αποτέλεσμα με τη σωστή γραμμή και «Επόμενο». */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Cpu, Eye, EyeOff, Flag, FlipVertical2, Lightbulb, Lock, SkipForward, Undo2 } from 'lucide-react';
import { parseSquare } from '../../core/chess.ts';
import type { GameNode, Shape } from '../../core/game.ts';
import { parseGames } from '../../core/pgn.ts';
import { L, fmtNum, language } from '../i18n.ts';
import { newTabId, reportError, useApp } from '../store.ts';
import { writeGame } from '../../core/pgn.ts';
import { Board } from '../components/Board.tsx';
import { useDrawnShapes } from '../components/drawnShapes.ts';
import { VariationChooser, pgnStep } from '../components/PgnLine.tsx';
import { Spinner } from '../components/ui/Progress.tsx';
import { Keys } from '../components/ui/Kbd.tsx';
import type { Command } from '../commands.ts';
import { tacticsApi, type AttemptResult, type Puzzle } from './api.ts';
import { boardUci, fenAt, moveLabels, moveText, playUci } from './logic.ts';
import { SourceInfo, Variations } from './Extras.tsx';
import { lessonGoal, lessonOf } from './lesson.ts';
import { evalLabel, goalText } from './practice.ts';
import { usePuzzleSession, viewAt, type SessionState } from './session.ts';
import { puzzleGame, type AnalysisInput } from './analysis.ts';
import { BlindPosition } from './blind.tsx';
import { MoveInput, ThemeChips, Verdict, evalText, fmtRating, signed, useBoardSettings, useScreenKeys, type CommandsRef } from './common.tsx';

export interface FeedItem {
  puzzle: Puzzle;
  deck?: number;
  cycle?: number;
}

/** Από πού έρχονται τα puzzles (αλλάζει το `key` → νέο puzzle). */
export interface Feed {
  key: string;
  next: () => Promise<FeedItem | null>;
  /** ένα μόνο puzzle (π.χ. της ημέρας): μετά τη λύση, κενή κατάσταση */
  once?: boolean;
}

export interface SolverProps {
  feed: Feed;
  /** τρόπος της προσπάθειας για τον server */
  mode: string;
  angle?: string[];
  active: boolean;
  commandsRef: CommandsRef;
  /** κάτω από το πάνελ λύσης (βαθμός, τράπουλα, κύκλος…) */
  side?: (ctx: { s: SessionState | null; result: AttemptResult | null }) => ReactNode;
  /** τίποτα να λυθεί (π.χ. καμία επανάληψη τώρα) */
  empty: ReactNode;
  /** κείμενο για τον τρόπο κάτω από την οδηγία (π.χ. «το ρολόι δεν μετρά») */
  tip?: string;
  /** τίτλος αντί για «Βρες την καλύτερη συνέχεια» (π.χ. «Puzzle της ημέρας») */
  title?: string;
  onResult?: (r: AttemptResult, win: boolean) => void;
  /** τυφλή λύση: χωρίς κομμάτια στη σκακιέρα ως τη λύση, η θέση σε λέξεις και η κίνηση με το πληκτρολόγιο */
  blind?: boolean;
  /** στην κορυφή της κάρτας λύσης (π.χ. επίπεδο και «Διακοπή») και στο κάτω μέρος της (σερί, σημερινά) */
  head?: ReactNode;
  foot?: ReactNode;
}

const COLOR_NAME = (c: 'white' | 'black', nom = true) => (c === 'white' ? (nom ? L('Τα λευκά', 'White') : L('λευκά', 'White')) : nom ? L('Τα μαύρα', 'Black') : L('μαύρα', 'Black'));

/** Βήματα της υπόδειξης: κομμάτι, τετράγωνο, κίνηση. */
function HintLadder({ s, onHint, rated }: { s: SessionState; onHint: () => void; rated: boolean }) {
  const h = s.hintInfo;
  const steps = [
    { t: L('Ποιο κομμάτι;', 'Which piece?'), a: h ? L(`${pieceArticle(h.piece.letter)} ${h.piece.el.toLowerCase()} στο ${h.from}`, `The ${h.piece.en.toLowerCase()} on ${h.from}`) : L('Δείχνει ποιο κομμάτι κινείται', 'Shows which piece moves') },
    { t: L('Ποιο τετράγωνο;', 'Which square?'), a: h?.to ? L(`Πηγαίνει στο ${h.to}`, `It goes to ${h.to}`) : L('Δείχνει πού πηγαίνει', 'Shows where it goes') },
    { t: L('Ποια κίνηση;', 'Which move?'), a: h?.san ? h.san : L('Παίζεται στη σκακιέρα', 'Played on the board') },
  ];
  const can = s.phase === 'play';
  return (
    <ol className="ladder" aria-label={L('Υποδείξεις', 'Hints')}>
      {steps.map((st, i) => {
        const done = s.hint > i;
        const next = s.hint === i;
        return (
          <li key={i} className={done ? 'done' : next ? 'next' : 'locked'}>
            <span className="step" aria-hidden>
              {i + 1}
            </span>
            <div>
              <div className="l-t">{st.t}</div>
              <div className={done ? 'l-a' : 'faint l-a'}>{st.a}</div>
            </div>
            {done ? (
              <span className="faint l-c">{i === 0 && rated ? L('μετρά ως αποτυχία', 'counts as a miss') : ''}</span>
            ) : next ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={!can} onClick={onHint}>
                {L('Δείξε', 'Show')}
                <Keys keys="H" />
              </button>
            ) : (
              <span className="faint l-c">
                <Lock className="ic ic-sm" aria-label={L('κλειδωμένο', 'locked')} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Άρθρο για το κομμάτι της υπόδειξης: «Το πιόνι», «Η βασίλισσα», «Ο ίππος». */
const pieceArticle = (letter: string) => (letter === 'P' ? 'Το' : letter === 'Q' ? 'Η' : 'Ο');

/** Η γραμμή που παίχτηκε, με τις λάθος κινήσεις του χρήστη, κάθε κίνηση με κλικ. */
function LineView({ s, view, onView }: { s: SessionState; view: number; onView: (ply: number) => void }) {
  const labels = moveLabels(s.p.fen, s.sans);
  return (
    <div className="tx-line" aria-label={L('Η γραμμή της λύσης', 'The solution line')}>
      {labels.map((m, i) => {
        const misses = s.misses.filter((x) => x.ply === i);
        const mine = s.p.pre ? i % 2 === 1 : i % 2 === 0;
        return (
          <span key={i} className="tx-mvw">
            {misses.map((x, k) => (
              <span key={k} className="tx-miss" title={L('η κίνησή σου (λάθος)', 'your move (wrong)')}>
                <span className="sr-only">{L('λάθος:', 'wrong:')}</span>✗ {x.san}
              </span>
            ))}
            {m.num && <span className="mn">{m.num}</span>}
            <button type="button" className={`tx-mv${view === i + 1 ? ' is-cur' : ''}${mine ? ' is-mine' : ''}`} onClick={() => onView(i + 1)} aria-current={view === i + 1 ? 'step' : undefined}>
              {m.san}
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function SolverView({ feed, mode, angle, active, commandsRef, side, empty, tip, title, onResult, blind, head, foot }: SolverProps) {
  const bs = useBoardSettings();
  const toast = useApp((st) => st.toast);
  const [item, setItem] = useState<FeedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [none, setNone] = useState(false);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [view, setView] = useState<number | null>(null);
  // κίνηση μιας βαριάντας της μηχανής στη σκακιέρα (μετά τη λύση)
  const [preview, setPreview] = useState<{ fen: string; last?: number } | null>(null);
  // κίνηση από τη λύση της πηγής, με τις βαριάντες της (μετά τη λύση· με κλικ ή με τα βελάκια)
  const [solNode, setSolNode] = useState<GameNode | null>(null);
  // → σε διακλάδωση της λύσης: οι υποψήφιες κινήσεις
  const [pick, setPick] = useState<GameNode | null>(null);
  const [flagged, setFlagged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const session = usePuzzleSession({ mode, angle, deck: item?.deck, cycle: item?.cycle, sounds: bs.sounds, onResult });
  const { s } = session;

  // μόνο το τελευταίο αίτημα μετρά (π.χ. διπλή κλήση των effects στο StrictMode)
  const loadSeq = useRef(0);
  const loadNext = async () => {
    const my = ++loadSeq.current;
    setLoading(true);
    try {
      const it = await feed.next();
      if (my !== loadSeq.current) return;
      setItem(it);
      setNone(!it);
      setView(null);
      setPreview(null);
      setSolNode(null);
      setFlagged(false);
      if (it) {
        setOrientation(it.puzzle.color);
        session.load(it.puzzle);
      }
    } catch (e) {
      if (my === loadSeq.current) reportError(e);
    } finally {
      if (my === loadSeq.current) setLoading(false);
    }
  };
  const loadRef = useRef(loadNext);
  loadRef.current = loadNext;
  useEffect(() => {
    void loadRef.current();
  }, [feed.key]);

  const done = s?.phase === 'done';
  // μετά τη λύση: η εστίαση στο «Επόμενο» (Enter)
  useEffect(() => {
    if (done && active) nextRef.current?.focus({ preventScroll: true });
  }, [done, active]);

  const next = async () => {
    if (!s) return void loadNext();
    if (s.phase !== 'done') await session.giveUp();
    if (feed.once) {
      setNone(true);
      return;
    }
    void loadNext();
  };

  const analyse = () => {
    if (!s) return;
    openPuzzleAnalysis({
      id: s.p.id,
      fen: s.p.fen,
      moves: s.p.moves,
      sourceName: s.p.source === 'lichess' ? undefined : language() === 'el' ? s.p.sourceName.el : s.p.sourceName.en,
      gameUrl: s.p.gameUrl,
      played: s.played,
      wrong: s.wrong ? { ply: s.wrong.ply, uci: s.wrong.uci, reply: session.refute.data?.lineUci } : null,
      atPly: s.wrong ? s.wrong.ply : s.p.pre ? 1 : 0,
      color: s.p.color,
    });
  };

  const flip = () => setOrientation((o) => (o === 'white' ? 'black' : 'white'));

  const flag = () => {
    if (!s) return;
    tacticsApi
      .flag(s.p.id, true)
      .then(() => {
        setFlagged(true);
        toast(L('Σημειώθηκε: αυτό το puzzle δεν θα ξαναδοθεί.', 'Flagged: this puzzle will not be served again.'), 'ok');
      })
      .catch(reportError);
  };

  // ←/→ μετά τη λύση: οι θέσεις της γραμμής
  const viewPly = done && s ? (view ?? s.played.length) : null;
  // η λύση της πηγής ως δέντρο (μάθημα ή συλλογή με λύση): οι βαριάντες της παίζονται στη σκακιέρα
  const solText = s ? (lessonOf(s.p)?.solution ?? (typeof s.p.meta?.solution === 'string' ? s.p.meta.solution : '')) : '';
  const solTree = useMemo(() => {
    if (!done || !s || !solText.trim()) return null;
    try {
      const r = parseGames(`[Event "?"]\n[SetUp "1"]\n[FEN "${s.p.fen}"]\n\n${solText}\n`)[0];
      return r && !r.error && r.game.root.children.length ? r.game.root : null;
    } catch {
      return null;
    }
  }, [done, s?.p.id, s?.p.fen, solText]);
  // πόσες ημικινήσεις της γραμμής που παίχτηκε είναι ένας κόμβος της λύσης (−1: εκτός της γραμμής)
  const playedDepth = (n: GameNode): number => {
    if (!s) return -1;
    let d = 0;
    for (let x: GameNode | null = n; x && !x.isRoot; x = x.parent) d++;
    if (d > s.sans.length) return -1;
    for (let x: GameNode | null = n, i = d - 1; x && !x.isRoot; x = x.parent, i--) if (x.san !== s.sans[i]) return -1;
    return d;
  };
  // ο κόμβος της λύσης που δείχνει η σκακιέρα: η βαριάντα που διάλεξε ο χρήστης ή η θέση της γραμμής που παίχτηκε
  const curNode = (() => {
    if (!solTree || !s) return null;
    if (solNode) return solNode;
    let n: GameNode = solTree;
    for (let i = 0; i < (viewPly ?? s.played.length); i++) {
      const c = n.children.find((x) => x.san === s.sans[i]);
      if (!c) return null;
      n = c;
    }
    return n;
  })();
  useEffect(() => {
    if (pick && pick !== curNode) setPick(null);
  }, [pick, curNode]);
  /** Δείχνει έναν κόμβο της λύσης· όσοι είναι στη γραμμή που παίχτηκε δείχνονται ως θέσεις της γραμμής. */
  const showNode = (n: GameNode) => {
    setPreview(null);
    const d = playedDepth(n);
    setSolNode(d < 0 ? n : null);
    if (d >= 0) setView(d);
  };
  /** Έξω από τη βαριάντα: πίσω στη γραμμή που παίχτηκε, στην κίνηση που παίχτηκε αντί για τη βαριάντα. */
  const leaveVar = () => {
    if (!s) return;
    let x: GameNode | null = solNode;
    while (x && playedDepth(x) < 0) x = x.parent;
    setPreview(null);
    setSolNode(null);
    if (x) setView(Math.min(playedDepth(x) + 1, s.played.length));
  };
  /**
   * Τα βελάκια στη λύση της πηγής: → σε διακλάδωση δείχνει τις υποψήφιες κινήσεις, ← πίσω,
   * ↓ άλλη βαριάντα της ίδιας κίνησης, ↑ πίσω στη γραμμή της βαριάντας, Esc πίσω στη γραμμή που παίχτηκε.
   */
  const treeKey = (k: string): boolean => {
    if (!curNode) return false;
    if (k === 'Escape') {
      if (!solNode) return false;
      leaveVar();
      return true;
    }
    if (k === 'ArrowRight' && curNode.children.length > 1 && bs.variationDialog) {
      setPick(curNode);
      return true;
    }
    if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'ArrowDown' && k !== 'ArrowUp') return false;
    const t = pgnStep(curNode, k);
    // στο τέλος μιας βαριάντας μένει εκεί· στη γραμμή που παίχτηκε ισχύουν τα ← → της γραμμής
    if (t === curNode) return Boolean(solNode) && (k === 'ArrowRight' || k === 'ArrowLeft');
    showNode(t);
    return true;
  };

  const shown = useMemo(() => {
    if (!s) return null;
    if (done && solNode) return { fen: solNode.fen, last: solNode.move };
    if (done && preview) return preview;
    if (session.refute.open && s.wrong) return { fen: s.wrong.fen, last: s.wrong.move };
    if (s.flash && s.wrong) return { fen: s.wrong.fen, last: s.wrong.move };
    if (viewPly !== null && viewPly !== s.played.length) return viewAt(s, viewPly);
    return { fen: s.fen, last: s.last };
  }, [s, viewPly, session.refute.open, done, preview, solNode]);

  const shapes = useMemo(() => {
    const out = { squares: [] as Shape[], arrows: [] as Shape[] };
    if (!s) return out;
    if (session.refute.open && session.refute.data?.lineUci?.[0]) {
      const u = session.refute.data.lineUci[0];
      out.arrows.push({ color: 'R', from: parseSquare(u, 0), to: parseSquare(u, 2) });
      return out;
    }
    const h = s.hintInfo;
    if (h && s.phase === 'play' && !s.flash) {
      const from = parseSquare(h.from);
      if (h.to) out.arrows.push({ color: 'G', from, to: parseSquare(h.to) });
      else out.squares.push({ color: 'G', from, to: from });
    }
    return out;
  }, [s, session.refute]);

  const canMove = s?.phase === 'play' && !session.refute.open;
  // βέλη και κύκλοι του χρήστη: μένουν ώσπου να αλλάξει η θέση
  const drawn = useDrawnShapes(blind && s && !done ? undefined : shown?.fen);

  useScreenKeys(active, (e) => {
    if (!s || pick) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'h' && s.phase === 'play') session.hint();
    else if ((k === 'n' || k === 'Enter') && done) void next();
    else if (k === 'Enter' && s.phase === 'play') inputRef.current?.focus();
    else if (k === 'f') flip();
    else if (k === 'a' && done) analyse();
    else if (k === 'Escape' && session.refute.open) session.closeRefute();
    else if (done && treeKey(k)) return true;
    else if (done && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End')) {
      const cur = viewPly ?? s.played.length;
      const n = k === 'ArrowLeft' ? cur - 1 : k === 'ArrowRight' ? cur + 1 : k === 'Home' ? 0 : s.played.length;
      setPreview(null);
      setSolNode(null);
      setView(Math.max(0, Math.min(s.played.length, n)));
    } else return;
    return true;
  });

  // όταν φεύγει η οθόνη, οι εντολές της δεν μένουν στην παλέτα (εκτός αν τις άλλαξε ήδη η επόμενη οθόνη)
  const ownCommands = useRef<(() => Command[]) | null>(null);
  useEffect(() => {
    if (ownCommands.current) commandsRef.current = ownCommands.current;
    return () => {
      if (commandsRef.current === ownCommands.current) commandsRef.current = () => [];
    };
  }, [commandsRef]);
  const provider = (): Command[] => {
    const g = L('Τακτική', 'Tactics');
    const play = s?.phase === 'play';
    return [
      { id: 'tx.hint', title: L('Υπόδειξη (επόμενο βήμα)', 'Hint (next step)'), extra: ['Hint', 'βοηθεια'], group: g, icon: Lightbulb, keys: 'H', disabled: !play || (s?.hint ?? 0) >= 3, run: session.hint },
      { id: 'tx.next', title: done ? L('Επόμενο puzzle', 'Next puzzle') : L('Παράλειψη puzzle', 'Skip puzzle'), extra: ['Next', 'skip', 'επομενο'], group: g, icon: SkipForward, keys: done ? 'N' : undefined, disabled: !s, run: () => void next() },
      { id: 'tx.solution', title: L('Δείξε τη λύση', 'Show the solution'), extra: ['Solution', 'λυση'], group: g, icon: Eye, disabled: !s || done || s.phase === 'intro', run: session.reveal },
      { id: 'tx.flip', title: L('Γύρισμα σκακιέρας', 'Flip board'), extra: ['Flip'], group: g, icon: FlipVertical2, keys: 'F', run: flip },
      { id: 'tx.analyse', title: L('Άνοιγμα στη σκακιέρα ανάλυσης (με μηχανή)', 'Open on the analysis board (with engine)'), extra: ['Analysis', 'engine', 'μηχανη'], group: g, icon: Cpu, keys: 'A', disabled: !done, run: analyse },
      { id: 'tx.why', title: L('Γιατί ήταν λάθος η κίνησή μου;', 'Why was my move wrong?'), extra: ['Refutation', 'αντικρουση'], group: g, icon: Undo2, disabled: !s?.wrong, run: session.whyWrong },
      { id: 'tx.type', title: L('Πληκτρολόγηση κίνησης', 'Type a move'), extra: ['Type move', 'keyboard'], group: g, keys: 'Enter', disabled: !play, run: () => inputRef.current?.focus() },
    ];
  };
  ownCommands.current = provider;
  commandsRef.current = provider;

  if (none && !loading) {
    return (
      <div className="tx-main">
        <section className="tx-board" aria-label={L('Σκακιέρα', 'Board')}>
          <Board fen="8/8/8/8/8/8/8/8 w - - 0 1" orientation="white" movable="none" theme={bs.theme} pieceSet={bs.pieceSet} coordinates={bs.coordinates} animationMs={0} />
        </section>
        <aside className="tx-side">
          <div className="panel tx-task tk-task">
            {head && <div className="tk-task-h">{head}</div>}
            <div className="tk-task-b">{empty}</div>
            {foot && <div className="tk-task-f">{foot}</div>}
          </div>
          {side?.({ s: null, result: null })}
        </aside>
      </div>
    );
  }

  const p = s?.p;
  // τυφλά: η σκακιέρα χωρίς κομμάτια μέχρι να τελειώσει η λύση
  const hidden = Boolean(blind && s && !done);
  const opp = p ? (p.color === 'white' ? 'black' : 'white') : 'black';
  const intro = s?.phase === 'intro';
  const firstSan = p && s && p.pre && s.sans[0] ? moveText(p.fen, s.sans[0]) : '';
  // μάθημα: στόχος και εισαγωγή, και τα σχόλια των κινήσεων που μόλις παίχτηκαν
  const lesson = p ? lessonOf(p) : null;
  const notes = (() => {
    if (!lesson || !s || s.practice) return [];
    const n = s.played.length;
    const at = (i: number) => (i >= 0 ? (s.notes[i] ?? '') : '');
    const list = s.good ? (s.phase === 'opp' ? [at(n - 1)] : [at(n - 2), at(n - 1)]) : n === 1 && s.phase === 'play' && p?.pre && !s.wrong && !s.alt ? [at(0)] : [];
    return list.filter(Boolean);
  })();
  const rating = session.result?.rating?.standard;
  const lineEnd = s?.played.length ?? 0;

  return (
    <div className="tx-main">
      <section className="tx-board" aria-label={L('Σκακιέρα', 'Board')} data-puzzle={s?.p.id}>
        <Board
          fen={hidden ? '8/8/8/8/8/8/8/8 w - - 0 1' : (shown?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1')}
          orientation={orientation}
          movable={canMove && p && !hidden ? p.color : 'none'}
          lastMove={shown?.last}
          shapes={drawn.shapes.length ? [...shapes.squares, ...drawn.shapes] : shapes.squares}
          hintArrows={shapes.arrows}
          onShape={drawn.onShape}
          theme={bs.theme}
          pieceSet={bs.pieceSet}
          coordinates={bs.coordinates}
          animationMs={bs.animationMs}
          oneClick={bs.oneClick}
          onMove={(from, to, promo) => {
            if (!s || !canMove) return;
            const uci = boardUci(s.fen, from, to, promo);
            if (uci) session.move(uci);
          }}
        />
        {pick && done && (
          <VariationChooser
            node={pick}
            note={(c) => (playedDepth(c) >= 0 ? L('η γραμμή', 'the line') : '')}
            onPick={(c) => {
              setPick(null);
              showNode(c);
            }}
            onClose={() => setPick(null)}
          />
        )}
        {s?.flash && s.wrong && !s.checking && <span className="tx-flash" aria-hidden>{`✗ ${s.wrong.san}`}</span>}
        {hidden && s && <BlindPosition fen={s.fen} />}
      </section>

      <aside className="tx-side">
        <div className="panel tx-task tk-task" aria-busy={loading}>
          {head && <div className="tk-task-h">{head}</div>}
          <div className="tk-task-b">
            {!p ? (
              <div className="tx-loading">
                <Spinner label={L('Φόρτωση puzzle', 'Loading puzzle')} />
                <span className="muted">{L('Φόρτωση puzzle…', 'Loading puzzle…')}</span>
              </div>
            ) : (
              <>
                <div className="tx-turn">
                  <span className={`side ${p.color === 'white' ? 'w' : 'b'}`} aria-hidden />
                  <span>{L(`Παίζεις με τα ${p.color === 'white' ? 'λευκά' : 'μαύρα'}`, `You play ${p.color === 'white' ? 'White' : 'Black'}`)}</span>
                  <span className="faint tx-id">
                    {p.source === 'lichess' ? '' : `${language() === 'el' ? p.sourceName.el : p.sourceName.en} · `}#{/^\d{10}$/.test(p.id) ? Number(p.id) % 10_000_000 : p.id}
                  </span>
                </div>

                {!done ? (
                  <>
                    <h1>{title ?? (s.practice ? L('Παίξε τη θέση απέναντι στη μηχανή', 'Play the position against the engine') : s.sub ? L(`Υποβαριάντα ${s.sub.n} από ${s.sub.total} της λύσης`, `Sub-variation ${s.sub.n} of ${s.sub.total} of the solution`) : (lesson?.title ?? L('Βρες την καλύτερη συνέχεια', 'Find the best move')))}</h1>
                    {lesson && !s.sub && (
                      <p className="tx-lesson-goal">
                        <b>{lessonGoal(p.color, lesson.goal)}</b>
                        {lesson.intro ? ` ${lesson.intro}` : ''}
                      </p>
                    )}
                    <p className="muted tx-prompt">
                      {s.practice
                        ? intro
                          ? L('Η μηχανή εκτιμά τη θέση…', 'The engine is assessing the position…')
                          : !s.practice.engine
                            ? L('Δεν υπάρχει μηχανή: πρόσθεσέ τη στις Ρυθμίσεις → Μηχανές, για να κρίνονται οι κινήσεις.', 'No engine: add one in Settings → Engines so that the moves are judged.')
                            : L(
                                `Η πηγή δεν δίνει λύση για αυτή τη θέση, οπότε την παίζεις με τη μηχανή. Παίζουν ${COLOR_NAME(p.color, false)}. Στόχος: ${goalText(s.practice.goal)} (εκτίμηση ${evalLabel(s.practice.base)}). Κίνηση ${Math.min(s.practice.done + 1, s.practice.target)} από ${s.practice.target}.`,
                                `The source gives no solution for this position, so you play it against the engine. ${COLOR_NAME(p.color)} to move. Goal: ${goalText(s.practice.goal)} (assessment ${evalLabel(s.practice.base)}). Move ${Math.min(s.practice.done + 1, s.practice.target)} of ${s.practice.target}.`,
                              )
                        : s.sub
                          ? intro
                            ? L(`Σωστά! Πίσω στη λύση: τι γίνεται αν ${opp === 'white' ? 'τα λευκά' : 'τα μαύρα'} παίξουν ${s.sub.label};`, `Correct! Back to the solution: what if ${COLOR_NAME(opp)} plays ${s.sub.label}?`)
                            : L(`${COLOR_NAME(opp)} έπαιξαν ${s.sub.label} αντί για την κύρια γραμμή. Βρες τη συνέχεια.`, `${COLOR_NAME(opp)} played ${s.sub.label} instead of the main line. Find the continuation.`)
                        : intro
                        ? L(`${COLOR_NAME(opp)} παίζουν…`, `${COLOR_NAME(opp)} is moving…`)
                        : firstSan
                          ? L(`${COLOR_NAME(opp)} μόλις έπαιξαν ${firstSan}.`, `${COLOR_NAME(opp)} just played ${firstSan}.`)
                          : L(`Παίζουν ${COLOR_NAME(p.color, false)}.`, `${COLOR_NAME(p.color)} to move.`)}
                      {tip && !lesson ? ` ${tip}` : ''}
                    </p>
                    {!lesson && (
                      <div className="tx-hidden faint">
                        <EyeOff className="ic ic-sm" aria-hidden />
                        {L('Βαθμός δυσκολίας και θέματα κρυφά μέχρι τη λύση', 'Difficulty and themes hidden until solved')}
                      </div>
                    )}

                    <div aria-live="polite" className="tx-feedback">
                      {s.practice && s.practice.thinking && !intro && (
                        <div className="tx-thinking">
                          <span className="spinner" aria-hidden />
                          <span className="muted">{L('Η μηχανή σκέφτεται…', 'The engine is thinking…')}</span>
                        </div>
                      )}
                      {s.practice?.note && <Verdict ok={s.practice.note.ok}>{s.practice.note.text}</Verdict>}
                      {s.practice?.note && !s.practice.note.ok && s.wrong && !session.refute.open && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={session.whyWrong}>
                          <Undo2 className="ic" aria-hidden />
                          {L('Γιατί ήταν λάθος;', 'Why was it wrong?')}
                        </button>
                      )}
                      {!s.practice && s.good && s.phase !== 'intro' && !s.flash && <Verdict ok>{lesson ? L('Σωστά.', 'Correct.') : L('Σωστά. Συνέχισε.', 'Correct. Keep going.')}</Verdict>}
                      {notes.map((t, i) => (
                        <p key={i} className="tx-note">
                          {t}
                        </p>
                      ))}
                      {s.checking && (
                        <div className="tx-thinking">
                          <span className="spinner" aria-hidden />
                          <span className="muted">{L('Η μηχανή κρίνει την κίνηση…', 'The engine is judging the move…')}</span>
                        </div>
                      )}
                      {s.alt && lesson && (
                        <Verdict ok>
                          {L(
                            `Το ${s.alt.san} κρατά κι αυτό ${lesson.goal === 'win' ? 'τη νίκη' : 'την ισοπαλία'}. Το μάθημα όμως συνεχίζει με άλλη κίνηση: βρες την.`,
                            `${s.alt.san} also keeps the ${lesson.goal === 'win' ? 'win' : 'draw'}. The lesson continues with another move, though: find it.`,
                          )}
                        </Verdict>
                      )}
                      {!s.practice && s.wrong && !s.good && !s.checking && (
                        <div className="tx-wrong">
                          <Verdict ok={false}>{L(`Το ${s.wrong.san} δεν είναι η λύση. Δοκίμασε ξανά.`, `${s.wrong.san} is not the solution. Try again.`)}</Verdict>
                          {!session.refute.open && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={session.whyWrong}>
                              <Undo2 className="ic" aria-hidden />
                              {L('Γιατί ήταν λάθος;', 'Why was it wrong?')}
                            </button>
                          )}
                        </div>
                      )}
                      {session.refute.open && s.wrong && <RefutePanel s={s} r={session.refute} onClose={session.closeRefute} />}
                    </div>

                    <HintLadder s={s} onHint={session.hint} rated={mode === 'rated'} />

                    <MoveInput ref={inputRef} fen={s.fen} ready={s.phase === 'play' && !session.refute.open} disabled={session.refute.open} onMove={session.move} resetKey={s.p.id} />
                  </>
                ) : (
                  <>
                    <Verdict ok={session.outcome === 'win'}>
                      <span className="tx-result-t">
                        {s.practice && session.outcome === 'win' && !s.hintsUsed
                          ? (s.practice.note?.text ?? L('Τα κατάφερες!', 'Well done!'))
                          : s.practice && s.revealed
                            ? L('Είδες τη συνέχεια της μηχανής', 'You viewed the engine’s continuation')
                            : session.outcome === 'win'
                          ? s.hintsUsed
                            ? mode === 'rated'
                              ? L('Λύθηκε με υπόδειξη: στον βαθμό μετρά ως αποτυχία', 'Solved with a hint: counts as a miss for the rating')
                              : L('Λύθηκε με υπόδειξη', 'Solved with a hint')
                            : L('Σωστά! Λύθηκε με την πρώτη', 'Correct! Solved at the first try')
                          : s.revealed
                            ? L('Είδες τη λύση', 'You viewed the solution')
                            : L(`Λύθηκε μετά από λάθος (${s.misses[0]?.san ?? ''})`, `Solved after a mistake (${s.misses[0]?.san ?? ''})`)}
                      </span>
                    </Verdict>
                    {lesson?.summary && (
                      <div className="tx-lesson-sum">
                        <div className="section-label">{L('Τι κρατάς', 'Key idea')}</div>
                        <p>{lesson.summary}</p>
                      </div>
                    )}
                    {s.sub && !s.practice && (
                      <p className="faint tx-prompt">{L(`Μαζί με ${s.sub.total === 1 ? 'την υποβαριάντα' : `τις ${s.sub.total} υποβαριάντες`} της λύσης.`, `Together with ${s.sub.total === 1 ? 'the sub-variation' : `the ${s.sub.total} sub-variations`} of the solution.`)}</p>
                    )}
                    {rating && (
                      <div className="tx-rating-change">
                        <span className={`tnum tx-delta ${rating.delta >= 0 ? 'is-up' : 'is-down'}`}>{signed(rating.delta)}</span>
                        <span className="muted">
                          {L('Βαθμός', 'Rating')} <b className="tnum">{fmtRating(rating.after)}</b>
                          {rating.provisional ? L(' · προσωρινός', ' · provisional') : ''}
                        </span>
                      </div>
                    )}
                    {session.result?.card && (
                      <p className="muted tx-prompt">
                        {L(`Επόμενη επανάληψη ${dueText(session.result.card.due)}.`, `Next review ${dueText(session.result.card.due)}.`)}
                      </p>
                    )}
                    {session.result?.addedToFailed && mode !== 'review' && <p className="faint tx-prompt">{L('Μπήκε στην τράπουλα «Αποτυχημένα» για επανάληψη.', 'Added to the “Failed” deck for review.')}</p>}

                    <div className="tx-solved-info">
                      <div className="tx-kv">
                        <span className="faint">{L('Βαθμός puzzle', 'Puzzle rating')}</span>
                        <b className="tnum">
                          {fmtRating(p.rating)}
                          {p.approximate ? ' ≈' : ''}
                        </b>
                        {p.plays ? <span className="faint tnum">· {L(`${fmtNum(p.plays)} προσπάθειες`, `${fmtNum(p.plays)} plays`)}</span> : null}
                      </div>
                      {p.opening && (
                        <div className="tx-kv ellipsis">
                          <span className="faint">{L('Άνοιγμα', 'Opening')}</span>
                          <span className="ellipsis">{p.opening.family}</span>
                        </div>
                      )}
                      <ThemeChips themes={p.themes} />
                    </div>

                    <div className="section-label">{L('Η γραμμή', 'The line')}</div>
                    <LineView
                      s={s}
                      view={viewPly ?? lineEnd}
                      onView={(n) => {
                        setPreview(null);
                        setSolNode(null);
                        setView(n);
                      }}
                    />
                    <div className="faint tx-nav-hint">
                      <Keys keys="←" /> <Keys keys="→" /> {L('για να δεις τη γραμμή κίνηση-κίνηση', 'to step through the line')}
                    </div>

                    <SourceInfo p={p} tree={solTree} current={curNode} away={Boolean(solNode)} onPick={showNode} onBack={leaveVar} />
                    <Variations
                      key={p.id}
                      fen={p.pre && p.moves.length ? fenAt(p, 1) : p.fen}
                      solverWhite={p.color === 'white'}
                      onPreview={(v) => {
                        setSolNode(null);
                        setPreview(v);
                      }}
                    />

                    {s.wrong && (
                      <div className="tx-wrong">
                        {!session.refute.open ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={session.whyWrong}>
                            <Undo2 className="ic" aria-hidden />
                            {L(`Γιατί ήταν λάθος το ${s.wrong.san};`, `Why was ${s.wrong.san} wrong?`)}
                          </button>
                        ) : (
                          <RefutePanel s={s} r={session.refute} onClose={session.closeRefute} />
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {/* κουμπιά στο κάτω μέρος της κάρτας */}
          {p && s && !done && (
            <div className="tx-actions">
              <button type="button" className="btn btn-ghost" disabled={intro || s.phase === 'opp'} onClick={session.reveal}>
                <Eye className="ic" aria-hidden />
                {L('Λύση', 'Solution')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void next()} title={mode === 'rated' ? L('Μετρά ως αποτυχία', 'Counts as a miss') : undefined}>
                <SkipForward className="ic" aria-hidden />
                {L('Παράλειψη', 'Skip')}
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost btn-icon" onClick={flip} aria-label={L('Γύρισμα σκακιέρας', 'Flip board')} title={L('Γύρισμα σκακιέρας', 'Flip board')} data-keys="F">
                <FlipVertical2 className="ic" aria-hidden />
              </button>
              <button type="button" className="btn btn-ghost" disabled title={L('Διαθέσιμο μετά τη λύση', 'Available after solving')}>
                <Cpu className="ic" aria-hidden />
                {L('Ανάλυση', 'Analysis')}
              </button>
            </div>
          )}
          {p && s && done && (
            <div className="tx-actions tx-actions-done">
              <button ref={nextRef} type="button" className="btn btn-primary" onClick={() => void next()}>
                {L('Επόμενο', 'Next')}
                <Keys keys="N" />
              </button>
              <button type="button" className="btn btn-secondary" onClick={analyse}>
                <Cpu className="ic" aria-hidden />
                {L('Ανάλυση', 'Analysis')}
                <Keys keys="A" />
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost btn-icon" onClick={flip} aria-label={L('Γύρισμα σκακιέρας', 'Flip board')} title={L('Γύρισμα σκακιέρας', 'Flip board')} data-keys="F">
                <FlipVertical2 className="ic" aria-hidden />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" disabled={flagged} onClick={flag} aria-label={L('Κακό puzzle: να μην ξαναδοθεί', 'Bad puzzle: do not serve again')} title={L('Κακό puzzle: να μην ξαναδοθεί', 'Bad puzzle: do not serve again')}>
                <Flag className="ic" aria-hidden />
              </button>
            </div>
          )}
          {foot && <div className="tk-task-f">{foot}</div>}
        </div>
        {side?.({ s, result: session.result })}
      </aside>
    </div>
  );
}

/** Νέα καρτέλα ανάλυσης στη θέση του puzzle, με τη μηχανή να αναλύει. */
function openPuzzleAnalysis(a: AnalysisInput): void {
  const g = puzzleGame(a);
  useApp.getState().openTab({
    id: newTabId('game'),
    kind: 'game',
    title: `${L('Τακτική', 'Puzzle')} #${a.id}`,
    pgn: writeGame(g),
    ply: Math.max(0, Math.min(a.atPly, a.moves.length)),
    engine: true,
    orientation: a.color,
  });
}

/** «αύριο» / «σε 3 μέρες» / «σε 10 λεπτά». */
function dueText(due: number): string {
  const ms = due - Date.now();
  const min = Math.round(ms / 60_000);
  if (min < 60) return L(`σε ${Math.max(1, min)} λεπτά`, `in ${Math.max(1, min)} min`);
  const h = Math.round(min / 60);
  if (h < 20) return L(`σε ${h} ${h === 1 ? 'ώρα' : 'ώρες'}`, `in ${h} h`);
  const d = Math.max(1, Math.round(h / 24));
  return d === 1 ? L('αύριο', 'tomorrow') : L(`σε ${d} μέρες`, `in ${d} days`);
}

/** «Γιατί ήταν λάθος»: η απάντηση της μηχανής στη λάθος κίνηση (βέλος στη σκακιέρα) και η γραμμή. */
function RefutePanel({ s, r, onClose }: { s: SessionState; r: { loading: boolean; data: import('./api.ts').Refutation | null }; onClose: () => void }) {
  const w = s.wrong!;
  const d = r.data;
  const replier = s.p.color === 'white' ? L('τα μαύρα', 'Black') : L('τα λευκά', 'White');
  // η συνέχεια μετά την απάντηση (η απάντηση γράφεται ήδη στην πρόταση)
  const afterReply = d?.lineUci?.[0] ? playUci(w.fen, d.lineUci[0]) : null;
  const line = afterReply && d?.line && d.line.length > 1 ? moveLabels(afterReply.fen, d.line.slice(1)) : [];
  return (
    <div className="tx-refute" role="region" aria-label={L('Αντίκρουση', 'Refutation')}>
      {r.loading ? (
        <div className="tx-loading">
          <Spinner label={L('Η μηχανή σκέφτεται', 'The engine is thinking')} />
          <span className="muted">{L('Η μηχανή ψάχνει την αντίκρουση…', 'The engine is looking for the refutation…')}</span>
        </div>
      ) : d?.engine && d.replySan ? (
        <>
          <p>
            {L(`Μετά το ${moveText(fenBefore(s), w.san)} ${replier} απαντούν `, `After ${moveText(fenBefore(s), w.san)}, ${replier} reply `)}
            <b>{moveText(w.fen, d.replySan)}</b>
            {evalText(d.cp, d.mate) && <span className="muted">{` (${evalText(d.cp, d.mate)})`}</span>}.
          </p>
          {line.length > 0 && (
            <p className="tx-refute-line">
              <span className="faint">{L('Συνέχεια: ', 'Then: ')}</span>
              {line.map((m, i) => (
                <span key={i}>
                  {m.num && <span className="mn">{m.num}</span>}
                  {m.san}{' '}
                </span>
              ))}
            </p>
          )}
          <p className="faint">{L(`Μηχανή, βάθος ${d.depth ?? '?'}. Το κόκκινο βέλος δείχνει την απάντηση.`, `Engine, depth ${d.depth ?? '?'}. The red arrow shows the reply.`)}</p>
        </>
      ) : (
        <p>
          {L('Δεν υπάρχει μηχανή για την αντίκρουση (Ρυθμίσεις → Μηχανές).', 'No engine for the refutation (Settings → Engines).')}
          {d?.expectedSan ? L(` Η σωστή κίνηση ήταν ${d.expectedSan}.`, ` The correct move was ${d.expectedSan}.`) : ''}
        </p>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
        {s.phase === 'done' ? L('Πίσω στη λύση', 'Back to the solution') : L('Ξαναδοκίμασε', 'Try again')}
        <Keys keys="Esc" />
      </button>
    </div>
  );
}

/** Η θέση πριν από τη λάθος κίνηση (για τον αριθμό της κίνησης). */
function fenBefore(s: SessionState): string {
  const w = s.wrong!;
  const moves = s.practice ? s.played : s.p.moves;
  return viewAt({ ...s, played: moves.slice(0, w.ply) }, w.ply).fen;
}

