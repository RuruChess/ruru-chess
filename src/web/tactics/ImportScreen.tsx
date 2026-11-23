/**
 * Λήψεις puzzles μιας σελίδας της «Βελτίωσης»: η κύρια συλλογή (Τακτικά, με επιλογή ποιότητας) και οι
 * συλλογές της σελίδας (Lucas Chess, τεστ θέσεων), ανά υποομάδα, με περιγραφή, μέγεθος, άδεια, πρόοδο
 * (SSE «tactics») και ακύρωση. Πρώτη οθόνη μιας σελίδας όταν δεν έχει θέσεις.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CircleAlert, Download, Library, ListOrdered, Puzzle, RefreshCw, X } from 'lucide-react';
import { onServerEvent } from '../api.ts';
import { L, fmtBytes, fmtNum, language } from '../i18n.ts';
import { reportError } from '../store.ts';
import { Progress, Spinner } from '../components/ui/Progress.tsx';
import { Tag } from '../components/ui/Chip.tsx';
import { tacticsApi, type SourceInfo, type SourcesInfo, type TacticsJob } from './api.ts';
import { CATS, solutionText, type Section } from './sections.ts';

const PRESET_ORDER = ['lite', 'popular', 'default', 'broad', 'all'];

/** Περίπου bytes ανά θέση στη βάση (ίδια εκτίμηση με τον server). */
const BYTES_PER_POSITION = 60;

function phaseText(j: TacticsJob): string {
  if (j.status === 'queued') return L('Σε αναμονή…', 'Queued…');
  if (j.phase === 'download') {
    if (j.totalBytes) return L(`Λήψη: ${fmtBytes(j.bytes)} από ${fmtBytes(j.totalBytes)}`, `Downloading: ${fmtBytes(j.bytes)} of ${fmtBytes(j.totalBytes)}`);
    return j.message ? L(`Λήψη: ${j.message}`, `Downloading: ${j.message}`) : L('Έλεγχος για νέα έκδοση', 'Checking for a new release');
  }
  if (j.phase === 'import' || j.phase === 'prepare') return L(`Εισαγωγή: ${fmtNum(j.imported)} puzzles`, `Importing: ${fmtNum(j.imported)} puzzles`);
  if (j.phase === 'index') return L('Ευρετήρια (για γρήγορη επιλογή)…', 'Indexes (for fast selection)…');
  if (j.phase === 'finish' || j.phase === 'counts') return L('Μετρήσεις θεμάτων…', 'Counting themes…');
  return j.message ?? j.phase;
}

function progressOf(j: TacticsJob): number | null {
  if (j.phase === 'download' && j.totalBytes) return j.bytes / j.totalBytes;
  if ((j.phase === 'import' || j.phase === 'download') && j.total) return Math.min(1, j.done / j.total);
  return null;
}

/** Η εργασία τρέχει ή περιμένει. */
const live = (j: TacticsJob | null | undefined): boolean => Boolean(j && (j.status === 'running' || j.status === 'queued'));

/** Τι είδους θέσεις: λύση, τεστ ή εξάσκηση. */
function modeText(m: SourceInfo['mode']): string {
  if (m === 'test') return L('τεστ: βρες την καλύτερη κίνηση', 'test: find the best move');
  if (m === 'practice') return L('παίζεις τη θέση με τη μηχανή', 'you play the position against the engine');
  return L('λύση με κινήσεις', 'solve with moves');
}

const TITLES: Record<Section, () => string> = {
  tactics: () => L('Πρόσθετες συλλογές τακτικής', 'Extra tactics collections'),
  endgame: () => L('Συλλογές φινάλε', 'Endgame collections'),
  strategy: () => L('Συλλογές στρατηγικής', 'Strategy collections'),
};

const AFTER = () => L('Κάθε συλλογή είναι μικρή λήψη από το GitHub, όπου βρίσκονται τα αρχεία της. Μετά τη διαλέγεις στα «Θέματα και δυσκολία → Πηγή».', 'Each collection is a small download from GitHub, where its files are kept. Then pick it in “Themes and difficulty → Source”.');

const NOTES: Record<Section, () => string> = {
  tactics: () => `${L('Δωρεάν συνδυασμοί και ματ από το πρόγραμμα Lucas Chess.', 'Free combinations and mates from the Lucas Chess program.')} ${AFTER()}`,
  endgame: () =>
    `${L('Τα μαθήματα με εξηγήσεις είναι ήδη μέσα στην εφαρμογή. Υπάρχουν και δωρεάν θέσεις φινάλε από το πρόγραμμα Lucas Chess, που τις παίζεις απέναντι στη μηχανή.', 'The lessons with explanations are already inside the app. There are also free endgame positions from the Lucas Chess program, which you play against the engine.')} ${AFTER()}`,
  strategy: () => `${L('Κλασικά τεστ «βρες την καλύτερη κίνηση» και θέσεις μέσου παιχνιδιού που τις παίζεις απέναντι στη μηχανή.', 'Classic “find the best move” test suites and middlegame positions you play against the engine.')} ${AFTER()}`,
};

/** Οι συλλογές μιας σελίδας, ανά υποομάδα, με περιγραφή, κουμπί εισαγωγής, πρόοδο και ακύρωση. */
function Collections({ info, jobs, onImport, onCancel, onOpen, busy, section }: { info: SourcesInfo; jobs: TacticsJob[]; onImport: (key: string) => void; onCancel: (j: TacticsJob) => void; onOpen?: (key: string) => void; busy: boolean; section: Section }) {
  const el = language() === 'el';
  const cols = info.sources.filter((s) => s.kind !== 'lichess' && s.kind !== 'mine' && s.section === section);
  // «όλες» = οι συλλογές της σελίδας χωρίς τις μεγάλες
  const allKey = `section-${section}`;
  // η εργασία μιας γραμμής: δική της, της ομάδας της ή του «όλες»
  const jobOf = (s: SourceInfo) => jobs.find((j) => live(j) && (j.source === s.key || j.source === s.group || ((j.source === 'extras' || j.source === allKey) && !s.optional))) ?? (live(s.job) ? s.job : null);
  const allJob = jobs.find((j) => live(j) && (j.source === 'extras' || j.source === allKey));
  const missing = cols.filter((s) => !s.optional && !s.count && s.kind !== 'bundled');
  return (
    <div className="panel tx-import-card">
      <div className="tx-import-head">
        <span className="empty-icon" aria-hidden>
          <Library className="ic ic-lg" />
        </span>
        <div>
          <h2>{TITLES[section]()}</h2>
          <p className="muted">{NOTES[section]()}</p>
        </div>
      </div>
      <div className="tx-import-foot">
        <button type="button" className="btn btn-secondary" disabled={busy || Boolean(allJob) || !missing.length} onClick={() => onImport(allKey)}>
          <Download className="ic" aria-hidden />
          {missing.length ? L(`Εισαγωγή όλων (${missing.length}, χωρίς τις μεγάλες)`, `Import all (${missing.length}, without the large ones)`) : L('Όλες οι συλλογές έχουν μπει', 'All collections are in')}
        </button>
        {allJob && (
          <button type="button" className="btn btn-ghost" onClick={() => onCancel(allJob)}>
            <X className="ic" aria-hidden />
            {L('Ακύρωση', 'Cancel')}
          </button>
        )}
      </div>
      <div className="tx-cols">
        {CATS[section].map((g) => {
          const list = cols.filter((s) => s.cat === g.id);
          if (!list.length) return null;
          return (
            <section key={g.id} className="tx-col-group" aria-label={g.title()}>
              <div className="section-label">{g.title()}</div>
              <div className="faint tx-col-d">{g.note()}</div>
              {list.map((s) => {
                const j = jobOf(s);
                const frac = j ? progressOf(j) : null;
                const size = (s.count || s.approx) * BYTES_PER_POSITION;
                const builtIn = s.kind === 'bundled';
                return (
                  <div key={s.key} className="tx-col">
                    <div className="tx-col-t">
                      {el ? s.name.el : s.name.en}
                      {s.count > 0 && <Tag tone="ok">{builtIn ? L(`${fmtNum(s.count)} μαθήματα`, `${fmtNum(s.count)} lessons`) : L(`${fmtNum(s.count)} στη βάση`, `${fmtNum(s.count)} imported`)}</Tag>}
                      {s.optional && <Tag>{L('μεγάλη', 'large')}</Tag>}
                      <Tag tone={s.solution === 'lines' ? 'ok' : s.solution === 'best' ? 'accent' : 'warn'}>{solutionText(s.solution)}</Tag>
                    </div>
                    <div className="tx-col-about">{el ? s.about.el : s.about.en}</div>
                    <div className="tx-col-d">
                      {builtIn
                        ? L('Μέσα στην εφαρμογή, χωρίς λήψη · λύση με σχόλια σε κάθε κίνηση', 'Inside the app, no download · solution with a comment on every move')
                        : L(`~${fmtNum(s.approx)} θέσεις · ~${fmtBytes(size)} στη βάση · ${modeText(s.mode)}`, `~${fmtNum(s.approx)} positions · ~${fmtBytes(size)} on disk · ${modeText(s.mode)}`)}
                      <br />
                      {L('Άδεια', 'Licence')}: {s.license}
                    </div>
                    <div className="tx-col-acts">
                      {s.count > 0 && onOpen && !j && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpen(s.key)} title={L('Οι θέσεις της συλλογής με τη σειρά', 'The positions of the collection in order')}>
                          <ListOrdered className="ic" aria-hidden />
                          {L('Άνοιξε', 'Open')}
                        </button>
                      )}
                      {builtIn ? null : j ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancel(j)}>
                          <X className="ic" aria-hidden />
                          {L('Ακύρωση', 'Cancel')}
                        </button>
                      ) : (
                        <button type="button" className={`btn btn-sm ${s.count ? 'btn-ghost' : 'btn-secondary'}`} disabled={busy} onClick={() => onImport(s.key)} title={s.count ? L('Ξανά από την πηγή (ενημερώνει τις θέσεις, κρατά την πρόοδό σου)', 'Again from the source (updates the positions, keeps your progress)') : undefined}>
                          {s.count ? <RefreshCw className="ic" aria-hidden /> : <Download className="ic" aria-hidden />}
                          {s.count ? L('Ξανά', 'Again') : L('Εισαγωγή', 'Import')}
                        </button>
                      )}
                    </div>
                    {j && <Progress value={frac} small label={phaseText(j)} />}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function ImportScreen({ onReady, onBack, onOpen, section = 'tactics' }: { onReady: () => void; onBack?: () => void; onOpen?: (key: string) => void; section?: Section }) {
  const [info, setInfo] = useState<SourcesInfo | null>(null);
  const [quality, setQuality] = useState('default');
  const [job, setJob] = useState<TacticsJob | null>(null);
  const [jobs, setJobs] = useState<TacticsJob[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    tacticsApi
      .sources()
      .then((s) => {
        setInfo(s);
        setJobs(s.jobs);
        const lj = s.sources.find((x) => x.key === 'lichess');
        if (lj?.job) setJob(lj.job);
        if (lj?.info?.quality && s.qualityPresets[lj.info.quality]) setQuality(lj.info.quality);
      })
      .catch(reportError);
  }, []);
  useEffect(load, [load]);

  // πρόοδος από τον server (ίδια εργασία, από οποιοδήποτε παράθυρο)
  useEffect(
    () =>
      onServerEvent('tactics', (e: { type?: string; job?: TacticsJob }) => {
        if (e?.type !== 'job' || !e.job) return;
        const j = e.job;
        setJobs((list) => [j, ...list.filter((x) => x.id !== j.id)]);
        if (j.source === 'lichess') setJob(j);
        if (j.status === 'done') {
          load();
          onReady();
        } else if (j.status === 'error' || j.status === 'cancelled') load();
      }),
    [onReady, load],
  );

  const start = () => {
    setBusy(true);
    tacticsApi
      .importLichess(quality)
      .then((r) => setJob(r.job))
      .catch(reportError)
      .finally(() => setBusy(false));
  };
  const importCol = (key: string) => {
    setBusy(true);
    tacticsApi
      .importCollection(key)
      .then((r) => setJobs((list) => [r.job, ...list.filter((x) => x.id !== r.job.id)]))
      .catch(reportError)
      .finally(() => setBusy(false));
  };
  const cancelJob = (j: TacticsJob) => void tacticsApi.cancelJob(j.id).catch(reportError);

  const lichess = info?.sources.find((s) => s.key === 'lichess');
  const presets = info ? PRESET_ORDER.filter((k) => info.qualityPresets[k]).map((k) => [k, info.qualityPresets[k]] as const) : [];
  const running = live(job);
  const free = info?.totals.freeBytes ?? null;
  const need = (info?.qualityPresets[quality]?.mb ?? 405) * 1024 * 1024 * 2.5 + 320 * 1024 * 1024;
  const lowDisk = free !== null && info !== null && free - need < info.totals.minFreeBytes;
  const el = language() === 'el';
  const failed = jobs.find((j) => j.status === 'error' && j.source !== 'lichess' && Date.now() - (j.finished ?? j.started) < 10 * 60_000);

  return (
    <div className="tx-import">
      <div className="tx-import-stack">
        {onBack && (
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
              <ArrowLeft className="ic" aria-hidden />
              {L('Πίσω στην εκπαίδευση', 'Back to training')}
            </button>
          </div>
        )}
        {section === 'tactics' && (
          <div className="panel tx-import-card">
            <div className="tx-import-head">
              <span className="empty-icon" aria-hidden>
                <Puzzle className="ic ic-lg" />
              </span>
              <div>
                <h1>{L('Η κύρια συλλογή puzzles', 'The main puzzle collection')}</h1>
                <p className="muted">
                  {lichess?.count
                    ? L(`Στη βάση: ${fmtNum(lichess.count)} puzzles από πραγματικές παρτίδες, με βαθμό, θέματα και άνοιγμα (CC0). Μια νέα εισαγωγή φέρνει τη νεότερη έκδοση ή άλλη επιλογή ποιότητας· η πρόοδός σου μένει.`, `In the database: ${fmtNum(lichess.count)} puzzles from real games, with rating, themes and opening (CC0). A new import brings the newest release or another quality choice; your progress stays.`)
                    : L('Εκατομμύρια θέσεις από πραγματικές παρτίδες, με βαθμό δυσκολίας, θέματα και άνοιγμα. Ελεύθερα για κάθε χρήση (CC0). Κατεβαίνουν μία φορά και μένουν στον υπολογιστή σου.', 'Millions of positions from real games, with difficulty, themes and opening. Free for any use (CC0). Downloaded once, kept on your computer.')}
                </p>
              </div>
            </div>

            {!info ? (
              <div className="tx-loading">
                <Spinner label={L('Φόρτωση', 'Loading')} />
              </div>
            ) : running && job ? (
              <div className="tx-import-progress" aria-live="polite">
                <div className="tx-import-phase">
                  <span className="spinner" aria-hidden />
                  <b>{phaseText(job)}</b>
                </div>
                <Progress value={progressOf(job)} label={progressOf(job) !== null ? `${Math.round((progressOf(job) ?? 0) * 100)}%` : undefined} />
                <div className="faint tx-import-meta tnum">
                  {job.imported > 0 && L(`${fmtNum(job.imported)} μπήκαν`, `${fmtNum(job.imported)} imported`)}
                  {job.filtered > 0 && L(` · ${fmtNum(job.filtered)} εκτός φίλτρου ποιότητας`, ` · ${fmtNum(job.filtered)} outside the quality filter`)}
                  {job.rejected > 0 && L(` · ${fmtNum(job.rejected)} άκυρα`, ` · ${fmtNum(job.rejected)} invalid`)}
                </div>
                <p className="faint">{L('Μπορείς να κλείσεις την καρτέλα ή να δουλέψεις αλλού: η εισαγωγή συνεχίζει στο παρασκήνιο (γραμμή κατάστασης).', 'You can close the tab or work elsewhere: the import continues in the background (status bar).')}</p>
                <div>
                  <button type="button" className="btn btn-secondary" onClick={() => cancelJob(job)}>
                    <X className="ic" aria-hidden />
                    {L('Ακύρωση (συνεχίζει αργότερα από το ίδιο σημείο)', 'Cancel (resumes later from the same point)')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {job?.status === 'error' && (
                  <div className="tx-verdict is-bad" role="alert">
                    <CircleAlert className="ic" aria-hidden />
                    <span>{job.error ?? L('Η εισαγωγή απέτυχε', 'The import failed')}</span>
                  </div>
                )}
                {lichess?.state === 'interrupted' && <p className="muted">{L('Μια προηγούμενη εισαγωγή διακόπηκε· συνεχίζει από εκεί που σταμάτησε.', 'A previous import was interrupted; it resumes where it stopped.')}</p>}
                <fieldset className="tx-presets">
                  <legend className="label">{L('Πόσα puzzles;', 'How many puzzles?')}</legend>
                  {presets.map(([k, p]) => (
                    <label key={k} className={`tx-preset${quality === k ? ' is-on' : ''}`}>
                      <input type="radio" name="tx-quality" value={k} checked={quality === k} onChange={() => setQuality(k)} />
                      <span className="tx-preset-t">
                        {el ? p.el : p.en}
                        {k === 'default' && <span className="tag tag-accent">{L('προτείνεται', 'suggested')}</span>}
                      </span>
                      <span className="tnum tx-preset-n">{L(`${fmtNum(p.count)} puzzles · ~${fmtNum(p.mb)} MB`, `${fmtNum(p.count)} puzzles · ~${fmtNum(p.mb)} MB`)}</span>
                      <span className="faint tx-preset-d">
                        {p.minPopularity > -100 ? L(`δημοτικότητα ≥ ${p.minPopularity}, ≥ ${fmtNum(p.minPlays)} προσπάθειες`, `popularity ≥ ${p.minPopularity}, ≥ ${fmtNum(p.minPlays)} plays`) : L('χωρίς φίλτρο ποιότητας', 'no quality filter')}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="tx-import-foot">
                  <button type="button" className={`btn btn-lg ${lichess?.count ? 'btn-secondary' : 'btn-primary'}`} data-guide={lichess?.count ? undefined : 'puzzles'} disabled={busy || lowDisk} onClick={start}>
                    <Download className="ic" aria-hidden />
                    {lichess?.state === 'interrupted' ? L('Συνέχεια εισαγωγής', 'Resume the import') : lichess?.count ? L('Νέα εισαγωγή', 'Import again') : L('Λήψη και εισαγωγή', 'Download and import')}
                  </button>
                  <span className="faint">
                    {L(`Λήψη ~300 MB · ελεύθερος χώρος ${free !== null ? fmtBytes(free) : '…'}`, `Download ~300 MB · free space ${free !== null ? fmtBytes(free) : '…'}`)}
                  </span>
                </div>
                {lowDisk && <p className="tx-type-err">{L('Δεν φτάνει ο ελεύθερος χώρος: η εισαγωγή αφήνει πάντα 5 GB ελεύθερα. Διάλεξε λιγότερα puzzles ή άδειασε χώρο.', 'Not enough free space: the import always leaves 5 GB free. Pick fewer puzzles or free some space.')}</p>}
              </>
            )}
          </div>
        )}
        {section === 'endgame' && (
          <div className="panel tx-import-card">
            <div className="tx-import-head">
              <span className="empty-icon" aria-hidden>
                <Puzzle className="ic ic-lg" />
              </span>
              <div>
                <h2>{L('Φινάλε από την κύρια συλλογή', 'Endgames from the main collection')}</h2>
                <p className="muted">
                  {lichess?.count
                    ? L('Τα puzzles της κύριας συλλογής που είναι φινάλε μπαίνουν και εδώ: στην «Εξάσκηση» διάλεξε πηγή «Κύρια συλλογή: φινάλε».', 'The main-collection puzzles that are endgames are here too: in “Practice” pick the source “Main collection: endgames”.')
                    : L('Αν κατεβάσεις την κύρια συλλογή (Τακτικά → Λήψη puzzles), τα puzzles της που είναι φινάλε θα εμφανίζονται και εδώ.', 'If you download the main collection (Tactics → Get puzzles), its endgame puzzles will show up here too.')}
                </p>
              </div>
            </div>
          </div>
        )}
        {failed && (
          <div className="tx-verdict is-bad" role="alert">
            <CircleAlert className="ic" aria-hidden />
            <span>{L(`«${failed.title}»: ${failed.error ?? 'η εισαγωγή απέτυχε'}`, `“${failed.title}”: ${failed.error ?? 'the import failed'}`)}</span>
          </div>
        )}
        {info && <Collections info={info} jobs={jobs} onImport={importCol} onCancel={cancelJob} onOpen={onOpen} busy={busy} section={section} />}
      </div>
    </div>
  );
}
