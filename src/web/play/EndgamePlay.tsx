/**
 * Φινάλε → «Παίξε τη θέση»: θέσεις φινάλε με στόχο (κέρδισε ή κράτα ισοπαλία) που τις παίζεις ως το τέλος
 * απέναντι στη μηχανή (στο φουλ ή σε χαμηλότερο επίπεδο) ή σε φίλο στην ίδια σκακιέρα· η ιδέα της εξάσκησης
 * είναι να ξαναπαίζεις τις ίδιες θέσεις μέχρι να βγαίνουν. Κάθε θέση κρατά προσπάθειες και επιτυχίες.
 */
import { useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, CircleCheck, LayoutList, ListChecks, RotateCcw, Route, Target } from 'lucide-react';
import { Position } from '../../core/chess.ts';
import { Game } from '../../core/game.ts';
import { writeGame } from '../../core/pgn.ts';
import { BOARD_THEMES, pieceUrl } from '../components/Board.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { L } from '../i18n.ts';
import { newTabId, useApp } from '../store.ts';
import { useBoardSettings } from '../tactics/common.tsx';
import { setUiLater } from '../tactics/store.ts';
import { ENGINE_BOTS, LEELA_BOT, maiaBot, type BotSpec } from './bots.ts';
import { useLc0 } from './lc0.ts';
import { Lc0Install } from '../components/Lc0Install.tsx';
import { NO_HINTS, type PlaySettings } from './session.ts';
import { PlayGame, t2 } from './PlayGame.tsx';
import { CAT_ORDER, MIXED, PLAYOUTS, catName, catTip, goalLine, materialLine, sideOf, sourceLine, type Playout, type PlayoutCat, type PlayoutRecord } from './playouts.ts';
import '../tactics/tactics.css';
import './play.css';

/** Αντίπαλοι για τις θέσεις: η μηχανή στο φουλ (προεπιλογή), μερικά bots, ή φίλος. */
type Opp = 'full' | 'leela' | 'maia' | 'master' | 'solid' | 'student' | 'friend';
const OPPS: Opp[] = ['full', 'leela', 'maia', 'master', 'solid', 'student', 'friend'];

interface Remembered {
  opp?: Opp;
  cat?: PlayoutCat | 'all';
  goal?: 'all' | 'win' | 'draw';
  /** οι θέσεις χωρισμένες ανά είδος (κουμπί «Κατηγορίες»)· αλλιώς όλες μαζί */
  cats?: boolean;
  stats?: Record<string, PlayoutRecord>;
}

function remembered(): Remembered {
  return (((useApp.getState().settings?.ui as Record<string, unknown> | undefined)?.playouts ?? {}) as Remembered) || {};
}

const botOf = (o: Opp): BotSpec =>
  o === 'leela' ? LEELA_BOT : o === 'maia' ? maiaBot(1900) : (ENGINE_BOTS.find((b) => b.id === (o === 'friend' ? 'full' : o)) ?? ENGINE_BOTS[ENGINE_BOTS.length - 1]);

/** Μικρή σκακιέρα χωρίς κινήσεις, για τις κάρτες. */
export function MiniBoard({ fen, orientation }: { fen: string; orientation: 'white' | 'black' }) {
  const bs = useBoardSettings();
  const theme = BOARD_THEMES[bs.theme ?? 'classic'] ?? BOARD_THEMES.classic;
  const set = bs.pieceSet ?? 'cburnett';
  const rows = fen.split(' ')[0].split('/');
  const cells: Array<{ piece: number; dark: boolean; key: string }> = [];
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r] ?? '') {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++, f++) cells.push({ piece: 0, dark: (r + f) % 2 === 1, key: `${r}${f}` });
      } else {
        const k = ' PNBRQK'.indexOf(ch.toUpperCase());
        cells.push({ piece: k + (ch === ch.toLowerCase() ? 8 : 0), dark: (r + f) % 2 === 1, key: `${r}${f}` });
        f++;
      }
    }
  }
  const ordered = orientation === 'white' ? cells : [...cells].reverse();
  return (
    <div className="mini-board" aria-hidden>
      {ordered.map((c) => (
        <span key={c.key} style={{ background: c.dark ? theme.dark : theme.light }}>
          {c.piece > 0 && <img src={pieceUrl(set, c.piece)} alt="" draggable={false} />}
        </span>
      ))}
    </div>
  );
}

export function EndgamePlay({ active, onExercises }: { active: boolean; onExercises?: () => void }) {
  const [game, setGame] = useState<{ p: Playout; opp: Opp; list: Playout[]; seq: number } | null>(null);
  const seq = useRef(0);
  const start = (p: Playout, opp: Opp, list: Playout[]) => setGame({ p, opp, list, seq: ++seq.current });
  return (
    <div className="tx bots eg-play">
      {game ? <PlayoutGame key={game.seq} p={game.p} opp={game.opp} list={game.list} active={active} onList={() => setGame(null)} onStart={start} /> : <PlayoutList onStart={start} onExercises={onExercises} />}
    </div>
  );
}

function PlayoutList({ onStart, onExercises }: { onStart: (p: Playout, opp: Opp, list: Playout[]) => void; onExercises?: () => void }) {
  const settings = useApp((s) => s.settings);
  const mem = ((settings?.ui as Record<string, unknown> | undefined)?.playouts ?? {}) as Remembered;
  const stats = mem.stats ?? {};
  const lc0 = useLc0();
  // η Leela και η Maia μόνο όταν έχουν κατέβει
  const avail = OPPS.filter((o) => (o === 'leela' ? Boolean(lc0?.leela) : o === 'maia' ? (lc0?.maia ?? []).some((m) => m.elo === 1900) : true));
  const opp: Opp = avail.includes(mem.opp as Opp) ? (mem.opp as Opp) : 'full';
  const cats = mem.cats === true;
  // χωρίς τις κατηγορίες: όλες μαζί, από τις πιο εύκολες, με τα είδη ανακατεμένα
  const cat = cats ? (mem.cat ?? 'all') : 'all';
  const goal = mem.goal ?? 'all';
  const save = (patch: Partial<Remembered>) => setUiLater({ playouts: { ...remembered(), ...patch } });
  const noEngine = !(settings?.engines ?? []).length;

  const shown = (cats ? PLAYOUTS : MIXED).filter((p) => (cat === 'all' || p.cat === cat) && (goal === 'all' || p.goal === goal));
  const done = PLAYOUTS.filter((p) => (stats[p.id]?.ok ?? 0) > 0).length;
  const groups: Array<{ c: PlayoutCat | null; items: Playout[] }> = cats
    ? CAT_ORDER.map((c) => ({ c, items: shown.filter((p) => p.cat === c) })).filter((g) => g.items.length)
    : [{ c: null, items: shown }];
  const ordered = groups.flatMap((g) => g.items);

  const oppLabel = (o: Opp) =>
    o === 'friend'
      ? L('Φίλος (ίδια σκακιέρα)', 'A friend (same board)')
      : o === 'full'
        ? L('Stockfish στο φουλ', 'Full-strength Stockfish')
        : o === 'leela'
          ? L('Leela (παίζει για νίκη)', 'Leela (plays to win)')
          : o === 'maia'
            ? L('Maia 1900 (σαν άνθρωπος)', 'Maia 1900 (human-like)')
            : `${t2(botOf(o).name).split(' ')[0]} ~${botOf(o).elo}`;

  return (
    <div className="eg-list">
      <header className="bots-head">
        <h1>{L('Παίξε τη θέση', 'Play it out')}</h1>
        <p className="muted">
          {L(
            'Θέσεις φινάλε από παρτίδες δυνατών παικτών και από την κλασική θεωρία. Παίζεις την πλευρά που έχει τη σειρά: κέρδισε τις κερδισμένες, κράτα τις ισόπαλες. Ξαναπαίξ’ τες μέχρι να βγαίνουν, απέναντι στη μηχανή ή σε έναν φίλο.',
            'Endgame positions from strong players’ games and from classical theory. You play the side to move: win the won ones, hold the drawn ones. Replay them until they come easily, against the engine or a friend.',
          )}
        </p>
        <div className="eg-course-actions">
          <span className="bots-progress tnum">
            <CircleCheck className="ic ic-sm" aria-hidden />
            {L(`Πέτυχες τον στόχο σε ${done} από ${PLAYOUTS.length} θέσεις`, `Goal reached in ${done} of ${PLAYOUTS.length} positions`)}
          </span>
          <span style={{ flex: 1 }} />
          {onExercises && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onExercises} title={L('Θέσεις από τις συλλογές φινάλε (κύρια συλλογή, Lucas Chess): λύνεις ή παίζεις απέναντι στη μηχανή', 'Positions from the endgame collections (main collection, Lucas Chess): solve them or play them out against the engine')}>
              <ListChecks className="ic ic-sm" aria-hidden />
              {L('Ασκήσεις από συλλογές', 'Exercises from collections')}
            </button>
          )}
        </div>
      </header>

      <div className="eg-filters">
        <div className="play-opt">
          <span className="field-label">{L('Αντίπαλος', 'Opponent')}</span>
          <Segmented label={L('Αντίπαλος', 'Opponent')} value={opp} onChange={(v) => save({ opp: v })} options={avail.map((o) => ({ value: o, label: oppLabel(o) }))} />
          {opp !== 'friend' && (
            <span className="faint small eg-motive">
              {L(
                'Ο υπολογιστής παίζει με κίνητρο: δεν απλουστεύει άσκοπα (π.χ. δεν δίνει τον πύργο για τον ίππο επειδή όλα δείχνουν 0,00), κρατά υλικό, σε στριμώχνει και διαλέγει από τις ισάξιες κινήσεις αυτή που σου αφήνει τις περισσότερες ευκαιρίες για λάθος.',
                'The computer plays with a purpose: no pointless simplifications (it will not give its rook for your knight just because everything shows 0.00); it keeps material, squeezes you and, among equal moves, picks the one that gives you the most chances to go wrong.',
              )}
            </span>
          )}
          {!lc0?.leela && (
            <span className="faint small eg-leela-hint">
              {L('Και με νευρωνικό δίκτυο: ', 'Also with a neural network: ')}
              <Lc0Install variant="tx" compact />
            </span>
          )}
        </div>
        <div className="play-opt">
          <span className="field-label">{L('Στόχος', 'Goal')}</span>
          <div className="eg-goalrow">
            <Segmented
              label={L('Στόχος', 'Goal')}
              value={goal}
              onChange={(v) => save({ goal: v })}
              options={[
                { value: 'all', label: L('Όλοι', 'All') },
                { value: 'win', label: L('Κέρδισε', 'Win') },
                { value: 'draw', label: L('Κράτα ισοπαλία', 'Hold the draw') },
              ]}
            />
            <button type="button" className={`btn btn-sm ${cats ? 'btn-secondary is-on' : 'btn-ghost'}`} aria-pressed={cats} title={L('Χώρισε τις θέσεις ανά είδος φινάλε', 'Group the positions by endgame type')} onClick={() => save({ cats: !cats })}>
              <LayoutList className="ic ic-sm" aria-hidden />
              {L('Κατηγορίες', 'Categories')}
            </button>
          </div>
        </div>
      </div>
      {cats && (
      <div className="gl-books" role="group" aria-label={L('Είδος φινάλε', 'Endgame type')}>
        <button type="button" className={`chip${cat === 'all' ? ' is-on' : ''}`} aria-pressed={cat === 'all'} onClick={() => save({ cat: 'all' })}>
          {L('Όλα', 'All')} <span className="faint tnum">{PLAYOUTS.length}</span>
        </button>
        {CAT_ORDER.filter((c) => PLAYOUTS.some((p) => p.cat === c)).map((c) => (
          <button key={c} type="button" className={`chip${cat === c ? ' is-on' : ''}`} aria-pressed={cat === c} onClick={() => save({ cat: c })}>
            {catName(c)} <span className="faint tnum">{PLAYOUTS.filter((p) => p.cat === c).length}</span>
          </button>
        ))}
      </div>
      )}
      {noEngine && opp !== 'friend' && <div className="play-note">{L('Για να παίξεις με τη μηχανή χρειάζεται μια μηχανή (Ρυθμίσεις → Μηχανές). Με φίλο παίζεις και χωρίς.', 'To play the engine you need one (Settings → Engines). With a friend you can play without.')}</div>}

      {groups.map((g) => (
        <section key={g.c ?? 'all'} className="eg-group">
          {g.c && <h2 className="gl-book-h">{catName(g.c)}</h2>}
          {g.c && <p className="gl-book-note">{catTip(g.c)}</p>}
          <div className="eg-grid">
            {g.items.map((p) => {
              const r = stats[p.id];
              return (
                <button key={p.id} type="button" className={`eg-card${(r?.ok ?? 0) > 0 ? ' is-done' : ''}`} disabled={noEngine && opp !== 'friend'} onClick={() => onStart(p, opp, ordered)}>
                  <span className="eg-num tnum">{ordered.indexOf(p) + 1}</span>
                  <MiniBoard fen={p.fen} orientation={sideOf(p)} />
                  <span className="eg-txt">
                    <span className={`eg-goal is-${p.goal}`}>
                      <Target className="ic ic-sm" aria-hidden />
                      {goalLine(p)}
                    </span>
                    {p.title && <span className="eg-title">{L(p.title.el, p.title.en)}</span>}
                    <span className="eg-mat">{materialLine(p.fen)}</span>
                    <span className="eg-src faint">{sourceLine(p)}</span>
                    <span className="eg-meta faint tnum">
                      <span title={L('Δυσκολία', 'Difficulty')}>{'●'.repeat(p.level) + '○'.repeat(3 - p.level)}</span>
                      {r && <span>{L(`${r.ok}/${r.t} επιτυχίες`, `${r.ok}/${r.t} successes`)}</span>}
                      {(r?.ok ?? 0) > 0 && <CircleCheck className="ic ic-sm eg-ok" aria-label={L('Πέτυχες τον στόχο', 'Goal reached')} />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="faint small eg-credit">
        {L(
          'Οι θέσεις από παρτίδες είναι από τη βάση Lumbras (οι κινήσεις των παρτίδων είναι γεγονότα) και οι στόχοι ελέγχθηκαν με τη Stockfish 19· οι θεωρητικές θέσεις, όπου έχουν ως 7 κομμάτια, και με πίνακα φινάλε.',
          'Game positions come from the Lumbras database (game moves are facts) and their goals were checked with Stockfish 19; theory positions with up to 7 pieces also with an endgame tablebase.',
        )}
      </p>
    </div>
  );
}

function PlayoutGame({ p, opp, list, active, onList, onStart }: { p: Playout; opp: Opp; list: Playout[]; active: boolean; onList: () => void; onStart: (p: Playout, opp: Opp, list: Playout[]) => void }) {
  const openTab = useApp((st) => st.openTab);
  const friend = opp === 'friend';
  const lc0 = useLc0();
  // με κίνητρο: η μηχανή στριμώχνει και δεν απλουστεύει άσκοπα (και τα bots δεν δίνουν υλικό για νεκρή ισοπαλία)
  const s: PlaySettings = useMemo(() => ({ color: sideOf(p), bot: botOf(opp), engineId: opp === 'leela' ? (lc0?.leela ?? 'leela') : '', clock: null, hints: NO_HINTS, pressure: true }), [p, opp, lc0?.leela]);
  // η επόμενη θέση της λίστας που φαινόταν (με τα φίλτρα και τη σειρά της)
  const i = list.findIndex((x) => x.id === p.id);
  const next = list.length ? list[(i + 1) % list.length] : null;
  const title = `${goalLine(p)} · ${materialLine(p.fen)}`;
  const [showPv, setShowPv] = useState(false);

  // η γραμμή της μηχανής από τη θέση, σε καρτέλα σκακιέρας
  const pvPgn = () => {
    const g = new Game(p.fen);
    const pos = Position.fromFen(p.fen);
    let n = g.root;
    for (const san of p.pv) {
      const m = pos.parseSan(san);
      if (!m) break;
      n = g.addMove(n, m, pos);
      pos.makeMove(m);
    }
    g.headers.Event = L('Η γραμμή της μηχανής', 'The engine’s line');
    g.headers.White = '?';
    g.headers.Black = '?';
    return writeGame(g);
  };

  return (
    <PlayGame
      s={s}
      active={active}
      startFen={p.fen}
      friend={friend}
      goal={p.goal}
      event={L(`Παίξε τη θέση: ${goalLine(p)}`, `Play it out: ${goalLine(p)}`)}
      backLabel={L('Όλες οι θέσεις', 'All positions')}
      onBack={onList}
      head={
        <div className="eg-head">
          <div className={`eg-goal big is-${p.goal}`}>
            <Target className="ic" aria-hidden />
            {goalLine(p)}
          </div>
          {p.title && <div className="eg-title">{L(p.title.el, p.title.en)}</div>}
          <div className="muted small">
            {materialLine(p.fen)} · {catName(p.cat)}
            {p.source.kind === 'game' ? ` · ${sourceLine(p)}` : ''}
          </div>
          {p.idea && <p className="small">{L(p.idea.el, p.idea.en)}</p>}
          <div className="faint small">
            {friend
              ? L('Ο φίλος σου παίζει την άλλη πλευρά στην ίδια σκακιέρα.', 'Your friend plays the other side on the same board.')
              : L(`Αντίπαλος: ${t2(s.bot.name)}.`, `Opponent: ${t2(s.bot.name)}.`)}{' '}
            {p.goal === 'win'
              ? L('Νίκη μετρά μόνο με ματ.', 'Only checkmate counts as a win.')
              : friend
                ? L('Ισοπαλία μετρά με πατ, επανάληψη, 50 κινήσεις, ανεπαρκές υλικό ή με συμφωνία.', 'A draw counts by stalemate, repetition, the 50-move rule, insufficient material or by agreement.')
                : L('Ισοπαλία μετρά με πατ, επανάληψη, 50 κινήσεις, ανεπαρκές υλικό ή με συμφωνία (η μηχανή δέχεται μόνο όταν δεν έχει πια τίποτα να παίξει: χωρίς υλικό ή αξιολόγηση υπέρ της, μετά από 20 κινήσεις).', 'A draw counts by stalemate, repetition, the 50-move rule, insufficient material or by agreement (the engine accepts only when it has nothing left to play for: no extra material and no edge, after 20 moves).')}
          </div>
        </div>
      }
      onFinish={(r) => {
        const mem = remembered();
        const stats = { ...(mem.stats ?? {}) };
        const old = stats[p.id] ?? { t: 0, ok: 0 };
        stats[p.id] = { t: old.t + 1, ok: old.ok + (r.success ? 1 : 0) };
        setUiLater({ playouts: { ...mem, stats } });
      }}
      endActions={(r, pgn) => (
        <>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onStart(p, opp, list)}>
            <RotateCcw className="ic ic-sm" aria-hidden />
            {L('Ξανά από την ίδια θέση', 'Again from the same position')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openTab({ id: newTabId('game'), kind: 'game', title, pgn })}>
            <Activity className="ic ic-sm" aria-hidden />
            {L('Ανάλυση της παρτίδας', 'Analyse the game')}
          </button>
          {p.pv.length > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => (showPv ? openTab({ id: newTabId('game'), kind: 'game', title: L('Η γραμμή της μηχανής', 'The engine’s line'), pgn: pvPgn() }) : setShowPv(true))}>
              <Route className="ic ic-sm" aria-hidden />
              {showPv ? L('Άνοιξέ τη στη σκακιέρα', 'Open it on a board') : L('Πώς το κάνει η μηχανή', 'How the engine does it')}
            </button>
          )}
          {next && next.id !== p.id && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStart(next, opp, list)}>
              <ArrowRight className="ic ic-sm" aria-hidden />
              {L('Επόμενη θέση', 'Next position')}
            </button>
          )}
          {showPv && (
            <p className="small eg-pv">
              {L('Η μηχανή από την αρχική θέση: ', 'The engine from the starting position: ')}
              <span className="tnum">{pvText(p)}</span>
              {r.success ? '' : L(' — δοκίμασέ το ξανά!', ' — try again!')}
            </p>
          )}
        </>
      )}
    />
  );
}

/** «45.Rb7 Kf6 46.a5 …» από τη γραμμή της μηχανής. */
function pvText(p: Playout): string {
  const parts = p.fen.split(' ');
  let num = Number(parts[5]) || 1;
  let white = parts[1] === 'w';
  const out: string[] = [];
  p.pv.forEach((san, i) => {
    if (white) out.push(`${num}.${san}`);
    else out.push(i === 0 ? `${num}…${san}` : san);
    if (!white) num++;
    white = !white;
  });
  return out.join(' ') + (p.pv.length ? ' …' : '');
}

