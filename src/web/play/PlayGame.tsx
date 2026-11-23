/**
 * Η παρτίδα με bot ή με φίλο στην ίδια σκακιέρα, από την αρχική θέση ή από θέση με στόχο (κέρδισε ή κράτα
 * ισοπαλία): σκακιέρα με μπάρες παικτών και ρολόγια, λίστα κινήσεων, πάρε πίσω, ισοπαλία, εγκατάλειψη,
 * βοήθειες και (στις θέσεις με στόχο) έλεγχος κάθε κίνησης από τη μηχανή. Από το RealChessBase (Λάζαρος
 * Μπατσής, GPL-3.0), προσαρμοσμένο στο Ruru.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheck, CircleX, Copy, Flag, FlipVertical2, Handshake, Lightbulb, RotateCcw } from 'lucide-react';
import { Position, START_FEN } from '../../core/chess.ts';
import { Game, type GameNode } from '../../core/game.ts';
import { Board } from '../components/Board.tsx';
import { useDrawnShapes } from '../components/drawnShapes.ts';
import type { Premove } from '../components/quickMove.ts';
import { EvalBar } from '../components/EnginePanel.tsx';
import { displaySan, type NotationStyle } from '../components/Notation.tsx';
import { Tag } from '../components/ui/Chip.tsx';
import { Spinner } from '../components/ui/Progress.tsx';
import { Switch } from '../components/ui/Switch.tsx';
import { api, type PvLine } from '../api.ts';
import { GameController, useController } from '../gameModel.ts';
import { L } from '../i18n.ts';
import { playMoveSound, playSound } from '../sounds.ts';
import { useApp } from '../store.ts';
import { useBoardSettings, useScreenKeys } from '../tactics/common.tsx';
import { setUiLater } from '../tactics/store.ts';
import { evalLabel, keepsGoal, solverEval } from '../tactics/practice.ts';
import { pressureAcceptsDraw } from '../../core/pressure.ts';
import { acceptsDraw, outcomeFor, practiceSuccess, repetitions, type BotSpec } from './bots.ts';
import { clockMovetime, reasonText, requestBotMove, type EndReason, type PlayHints, type PlayResult, type PlaySettings } from './session.ts';
import { usePlayHints } from './useHints.ts';
import { BotFace } from './faces.tsx';

export const t2 = (p: [string, string]) => L(p[0], p[1]);

/** «1 κίνηση», «3 κινήσεις» (και στα αγγλικά). */
export const count = (n: number, el: [string, string], en: [string, string]) => L(`${n} ${n === 1 ? el[0] : el[1]}`, `${n} ${n === 1 ? en[0] : en[1]}`);

export const eloTag = (b: BotSpec) => (b.id === 'full' ? L('πλήρης δύναμη', 'full strength') : `~${b.elo}`);

/** Το εικονίδιο ενός bot: το αρχικό του ονόματος, χρωματισμένο ανά στυλ. */
export function BotAvatar({ bot, large }: { bot: BotSpec; large?: boolean }) {
  return (
    <span className={`bot-av bot-av-face${large ? ' bot-av-lg' : ''}`} aria-hidden>
      <BotFace bot={bot} />
    </span>
  );
}

type Side = 'w' | 'b';
interface Clock {
  w: number;
  b: number;
  inc: number;
  /** πότε ξεκίνησε να μετρά ο χρόνος της πλευράς `side` */
  since: number;
  side: Side;
  /** ημικινήσεις της παρτίδας στο τελευταίο σημείο που ενημερώθηκε */
  ply: number;
}

const turnOfFen = (fen: string): Side => (fen.split(' ')[1] === 'b' ? 'b' : 'w');
const left = (c: Clock, side: Side) => c[side] - (c.side === side ? Date.now() - c.since : 0);

/** m:ss (δέκατα κάτω από 10 δευτ.)· με `pgn` h:mm:ss για το [%clk]. */
function fmtClock(ms: number, pgn = false): string {
  const s = Math.max(0, ms) / 1000;
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  if (pgn) return `${Math.floor(s / 3600)}:${mmss(s % 3600).padStart(5, '0')}`;
  return s < 10 ? s.toFixed(1) : mmss(s);
}

/** Διαφορά υλικού από το FEN (θετική: προηγούνται τα λευκά). */
export function materialDiff(fen: string): number {
  const v: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let d = 0;
  for (const ch of fen.split(' ')[0]) {
    const x = v[ch.toLowerCase()];
    if (x) d += ch === ch.toUpperCase() ? x : -x;
  }
  return d;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

export interface PlayGameProps {
  s: PlaySettings;
  active: boolean;
  /** αρχική θέση (αλλιώς η αρχική του σκακιού) */
  startFen?: string;
  /** αντίπαλος ένας φίλος στην ίδια σκακιέρα (χωρίς μηχανή) */
  friend?: boolean;
  /** στόχος της θέσης για την πλευρά του χρήστη */
  goal?: 'win' | 'draw';
  /** «Event» του PGN */
  event: string;
  backLabel: string;
  onBack: () => void;
  /** πάνω στο πλάι: η κάρτα του αντιπάλου ή της θέσης */
  head: ReactNode;
  /** φράσεις του bot στην αρχή και στο τέλος */
  speech?: boolean;
  /** κουμπιά στο τέλος (ανάλυση, ξανά, επόμενο…) */
  endActions: (r: PlayResult, pgn: string) => ReactNode;
  /** μία φορά στο τέλος (για τα στατιστικά) */
  onFinish?: (r: PlayResult) => void;
}

/** Το σχόλιο του ελέγχου κίνησης: κράτησε ή όχι τον στόχο, με την αξιολόγηση. */
interface CoachNote {
  ply: number;
  ok: boolean;
  text: string;
}

export function PlayGame({ s, active, startFen = START_FEN, friend = false, goal, event, backLabel, onBack, head, speech = false, endActions, onFinish }: PlayGameProps) {
  const settings = useApp((st) => st.settings);
  const toast = useApp((st) => st.toast);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const bs = useBoardSettings();
  const style = (ui.notation as NotationStyle | undefined) ?? 'figurine';
  const refDb = (ui.referenceDb as string | undefined) || null;
  const bot = s.bot;
  const oppName = friend ? L('Φίλος', 'Friend') : t2(bot.name);
  const me = L('Εσύ', 'You');

  const ctrl = useMemo(() => {
    const c = new GameController(new Game(startFen));
    const player = L('Παίκτης', 'Player');
    c.setHeaders({
      ...c.game.headers,
      Event: event,
      Site: 'Ruru Chess',
      Date: today(),
      White: s.color === 'white' ? player : oppName,
      Black: s.color === 'white' ? oppName : player,
      Result: '*',
      ...(!friend && bot.id !== 'full' && bot.id !== 'custom' ? { [s.color === 'white' ? 'BlackElo' : 'WhiteElo']: String(bot.elo) } : {}),
      ...(s.clock ? { TimeControl: `${s.clock.base}+${s.clock.inc}` } : {}),
    });
    c.dirty = false;
    return c;
    // μία παρτίδα ανά προβολή (νέα παρτίδα = νέο key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useController(ctrl);

  const main: GameNode[] = [];
  for (let n = ctrl.game.root.children[0]; n; n = n.children[0]) main.push(n);
  const tip = main.length ? main[main.length - 1] : ctrl.game.root;
  const node = ctrl.node;
  const atTip = node === tip;
  const tipPos = Position.fromFen(tip.fen);
  const turn: 'white' | 'black' = tipPos.turn === 0 ? 'white' : 'black';
  // με φίλο ο χρήστης παίζει και τις δύο πλευρές στην ίδια σκακιέρα
  const userTurn = friend || turn === s.color;
  const userWhite = s.color === 'white';

  const [over, setOver] = useState<PlayResult | null>(null);
  const overRef = useRef<PlayResult | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>(s.color);
  const [hints, setHints] = useState<PlayHints>(s.hints);
  const [say, setSay] = useState(speech && !friend ? t2(bot.says.hi) : '');
  const [drawPending, setDrawPending] = useState(false);
  const [drawOfferPly, setDrawOfferPly] = useState(-10);
  const [coach, setCoach] = useState<boolean>(Boolean(goal) && ui.playoutCoach !== false);
  const [note, setNote] = useState<CoachNote | null>(null);
  // βέλη και κύκλοι (δεξί κλικ): σβήνουν μόλις αλλάξει η θέση
  const drawn = useDrawnShapes(node.fen);
  // προ-κίνηση όσο σκέφτεται το bot (όχι με φίλο στην ίδια σκακιέρα)
  const [premove, setPremove] = useState<Premove | null>(null);
  const coachBefore = useRef<number | null>(null);
  const mistakes = useRef(0);
  const takebacks = useRef(0);
  const hinted = useRef(0);
  const botScore = useRef<number | null>(null);
  const reqId = useRef(0);
  const [clock, setClock] = useState<Clock | null>(() =>
    s.clock ? { w: s.clock.base * 1000, b: s.clock.base * 1000, inc: s.clock.inc * 1000, since: Date.now(), side: turnOfFen(startFen), ply: 0 } : null,
  );
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [, setTick] = useState(0);

  const sound = (san: string) => {
    if (bs.sounds) playMoveSound(san);
  };

  const finish = (result: string, reason: EndReason) => {
    if (overRef.current) return;
    reqId.current++;
    setThinking(false);
    const outcome = outcomeFor(result, s.color) ?? 'draw';
    ctrl.setHeaders({ ...ctrl.game.headers, Result: result });
    const r: PlayResult = {
      result,
      reason,
      outcome,
      plies: main.length,
      takebacks: takebacks.current,
      hinted: hinted.current,
      success: goal ? practiceSuccess(goal, outcome) : null,
      mistakes: mistakes.current,
    };
    overRef.current = r;
    setOver(r);
    setClock((c) => c && { ...c, [c.side]: left(c, c.side), since: Date.now() });
    onFinish?.(r);
    if (speech && !friend) setSay(t2(outcome === 'win' ? bot.says.lost : outcome === 'loss' ? bot.says.won : bot.says.draw));
    if (bs.sounds) playSound((r.success ?? outcome === 'win') ? 'success' : 'notify');
  };

  // ρολόι: σε κάθε νέα κίνηση σταματά ο χρόνος αυτού που έπαιξε (+ προσαύξηση) και γράφεται [%clk]
  useEffect(() => {
    const c = clockRef.current;
    if (!c || overRef.current || main.length === c.ply) return;
    const now = Date.now();
    if (main.length > c.ply) {
      const moved = c.side;
      const rest = c[moved] - (now - c.since) + c.inc;
      tip.clock = fmtClock(rest, true);
      setClock({ ...c, [moved]: rest, since: now, side: turnOfFen(tip.fen), ply: main.length });
    } else {
      // πάρε πίσω: ο χρόνος δεν επιστρέφεται
      setClock({ ...c, [c.side]: c[c.side] - (now - c.since), since: now, side: turnOfFen(tip.fen), ply: main.length });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main.length]);

  // ρολόι: ανανέωση της εμφάνισης και σημαία
  useEffect(() => {
    if (!clock || over) return;
    const t = setInterval(() => {
      const c = clockRef.current;
      if (!c) return;
      if (left(c, c.side) > 0) return setTick((x) => x + 1);
      finish(c.side === 'w' ? '0-1' : '1-0', 'flag');
      toast(c.side === 'w' ? L('Έπεσε η σημαία των λευκών', 'White’s flag fell') : L('Έπεσε η σημαία των μαύρων', 'Black’s flag fell'), 'info');
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock === null, over]);

  // τέλος της παρτίδας στη σκακιέρα
  useEffect(() => {
    if (overRef.current) return;
    const st = tipPos.status();
    if (st === 'checkmate') finish(tipPos.turn === 0 ? '0-1' : '1-0', 'checkmate');
    else if (st === 'stalemate') finish('1/2-1/2', 'stalemate');
    else if (st === 'insufficient') finish('1/2-1/2', 'insufficient');
    else if (st === 'fifty') finish('1/2-1/2', 'fifty');
    else if (repetitions([ctrl.game.root.fen, ...main.map((n) => n.fen)]) >= 3) finish('1/2-1/2', 'repetition');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip]);

  // η κίνηση του bot
  useEffect(() => {
    if (friend || over || error || thinking || userTurn || tipPos.status() !== 'ongoing') return;
    const id = ++reqId.current;
    const fen = tip.fen;
    const moves = main.map((n) => Position.fromFen(n.parent!.fen).moveToUci(n.move));
    const c = clockRef.current;
    const movetime = c ? clockMovetime(left(c, c.side), c.inc, bot.movetime) : bot.movetime;
    setThinking(true);
    requestBotMove(s, {
      fen,
      startFen: ctrl.game.root.fen,
      moves,
      refDb,
      movetime,
      fens: [ctrl.game.root.fen, ...main.map((n) => n.fen)],
      prevScore: botScore.current,
      clock: c ? { left: left(c, c.side), inc: c.inc } : undefined,
    })
      .then((r) => {
        if (id !== reqId.current || overRef.current) return;
        let cur = ctrl.game.root;
        while (cur.children[0]) cur = cur.children[0];
        if (cur.fen !== fen) return;
        const p = Position.fromFen(fen);
        const m = r.uci ? p.parseUci(r.uci) : 0;
        if (!m) {
          setError(L('Η μηχανή δεν έδωσε κίνηση.', 'The engine returned no move.'));
          return;
        }
        if (r.score !== null) botScore.current = r.score;
        const san = p.san(m);
        if (ctrl.node === cur) ctrl.play(m);
        else ctrl.addLine(cur, [m]);
        sound(san);
      })
      .catch((e) => id === reqId.current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => id === reqId.current && setThinking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip, userTurn, over, error, thinking]);

  // έλεγχος κίνησης (θέσεις με στόχο): η αξιολόγηση πριν και μετά από κάθε κίνηση του χρήστη
  const evalFor = async (fen: string): Promise<number | null> => {
    const r = await api.post<{ line: PvLine | null }>('/api/engine/move', { fen, movetime: 600 });
    return solverEval(r.line ?? undefined, userWhite);
  };
  useEffect(() => {
    if (!goal || !coach || main.length > 0 || coachBefore.current !== null) return;
    evalFor(startFen)
      .then((v) => (coachBefore.current = v))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach]);
  const judge = (fen: string, ply: number) => {
    if (!goal || !coach || friend) return;
    evalFor(fen)
      .then((after) => {
        const ok = keepsGoal(goal, coachBefore.current, after);
        if (!ok) mistakes.current++;
        coachBefore.current = after;
        const lost = goal === 'win' ? L('η νίκη', 'the win') : L('η ισοπαλία', 'the draw');
        setNote({
          ply,
          ok,
          text: ok
            ? L(`Κρατά τον στόχο (${evalLabel(after)}).`, `Keeps the goal (${evalLabel(after)}).`)
            : L(`Μάλλον χάθηκε ${lost} (${evalLabel(after)}). Πάρε πίσω ή συνέχισε να παλεύεις.`, `Probably ${lost} slipped away (${evalLabel(after)}). Take back or keep fighting.`),
        });
      })
      .catch(() => {});
  };

  const hintState = usePlayHints(tip.fen, hints, Boolean(active && atTip && userTurn && !thinking && !over));

  const onMove = (from: number, to: number, promo: number) => {
    if (over || !atTip || !userTurn || thinking) return;
    const pos = Position.fromFen(tip.fen);
    const m = pos.findMove(from, to, promo);
    if (!m) return;
    const san = pos.san(m);
    if (hints.best || hints.threat || hints.evalBar) hinted.current++;
    const n = ctrl.play(m);
    sound(san);
    if (!friend) judge(n.fen, n.ply);
  };

  // προ-κίνηση: μόλις παίξει το bot παίζεται αμέσως, αν είναι νόμιμη (αλλιώς σβήνει αθόρυβα)·
  // σβήνει και στο τέλος της παρτίδας ή αν ο χρήστης φύγει από την τελευταία θέση
  useEffect(() => {
    if (!premove) return;
    if (overRef.current || !atTip) {
      setPremove(null);
      return;
    }
    if (!userTurn || thinking) return;
    setPremove(null);
    onMove(premove.from, premove.to, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premove, tip, userTurn, thinking, atTip, over]);

  const startSide: Side = turnOfFen(ctrl.game.root.fen);
  const userFirst = startSide === (userWhite ? 'w' : 'b');
  const userMoves = friend ? main.length : userFirst ? Math.ceil(main.length / 2) : Math.floor(main.length / 2);
  const canTakeback = !over && userMoves > 0 && !drawPending;
  const takeback = () => {
    if (!canTakeback) return;
    reqId.current++;
    setThinking(false);
    setError(null);
    setNote(null);
    setPremove(null);
    // πίσω στη θέση πριν από την τελευταία κίνηση του χρήστη (με φίλο: μία ημικίνηση)
    const target = friend || !userTurn ? tip.parent! : tip.parent!.parent!;
    ctrl.goTo(target);
    ctrl.deleteRemaining(target);
    takebacks.current++;
    coachBefore.current = null;
    if (goal && coach) {
      evalFor(target.fen)
        .then((v) => (coachBefore.current = v))
        .catch(() => {});
    }
  };

  const played = main.length;
  const canOfferDraw = !over && userTurn && !thinking && !drawPending && (friend || (played >= 2 && played >= drawOfferPly + 4));
  const offerDraw = () => {
    if (!canOfferDraw) return;
    if (friend) {
      if (window.confirm(L('Συμφωνείτε σε ισοπαλία;', 'Do you both agree to a draw?'))) finish('1/2-1/2', 'agreement');
      return;
    }
    setDrawOfferPly(played);
    setDrawPending(true);
    setTimeout(() => {
      setDrawPending(false);
      if (overRef.current) return;
      // με κίνητρο (Παίξε τη θέση): όχι όσο η μηχανή έχει κάτι να παίξει (υλικό ή αξιολόγηση υπέρ της)
      const ok = s.pressure ? pressureAcceptsDraw(botScore.current, played, tip.fen, !userWhite) : acceptsDraw(botScore.current, played, bot.id === 'full');
      if (ok) finish('1/2-1/2', 'agreement');
      else {
        if (speech) setSay(L('Όχι, ας παίξουμε κι άλλο!', 'No, let’s play on!'));
        toast(L(`${oppName}: απέρριψε την ισοπαλία.`, `${oppName} declined the draw.`), 'info');
      }
    }, 700);
  };

  const resign = () => {
    if (over) return;
    if (friend) {
      const loser = turn;
      if (!window.confirm(loser === 'white' ? L('Εγκαταλείπουν τα λευκά;', 'Does White resign?') : L('Εγκαταλείπουν τα μαύρα;', 'Does Black resign?'))) return;
      finish(loser === 'white' ? '0-1' : '1-0', 'resign');
      return;
    }
    if (!window.confirm(L('Να εγκαταλείψεις την παρτίδα;', 'Resign the game?'))) return;
    finish(userWhite ? '0-1' : '1-0', 'resign');
  };

  const leave = () => {
    if (!over && main.length > 0 && !window.confirm(L('Η παρτίδα δεν τελείωσε. Να βγεις χωρίς αποτέλεσμα;', 'The game is not over. Leave without a result?'))) return;
    reqId.current++;
    onBack();
  };

  const copyFen = () => {
    void navigator.clipboard?.writeText(node.fen).then(
      () => toast(L('Το FEN αντιγράφηκε: παίξ’ το και αλλού.', 'FEN copied: play it elsewhere too.'), 'ok'),
      () => toast(node.fen, 'info'),
    );
  };

  useScreenKeys(active, (e) => {
    if (e.key === 'ArrowLeft') ctrl.back();
    else if (e.key === 'ArrowRight') ctrl.forward();
    else if (e.key === 'Home') ctrl.toStart();
    else if (e.key === 'End') ctrl.goTo(tip);
    else if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
    else return false;
    return true;
  });

  // πίνακας κινήσεων: η τρέχουσα κίνηση φαίνεται πάντα
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [node]);
  const rows: Array<{ num: number; w?: GameNode; b?: GameNode }> = [];
  for (const n of main) {
    const parentFen = n.parent!.fen.split(' ');
    const num = Number(parentFen[5]) || 1;
    if (parentFen[1] === 'w') rows.push({ num, w: n });
    else if (rows.length && rows[rows.length - 1].num === num && !rows[rows.length - 1].b) rows[rows.length - 1].b = n;
    else rows.push({ num, b: n });
  }

  const userSide: Side = userWhite ? 'w' : 'b';
  const diff = materialDiff(node.fen);
  const plus = (side: Side) => {
    const d = side === 'w' ? diff : -diff;
    return d > 0 ? `+${d}` : '';
  };
  const bar = (side: Side) => {
    const isOpp = side !== userSide;
    const c = clock;
    // στο τέλος το ρολόι σταματά
    const t = c ? (over ? c[side] : left(c, side)) : 0;
    const running = Boolean(c && !over && c.side === side);
    return (
      <div className={`play-bar${running ? ' is-running' : ''}`}>
        {isOpp && !friend ? (
          <BotAvatar bot={bot} />
        ) : (
          <span className="bot-av bot-av-you" aria-hidden>
            {(isOpp ? oppName : me).slice(0, 1)}
          </span>
        )}
        <span className="play-bar-name">
          {isOpp ? oppName : me}
          {isOpp && !friend && bot.id !== 'custom' && <Tag>{eloTag(bot)}</Tag>}
          <span className="faint small">{side === 'w' ? L('λευκά', 'White') : L('μαύρα', 'Black')}</span>
          <span className="play-bar-mat tnum">{plus(side)}</span>
        </span>
        {isOpp && thinking && <Spinner label="" />}
        {c && <span className={`play-clock tnum${running ? ' on' : ''}${t < 10_000 ? ' low' : ''}`}>{fmtClock(t)}</span>}
      </div>
    );
  };
  const top: Side = orientation === 'white' ? 'b' : 'w';
  const bottom: Side = top === 'w' ? 'b' : 'w';
  const score = over ? over.result.replace('1/2-1/2', '½–½').replace('-', '–') : '';
  const goalWord = goal === 'win' ? L('κέρδισε', 'win') : L('κράτα την ισοπαλία', 'hold the draw');
  const overTitle = over
    ? over.success !== null
      ? over.success
        ? L('Τα κατάφερες!', 'Well done!')
        : L('Δεν τα κατάφερες αυτή τη φορά', 'Not this time')
      : over.outcome === 'win'
        ? L('Κέρδισες!', 'You won!')
        : over.outcome === 'loss'
          ? L('Έχασες', 'You lost')
          : L('Ισοπαλία', 'Draw')
    : '';
  const overClass = over ? ((over.success ?? over.outcome === 'win') ? 'is-win' : over.success === false || over.outcome === 'loss' ? 'is-loss' : 'is-draw') : '';

  return (
    <div className="tx-main bots-main">
      <section className="tx-board bots-board" aria-label={L('Σκακιέρα', 'Board')}>
        {bar(top)}
        <div className="bots-boardwrap">
          {hints.evalBar && (
            <div className="bots-evalbar">
              <EvalBar cp={hintState.eval?.cp ?? null} mate={hintState.eval?.mate ?? null} flipped={orientation === 'black'} />
            </div>
          )}
          <div className="bots-boardbox">
            <Board
              fen={node.fen}
              orientation={orientation}
              movable={over || !atTip || !userTurn || thinking ? 'none' : friend ? turn : s.color}
              lastMove={node.isRoot ? undefined : node.move}
              shapes={drawn.shapes}
              onShape={drawn.onShape}
              premovable={!friend && !over && atTip ? s.color : undefined}
              premove={atTip ? premove : null}
              onPremove={setPremove}
              hintArrows={atTip ? hintState.arrows : []}
              theme={bs.theme}
              pieceSet={bs.pieceSet}
              coordinates={bs.coordinates}
              animationMs={bs.animationMs}
              oneClick={bs.oneClick}
              onMove={onMove}
            />
          </div>
        </div>
        {bar(bottom)}
      </section>

      <aside className="tx-side bots-side">
        <div className="gl-bar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={leave}>
            <ArrowLeft className="ic" aria-hidden />
            {backLabel}
          </button>
          <span className="faint tnum">{L(`κίνηση ${Math.max(1, Math.ceil(main.length / 2))}`, `move ${Math.max(1, Math.ceil(main.length / 2))}`)}</span>
        </div>

        {head}
        {say && (
          <div className="bot-say" aria-live="polite">
            {say}
          </div>
        )}

        {!over && (
          <div className={`play-status${error ? ' is-error' : ''}`} role="status" aria-live="polite">
            {error ? (
              <>
                <span>
                  {L('Σφάλμα μηχανής', 'Engine error')}: {error}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setError(null)}>
                  {L('Ξανά', 'Retry')}
                </button>
              </>
            ) : thinking ? (
              <span>{L(`${oppName}: σκέφτεται…`, `${oppName} is thinking…`)}</span>
            ) : friend ? (
              <span className="play-turn">{turn === 'white' ? L('Παίζουν τα λευκά', 'White to move') : L('Παίζουν τα μαύρα', 'Black to move')}</span>
            ) : userTurn ? (
              <span className="play-turn">
                {atTip ? (goal ? L(`Σειρά σου: ${goalWord}!`, `Your move: ${goalWord}!`) : L('Σειρά σου', 'Your move')) : L('Σειρά σου· γύρνα στην τελευταία θέση (End) για να παίξεις.', 'Your move; go back to the last position (End) to play.')}
              </span>
            ) : (
              <span className="muted">…</span>
            )}
          </div>
        )}

        {!over && note && note.ply === tip.ply - (userTurn ? 1 : 0) && (
          <div className={`tx-verdict ${note.ok ? 'is-ok' : 'is-bad'}`} role="status">
            {note.ok ? <CircleCheck className="ic" aria-hidden /> : <CircleX className="ic" aria-hidden />}
            <span>{note.text}</span>
          </div>
        )}

        {over && (
          <div className={`play-over ${overClass}`} role="status">
            <div className="play-over-head">
              <span className="play-over-score tnum">{score}</span>
              <span className="play-over-title">{overTitle}</span>
            </div>
            <div className="muted small">
              {goal && (goal === 'win' ? L('Στόχος: νίκη. ', 'Target: win. ') : L('Στόχος: ισοπαλία. ', 'Target: draw. '))}
              {reasonText(over.reason, over.outcome === 'loss')} · {count(Math.ceil(over.plies / 2), ['κίνηση', 'κινήσεις'], ['move', 'moves'])}
              {over.takebacks ? ` · ${count(over.takebacks, ['πάρε πίσω', 'πάρε πίσω'], ['takeback', 'takebacks'])}` : ''}
              {over.hinted ? ` · ${count(over.hinted, ['κίνηση με βοήθειες', 'κινήσεις με βοήθειες'], ['move with hints', 'moves with hints'])}` : ''}
              {goal && coach && !friend ? ` · ${count(over.mistakes, ['κίνηση που έχασε τον στόχο', 'κινήσεις που έχασαν τον στόχο'], ['move that lost the goal', 'moves that lost the goal'])}` : ''}
            </div>
            <div className="play-over-actions">{endActions(over, ctrl.pgn())}</div>
          </div>
        )}

        <div className="bots-moves" ref={listRef} aria-label={L('Κινήσεις', 'Moves')}>
          {rows.length === 0 && <span className="faint small">{L('Δεν έχουν παιχτεί κινήσεις ακόμη.', 'No moves yet.')}</span>}
          {rows.map((r) => (
            <div key={`${r.num}-${r.w?.id ?? 'x'}`} className="bots-move-row tnum">
              <span className="bots-move-num">{r.num}.</span>
              {r.w ? (
                <button type="button" className={`bots-move${r.w === node ? ' on' : ''}`} onClick={() => ctrl.goTo(r.w!)}>
                  {displaySan(r.w.san, style)}
                </button>
              ) : (
                <span className="bots-move faint">…</span>
              )}
              {r.b && (
                <button type="button" className={`bots-move${r.b === node ? ' on' : ''}`} onClick={() => ctrl.goTo(r.b!)}>
                  {displaySan(r.b.san, style)}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="bots-nav" role="group" aria-label={L('Πλοήγηση', 'Navigation')}>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Αρχή (Home)', 'Start (Home)')} onClick={() => ctrl.toStart()}>
            <ChevronsLeft className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Πίσω (←)', 'Back (←)')} onClick={() => ctrl.back()}>
            <ChevronLeft className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Μπροστά (→)', 'Forward (→)')} onClick={() => ctrl.forward()}>
            <ChevronRight className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Τελευταία θέση (End)', 'Last position (End)')} onClick={() => ctrl.goTo(tip)}>
            <ChevronsRight className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Αναστροφή σκακιέρας (F)', 'Flip board (F)')} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <FlipVertical2 className="ic" aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" title={L('Αντιγραφή FEN της θέσης', 'Copy the position’s FEN')} onClick={copyFen}>
            <Copy className="ic" aria-hidden />
          </button>
        </div>

        {!over && (
          <>
            <div className="play-actions">
              <button type="button" className="btn btn-secondary btn-sm" disabled={!canTakeback} onClick={takeback} title={L('Πάρε πίσω την τελευταία κίνηση', 'Take back the last move')}>
                <RotateCcw className="ic ic-sm" aria-hidden />
                {L('Πάρε πίσω', 'Take back')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!canOfferDraw} onClick={offerDraw} title={friend ? L('Ισοπαλία με συμφωνία', 'Draw by agreement') : L('Πρόταση ισοπαλίας', 'Offer a draw')}>
                <Handshake className="ic ic-sm" aria-hidden />
                {drawPending ? L('Το σκέφτεται…', 'Thinking…') : L('Ισοπαλία;', 'Offer draw')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm btn-danger" onClick={resign}>
                <Flag className="ic ic-sm" aria-hidden />
                {L('Εγκατάλειψη', 'Resign')}
              </button>
            </div>
            <div className="play-opt">
              <span className="field-label play-sec">
                <Lightbulb className="ic ic-sm" aria-hidden />
                {L('Βοήθειες', 'Hints')}
              </span>
              <div className="play-hints">
                {goal && !friend && (
                  <Switch
                    checked={coach}
                    onChange={(v) => {
                      setCoach(v);
                      setUiLater({ playoutCoach: v });
                    }}
                    label={L('Έλεγχος κάθε κίνησης (κρατά τον στόχο;)', 'Check every move (does it keep the goal?)')}
                  />
                )}
                <Switch checked={hints.best} onChange={(v) => setHints({ ...hints, best: v })} label={L('Βέλος καλύτερης κίνησης', 'Best-move arrow')} />
                <Switch checked={hints.threat} onChange={(v) => setHints({ ...hints, threat: v })} label={L('Απειλή του αντιπάλου', 'Opponent’s threat')} />
                <Switch checked={hints.evalBar} onChange={(v) => setHints({ ...hints, evalBar: v })} label={L('Μπάρα αξιολόγησης', 'Evaluation bar')} />
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
