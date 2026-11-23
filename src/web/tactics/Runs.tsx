/** Γρήγοροι τρόποι: Storm (3 λεπτά, μπόνους χρόνου για σερί σωστών, −10″ για λάθος), Streak (ένα λάθος τελειώνει το σερί, μία παράλειψη) και Rush (3 λάθη, 3′ / 5′ / χωρίς χρόνο). Τα puzzles ελέγχονται στον browser (ίδιος έλεγχος με τον server) και ο γύρος γράφεται μία φορά στο τέλος. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleStop, CircleX, Flame, Infinity as InfinityIcon, Play, RotateCcw, SkipForward, Timer, Trophy, Zap } from 'lucide-react';
import { checkAnswer } from '../../core/puzzle.ts';
import { L, fmtNum } from '../i18n.ts';
import { reportError } from '../store.ts';
import { Board } from '../components/Board.tsx';
import { useDrawnShapes } from '../components/drawnShapes.ts';
import { Progress, Spinner } from '../components/ui/Progress.tsx';
import { Keys } from '../components/ui/Kbd.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { playMoveSound, playSound, type MoveSound } from '../sounds.ts';
import type { Command } from '../commands.ts';
import { tacticsApi, type RunSet, type RunStats } from './api.ts';
import { boardUci, clock, comboProgress, fromCompact, playUci, stormBonus, type LinePuzzle } from './logic.ts';
import { useTactics } from './store.ts';
import { MoveInput, fmtRating, useBoardSettings, useScreenKeys, type CommandsRef } from './common.tsx';

export type RunMode = 'storm' | 'streak' | 'rush';
export type RushVariant = '3' | '5' | 'survival';

interface Done {
  id: string;
  win: boolean;
  ms: number;
  rating: number;
}

interface Cur {
  p: LinePuzzle;
  ply: number;
  fen: string;
  last?: number;
  /** ο χρήστης μπορεί να κινήσει */
  open: boolean;
  /** λάθος κίνηση που φαίνεται για λίγο */
  flash: string | null;
  at: number;
}

interface Run {
  set: RunSet;
  index: number;
  phase: 'ready' | 'play' | 'over';
  cur: Cur | null;
  done: Done[];
  combo: number;
  bestCombo: number;
  errors: number;
  skips: number;
  /** πότε τελειώνει ο χρόνος (ms)· null πριν ξεκινήσει ή χωρίς χρόνο */
  end: number | null;
  started: number | null;
  finished: number | null;
  /** μπόνους χρόνου που μόλις δόθηκε (για το «+3″») */
  bonus: { s: number; at: number } | null;
}

export const RUN_TITLES: Record<RunMode, () => string> = {
  storm: () => L('3 λεπτά', '3 minutes'),
  streak: () => 'Streak',
  rush: () => L('3 λάθη', '3 strikes'),
};

function rules(mode: RunMode, variant: RushVariant): string {
  if (mode === 'storm') return L('Όσο περισσότερα puzzles μπορείς σε 3 λεπτά, όλα με το ίδιο χρώμα. Σερί σωστών δίνει χρόνο (+3″ στα 5, +5″ στα 12…), κάθε λάθος κοστίζει 10″ και περνά στο επόμενο.', 'As many puzzles as you can in 3 minutes, all with one colour. Streaks of correct moves add time (+3″ at 5, +5″ at 12…); each mistake costs 10″ and moves on.');
  if (mode === 'streak') return L('Puzzles όλο και πιο δύσκολα, χωρίς χρόνο. Ένα λάθος τελειώνει το σερί· έχεις μία παράλειψη.', 'Ever harder puzzles, no clock. One mistake ends the streak; you have one skip.');
  const t = variant === 'survival' ? L('χωρίς χρόνο', 'no clock') : L(`${variant} λεπτά`, `${variant} minutes`);
  return L(`Όσο περισσότερα puzzles μπορείς (${t}). Τρία λάθη και τελειώνει.`, `As many puzzles as you can (${t}). Three mistakes and it is over.`);
}

export function RunView({ mode, variant, onVariant, active, commandsRef, onRetry }: { mode: RunMode; variant: RushVariant; onVariant: (v: RushVariant) => void; active: boolean; commandsRef: CommandsRef; onRetry: (ids: string[]) => void }) {
  const bs = useBoardSettings();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<(RunStats & { id: number; failed: string[] }) | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [, setTick] = useState(0);
  const ref = useRef<Run | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  const put = (r: Run | null) => {
    ref.current = r;
    setRun(r);
  };
  const snd = (k: MoveSound) => bs.sounds && playSound(k);
  const sndMove = (san: string) => bs.sounds && playMoveSound(san);

  const fetchSeq = useRef(0);
  const fetchSet = async () => {
    const my = ++fetchSeq.current;
    clear();
    setLoading(true);
    setSaved(null);
    try {
      const set = await tacticsApi.run(mode, mode === 'rush' ? variant : undefined);
      if (my !== fetchSeq.current) return;
      put({ set, index: 0, phase: 'ready', cur: null, done: [], combo: 0, bestCombo: 0, errors: 0, skips: set.config.skips ?? 0, end: null, started: null, finished: null, bonus: null });
      const first = set.puzzles[0];
      if (first) setOrientation(first.color);
    } catch (e) {
      if (my === fetchSeq.current) reportError(e);
    } finally {
      if (my === fetchSeq.current) setLoading(false);
    }
  };
  const fetchRef = useRef(fetchSet);
  fetchRef.current = fetchSet;
  useEffect(() => {
    void fetchRef.current();
    return clear;
  }, [mode, variant]);

  // ρολόι: ανανέωση της οθόνης και τέλος του χρόνου
  useEffect(() => {
    if (run?.phase !== 'play' || run.end === null) return;
    const id = setInterval(() => {
      const r = ref.current;
      if (!r || r.phase !== 'play') return;
      if (r.end !== null && Date.now() >= r.end) finish(r);
      else setTick((t) => t + 1);
    }, 200);
    return () => clearInterval(id);
  }, [run?.phase, run?.end === null]);

  useEffect(() => {
    if (!active) return;
    if (run?.phase === 'ready' && !loading) startRef.current?.focus({ preventScroll: true });
    if (run?.phase === 'over') againRef.current?.focus({ preventScroll: true });
  }, [run?.phase, loading, active]);

  /** Φορτώνει το puzzle `index` και παίζει την κίνηση του αντιπάλου. */
  const show = (r: Run, index: number): Run => {
    const c = r.set.puzzles[index];
    if (!c) return finish(r);
    const p = fromCompact(c);
    const cur: Cur = { p, ply: p.pre ? 1 : 0, fen: p.fen, open: !p.pre, flash: null, at: Date.now() };
    const next: Run = { ...r, index, cur };
    if (p.pre) {
      later(r.done.length ? 220 : (r.set.config.firstMoveDelayMs ?? 400), () => {
        const x = ref.current;
        if (!x?.cur || x.cur.p.id !== p.id) return;
        const m = playUci(p.fen, p.moves[0]);
        if (!m) return;
        sndMove(m.san);
        // το ρολόι ξεκινά όταν ο χρήστης μπορεί να κινήσει για πρώτη φορά
        const timed = x.set.config.timeSeconds;
        const end = x.end === null && timed ? Date.now() + timed * 1000 : x.end;
        put({ ...x, end, started: x.started ?? Date.now(), cur: { ...x.cur, fen: m.fen, last: m.move, open: true, at: Date.now() } });
      });
    }
    return next;
  };

  const start = () => {
    const r = ref.current;
    if (!r || r.phase !== 'ready' || !r.set.puzzles.length) return;
    put(show({ ...r, phase: 'play' }, 0));
  };

  function finish(r: Run): Run {
    if (r.phase === 'over') return r;
    clear();
    const over: Run = { ...r, phase: 'over', finished: Date.now(), cur: r.cur ? { ...r.cur, open: false, flash: null } : null };
    put(over);
    if (r.done.length || r.started) {
      const score = r.done.filter((d) => d.win).length;
      tacticsApi
        .saveRun({
          mode,
          variant: mode === 'rush' ? variant : undefined,
          score,
          bestCombo: r.bestCombo,
          errors: r.errors,
          topRating: Math.max(0, ...r.done.filter((d) => d.win).map((d) => d.rating)),
          ms: (over.finished ?? Date.now()) - (r.started ?? over.finished ?? Date.now()),
          puzzles: r.done.map((d) => ({ id: d.id, win: d.win, ms: d.ms })),
        })
        .then((x) => {
          setSaved(x);
          // οι προσπάθειες του γύρου μετρούν στα σημερινά και στο σερί ημερών
          void useTactics.getState().refresh().catch(() => {});
        })
        .catch(reportError);
    }
    return over;
  }

  /** Τέλος του puzzle: επόμενο ή τέλος του γύρου. */
  const settle = (r: Run, win: boolean): void => {
    const cur = r.cur!;
    const d: Done = { id: cur.p.id, win, ms: Date.now() - cur.at, rating: cur.p.rating };
    const combo = win ? r.combo + 1 : 0;
    let end = r.end;
    let bonus = r.bonus;
    if (mode === 'storm' && end !== null) {
      if (win) {
        const s = stormBonus(combo, r.set.config.combo ?? []);
        if (s) {
          end += s * 1000;
          bonus = { s, at: Date.now() };
        }
      } else end -= (r.set.config.penaltySeconds ?? 10) * 1000;
    }
    const errors = r.errors + (win ? 0 : 1);
    const next: Run = { ...r, done: [...r.done, d], combo, bestCombo: Math.max(r.bestCombo, combo), errors, end, bonus };
    const strikes = r.set.config.strikes;
    const over = (mode === 'streak' && !win) || (strikes !== undefined && errors >= strikes) || (end !== null && Date.now() >= end) || r.index + 1 >= r.set.puzzles.length;
    if (over) {
      put(next);
      finish(next);
      return;
    }
    put(show(next, r.index + 1));
  };

  const move = (uci: string) => {
    const r = ref.current;
    const cur = r?.cur;
    if (!r || r.phase !== 'play' || !cur?.open) return;
    let c: ReturnType<typeof checkAnswer>;
    try {
      c = checkAnswer(cur.p.fen, cur.p.moves, cur.ply, uci);
    } catch (e) {
      reportError(e);
      return;
    }
    if (c.illegal) return;
    const mine = playUci(cur.fen, c.uci);
    if (!mine) return;
    if (c.result === 'incorrect') {
      snd('error');
      put({ ...r, cur: { ...cur, fen: mine.fen, last: mine.move, open: false, flash: c.san } });
      later(420, () => {
        const x = ref.current;
        if (x?.cur?.p.id === cur.p.id) settle(x, false);
      });
      return;
    }
    sndMove(c.san);
    if (!c.reply) {
      put({ ...r, cur: { ...cur, fen: mine.fen, last: mine.move, open: false } });
      later(160, () => {
        const x = ref.current;
        if (x?.cur?.p.id === cur.p.id) settle(x, true);
      });
      return;
    }
    put({ ...r, cur: { ...cur, fen: mine.fen, last: mine.move, open: false } });
    const reply = c.reply;
    later(170, () => {
      const x = ref.current;
      if (!x?.cur || x.cur.p.id !== cur.p.id) return;
      const m = playUci(x.cur.fen, reply);
      if (!m) return;
      sndMove(m.san);
      if (c.result === 'solved') {
        put({ ...x, cur: { ...x.cur, fen: m.fen, last: m.move } });
        later(140, () => {
          const y = ref.current;
          if (y?.cur?.p.id === cur.p.id) settle(y, true);
        });
      } else put({ ...x, cur: { ...x.cur, fen: m.fen, last: m.move, ply: c.next, open: true } });
    });
  };

  const skip = () => {
    const r = ref.current;
    if (!r || r.phase !== 'play' || mode !== 'streak' || r.skips <= 0 || !r.cur) return;
    clear();
    const next = { ...r, skips: r.skips - 1 };
    if (r.index + 1 >= r.set.puzzles.length) finish(next);
    else put(show(next, r.index + 1));
  };

  const stop = () => {
    const r = ref.current;
    if (r?.phase === 'play') finish(r);
  };

  useScreenKeys(active, (e) => {
    const r = ref.current;
    if (!r) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Enter' && r.phase === 'ready') start();
    else if (k === 'Enter' && r.phase === 'play') inputRef.current?.focus();
    else if ((k === 'Enter' || k === 'n') && r.phase === 'over') void fetchSet();
    else if (k === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
    else return;
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
    const r = ref.current;
    return [
      { id: 'tx.run.start', title: L(`Ξεκίνα ${RUN_TITLES[mode]()}`, `Start ${RUN_TITLES[mode]()}`), group: g, icon: Play, keys: 'Enter', disabled: r?.phase !== 'ready', run: start },
      { id: 'tx.run.again', title: L('Νέος γύρος', 'New run'), group: g, icon: RotateCcw, disabled: r?.phase === 'play', run: () => void fetchSet() },
      { id: 'tx.run.stop', title: L('Τέλος του γύρου τώρα', 'End the run now'), group: g, icon: CircleStop, disabled: r?.phase !== 'play', run: stop },
      { id: 'tx.flip', title: L('Γύρισμα σκακιέρας', 'Flip board'), extra: ['Flip'], group: g, keys: 'F', run: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')) },
    ];
  };
  ownCommands.current = provider;
  commandsRef.current = provider;

  const stats = run?.set.stats;
  const now = Date.now();
  const left = run?.end !== null && run?.end !== undefined ? Math.max(0, run.end - (run.phase === 'over' ? (run.finished ?? now) : now)) : null;
  const score = run?.done.filter((d) => d.win).length ?? 0;
  const cur = run?.cur;
  const firstFen = run?.set.puzzles[0]?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1';
  const combo = run && mode === 'storm' ? comboProgress(run.combo, run.set.config.combo ?? []) : null;
  const recentBonus = run?.bonus && now - run.bonus.at < 1500 ? run.bonus.s : 0;
  const best = stats?.best?.score ?? null;
  const record = saved && saved.best && saved.best.id === saved.id && score > 0;
  const failedIds = useMemo(() => run?.done.filter((d) => !d.win).map((d) => d.id) ?? [], [run?.done]);
  const drawn = useDrawnShapes(cur?.fen ?? firstFen);

  return (
    <div className="tx-main">
      <section className="tx-board" aria-label={L('Σκακιέρα', 'Board')} data-puzzle={cur?.p.id}>
        <Board
          fen={cur?.fen ?? firstFen}
          orientation={orientation}
          movable={cur?.open ? cur.p.color : 'none'}
          lastMove={cur?.last}
          shapes={drawn.shapes}
          onShape={drawn.onShape}
          theme={bs.theme}
          pieceSet={bs.pieceSet}
          coordinates={bs.coordinates}
          animationMs={Math.min(bs.animationMs, 160)}
          oneClick={bs.oneClick}
          onMove={(from, to, promo) => {
            if (!cur?.open) return;
            const uci = boardUci(cur.fen, from, to, promo);
            if (uci) move(uci);
          }}
        />
        {cur?.flash && <span className="tx-flash" aria-hidden>{`✗ ${cur.flash}`}</span>}
      </section>
      <aside className="tx-side">
        <div className="panel tx-task tx-run">
          <div className="tx-turn">
            {mode === 'storm' ? <Zap className="ic" aria-hidden /> : mode === 'streak' ? <Flame className="ic" aria-hidden /> : <Timer className="ic" aria-hidden />}
            <span>{RUN_TITLES[mode]()}</span>
            {cur && run?.phase === 'play' && (
              <span className="faint tx-id">
                {L(`Παίζεις με τα ${cur.p.color === 'white' ? 'λευκά' : 'μαύρα'}`, `You play ${cur.p.color === 'white' ? 'White' : 'Black'}`)} · {fmtRating(cur.p.rating)}
              </span>
            )}
          </div>
          {loading || !run ? (
            <div className="tx-loading">
              <Spinner label={L('Φόρτωση', 'Loading')} />
              <span className="muted">{L('Ετοιμάζονται τα puzzles…', 'Preparing the puzzles…')}</span>
            </div>
          ) : run.phase === 'ready' ? (
            <>
              <h1>{L('Έτοιμος;', 'Ready?')}</h1>
              <p className="muted tx-prompt">{rules(mode, variant)}</p>
              {mode === 'rush' && (
                <Segmented<RushVariant>
                  value={variant}
                  label={L('Χρόνος', 'Time')}
                  onChange={onVariant}
                  options={[
                    { value: '3', label: '3′' },
                    { value: '5', label: '5′' },
                    { value: 'survival', label: L('Επιβίωση', 'Survival'), icon: InfinityIcon },
                  ]}
                />
              )}
              {mode === 'storm' && run.set.color && <p className="faint tx-prompt">{L(`Αυτόν τον γύρο παίζεις με τα ${run.set.color === 'white' ? 'λευκά' : 'μαύρα'}.`, `This run you play ${run.set.color === 'white' ? 'White' : 'Black'}.`)}</p>}
              <RunRecords stats={run.set.stats} />
              <div className="tx-actions tx-actions-done">
                <button ref={startRef} type="button" className="btn btn-primary btn-lg" disabled={!run.set.puzzles.length} onClick={start}>
                  <Play className="ic" aria-hidden />
                  {L('Ξεκίνα', 'Start')}
                  <Keys keys="Enter" />
                </button>
              </div>
              {!run.set.puzzles.length && <p className="tx-type-err">{L('Δεν βρέθηκαν puzzles για τον γύρο.', 'No puzzles were found for the run.')}</p>}
            </>
          ) : run.phase === 'play' ? (
            <>
              <div className="tx-run-top">
                {left !== null ? (
                  <div className={`tx-clock tnum${left < 20_000 ? ' is-low' : ''}`} role="timer" aria-label={L('Χρόνος που μένει', 'Time left')}>
                    {clock(left)}
                    {recentBonus > 0 && <span className="tx-bonus">+{recentBonus}″</span>}
                  </div>
                ) : (
                  <div className="tx-clock tnum faint">—</div>
                )}
                <div className="tx-score">
                  <span className="tnum">{fmtNum(score)}</span>
                  <span className="faint">{L('σωστά', 'solved')}</span>
                </div>
              </div>
              {combo && (
                <div className="tx-combo">
                  <Progress value={combo.value} small label={L(`σερί ${run.combo} · +${combo.bonus}″ στα ${combo.next}`, `combo ${run.combo} · +${combo.bonus}″ at ${combo.next}`)} />
                </div>
              )}
              {mode === 'rush' && (
                <div className="tx-strikes" aria-label={L(`Λάθη: ${run.errors} από 3`, `Mistakes: ${run.errors} of 3`)}>
                  {[0, 1, 2].map((i) => (i < run.errors ? <CircleX key={i} className="ic is-bad" aria-hidden /> : <span key={i} className="tx-strike-empty" aria-hidden />))}
                  <span className="faint">{L(`${run.errors} / 3 λάθη`, `${run.errors} / 3 mistakes`)}</span>
                </div>
              )}
              <p className="muted tx-prompt" aria-live="polite">
                {cur?.flash ? L(`Το ${cur.flash} ήταν λάθος.`, `${cur.flash} was wrong.`) : cur?.open ? L('Βρες την καλύτερη συνέχεια.', 'Find the best move.') : '…'}
              </p>
              {cur && <MoveInput ref={inputRef} fen={cur.fen} ready={cur.open} onMove={move} resetKey={cur.p.id} />}
              <RunStrip done={run.done} />
              <div className="tx-actions">
                {mode === 'streak' && (
                  <button type="button" className="btn btn-ghost" disabled={run.skips <= 0} onClick={skip}>
                    <SkipForward className="ic" aria-hidden />
                    {L(`Παράλειψη (${run.skips})`, `Skip (${run.skips})`)}
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={stop}>
                  <CircleStop className="ic" aria-hidden />
                  {L('Τέλος', 'End')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="tx-run-over">
                <div className="section-label">{L('Σκορ', 'Score')}</div>
                <div className="tx-hero">{fmtNum(score)}</div>
                {record ? (
                  <div className="tx-verdict is-ok">
                    <Trophy className="ic" aria-hidden />
                    <span>{L('Νέο ρεκόρ!', 'New record!')}</span>
                  </div>
                ) : best !== null ? (
                  <div className="faint">{L(`Ρεκόρ: ${fmtNum(Math.max(best, saved?.best?.score ?? 0))}`, `Record: ${fmtNum(Math.max(best, saved?.best?.score ?? 0))}`)}</div>
                ) : null}
              </div>
              <div className="st-grid">
                <div>
                  <div className="st-n tnum">{fmtNum(run.errors)}</div>
                  <div className="faint st-l">{L('λάθη', 'mistakes')}</div>
                </div>
                <div>
                  <div className="st-n tnum">{fmtNum(run.bestCombo)}</div>
                  <div className="faint st-l">{L('καλύτερο σερί', 'best combo')}</div>
                </div>
                <div>
                  <div className="st-n tnum">{run.done.some((d) => d.win) ? fmtRating(Math.max(...run.done.filter((d) => d.win).map((d) => d.rating))) : '—'}</div>
                  <div className="faint st-l">{L('δυσκολότερο λυμένο', 'hardest solved')}</div>
                </div>
              </div>
              <RunStrip done={run.done} onPick={(id) => onRetry([id])} />
              <div className="tx-actions tx-actions-done">
                <button ref={againRef} type="button" className="btn btn-primary" onClick={() => void fetchSet()}>
                  <RotateCcw className="ic" aria-hidden />
                  {L('Ξανά', 'Again')}
                  <Keys keys="Enter" />
                </button>
                {failedIds.length > 0 && (
                  <button type="button" className="btn btn-secondary" onClick={() => onRetry(failedIds)}>
                    {L(`Ξαναδοκίμασε τα λάθη (${failedIds.length})`, `Retry the misses (${failedIds.length})`)}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {run?.phase !== 'over' && stats && run?.phase !== 'ready' && <RunRecords stats={stats} panel />}
      </aside>
    </div>
  );
}

/** Τα puzzles του γύρου: ✓ / ✗ με τον βαθμό τους (στο τέλος με κλικ για νέα προσπάθεια). */
function RunStrip({ done, onPick }: { done: Done[]; onPick?: (id: string) => void }) {
  if (!done.length) return null;
  return (
    <div className="tx-strip" aria-label={L('Τα puzzles του γύρου', 'The puzzles of the run')}>
      {done.map((d, i) => {
        const Icon = d.win ? CircleCheck : CircleX;
        const label = `${d.win ? L('σωστό', 'solved') : L('λάθος', 'missed')} ${fmtRating(d.rating)}`;
        return onPick ? (
          <button key={i} type="button" className={`tx-pz ${d.win ? 'is-ok' : 'is-bad'}`} onClick={() => onPick(d.id)} title={L(`Ξαναδοκίμασε (#${d.id})`, `Try again (#${d.id})`)} aria-label={label}>
            <Icon className="ic ic-sm" aria-hidden />
            <span className="tnum">{fmtRating(d.rating)}</span>
          </button>
        ) : (
          <span key={i} className={`tx-pz ${d.win ? 'is-ok' : 'is-bad'}`} aria-label={label}>
            <Icon className="ic ic-sm" aria-hidden />
            <span className="tnum">{fmtRating(d.rating)}</span>
          </span>
        );
      })}
    </div>
  );
}

function RunRecords({ stats, panel }: { stats: RunStats; panel?: boolean }) {
  const body = (
    <div className="st-grid">
      <div>
        <div className="st-n tnum">{stats.best ? fmtNum(stats.best.score) : '—'}</div>
        <div className="faint st-l">{L('ρεκόρ', 'record')}</div>
      </div>
      <div>
        <div className="st-n tnum">{stats.todayBest !== null ? fmtNum(stats.todayBest) : '—'}</div>
        <div className="faint st-l">{L('καλύτερο σήμερα', 'best today')}</div>
      </div>
      <div>
        <div className="st-n tnum">{stats.average !== null ? fmtNum(Math.round(stats.average)) : '—'}</div>
        <div className="faint st-l">{L(`μέσος όρος · ${fmtNum(stats.count)} ${stats.count === 1 ? 'γύρος' : 'γύροι'}`, `average · ${fmtNum(stats.count)} ${stats.count === 1 ? 'run' : 'runs'}`)}</div>
      </div>
    </div>
  );
  return panel ? <div className="panel tx-stats">{body}</div> : body;
}
