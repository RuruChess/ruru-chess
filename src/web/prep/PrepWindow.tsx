/**
 * Καρτέλα «Προετοιμασία για αντίπαλο»: δίνεις τον αντίπαλο (FIDE / OTB, Lichess ή Chess.com· η φόρμα στο PrepForm.tsx)
 * και οι παρτίδες του μπαίνουν σε μία βάση «Αντίπαλος - <όνομα>». Όσο κατεβαίνουν, μία γραμμή προόδου ανά πηγή. Μετά,
 * αναφορά:
 * - σκορ με λευκά / μαύρα, ανά ρυθμό, Elo ανά πηγή
 * - εξερευνητής ρεπερτορίου: τι παίζει με λευκά, τι απαντά με μαύρα (σκακιέρα, συχνότητα, σκορ του, τελευταία φορά)
 * - συχνότερες γραμμές, αδύνατα σημεία (θέσεις όπου σκοράρει χαμηλά), πρόσφατες παρτίδες, συχνότεροι αντίπαλοι
 * Από κάθε θέση: «Παρτίδες της θέσης» (η βάση με φίλτρο χρώματος και θέσης) ή «Ανάλυση» (σκακιέρα με μηχανή).
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, CircleAlert, Database, FlaskConical, RefreshCw, SlidersHorizontal, Square, Target, Trash2, X } from 'lucide-react';
import { Position, START_FEN } from '../../core/chess.ts';
import {
  PREP_SOURCES,
  lineText,
  mainLine,
  scorePct,
  weakLines,
  type PrepInfo,
  type PrepNode,
  type PrepProgress,
  type PrepSource,
  type PrepSourceProgress,
  type PrepSpeed,
} from '../../core/prep.ts';
import { api, onServerEvent } from '../api.ts';
import { L, fmtDate, fmtNum } from '../i18n.ts';
import { newTabId, reportError, useApp } from '../store.ts';
import { Board } from '../components/Board.tsx';
import { displaySan, type NotationStyle } from '../components/Notation.tsx';
import { openDbWith } from '../components/QuickSearch.tsx';
import { useEcoBook } from '../eco.ts';
import { PrepForm, type FormStart } from './PrepForm.tsx';
import { takePrep } from './request.ts';
import { errText, scopeText, sourceName, speedName } from './text.ts';
import '../tactics/tactics.css';
import '../play/play.css';
import './prep.css';

type Color = 'white' | 'black';

interface Report {
  prep: PrepInfo;
  games: number;
  first: number;
  last: number;
  sources: Record<string, number>;
  score: { white: number[]; black: number[] };
  speeds: Array<{ speed: PrepSpeed; w: number; d: number; l: number }>;
  ratings: Array<{ source: string; speed: PrepSpeed; elo: number; date: number }>;
  opponents: Array<{ name: string; w: number; d: number; l: number }>;
  tree: { white: PrepNode; black: PrepNode };
  recent: Array<{ id: number; color: Color; opp: string; oppElo: number; elo: number; res: number | null; date: number; speed: PrepSpeed; source: string; opening: string; event: string }>;
}

/** Τα σφάλματα της τελευταίας εκτέλεσης («lichess:notfound otb:failed»). */
const errorsText = (error: string) =>
  error
    .split(' ')
    .map((x) => x.split(':'))
    .map(([src, code]) => errText(code, src))
    .join(' ');

function sourceState(src: PrepSource, s: PrepSourceProgress): string {
  if (s.state === 'error') return errText(s.error ?? 'net', src);
  if (s.state === 'cancelled') return L('Σταμάτησε', 'Stopped');
  if (s.state === 'done') return L(`${fmtNum(s.found)} παρτίδες`, `${fmtNum(s.found)} games`);
  if (src === 'otb') return L('Ψάχνω σε όλες τις βάσεις σου…', 'Searching all your databases…');
  return `${s.month ? `${s.month} · ` : ''}${L(`${fmtNum(s.found)} παρτίδες…`, `${fmtNum(s.found)} games…`)}`;
}

/** Μία γραμμή ανά πηγή, με τη σειρά της φόρμας. */
function SourceList({ progress }: { progress: PrepProgress }) {
  return (
    <div className="prep-progress" role="status">
      {PREP_SOURCES.map((src) => {
        const s = progress.sources[src];
        if (!s) return null;
        return (
          <div key={src} className={`prep-source is-${s.state}`}>
            <span className="prep-source-ic" aria-hidden>
              {s.state === 'running' ? <span className="spinner" /> : s.state === 'done' ? <Check size={16} /> : <CircleAlert size={16} />}
            </span>
            <b>{src === 'otb' ? 'FIDE / OTB' : sourceName(src)}</b>
            <span>{sourceState(src, s)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Μπάρα σκορ από τη μεριά του αντιπάλου: πράσινο νίκες, γκρι ισοπαλίες, κόκκινο ήττες. */
function ScoreLine({ w, d, l }: { w: number; d: number; l: number }) {
  const t = w + d + l;
  if (!t) return <span className="prep-bar" />;
  return (
    <span className="prep-bar" title={`+${w} =${d} −${l}`}>
      <span className="pb-w" style={{ width: `${(w / t) * 100}%` }} />
      <span className="pb-d" style={{ width: `${(d / t) * 100}%` }} />
      <span className="pb-l" style={{ width: `${(l / t) * 100}%` }} />
    </span>
  );
}

const pctText = (x: { w: number; d: number; l: number }) => {
  const p = scorePct(x);
  return p === null ? '–' : `${p}%`;
};

// ---------------------------------------------------------------------------

export function PrepWindow({ active }: { active: boolean }) {
  const [preps, setPreps] = useState<PrepInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<Record<string, PrepProgress>>({});
  const [sel, setSel] = useState<string | null>(null);
  // η ανοιχτή φόρμα· το key την ξαναφτιάχνει σε κάθε άνοιγμα
  const [form, setForm] = useState<(FormStart & { key: number }) | null>(null);
  const openForm = (start: FormStart = {}) => setForm({ ...start, key: Date.now() });

  const load = () =>
    api
      .get<{ preps: PrepInfo[]; running: PrepProgress[] }>('/api/prep')
      .then((r) => {
        setPreps(r.preps);
        setProgress(Object.fromEntries(r.running.map((p) => [p.id, p])));
        setSel((s) => (s && r.preps.some((p) => p.id === s) ? s : (r.preps[0]?.id ?? null)));
      })
      .catch(reportError)
      .finally(() => setLoaded(true));

  useEffect(() => {
    if (active) void load();
  }, [active]);

  // αίτημα από την αναζήτηση των Βάσεων: νέα προετοιμασία με αυτόν τον παίκτη
  useEffect(() => {
    const take = () => {
      const r = takePrep();
      if (r) openForm({ name: r.name });
    };
    take();
    window.addEventListener('knightbase:prep', take);
    return () => window.removeEventListener('knightbase:prep', take);
  }, []);

  useEffect(
    () =>
      onServerEvent('prep', (p: PrepProgress) => {
        const ended = p.phase !== 'running';
        setProgress((m) => {
          const next = { ...m };
          if (ended) delete next[p.id];
          else next[p.id] = p;
          return next;
        });
        if (!ended) return;
        void load();
        const { toast } = useApp.getState();
        const errs = Object.entries(p.sources).filter(([, s]) => s.state === 'error');
        for (const [src, s] of errs) toast(errText(s.error ?? 'net', src), 'error');
        if (p.phase === 'error') toast(L('Η προετοιμασία δεν ολοκληρώθηκε.', 'The preparation did not finish.'), 'error');
        else if (p.phase === 'cancelled') toast(L(`Σταμάτησε· κράτησα ${fmtNum(p.added)} παρτίδες.`, `Stopped; kept ${fmtNum(p.added)} games.`), 'info');
        else if (!errs.length) toast(L(`Προετοιμασία: ${fmtNum(p.added)} νέες παρτίδες.`, `Preparation: ${fmtNum(p.added)} new games.`), p.added ? 'ok' : 'info');
      }),
    [],
  );

  const prep = preps.find((p) => p.id === sel) ?? null;
  const showForm = form !== null || (loaded && !prep);

  // χωρίς παρτίδες: φεύγει και η άδεια βάση της· αλλιώς η βάση μένει στις Βάσεις
  const forget = (p: PrepInfo) =>
    void api
      .post<{ emptyDb: string | null }>(`/api/prep/${p.id}/forget`)
      .then(async ({ emptyDb }) => {
        if (emptyDb) await api.post(`/api/library/${emptyDb}/remove`, { deleteFiles: true });
        const { toast, refreshLibrary } = useApp.getState();
        toast(emptyDb ? L(`Αφαιρέθηκε: ${p.name}.`, `Removed: ${p.name}.`) : L(`Αφαιρέθηκε: ${p.name}. Η βάση μένει στις Βάσεις.`, `Removed: ${p.name}. The database stays in Databases.`), 'info');
        void refreshLibrary();
        return load();
      })
      .catch(reportError);

  return (
    <div className="tx bots prep">
      <div className={`bots-lobby prep-lobby${preps.length ? '' : ' is-empty'}`}>
        <div className="prep-main">
          <header className="kb-head with-ic">
            <span className="kb-head-ic" aria-hidden>
              <Target size={28} />
            </span>
            <div>
              <h1 className="kb-title" data-guide="prep">{L('Προετοιμασία για αντίπαλο', 'Prepare for opponent')}</h1>
              <p className="kb-sub">
                {L('Δώσε τον αντίπαλο και δες τι παίζει με λευκά και μαύρα και πού δυσκολεύεται.', 'Enter your opponent and see what they play with White and Black and where they struggle.')}
              </p>
            </div>
          </header>
          {showForm ? (
            <PrepForm
              key={form?.key ?? 'first'}
              start={form ?? {}}
              canClose={Boolean(prep)}
              onClose={() => setForm(null)}
              onStarted={(p) => {
                setForm(null);
                setPreps((list) => [p, ...list.filter((x) => x.id !== p.id)]);
                setSel(p.id);
              }}
            />
          ) : (
            prep && (
              <PrepReport
                key={prep.id}
                prep={prep}
                progress={progress[prep.id] ?? null}
                onForget={() => forget(prep)}
                onEdit={() => openForm({ prev: prep })}
                active={active}
              />
            )
          )}
        </div>

        {preps.length > 0 && (
          <aside className="prep-side">
            {!showForm && (
              <button type="button" className="kb-btn primary lg prep-new" onClick={() => openForm()}>
                <Target aria-hidden /> {L('Νέος αντίπαλος', 'New opponent')}
              </button>
            )}
            <section className="prep-list" aria-label={L('Οι προετοιμασίες σου', 'Your preparations')}>
              <h2 className="bots-sub">{L('Οι προετοιμασίες σου', 'Your preparations')}</h2>
              {preps.map((p) => {
                const total = p.counts.lichess + p.counts.chesscom + p.counts.local;
                return (
                  <div key={p.id} className="prep-item-row">
                    <button
                      type="button"
                      className={`prep-item${p.id === sel && !showForm ? ' is-sel' : ''}`}
                      onClick={() => {
                        setForm(null);
                        setSel(p.id);
                      }}
                    >
                      <span className="prep-item-name" title={p.name}>
                        {p.name}
                      </span>
                      <span className="faint small">
                        {progress[p.id]
                          ? L('Κατεβαίνουν παρτίδες…', 'Fetching games…')
                          : `${fmtNum(total)} ${L('παρτίδες', 'games')} · ${[p.lichess && 'Lichess', p.chesscom && 'Chess.com', (p.otb || p.locals?.length) && 'OTB'].filter(Boolean).join(' + ')}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="prep-item-x"
                      onClick={() => forget(p)}
                      title={L('Αφαίρεση από τη λίστα (οι παρτίδες μένουν στις Βάσεις)', 'Remove from the list (the games stay in Databases)')}
                      aria-label={L(`Αφαίρεση: ${p.name}`, `Remove: ${p.name}`)}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// αναφορά

function PrepReport({ prep, progress, onForget, onEdit, active }: { prep: PrepInfo; progress: PrepProgress | null; onForget: () => void; onEdit: () => void; active: boolean }) {
  const library = useApp((s) => s.library);
  const openTab = useApp((s) => s.openTab);
  const settings = useApp((s) => s.settings);
  const style: NotationStyle = ((settings?.ui as Record<string, unknown> | undefined)?.notation as NotationStyle) ?? 'figurine';
  const fig = (s: string) => displaySan(s, style);
  const db = library.find((d) => d.id === prep.dbId);
  const [rep, setRep] = useState<Report | null>(null);
  const [color, setColor] = useState<Color>(prep.opts.color === 'black' ? 'black' : 'white');
  const [path, setPath] = useState<string[]>([]);
  const [confirmForget, setConfirmForget] = useState(false);

  // νέα αναφορά όταν αλλάζουν οι παρτίδες της βάσης (ενημέρωση, ή διαγραφή από τη βάση)
  useEffect(() => {
    if (!active || progress) return;
    let live = true;
    api
      .get<Report>(`/api/prep/${prep.id}/report`)
      .then((r) => {
        if (!live) return;
        setRep(r);
        // πρώτα το χρώμα με τις περισσότερες παρτίδες
        setColor((c) => (r.tree[c].n || !r.tree[c === 'white' ? 'black' : 'white'].n ? c : c === 'white' ? 'black' : 'white'));
      })
      .catch(reportError);
    return () => {
      live = false;
    };
  }, [prep.id, prep.at, db?.games, active, progress]);

  const update = () => api.post('/api/prep/start', { id: prep.id }).catch(reportError);
  const cancel = () => api.post(`/api/prep/${prep.id}/cancel`).catch(reportError);
  const openDb = () => db && openTab({ id: `db-${db.id}`, kind: 'db', dbId: db.id, title: db.name });
  const total = prep.counts.lichess + prep.counts.chesscom + prep.counts.local;

  const header = (
    <div className="prep-head">
      <div className="prep-title">
        <h2>{prep.name}</h2>
        <div className="prep-chips">
          {prep.lichess && (
            <a className="chip" href={`https://lichess.org/@/${prep.lichess}`} target="_blank" rel="noreferrer" title={L('Το προφίλ στο Lichess', 'Profile on Lichess')}>
              Lichess: {prep.lichess} · {fmtNum(prep.counts.lichess)}
            </a>
          )}
          {prep.chesscom && (
            <a className="chip" href={`https://www.chess.com/member/${prep.chesscom}`} target="_blank" rel="noreferrer" title={L('Το προφίλ στο Chess.com', 'Profile on Chess.com')}>
              Chess.com: {prep.chesscom} · {fmtNum(prep.counts.chesscom)}
            </a>
          )}
          {prep.fide && (
            <a className="chip" href={`https://ratings.fide.com/profile/${prep.fide.id}`} target="_blank" rel="noreferrer" title={L('Το προφίλ στη FIDE', 'FIDE profile')}>
              FIDE {prep.fide.id} · {prep.fide.federation}
            </a>
          )}
          {(prep.otb || prep.locals?.length) && (
            <span
              className="chip"
              title={
                prep.otb
                  ? L('Από όλες τις βάσεις σου, χωρίς διπλές', 'From all your databases, without duplicates')
                  : prep.locals?.map((x) => `${library.find((d) => d.id === x.dbId)?.name ?? '?'}: ${x.players.join(', ')}`).join('\n')
              }
            >
              OTB · {fmtNum(prep.counts.local)}
            </span>
          )}
        </div>
        <div className="faint small">{scopeText(prep.opts)}</div>
        {prep.at > 0 && (
          <div className="faint small">
            {L('Ενημερώθηκε', 'Updated')} {new Date(prep.at).toLocaleString()} · {fmtNum(total)} {L('παρτίδες', 'games')}
          </div>
        )}
      </div>
      <div className="prep-actions">
        {progress ? (
          <button type="button" className="btn btn-sm" onClick={cancel}>
            <Square className="ic ic-sm" aria-hidden /> {L('Διακοπή', 'Stop')}
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={update} title={L('Μόνο οι καινούργιες παρτίδες από την τελευταία φορά', 'Only the new games since last time')}>
            <RefreshCw className="ic ic-sm" aria-hidden /> {L('Ενημέρωση', 'Update')}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={openDb} disabled={!db}>
          <Database className="ic ic-sm" aria-hidden /> {L('Άνοιγμα βάσης', 'Open database')}
        </button>
        {confirmForget ? (
          <>
            <button type="button" className="btn btn-sm btn-danger" onClick={onForget}>
              {L('Αφαίρεση (οι παρτίδες μένουν)', 'Remove (games stay)')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmForget(false)}>
              {L('Άκυρο', 'Cancel')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmForget(true)} title={L('Αφαίρεση από τη λίστα (οι παρτίδες μένουν στις Βάσεις)', 'Remove from the list (the games stay in Databases)')} aria-label={L('Αφαίρεση', 'Remove')}>
            <Trash2 className="ic ic-sm" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );

  if (progress) {
    return (
      <>
        {header}
        <SourceList progress={progress} />
      </>
    );
  }
  if (!rep) return <>{header}<p className="muted">{L('Φόρτωση…', 'Loading…')}</p></>;
  if (!rep.games) {
    return (
      <>
        {header}
        <div className="prep-empty">
          <h3 className="prep-h3">{L('Δεν βρέθηκαν παρτίδες', 'No games found')}</h3>
          <p>
            {prep.error
              ? errorsText(prep.error)
              : L('Ο παίκτης δεν έχει παρτίδες με αυτά τα φίλτρα. Δοκίμασε μεγαλύτερη περίοδο ή περισσότερους ρυθμούς.', 'The player has no games with these filters. Try a longer period or more time controls.')}
          </p>
          <button type="button" className="kb-btn primary" onClick={onEdit}>
            <SlidersHorizontal aria-hidden /> {L('Άλλαξε στοιχεία ή φίλτρα', 'Change details or filters')}
          </button>
        </div>
      </>
    );
  }

  const go = (c: Color, line: string[]) => {
    setColor(c);
    setPath(line);
  };
  // με φίλτρο χρώματος η άλλη πλευρά δεν έχει παρτίδες
  const sides: Color[] = prep.opts.color === 'both' ? ['white', 'black'] : [prep.opts.color];
  const root = rep.tree[color];
  const lines = (root.c ?? []).slice(0, 5).map((x) => [x.m, ...mainLine(x, 2, 11)]);
  const weak = weakLines(root);
  const ratingText = rep.ratings
    .filter((r, i, a) => a.findIndex((x) => x.source === r.source && (r.source === 'otb' || x.speed === r.speed)) === i)
    .slice(0, 6);

  return (
    <>
      {header}
      {prep.error && <p className="watch-err small">{errorsText(prep.error)}</p>}

      <div className="prep-cards">
        <div className="prep-card">
          <div className="faint small">{L('Παρτίδες', 'Games')}</div>
          <div className="prep-big">{fmtNum(rep.games)}</div>
          <div className="faint small">
            {fmtDate(rep.first)} – {fmtDate(rep.last)}
          </div>
        </div>
        {sides.map((c) => {
          const [w, d, l] = rep.score[c];
          return (
            <div key={c} className="prep-card">
              <div className="faint small">{c === 'white' ? L('Με λευκά', 'As White') : L('Με μαύρα', 'As Black')}</div>
              <div className="prep-big">{pctText({ w, d, l })}</div>
              <ScoreLine w={w} d={d} l={l} />
              <div className="faint small">
                +{w} ={d} −{l}
              </div>
            </div>
          );
        })}
        {(ratingText.length > 0 || prep.fide) && (
          <div className="prep-card prep-ratings">
            <div className="faint small">{L('Τελευταίο rating', 'Latest rating')}</div>
            {prep.fide && (prep.fide.standard || prep.fide.rapid || prep.fide.blitz) ? (
              <div className="small">
                <b>{prep.fide.standard ?? '–'}</b>
                <span className="faint"> FIDE</span>
                {prep.fide.rapid ? <span className="faint"> · R {prep.fide.rapid}</span> : null}
                {prep.fide.blitz ? <span className="faint"> · B {prep.fide.blitz}</span> : null}
              </div>
            ) : null}
            {ratingText.map((r) => (
              <div key={`${r.source}:${r.speed}`} className="small">
                <b>{r.elo}</b> <span className="faint">{sourceName(r.source)} {r.source === 'otb' ? '' : speedName(r.speed)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {rep.speeds.length > 1 && (
        <div className="prep-speedrow">
          {rep.speeds.map((s) => (
            <span key={s.speed} className="prep-speed" title={`+${s.w} =${s.d} −${s.l}`}>
              <b>{speedName(s.speed)}</b> {fmtNum(s.w + s.d + s.l)} · {pctText(s)}
            </span>
          ))}
        </div>
      )}

      <section className="prep-explore">
        <div className="prep-tabs" role="tablist">
          {sides.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={color === c} className={`btn btn-sm${color === c ? ' is-on' : ''}`} onClick={() => go(c, [])}>
              <span className={`side ${c === 'white' ? 'w' : 'b'}`} aria-hidden /> {c === 'white' ? L('Με λευκά', 'With White') : L('Με μαύρα', 'With Black')} · {fmtNum(rep.tree[c].n)}
            </button>
          ))}
        </div>
        <Explorer root={root} color={color} path={path} setPath={setPath} name={prep.name} dbId={prep.dbId} dbName={db?.name ?? ''} fig={fig} />
      </section>

      <div className="prep-two-col">
        <section>
          <h3 className="prep-h3">{color === 'white' ? L('Συχνότερες γραμμές του με λευκά', 'Their most common lines with White') : L('Συχνότερες απαντήσεις του με μαύρα', 'Their most common replies with Black')}</h3>
          <ul className="prep-lines">
            {lines.map((ln) => {
              const node = ln.reduce<PrepNode | undefined>((n, m) => n?.c?.find((x) => x.m === m), root) ?? root;
              return (
                <li key={ln.join(' ')}>
                  <button type="button" className="prep-line" onClick={() => go(color, ln)}>
                    <span className="prep-line-moves">{lineText(ln, fig)}</span>
                    <span className="faint small">
                      {fmtNum(node.n)} {L('παρτ.', 'g.')} · {pctText(node)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h3 className="prep-h3">{L('Αδύνατα σημεία (σκοράρει ≤ 40%)', 'Weak spots (scores ≤ 40%)')}</h3>
          {weak.length ? (
            <ul className="prep-lines">
              {weak.map((x) => (
                <li key={x.sans.join(' ')}>
                  <button type="button" className="prep-line is-weak" onClick={() => go(color, x.sans)}>
                    <span className="prep-line-moves">{lineText(x.sans, fig)}</span>
                    <span className="small">
                      <b>{pctText(x.node)}</b> <span className="faint">· {fmtNum(x.node.n)} {L('παρτ.', 'g.')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="faint small">{L('Καμία γραμμή με αρκετές παρτίδες (≥ 3) και χαμηλό σκορ.', 'No line with enough games (≥ 3) and a low score.')}</p>
          )}
        </section>
      </div>

      <div className="prep-two-col">
        <section>
          <h3 className="prep-h3">{L('Πρόσφατες παρτίδες', 'Recent games')}</h3>
          <table className="data-table compact prep-recent">
            <tbody>
              {rep.recent.slice(0, 15).map((g) => (
                <tr key={g.id} onClick={() => openTab({ id: newTabId('game'), kind: 'game', title: '…', source: { dbId: prep.dbId, gameId: g.id }, orientation: g.color })} title={[g.event, g.opening].filter(Boolean).join(' · ')}>
                  <td className="faint">{fmtDate(g.date)}</td>
                  <td>
                    <span className={`side ${g.color === 'white' ? 'w' : 'b'}`} aria-hidden />
                  </td>
                  <td className="prep-opp">
                    {g.opp} {g.oppElo ? <span className="faint">({g.oppElo})</span> : null}
                  </td>
                  <td className={`prep-res ${g.res === 1 ? 'is-w' : g.res === 0 ? 'is-l' : ''}`}>{g.res === 1 ? '1' : g.res === 0 ? '0' : g.res === 0.5 ? '½' : '*'}</td>
                  <td className="faint small">{sourceName(g.source)} {g.source === 'otb' ? '' : speedName(g.speed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3 className="prep-h3">{L('Συχνότεροι αντίπαλοι', 'Most frequent opponents')}</h3>
          <table className="data-table compact">
            <tbody>
              {rep.opponents.map((o) => (
                <tr key={o.name}>
                  <td>{o.name}</td>
                  <td className="num">{o.w + o.d + o.l}</td>
                  <td className="num faint">
                    +{o.w} ={o.d} −{o.l}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// εξερευνητής ρεπερτορίου

function Explorer({ root, color, path, setPath, name, dbId, dbName, fig }: { root: PrepNode; color: Color; path: string[]; setPath: (p: string[]) => void; name: string; dbId: string; dbName: string; fig: (s: string) => string }) {
  const settings = useApp((s) => s.settings);
  const openTab = useApp((s) => s.openTab);
  const eco = useEcoBook();

  // η θέση, η τελευταία κίνηση και το άνοιγμα (το βαθύτερο γνωστό) της γραμμής
  const { fen, lastMove, opening } = useMemo(() => {
    const p = Position.fromFen(START_FEN);
    let last = 0;
    let op: string | null = null;
    for (const s of path) {
      const m = p.parseSan(s);
      if (!m) break;
      p.makeMove(m);
      last = m;
      const o = eco?.lookup(p.hashHi, p.hashLo);
      if (o) op = `${o.eco} ${o.name}`;
    }
    return { fen: p.fen(), lastMove: last, opening: op };
  }, [path, eco]);

  let node: PrepNode | undefined = root;
  for (const m of path) node = node?.c?.find((x) => x.m === m);
  const theirMove = (path.length % 2 === 0) === (color === 'white');
  const kids = node?.c ?? [];

  const games = () => openDbWith(dbId, dbName, { filter: { [color]: name }, fen: path.length ? fen : null });
  const analyse = () =>
    openTab({
      id: newTabId('game'),
      kind: 'game',
      title: `${name}: ${lineText(path) || L('αρχή', 'start')}`,
      pgn: `[Event "${L('Προετοιμασία', 'Preparation')}: ${name.replace(/"/g, '')}"]\n\n${lineText(path)} *\n`,
      ply: path.length,
      orientation: color === 'white' ? 'black' : 'white',
    });

  return (
    <div className="prep-explorer">
      <div className="prep-board">
        <Board
          fen={fen}
          orientation={color === 'white' ? 'black' : 'white'}
          movable="both"
          lastMove={lastMove || undefined}
          theme={settings?.boardTheme}
          pieceSet={settings?.pieceSet}
          onMove={(from, to, promo) => {
            const p = Position.fromFen(fen);
            const m = p.findMove(from, to, promo);
            if (m) setPath([...path, p.san(m)]);
          }}
        />
        <div className="faint small prep-board-note">{L('Η σκακιέρα από τη δική σου μεριά· παίξε κινήσεις ή πάτα στη λίστα.', 'The board from your side; play moves or click the list.')}</div>
      </div>
      <div className="prep-moves">
        <div className="prep-path">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPath(path.slice(0, -1))} disabled={!path.length} aria-label={L('Πίσω', 'Back')}>
            <ChevronLeft className="ic ic-sm" aria-hidden />
          </button>
          <button type="button" className={`prep-crumb${path.length ? '' : ' is-cur'}`} onClick={() => setPath([])}>
            {L('Αρχή', 'Start')}
          </button>
          {path.map((m, i) => (
            <button key={i} type="button" className={`prep-crumb${i === path.length - 1 ? ' is-cur' : ''}`} onClick={() => setPath(path.slice(0, i + 1))}>
              {i % 2 === 0 ? `${i / 2 + 1}.` : ''}
              {fig(m)}
            </button>
          ))}
        </div>
        {opening && <div className="prep-opening">{opening}</div>}
        <div className="prep-who faint small">
          {theirMove ? L(`Τι παίζει ο/η ${name} εδώ`, `What ${name} plays here`) : L(`Τι έχουν παίξει εναντίον του/της`, 'What opponents have played against them')}
          {node ? ` · ${fmtNum(node.n)} ${L('παρτίδες', 'games')}` : ''}
        </div>
        {kids.length ? (
          <table className="data-table compact prep-tree">
            <thead>
              <tr>
                <th>{L('Κίνηση', 'Move')}</th>
                <th className="num">{L('Παρτ.', 'Games')}</th>
                <th>{L('Σκορ του', 'Their score')}</th>
                <th className="num">%</th>
                <th>{L('Τελευταία', 'Last')}</th>
              </tr>
            </thead>
            <tbody>
              {kids.map((k) => (
                <tr key={k.m} onClick={() => setPath([...path, k.m])} className={theirMove ? 'is-their' : ''}>
                  <td className="prep-mv">{fig(k.m)}</td>
                  <td className="num">{fmtNum(k.n)}</td>
                  <td>
                    <ScoreLine w={k.w} d={k.d} l={k.l} />
                  </td>
                  <td className="num">{pctText(k)}</td>
                  <td className="faint small">{fmtDate(k.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="faint small">{node ? L('Εδώ τελειώνουν οι γραμμές που κρατήθηκαν (μετά τις 4 πρώτες κινήσεις μόνο όσες παίχτηκαν ≥ 2 φορές).', 'The kept lines end here (after the first 4 moves only those played ≥ 2 times).') : L('Καμία παρτίδα του σε αυτή τη θέση.', 'None of their games reached this position.')}</p>
        )}
        <div className="prep-explore-actions">
          <button type="button" className="btn btn-sm" onClick={games}>
            <Database className="ic ic-sm" aria-hidden /> {L('Παρτίδες της θέσης', 'Games in this position')}
          </button>
          <button type="button" className="btn btn-sm" onClick={analyse}>
            <FlaskConical className="ic ic-sm" aria-hidden /> {L('Ανάλυση στη σκακιέρα', 'Analyse on a board')}
          </button>
        </div>
      </div>
    </div>
  );
}
