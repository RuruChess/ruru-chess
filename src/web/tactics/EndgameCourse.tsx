/**
 * Φινάλε → «Μαθήματα»: τα μαθήματα φινάλε της εφαρμογής σε σειρά δυσκολίας και ανά επίπεδο, από τα βασικά ματ (δύο
 * πύργοι, βασίλισσα, πύργος, δύο αξιωματικοί) ως τις μελέτες. Κάθε μάθημα ανοίγει σαν σχολιασμένη παρτίδα μιας βάσης:
 * η σκακιέρα, όλες οι κινήσεις με τα σχόλια και τις βαριάντες τους, «Επόμενο» / → κίνηση-κίνηση ή αυτόματη προβολή.
 * Δεν παίζεις εσύ ούτε ο υπολογιστής: βλέπεις πώς γίνεται το ματ ή πώς παίζεται το φινάλε.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheck, FlipVertical2, Pause, Play, Target } from 'lucide-react';
import type { GameNode } from '../../core/game.ts';
import { parseGames } from '../../core/pgn.ts';
import { Board } from '../components/Board.tsx';
import { useDrawnShapes } from '../components/drawnShapes.ts';
import { Notation, displaySan, type NotationStyle } from '../components/Notation.tsx';
import { PgnLine, VariationChooser, pgnStep, variationRoot } from '../components/PgnLine.tsx';
import { Spinner } from '../components/ui/Progress.tsx';
import { GameController, useController } from '../gameModel.ts';
import { L, fmtNum } from '../i18n.ts';
import { openLink } from '../components/About.tsx';
import { playMoveSound } from '../sounds.ts';
import { reportError, useApp } from '../store.ts';
import { MiniBoard } from '../play/EndgamePlay.tsx';
import { useBoardSettings, useScreenKeys } from './common.tsx';
import { endgameLessonsApi, markEndgameSeen, setLastEndgame, useEndgameSeen, type EndgameLesson } from './endgameLessons.ts';
import { lessonSide } from './lesson.ts';
import { tr } from './gameLessons.ts';
import { moveText } from './logic.ts';
import './tactics.css';
import '../play/play.css';

/** Πόσο μένει κάθε κίνηση στην αυτόματη προβολή (ms). */
const AUTO_MS = 1800;

export function EndgameCourse({ active }: { active: boolean }) {
  const [items, setItems] = useState<EndgameLesson[] | null>(null);
  const [failed, setFailed] = useState(false);
  // το μάθημα που φαίνεται (θέση στη σειρά), ή null: η λίστα
  const [at, setAt] = useState<number | null>(null);
  const seen = useEndgameSeen();

  useEffect(() => {
    endgameLessonsApi
      .list()
      .then((r) => setItems(r.items))
      .catch((e) => {
        setFailed(true);
        reportError(e);
      });
  }, []);

  if (!items) {
    return <div className="tx-center">{failed ? <p className="muted">{L('Τα μαθήματα δεν φορτώθηκαν.', 'The lessons could not be loaded.')}</p> : <Spinner label={L('Φόρτωση', 'Loading')} />}</div>;
  }

  if (at !== null && items[at]) {
    return (
      <EndgameLessonView
        key={items[at].seq}
        lesson={items[at]}
        index={at}
        total={items.length}
        active={active}
        onBack={() => setAt(null)}
        onNext={at + 1 < items.length ? () => setAt(at + 1) : null}
        onPrev={at > 0 ? () => setAt(at - 1) : null}
      />
    );
  }

  const isSeen = (x: EndgameLesson) => seen.seen.includes(x.seq);
  const done = items.filter(isSeen).length;
  const next = items.find((x) => !isSeen(x)) ?? null;
  // τα επίπεδα με τη σειρά τους (τα μαθήματα έρχονται ήδη με τη σειρά του μαθήματος)
  const levels: Array<{ name: string; items: Array<{ x: EndgameLesson; i: number }> }> = [];
  items.forEach((x, i) => {
    const name = tr(x.part);
    if (levels.length && levels[levels.length - 1].name === name) levels[levels.length - 1].items.push({ x, i });
    else levels.push({ name, items: [{ x, i }] });
  });

  return (
    <div className="tx eg-course">
      <div className="eg-list">
        <header className="bots-head">
          <h1>{L('Μαθήματα φινάλε', 'Endgame lessons')}</h1>
          <p className="muted">
            {L(
              `${items.length} μαθήματα με τη σειρά, από τα βασικά ματ (δύο πύργοι, βασίλισσα, πύργος, δύο αξιωματικοί) ως τα φινάλε πύργων και τις μελέτες. Κάθε μάθημα ανοίγει σαν σχολιασμένη παρτίδα: βλέπεις κίνηση-κίνηση πώς γίνεται το ματ ή πώς παίζεται το φινάλε, με εξήγηση σε κάθε κίνηση και τις βαριάντες.`,
              `${items.length} lessons in order, from the basic mates (two rooks, queen, rook, two bishops) to rook endings and studies. Each lesson opens like an annotated game: you see move by move how the mate is done or how the ending is played, with an explanation for every move and the variations.`,
            )}
          </p>
          <div className="eg-course-actions">
            <button type="button" className="btn btn-primary" onClick={() => setAt(next ? items.indexOf(next) : 0)}>
              <Play className="ic" aria-hidden />
              {next && done > 0
                ? L(`Συνέχισε: ${items.indexOf(next) + 1}. ${tr(next.title)}`, `Continue: ${items.indexOf(next) + 1}. ${tr(next.title)}`)
                : next
                  ? L('Ξεκίνα από το πρώτο μάθημα', 'Start with the first lesson')
                  : L('Ξανά από την αρχή', 'Again from the start')}
            </button>
            <span className="bots-progress tnum">
              <CircleCheck className="ic ic-sm" aria-hidden />
              {L(`Είδες ${done} από ${items.length}`, `Seen ${done} of ${items.length}`)}
            </span>
          </div>
        </header>

        {levels.map((lv, k) => (
          <section key={`${k}-${lv.name}`} className="eg-group">
            <h2 className="gl-book-h">
              {L(`Επίπεδο ${k + 1}`, `Level ${k + 1}`)} · {lv.name}
              <span className="faint tnum eg-course-count">
                {lv.items.filter(({ x }) => isSeen(x)).length}/{lv.items.length}
              </span>
            </h2>
            <div className="eg-grid">
              {lv.items.map(({ x, i }) => (
                <button key={x.seq} type="button" className={`eg-card${isSeen(x) ? ' is-done' : ''}`} onClick={() => setAt(i)}>
                  <span className="eg-num tnum">{i + 1}</span>
                  <MiniBoard fen={x.fen} orientation={lessonSide(x.fen, x.pre)} />
                  <span className="eg-txt">
                    <span className="eg-title">{tr(x.title)}</span>
                    <span className={`eg-goal is-${x.goal}`}>
                      <Target className="ic ic-sm" aria-hidden />
                      {goalText(x)}
                    </span>
                    <span className="eg-meta faint tnum">
                      {isSeen(x) ? (
                        <>
                          <CircleCheck className="ic ic-sm eg-ok" aria-hidden />
                          {L('το είδες', 'seen')}
                        </>
                      ) : (
                        L(`${fmtNum(Math.ceil(mainLength(x) / 2))} κινήσεις`, `${fmtNum(Math.ceil(mainLength(x) / 2))} moves`)
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <p className="faint small eg-credit">
          {L(
            'Τα μαθήματα είναι με βάση άρθρα της Wikipedia (CC BY-SA 4.0) και, τα βασικά ματ, το «Chess Fundamentals» του J. R. Capablanca (1921, κοινό κτήμα)· δύο είναι του Ruru. Κάθε γραμμή ελέγχθηκε με τη Stockfish 19.',
            'The lessons are based on Wikipedia articles (CC BY-SA 4.0) and, for the basic mates, on J. R. Capablanca’s “Chess Fundamentals” (1921, public domain); two are Ruru’s own. Every line was checked with Stockfish 19.',
          )}
        </p>
      </div>
    </div>
  );
}

/** «Νίκη με τα λευκά» / «Ισοπαλία με τα μαύρα». */
function goalText(x: EndgameLesson): string {
  const w = lessonSide(x.fen, x.pre) === 'white';
  return x.goal === 'win' ? (w ? L('Νίκη με τα λευκά', 'White wins') : L('Νίκη με τα μαύρα', 'Black wins')) : w ? L('Ισοπαλία με τα λευκά', 'White draws') : L('Ισοπαλία με τα μαύρα', 'Black draws');
}

/** Πόσες ημικινήσεις έχει η κύρια γραμμή του μαθήματος. */
function mainLength(x: EndgameLesson): number {
  const r = parseGames(`[Event "?"]\n[SetUp "1"]\n[FEN "${x.fen}"]\n\n${x.solution.el}\n`)[0];
  let n = 0;
  for (let c = r?.game.root.children[0]; c; c = c.children[0]) n++;
  return n;
}

function EndgameLessonView({ lesson, index, total, active, onBack, onNext, onPrev }: { lesson: EndgameLesson; index: number; total: number; active: boolean; onBack: () => void; onNext: (() => void) | null; onPrev: (() => void) | null }) {
  const bs = useBoardSettings();
  const style = (((useApp((s) => s.settings?.ui) as Record<string, unknown> | undefined)?.notation as NotationStyle | undefined) ?? 'figurine') as NotationStyle;
  const ctrl = useMemo(() => {
    const head = [`[Event "${tr(lesson.title).replace(/"/g, "'")}"]`, '[SetUp "1"]', `[FEN "${lesson.fen}"]`].join('\n');
    return GameController.fromPgn(`${head}\n\n${tr(lesson.solution)}\n`).ctrl;
  }, [lesson]);
  useController(ctrl);
  const main = useMemo(() => {
    const out: GameNode[] = [];
    for (let n = ctrl.game.root.children[0]; n; n = n.children[0]) out.push(n);
    return out;
  }, [ctrl]);
  const [orientation, setOrientation] = useState<'white' | 'black'>(lessonSide(lesson.fen, lesson.pre));
  // → σε διακλάδωση: οι υποψήφιες κινήσεις (η γραμμή του μαθήματος και οι βαριάντες)
  const [pick, setPick] = useState<GameNode | null>(null);
  const [auto, setAuto] = useState(false);
  const node = ctrl.node;
  const last = main[main.length - 1];
  const atEnd = node === last;

  useEffect(() => setLastEndgame(lesson.seq), [lesson.seq]);
  useEffect(() => {
    if (atEnd) markEndgameSeen(lesson.seq);
  }, [atEnd, lesson.seq]);
  useEffect(() => {
    if (pick && pick !== node) setPick(null);
  }, [node, pick]);

  const sound = (san: string) => {
    if (bs.sounds) playMoveSound(san);
  };
  const go = (n: GameNode) => {
    ctrl.goTo(n);
    if (!n.isRoot) sound(n.san);
  };
  /** Μία κίνηση μπροστά στη γραμμή που φαίνεται· με το → σε διακλάδωση ανοίγουν οι υποψήφιες κινήσεις (όπως στη βάση). */
  const next = (choose = false) => {
    const n = ctrl.node;
    if (!n.children.length) return;
    if (choose && n.children.length > 1 && bs.variationDialog && !auto) setPick(n);
    else go(n.children[0]);
  };
  const prev = () => ctrl.back();
  const toStart = () => ctrl.goTo(ctrl.game.root);
  const toEnd = () => ctrl.goTo(last ?? ctrl.game.root);
  const backToLine = () => {
    let n: GameNode = ctrl.node;
    while (!n.isMainline() && n.parent) n = n.parent;
    ctrl.goTo(n);
  };

  // αυτόματη προβολή: μία κίνηση κάθε λίγο, ως το τέλος της γραμμής που φαίνεται
  useEffect(() => {
    if (!auto || !active) return;
    if (!node.children.length) {
      setAuto(false);
      return;
    }
    const t = window.setTimeout(() => go(node.children[0]), AUTO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, active, node]);

  useScreenKeys(active, (e) => {
    if (pick) return;
    if (e.key === 'ArrowRight') next(true);
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const t = pgnStep(ctrl.node, e.key);
      if (t === ctrl.node) return;
      ctrl.goTo(t);
    } else if (e.key === 'Escape' && !ctrl.node.isMainline()) backToLine();
    else if (e.key === 'Home') toStart();
    else if (e.key === 'End') toEnd();
    else if (e.key === ' ') setAuto((a) => !a);
    else if (e.key.toLowerCase() === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
    else return;
    return true;
  });

  const drawn = useDrawnShapes(node.fen);
  const mv = (fen: string, san: string) => displaySan(moveText(fen, san), style);
  const label = (n: GameNode) => mv(n.parent!.fen, n.san);
  const inVariation = !node.isMainline();
  // οι βαριάντες στο σημείο όπου βρίσκεται ο χρήστης: εναλλακτικές της κίνησης του μαθήματος
  const varRoot = variationRoot(node);
  const branch = varRoot ? varRoot.parent : !node.isRoot ? node.parent : null;
  const alts = branch ? branch.children.slice(1) : [];
  const toMove = node.fen.split(' ')[1] === 'b' ? L('Παίζουν τα μαύρα.', 'Black to move.') : L('Παίζουν τα λευκά.', 'White to move.');
  const src = lesson.source;

  return (
    <div className="tx gl">
      <div className="tx-main">
        <section className="tx-board" aria-label={L('Σκακιέρα', 'Board')}>
          <Board
            fen={node.fen}
            orientation={orientation}
            movable="none"
            lastMove={node.isRoot ? undefined : node.move}
            shapes={drawn.shapes}
            onShape={drawn.onShape}
            theme={bs.theme}
            pieceSet={bs.pieceSet}
            coordinates={bs.coordinates}
            animationMs={bs.animationMs}
            oneClick={false}
            onMove={() => {}}
          />
          {pick && (
            <VariationChooser
              node={pick}
              style={style}
              ahead={() => 4}
              note={(c) => (c.isMainline() ? L('το μάθημα', 'the lesson') : '')}
              onPick={(c) => {
                setPick(null);
                go(c);
              }}
              onClose={() => setPick(null)}
            />
          )}
        </section>
        <aside className="tx-side gl-side">
          <div className="gl-bar">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
              <ArrowLeft className="ic" aria-hidden />
              {L('Όλα τα μαθήματα', 'All lessons')}
            </button>
            <span className="faint tnum">{L(`Μάθημα ${index + 1} από ${total} · ${tr(lesson.part)}`, `Lesson ${index + 1} of ${total} · ${tr(lesson.part)}`)}</span>
          </div>
          <h1 className="gl-title">{tr(lesson.title)}</h1>
          <div className={`eg-goal is-${lesson.goal}`}>
            <Target className="ic ic-sm" aria-hidden />
            {goalText(lesson)}
          </div>

          {node.isRoot && (
            <div className="gl-intro">
              {lesson.intro && <p>{tr(lesson.intro)}</p>}
              <p className="muted">
                {toMove}{' '}
                {L(
                  'Πάτα «Επόμενο» ή → για να δεις την επόμενη κίνηση με την εξήγησή της, ή «Αυτόματα» για να παίζονται μόνες τους. Πάτα οποιαδήποτε κίνηση στη λίστα για να πας εκεί· οι βαριάντες δείχνουν τι γίνεται με άλλες κινήσεις.',
                  'Press “Next” or → to see the next move with its explanation, or “Auto” to play them by themselves. Click any move in the list to go there; the variations show what happens after other moves.',
                )}
              </p>
            </div>
          )}

          {!node.isRoot && (
            <div className={`gl-move${inVariation ? ' is-var' : ''}`}>
              <div className="gl-move-h">
                <b>{label(node)}</b>
                {inVariation && <span className="tag">{L('βαριάντα', 'variation')}</span>}
              </div>
              {node.comment ? (
                <div className="gl-note">
                  <BookOpen className="ic ic-sm" aria-hidden /> {node.comment}
                </div>
              ) : null}
              {alts.length > 0 && (
                <div className="gl-vars">
                  <div className="faint gl-vars-h">
                    {L('Άλλες κινήσεις σε αυτό το σημείο (πάτα μια κίνηση για να τη δεις· ↓ άλλη βαριάντα, ↑ πίσω):', 'Other moves at this point (click a move to see it; ↓ another variation, ↑ back):')}
                  </div>
                  {alts.map((a) => (
                    <div key={a.id} className="gl-var">
                      <PgnLine first={a} current={node} onPick={(n) => ctrl.goTo(n)} style={style} />
                    </div>
                  ))}
                </div>
              )}
              {inVariation && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={backToLine}>
                  <ArrowLeft className="ic" aria-hidden />
                  {L('Πίσω στη γραμμή του μαθήματος (Esc)', 'Back to the lesson line (Esc)')}
                </button>
              )}
            </div>
          )}

          {atEnd && (
            <div className="gl-summary">
              <div className="section-label">{L('Τι κρατάς', 'Key ideas')}</div>
              <p>{tr(lesson.summary)}</p>
              <div className="gl-actions">
                {onNext && (
                  <button type="button" className="btn btn-primary" onClick={onNext}>
                    <Play className="ic" aria-hidden />
                    {L('Επόμενο μάθημα', 'Next lesson')}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={toStart}>
                  {L('Ξανά από την αρχή', 'Again from the start')}
                </button>
              </div>
            </div>
          )}

          <div className="gl-nav">
            <button type="button" className="btn btn-ghost btn-icon" onClick={toStart} aria-label={L('Αρχή', 'Start')} title={L('Αρχή (Home)', 'Start (Home)')}>
              <ChevronsLeft className="ic" aria-hidden />
            </button>
            <button type="button" className="btn btn-ghost btn-icon" onClick={prev} aria-label={L('Πίσω', 'Back')} title={L('Πίσω (←)', 'Back (←)')}>
              <ChevronLeft className="ic" aria-hidden />
            </button>
            <button type="button" className="btn btn-primary gl-next" disabled={!node.children.length} onClick={() => next()} title={L('Επόμενο (→)', 'Next (→)')}>
              {L('Επόμενο', 'Next')}
              <ChevronRight className="ic" aria-hidden />
            </button>
            <button type="button" className="btn btn-ghost btn-icon" onClick={toEnd} aria-label={L('Τέλος', 'End')} title={L('Τέλος (End)', 'End (End)')}>
              <ChevronsRight className="ic" aria-hidden />
            </button>
            <button type="button" className={`btn btn-sm ${auto ? 'btn-secondary is-on' : 'btn-ghost'}`} aria-pressed={auto} disabled={!auto && !node.children.length} onClick={() => setAuto((a) => !a)} title={L('Αυτόματη προβολή (Space)', 'Auto play (Space)')}>
              {auto ? <Pause className="ic ic-sm" aria-hidden /> : <Play className="ic ic-sm" aria-hidden />}
              {L('Αυτόματα', 'Auto')}
            </button>
            <span style={{ flex: 1 }} />
            {onPrev && (
              <button type="button" className="btn btn-ghost btn-icon" onClick={onPrev} aria-label={L('Προηγούμενο μάθημα', 'Previous lesson')} title={L('Προηγούμενο μάθημα', 'Previous lesson')}>
                <ChevronsLeft className="ic ic-sm" aria-hidden />
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} aria-label={L('Γύρισμα σκακιέρας', 'Flip board')} title={L('Γύρισμα σκακιέρας (F)', 'Flip board (F)')}>
              <FlipVertical2 className="ic" aria-hidden />
            </button>
          </div>

          <div className="gl-notation">
            <Notation ctrl={ctrl} style={style} />
          </div>

          <p className="faint gl-credit">
            {src && 'article' in src ? (
              <>
                {L('Με βάση το άρθρο ', 'Based on the article ')}
                <button type="button" className="link-btn" onClick={() => void openLink(src.url)}>
                  {`«${src.article}»`}
                </button>
                {L(' της Wikipedia, σε μετάφραση και προσαρμογή· άδεια ', ' of Wikipedia, adapted; licence ')}
                <button type="button" className="link-btn" onClick={() => void openLink('https://creativecommons.org/licenses/by-sa/4.0/')}>
                  CC BY-SA 4.0
                </button>
                .
              </>
            ) : src ? (
              L(`Με βάση το «${src.book}» του ${src.author} (${src.year}, κοινό κτήμα), σε δική μας μετάφραση και προσαρμογή.`, `Based on “${src.book}” by ${src.author} (${src.year}, public domain), adapted.`)
            ) : (
              L('Μάθημα του Ruru.', 'A Ruru lesson.')
            )}
          </p>
        </aside>
      </div>
    </div>
  );
}

