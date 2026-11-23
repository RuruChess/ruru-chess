/** Μέθοδος Woodpecker (Smith & Tikkanen): ένα σταθερό σετ puzzles λύνεται ξανά και ξανά σε κύκλους, κάθε κύκλος στον μισό χρόνο του προηγούμενου. Δημιουργία σετ, πρόοδος του κύκλου, νέος κύκλος. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bird, Plus } from 'lucide-react';
import { L, fmtNum, language } from '../i18n.ts';
import { reportError } from '../store.ts';
import { Board } from '../components/Board.tsx';
import { Progress, Spinner } from '../components/ui/Progress.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Checkbox } from '../components/ui/Switch.tsx';
import { tacticsApi, type WoodpeckerSet } from './api.ts';
import { SolverView, type Feed } from './Solver.tsx';
import { duration } from './logic.ts';
import { useBoardSettings, type CommandsRef } from './common.tsx';
import { useTactics } from './store.ts';

const DAY = 86_400_000;

function CreateForm({ onCreated, onCancel, themes }: { onCreated: (s: WoodpeckerSet) => void; onCancel?: () => void; themes: string[] }) {
  const rating = Math.round(useTactics((s) => s.ratings?.standard.rating ?? 1500));
  const [size, setSize] = useState<'50' | '100' | '250' | '500'>('100');
  const [min, setMin] = useState(String(Math.round((rating - 300) / 50) * 50));
  const [max, setMax] = useState(String(Math.round((rating + 100) / 50) * 50));
  const [days, setDays] = useState('28');
  const [useThemes, setUseThemes] = useState(false);
  const [busy, setBusy] = useState(false);
  const lo = Number(min);
  const hi = Number(max);
  const valid = Number.isFinite(lo) && Number.isFinite(hi) && lo >= 400 && hi <= 3500 && lo < hi && Number(days) >= 1;
  const create = () => {
    if (!valid) return;
    setBusy(true);
    tacticsApi
      .createWoodpecker({ size: Number(size), min: lo, max: hi, targetDays: Math.floor(Number(days)), themes: useThemes ? themes : [] })
      .then(onCreated)
      .catch(reportError)
      .finally(() => setBusy(false));
  };
  return (
    <form
      className="tx-wp-form"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <h1>{L('Νέο σετ κύκλων', 'New cycle set')}</h1>
      <p className="muted tx-prompt">{L('Τα ίδια puzzles λύνονται σε κύκλους· κάθε κύκλος στον μισό χρόνο του προηγούμενου, ώσπου τα μοτίβα να βγαίνουν αυτόματα.', 'The same puzzles are solved in cycles, each in half the time of the previous one, until the patterns come automatically.')}</p>
      <div className="tx-setup-row">
        <span className="label">{L('Μέγεθος', 'Size')}</span>
        <Segmented value={size} label={L('Μέγεθος σετ', 'Set size')} onChange={setSize} options={(['50', '100', '250', '500'] as const).map((v) => ({ value: v, label: v }))} />
      </div>
      <div className="tx-setup-row">
        <label className="label" htmlFor="wp-min">
          {L('Βαθμός puzzles', 'Puzzle rating')}
        </label>
        <div className="range-row">
          <input id="wp-min" className="input input-sm tnum" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} aria-label={L('Από', 'From')} />
          <span className="dash">–</span>
          <input id="wp-max" className="input input-sm tnum" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} aria-label={L('Έως', 'To')} />
        </div>
        <span className="hint">{L(`Ο βαθμός σου είναι ${fmtNum(rating)}· προτείνεται λίγο πιο κάτω, για να λύνονται γρήγορα.`, `Your rating is ${fmtNum(rating)}; slightly below is suggested, so they are solved quickly.`)}</span>
      </div>
      <div className="tx-setup-row">
        <label className="label" htmlFor="wp-days">
          {L('Στόχος πρώτου κύκλου (μέρες)', 'First cycle target (days)')}
        </label>
        <input id="wp-days" className="input input-sm tnum tx-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
      {themes.length > 0 && (
        <Checkbox checked={useThemes} onChange={setUseThemes} label={L(`Μόνο τα θέματα του φίλτρου (${themes.length})`, `Only the filter's themes (${themes.length})`)} />
      )}
      <div className="tx-actions tx-actions-done">
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
          {busy ? <Spinner /> : <Plus className="ic" aria-hidden />}
          {L('Δημιουργία σετ', 'Create the set')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {L('Άκυρο', 'Cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

/** Πρόοδος του κύκλου και επιλογή σετ. */
function CyclePanel({ set, sets, onPick, onNew }: { set: WoodpeckerSet; sets: WoodpeckerSet[]; onPick: (id: number) => void; onNew: () => void }) {
  const c = set.cycles[set.cycles.length - 1];
  const cur = set.current;
  const left = c ? Math.ceil((c.deadline - Date.now()) / DAY) : null;
  return (
    <div className="panel tx-stats">
      <div className="th-head">
        <span className="section-label">{L('Σετ κύκλων', 'Cycle set')}</span>
        <button type="button" className="link-btn" onClick={onNew}>
          <Plus className="ic ic-sm" aria-hidden />
          {L('Νέο σετ', 'New set')}
        </button>
      </div>
      {sets.length > 1 ? (
        <select className="select input-sm" value={set.id} onChange={(e) => onPick(Number(e.target.value))} aria-label={L('Σετ', 'Set')}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {fmtNum(s.total)}
            </option>
          ))}
        </select>
      ) : (
        <div className="tx-wp-name">{set.name}</div>
      )}
      {c && cur && (
        <>
          <Progress value={cur.total ? cur.solved / cur.total : 0} label={L(`Κύκλος ${c.n}: ${fmtNum(cur.solved)} / ${fmtNum(cur.total)}`, `Cycle ${c.n}: ${fmtNum(cur.solved)} / ${fmtNum(cur.total)}`)} />
          <div className="st-grid">
            <div>
              <div className="st-n tnum">{c.accuracy !== null ? `${Math.round(c.accuracy * 100)}%` : '—'}</div>
              <div className="faint st-l">{L('σωστά', 'correct')}</div>
            </div>
            <div>
              <div className="st-n tnum">{c.avgMs !== null ? duration(c.avgMs, language() === 'el') : '—'}</div>
              <div className="faint st-l">{L('μέσος χρόνος', 'average time')}</div>
            </div>
            <div>
              <div className="st-n tnum">{left === null ? '—' : left >= 0 ? fmtNum(left) : '0'}</div>
              <div className="faint st-l">{L(`μέρες ως τον στόχο (${c.target_days})`, `days to target (${c.target_days})`)}</div>
            </div>
          </div>
        </>
      )}
      {set.cycles.length > 1 && (
        <table className="table tx-cycles">
          <thead>
            <tr>
              <th>{L('Κύκλος', 'Cycle')}</th>
              <th className="r">{L('Μέρες', 'Days')}</th>
              <th className="r">{L('Σωστά', 'Correct')}</th>
              <th className="r">{L('Χρόνος', 'Time')}</th>
            </tr>
          </thead>
          <tbody>
            {set.cycles.map((x) => (
              <tr key={x.id}>
                <td>{x.n}</td>
                <td className="r">
                  {fmtNum(x.days)} / {fmtNum(x.target_days)}
                </td>
                <td className="r">{x.accuracy !== null ? `${Math.round(x.accuracy * 100)}%` : '—'}</td>
                <td className="r">{x.avgMs !== null ? duration(x.avgMs, language() === 'el') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function WoodpeckerView({ active, commandsRef, deckPref, onDeckPref, themes }: { active: boolean; commandsRef: CommandsRef; deckPref: number | null; onDeckPref: (id: number) => void; themes: string[] }) {
  const bs = useBoardSettings();
  const [sets, setSets] = useState<WoodpeckerSet[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    tacticsApi
      .woodpeckers()
      .then((r) => setSets(r.sets))
      .catch(reportError);
  }, []);
  useEffect(reload, [reload, version]);

  const set = sets?.find((s) => s.id === deckPref) ?? sets?.[0] ?? null;
  const finished = Boolean(set?.current?.finished) || (set ? set.current?.next === null && (set.current?.solved ?? 0) >= set.total : false);
  const feed = useMemo<Feed | null>(
    () =>
      set
        ? {
            key: `wp-${set.id}-${set.current?.id ?? 0}`,
            next: async () => {
              const r = await tacticsApi.nextWoodpecker(set.id);
              if (!r.puzzle || r.finished) {
                setVersion((v) => v + 1);
                return null;
              }
              return { puzzle: r.puzzle, deck: set.id, cycle: r.cycle };
            },
          }
        : null,
    [set?.id, set?.current?.id],
  );

  const newCycle = () => {
    if (!set) return;
    setBusy(true);
    tacticsApi
      .newCycle(set.id)
      .then(() => setVersion((v) => v + 1))
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  if (!sets) {
    return (
      <div className="tx-center">
        <Spinner label={L('Φόρτωση', 'Loading')} />
      </div>
    );
  }

  const neutral = (content: React.ReactNode) => (
    <div className="tx-main">
      <section className="tx-board" aria-label={L('Σκακιέρα', 'Board')}>
        <Board fen="8/8/8/8/8/8/8/8 w - - 0 1" orientation="white" movable="none" theme={bs.theme} pieceSet={bs.pieceSet} coordinates={bs.coordinates} animationMs={0} />
      </section>
      <aside className="tx-side">
        <div className="panel tx-task">{content}</div>
        {set && !creating && <CyclePanel set={set} sets={sets} onPick={onDeckPref} onNew={() => setCreating(true)} />}
      </aside>
    </div>
  );

  if (!set || creating) {
    return neutral(
      <CreateForm
        themes={themes}
        onCancel={set ? () => setCreating(false) : undefined}
        onCreated={(s) => {
          setCreating(false);
          onDeckPref(s.id);
          setVersion((v) => v + 1);
        }}
      />,
    );
  }

  if (finished) {
    const last = set.cycles[set.cycles.length - 1];
    const rec = set.recommendation;
    const rest = rec.restUntil && rec.restUntil > Date.now();
    return neutral(
      <>
        <EmptyState icon={Bird} title={rec.complete ? L('Το σετ ολοκληρώθηκε!', 'The set is complete!') : L(`Ο κύκλος ${last?.n ?? ''} τελείωσε`, `Cycle ${last?.n ?? ''} is finished`)}>
          {last && L(`${fmtNum(last.solved)} puzzles σε ${fmtNum(last.days)} ${last.days === 1 ? 'μέρα' : 'μέρες'}, ${Math.round((last.accuracy ?? 0) * 100)}% σωστά${last.onTime ? ', μέσα στον στόχο' : ''}.`, `${fmtNum(last.solved)} puzzles in ${fmtNum(last.days)} days, ${Math.round((last.accuracy ?? 0) * 100)}% correct${last.onTime ? ', within target' : ''}.`)}{' '}
          {rec.complete
            ? L('Επτά κύκλοι ή ένα σετ σε μία μέρα: τα μοτίβα είναι δικά σου. Φτιάξε νέο σετ.', 'Seven cycles or a set in one day: the patterns are yours. Make a new set.')
            : rest
              ? L('Η μέθοδος προτείνει μία μέρα ξεκούραση πριν από τον επόμενο κύκλο.', 'The method suggests a day of rest before the next cycle.')
              : ''}
        </EmptyState>
        <div className="tx-actions tx-actions-done">
          {!rec.complete && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={newCycle}>
              {L(`Νέος κύκλος (στόχος ${rec.nextTargetDays} ${rec.nextTargetDays === 1 ? 'μέρα' : 'μέρες'})`, `New cycle (target ${rec.nextTargetDays} days)`)}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setCreating(true)}>
            {L('Νέο σετ', 'New set')}
          </button>
        </div>
      </>,
    );
  }

  return (
    <SolverView
      key={feed?.key}
      feed={feed!}
      mode="woodpecker"
      active={active}
      commandsRef={commandsRef}
      tip={L('Γρήγορα αλλά σωστά: μετρά ο χρόνος του κύκλου.', 'Fast but correct: the cycle time counts.')}
      empty={<EmptyState icon={Bird} title={L('Ο κύκλος τελείωσε', 'The cycle is finished')} />}
      onResult={() => setVersion((v) => v + 1)}
      side={() => <CyclePanel set={set} sets={sets} onPick={onDeckPref} onNew={() => setCreating(true)} />}
    />
  );
}
