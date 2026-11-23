/** Μετά από κάθε άσκηση: «Από την πηγή» (ό,τι λένε τα δεδομένα, στα μαθήματα η λύση με τα σχόλια) και «Βαριάντες της μηχανής» (MultiPV), με κάθε κίνηση στη σκακιέρα. */
import { useState, type ReactNode } from 'react';
import { BookOpen, GitBranch } from 'lucide-react';
import type { GameNode } from '../../core/game.ts';
import { PgnLine } from '../components/PgnLine.tsx';
import { L } from '../i18n.ts';
import { reportError } from '../store.ts';
import { Spinner } from '../components/ui/Progress.tsx';
import { openLink } from '../components/About.tsx';
import { tacticsApi, type EngineLine, type Puzzle } from './api.ts';
import { lessonOf, type LessonInfo } from './lesson.ts';
import { moveLabels, moveText, playUci } from './logic.ts';
import { evalLabel, sanOf, solverEval, stsTheme } from './practice.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Ό,τι δίνει η πηγή για τη θέση: καλύτερη κίνηση και βαθμοί (τεστ), θέμα και πλάνο (STS), παρτίδα, σχόλια, η λύση με τις υποβαριάντες της. */
export function SourceInfo({
  p,
  tree,
  current,
  away,
  onPick,
  onBack,
}: {
  p: Puzzle;
  tree?: GameNode | null;
  current?: GameNode | null;
  /** η σκακιέρα δείχνει βαριάντα έξω από τη γραμμή που παίχτηκε */
  away?: boolean;
  onPick?: (n: GameNode) => void;
  onBack?: () => void;
}) {
  const lesson = lessonOf(p);
  // η λύση με τις βαριάντες της: κάθε κίνηση με κλικ στη σκακιέρα, ή με τα βελάκια
  const playable = tree && onPick ? <PlayableSolution tree={tree} current={current ?? null} away={Boolean(away)} onPick={onPick} onBack={onBack} /> : null;
  if (lesson) return <LessonSource lesson={lesson} playable={playable} />;
  const m = (p.meta ?? {}) as Record<string, unknown>;
  const g = p.goal ?? null;
  const rows: Array<{ k: string; v: ReactNode }> = [];
  if (g?.kind === 'test') {
    const best = (g.bm ?? []).map((u) => moveText(p.fen, sanOf(p.fen, u)));
    if (best.length) rows.push({ k: L('Καλύτερη κίνηση', 'Best move'), v: <b>{best.join(', ')}</b> });
    const pts = Object.entries(g.points ?? {}).sort((a, b) => b[1] - a[1]);
    if (pts.length > 1) rows.push({ k: L('Βαθμοί ανά κίνηση', 'Points per move'), v: pts.map(([u, n]) => `${sanOf(p.fen, u)} ${n}`).join(' · ') });
    if (g.am?.length) rows.push({ k: L('Να αποφύγεις', 'Avoid'), v: g.am.map((u) => sanOf(p.fen, u)).join(', ') });
  }
  const theme = stsTheme(m.category);
  if (theme)
    rows.push({
      k: L('Θέμα και πλάνο', 'Theme and plan'),
      v: (
        <>
          <b>{theme.name}</b>
          {theme.plan && <span className="muted">{`: ${theme.plan}`}</span>}
        </>
      ),
    });
  const players = str(m.white) && str(m.black) ? `${str(m.white)} – ${str(m.black)}` : '';
  const game = [players, str(m.event), str(m.date).replace(/\.\?\?/g, ''), str(m.result)].filter((x) => x && x !== '?').join(', ');
  if (game) rows.push({ k: L('Παρτίδα', 'Game'), v: game });
  if (str(m.comment)) rows.push({ k: L('Σχόλιο', 'Comment'), v: str(m.comment) });
  const label = Array.isArray(m.label) ? (m.label as unknown[]).map(str).filter((x) => x && !/^difficulty\b/i.test(x)) : [];
  if (label.length) rows.push({ k: L('Από τη συλλογή', 'From the collection'), v: label.join(' · ') });
  if (str(m.solution)) rows.push({ k: L('Η λύση της πηγής', 'The source solution'), v: playable ?? <span className="tx-src-sol">{str(m.solution)}</span> });
  if (!rows.length) return null;
  return (
    <section className="tx-src" aria-label={L('Από την πηγή', 'From the source')}>
      <div className="section-label">
        <BookOpen className="ic ic-sm" aria-hidden /> {L('Από την πηγή', 'From the source')}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="tx-src-row">
          <span className="faint">{r.k}</span>
          <span>{r.v}</span>
        </div>
      ))}
    </section>
  );
}

const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

/** Μάθημα: η λύση με τα σχόλια και τις υποβαριάντες της, και από πού είναι το κείμενο. */
/** Η λύση ως δέντρο: κάθε κίνηση πατιέται και φαίνεται στη σκακιέρα· οδηγίες για τα βελάκια. */
function PlayableSolution({ tree, current, away, onPick, onBack }: { tree: GameNode; current: GameNode | null; away: boolean; onPick: (n: GameNode) => void; onBack?: () => void }) {
  return (
    <div className="tx-psol">
      <PgnLine first={tree.children[0]} withFirstAlts current={current} onPick={onPick} />
      <div className="faint tx-nav-hint">
        {L(
          'Πάτα μια κίνηση για να τη δεις στη σκακιέρα. Βελάκια: ← → κίνηση-κίνηση· όπου υπάρχουν βαριάντες, το → δείχνει τις υποψήφιες κινήσεις (↑ ↓ και Enter). ↓ άλλη βαριάντα, Esc πίσω στη γραμμή.',
          'Click a move to see it on the board. Arrow keys: ← → move by move; where there are variations, → shows the candidate moves (↑ ↓ and Enter). ↓ another variation, Esc back to the line.',
        )}
        {away && onBack && (
          <>
            {' '}
            <button type="button" className="link-btn" onClick={onBack}>
              {L('Πίσω στη γραμμή (Esc)', 'Back to the line (Esc)')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LessonSource({ lesson, playable }: { lesson: LessonInfo; playable: ReactNode }) {
  return (
    <section className="tx-src" aria-label={L('Το μάθημα', 'The lesson')}>
      <div className="section-label">
        <BookOpen className="ic ic-sm" aria-hidden /> {L('Η λύση με τα σχόλια', 'The annotated solution')}
      </div>
      {playable ?? <SolutionText text={lesson.solution} />}
      {lesson.article && (
        <div className="faint tx-src-credit">
          {L('Με βάση το άρθρο ', 'Based on the article ')}
          {lesson.url ? (
            <button type="button" className="link-btn" onClick={() => void openLink(lesson.url)}>
              {`«${lesson.article}»`}
            </button>
          ) : (
            `«${lesson.article}»`
          )}
          {L(' της Wikipedia, σε μετάφραση και προσαρμογή· άδεια ', ' of Wikipedia, adapted; licence ')}
          <button type="button" className="link-btn" onClick={() => void openLink(LICENSE_URL)}>
            CC BY-SA 4.0
          </button>
          .
        </div>
      )}
      {lesson.book && (
        <div className="faint tx-src-credit">
          {L(
            `Με βάση το «${lesson.book}» του ${lesson.author} (${lesson.year}, κοινό κτήμα), σε δική μας μετάφραση και προσαρμογή.`,
            `Based on “${lesson.book}” by ${lesson.author} (${lesson.year}, public domain), adapted.`,
          )}
        </div>
      )}
      {!lesson.article && !lesson.book && <div className="faint tx-src-credit">{L('Μάθημα του Ruru.', 'A Ruru lesson.')}</div>}
    </section>
  );
}

/** Λύση σε PGN για ανάγνωση: κινήσεις, {σχόλια} σε πλάγια, (υποβαριάντες) σε δική τους γραμμή. */
export function SolutionText({ text }: { text: string }) {
  const stack: ReactNode[][] = [[]];
  let key = 0;
  const close = () => {
    const inner = stack.pop()!;
    stack[stack.length - 1].push(
      <span key={key++} className="tx-sol-v">
        {inner}
      </span>,
    );
  };
  for (const m of text.matchAll(/\{([^}]*)\}|(\()|(\))|([^{}()]+)/g)) {
    const cur = stack[stack.length - 1];
    if (m[1] !== undefined) {
      if (m[1].trim())
        cur.push(
          <span key={key++} className="tx-sol-c">
            {m[1].trim()}
          </span>,
        );
    } else if (m[2]) stack.push([]);
    else if (m[3]) {
      if (stack.length > 1) close();
    } else if (m[4].trim())
      cur.push(
        <span key={key++} className="tx-sol-m">
          {m[4].trim()}
        </span>,
      );
  }
  while (stack.length > 1) close();
  return <div className="tx-sol">{stack[0]}</div>;
}

/** Οι τρεις καλύτερες γραμμές της μηχανής από τη θέση του λύτη· κλικ σε μια κίνηση τη δείχνει στη σκακιέρα. */
export function Variations({ fen, solverWhite, onPreview }: { fen: string; solverWhite: boolean; onPreview: (v: { fen: string; last?: number } | null) => void }) {
  const [st, setSt] = useState<{ loading: boolean; lines: EngineLine[] | null; engine: boolean }>({ loading: false, lines: null, engine: true });
  const [cur, setCur] = useState<string | null>(null);
  const load = () => {
    setSt({ loading: true, lines: null, engine: true });
    tacticsApi
      .engine(fen, 3, 1500)
      .then((r) => setSt({ loading: false, lines: r.lines, engine: r.engine }))
      .catch((e) => {
        reportError(e);
        setSt({ loading: false, lines: null, engine: true });
      });
  };
  const show = (line: EngineLine, k: number, key: string) => {
    let f = fen;
    let last: number | undefined;
    for (let i = 0; i <= k; i++) {
      const r = playUci(f, line.uci[i]);
      if (!r) break;
      f = r.fen;
      last = r.move;
    }
    setCur(key);
    onPreview({ fen: f, last });
  };
  return (
    <section className="tx-vars" aria-label={L('Βαριάντες της μηχανής', 'Engine variations')}>
      {!st.lines && !st.loading && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
          <GitBranch className="ic" aria-hidden />
          {L('Βαριάντες της μηχανής', 'Engine variations')}
        </button>
      )}
      {st.loading && (
        <div className="tx-thinking">
          <Spinner label={L('Η μηχανή αναλύει', 'The engine is analysing')} />
          <span className="muted">{L('Η μηχανή αναλύει τη θέση…', 'The engine is analysing the position…')}</span>
        </div>
      )}
      {st.lines && (
        <>
          <div className="section-label">
            <GitBranch className="ic ic-sm" aria-hidden /> {L('Βαριάντες της μηχανής', 'Engine variations')}
          </div>
          {!st.engine ? (
            <p className="muted">{L('Δεν υπάρχει μηχανή (Ρυθμίσεις → Μηχανές).', 'No engine (Settings → Engines).')}</p>
          ) : (
            st.lines.map((line, n) => (
              <div key={n} className="tx-var">
                <span className="tx-var-eval tnum">{evalLabel(solverEval(line, solverWhite))}</span>
                <span className="tx-var-moves">
                  {moveLabels(fen, line.san).map((mv, k) => {
                    const key = `${n}:${k}`;
                    return (
                      <span key={k} className="tx-mvw">
                        {mv.num && <span className="mn">{mv.num}</span>}
                        <button type="button" className={`tx-mv${cur === key ? ' is-cur' : ''}`} onClick={() => show(line, k, key)}>
                          {mv.san}
                        </button>
                      </span>
                    );
                  })}
                </span>
              </div>
            ))
          )}
          {st.engine && st.lines.length > 0 && (
            <div className="faint tx-nav-hint">
              {L(`Βάθος ${st.lines[0].depth}, αξιολόγηση από τη δική σου σκοπιά. Κλικ σε μια κίνηση για να τη δεις στη σκακιέρα.`, `Depth ${st.lines[0].depth}, evaluation from your side. Click a move to see it on the board.`)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
