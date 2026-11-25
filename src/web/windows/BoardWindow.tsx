/**
 * Παράθυρο σκακιέρας: παρτίδα, σημειογραφία, μηχανή, δέντρο ανοιγμάτων,
 * σχολιασμός, αποθήκευση, πλήρης ανάλυση, εκπαίδευση και παιχνίδι με μηχανή.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2, FilePlus2, Save, Grid3x3, Pencil, ClipboardPaste,
  Cpu, GraduationCap, Bot, Undo2, Redo2, MoreHorizontal, SkipBack, SkipForward, LayoutPanelLeft, Radio,
  ChevronDown, Database, Highlighter, List, MoveUpRight, Plus, Tv,
} from 'lucide-react';
import { ShareHost, type ShareStart } from '../share/ShareHost.tsx';
import { VideoEmbed } from '../components/VideoEmbed.tsx';
import { useSocial } from '../social/social.ts';
import { liveError, liveRemaining, useLive, type LiveState } from '../watch/useLive.ts';
import type { ShareLiveInfo } from '../../core/share.ts';
import { lichessLogin } from '../watch/account.ts';
import { Position, START_FEN, F_NULL, NULL_MOVE, moveFrom, moveTo } from '../../core/chess.ts';
import type { GameNode, Shape } from '../../core/game.ts';
import { rememberStudy, type StudyRecord } from '../study.ts';
import { MENU_NAGS, NAG_GROUPS, NAG_NAMES, isNagTextPrefix, nagGroup, nagSymbol, sameNag, textToNag } from '../../core/nag.ts';
import { api, type PvLine } from '../api.ts';
import { L } from '../i18n.ts';
import { controllerFor, dropController, GameController, useController, useMoveSounds } from '../gameModel.ts';
import { newTabId, reportError, useApp, type Tab } from '../store.ts';
import { Board } from '../components/Board.tsx';
import { Notation, displaySan, type NotationStyle } from '../components/Notation.tsx';
import { EnginePanel, EvalBar } from '../components/EnginePanel.tsx';
import { TreePanel } from '../components/TreePanel.tsx';
import { EvalGraph, type EvalPoint } from '../components/EvalGraph.tsx';
import { ContextMenu, WinDialog, type MenuItem } from '../components/ui.tsx';
import { openDbWith } from '../components/QuickSearch.tsx';
import { PAWN_MODE_LABELS } from '../components/SearchDialog.tsx';
import { CommentDialog, FullAnalysisDialog, HeaderDialog, NagPalette, NoveltyDialog, PlayDialog, RepertoireAddDialog, SaveDialog, SetupDialog, SummaryDialog, type PlaySettings } from '../components/GameDialogs.tsx';
import { openingAt, useEcoBook } from '../eco.ts';
import type { PlayerSummary } from '../annotate.ts';
import { printGame, printScoresheet } from '../print.ts';
import { OpeningReportDialog } from '../components/OpeningReport.tsx';

type GameTab = Extract<Tab, { kind: 'game' }>;

function parseEvalText(e: string): EvalPoint | null {
  if (!e) return null;
  if (e.startsWith('#')) return { cp: null, mate: Number(e.slice(1)) };
  const v = Number(e.split(',')[0]);
  if (!Number.isFinite(v)) return null;
  return { cp: e.includes(',') ? v : Math.round(v * 100), mate: null };
}

/** Ρολόι στο παιχνίδι με μηχανή (ms): ο χρόνος της πλευράς που παίζει στο `node` τρέχει από το `since`. */
type Clock = { w: number; b: number; inc: number; since: number; node: GameNode };

const turnOf = (n: GameNode): 'w' | 'b' => (n.fen.split(' ')[1] === 'b' ? 'b' : 'w');

const remaining = (c: Clock, side: 'w' | 'b') => c[side] - (turnOf(c.node) === side ? Date.now() - c.since : 0);

/** m:ss (δέκατα κάτω από 10 δευτ.)· με `pgn` h:mm:ss για το [%clk]. */
function fmtClock(ms: number, pgn = false): string {
  const s = Math.max(0, ms) / 1000;
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  if (pgn) return `${Math.floor(s / 3600)}:${mmss(s % 3600).padStart(5, '0')}`;
  return s < 10 ? s.toFixed(1) : mmss(s);
}

export function BoardWindow({
  tab,
  active,
  shareLeaveSignal,
  onShareExit,
  onShareEnded,
}: {
  tab: GameTab;
  active: boolean;
  shareLeaveSignal?: number;
  onShareExit?: () => void;
  onShareEnded?: () => void;
}) {
  const ctrl = controllerFor(tab.id, () => {
    if (tab.pgn) {
      const c = GameController.fromPgn(tab.pgn).ctrl;
      if (tab.dirty) c.dirty = true;
      // άνοιγμα σε ημικίνηση της κύριας γραμμής (π.χ. puzzle της Τακτικής)
      if (tab.ply) {
        let n = c.node;
        for (let i = 0; i < tab.ply && n.children.length; i++) n = n.children[0];
        c.goTo(n);
      }
      return c;
    }
    const c = new GameController();
    if (tab.fen) c.newGame(tab.fen);
    return c;
  });
  useController(ctrl);
  useMoveSounds(ctrl);
  /** Watch Live: οι κινήσεις έρχονται από το Lichess στην κύρια γραμμή */
  const live = useLive(tab.live, ctrl);
  const settings = useApp((s) => s.settings);
  const updateTab = useApp((s) => s.updateTab);
  const openTab = useApp((s) => s.openTab);
  const toast = useApp((s) => s.toast);
  const eco = useEcoBook();

  const [source, setSource] = useState(tab.source);
  /** η βάση όπου ανήκει η παρτίδα (νέα παρτίδα μέσα σε βάση): εκεί αποθηκεύεται χωρίς ερώτηση */
  const [targetDb, setTargetDb] = useState<string | undefined>(tab.targetDb ?? tab.source?.dbId);
  // με δοσμένο PGN (π.χ. ξανάνοιγμα με αλλαγές) δεν φορτώνεται ξανά η παρτίδα από τη βάση
  const [loaded, setLoaded] = useState(!tab.source || Boolean(tab.pgn));
  // αρίθμηση νέων παρτίδων («Νέα παρτίδα 1, 2, …»)
  const [gameNo, setGameNo] = useState<number | null>(null);
  const takeGameNumber = () => {
    api
      .post<{ n: number }>('/api/game-number', {})
      .then((r) => setGameNo(r.n))
      .catch(() => {});
  };
  useEffect(() => {
    if (!tab.source && !tab.pgn) takeGameNumber();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [orientation, setOrientation] = useState<'white' | 'black'>(tab.orientation ?? 'white');
  // κάτω καρτέλα: αρχικά «Σημειογραφία»: τίποτα δεν τρέχει και η
  // σημειογραφία πιάνει όλο το ύψος· η μηχανή και η αναφορά ανοίγουν όταν τις διαλέξεις
  type Pane = 'engine' | 'tree' | 'symbols';
  const [panes, setPanes] = useState<Record<Pane, boolean>>({ engine: Boolean(tab.engine), tree: false, symbols: false });
  /** ποιες μηχανές τρέχουν (για να μένει σταθερή η μπάρα αξιολόγησης όσο περιμένει νέα θέση) */
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const lastEval = useRef<PvLine | null>(null);
  const [engines, setEngines] = useState<string[]>([`${tab.id}-e1`]);
  const [hints, setHints] = useState<Record<string, PvLine[]>>({});
  const [treeDb, setTreeDb] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'comment'; node: GameNode; before: boolean } | { kind: 'header'; thenSave?: boolean } | { kind: 'setup' } | { kind: 'save' } | { kind: 'analysis' } | { kind: 'play' } | { kind: 'summary'; summary: { white: PlayerSummary; black: PlayerSummary } } | { kind: 'repertoire' } | { kind: 'report' } | { kind: 'novelty' }>(null);
  // εκπαίδευση: οι επόμενες κινήσεις κρυμμένες· μαντεύεις στη σκακιέρα ή προχωράς με →
  const [training, setTraining] = useState<{ tries: number; message: string } | null>(null);
  const [play, setPlay] = useState<(PlaySettings & { thinking: boolean }) | null>(null);
  /** κοινή ανάλυση live (μέσω link) */
  const [share, setShare] = useState<ShareStart | null>(tab.share ?? null);
  /** ενσωματωμένη οθόνη YouTube (στη δεξιά στήλη στην κανονική ανάλυση, ή στη θέση της κάμερας στην Κοινή ανάλυση) */
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  /** ζωντανή παρτίδα από τον οικοδεσπότη (όταν μπήκαμε ως καλεσμένος σε κοινή ανάλυση πάνω σε Watch Live) */
  const [remoteLive, setRemoteLive] = useState<ShareLiveInfo | null>(null);
  const liveState: LiveState | null =
    live.state ??
    (remoteLive
      ? { status: remoteLive.status, clocks: remoteLive.w !== null || remoteLive.b !== null ? { w: remoteLive.w, b: remoteLive.b, turn: remoteLive.turn } : null, at: remoteLive.at, plies: remoteLive.plies }
      : null);
  const remoteTicking = !live.state && remoteLive?.status === 'live' && (remoteLive.w !== null || remoteLive.b !== null);
  useEffect(() => {
    if (!remoteTicking) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [remoteTicking]);
  // «Κοινή ανάλυση με…» από τους Φίλους: ξεκίνα κοινή ανάλυση σε αυτή την παρτίδα
  const shareReq = useSocial((s) => s.shareTab === tab.id);
  useEffect(() => {
    if (!shareReq) return;
    useSocial.setState({ shareTab: null });
    if (share) return;
    setPlay(null);
    setTraining(null);
    setShare('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareReq]);
  const [clock, setClock] = useState<Clock | null>(null);
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const playRef = useRef(play);
  playRef.current = play;
  const [, setTick] = useState(0);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const style: NotationStyle = (ui.notation as NotationStyle) ?? 'figurine';
  /** βάση της «Αναφοράς»: αυτή που διάλεξε ο χρήστης εδώ, αλλιώς η βάση αναφοράς των ρυθμίσεων */
  const refDb = treeDb ?? ((ui.referenceDb as string | undefined) || null);
  // Μηχανή / Αναφορά / Σύμβολα: διακόπτες, ανοίγουν και μαζί (η μηχανή πάντα πρώτη)
  const togglePane = (p: Pane) => {
    setPanes((o) => ({ ...o, [p]: !o[p] }));
    if (p === 'engine' && panes.engine) {
      setHints({});
      setRunning({});
    }
  };
  // ---------------------------------------------------------------------
  // διάταξη («Προβολή») και μεγέθη με σύρσιμο των διαχωριστικών
  type Layout = { mode: 'full' | 'columns' | 'moves' | 'board'; leftW?: number; bottomH?: number; sideW?: number; shareW?: number };
  const [layout, setLayout] = useState<Layout>(() => ({ mode: 'full', ...((ui.boardLayout as Layout | undefined) ?? {}) }));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // νέος υπολογισμός σε κάθε αλλαγή μεγέθους του παραθύρου
  const [, setWinTick] = useState(0);
  useEffect(() => {
    const f = () => setWinTick((t) => t + 1);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const win = { w: window.innerWidth, h: window.innerHeight };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  // live: χώρος για τις μπάρες παικτών πάνω και κάτω από τη σκακιέρα
  const maxBoard = Math.max(280, win.h - 110 - (liveState ? 76 : 0));
  // κοινή ανάλυση ή βίντεο σε φαρδύ παράθυρο: το πάνελ (link, μέλη, chat ή YouTube) σε τρίτη στήλη δεξιά (CSS: .bw-right.share-col)·
  // το πλάτος σύρεται (μεγαλύτερο βίντεο/chat/κάμερα, μικραίνει η σκακιέρα) και μένει στο boardLayout
  const shareMax = Math.max(300, win.w - 720); // σκακιέρα ≥ 280, κινήσεις ≥ 440
  const shareW = (share || videoOpen) && layout.mode !== 'board' && win.w >= 1200 ? clamp(layout.shareW ?? (win.w >= 1600 ? 440 : 380), 300, shareMax) : 0;
  const rightMin = shareW ? 440 + shareW : 330; // κινήσεις (+ πάνελ)
  const leftWidth =
    layout.mode === 'board'
      ? Math.min(win.w - 24, maxBoard)
      : clamp(layout.leftW ?? Math.min(win.h - 170, win.w * 0.56, win.w - rightMin), 280, Math.min(maxBoard, win.w - rightMin));
  const bottomHeight = clamp(layout.bottomH ?? Math.round((win.h - 200) * 0.32), 110, Math.max(110, win.h - 300));
  const twoCols = layout.mode === 'columns' && win.w - leftWidth - shareW >= 620;
  const sideWidth = clamp(layout.sideW ?? Math.max(380, win.w - leftWidth - shareW - 390), 240, Math.max(240, win.w - leftWidth - 260 - shareW));
  const saveLayout = (l: Layout) => void useApp.getState().saveUi({ boardLayout: l }).catch(() => {});
  const setMode = (mode: Layout['mode']) => {
    const l = { ...layoutRef.current, mode };
    setLayout(l);
    saveLayout(l);
  };
  const drag = (kind: 'left' | 'bottom' | 'side' | 'share') => (e: React.PointerEvent) => {
    e.preventDefault();
    const start = kind === 'bottom' ? e.clientY : e.clientX;
    const orig = kind === 'left' ? leftWidth : kind === 'bottom' ? bottomHeight : kind === 'share' ? shareW : sideWidth;
    const el = e.currentTarget as HTMLElement;
    el.classList.add('active');
    const move = (ev: PointerEvent) => {
      const d = (kind === 'bottom' ? ev.clientY : ev.clientX) - start;
      setLayout((l) =>
        kind === 'left' ? { ...l, leftW: orig + d } : kind === 'bottom' ? { ...l, bottomH: orig + d } : kind === 'share' ? { ...l, shareW: clamp(orig - d, 300, shareMax) } : { ...l, sideW: orig - d },
      );
    };
    const up = () => {
      el.classList.remove('active');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      saveLayout(layoutRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const viewMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const item = (mode: Layout['mode'], label: string): MenuItem => ({ label, checked: layout.mode === mode, onClick: () => setMode(mode) });
    const ensurePanelMode = () => {
      if (layoutRef.current.mode === 'board' || layoutRef.current.mode === 'moves') setMode('full');
    };
    setMenu({
      x: Math.max(8, r.right - 270),
      y: r.bottom + 4,
      items: [
        item('full', L('Κινήσεις και καρτέλες σε μία στήλη', 'Moves and panels in one column')),
        item('columns', L('Κινήσεις και καρτέλες σε δύο στήλες', 'Moves and panels in two columns')),
        item('moves', L('Σκακιέρα και κινήσεις', 'Board and moves')),
        item('board', L('Μόνο σκακιέρα', 'Board only')),
        { separator: true, label: '' },
        {
          label: L('Βίντεο (YouTube / Twitch / Kick)', 'Video (YouTube / Twitch / Kick)'),
          checked: videoOpen,
          onClick: () => {
            if (!videoOpen && layoutRef.current.mode === 'board') setMode('full');
            setVideoOpen((o) => !o);
          },
        },
        {
          label: L('Κοινή ανάλυση', 'Shared analysis'),
          checked: Boolean(share),
          disabled: Boolean(share),
          onClick: () => {
            if (layoutRef.current.mode === 'board') setMode('full');
            setPlay(null);
            setTraining(null);
            setShare('new');
          },
        },
        {
          label: L('Μηχανή', 'Engine'),
          checked: panes.engine && layout.mode !== 'board' && layout.mode !== 'moves',
          onClick: () => {
            if (!panes.engine) ensurePanelMode();
            togglePane('engine');
          },
        },
        {
          label: L('Αναφορά', 'Reference'),
          checked: panes.tree && layout.mode !== 'board' && layout.mode !== 'moves',
          onClick: () => {
            if (!panes.tree) ensurePanelMode();
            togglePane('tree');
          },
        },
        {
          label: L('Σύμβολα & γραφικά', 'Symbols & graphics'),
          checked: panes.symbols && layout.mode !== 'board' && layout.mode !== 'moves',
          onClick: () => {
            if (!panes.symbols) ensurePanelMode();
            togglePane('symbols');
          },
        },
        { separator: true, label: '' },
        {
          label: L('Βέλη μηχανής στη σκακιέρα', 'Engine arrows on board'),
          checked: showArrows,
          onClick: toggleArrows,
        },
        {
          label: L('Επαναφορά μεγεθών', 'Reset sizes'),
          onClick: () => {
            const l: Layout = { mode: layoutRef.current.mode };
            setLayout(l);
            saveLayout(l);
          },
        },
      ],
    });
  };

  // βέλη της μηχανής στη σκακιέρα: μόνο αν τα ζητήσει ο χρήστης
  const showArrows = ui.engineArrows === true;
  const toggleArrows = () => void useApp.getState().saveUi({ engineArrows: !showArrows }).catch(reportError);

  // φόρτωση παρτίδας από βάση
  useEffect(() => {
    if (loaded || !source) return;
    api
      .get<{ pgn: string }>(`/api/db/${source.dbId}/game/${source.gameId}`)
      .then((r) => {
        const err = ctrl.loadPgn(r.pgn);
        if (err) toast(err, 'error');
        // «Συνέχεια μελέτης»: στην κίνηση της κύριας γραμμής όπου είχε μείνει ο χρήστης
        if (tab.ply) {
          let n = ctrl.game.root;
          for (let i = 0; i < tab.ply && n.children.length; i++) n = n.children[0];
          ctrl.goTo(n);
        } else startExercise();
        setLoaded(true);
      })
      .catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, source, ctrl, toast]);


  const h = ctrl.game.headers;
  const title = useMemo(() => {
    const w = h.White && h.White !== '?' ? h.White.split(',')[0] : '';
    const b = h.Black && h.Black !== '?' ? h.Black.split(',')[0] : '';
    if (w || b) return `${w || '?'} – ${b || '?'}`;
    // χωρίς παίκτες: το γεγονός (π.χ. «Τακτική #005gP»), αλλιώς «Νέα παρτίδα»
    if (h.Event && h.Event !== '?') return h.Event;
    return gameNo ? L(`Νέα παρτίδα ${gameNo}`, `New game ${gameNo}`) : L('Νέα παρτίδα', 'New game');
  }, [h.White, h.Black, h.Event, gameNo]);
  useEffect(() => {
    updateTab(tab.id, { title: (ctrl.dirty ? '• ' : '') + title, source, targetDb } as Partial<GameTab>);
  }, [title, ctrl.dirty, source, targetDb, tab.id, updateTab]);

  // «Συνέχεια μελέτης» στις Βάσεις: η παρτίδα της βάσης και η κίνηση της κύριας γραμμής όπου έμεινε ο χρήστης.
  // Γράφεται όταν η καρτέλα γίνεται ενεργή και όταν φεύγει (όχι σε κάθε κίνηση).
  const study = useRef<StudyRecord | null>(null);
  if (source && loaded) {
    let n: GameNode = ctrl.node;
    while (!n.isMainline() && n.parent) n = n.parent;
    study.current = { dbId: source.dbId, gameId: source.gameId, title, event: h.Event && h.Event !== '?' ? h.Event : '', ply: n.ply };
  } else study.current = null;
  useEffect(() => {
    if (!active || !study.current) return;
    rememberStudy(study.current);
    return () => {
      if (study.current) rememberStudy(study.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, source?.dbId, source?.gameId, loaded]);

  const node = ctrl.node;
  const fen = node.fen;
  const pos = useMemo(() => Position.fromFen(fen), [fen]);
  const opening = useMemo(() => openingAt(eco, ctrl, node), [eco, ctrl, node]);

  // ---------------------------------------------------------------------
  // κινήσεις

  const playMove = useCallback(
    (from: number, to: number, promo: number) => {
      const m = pos.findMove(from, to, promo);
      if (!m) return;
      if (training) {
        // όπως η σημειογραφία, μόνο που οι επόμενες κινήσεις δεν φαίνονται: η κίνηση πρέπει να είναι μία από όσες
        // υπάρχουν εδώ (η κύρια ή μια βαριάντα)· νέα κίνηση δεν προστίθεται
        const expected = node.children[0];
        if (!expected) {
          // άσκηση χωρίς καταγεγραμμένη λύση: την κίνηση την κρίνει η μηχανή
          void checkExercise(node.fen, m);
          return;
        }
        const known = node.children.find((c) => c.move === m);
        if (known) {
          ctrl.goTo(known);
          setTraining({ tries: 0, message: known === expected ? L('Σωστά!', 'Correct!') : L(`Βαριάντα της ανάλυσης: ${known.san}`, `A line of the analysis: ${known.san}`) });
        } else if (training.tries + 1 >= 3) {
          ctrl.goTo(expected);
          setTraining({ tries: 0, message: L(`Η κίνηση ήταν ${expected.san}`, `The move was ${expected.san}`) });
        } else setTraining((t) => t && { ...t, tries: t.tries + 1, message: L('Όχι αυτή — δοκίμασε ξανά ή πάτα →', 'Not that one — try again or press →') });
        return;
      }
      ctrl.play(m);
    },
    [pos, ctrl, training, node],
  );

  /**
   * Άσκηση από βιβλίο (επικεφαλίδα «Exercise»): ανοίγει σε εκπαίδευση, από τη μεριά αυτού που παίζει, με κρυμμένη τη
   * λύση· το «Τέλος εκπαίδευσης» τη δείχνει.
   */
  const startExercise = () => {
    const g = ctrl.game;
    if (!g.headers.Exercise) return;
    ctrl.goTo(g.root);
    setPlay(null);
    setOrientation(Position.fromFen(g.root.fen).turn === 0 ? 'white' : 'black');
    setTraining({ tries: 0, message: L('Άσκηση: βρες την καλύτερη συνέχεια', 'Exercise: find the best continuation') });
  };

  /** Ελέγχει την κίνηση του χρήστη με τη μηχανή (για θέσεις-ασκήσεις). */
  const checkExercise = async (fenBefore: string, move: number) => {
    const before = Position.fromFen(fenBefore);
    const userSan = before.san(move);
    const userUci = before.moveToUci(move);
    before.makeMove(move);
    const fenAfter = before.fen();
    before.unmakeMove();
    const sign = before.turn === 0 ? 1 : -1;
    const score = (l: { cp: number | null; mate: number | null } | null) => (l?.mate != null ? (l.mate > 0 ? 10000 - l.mate : -10000 - l.mate) : (l?.cp ?? 0));
    setTraining((t) => t && { ...t, message: L(`${userSan}: η μηχανή ελέγχει…`, `${userSan}: engine is checking…`) });
    try {
      const best = await api.post<{ bestmove?: string; line: { cp: number | null; mate: number | null } | null }>('/api/engine/move', { fen: fenBefore, movetime: 1500 });
      const after = await api.post<{ line: { cp: number | null; mate: number | null } | null }>('/api/engine/move', { fen: fenAfter, movetime: 1000 });
      const bestMove = best.bestmove ? before.parseUci(best.bestmove) : 0;
      const bestSan = bestMove ? before.san(bestMove) : '?';
      const loss = sign * score(best.line) - sign * score(after.line);
      ctrl.play(move);
      setTraining((t) => {
        if (!t) return t;
        if (userUci === best.bestmove || loss <= 30) return { tries: 0, message: L(`${userSan} — εξαιρετικά!`, `${userSan} — excellent!`) };
        if (loss <= 100) return { tries: 0, message: L(`${userSan} — καλή, αλλά καλύτερη είναι ${bestSan}`, `${userSan} — good, but ${bestSan} is better`) };
        return { tries: 0, message: L(`${userSan} — όχι· η καλύτερη ήταν ${bestSan}`, `${userSan} — no; the best was ${bestSan}`) };
      });
    } catch (e) {
      reportError(e);
    }
  };

  const playUciLine = useCallback(
    (ucis: string[]) => {
      const p = Position.fromFen(ctrl.node.fen);
      const moves: number[] = [];
      for (const u of ucis) {
        const m = p.parseUci(u);
        if (!m) break;
        moves.push(m);
        p.makeMove(m);
      }
      if (!moves.length) return;
      if (moves.length === 1) ctrl.play(moves[0]);
      else ctrl.goTo(ctrl.addLine(ctrl.node, moves));
    },
    [ctrl],
  );

  // μηχανή αντίπαλος
  useEffect(() => {
    if (!play || play.thinking) return;
    const engineTurn = (pos.turn === 0 ? 'white' : 'black') !== play.color;
    if (!engineTurn || pos.status() !== 'ongoing') return;
    setPlay({ ...play, thinking: true });
    // με ρολόι: απλή διαχείριση χρόνου από το υπόλοιπο της μηχανής
    const c = clockRef.current;
    const left = c ? c[pos.turn === 0 ? 'w' : 'b'] : 0;
    const movetime = c ? Math.round(Math.max(100, Math.min(left * 0.3, left / 25 + c.inc * 0.8))) : play.movetime;
    api
      .post<{ bestmove?: string }>('/api/engine/move', { fen, movetime, skill: play.level })
      .then((r) => {
        const m = r.bestmove ? Position.fromFen(fen).parseUci(r.bestmove) : 0;
        // όχι αν το παιχνίδι τελείωσε στο μεταξύ (π.χ. έπεσε η σημαία)
        if (m && ctrl.node.fen === fen && playRef.current) ctrl.play(m, { replaceMainline: true });
      })
      .catch(reportError)
      .finally(() => setPlay((p) => p && { ...p, thinking: false }));
  }, [play, pos, fen, ctrl]);

  // ρολόι: σε κάθε κίνηση σταματά ο χρόνος αυτού που έπαιξε (+ προσαύξηση) και γράφεται [%clk]
  useEffect(() => {
    if (!play || !clock || node === clock.node) return;
    // μόνο κινήσεις μετά τη θέση του ρολογιού, όχι πλοήγηση προς τα πίσω
    let p = node.parent;
    while (p && p !== clock.node) p = p.parent;
    if (!p) return;
    const side = turnOf(clock.node);
    const left = clock[side] - (Date.now() - clock.since) + clock.inc;
    node.clock = fmtClock(left, true);
    setClock({ ...clock, [side]: left, since: Date.now(), node });
  }, [node, play, clock]);

  // ρολόι: ανανέωση της εμφάνισης και σημαία
  useEffect(() => {
    if (!play || !clock) return;
    const t = setInterval(() => {
      const side = turnOf(clock.node);
      if (remaining(clock, side) > 0) return setTick((x) => x + 1);
      toast(side === 'w' ? L('Έπεσε η σημαία των λευκών — κερδίζουν τα μαύρα', 'White’s flag fell — Black wins') : L('Έπεσε η σημαία των μαύρων — κερδίζουν τα λευκά', 'Black’s flag fell — White wins'), 'ok');
      ctrl.setHeaders({ ...ctrl.game.headers, Result: side === 'w' ? '0-1' : '1-0' });
      setPlay(null);
    }, 200);
    return () => clearInterval(t);
  }, [play, clock, ctrl, toast]);

  useEffect(() => {
    if (!play) return;
    const st = pos.status();
    if (st !== 'ongoing') {
      const msg = st === 'checkmate' ? L('Ματ!', 'Checkmate!') : st === 'stalemate' ? L('Πατ — ισοπαλία', 'Stalemate — draw') : L('Ισοπαλία', 'Draw');
      toast(msg, 'ok');
      const result = st === 'checkmate' ? (pos.turn === 0 ? '0-1' : '1-0') : '1/2-1/2';
      ctrl.setHeaders({ ...ctrl.game.headers, Result: result });
      setPlay(null);
    }
  }, [pos, play, toast, ctrl]);

  // ---------------------------------------------------------------------
  // ενέργειες

  const confirmDiscard = () => !ctrl.dirty || window.confirm(L('Η παρτίδα έχει αλλαγές που δεν αποθηκεύτηκαν. Συνέχεια;', 'The game has unsaved changes. Continue?'));

  // κλείσιμο με αλλαγές: ερώτηση αποθήκευσης (ζητείται από το App)
  const closeRequest = useApp((s) => s.closeRequest);
  const closeTab = useApp((s) => s.closeTab);
  const closeAfterSave = useRef(false);
  const closeNow = () => {
    useApp.setState({ closeRequest: null });
    dropController(tab.id);
    closeTab(tab.id);
  };

  /**
   * Αποθήκευση: χωρίς ερώτηση όταν η παρτίδα ανήκει σε βάση (η ίδια παρτίδα ή νέα στη βάση όπου
   * δημιουργήθηκε)· αλλιώς ερώτηση «σε ποια βάση;». `thenClose`: μετά κλείνει το παράθυρο.
   */
  const requestSave = async (thenClose: boolean, askDetails = true) => {
    // πρώτη αποθήκευση: πρώτα τα «Στοιχεία» (παίκτες, τουρνουά…), με OK συνεχίζει η αποθήκευση
    if (!source && askDetails) {
      closeAfterSave.current = thenClose;
      setDialog({ kind: 'header', thenSave: true });
      return;
    }
    const db = source?.dbId ?? targetDb;
    if (!db) {
      closeAfterSave.current = thenClose;
      setDialog({ kind: 'save' });
      return;
    }
    try {
      const pgn = ctrl.pgn();
      if (source) await api.put(`/api/db/${source.dbId}/game/${source.gameId}`, { pgn });
      else {
        const r = await api.post<{ ids: number[] }>(`/api/db/${db}/games`, { pgn });
        setSource({ dbId: db, gameId: r.ids[0] });
      }
      ctrl.markSaved();
      toast(L(`Αποθηκεύτηκε στη βάση «${dbName(db)}»`, `Saved to “${dbName(db)}”`), 'ok');
      void useApp.getState().refreshLibrary();
      if (thenClose) closeNow();
    } catch (e) {
      reportError(e);
    }
  };
  const library = useApp((s) => s.library);
  const dbName = (id: string) => library.find((d) => d.id === id)?.name ?? '';

  const newGame = (fenStr = START_FEN) => {
    if (!confirmDiscard()) return;
    ctrl.newGame(fenStr);
    setTargetDb((t) => source?.dbId ?? t);
    setSource(undefined);
    takeGameNumber();
    setTraining(null);
    setPlay(null);
  };

  const gotoNeighbor = async (dir: 1 | -1) => {
    if (!source?.viewKey || !confirmDiscard()) return;
    try {
      const r = await api.get<{ prev: number | null; next: number | null }>(`/api/db/${source.dbId}/neighbors?key=${encodeURIComponent(source.viewKey)}&game=${source.gameId}`);
      const id = dir > 0 ? r.next : r.prev;
      if (!id) return;
      const g = await api.get<{ pgn: string }>(`/api/db/${source.dbId}/game/${id}`);
      ctrl.loadPgn(g.pgn);
      setSource({ ...source, gameId: id });
      startExercise();
    } catch (e) {
      reportError(e);
    }
  };

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(L(`Αντιγράφηκε: ${what}`, `Copied: ${what}`), 'ok');
    } catch (e) {
      reportError(e);
    }
  };

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      if (/^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+(\s|$)/.test(text)) {
        Position.fromFen(text);
        newGame(text);
        return;
      }
      if (!confirmDiscard()) return;
      const err = ctrl.loadPgn(text);
      setSource(undefined);
      if (err) toast(err, 'error');
    } catch (e) {
      reportError(e);
    }
  };

  /** Η σκακιέρα ως αυτόνομο SVG (με ενσωματωμένα κομμάτια). */
  const diagramSvg = async (): Promise<string | null> => {
    const svgEl = document.querySelector(`[data-board="${tab.id}"] svg.board`) as SVGSVGElement | null;
    if (!svgEl) return null;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '640');
    clone.setAttribute('height', '640');
    const cache = new Map<string, string>();
    for (const img of Array.from(clone.querySelectorAll('image'))) {
      const href = img.getAttribute('href') ?? '';
      if (!cache.has(href)) {
        const txt = await fetch(href).then((r) => r.text());
        cache.set(href, 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(txt))));
      }
      img.setAttribute('href', cache.get(href)!);
    }
    return new XMLSerializer().serializeToString(clone);
  };

  const exportDiagram = async () => {
    const svg = await diagramSvg();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\p{L}\p{N} _-]/gu, '')}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nagName = (g: number) => (NAG_NAMES[g] ? L(NAG_NAMES[g].el, NAG_NAMES[g].en) : `$${g}`);
  /** υπομενού συμβόλων: «(κανένα)» και ένα στοιχείο ανά σύμβολο, με ✓ σε όσα έχει ήδη η κίνηση */
  const nagItems = (n: GameNode, list: number[], group: number[]): MenuItem[] => [
    { label: L('(κανένα)', '(none)'), checked: !n.nags.some((g) => group.includes(g)), onClick: () => ctrl.setNag(n, 0, group) },
    ...list.map((g) => {
      const on = n.nags.some((h) => sameNag(h, g));
      return { label: nagName(g), symbol: nagSymbol(g), checked: on, onClick: () => ctrl.setNag(n, on ? 0 : g, nagGroup(g)) };
    }),
  ];

  // δεξί κλικ σε κίνηση: σύμβολα, σχόλια, βαριάντες
  const moveMenu = (n: GameNode, x: number, y: number) => {
    const deletes: MenuItem[] = [
      { label: L('Βαριάντα', 'Variation'), onClick: () => ctrl.deleteVariation(n), danger: true, disabled: n.isMainline() },
      { label: L('Επόμενες κινήσεις', 'Remaining moves'), onClick: () => ctrl.deleteRemaining(n), danger: true, disabled: !n.children.length, shortcut: 'Del' },
      { label: L('Προηγούμενες κινήσεις', 'Previous moves'), onClick: () => ctrl.deletePrevious(n), danger: true, disabled: n.isRoot },
    ];
    const items: MenuItem[] = [
      { label: L('Σχόλιο πριν την κίνηση…', 'Text before move…'), onClick: () => setDialog({ kind: 'comment', node: n, before: true }), disabled: n.isRoot },
      { label: L('Σχόλιο μετά την κίνηση…', 'Text after move…'), onClick: () => setDialog({ kind: 'comment', node: n, before: false }) },
      { label: L('Σύμβολο κίνησης (!, ?, …)', 'Move symbol (!, ?, …)'), submenu: nagItems(n, MENU_NAGS.move, NAG_GROUPS.move), disabled: n.isRoot, shortcut: '!' },
      { label: L('Αξιολόγηση (+−, =, …)', 'Evaluation (+−, =, …)'), submenu: nagItems(n, MENU_NAGS.eval, [...NAG_GROUPS.eval, ...NAG_GROUPS.novelty]), disabled: n.isRoot, shortcut: '=' },
      { label: L('Πρόθεμα (∆, ⌓, …)', 'Prefix (∆, ⌓, …)'), submenu: nagItems(n, MENU_NAGS.prefix, NAG_GROUPS.prefix), disabled: n.isRoot },
      { separator: true, label: '' },
      { label: L('Προώθηση βαριάντας', 'Promote variation'), onClick: () => ctrl.promote(n), disabled: n.isMainline() },
      { label: L('Κάνε την κύρια γραμμή', 'Make main line'), onClick: () => ctrl.makeMainline(n), disabled: n.isMainline() },
      { label: L('Διαγραφή', 'Delete'), submenu: deletes, danger: true, disabled: deletes.every((d) => d.disabled) },
      { separator: true, label: '' },
      { label: L('Προσθήκη στο ρεπερτόριο…', 'Add to repertoire…'), onClick: () => setDialog({ kind: 'repertoire' }), disabled: n.isRoot },
      { label: L('Αντιγραφή FEN θέσης', 'Copy position FEN'), onClick: () => void copyText(n.fen, 'FEN') },
    ];
    setMenu({ x, y, items });
  };

  const moreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        { heading: true, label: L('Παρτίδα', 'Game') },
        { label: L('Πλήρης ανάλυση / έλεγχος λαθών…', 'Full analysis / blunder check…'), onClick: () => setDialog({ kind: 'analysis' }) },
        play
          ? { label: L('Τέλος παιχνιδιού με μηχανή', 'Stop engine game'), onClick: () => setPlay(null) }
          : { label: L('Παίξε με μηχανή…', 'Play the engine…'), onClick: () => setDialog({ kind: 'play' }) },
        { label: L('Σχόλιο μετά την κίνηση…', 'Comment after move…'), onClick: () => setDialog({ kind: 'comment', node: ctrl.node, before: false }) },
        { label: L('Σχόλιο παρτίδας…', 'Game comment…'), onClick: () => setDialog({ kind: 'comment', node: ctrl.game.root, before: false }) },
        { label: L('Αντιγραφή PGN', 'Copy PGN'), onClick: () => void copyText(ctrl.pgn(), 'PGN') },
        { label: L('Αντιγραφή FEN', 'Copy FEN'), onClick: () => void copyText(fen, 'FEN') },
        { label: L('Επικόλληση PGN / FEN', 'Paste PGN / FEN'), onClick: () => void paste() },
        { heading: true, label: L('Εξαγωγή', 'Export') },
        { label: L('Εξαγωγή διαγράμματος (SVG)', 'Export diagram (SVG)'), onClick: () => void exportDiagram() },
        { label: L('Εκτύπωση παρτίδας…', 'Print game…'), onClick: () => void diagramSvg().then((svg) => printGame(ctrl.game, style, svg)) },
        { label: L('Εκτύπωση φύλλου σημειογραφίας…', 'Print scoresheet…'), onClick: () => printScoresheet(ctrl.game, style) },
        { heading: true, label: L('Προετοιμασία', 'Preparation') },
        { label: L('Προσθήκη γραμμής στο ρεπερτόριο…', 'Add line to repertoire…'), onClick: () => setDialog({ kind: 'repertoire' }), disabled: ctrl.node.isRoot },
        { label: L('Αναφορά ανοίγματος…', 'Opening report…'), onClick: () => setDialog({ kind: 'report' }) },
        {
          label: L('Εκπαίδευση ανοιγμάτων από εδώ', 'Opening training from here'),
          onClick: () => openTab({ id: newTabId('train'), kind: 'trainer', title: L('Εκπαίδευση', 'Training'), dbId: source?.dbId ?? refDb ?? '', color: pos.turn === 0 ? 'white' : 'black', fen }),
        },
        { label: L('Εύρεση καινοτομίας…', 'Find novelty…'), onClick: () => setDialog({ kind: 'novelty' }), disabled: !ctrl.game.root.children.length },
        {
          label: L('Όμοιες δομές πιονιών', 'Similar pawn structures'),
          disabled: !refDb,
          submenu: PAWN_MODE_LABELS.map(([mode, el, en]) => ({
            label: L(el[0].toUpperCase() + el.slice(1), en[0].toUpperCase() + en.slice(1)),
            onClick: () => {
              const lib = useApp.getState().library.find((d) => d.id === refDb);
              openDbWith(refDb!, lib?.name ?? 'DB', { filter: { pawns: fen, ...(mode === 'exact' ? {} : { pawnsMode: mode }) } });
            },
          })),
        },
        { separator: true, label: '' },
        { label: L('Κενή κίνηση (--)', 'Null move (--)'), onClick: () => ctrl.play(NULL_MOVE), disabled: pos.inCheck() || Boolean(play) },
        {
          label: L('Αφαίρεση', 'Remove'),
          danger: true,
          submenu: [
            { label: L('Βαριαντών', 'Variations'), onClick: () => ctrl.strip({ variations: true }), danger: true },
            { label: L('Σχολίων', 'Comments'), onClick: () => ctrl.strip({ comments: true }), danger: true },
            { label: L('Συμβόλων', 'Symbols'), onClick: () => ctrl.strip({ nags: true }), danger: true },
            { label: L('Γραφικών', 'Graphics'), onClick: () => ctrl.strip({ shapes: true }), danger: true },
          ],
        },
      ],
    });
  };

  // ---------------------------------------------------------------------
  // επιλογή βαριάντας: το → σε διακλάδωση ανοίγει λίστα με τις
  // συνέχειες· ↑ ↓ για επιλογή, Enter / → για συνέχεια, Esc / ← για ακύρωση

  const [varPick, setVarPick] = useState<{ node: GameNode; index: number } | null>(null);
  const goForward = () => {
    if (ui.variationDialog !== false && ctrl.node.children.length > 1) setVarPick({ node: ctrl.node, index: 0 });
    else ctrl.forward();
  };
  const pickVariation = (i: number) => {
    const c = varPick?.node.children[i];
    setVarPick(null);
    if (c) ctrl.goTo(c);
  };
  useEffect(() => {
    if (varPick && varPick.node !== node) setVarPick(null);
  }, [node, varPick]);
  const moveLabel = (n: GameNode, first: boolean) => {
    const { startFullmove: sf, startTurn: st } = ctrl.game;
    const num = n.whiteMoved(st) ? `${n.moveNumber(sf, st)}.` : first ? `${n.moveNumber(sf, st)}...` : '';
    return num + displaySan(n.san, style);
  };
  const continuation = (c: GameNode) => {
    const out: string[] = [];
    for (let n = c.children[0], k = 0; n && k < 4; n = n.children[0], k++) out.push(moveLabel(n, false));
    return out.join(' ');
  };

  // ---------------------------------------------------------------------
  // πληκτρολόγιο

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const typed = useRef({ text: '', at: 0 });
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (dialog || closeRequest === tab.id) return;
    if (varPick) {
      const n = varPick.node.children.length;
      if (e.key === 'ArrowDown') setVarPick({ ...varPick, index: (varPick.index + 1) % n });
      else if (e.key === 'ArrowUp') setVarPick({ ...varPick, index: (varPick.index + n - 1) % n });
      else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') pickVariation(varPick.index);
      else if (e.key === 'Escape' || e.key === 'ArrowLeft') setVarPick(null);
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) pickVariation(Number(e.key) - 1);
      else return;
      e.preventDefault();
      return;
    }
    const ctrlKey = e.ctrlKey || e.metaKey;
    // εκπαίδευση: τα βελάκια κινούνται κανονικά, μόνο το «τέλος» (↓ / End) δεν επιτρέπεται
    if (training && (e.key === 'ArrowDown' || e.key === 'End')) {
      e.preventDefault();
      return;
    }
    // σύμβολα με το πληκτρολόγιο: ! ? !! ?? !? ?! = += =+ +/- -/+ +- -+ ~ (ασαφές)
    if (!ctrlKey && !e.altKey && e.key.length === 1 && '!?=+-/~'.includes(e.key) && !training) {
      e.preventDefault();
      if (ctrl.node.isRoot) return;
      const now = performance.now();
      let text = now - typed.current.at < 900 ? typed.current.text + e.key : e.key;
      if (!isNagTextPrefix(text)) text = e.key;
      typed.current = { text, at: now };
      const nag = textToNag(text);
      if (nag) ctrl.setNag(ctrl.node, nag);
      return;
    }
    switch (e.key) {
      case 'ArrowRight':
        goForward();
        break;
      case 'ArrowLeft':
        ctrl.back();
        break;
      case 'ArrowUp':
        ctrl.toStart();
        break;
      case 'ArrowDown':
        ctrl.toEnd();
        break;
      case 'Home':
        ctrl.toStart();
        break;
      case 'End':
        ctrl.toEnd();
        break;
      case 'z':
      case 'Z':
        if (ctrlKey) (e.shiftKey ? ctrl.redo() : ctrl.undo());
        else return;
        break;
      case 'y':
        if (ctrlKey) ctrl.redo();
        else return;
        break;
      case 's':
        if (ctrlKey) void requestSave(false);
        else return;
        break;
      case 'f':
        if (!ctrlKey) setOrientation((o) => (o === 'white' ? 'black' : 'white'));
        else return;
        break;
      case 'Delete':
        if (!ctrl.node.isRoot) ctrl.deleteRemaining(ctrl.node);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  useEffect(() => {
    if (!active) return;
    const fn = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [active]);

  // ---------------------------------------------------------------------
  // γράφημα αξιολόγησης από [%eval]

  const graph = useMemo(() => {
    const main = [ctrl.game.root, ...ctrl.game.mainline()];
    const pts = main.map((n, i) => {
      if (i === 0) return { cp: 20, mate: null };
      const p = parseEvalText(n.evalText);
      if (!p) return null;
      const mark = n.nags.includes(4) ? 3 : n.nags.includes(2) ? 2 : n.nags.includes(6) ? 1 : 0;
      return { ...p, mark };
    });
    const hasAny = pts.slice(1).some(Boolean);
    const idx = main.indexOf(node);
    return hasAny ? { pts, idx, main } : null;
  }, [ctrl.version]);

  const engineHints: Shape[] = useMemo(() => {
    const out: Shape[] = [];
    for (const lines of Object.values(hints)) {
      for (const l of lines.slice(0, 2)) {
        const u = l.uci[0];
        if (!u) continue;
        const m = pos.parseUci(u);
        if (!m || m & F_NULL) continue;
        if (!out.some((s) => s.from === moveFrom(m) && s.to === moveTo(m))) out.push({ color: 'E', from: moveFrom(m), to: moveTo(m) });
      }
    }
    return out;
  }, [hints, pos]);

  // η μπάρα αξιολόγησης μένει όσο τρέχει η μηχανή (με την τελευταία τιμή μέχρι να έρθει η νέα):
  // αν εξαφανιζόταν σε κάθε κίνηση, η σκακιέρα άλλαζε πλάτος και «έτρεμε»
  const engineOn = panes.engine && Object.values(running).some(Boolean);
  const topEval = Object.values(hints)[0]?.[0];
  if (topEval) lastEval.current = topEval;
  if (!engineOn) lastEval.current = null;
  const shownEval = topEval ?? lastEval.current;
  const showEvalBar = engineOn;

  const playerLine = (color: 'white' | 'black') => {
    const name = color === 'white' ? h.White : h.Black;
    const elo = color === 'white' ? h.WhiteElo : h.BlackElo;
    return (
      <span className={`player ${color}`}>
        <span className="dot" />
        {name && name !== '?' ? name : color === 'white' ? L('Λευκά', 'White') : L('Μαύρα', 'Black')}
        {elo && <span className="elo">{elo}</span>}
      </span>
    );
  };

  /** live: όνομα, τίτλος, Elo και ρολόι του παίκτη αυτού του χρώματος (πάνω ο αντίπαλος της πλευράς της σκακιέρας) */
  const liveBar = (color: 'white' | 'black') => {
    const st = liveState!;
    const s = color === 'white' ? 'w' : 'b';
    const ms = liveRemaining(st, s);
    const on = st.status === 'live' && st.clocks?.turn === s;
    const name = color === 'white' ? h.White : h.Black;
    const title = color === 'white' ? h.WhiteTitle : h.BlackTitle;
    const elo = color === 'white' ? h.WhiteElo : h.BlackElo;
    const res = h.Result && h.Result !== '*' ? h.Result.split('-')[color === 'white' ? 0 : 1].replace('1/2', '½') : '';
    return (
      <div className={`live-bar ${color}${on ? ' on' : ''}`}>
        <span className="live-who">
          <span className={`live-dot ${color}`} />
          {title && <b className="live-title">{title}</b>}
          <span className="live-name">{name && name !== '?' ? name : color === 'white' ? L('Λευκά', 'White') : L('Μαύρα', 'Black')}</span>
          {elo && elo !== '?' && <span className="live-elo">{elo}</span>}
          {res && <b className="live-score">{res}</b>}
        </span>
        {ms !== null && <span className={`live-clock${on ? ' on' : ''}${on && ms < 60_000 ? ' low' : ''}`}>{fmtClock(ms, ms >= 3_600_000)}</span>}
      </div>
    );
  };

  // κοινή ανάλυση χωρίς άδεια αλλαγών: η σκακιέρα μόνο δείχνει
  const movable = ctrl.locked ? 'none' : play ? play.color : training ? (pos.turn === 0 ? 'white' : 'black') : 'both';

  const meta = [h.Event, h.Site, h.Date?.replace(/\.\?\?/g, ''), h.Round && h.Round !== '?' ? `${L('γύρος', 'rd')} ${h.Round}` : '']
    .filter((x) => x && x !== '?' && x !== '????')
    .join(' · ');
  // κενή σημειογραφία: τι μπορεί να κάνει κανείς (όχι σε live, παιχνίδι, εκπαίδευση, κοινή ανάλυση)
  const noMoves = !ctrl.game.root.children.length && !ctrl.game.root.comment && !tab.live && !play && !training && !share;
  const notation = (
    <div className="notation-wrap">
      {noMoves ? (
        <div className="bw-empty">
          <div className="bw-empty-ic">
            <List size={24} />
          </div>
          <b>{L('Δεν υπάρχουν κινήσεις ακόμη', 'No moves yet')}</b>
          <span>{L('Παίξε στη σκακιέρα ή ξεκίνα από εδώ:', 'Play on the board or start here:')}</span>
          <div className="bw-empty-act">
            <button className="kb-btn sm" onClick={() => void paste()}>
              <ClipboardPaste size={14} />
              {L('Επικόλληση PGN / FEN', 'Paste PGN / FEN')}
            </button>
            <button className="kb-btn sm" onClick={() => setDialog({ kind: 'setup' })}>
              <Grid3x3 size={14} />
              {L('Στήσε θέση', 'Set up a position')}
            </button>
            <button className="kb-btn sm" onClick={() => setDialog({ kind: 'header' })}>
              <Pencil size={14} />
              {L('Στοιχεία παρτίδας', 'Game details')}
            </button>
          </div>
          <p className="bw-keys">
            <kbd>←</kbd>
            <kbd>→</kbd> {L('κινήσεις', 'moves')} · <kbd>F</kbd> {L('γύρισμα', 'flip')} · <kbd>Ctrl</kbd>+<kbd>V</kbd> {L('επικόλληση', 'paste')}
          </p>
        </div>
      ) : (
        <Notation ctrl={ctrl} style={style} hideFuture={Boolean(training)} onMoveContext={moveMenu} onEditComment={(n, before) => setDialog({ kind: 'comment', node: n, before })} />
      )}
    </div>
  );
  // καρτέλες πάνω από το περιεχόμενό τους· στη μία στήλη, ξανά κλικ στην ανοιχτή την κλείνει
  const tabBtn = (id: Pane, icon: React.ReactNode, label: string) => (
    <button aria-pressed={panes[id]} onClick={() => togglePane(id)}>
      {icon}
      {label}
    </button>
  );
  const panelTabs = (
    <div className="bw-ptabs">
      {layout.mode !== 'moves' && (
        <div className="kb-sgc">
          {tabBtn('engine', <Cpu size={15} />, L('Μηχανή', 'Engine'))}
          {tabBtn('tree', <Database size={15} />, L('Αναφορά', 'Reference'))}
          {tabBtn('symbols', <Highlighter size={15} />, L('Σύμβολα & γραφικά', 'Symbols & graphics'))}
        </div>
      )}
      <span className="spacer" />
      <button className="bw-tb" title={L('Προβολή: ποια παράθυρα φαίνονται', 'View: which panels are shown')} onClick={viewMenu}>
        <LayoutPanelLeft size={16} />
        <span>{L('Προβολή', 'View')}</span>
        <ChevronDown size={14} className="chev" />
      </button>
    </div>
  );
  const engineExtra = (
    <>
      <button className="kb-chip" aria-pressed={showArrows} onClick={toggleArrows} title={L('Βέλη με τις καλύτερες κινήσεις της μηχανής πάνω στη σκακιέρα', 'Arrows with the engine’s best moves on the board')}>
        <MoveUpRight size={13} />
        {L('Βέλη', 'Arrows')}
      </button>
      {engines.length < 2 && (
        <button className="kb-chip" onClick={() => setEngines((e) => [...e, `${tab.id}-e${e.length + 1}`])} title={L('Δεύτερη μηχανή', 'Second engine')}>
          <Plus size={13} />
          {L('Δεύτερη', 'Second')}
        </button>
      )}
    </>
  );
  const engineBody = panes.engine && (
    <div className="bw-eng">
      {engines.map((sid, i) => (
          <EnginePanel
            key={sid}
            session={sid}
            fen={fen}
            style={style}
            autoStart={i > 0 || Boolean(tab.engine)}
            extra={i === 0 ? engineExtra : undefined}
            onPlayLine={playUciLine}
            onBest={(lines, run) => {
              setHints((hh) => ({ ...hh, [sid]: lines }));
              setRunning((rr) => (rr[sid] === run ? rr : { ...rr, [sid]: run }));
            }}
            onClose={
              i > 0
                ? () => {
                    setEngines((e) => e.filter((x) => x !== sid));
                    setHints((hh) => {
                      const c = { ...hh };
                      delete c[sid];
                      return c;
                    });
                    setRunning((rr) => {
                      const c = { ...rr };
                      delete c[sid];
                      return c;
                    });
                  }
                : undefined
            }
          />
        ))}
    </div>
  );
  const restOpen = panes.tree || panes.symbols;
  const restBody = (
    <>
      {panes.tree && (
        <TreePanel
          fen={fen}
          style={style}
          dbId={refDb}
          onDbChange={setTreeDb}
          onOpenGame={(dbId, gameId) => openTab({ id: newTabId('game'), kind: 'game', title: '…', source: { dbId, gameId } })}
          onPlay={(u) => playUciLine([u])}
          onShowGames={(dbId, f) => {
            const lib = useApp.getState().library.find((d) => d.id === dbId);
            openTab({ id: `db-${dbId}`, kind: 'db', dbId, title: lib?.name ?? 'DB', fen: f });
            window.dispatchEvent(new CustomEvent('knightbase:position-search', { detail: { dbId, fen: f } }));
          }}
        />
      )}
      {panes.symbols && <NagPalette ctrl={ctrl} node={node} />}
    </>
  );

  return (
    <div className={`board-window layout-${layout.mode}`}>
      <div className="bw-left" style={{ width: leftWidth }}>
        {liveState && liveBar(orientation === 'white' ? 'black' : 'white')}
        <div className="bw-board-row">
          {showEvalBar && <EvalBar cp={shownEval?.cp ?? 0} mate={shownEval?.mate ?? null} flipped={orientation === 'black'} />}
          <div className="bw-board" data-board={tab.id}>
            <Board
              fen={fen}
              orientation={orientation}
              movable={movable as 'both'}
              lastMove={node.isRoot || node.move & F_NULL ? undefined : node.move}
              shapes={node.shapes}
              hintArrows={showArrows ? engineHints : []}
              theme={settings?.boardTheme}
              pieceSet={settings?.pieceSet}
              coordinates={settings?.showCoordinates ?? true}
              onMove={playMove}
              onShape={(s) => ctrl.toggleShape(node, s)}
              animationMs={settings?.animationMs ?? 250}
              oneClick={ui.oneClick !== false}
            />
            {varPick && (
              <div className="var-chooser" role="listbox" aria-label={L('Επιλογή βαριάντας', 'Choose a variation')}>
                <div className="var-title">{L('Βαριάντες', 'Variations')}</div>
                {varPick.node.children.map((c, i) => (
                  <button key={i} role="option" aria-selected={i === varPick.index} className={i === varPick.index ? 'on' : ''} onMouseEnter={() => setVarPick({ ...varPick, index: i })} onClick={() => pickVariation(i)}>
                    <b>{moveLabel(c, true)}</b> {!training && <span className="cont">{continuation(c)}</span>}
                  </button>
                ))}
                <div className="var-hint">↑ ↓ · Enter · Esc</div>
              </div>
            )}
          </div>
        </div>
        {liveState && liveBar(orientation)}
        <div className="nav-bar">
          <button className="icon-btn" title={L('Αρχή (↑)', 'Start (↑)')} onClick={() => ctrl.toStart()}>
            <ChevronFirst size={18} />
          </button>
          <button className="icon-btn" title={L('Πίσω (←)', 'Back (←)')} onClick={() => ctrl.back()}>
            <ChevronLeft size={18} />
          </button>
          <button className="icon-btn" title={L('Μπροστά (→)', 'Forward (→)')} onClick={goForward}>
            <ChevronRight size={18} />
          </button>
          <button className="icon-btn" title={L('Τέλος (↓)', 'End (↓)')} onClick={() => ctrl.toEnd()} disabled={Boolean(training)}>
            <ChevronLast size={18} />
          </button>
          <span className="sep" />
          <button className="icon-btn" title={L('Γύρισμα σκακιέρας (F)', 'Flip board (F)')} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <FlipVertical2 size={17} />
          </button>
          {source?.viewKey && (
            <>
              <span className="sep" />
              <button className="icon-btn" title={L('Προηγούμενη παρτίδα', 'Previous game')} onClick={() => void gotoNeighbor(-1)}>
                <SkipBack size={16} />
              </button>
              <button className="icon-btn" title={L('Επόμενη παρτίδα', 'Next game')} onClick={() => void gotoNeighbor(1)}>
                <SkipForward size={16} />
              </button>
            </>
          )}
          <span className="spacer" />
          {/* (στην εκπαίδευση το μήνυμά της, σε μία γραμμή: χωρίς πλαίσιο που αλλάζει ύψος και μετακινεί τη σκακιέρα) */}
          <span className="fen-turn" title={training?.message}>
            {training ? training.message : pos.turn === 0 ? L('Παίζουν τα λευκά', 'White to move') : L('Παίζουν τα μαύρα', 'Black to move')}
          </span>
        </div>
        {graph && (
          <EvalGraph
            points={graph.pts}
            current={graph.idx}
            onSelect={(i) => {
              const n = graph.main[i];
              if (n) ctrl.goTo(n);
            }}
          />
        )}
        {play && (
          <div className="mode-banner play">
            <Bot size={16} /> {L('Παιχνίδι με μηχανή', 'Playing the engine')} · {L('επίπεδο', 'level')} {play.level}
            {clock && (
              <span className="clocks">
                {(['w', 'b'] as const).map((s) => (
                  <span key={s} className={`clock${turnOf(clock.node) === s ? ' on' : ''}${remaining(clock, s) < 10_000 ? ' low' : ''}`}>
                    {s === 'w' ? '♔' : '♚'} {fmtClock(remaining(clock, s))}
                  </span>
                ))}
              </span>
            )}
            <span className="msg">{play.thinking ? L('η μηχανή σκέφτεται…', 'engine thinking…') : ''}</span>
            <button onClick={() => setPlay(null)}>{L('Τέλος', 'Stop')}</button>
          </div>
        )}
        {liveState && (() => {
          let mainEnd = ctrl.game.root;
          while (mainEnd.children.length) mainEnd = mainEnd.children[0];
          const jump = live.state ? live.toLive : ctrl.node !== mainEnd ? () => ctrl.goTo(mainEnd) : null;
          const jumpLabel =
            live.state && live.newMoves > 0 && live.latestMove
              ? L(`Νέα κίνηση: ${live.latestMove} · Στο live`, `New move: ${live.latestMove} · Back to live`)
              : L('Στο live', 'Back to live');
          return (
            <div className={`mode-banner live s-${liveState.status}`}>
              <Radio size={16} />
              <span className="live-tag">
                {liveState.status === 'live' ? 'LIVE' : liveState.status === 'ended' ? L('Τέλος', 'Finished') : liveState.status === 'connecting' ? L('Σύνδεση…', 'Connecting…') : L('Διακόπηκε', 'Stopped')}
                {liveState.status === 'ended' && h.Result && h.Result !== '*' && <b> · {h.Result.replace('1/2-1/2', '½-½')}</b>}
              </span>
              <span className="msg">{liveState.status === 'error' ? liveError(liveState.error) : ''}</span>
              {jump && (
                <button className={live.newMoves > 0 ? 'is-new' : undefined} onClick={jump}>
                  {jumpLabel}
                </button>
              )}
              {tab.live && !share && (
                <button
                  className="live-share-btn"
                  title={L('Άνοιγμα κοινής ανάλυσης πάνω σε αυτή τη live παρτίδα', 'Start shared analysis on this live game')}
                  onClick={() => {
                    setPlay(null);
                    setTraining(null);
                    setShare('new');
                  }}
                >
                  <Radio size={13} />
                  {L('Κοινή ανάλυση', 'Shared analysis')}
                </button>
              )}
              {live.state?.status === 'error' && live.state.error === 'auth' && <button onClick={lichessLogin}>{L('Σύνδεση με Lichess', 'Connect Lichess')}</button>}
              {live.state?.status === 'error' && <button onClick={live.retry}>{L('Ξανά', 'Retry')}</button>}
            </div>
          );
        })()}
      </div>

      {layout.mode !== 'board' && <div className="splitter vertical" onPointerDown={drag('left')} title={L('Σύρε για αλλαγή μεγέθους', 'Drag to resize')} />}
      {layout.mode === 'board' && (
        <button className="view-float" onClick={viewMenu}>
          <LayoutPanelLeft size={15} /> {L('Προβολή', 'View')}
        </button>
      )}

      <div
        className={`bw-right${shareW ? ' share-col' : ''}`}
        style={layout.mode === 'board' ? { display: 'none' } : shareW ? ({ '--share-w': `${shareW}px` } as React.CSSProperties) : undefined}
      >
        <div className="bw-tools-wrap">
          <div className="bw-tools" role="toolbar" data-guide="board-tools">
            <button className="bw-tb" title={L('Νέα παρτίδα', 'New game')} onClick={() => newGame()}>
              <FilePlus2 size={16} />
              <span>{L('Νέα', 'New')}</span>
            </button>
            <button className={`bw-tb${ctrl.dirty ? ' dirty' : ''}`} title={L('Αποθήκευση (Ctrl+S)', 'Save (Ctrl+S)')} onClick={() => void requestSave(false)}>
              <Save size={16} />
              <span>{L('Αποθήκευση', 'Save')}</span>
            </button>
            <button className="bw-tb ic" title={L('Αναίρεση (Ctrl+Z)', 'Undo (Ctrl+Z)')} disabled={!ctrl.canUndo} onClick={() => ctrl.undo()}>
              <Undo2 size={16} />
            </button>
            <button className="bw-tb ic" title={L('Επανάληψη (Ctrl+Y)', 'Redo (Ctrl+Y)')} disabled={!ctrl.canRedo} onClick={() => ctrl.redo()}>
              <Redo2 size={16} />
            </button>
            <span className="bw-sep" />
            <button className="bw-tb" title={L('Στοιχεία παρτίδας', 'Game data')} onClick={() => setDialog({ kind: 'header' })}>
              <Pencil size={16} />
              <span>{L('Στοιχεία', 'Details')}</span>
            </button>
            <button
              className={`bw-tb${training ? ' on' : ''}`}
              title={L('Εκπαίδευση: κρύβει τις επόμενες κινήσεις (τα βελάκια δουλεύουν κανονικά)', 'Training: hides the next moves (arrow keys still work)')}
              onClick={() => {
                if (training) setTraining(null);
                else {
                  setPlay(null);
                  setTraining({ tries: 0, message: L('Βρες την επόμενη κίνηση', 'Find the next move') });
                }
              }}
            >
              <GraduationCap size={16} />
              <span>{training ? L('Τέλος εκπαίδευσης', 'Stop training') : L('Εκπαίδευση', 'Training')}</span>
            </button>
            <button className="bw-tb" title={L('Στήσε θέση (επεξεργασία)', 'Set up position (edit)')} onClick={() => setDialog({ kind: 'setup' })}>
              <Grid3x3 size={16} />
              <span>{L('Στήσε θέση', 'Set up position')}</span>
            </button>
            <button
              className={`bw-tb${share ? ' on' : ''}`}
              title={L('Κοινή ανάλυση live: link για να αναλύσετε μαζί αυτή την παρτίδα', 'Live shared analysis: a link to analyse this game together')}
              onClick={() => {
                if (share) return;
                if (layoutRef.current.mode === 'board') setMode('full');
                setPlay(null);
                setTraining(null);
                setShare('new');
              }}
            >
              <Radio size={16} />
              <span>{L('Κοινή ανάλυση', 'Shared analysis')}</span>
            </button>
            <button
              className={`bw-tb${videoOpen ? ' on' : ''}`}
              title={L('Βίντεο από YouTube, Twitch ή Kick (live μετάδοση ή ανάλυση)', 'YouTube, Twitch or Kick video (live broadcast or analysis)')}
              onClick={() => {
                if (!videoOpen && layoutRef.current.mode === 'board') setMode('full');
                setVideoOpen((o) => !o);
              }}
            >
              <Tv size={16} />
              <span>{L('Βίντεο', 'Video')}</span>
            </button>
            <span className="bw-sep" />
            <button className="bw-tb" title={L('Περισσότερα', 'More')} onClick={moreMenu}>
              <MoreHorizontal size={16} />
              <span>{L('Περισσότερα', 'More')}</span>
              <ChevronDown size={14} className="chev" />
            </button>
          </div>
        </div>

        {shareW > 0 && <div className="splitter vertical share-split" onPointerDown={drag('share')} title={L('Σύρε για αλλαγή μεγέθους', 'Drag to resize')} />}
        {share ? (
          <ShareHost
            ctrl={ctrl}
            start={share}
            fen={fen}
            lines={hints[engines[0]]}
            title={tab.title}
            tabId={tab.id}
            live={live.state}
            onLive={setRemoteLive}
            video={{ open: videoOpen, localId: videoId, onLocalId: setVideoId, onOpenChange: setVideoOpen }}
            leaveSignal={shareLeaveSignal}
            onRoom={setShare}
            onStop={() => {
              if (onShareExit) onShareExit();
              else setShare(null);
            }}
            onEnded={
              onShareEnded
                ? () => {
                    setShare(null);
                    onShareEnded();
                  }
                : undefined
            }
          />
        ) : (
          videoOpen && (
            <div className="sa-panel video-panel">
              <VideoEmbed
                videoId={videoId}
                editable
                onChange={setVideoId}
                onClose={() => {
                  setVideoId(null);
                  setVideoOpen(false);
                }}
              />
            </div>
          )
        )}

        <div className="game-head">
          <div className="gh-main">
            <div className="players">
              {playerLine('white')}
              <span className="dash">–</span>
              {playerLine('black')}
              {h.Result && h.Result !== '*' && <span className="res">{h.Result.replace('1/2-1/2', '½-½')}</span>}
            </div>
            {(meta || opening) && (
              <div className="game-meta">
                {meta && <span>{meta}</span>}
                {opening && (
                  <span className="opening-line">
                    <b>{opening.eco}</b> {opening.name}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={`bw-panes ${twoCols ? 'columns' : layout.mode === 'columns' ? 'full' : layout.mode}`}>
          {twoCols ? (
            <>
              <div className="bw-notes">
                <div className="bw-colh">
                  <List size={14} />
                  {L('Κινήσεις', 'Moves')}
                </div>
                {notation}
              </div>
              <div className="splitter vertical" onPointerDown={drag('side')} title={L('Σύρε για αλλαγή μεγέθους', 'Drag to resize')} />
              <div className="bw-side" style={{ width: sideWidth }}>
                {panelTabs}
                {engineBody}
                {restOpen ? <div className="bw-panel">{restBody}</div> : !panes.engine && <p className="muted small pad">{L('Άνοιξε «Μηχανή», «Αναφορά» ή «Σύμβολα» (και μαζί).', 'Open “Engine”, “Reference” or “Symbols” (also together).')}</p>}
              </div>
            </>
          ) : (
            <>
              {panelTabs}
              {layout.mode !== 'moves' && engineBody}
              {layout.mode !== 'moves' && restOpen && (
                <>
                  <div className="bw-panel" style={{ height: bottomHeight }}>
                    {restBody}
                  </div>
                  <div className="splitter horizontal" onPointerDown={drag('bottom')} title={L('Σύρε για αλλαγή μεγέθους', 'Drag to resize')} />
                </>
              )}
              {notation}
            </>
          )}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog?.kind === 'comment' && <CommentDialog ctrl={ctrl} node={dialog.node} before={dialog.before} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'header' && (
        <HeaderDialog
          ctrl={ctrl}
          onClose={() => {
            closeAfterSave.current = false;
            setDialog(null);
          }}
          onOk={
            dialog.thenSave
              ? () => {
                  setDialog(null);
                  void requestSave(closeAfterSave.current, false);
                }
              : undefined
          }
        />
      )}
      {dialog?.kind === 'setup' && (
        <SetupDialog
          initialFen={fen}
          onClose={() => setDialog(null)}
          onDone={(f) => {
            setDialog(null);
            newGame(f);
          }}
        />
      )}
      {dialog?.kind === 'save' && (
        <SaveDialog
          ctrl={ctrl}
          source={source}
          onClose={() => {
            closeAfterSave.current = false;
            setDialog(null);
          }}
          onSaved={(dbId, gameId) => {
            setSource((s) => ({ dbId, gameId, viewKey: s?.dbId === dbId ? s.viewKey : undefined }));
            setTargetDb(dbId);
            toast(L('Η παρτίδα αποθηκεύτηκε', 'Game saved'), 'ok');
            void useApp.getState().refreshLibrary();
            if (closeAfterSave.current) closeNow();
          }}
        />
      )}
      {closeRequest === tab.id && (
        <WinDialog
          title={L('Παρτίδα', 'Game')}
          onClose={() => useApp.setState({ closeRequest: null })}
          footer={
            <>
              <button
                className="win-btn default"
                autoFocus
                onClick={() => {
                  useApp.setState({ closeRequest: null });
                  void requestSave(true);
                }}
              >
                {L('Ναι', 'Yes')}
              </button>
              <button className="win-btn" onClick={closeNow}>
                {L('Όχι', 'No')}
              </button>
              <button className="win-btn" onClick={() => useApp.setState({ closeRequest: null })}>
                {L('Άκυρο', 'Cancel')}
              </button>
            </>
          }
        >
          <div className="win-msg">
            <span className="win-icon">?</span>
            <div>
              <div>{L('Αποθήκευση;', 'Save?')}</div>
              <div className="muted small">
                {title}
                {source?.dbId || targetDb ? ` → ${dbName((source?.dbId ?? targetDb)!)}` : ''}
              </div>
            </div>
          </div>
        </WinDialog>
      )}
      {dialog?.kind === 'analysis' && (
        <FullAnalysisDialog
          ctrl={ctrl}
          onClose={() => setDialog((d) => (d?.kind === 'analysis' ? null : d))}
          onDone={(_evals, summary) => setDialog({ kind: 'summary', summary })}
        />
      )}
      {dialog?.kind === 'report' && (
        <OpeningReportDialog
          fen={fen}
          opening={opening ? `${opening.eco} ${opening.name}` : ''}
          defaultDb={refDb}
          onClose={() => setDialog(null)}
          onOpenGame={(dbId, gameId, viewKey) => openTab({ id: newTabId('game'), kind: 'game', title: '…', source: { dbId, gameId, viewKey } })}
        />
      )}
      {dialog?.kind === 'novelty' && <NoveltyDialog ctrl={ctrl} source={source} defaultDb={refDb} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'repertoire' && <RepertoireAddDialog ctrl={ctrl} node={node} opening={opening ? `${opening.eco} ${opening.name}` : ''} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'summary' && <SummaryDialog summary={dialog.summary} white={h.White ?? ''} black={h.Black ?? ''} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'play' && (
        <PlayDialog
          onClose={() => setDialog(null)}
          onStart={(s) => {
            setDialog(null);
            setTraining(null);
            setOrientation(s.color);
            // νέα παρτίδα: κεφαλίδα με τους παίκτες και τον χρονικό έλεγχο
            if (!h.White || h.White === '?') {
              const me = L('Παίκτης', 'Player');
              const engine = settings?.engines.find((e) => e.id === settings.defaultEngine)?.name ?? 'Engine';
              const d = new Date();
              ctrl.setHeaders({
                ...h,
                Event: L('Παιχνίδι με μηχανή', 'Engine game'),
                Date: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
                White: s.color === 'white' ? me : engine,
                Black: s.color === 'white' ? engine : me,
                ...(s.clock ? { TimeControl: `${s.clock.base}+${s.clock.inc}` } : {}),
              });
            }
            setClock(s.clock ? { w: s.clock.base * 1000, b: s.clock.base * 1000, inc: s.clock.inc * 1000, since: Date.now(), node: ctrl.node } : null);
            setPlay({ ...s, thinking: false });
          }}
        />
      )}
    </div>
  );
}
