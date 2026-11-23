/**
 * Εκπαίδευση ανοιγμάτων: η εφαρμογή παίζει τις κινήσεις του αντιπάλου από μια βάση
 * (με βάρη) και ο χρήστης βρίσκει τις κινήσεις του ρεπερτορίου. Η πρόοδος ανά θέση
 * κρατιέται με επανάληψη σε διαστήματα (Έγγραφα\Ruru\.knightbase\training).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, FlipVertical2, GraduationCap, Lightbulb, RotateCcw, SkipForward, Swords, Trash2 } from 'lucide-react';
import { Position, START_FEN, moveFrom, moveTo } from '../../core/chess.ts';
import { Game, type Shape } from '../../core/game.ts';
import { writeGame } from '../../core/pgn.ts';
import { answers, pickOpponentMove, review, summarize, type CardStats, type TrainMove, type TrainTree } from '../../core/training.ts';
import { api } from '../api.ts';
import { L } from '../i18n.ts';
import { newTabId, reportError, useApp, type Tab } from '../store.ts';
import { Board } from '../components/Board.tsx';
import { useDrawnShapes } from '../components/drawnShapes.ts';
import { Progress } from '../components/ui.tsx';
import { playMoveSound, playSound } from '../sounds.ts';

type TrainerTab = Extract<Tab, { kind: 'trainer' }>;
type Color = 'white' | 'black';

interface Step {
  uci: string;
  san: string;
  user: boolean;
  /** κίνηση του χρήστη: σωστή με την πρώτη, χωρίς βοήθεια */
  ok?: boolean;
}

interface Line {
  fen: string;
  key: string;
  ply: number;
  steps: Step[];
  lastMove?: number;
  tries: number;
  /** η θέση μετρήθηκε ήδη ως λάθος (λάθος κίνηση ή βοήθεια) */
  failed: boolean;
  /** 0 τίποτα, 1 τετράγωνο του κομματιού, 2 βέλος */
  hint: number;
  ended: boolean;
}

type Msg = { text: string; kind: 'info' | 'ok' | 'bad' };

const DEPTHS = [8, 12, 16, 20, 24, 30, 40, 60];

const sideToMove = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

function advance(tree: TrainTree, line: Line, m: TrainMove, depth: number, color: Color, step: Step): Line {
  const p = Position.fromFen(line.fen);
  const mv = p.parseUci(m.uci);
  p.makeMove(mv);
  const fen = p.fen();
  const ply = line.ply + 1;
  const ended = ply >= depth || (sideToMove(fen) === color ? !answers(tree, m.to).length : !tree.nodes[m.to]?.length);
  return { fen, key: m.to, ply, steps: [...line.steps, step], lastMove: mv, tries: 0, failed: false, hint: 0, ended };
}

function lineResult(line: Line): string {
  const mine = line.steps.filter((s) => s.user);
  const good = mine.filter((s) => s.ok).length;
  return L(`Τέλος γραμμής: ${good}/${mine.length} με την πρώτη · Enter για την επόμενη`, `End of line: ${good}/${mine.length} at first try · Enter for the next`);
}

export function TrainerWindow({ tab, active }: { tab: TrainerTab; active: boolean }) {
  const settings = useApp((s) => s.settings);
  const library = useApp((s) => s.library);
  const openTab = useApp((s) => s.openTab);
  const updateTab = useApp((s) => s.updateTab);

  const [dbId, setDbId] = useState(tab.dbId);
  const [color, setColor] = useState<Color>(tab.color ?? 'white');
  const [rootFen, setRootFen] = useState(tab.fen ?? START_FEN);
  const [depth, setDepth] = useState(20);
  const [mode, setMode] = useState<'review' | 'random'>('review');
  const [orientation, setOrientation] = useState<Color>(tab.color ?? 'white');
  const [tree, setTree] = useState<TrainTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<CardStats>({});
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const [line, setLine] = useState<Line | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [comment, setComment] = useState('');
  const [session, setSession] = useState({ ok: 0, total: 0 });
  const [now, setNow] = useState(() => Date.now());

  const dbName = library.find((d) => d.id === dbId)?.name ?? '';
  useEffect(() => {
    updateTab(tab.id, { title: `${L('Εκπαίδευση', 'Training')} · ${dbName || '…'}` });
  }, [dbName, tab.id, updateTab]);

  // αποθήκευση της προόδου (με καθυστέρηση· αμέσως όταν αλλάζει βάση / χρώμα ή κλείνει το παράθυρο)
  const pending = useRef<{ db: string; color: Color; stats: CardStats } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) void api.put('/api/training/stats', p).catch(reportError);
  }, []);
  useEffect(() => flush, [dbId, color, flush]);

  const setProgress = (next: CardStats) => {
    statsRef.current = next;
    setStats(next);
    pending.current = { db: dbId, color, stats: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  };
  const grade = (key: string, correct: boolean) => setProgress({ ...statsRef.current, [key]: review(statsRef.current[key], correct, Date.now()) });

  // δέντρο και πρόοδος
  useEffect(() => {
    if (!dbId) return;
    let cancelled = false;
    setLoading(true);
    setTree(null);
    setLine(null);
    setMsg(null);
    Promise.all([
      api.post<TrainTree>('/api/training/tree', { db: dbId, fen: rootFen, color, depth }),
      api.get<{ stats: CardStats }>(`/api/training/stats?db=${dbId}&color=${color}`),
    ])
      .then(([t, s]) => {
        if (cancelled) return;
        statsRef.current = s.stats;
        setStats(s.stats);
        setTree(t);
      })
      .catch(reportError)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dbId, color, rootFen, depth]);

  const startLine = useCallback(() => {
    if (!tree) return;
    const mine = sideToMove(tree.rootFen) === color;
    const ended = mine ? !answers(tree, tree.root).length : !tree.nodes[tree.root]?.length;
    setLine({ fen: tree.rootFen, key: tree.root, ply: 0, steps: [], tries: 0, failed: false, hint: 0, ended });
    setComment('');
    setNow(Date.now());
    setMsg(
      ended
        ? { text: L('Η βάση δεν έχει κινήσεις από αυτή τη θέση για αυτό το χρώμα.', 'The database has no moves from this position for this colour.'), kind: 'bad' }
        : { text: mine ? L('Η σειρά σου: παίξε την κίνηση του ρεπερτορίου', 'Your move: play the repertoire move') : L('Ο αντίπαλος παίζει…', 'The opponent is moving…'), kind: 'info' },
    );
  }, [tree, color]);
  useEffect(() => startLine(), [startLine]);

  // κίνηση του αντιπάλου
  useEffect(() => {
    if (!tree || !line || line.ended || sideToMove(line.fen) === color) return;
    const t = setTimeout(
      () => {
        const m = pickOpponentMove(tree, line.key, { stats: statsRef.current, now: Date.now(), depth: depth - line.ply, mode });
        if (!m) return setLine({ ...line, ended: true });
        const next = advance(tree, line, m, depth, color, { uci: m.uci, san: m.san, user: false });
        setLine(next);
        playMoveSound(m.san);
        setComment(m.c ?? '');
        if (next.ended) setMsg({ text: lineResult(next), kind: 'info' });
        else if (!next.steps.some((s) => s.user)) setMsg({ text: L('Η σειρά σου: παίξε την κίνηση του ρεπερτορίου', 'Your move: play the repertoire move'), kind: 'info' });
      },
      line.steps.length ? 450 : 250,
    );
    return () => clearTimeout(t);
  }, [tree, line, depth, mode, color]);

  const userTurn = Boolean(tree && line && !line.ended && sideToMove(line.fen) === color);

  const onMove = (from: number, to: number, promo: number) => {
    if (!tree || !line || !userTurn) return;
    const p = Position.fromFen(line.fen);
    const mv = p.findMove(from, to, promo);
    if (!mv) return;
    const uci = p.moveToUci(mv);
    const san = p.san(mv);
    const acc = answers(tree, line.key);
    const hit = acc.find((a) => a.uci === uci);
    if (hit) {
      const correct = !line.failed;
      if (correct) grade(line.key, true);
      setSession((s) => ({ ok: s.ok + (correct ? 1 : 0), total: s.total + 1 }));
      const next = advance(tree, line, hit, depth, color, { uci, san, user: true, ok: correct });
      setLine(next);
      playMoveSound(san);
      setComment(hit.c ?? '');
      let text = correct ? L('Σωστά!', 'Correct!') : L('Σωστά — με βοήθεια', 'Correct — with help');
      const others = acc.filter((a) => a !== hit).map((a) => a.san);
      if (hit !== acc[0]) text += L(` · κύρια συνέχεια: ${acc[0].san}`, ` · main move: ${acc[0].san}`);
      else if (others.length) text += L(` · παίζεται και: ${others.join(', ')}`, ` · also played: ${others.join(', ')}`);
      if (next.ended) text += ` · ${lineResult(next)}`;
      setMsg({ text, kind: correct ? 'ok' : 'info' });
      return;
    }
    if (!line.failed) grade(line.key, false);
    const tries = line.tries + 1;
    setLine({ ...line, tries, failed: true, hint: tries >= 2 ? 2 : line.hint });
    playSound('error');
    const marked = tree.nodes[line.key]?.some((m) => m.uci === uci);
    const why = marked ? L(`${san}: η βάση τη σημειώνει ως λάθος`, `${san}: marked as a mistake in the database`) : L(`${san}: δεν είναι στο ρεπερτόριο`, `${san}: not in the repertoire`);
    setMsg({ text: why + (tries >= 2 ? L(` · παίξε ${acc[0].san} (βέλος)`, ` · play ${acc[0].san} (arrow)`) : L(' · δοκίμασε ξανά', ' · try again')), kind: 'bad' });
  };

  const showHint = (level: number) => {
    if (!line || !userTurn) return;
    if (!line.failed) grade(line.key, false);
    setLine({ ...line, failed: true, hint: Math.max(line.hint, level) });
  };

  const hintShapes = useMemo(() => {
    const none = { squares: [] as Shape[], arrows: [] as Shape[] };
    if (!tree || !line || !line.hint || line.ended) return none;
    const a = answers(tree, line.key)[0];
    if (!a) return none;
    const mv = Position.fromFen(line.fen).parseUci(a.uci);
    const s: Shape = { color: 'G', from: moveFrom(mv), to: line.hint === 1 ? moveFrom(mv) : moveTo(mv) };
    return line.hint === 1 ? { ...none, squares: [s] } : { ...none, arrows: [s] };
  }, [tree, line]);

  const openInBoard = () => {
    if (!tree || !line?.steps.length) return;
    const g = new Game(tree.rootFen);
    const p = Position.fromFen(tree.rootFen);
    let n = g.root;
    for (const s of line.steps) {
      const mv = p.parseUci(s.uci);
      n = g.addMove(n, mv, p);
      p.makeMove(mv);
    }
    g.headers.Event = `${L('Εκπαίδευση', 'Training')}: ${dbName}`;
    openTab({ id: newTabId('game'), kind: 'game', title: L('Γραμμή εκπαίδευσης', 'Training line'), pgn: writeGame(g) });
  };

  const resetProgress = () => {
    if (!window.confirm(L(`Μηδενισμός της προόδου (${color === 'white' ? 'λευκά' : 'μαύρα'}) σε αυτή τη βάση;`, `Reset the progress (${color}) for this database?`))) return;
    setProgress({});
    flush();
    startLine();
  };

  // πληκτρολόγιο: Enter / Space / → επόμενη γραμμή, H υπόδειξη
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (line?.ended && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight')) {
      e.preventDefault();
      startLine();
    } else if (e.key === 'h' || e.key === 'H') showHint((line?.hint ?? 0) + 1);
  };
  useEffect(() => {
    if (!active) return;
    const fn = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [active]);

  // `now` μόνο ως αφορμή ανανέωσης: μια θέση με λάθος λήγει αμέσως
  const summary = useMemo(() => (tree ? summarize(tree, sideToMove(tree.rootFen) === color, depth, stats, Math.max(now, Date.now())) : null), [tree, color, depth, stats, now]);

  const moveList = useMemo(() => {
    if (!line || !tree) return [];
    const [, turn, , , , full] = tree.rootFen.split(' ');
    const first = turn === 'b' ? 1 : 0;
    return line.steps.map((s, i) => {
      const ply = first + i;
      const num = Math.floor(ply / 2) + (Number(full) || 1);
      const label = ply % 2 === 0 ? `${num}.${s.san}` : i === 0 ? `${num}...${s.san}` : s.san;
      return { label, s };
    });
  }, [line, tree]);

  const dbs = library.filter((d) => d.games > 0);
  const drawn = useDrawnShapes(line?.fen ?? rootFen);

  return (
    <div className="board-window">
      <div className="bw-left">
        <div className="bw-board-row">
          <div className="bw-board">
            <Board
              fen={line?.fen ?? rootFen}
              orientation={orientation}
              movable={userTurn ? color : 'none'}
              lastMove={line?.lastMove}
              shapes={drawn.shapes.length ? [...hintShapes.squares, ...drawn.shapes] : hintShapes.squares}
              hintArrows={hintShapes.arrows}
              onShape={drawn.onShape}
              theme={settings?.boardTheme}
              pieceSet={settings?.pieceSet}
              coordinates={settings?.showCoordinates ?? true}
              onMove={onMove}
              animationMs={settings?.animationMs ?? 250}
              oneClick={(settings?.ui as Record<string, unknown> | undefined)?.oneClick !== false}
            />
          </div>
        </div>
        <div className="nav-bar">
          <button className="icon-btn" title={L('Γύρισμα σκακιέρας', 'Flip board')} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <FlipVertical2 size={17} />
          </button>
          <span className="spacer" />
          <span className="fen-turn">{color === 'white' ? L('Παίζεις με τα λευκά', 'You play White') : L('Παίζεις με τα μαύρα', 'You play Black')}</span>
        </div>
        {msg && <div className={`mode-banner trainer-msg ${msg.kind}`}>{msg.text}</div>}
        {comment && <div className="trainer-comment">{comment}</div>}
      </div>

      <div className="bw-right">
        <div className="toolbar trainer-setup">
          <select value={dbId} onChange={(e) => setDbId(e.target.value)} title={L('Βάση ρεπερτορίου', 'Repertoire database')}>
            {!dbId && <option value="">{L('— διάλεξε βάση —', '— choose a database —')}</option>}
            {dbs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.games.toLocaleString('el-GR')})
              </option>
            ))}
          </select>
          <div className="seg">
            {(['white', 'black'] as const).map((c) => (
              <button
                key={c}
                className={color === c ? 'on' : ''}
                onClick={() => {
                  setColor(c);
                  setOrientation(c);
                }}
              >
                {c === 'white' ? L('Λευκά', 'White') : L('Μαύρα', 'Black')}
              </button>
            ))}
          </div>
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} title={L('Βάθος γραμμής (ημικινήσεις)', 'Line depth (plies)')}>
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {L(`${d} ημικινήσεις`, `${d} plies`)}
              </option>
            ))}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'review' | 'random')} title={L('Επιλογή γραμμών', 'Line selection')}>
            <option value="review">{L('Επανάληψη (ό,τι χρειάζεται)', 'Review (what is due)')}</option>
            <option value="random">{L('Τυχαία (με βάρη)', 'Random (weighted)')}</option>
          </select>
        </div>

        <div className="trainer-body">
          <h2 className="trainer-title">
            <GraduationCap size={18} /> {L('Εκπαίδευση ανοιγμάτων', 'Opening training')}
          </h2>
          {rootFen !== START_FEN && (
            <div className="trainer-root">
              {L('Από θέση', 'From position')}: <code>{rootFen.split(' ').slice(0, 2).join(' ')}</code>
              <button className="small-btn" onClick={() => setRootFen(START_FEN)}>
                {L('Από την αρχή', 'From the start')}
              </button>
            </div>
          )}
          {!dbId && <p className="muted">{L('Διάλεξε τη βάση με το ρεπερτόριό σου.', 'Choose the database with your repertoire.')}</p>}
          {loading && <p className="muted">{L('Φόρτωση δέντρου…', 'Loading tree…')}</p>}

          {summary && (
            <>
              <div className="stat-cards trainer-stats">
                <div className="stat-card">
                  <div className="v">{summary.total}</div>
                  <div className="k">{L('θέσεις σου', 'your positions')}</div>
                </div>
                <div className="stat-card">
                  <div className="v">{summary.fresh}</div>
                  <div className="k">{L('νέες', 'new')}</div>
                </div>
                <div className="stat-card">
                  <div className="v">{summary.due}</div>
                  <div className="k">{L('για επανάληψη', 'due')}</div>
                </div>
                <div className="stat-card">
                  <div className="v">{summary.learned}</div>
                  <div className="k">{L('μαθημένες', 'learned')}</div>
                </div>
              </div>
              <Progress
                value={summary.total ? (summary.learned + summary.learning / 2) / summary.total : 0}
                label={L(`${summary.learning} μαθαίνονται · σήμερα ${session.ok}/${session.total} με την πρώτη`, `${summary.learning} learning · today ${session.ok}/${session.total} at first try`)}
              />
            </>
          )}

          {line && (
            <div className="trainer-line">
              {moveList.length ? (
                moveList.map(({ label, s }, i) => (
                  <span key={i} className={s.user ? (s.ok ? 'mine ok' : 'mine bad') : 'opp'}>
                    {label}
                  </span>
                ))
              ) : (
                <span className="muted">{L('Η γραμμή ξεκινά…', 'The line starts…')}</span>
              )}
            </div>
          )}

          <div className="trainer-actions">
            <button disabled={!userTurn} onClick={() => showHint((line?.hint ?? 0) + 1)} title={L('Υπόδειξη (H): πρώτα το κομμάτι, μετά η κίνηση', 'Hint (H): first the piece, then the move')}>
              <Lightbulb size={15} /> {L('Υπόδειξη', 'Hint')}
            </button>
            <button disabled={!userTurn} onClick={() => showHint(2)}>
              <Eye size={15} /> {L('Δείξε την κίνηση', 'Show the move')}
            </button>
            <button className={line?.ended ? 'primary' : ''} disabled={!tree} onClick={startLine} title="Enter">
              <SkipForward size={15} /> {L('Επόμενη γραμμή', 'Next line')}
            </button>
            <button disabled={!line?.steps.length} onClick={openInBoard}>
              <Swords size={15} /> {L('Άνοιγμα στη σκακιέρα', 'Open on a board')}
            </button>
            <button disabled={!tree} onClick={() => setNow(Date.now())} title={L('Ανανέωση στατιστικών', 'Refresh statistics')}>
              <RotateCcw size={15} />
            </button>
            <button className="danger" disabled={!tree} onClick={resetProgress} title={L('Μηδενισμός προόδου', 'Reset progress')}>
              <Trash2 size={15} />
            </button>
          </div>

          {tree && (
            <p className="muted small">
              {tree.source === 'games'
                ? L(`Δέντρο από ${tree.games.toLocaleString('el-GR')} παρτίδες, με τις βαριάντες τους. Κινήσεις με ? ή ?? δεν μετρούν ως σωστές.`, `Tree from ${tree.games.toLocaleString('en-US')} games, with their variations. Moves marked ? or ?? do not count as correct.`)
                : L('Μεγάλη βάση: δέντρο από το ευρετήριο θέσεων (θέσεις με ≥24 παρτίδες· σωστές οι κινήσεις με ≥5% των παρτίδων).', 'Large database: tree from the position index (positions with ≥24 games; moves with ≥5% of the games count as correct).')}
              {tree.pruned ? L(' Μεγάλο δέντρο: κρατήθηκαν οι γραμμές με πιθανότητα ≥0,5%.', ' Large tree: only lines with ≥0.5% probability were kept.') : ''}
              {tree.truncated ? L(' Το δέντρο κόπηκε στο όριο θέσεων.', ' The tree was cut at the position limit.') : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
