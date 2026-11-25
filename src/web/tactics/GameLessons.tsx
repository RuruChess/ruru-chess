/**
 * «Στρατηγικά»: μαθήματα πάνω σε σχολιασμένες παρτίδες. Η παρτίδα προχωρά κίνηση-κίνηση με τα σχόλια και τις
 * βαριάντες του σχολιαστή· στα κρίσιμα σημεία ρωτάμε «τι θα έπαιζες;». Δεκτή κάθε νόμιμη κίνηση (χωρίς κρίση
 * μηχανής): μετά φαίνεται τι παίχτηκε και τι γράφει ο σχολιαστής.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleCheck, FlipVertical2, GraduationCap, HelpCircle, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { GameNode } from '../../core/game.ts';
import { Board } from '../components/Board.tsx';
import { useDrawnShapes } from '../components/drawnShapes.ts';
import { Notation, displaySan, type NotationStyle } from '../components/Notation.tsx';
import { PgnLine, VariationChooser, pgnStep, variationRoot } from '../components/PgnLine.tsx';
import { Spinner } from '../components/ui/Progress.tsx';
import { GameController, useController } from '../gameModel.ts';
import { L, fmtNum } from '../i18n.ts';
import { playMoveSound } from '../sounds.ts';
import { reportError, useApp } from '../store.ts';
import { useBoardSettings, useScreenKeys } from './common.tsx';
import { bookTitle, canReviewLesson, gamesApi, saveGameProgress, tr, useGameProgress, type GameLesson, type GameLessonInfo, type GameLessonMode, type GameQuestion } from './gameLessons.ts';
import { moveText } from './logic.ts';
import { setUiLater } from './store.ts';
import './strategy.css';

const surname = (name: string): string => name.trim().split(/\s+/).pop() ?? name;

/** Η λίστα των μαθημάτων ή το ανοιχτό μάθημα (μένει ανοιχτό και μετά από επανεκκίνηση). */
export function GameLessons({ active }: { active: boolean }) {
  const openId = useApp((s) => (s.settings?.ui as Record<string, unknown> | undefined)?.gameLessonOpen as string | undefined) ?? null;
  const [list, setList] = useState<Array<GameLessonInfo & { questions: number; fen: string }> | null>(null);
  const [lesson, setLesson] = useState<GameLesson | null>(null);
  const [mode, setMode] = useState<GameLessonMode>('lesson');
  const [runKey, setRunKey] = useState(0);
  const progress = useGameProgress();
  const bs = useBoardSettings();
  const open = (id: string | null, nextMode: GameLessonMode = 'lesson') => {
    setMode(nextMode);
    if (id) setRunKey((k) => k + 1);
    setUiLater({ gameLessonOpen: id });
  };
  // φίλτρο: ένα βιβλίο-πηγή (null: όλα)
  const [book, setBook] = useState<string | null>(null);
  const books = useMemo(() => {
    const m = new Map<string, Array<GameLessonInfo & { questions: number; fen: string }>>();
    for (const g of list ?? []) {
      const k = g.source.book;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    }
    return [...m.entries()];
  }, [list]);
  const doneIn = (items: GameLessonInfo[]) => items.filter((g) => progress[g.id]?.done).length;

  useEffect(() => {
    gamesApi
      .list()
      .then((r) => setList(r.items))
      .catch(reportError);
  }, []);
  useEffect(() => {
    if (!openId) {
      setLesson(null);
      return;
    }
    let off = false;
    gamesApi
      .get(openId)
      .then((g) => !off && setLesson(g))
      .catch((e) => {
        reportError(e);
        if (!off) open(null);
      });
    return () => {
      off = true;
    };
  }, [openId]);

  if (openId) {
    if (!lesson || lesson.id !== openId) {
      return (
        <div className="tx gl gl-loading">
          <Spinner label={L('Φόρτωση μαθήματος', 'Loading lesson')} />
        </div>
      );
    }
    const i = list?.findIndex((x) => x.id === openId) ?? -1;
    const nextId = list && i >= 0 && i + 1 < list.length ? list[i + 1].id : null;
    return (
      <GameLessonView
        key={`${lesson.id}-${mode}-${runKey}`}
        lesson={lesson}
        mode={mode}
        active={active}
        onBack={() => open(null)}
        onAgain={() => open(lesson.id, 'again')}
        onNext={nextId ? () => open(nextId, 'lesson') : null}
      />
    );
  }
  return (
    <div className="kb-wrap sl">
      <div className="kb-page">
        <header className="kb-head with-ic">
          <span className="kb-head-ic" aria-hidden>
            <GraduationCap size={28} />
          </span>
          <div>
            <h1 className="kb-title">{L('Μαθήματα στρατηγικής: σχολιασμένες παρτίδες', 'Strategy lessons: annotated games')}</h1>
            <p className="kb-sub">
              {L(
                'Παρτίδες μεγάλων παικτών με τα δικά τους σχόλια και τις βαριάντες τους. Η παρτίδα προχωρά κίνηση-κίνηση, σαν μάθημα· στα κρίσιμα σημεία σε ρωτάμε τι θα έπαιζες και μετά βλέπεις τι παίχτηκε και γιατί.',
                'Games by great players with their own notes and variations. The game moves forward move by move, like a lesson; at the critical moments you are asked what you would play, and then you see what was played and why.',
              )}
            </p>
          </div>
        </header>
        {!list ? (
          <Spinner label={L('Φόρτωση', 'Loading')} />
        ) : (
          <>
            {books.length > 1 && (
              <div className="sl-chips" role="group" aria-label={L('Βιβλία', 'Books')}>
                <button type="button" className="kb-chip" aria-pressed={!book} onClick={() => setBook(null)}>
                  {L('Όλα', 'All')} <span>{`${fmtNum(doneIn(list))}/${fmtNum(list.length)}`}</span>
                </button>
                {books.map(([k, items]) => (
                  <button key={k} type="button" className="kb-chip" aria-pressed={book === k} onClick={() => setBook(k)}>
                    {`${items[0].source.author.split(' ').pop()} · ${k}`} <span>{`${fmtNum(doneIn(items))}/${fmtNum(items.length)}`}</span>
                  </button>
                ))}
              </div>
            )}
            {books
              .filter(([k]) => !book || k === book)
              .map(([k, items]) => (
                <section key={k} className="sl-book" aria-label={k}>
                  <div className="sl-book-h">
                    <h2>
                      {`${items[0].source.author}, «${k}» (${items[0].source.year})`}
                      {bookTitle(k) && <span className="sl-note">{bookTitle(k)}</span>}
                    </h2>
                    <div className="sl-prog">
                      <span className="kb-bar ok">
                        <i style={{ width: `${Math.round((100 * doneIn(items)) / items.length)}%` }} />
                      </span>
                      {L(`${fmtNum(doneIn(items))} από ${fmtNum(items.length)}`, `${fmtNum(doneIn(items))} of ${fmtNum(items.length)}`)}
                    </div>
                  </div>
                  <ol className="sl-cards">
                    {items.map((g) => {
                      const p = progress[g.id];
                      const answered = p ? Object.keys(p.answers).length : 0;
                      const reviewable = canReviewLesson(p, g.questions);
                      const white = g.fen.split(' ')[1] !== 'b';
                      return (
                        <li key={g.id} className="kb-card sl-card">
                          <div className="sl-diag">
                            <span className="sl-mini">
                              <Board fen={g.fen} orientation="white" movable="none" theme={bs.theme} pieceSet={bs.pieceSet} coordinates={false} animationMs={0} />
                            </span>
                            <span className="sl-turn">
                              <i className={white ? 'w' : 'b'} aria-hidden />
                              {white ? L('παίζουν τα λευκά', 'White to move') : L('παίζουν τα μαύρα', 'Black to move')}
                            </span>
                          </div>
                          <div className="sl-text">
                            <span className="sl-cap">{`${g.seq} · ${g.white} – ${g.black} · ${g.event} ${g.year}`}</span>
                            <span className="sl-title">
                              {tr(g.title)}
                              {p?.done && <CircleCheck size={16} aria-label={L('ολοκληρώθηκε', 'completed')} />}
                            </span>
                            <span className="sl-theme">{tr(g.theme)}</span>
                            <span className="sl-meta">
                              {`${tr(g.opening)} · ${g.result.replace('1/2-1/2', '½-½')} · `}
                              {L(`${fmtNum(g.questions)} ερωτήσεις`, `${fmtNum(g.questions)} questions`)}
                              {answered > 0 && !p?.done ? L(` · απάντησες ${answered}`, ` · answered ${answered}`) : ''}
                            </span>
                            <div className="sl-foot">
                              <button
                                type="button"
                                className={`kb-btn sm${p && !p.done ? ' primary' : ''}`}
                                onClick={() => open(g.id, p?.done ? 'again' : 'lesson')}
                                title={
                                  p?.done
                                    ? L('Πέρασε ξανά την παρτίδα από την αρχή με όλες τις ασκήσεις', 'Play through the game again from the start with all exercises')
                                    : undefined
                                }
                              >
                                {p?.done ? <RotateCcw size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                                {p?.done ? L('Ξανά', 'Again') : p ? L('Συνέχισε', 'Continue') : L('Ξεκίνα', 'Start')}
                              </button>
                              {reviewable && (
                                <button
                                  type="button"
                                  className="kb-btn ghost sm"
                                  onClick={() => open(g.id, 'review')}
                                  title={L('Απλή περιήγηση της παρτίδας και των σχολίων χωρίς ασκήσεις', 'Browse the game and notes freely without exercises')}
                                >
                                  <BookOpen size={14} aria-hidden />
                                  {L('Περιήγηση', 'Review')}
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
          </>
        )}
        <p className="sl-credit">
          {L(
            `Σχόλια από βιβλία σε κοινό κτήμα: ${books.map(([k, items]) => `${items[0].source.author}, «${k}» (${items[0].source.year})`).join('· ')}. Μετάφραση και σύγχρονη σημειογραφία από το Ruru.`,
            `Notes from public-domain books: ${books.map(([k, items]) => `${items[0].source.author}, ${k} (${items[0].source.year})`).join('; ')}. Modern notation and translations by Ruru.`,
          )}
        </p>
      </div>
    </div>
  );
}

function GameLessonView({
  lesson,
  mode,
  active,
  onBack,
  onAgain,
  onNext,
}: {
  lesson: GameLesson;
  mode: GameLessonMode;
  active: boolean;
  onBack: () => void;
  onAgain: () => void;
  onNext: (() => void) | null;
}) {
  const bs = useBoardSettings();
  const style = (((useApp((s) => s.settings?.ui) as Record<string, unknown> | undefined)?.notation as NotationStyle | undefined) ?? 'figurine') as NotationStyle;
  const ctrl = useMemo(() => {
    const head = [`[Event "${lesson.event}"]`, `[Date "${lesson.year}.??.??"]`, `[White "${lesson.white}"]`, `[Black "${lesson.black}"]`, `[Result "${lesson.result}"]`, `[Annotator "${lesson.annotator}"]`].join('\n');
    return GameController.fromPgn(`${head}\n\n${tr(lesson.pgn)}\n`).ctrl;
  }, [lesson]);
  useController(ctrl);
  const main = useMemo(() => {
    const out: GameNode[] = [];
    for (let n = ctrl.game.root.children[0]; n; n = n.children[0]) out.push(n);
    return out;
  }, [ctrl]);
  const saved = useGameProgress()[lesson.id];
  const [revealed, setRevealed] = useState(() => (mode === 'again' ? 0 : mode === 'review' ? main.length : Math.min(saved?.revealed ?? 0, main.length)));
  const [answers, setAnswers] = useState<Record<string, string>>(() => (mode === 'again' ? {} : (saved?.answers ?? {})));
  const [asking, setAsking] = useState<GameQuestion | null>(null);
  const [pending, setPending] = useState<{ fen: string; move: number; san: string } | null>(null);
  // → σε διακλάδωση: οι υποψήφιες κινήσεις (η κίνηση της παρτίδας και οι βαριάντες του σχολιαστή)
  const [pick, setPick] = useState<GameNode | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>(surname(lesson.black) === surname(lesson.annotator) ? 'black' : 'white');
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  // συνέχεια από εκεί που σταμάτησε ο χρήστης (στο «Ξανά» και στην «Περιήγηση» ξεκινά από την αρχή της παρτίδας)
  useEffect(() => {
    if (mode === 'lesson' && revealed > 0) ctrl.goTo(main[revealed - 1]);
    // μόνο στο άνοιγμα
  }, [ctrl]);

  const done = revealed >= main.length;
  const allQuestionsAnswered = lesson.questions.length > 0 ? lesson.questions.every((q) => answers[q.ply] !== undefined) : done;
  useEffect(() => {
    // στην «Περιήγηση» δεν αλλοιώνουμε την αποθηκευμένη πρόοδο· στο «Ξανά» δεν σβήνουμε παλιό done/allAnswered μέχρι να ολοκληρωθεί
    if (mode === 'review') return;
    if (mode === 'again' && saved?.done && !done) return;
    saveGameProgress(lesson.id, {
      revealed,
      answers,
      ...(done || saved?.done ? { done: true } : {}),
      ...(allQuestionsAnswered || saved?.allAnswered ? { allAnswered: true } : {}),
    });
  }, [lesson.id, mode, revealed, answers, done, allQuestionsAnswered, saved?.done, saved?.allAnswered]);

  const node = ctrl.node;
  useEffect(() => {
    if (pick && pick !== node) setPick(null);
  }, [node, pick]);
  const annot = surname(lesson.annotator);
  const qAt = (ply: number) => lesson.questions.find((q) => q.ply === ply) ?? null;
  const qIndex = (q: GameQuestion) => lesson.questions.indexOf(q) + 1;
  // η ερώτηση ισχύει μόνο όσο η σκακιέρα δείχνει τη θέση της
  const askingNow = asking && (asking.ply === 1 ? node.isRoot : node === main[asking.ply - 2]) ? asking : null;

  const sound = (san: string) => {
    if (bs.sounds) playMoveSound(san);
  };
  const reveal = (ply: number) => setRevealed((r) => Math.max(r, ply));
  const next = () => {
    if (pending) return;
    const n = ctrl.node;
    if (!n.children.length) return;
    if (n.isMainline()) {
      const p = n.ply + 1;
      const q = qAt(p);
      // πρώτα η ερώτηση: οι υποψήφιες κινήσεις θα έδειχναν την απάντηση
      if (q && answers[p] === undefined && p > revealed) {
        setAsking(q);
        return;
      }
    }
    if (n.children.length > 1 && bs.variationDialog) setPick(n);
    else step(n.children[0]);
  };
  /** Μία κίνηση μπροστά: της παρτίδας (φαίνεται πια) ή μιας βαριάντας του σχολιαστή. */
  const step = (c: GameNode) => {
    setAsking(null);
    ctrl.goTo(c);
    sound(c.san);
    if (c.isMainline()) reveal(c.ply);
  };
  const prev = () => {
    if (pending) return;
    if (askingNow) {
      setAsking(null);
      return;
    }
    ctrl.back();
  };
  const toStart = () => {
    setAsking(null);
    ctrl.goTo(ctrl.game.root);
  };
  const toEnd = () => {
    setAsking(null);
    ctrl.goTo(revealed > 0 ? main[revealed - 1] : ctrl.game.root);
  };
  const backToGame = () => {
    let n: GameNode = ctrl.node;
    while (!n.isMainline() && n.parent) n = n.parent;
    const m = n.children[0];
    ctrl.goTo(m && m.ply <= revealed ? m : n);
  };
  /** Η απάντηση: φαίνεται για λίγο η κίνηση του χρήστη, μετά παίζεται η κίνηση της παρτίδας. */
  const answer = (q: GameQuestion, san: string, show?: { fen: string; move: number }) => {
    setAnswers((a) => ({ ...a, [q.ply]: san }));
    setAsking(null);
    const play = () => {
      setPending(null);
      ctrl.goTo(main[q.ply - 1]);
      sound(main[q.ply - 1].san);
      reveal(q.ply);
    };
    if (!show) {
      play();
      return;
    }
    setPending({ ...show, san });
    timers.current.push(window.setTimeout(play, 1100));
  };
  const onBoardMove = (from: number, to: number, promo: number) => {
    if (!askingNow || pending) return;
    const pos = ctrl.position();
    const m = pos.findMove(from, to, promo);
    if (!m) return;
    const san = pos.san(m);
    const p2 = pos.clone();
    p2.makeMove(m);
    sound(san);
    answer(askingNow, san, { fen: p2.fen(), move: m });
  };

  // βαριάντες του σχολιαστή με τα βελάκια: ↓ η επόμενη βαριάντα της κίνησης, ↑ πίσω στη γραμμή, Esc πίσω στην παρτίδα
  const goVar = (n: GameNode) => {
    if (pending) return;
    setAsking(null);
    ctrl.goTo(n);
  };
  useScreenKeys(active, (e) => {
    if (pick) return;
    if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const t = pgnStep(ctrl.node, e.key);
      if (t === ctrl.node) return;
      goVar(t);
    } else if (e.key === 'Escape' && !ctrl.node.isMainline()) backToGame();
    else if (e.key === 'Home') toStart();
    else if (e.key === 'End') toEnd();
    else if (e.key.toLowerCase() === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
    else return;
    return true;
  });

  const boardFen = pending?.fen ?? node.fen;
  const drawn = useDrawnShapes(boardFen);
  // κινήσεις με τη σημειογραφία του χρήστη (εικονίδια, αγγλικά ή ελληνικά γράμματα)
  const mv = (fen: string, san: string) => displaySan(moveText(fen, san), style);
  const label = (n: GameNode) => mv(n.parent!.fen, n.san);
  const sideToMove = (fen: string) => (fen.split(' ')[1] === 'w' ? 'white' : 'black');
  const playerOf = (n: GameNode) => surname(sideToMove(n.parent!.fen) === 'white' ? lesson.white : lesson.black);

  // η απάντηση στην ερώτηση αυτής της κίνησης (αν υπάρχει)
  const answered = !node.isRoot && node.isMainline() ? qAt(node.ply) : null;
  const ans = answered ? answers[answered.ply] : undefined;
  const feedback = (() => {
    if (!answered || ans === undefined) return null;
    const played = label(node);
    if (ans === '') return { tone: 'info', text: L(`Στην παρτίδα παίχτηκε ${played}. Δες τι γράφει ο ${annot}.`, `${played} was played in the game. See what ${annot} writes.`) };
    const yours = mv(node.parent!.fen, ans);
    if (ans === node.san)
      return answered.criticised
        ? { tone: 'info', text: L(`Το ίδιο έπαιξε και ο ${playerOf(node)}. Ο ${annot} όμως έχει άλλη γνώμη: διάβασε το σχόλιο.`, `${playerOf(node)} played the same. ${annot}, however, thinks otherwise: read the note.`) }
        : { tone: 'ok', text: L(`Όπως στην παρτίδα! Ο ${playerOf(node)} έπαιξε κι αυτός ${played}.`, `As in the game! ${playerOf(node)} also played ${played}.`) };
    if (answered.best.includes(ans)) return { tone: 'ok', text: L(`Το ${yours} είναι η κίνηση που προτείνει ο ${annot}! Στην παρτίδα παίχτηκε ${played}.`, `${yours} is the move ${annot} recommends! ${played} was played in the game.`) };
    if (node.parent!.children.some((c) => c.san === ans))
      return { tone: 'info', text: L(`Ο ${annot} εξετάζει και το ${yours} στα σχόλιά του: δες τη βαριάντα. Στην παρτίδα παίχτηκε ${played}.`, `${annot} also looks at ${yours} in his notes: see the variation. ${played} was played in the game.`) };
    return { tone: 'info', text: L(`Η κίνησή σου: ${yours}. Στην παρτίδα παίχτηκε ${played}· δες τι γράφει ο ${annot}.`, `Your move: ${yours}. ${played} was played in the game; see what ${annot} writes.`) };
  })();

  const inVariation = !node.isMainline();
  // οι βαριάντες του σχολιαστή στο σημείο όπου βρίσκεται ο χρήστης: εναλλακτικές της κίνησης της παρτίδας
  const varRoot = variationRoot(node);
  const branch = varRoot ? varRoot.parent : !node.isRoot ? node.parent : null;
  const alts = branch ? branch.children.slice(1) : [];
  const nextIsQuestion = !pending && node.isMainline() && node.children.length > 0 && (() => {
    const q = qAt(node.ply + 1);
    return Boolean(q && answers[q.ply] === undefined && q.ply > revealed);
  })();
  const atEnd = done && node === main[main.length - 1];

  // οι κουκκίδες των ερωτήσεων: απαντημένες, η τρέχουσα (ή η επόμενη), οι υπόλοιπες
  const curQ = askingNow ?? lesson.questions.find((q) => answers[q.ply] === undefined) ?? null;
  const answeredN = lesson.questions.filter((q) => answers[q.ply] !== undefined).length;

  return (
    <div className="sl-lesson">
      <div className="sl-ggrid">
        <section className="sl-board" aria-label={L('Σκακιέρα', 'Board')}>
          <Board
            fen={boardFen}
            orientation={orientation}
            movable={askingNow && !pending ? sideToMove(node.fen) : 'none'}
            lastMove={pending ? pending.move : node.isRoot ? undefined : node.move}
            shapes={drawn.shapes}
            onShape={drawn.onShape}
            theme={bs.theme}
            pieceSet={bs.pieceSet}
            coordinates={bs.coordinates}
            animationMs={bs.animationMs}
            oneClick={false}
            onMove={onBoardMove}
          />
          {pick && (
            <VariationChooser
              node={pick}
              style={style}
              // από την παρτίδα φαίνονται μόνο κινήσεις που έχουν ήδη παιχτεί στο μάθημα
              ahead={(c) => (c.isMainline() ? Math.max(0, Math.min(4, revealed - c.ply)) : 4)}
              note={(c) => (c.isMainline() ? L('παρτίδα', 'game') : pick.isMainline() ? annot : '')}
              onPick={(c) => {
                setPick(null);
                step(c);
              }}
              onClose={() => setPick(null)}
            />
          )}
        </section>
        <aside className="kb-card sl-side">
          <div className="sl-side-h">
            <button type="button" className="kb-btn ghost sm" onClick={onBack}>
              <ChevronLeft aria-hidden />
              {L('Όλα τα μαθήματα', 'All lessons')}
            </button>
            <span>{L(`κίνηση ${Math.ceil(revealed / 2)} από ${Math.ceil(main.length / 2)}`, `move ${Math.ceil(revealed / 2)} of ${Math.ceil(main.length / 2)}`)}</span>
          </div>

          <div className="sl-body">
            <div>
              <h1 className="sl-h1">{tr(lesson.title)}</h1>
              <div className="sl-cap2 sl-sub">{`${lesson.white} – ${lesson.black} · ${lesson.event} ${lesson.year} · ${tr(lesson.opening)}`}</div>
            </div>

            {!atEnd && lesson.questions.length > 0 && (
              <div className="sl-qdots" title={L(`Απάντησες ${answeredN} από ${lesson.questions.length} ερωτήσεις`, `You answered ${answeredN} of ${lesson.questions.length} questions`)}>
                {lesson.questions.map((q) => (
                  <i key={q.ply} className={answers[q.ply] !== undefined ? 'done' : q === curQ ? 'cur' : ''} aria-hidden />
                ))}
              </div>
            )}

            {node.isRoot && !askingNow && (
              <div className="sl-intro">
                <p>{tr(lesson.intro)}</p>
                <p className="sl-hint">
                  {L(
                    'Πάτα «Επόμενο» ή → για να προχωρήσει η παρτίδα. Όπου ο σχολιαστής έχει βαριάντες, το → δείχνει τις υποψήφιες κινήσεις: διάλεξε με ↑ ↓ και Enter.',
                    'Press “Next” or → to move the game forward. Where the annotator gives variations, → shows the candidate moves: choose with ↑ ↓ and Enter.',
                  )}
                </p>
              </div>
            )}

            {askingNow && (
              <div className="sl-q" role="status">
                <div className="sl-qh">
                  <HelpCircle aria-hidden />
                  {L(`Ερώτηση ${qIndex(askingNow)} από ${lesson.questions.length}`, `Question ${qIndex(askingNow)} of ${lesson.questions.length}`)}
                </div>
                <p className="sl-ask">{tr(askingNow.ask)}</p>
                <p className="sl-hint">
                  {sideToMove(node.fen) === 'white'
                    ? L('Παίζουν τα λευκά. Κάνε την κίνησή σου στη σκακιέρα· δεκτή κάθε κίνηση.', 'White to move. Make your move on the board; any move is accepted.')
                    : L('Παίζουν τα μαύρα. Κάνε την κίνησή σου στη σκακιέρα· δεκτή κάθε κίνηση.', 'Black to move. Make your move on the board; any move is accepted.')}
                </p>
                <button type="button" className="kb-btn sm" onClick={() => answer(askingNow, '')}>
                  <SkipForward aria-hidden />
                  {L('Δεν ξέρω, δείξε μου', 'I don’t know, show me')}
                </button>
              </div>
            )}

            {pending && <p className="sl-pending">{L(`Η κίνησή σου: ${mv(node.fen, pending.san)}. Τι παίχτηκε στην παρτίδα;…`, `Your move: ${mv(node.fen, pending.san)}. What was played in the game?…`)}</p>}

            {!pending && feedback && <div className={`sl-fb is-${feedback.tone}`}>{feedback.text}</div>}

            {!node.isRoot && !pending && (
              <div className={`sl-mv${inVariation ? ' is-var' : ''}`}>
                <div className="sl-mv-h">
                  <b>{label(node)}</b>
                  {inVariation && <span className="kb-pill plain">{L('βαριάντα του σχολιαστή', 'annotator’s variation')}</span>}
                </div>
                {node.comment ? (
                  <p className="sl-cmt">
                    <span className="sl-who">
                      <BookOpen aria-hidden /> {annot}:
                    </span>{' '}
                    {node.comment}
                  </p>
                ) : null}
                {alts.length > 0 && (
                  <div className="sl-vars">
                    <div className="sl-vars-h">
                      {inVariation
                        ? L(`Οι βαριάντες του ${annot} σε αυτό το σημείο (← → κίνηση-κίνηση, ↓ άλλη βαριάντα, ↑ πίσω):`, `${annot}’s variations at this point (← → move by move, ↓ another variation, ↑ back):`)
                        : L(
                            `Οι βαριάντες του ${annot}: πάτα μια κίνηση για να τη δεις στη σκακιέρα. Με τα βελάκια: ← και μετά → για τις υποψήφιες κινήσεις, ή ↓ κατευθείαν στη βαριάντα.`,
                            `${annot}’s variations: click a move to see it on the board. With the arrow keys: ← and then → for the candidate moves, or ↓ straight into the variation.`,
                          )}
                    </div>
                    {alts.map((a) => (
                      <div key={a.id} className="sl-var">
                        <PgnLine first={a} current={node} onPick={goVar} style={style} />
                      </div>
                    ))}
                  </div>
                )}
                {inVariation && (
                  <button type="button" className="kb-btn sm" onClick={backToGame}>
                    <ArrowLeft aria-hidden />
                    {L('Πίσω στην παρτίδα (Esc)', 'Back to the game (Esc)')}
                  </button>
                )}
              </div>
            )}

            {atEnd && (
              <>
                <div>
                  <div className="sl-sec">{L('Τι κρατάς', 'Key ideas')}</div>
                  <p className="sl-sum">{tr(lesson.summary)}</p>
                </div>
                <div className="sl-actions">
                  {onNext && (
                    <button type="button" className="kb-btn primary lg" onClick={onNext}>
                      <Play aria-hidden />
                      {L('Επόμενο μάθημα', 'Next lesson')}
                    </button>
                  )}
                  <button type="button" className="kb-btn" onClick={onAgain} title={L('Πέρασε ξανά την παρτίδα από την αρχή με όλες τις ασκήσεις', 'Play through the game again from the start with all exercises')}>
                    <RotateCcw aria-hidden />
                    {L('Ξανά', 'Again')}
                  </button>
                  <button type="button" className="kb-btn ghost" onClick={onBack}>
                    {L('Όλα τα μαθήματα', 'All lessons')}
                  </button>
                </div>
              </>
            )}

            <div className="sl-notation">
              <Notation ctrl={ctrl} style={style} revealPly={revealed} />
            </div>

            <p className="sl-lcredit">
              {L(
                `Σχόλια: ${lesson.source.author}, «${lesson.source.book}» (${lesson.source.year}), παρτίδα ${lesson.source.game}. Κοινό κτήμα· μετάφραση${lesson.source.lang === 'de' ? ' από τα γερμανικά' : ''} και σύγχρονη σημειογραφία από το Ruru.`,
                `Notes: ${lesson.source.author}, ${lesson.source.book} (${lesson.source.year}), game ${lesson.source.game}. Public domain; ${lesson.source.lang === 'de' ? 'translated from the German, with ' : ''}modern notation by Ruru.`,
              )}
            </p>
          </div>

          <div className="sl-nav">
            <button type="button" className="kb-btn ghost icon" onClick={toStart} aria-label={L('Αρχή', 'Start')} title={L('Αρχή (Home)', 'Start (Home)')}>
              <ChevronsLeft aria-hidden />
            </button>
            <button type="button" className="kb-btn ghost" onClick={prev} title={L('Πίσω (←)', 'Back (←)')}>
              <ChevronLeft aria-hidden />
              {L('Πίσω', 'Back')}
            </button>
            <span className="sl-sp" />
            <button type="button" className="kb-btn ghost icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} aria-label={L('Γύρισμα σκακιέρας', 'Flip board')} title={L('Γύρισμα σκακιέρας (F)', 'Flip board (F)')}>
              <FlipVertical2 aria-hidden />
            </button>
            <button type="button" className="kb-btn ghost icon" onClick={toEnd} aria-label={L('Τελευταία κίνηση', 'Last move')} title={L('Τελευταία κίνηση που φάνηκε (End)', 'Last revealed move (End)')}>
              <ChevronsRight aria-hidden />
            </button>
            <button type="button" className={`kb-btn${nextIsQuestion ? ' primary' : ''} sl-next`} disabled={Boolean(askingNow || pending || !node.children.length)} onClick={next} title={L('Επόμενο (→)', 'Next (→)')}>
              {nextIsQuestion ? L('Ερώτηση', 'Question') : L('Επόμενο', 'Next')}
              <ChevronRight aria-hidden />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
