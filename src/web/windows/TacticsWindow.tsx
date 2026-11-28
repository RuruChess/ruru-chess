/** Καρτέλα «Τακτική»: οι τρόποι (Βαθμολογημένα, Επανάληψη, Storm, Streak, Rush, Woodpecker, Της ημέρας), «Θέματα και δυσκολία», Πηγές και Στατιστικά στη σειρά πλοήγησης της «Βελτίωσης»· επίπεδο, «Διακοπή», σερί ημερών και σημερινά στο πλαϊνό της λύσης. Χωρίς puzzles στη βάση δείχνει την εισαγωγή της κύριας συλλογής. */
import '../tactics/tactics.css';
import '../tactics/improve.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChartLine, CircleCheck, CircleX, Flame, Gauge, Library, Puzzle, RotateCcw, SlidersHorizontal, Square, Timer, Zap, RefreshCw, Repeat, ArrowLeft, Download, ListOrdered } from 'lucide-react';
import { L, fmtNum, language } from '../i18n.ts';
import { useApp, type Tab } from '../store.ts';
import { useCommandScope, type Command } from '../commands.ts';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Spinner } from '../components/ui/Progress.tsx';
import { tacticsApi, type AttemptResult, type PickFilters } from '../tactics/api.ts';
import { setTacticsPrefs, useTactics } from '../tactics/store.ts';
import { DIFFICULTY_LEVELS, activeFilters, effectiveFilters, readTacticsPrefs, type TacticsMode, type TacticsPrefs } from '../tactics/prefs.ts';
import { sectionModes, type Section } from '../tactics/sections.ts';
import { SolverView, type Feed, type FeedItem } from '../tactics/Solver.tsx';
import { RunView, type RunMode, type RushVariant } from '../tactics/Runs.tsx';

const RUN_MODES: RunMode[] = ['storm', 'streak', 'rush'];
import { WoodpeckerView } from '../tactics/Woodpecker.tsx';
import { DashboardView } from '../tactics/Dashboard.tsx';
import { ImportScreen } from '../tactics/ImportScreen.tsx';
import { SetupPopover, loadThemes } from '../tactics/Setup.tsx';
import { DailyPanel, RatingPanel, ReviewPanel } from '../tactics/Panels.tsx';
import { useScreenKeys } from '../tactics/common.tsx';
import { CollectionBrowser, CollectionSide } from '../tactics/Collection.tsx';
import { StartScreen, levelRating } from '../tactics/StartScreen.tsx';

type TacticsTab = Extract<Tab, { kind: 'tactics' }>;

type Retry = { kind: 'ids'; ids: string[]; seq: number } | { kind: 'theme'; theme: string; seq: number };

const MODE_INFO: Array<{ mode: TacticsMode; label: () => string; title: () => string; icon?: typeof Puzzle }> = [
  { mode: 'rated', label: () => L('Βαθμολογημένα', 'Rated'), title: () => L('Puzzles στο επίπεδό σου· ο βαθμός σου αλλάζει (Glicko-2)', 'Puzzles at your level; your rating changes (Glicko-2)') },
  { mode: 'review', label: () => L('Επανάληψη', 'Review'), title: () => L('Όσα έχασες, σε διαστήματα επανάληψης (FSRS)', 'What you missed, in spaced repetition (FSRS)') },
  { mode: 'storm', label: () => L('3 λεπτά', '3 minutes'), title: () => L('3 λεπτά, όσα περισσότερα μπορείς', '3 minutes, as many as you can'), icon: Zap },
  { mode: 'streak', label: () => 'Streak', title: () => L('Ένα λάθος και τελειώνει', 'One mistake and it is over'), icon: Flame },
  { mode: 'rush', label: () => L('3 λάθη', '3 strikes'), title: () => L('Τρία λάθη και τελειώνει', 'Three mistakes and it is over'), icon: Timer },
  { mode: 'woodpecker', label: () => L('Κύκλοι', 'Cycles'), title: () => L('Το ίδιο σετ σε κύκλους, όλο και πιο γρήγορα', 'The same set in cycles, ever faster'), icon: RefreshCw },
  { mode: 'daily', label: () => L('Της ημέρας', 'Daily'), title: () => L('Ένα puzzle για σήμερα', 'One puzzle for today'), icon: CalendarDays },
];

/**
 * `slot`: η σειρά πλοήγησης της «Βελτίωσης», όπου μπαίνουν οι τρόποι και τα εργαλεία (null: η σελίδα δεν φαίνεται).
 * Χωρίς `slot` (Φινάλε → ασκήσεις) η σειρά είναι μέσα στη σελίδα.
 */
export function TacticsWindow({ tab, active, section = 'tactics', slot }: { tab: TacticsTab; active: boolean; section?: Section; slot?: HTMLElement | null }) {
  const settings = useApp((s) => s.settings);
  const prefs = readTacticsPrefs(settings?.ui, section);
  const setPrefs = (p: Partial<TacticsPrefs>) => setTacticsPrefs(p, section);
  const { puzzles, sources, streak, today, ratings, due } = useTactics();
  const [view, setView] = useState<'train' | 'stats' | 'sources' | 'collection'>('train');
  // μια συλλογή μόνη της: η λίστα των θέσεων (index null) ή λύση με τη σειρά από τη θέση index
  const [col, setCol] = useState<{ key: string; file: string; index: number | null; seq: number } | null>(null);
  const [colPos, setColPos] = useState<{ index: number; total: number }>({ index: 0, total: 0 });
  const [retry, setRetry] = useState<Retry | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [reviewDeck, setReviewDeck] = useState<number | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [daily, setDaily] = useState<{ day: string; origin: string | null; solved: boolean } | null>(null);
  // οι γρίφοι ξεκινούν μόνο με «Έναρξη»: ο τρόπος που ξεκίνησε (αλλαγή τρόπου = πάλι η οθόνη έναρξης)
  const [started, setStarted] = useState<TacticsMode | null>(null);
  const commandsRef = useRef<() => Command[]>(() => []);
  // γύροι (3 λεπτά / Streak / 3 λάθη) που παίζονται τώρα
  const [liveRuns, setLiveRuns] = useState<RunMode[]>([]);
  const onLive = useCallback((m: RunMode, on: boolean) => setLiveRuns((l) => (on ? (l.includes(m) ? l : [...l, m]) : l.filter((x) => x !== m))), []);
  const filtersRef = useRef<PickFilters>(prefs.filters);
  // οι συλλογές αυτής της σελίδας που έχουν μπει στη βάση
  const secSources = sources.filter((s) => s.section === section && s.key !== 'lichess' && s.kind !== 'mine');
  const secCount = secSources.reduce((a, s) => a + s.count, 0);
  // η κύρια συλλογή τροφοδοτεί τα Τακτικά και, με το θέμα «φινάλε», τα Φινάλε
  const usesMain = section !== 'strategy' && (puzzles ?? 0) > 0;
  const chosen = secSources.some((s) => s.key === prefs.filters.source) ? prefs.filters.source : '';
  // χωρίς επιλογή και χωρίς κύρια συλλογή: η πρώτη συλλογή «λύσης» της σελίδας (αλλιώς η πρώτη οποιαδήποτε)
  const fallbackSource = !chosen && !usesMain ? ((secSources.find((s) => s.mode === 'solve') ?? secSources[0])?.key ?? '') : '';
  const picked: PickFilters = { ...prefs.filters, source: chosen || fallbackSource };
  filtersRef.current = effectiveFilters(prefs.filters, { section, usesMain, chosen, fallback: fallbackSource });
  const seen = useRef<string[]>([]);

  useEffect(() => {
    const s = useTactics.getState();
    void s.checkPuzzles().catch(() => {});
    void s.refresh().catch(() => {});
  }, []);

  const mode: TacticsMode = sectionModes(section).includes(prefs.mode) ? prefs.mode : 'rated';
  const modes = MODE_INFO.filter((m) => sectionModes(section).includes(m.mode));
  // στα Φινάλε και στα Στρατηγικά τα «βαθμολογημένα» είναι εξάσκηση από τις συλλογές της σελίδας
  const modeLabel = (m: (typeof MODE_INFO)[number]) => (section !== 'tactics' && m.mode === 'rated' ? L('Εξάσκηση', 'Practice') : m.label());
  const modeTitle = (m: (typeof MODE_INFO)[number]) => (section !== 'tactics' && m.mode === 'rated' ? L('Θέσεις από τις συλλογές αυτής της σελίδας', 'Positions from this page’s collections') : m.title());
  // άνοιγμα σε τράπουλα (π.χ. «Λύσε τα σημερινά» της Τράπεζας λαθών): επανάληψη αυτής της τράπουλας
  useEffect(() => {
    if (tab.deck === undefined || section !== 'tactics') return;
    setReviewDeck(tab.deck);
    setView('train');
    setRetry(null);
    // «Λύσε τα σημερινά»: ο χρήστης ζήτησε ήδη να ξεκινήσει
    setStarted('review');
    if (readTacticsPrefs(useApp.getState().settings?.ui, section).mode !== 'review') setPrefs({ mode: 'review' });
  }, [tab.deck, tab.deckSeq]);
  const pickMode = (m: TacticsMode) => {
    setView('train');
    setRetry(null);
    setSetupOpen(false);
    if (m !== mode) {
      setPrefs({ mode: m });
      setStarted(null);
    }
  };
  // τρόποι με γρίφους που θα άνοιγαν αμέσως: πρώτα η οθόνη έναρξης
  const gated = mode === 'rated' || mode === 'review' || mode === 'daily';
  const rating = ratings?.standard.rating ?? 1500;
  /** Αλλαγή επιπέδου: φαίνεται αμέσως και (αν τρέχει ήδη) ο επόμενος γρίφος έρχεται στο νέο επίπεδο. */
  const setLevel = (key: string) => {
    if (key === prefs.filters.difficulty) return;
    setPrefs({ filters: { ...prefs.filters, difficulty: key } });
    setNonce((n) => n + 1);
  };

  const onResult = useCallback((r: AttemptResult) => {
    useTactics.setState({ ratings: r.ratings });
    if (r.card) setReviewVersion((v) => v + 1);
  }, []);

  const remember = (id: string) => {
    seen.current.push(id);
    if (seen.current.length > 400) seen.current.splice(0, 100);
  };
  const rated = useMemo<Feed>(
    () => ({
      key: `rated-${nonce}`,
      next: async () => {
        const r = await tacticsApi.nextRated(filtersRef.current, seen.current);
        if (r.puzzle) remember(r.puzzle.id);
        return r.puzzle ? { puzzle: r.puzzle } : null;
      },
    }),
    [nonce],
  );
  const review = useMemo<Feed>(
    () => ({
      key: `review-${reviewDeck ?? 'all'}-${nonce}`,
      next: async () => {
        const r = await tacticsApi.nextReview(reviewDeck ?? undefined);
        setReviewVersion((v) => v + 1);
        return r.puzzle ? { puzzle: r.puzzle, deck: r.deck ?? undefined } : null;
      },
    }),
    [nonce, reviewDeck],
  );
  const dailyFeed = useMemo<Feed>(
    () => ({
      key: `daily-${nonce}`,
      once: true,
      next: async () => {
        const r = await tacticsApi.daily();
        setDaily({ day: r.day, origin: r.origin, solved: r.solved });
        return r.puzzle ? { puzzle: r.puzzle } : null;
      },
    }),
    [nonce],
  );
  const retryFeed = useMemo<Feed | null>(() => {
    if (retry?.kind === 'ids') {
      const queue = [...retry.ids];
      return {
        key: `retry-${retry.seq}`,
        next: async () => {
          const id = queue.shift();
          if (!id) return null;
          return { puzzle: (await tacticsApi.puzzle(id)).puzzle };
        },
      };
    }
    if (retry?.kind === 'theme') {
      const done: string[] = [];
      const theme = retry.theme;
      return {
        key: `replay-${retry.seq}`,
        next: async () => {
          const r = await tacticsApi.nextReplay(theme, done);
          if (r.puzzle) done.push(r.puzzle.id);
          return r.puzzle ? { puzzle: r.puzzle } : null;
        },
      };
    }
    return null;
  }, [retry]);
  const colFeed = useMemo<Feed | null>(() => {
    if (!col || col.index === null) return null;
    const { key, file } = col;
    let i = col.index;
    // δύο αιτήματα μαζί (π.χ. διπλό effect του StrictMode) παίρνουν την ίδια θέση, όχι δύο διαδοχικές
    let pending: Promise<FeedItem | null> | null = null;
    return {
      key: `col-${key}-${file}-${col.seq}`,
      next: () => {
        pending ??= (async () => {
          const at = i;
          const r = await tacticsApi.collectionAt(key, at, file);
          setColPos({ index: at, total: r.total });
          i = at + 1;
          return r.puzzle ? { puzzle: r.puzzle } : null;
        })().finally(() => {
          pending = null;
        });
        return pending;
      },
    };
  }, [col]);
  const feeds = { rated, review, daily: dailyFeed, retry: retryFeed };

  /** Άνοιγμα μιας συλλογής: η λίστα των θέσεών της. */
  const openCollection = (key: string) => {
    setRetry(null);
    setSetupOpen(false);
    setCol({ key, file: '', index: null, seq: Date.now() });
    setView('collection');
  };

  const startRetry = (r: { kind: 'ids'; ids: string[] } | { kind: 'theme'; theme: string }) => {
    setView('train');
    setRetry({ ...r, seq: Date.now() } as Retry);
  };

  // χωρίς την κύρια συλλογή δουλεύουν οι συλλογές και η επανάληψη μιας τράπουλας (π.χ. «Τα λάθη μου»)
  const ready = puzzles !== null && (section === 'tactics' ? puzzles > 0 || secCount > 0 || tab.deck !== undefined : section === 'endgame' ? puzzles > 0 || secCount > 0 : secCount > 0);
  const nFilters = activeFilters(prefs.filters);

  useCommandScope(`${tab.id}-${section}`, active, () => {
    const g = L('Τακτική', 'Tactics');
    const out: Command[] = ready
      ? [
          ...modes.map((m) => ({ id: `tx.mode.${m.mode}`, title: L(`Βελτίωση: ${modeLabel(m)}`, `Improve: ${modeLabel(m)}`), extra: [m.mode, modeTitle(m)], group: g, icon: m.icon ?? Puzzle, checked: view === 'train' && !retry && mode === m.mode, run: () => pickMode(m.mode) })),
          { id: 'tx.stats', title: L('Στατιστικά τακτικής', 'Tactics statistics'), extra: ['Statistics', 'dashboard', 'στατιστικα'], group: g, icon: ChartLine, checked: view === 'stats', run: () => setView((v) => (v === 'stats' ? 'train' : 'stats')) },
          { id: 'tx.setup', title: L('Θέματα και δυσκολία…', 'Themes and difficulty…'), extra: ['Themes', 'difficulty', 'opening', 'source', 'θεματα', 'πηγη'], group: g, icon: SlidersHorizontal, disabled: mode !== 'rated', run: () => setSetupOpen(true) },
        ]
      : [];
    out.push({ id: 'tx.sources', title: L('Πηγές puzzles: κύρια συλλογή και συλλογές…', 'Puzzle sources: main collection and collections…'), extra: ['Collections', 'Lucas Chess', 'STS', 'συλλογες', 'εισαγωγη'], group: g, icon: Library, checked: view === 'sources', run: () => setView((v) => (v === 'sources' ? 'train' : 'sources')) });
    return view === 'train' ? [...commandsRef.current(), ...out] : out;
  });

  // S: στατιστικά (στην εκπαίδευση το H, N, F, A είναι του λύτη)
  useScreenKeys(active && ready && section === 'tactics', (e) => {
    if (e.key === 's' || e.key === 'S') {
      setView((v) => (v === 'stats' ? 'train' : 'stats'));
      return true;
    }
  });

  if (puzzles === null) {
    return (
      <div className="tx-center">
        <Spinner label={L('Φόρτωση', 'Loading')} />
      </div>
    );
  }
  const onImported = () => {
    void loadThemes(true).catch(() => {});
    void useTactics.getState().checkPuzzles();
    void useTactics.getState().refresh();
  };
  if (!ready) {
    return (
      <div className="tx txk">
        <ImportScreen onReady={onImported} section={section} />
      </div>
    );
  }

  const retryLabel = retry?.kind === 'theme' ? L('Επανάληψη όσων έχασες', 'Retry what you missed') : L('Ξανά τα επιλεγμένα', 'Retry the selected');
  const inTrain = view === 'train' && !retry;
  const losses = today.attempts - today.wins;
  // στην κορυφή του πλαϊνού της λύσης: επίπεδο (βαθμολογημένα) και «Διακοπή» (πίσω στην έναρξη)
  const head =
    gated && started === mode ? (
      <>
        {mode === 'rated' && (
          <label className="tk-level" title={L('Επίπεδο δυσκολίας: ο βαθμός των γρίφων σε σχέση με τον δικό σου', 'Difficulty level: the puzzles’ rating relative to yours')}>
            <Gauge aria-hidden />
            {L('Επίπεδο', 'Level')}
            <select className="select select-sm" value={prefs.filters.difficulty} onChange={(e) => setLevel(e.target.value)}>
              {!DIFFICULTY_LEVELS.some((d) => d.key === prefs.filters.difficulty) && <option value={prefs.filters.difficulty}>{prefs.filters.difficulty}</option>}
              {DIFFICULTY_LEVELS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.key === 'standard' ? L(`${d.el} · όπως πριν`, `${d.en} · as before`) : L(`${d.el} · βαθμός ≈${levelRating(rating, d.delta)}`, `${d.en} · rating ≈${levelRating(rating, d.delta)}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="kb-btn ghost sm tk-stop" title={L('Τέλος: πίσω στην οθόνη έναρξης', 'Stop: back to the start screen')} onClick={() => setStarted(null)}>
          <Square aria-hidden />
          {L('Διακοπή', 'Stop')}
        </button>
      </>
    ) : undefined;
  // στο κάτω μέρος του: σερί ημερών και τα σημερινά
  const foot = (
    <>
      <span title={L('Συνεχόμενες μέρες με puzzles', 'Consecutive days with puzzles')}>
        <Flame aria-hidden />
        <b className="tnum">{fmtNum(streak)}</b>
        {streak === 1 ? L('μέρα', 'day') : L('μέρες', 'days')}
      </span>
      <span title={L('Σωστά σήμερα', 'Correct today')}>
        <CircleCheck aria-hidden />
        <b className="tnum">{fmtNum(today.wins)}</b>
        {L('σωστά', 'correct')}
      </span>
      <span title={L('Λάθη σήμερα', 'Wrong today')}>
        <CircleX aria-hidden />
        <b className="tnum">{fmtNum(losses)}</b>
        {L('λάθη', 'wrong')}
      </span>
    </>
  );

  let content: React.ReactNode;
  let curRun: RunMode | null = null;
  if (view === 'sources') {
    content = <ImportScreen onReady={onImported} section={section} onOpen={openCollection} />;
  } else if (view === 'collection' && col) {
    const src = secSources.find((s) => s.key === col.key);
    const name = src ? (language() === 'el' ? src.name.el : src.name.en) : col.key;
    content =
      col.index === null || !colFeed ? (
        <CollectionBrowser sources={secSources} current={col.key} file={col.file} onSource={(k) => setCol({ key: k, file: '', index: null, seq: Date.now() })} onFile={(f) => setCol({ ...col, file: f, index: null })} onPick={(i) => setCol({ ...col, index: i, seq: Date.now() })} />
      ) : (
        <SolverView
          key={colFeed.key}
          feed={colFeed}
          mode="casual"
          active={active}
          commandsRef={commandsRef}
          onResult={onResult}
          foot={foot}
          tip={L('Οι θέσεις των συλλογών δεν αλλάζουν τον βαθμό σου.', 'Collection positions do not change your rating.')}
          empty={
            <EmptyState
              icon={ListOrdered}
              title={L('Τέλος της συλλογής', 'End of the collection')}
              action={
                <button type="button" className="btn btn-primary" onClick={() => setCol({ ...col, index: null })}>
                  {L('Πίσω στη λίστα', 'Back to the list')}
                </button>
              }
            />
          }
          side={() => <CollectionSide name={name} file={col.file} index={colPos.index} total={colPos.total} solution={src?.solution ?? 'lines'} onList={() => setCol({ ...col, index: null })} />}
        />
      );
  } else if (view === 'stats') {
    content = (
      <DashboardView
        days={prefs.days}
        onDays={(d) => setPrefs({ days: d })}
        series={prefs.ratingSeries}
        onSeries={(s) => setPrefs({ ratingSeries: s })}
        onReplay={(theme) => startRetry({ kind: 'theme', theme })}
        onRetry={(ids) => startRetry({ kind: 'ids', ids })}
        onStart={() => pickMode('rated')}
      />
    );
  } else if (retry && feeds.retry) {
    content = (
      <SolverView
        key={feeds.retry.key}
        feed={feeds.retry}
        mode="replay"
        active={active}
        commandsRef={commandsRef}
        onResult={onResult}
        foot={foot}
        title={undefined}
        empty={
          <EmptyState
            icon={RotateCcw}
            title={L('Τα ξαναέλυσες όλα', 'You went through them all')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setRetry(null)}>
                {L('Πίσω στην εκπαίδευση', 'Back to training')}
              </button>
            }
          >
            {L('Όσα λύθηκαν τώρα σωστά μετρούν ως «διορθωμένα» στα στατιστικά.', 'Those solved correctly now count as “fixed” in the statistics.')}
          </EmptyState>
        }
        side={() => (
          <div className="panel tx-stats">
            <div className="section-label">{retryLabel}</div>
            <p className="faint tx-note">{retry.kind === 'theme' && retry.theme ? L('Puzzles του θέματος που δεν έλυσες με την πρώτη.', 'Puzzles of the theme you did not solve at the first try.') : L('Δεν αλλάζει ο βαθμός σου.', 'Your rating does not change.')}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry(null)}>
              <ArrowLeft className="ic" aria-hidden />
              {L('Πίσω', 'Back')}
            </button>
          </div>
        )}
      />
    );
  } else if (gated && started !== mode) {
    const info = modes.find((m) => m.mode === mode);
    content = (
      <StartScreen
        mode={mode}
        title={mode === 'rated' && section === 'tactics' ? L('Βαθμολογημένα puzzles', 'Rated puzzles') : mode === 'daily' ? L('Το puzzle της ημέρας', 'The puzzle of the day') : info ? modeLabel(info) : ''}
        about={info ? modeTitle(info) : ''}
        active={active}
        difficulty={prefs.filters.difficulty}
        rating={rating}
        onDifficulty={setLevel}
        filters={nFilters - (prefs.filters.difficulty !== 'normal' ? 1 : 0)}
        onFilters={() => setSetupOpen(true)}
        due={due}
        aside={section === 'tactics'}
        onStart={() => setStarted(mode)}
      />
    );
  } else if (mode === 'rated') {
    content = (
      <SolverView
        key={feeds.rated.key}
        feed={feeds.rated}
        mode="rated"
        angle={prefs.filters.themes}
        active={active}
        commandsRef={commandsRef}
        onResult={onResult}
        head={head}
        foot={foot}
        tip={section === 'tactics' || !picked.source ? L('Χωρίς βιασύνη: ο κύριος βαθμός δεν εξαρτάται από τον χρόνο.', 'No hurry: the main rating does not depend on time.') : L('Οι θέσεις των συλλογών δεν αλλάζουν τον βαθμό σου.', 'Collection positions do not change your rating.')}
        empty={
          <EmptyState
            icon={SlidersHorizontal}
            title={L('Κανένα puzzle με αυτά τα φίλτρα', 'No puzzle with these filters')}
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPrefs({ filters: { ...prefs.filters, themes: [], opening: '', color: '', difficulty: 'standard', source: '' } });
                  setNonce((n) => n + 1);
                }}
              >
                {L('Καθαρισμός φίλτρων', 'Clear the filters')}
              </button>
            }
          >
            {prefs.filters.source || fallbackSource
              ? L('Δοκίμασε λιγότερα θέματα, άλλη δυσκολία ή άλλη πηγή (μια συλλογή έχει λίγες θέσεις σε κάθε ζώνη βαθμού).', 'Try fewer themes, another difficulty or another source (a collection has few positions in each rating band).')
              : L('Δοκίμασε λιγότερα θέματα, άλλο άνοιγμα ή άλλη δυσκολία.', 'Try fewer themes, another opening or another difficulty.')}
          </EmptyState>
        }
        side={section === 'tactics' ? () => <RatingPanel onStats={() => setView('stats')} /> : undefined}
      />
    );
  } else if (mode === 'review') {
    content = (
      <SolverView
        key={feeds.review.key}
        feed={feeds.review}
        mode="review"
        blind={Boolean(tab.blind) && reviewDeck === tab.deck}
        active={active}
        commandsRef={commandsRef}
        onResult={onResult}
        head={head}
        foot={foot}
        tip={L('Η απάντησή σου ορίζει πότε θα ξανάρθει.', 'Your answer decides when it comes back.')}
        empty={
          <EmptyState
            icon={Repeat}
            title={L('Τίποτα για επανάληψη τώρα', 'Nothing to review right now')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => pickMode('rated')}>
                {L('Βαθμολογημένα puzzles', 'Rated puzzles')}
              </button>
            }
          >
            {L('Ό,τι χάνεις στα βαθμολογημένα μπαίνει εδώ και ξαναέρχεται τη σωστή στιγμή.', 'Whatever you miss in rated play comes here and returns at the right time.')}
          </EmptyState>
        }
        side={() => <ReviewPanel deck={reviewDeck} onDeck={setReviewDeck} version={reviewVersion} />}
      />
    );
  } else if (mode === 'daily') {
    content = (
      <SolverView
        key={feeds.daily.key}
        feed={feeds.daily}
        mode="daily"
        active={active}
        commandsRef={commandsRef}
        onResult={onResult}
        head={head}
        foot={foot}
        title={L('Το puzzle της ημέρας', 'The puzzle of the day')}
        empty={
          <EmptyState
            icon={CalendarDays}
            title={L('Αύριο έρχεται νέο', 'A new one comes tomorrow')}
            action={
              <>
                <button type="button" className="btn btn-primary" onClick={() => pickMode('rated')}>
                  {L('Βαθμολογημένα puzzles', 'Rated puzzles')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setNonce((n) => n + 1)}>
                  {L('Ξανά το σημερινό', 'Today’s again')}
                </button>
              </>
            }
          />
        }
        side={() => (daily ? <DailyPanel day={daily.day} origin={daily.origin} solved={daily.solved} /> : null)}
      />
    );
  } else if (mode === 'woodpecker') {
    content = <WoodpeckerView active={active} commandsRef={commandsRef} deckPref={prefs.woodpecker} onDeckPref={(id) => setPrefs({ woodpecker: id })} themes={prefs.filters.themes} />;
  } else {
    curRun = mode as RunMode;
  }
  // οι γύροι που παίζονται μένουν ανοιχτοί (κρυφοί) όταν πας αλλού, για να συνεχίσεις από εκεί που έμειναν
  const runs = RUN_MODES.filter((m) => m === curRun || liveRuns.includes(m)).map((m) => (
    <div key={m} style={{ display: m === curRun ? 'contents' : 'none' }}>
      <RunView mode={m} variant={prefs.rush as RushVariant} onVariant={(v) => setPrefs({ rush: v })} active={active && m === curRun} commandsRef={commandsRef} onRetry={(ids) => startRetry({ kind: 'ids', ids })} onLive={onLive} />
    </div>
  ));

  // μία σειρά πλοήγησης: τρόποι με υπογράμμιση και, δεξιά, τα εργαλεία (στη σειρά της «Βελτίωσης» ή, στα Φινάλε, δική της)
  const bar = (
    <div className="tx txk imp-bar">
      <span className="imp-vr" aria-hidden />
      <div className="imp-modes" role="group" aria-label={L('Τρόπος', 'Mode')}>
        {modes.map((m) => (
          <button
            key={m.mode}
            type="button"
            aria-pressed={inTrain && mode === m.mode}
            title={modeTitle(m)}
            onClick={(e) => {
              pickMode(m.mode);
              // με το ποντίκι η εστίαση δεν μένει στο κουμπί: το Enter ανήκει πάλι στη σκακιέρα (πληκτρολόγηση κίνησης)
              if (e.detail > 0) e.currentTarget.blur();
            }}
          >
            {m.icon && <m.icon aria-hidden />}
            {modeLabel(m)}
            {m.mode === 'review' && due > 0 && <span className="imp-badge tnum">{fmtNum(due)}</span>}
          </button>
        ))}
      </div>
      <div className="imp-tools">
        {secSources.length > 0 && (
          <button
            type="button"
            className="kb-btn ghost sm"
            aria-pressed={view === 'collection'}
            aria-label={L('Συλλογές', 'Collections')}
            title={L('Κάθε συλλογή χωριστά: οι θέσεις της με τη σειρά και η πρόοδός σου', 'Each collection on its own: its positions in order and your progress')}
            onClick={() => (view === 'collection' ? setView('train') : openCollection(col && secSources.some((s) => s.key === col.key) ? col.key : secSources[0].key))}
          >
            <ListOrdered aria-hidden />
            <span className="imp-lbl">{L('Συλλογές', 'Collections')}</span>
          </button>
        )}
        <div className="tx-setup-wrap">
          <button
            type="button"
            className="kb-btn ghost sm"
            data-setup-toggle
            aria-label={L('Θέματα και δυσκολία', 'Themes and difficulty')}
            aria-haspopup="dialog"
            aria-expanded={setupOpen}
            disabled={mode !== 'rated' || view !== 'train' || Boolean(retry)}
            title={mode !== 'rated' ? L('Για τα βαθμολογημένα', 'For rated puzzles') : L('Δυσκολία, θέματα, άνοιγμα, χρώμα', 'Difficulty, themes, opening, colour')}
            onClick={() => setSetupOpen((o) => !o)}
          >
            <SlidersHorizontal aria-hidden />
            <span className="imp-lbl">{L('Θέματα και δυσκολία', 'Themes and difficulty')}</span>
            {nFilters > 0 && <span className="imp-badge tnum">{nFilters}</span>}
          </button>
          {setupOpen && (
            <SetupPopover
              filters={prefs.filters}
              onChange={(f) => setPrefs({ filters: f })}
              onApply={() => setNonce((n) => n + 1)}
              onClose={() => setSetupOpen(false)}
              onCollections={() => setView('sources')}
              section={section}
              fallback={fallbackSource}
            />
          )}
        </div>
        {/* χωρίς την κύρια συλλογή ξεχωρίζει ως «Λήψη puzzles» */}
        <button
          type="button"
          className={`kb-btn sm ${inTrain && puzzles === 0 ? 'primary' : 'ghost'}`}
          aria-pressed={view === 'sources'}
          aria-label={L('Πηγές puzzles', 'Puzzle sources')}
          title={puzzles === 0 ? L('Λήψη της κύριας συλλογής και των πρόσθετων συλλογών', 'Download the main collection and the extra collections') : L('Πηγές: η κύρια συλλογή και οι συλλογές (Lucas Chess, τεστ)', 'Sources: the main collection and the collections (Lucas Chess, tests)')}
          onClick={() => setView((v) => (v === 'sources' ? 'train' : 'sources'))}
        >
          {puzzles === 0 ? <Download aria-hidden /> : <Library aria-hidden />}
          <span className="imp-lbl">{puzzles === 0 ? L('Λήψη puzzles', 'Get puzzles') : L('Πηγές', 'Sources')}</span>
        </button>
        {section === 'tactics' && (
          <button type="button" className="kb-btn ghost sm" aria-pressed={view === 'stats'} aria-label={L('Στατιστικά', 'Statistics')} title={L('Στατιστικά (S)', 'Statistics (S)')} data-keys="S" onClick={() => setView((v) => (v === 'stats' ? 'train' : 'stats'))}>
            <ChartLine aria-hidden />
            <span className="imp-lbl">{L('Στατιστικά', 'Statistics')}</span>
          </button>
        )}
      </div>
    </div>
  );
  return (
    <div className={`tx txk${slot !== undefined ? ' tk-slotted' : ''}`}>
      {slot === undefined ? (
        <div className="imp-nav imp-sub">
          <div className="imp-slot">{bar}</div>
        </div>
      ) : (
        slot && createPortal(bar, slot)
      )}
      {content}
      {runs}
    </div>
  );
}
