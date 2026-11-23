/** Εργαλεία βάσης: βιβλίο Polyglot, αφαίρεση σχολιασμού (UnAnnotateDB), βελτίωση βάσης (ImproveDB). */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderOpen } from 'lucide-react';
import { api, pickFiles, type DbInfo, type JobInfo } from '../api.ts';
import { L, fmtBytes, fmtDate, fmtNum } from '../i18n.ts';
import { reportError, useApp } from '../store.ts';
import { Dialog, Field, Progress } from './ui.tsx';
import { openLink } from './About.tsx';
import { setUiLater } from '../tactics/store.ts';

/** Δημιουργία βιβλίου ανοιγμάτων Polyglot (.bin) από τις παρτίδες ή το δέντρο της βάσης. */
export function BookDialog({ db, onClose }: { db: DbInfo; onClose: () => void }) {
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const big = db.games > 50_000;
  const [maxPly, setMaxPly] = useState(30);
  const [minGames, setMinGames] = useState(big ? 10 : 2);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ path: string; entries: number; positions: number } | null>(null);

  const create = async () => {
    const paths = await pickFiles('savebook', { name: `${db.name}.bin` }).catch((e) => {
      reportError(e);
      return [];
    });
    if (!paths.length) return;
    setBusy(true);
    try {
      setRes(await api.post<{ path: string; entries: number; positions: number }>(`/api/db/${db.id}/book`, { path: paths[0], maxPly, minGames }));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={L('Βιβλίο ανοιγμάτων Polyglot', 'Polyglot opening book')}
      onClose={onClose}
      footer={
        res ? (
          <>
            <button onClick={onClose}>{L('Κλείσιμο', 'Close')}</button>
            <button
              className="primary"
              onClick={async () => {
                await saveSettings({ bookPath: res.path });
                toast(L('Ορίστηκε ως βιβλίο ανοιγμάτων', 'Set as the opening book'), 'ok');
                onClose();
              }}
            >
              {L('Χρήση ως βιβλίο ανοιγμάτων', 'Use as opening book')}
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
            <button className="primary" disabled={busy} onClick={() => void create()}>
              {busy ? L('Δημιουργία…', 'Creating…') : L('Αποθήκευση ως…', 'Save as…')}
            </button>
          </>
        )
      }
    >
      <p className="muted small">
        {big
          ? L('Από το δέντρο θέσεων της βάσης (θέσεις με τουλάχιστον 24 παρτίδες).', 'From the position tree of the database (positions with at least 24 games).')
          : L('Από όλες τις παρτίδες της βάσης.', 'From all games of the database.')}{' '}
        {L('Βάρος κίνησης: 2·νίκες + ισοπαλίες της πλευράς που παίζει.', 'Move weight: 2·wins + draws of the side to move.')}
      </p>
      <Field label={L('Βάθος (ημικινήσεις)', 'Depth (plies)')}>
        <input type="number" min={1} max={60} value={maxPly} onChange={(e) => setMaxPly(Math.max(1, Math.min(60, Number(e.target.value) || 30)))} />
      </Field>
      <Field label={L('Ελάχιστες παρτίδες ανά κίνηση', 'Minimum games per move')}>
        <input type="number" min={1} value={minGames} onChange={(e) => setMinGames(Math.max(1, Number(e.target.value) || 1))} />
      </Field>
      {res && (
        <p>
          {L(`Γράφτηκαν ${fmtNum(res.entries)} κινήσεις σε ${fmtNum(res.positions)} θέσεις:`, `Wrote ${fmtNum(res.entries)} moves in ${fmtNum(res.positions)} positions:`)} <code className="fen-small">{res.path}</code>
        </p>
      )}
    </Dialog>
  );
}

/** Αφαίρεση σχολιασμού από όλες τις παρτίδες μιας βάσης (οριστική). */
export function UnannotateDialog({ db, onClose }: { db: DbInfo; onClose: () => void }) {
  const toast = useApp((s) => s.toast);
  const jobs = useApp((s) => s.jobs);
  const [o, setO] = useState({ variations: true, comments: true, nags: true, shapes: true });
  const [jobId, setJobId] = useState<string | null>(null);
  const job = jobs.find((j) => j.id === jobId);

  useEffect(() => {
    if (!job || job.status === 'running') return;
    if (job.status === 'done') toast(L(`Ο σχολιασμός αφαιρέθηκε από ${fmtNum(job.progress.totalBytes)} παρτίδες`, `Annotations removed from ${fmtNum(job.progress.totalBytes)} games`), 'ok');
    onClose();
  }, [job, toast, onClose]);

  const start = async () => {
    if (!window.confirm(L(`Οριστική αφαίρεση από όλες τις παρτίδες της «${db.name}» — δεν αναιρείται. Συνέχεια;`, `Permanently remove from every game of “${db.name}” — this cannot be undone. Continue?`))) return;
    try {
      setJobId((await api.post<{ id: string }>(`/api/db/${db.id}/unannotate`, o)).id);
    } catch (e) {
      reportError(e);
    }
  };

  const items: Array<[keyof typeof o, string]> = [
    ['variations', L('Βαριάντες', 'Variations')],
    ['comments', L('Σχόλια (και ρολόγια, αξιολογήσεις)', 'Comments (and clocks, evaluations)')],
    ['nags', L('Σύμβολα (!, ?, +− …)', 'Symbols (!, ?, +− …)')],
    ['shapes', L('Γραφικά (βέλη, χρωματιστά τετράγωνα)', 'Graphics (arrows, coloured squares)')],
  ];
  return (
    <Dialog
      title={L(`Αφαίρεση σχολιασμού — ${db.name}`, `Remove annotations — ${db.name}`)}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={Boolean(jobId)}>
            {L('Άκυρο', 'Cancel')}
          </button>
          <button className="primary danger" disabled={Boolean(jobId) || !Object.values(o).some(Boolean)} onClick={() => void start()}>
            {L('Αφαίρεση', 'Remove')}
          </button>
        </>
      }
    >
      {items.map(([k, label]) => (
        <label key={k} className="check">
          <input type="checkbox" checked={o[k]} disabled={Boolean(jobId)} onChange={(e) => setO({ ...o, [k]: e.target.checked })} /> {label}
        </label>
      ))}
      {job && <Progress value={job.progress.totalBytes ? job.progress.games / job.progress.totalBytes : 0} label={`${fmtNum(job.progress.games)} / ${fmtNum(job.progress.totalBytes)}`} />}
    </Dialog>
  );
}

interface LocalRef {
  path: string;
  name: string;
  size: number;
  /** id της βάσης αν έχει ήδη εισαχθεί */
  db: string | null;
  busy: boolean;
}

// κατευθείαν στην ενότητα PGN (όχι στις βάσεις άλλων προγραμμάτων πιο πάνω)
const LUMBRAS_PAGE = 'https://lumbrasgigabase.com/en/download-area-en/#pgn';

/**
 * Βάση αναφοράς (Lumbra's Gigabase): από 11/2026 κατεβαίνει μόνο από τη σελίδα της στον browser (με σύντομο
 * έλεγχο που δεν παρακάμπτουμε). Ανοίγουμε τη σελίδα, και το αρχείο που κατέβηκε βρίσκεται μόνο του στις Λήψεις.
 */
export function ReferenceDownload() {
  const [files, setFiles] = useState<LocalRef[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .get<{ files: LocalRef[] }>('/api/reference/local')
        .then((d) => live && setFiles(d.files))
        .catch(() => {});
    load();
    // ο browser γράφει πρώτα .crdownload / .part: το .7z φαίνεται μόλις τελειώσει η λήψη
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  // ή δική σου βάση (π.χ. GreekBase): από τη Βιβλιοθήκη ή από αρχείο
  const library = useApp((s) => s.library);
  const ui = (useApp((s) => s.settings?.ui) ?? {}) as Record<string, unknown>;
  const toast = useApp((s) => s.toast);
  const refId = typeof ui.referenceDb === 'string' ? ui.referenceDb : '';
  const own = library.filter((d) => d.games > 0 && d.busy?.kind !== 'import').sort((a, b) => b.games - a.games);
  const setRef = (id: string, name: string) => {
    setUiLater({ referenceDb: id });
    toast(L(`Η «${name}» είναι τώρα η βάση αναφοράς.`, `“${name}” is now the reference database.`), 'ok');
  };
  const openOwn = async () => {
    const paths = await pickFiles('open');
    if (!paths[0]) return;
    try {
      const r = await api.post<{ opened: Array<{ entry: DbInfo; job: JobInfo | null }> }>('/api/library/open', { paths: [paths[0]] });
      const o = r.opened[0];
      if (!o) return;
      void useApp.getState().refreshLibrary();
      setUiLater({ referenceDb: o.entry.id });
      toast(
        o.job
          ? L(`Εισαγωγή «${o.entry.name}»… μόλις τελειώσει, είναι η βάση αναφοράς.`, `Importing “${o.entry.name}”… it becomes the reference database when done.`)
          : L(`Η «${o.entry.name}» είναι τώρα η βάση αναφοράς.`, `“${o.entry.name}” is now the reference database.`),
        o.job ? 'info' : 'ok',
      );
    } catch (e) {
      reportError(e);
    }
  };

  const doImport = (f: LocalRef) => {
    setBusy(f.path);
    setErr('');
    api
      .post('/api/reference/import', { path: f.path })
      .then(() => setFiles((x) => x && x.map((y) => (y.path === f.path ? { ...y, db: 'new', busy: true } : y))))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };
  return (
    <div className="ref-download">
      <ol className="ref-steps small">
        <li>
          {L('Άνοιξε τη σελίδα λήψης και κατέβασε από την ενότητα «PGN» το ', 'Open the download page and, under “PGN”, download ')}
          <b>OTB Elite (Elo 2400+)</b>
          {L(' (~200 MB, η μικρή) ή το ', ' (~200 MB, the small one) or ')}
          <b>OTB Complete</b>
          {L(' (~2,5 GB, όλες οι παρτίδες). Ο browser κάνει έναν σύντομο έλεγχο πριν ξεκινήσει η λήψη.', ' (~2.5 GB, all games). The browser runs a short check before the download starts.')}
        </li>
        <li>{L('Το Ruru βρίσκει μόνο του το αρχείο στις «Λήψεις»· πάτα «Εισαγωγή».', 'Ruru finds the file in “Downloads” by itself; press “Import”.')}</li>
      </ol>
      <div>
        <button className="primary" onClick={() => void openLink(LUMBRAS_PAGE)}>
          <ExternalLink size={15} /> {L('Σελίδα λήψης', 'Download page')}
        </button>
      </div>
      {files?.map((f) => (
        <div key={f.path} className="ref-option">
          <div className="ref-option-main">
            <b>{f.name}</b>
            <div className="muted small">
              {fmtBytes(f.size)} · {L('Λήψεις', 'Downloads')}
            </div>
          </div>
          {f.busy ? (
            <span className="small ok-text">{L('Εισάγεται — η πρόοδος φαίνεται στην κάρτα της βάσης.', 'Importing — progress is on the database card.')}</span>
          ) : f.db ? (
            <span className="muted small">{L('✓ στη Βιβλιοθήκη', '✓ in the library')}</span>
          ) : (
            <button className="primary" disabled={Boolean(busy)} onClick={() => doImport(f)}>
              {busy === f.path ? L('Έλεγχος…', 'Checking…') : L('Εισαγωγή', 'Import')}
            </button>
          )}
        </div>
      ))}
      {files && !files.length && <div className="muted small">{L('Περιμένω το αρχείο στις Λήψεις…', 'Waiting for the file in Downloads…')}</div>}
      {err && <div className="small error-text">{err}</div>}
      <div className="muted small">
        Lumbra’s Gigabase © Michael Jansen · CC BY-NC 4.0 ({L('μη εμπορική χρήση', 'non-commercial use')})
      </div>
      <div className="ref-own">
        <b>{L('Ή δική σου βάση', 'Or your own database')}</b>
        <div className="muted small">{L('Οποιαδήποτε βάση με πολλές παρτίδες, π.χ. η GreekBase (PGN, ChessBase .cbh/.cbv, Scid .si4).', 'Any database with many games, e.g. GreekBase (PGN, ChessBase .cbh/.cbv, Scid .si4).')}</div>
        <div className="ref-own-row">
          <select
            value={own.some((d) => d.id === refId) ? refId : ''}
            onChange={(e) => {
              const d = own.find((x) => x.id === e.target.value);
              if (d) setRef(d.id, d.name);
            }}
            aria-label={L('Βάση αναφοράς από τη Βιβλιοθήκη', 'Reference database from the library')}
          >
            <option value="" disabled>
              {L('— διάλεξε από τη Βιβλιοθήκη —', '— pick from the library —')}
            </option>
            {own.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {fmtNum(d.games)}
              </option>
            ))}
          </select>
          <button onClick={() => void openOwn()}>
            <FolderOpen size={15} /> {L('Άλλο αρχείο…', 'Other file…')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ImprovePreview {
  renames: Array<{ from: string; to: string; games: number; source: 'db' | 'ref'; kind: 'spelling' | 'complete' }>;
  ambiguous: number;
  elo: { sides: number; games: number; fromRef: number; sample: Array<{ id: number; side: 'w' | 'b'; elo: number; player: string; date: number; source: 'db' | 'ref' }> };
  fide: { players: number; games: number; sample: Array<{ player: string; fideId: string; source: 'db' | 'ref'; games: number }> };
}

/**
 * Βελτίωση βάσης (ImproveDB): ενοποίηση παραλλαγών ονομάτων και συμπλήρωση Elo / FIDE ID
 * από την ίδια τη βάση ή από βάση αναφοράς. Πρώτα ανάλυση και προεπισκόπηση, μετά εφαρμογή.
 */
export function ImproveDialog({ db, onClose }: { db: DbInfo; onClose: () => void }) {
  const library = useApp((s) => s.library);
  const jobs = useApp((s) => s.jobs);
  const toast = useApp((s) => s.toast);
  // όχι βάση που εισάγεται ακόμη (έχει ήδη παρτίδες, αλλά δεν διαβάζεται ως αναφορά πριν από το τέλος)
  const others = useMemo(() => library.filter((d) => d.id !== db.id && d.games > 0 && d.busy?.kind !== 'import').sort((a, b) => b.games - a.games), [library, db.id]);
  const [ref, setRef] = useState(() => others[0]?.id ?? '');
  const [o, setO] = useState({ names: true, elo: true, fide: true });
  const [step, setStep] = useState<'setup' | 'analysing' | 'preview' | 'applying'>('setup');
  const [jobId, setJobId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImprovePreview | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(() => new Set());
  const job = jobs.find((j) => j.id === jobId);

  useEffect(() => {
    if (!job || job.status === 'running') return;
    setJobId(null);
    if (job.status !== 'done') {
      if (job.status === 'error') reportError(new Error(job.error ?? 'Σφάλμα'));
      setStep(step === 'applying' ? 'preview' : 'setup');
      return;
    }
    if (step === 'analysing') {
      api
        .get<ImprovePreview>(`/api/improve/${job.id}`)
        .then((p) => {
          setPlanId(job.id);
          setPreview(p);
          setStep('preview');
        })
        .catch(reportError);
    } else if (step === 'applying') {
      toast(`${db.name}: ${job.progress.message ?? L('έγινε', 'done')}`, 'ok');
      onClose();
    }
  }, [job, step, db.name, toast, onClose]);

  const analyse = async () => {
    try {
      setJobId((await api.post<{ id: string }>(`/api/db/${db.id}/improve`, { reference: ref || null, ...o })).id);
      setStep('analysing');
    } catch (e) {
      reportError(e);
    }
  };

  const apply = async () => {
    if (!preview || !planId) return;
    const keep = preview.renames.filter((r) => !rejected.has(r.from));
    const what = L(
      `Αλλαγές στη «${db.name}»: ${fmtNum(keep.length)} μετονομασίες, Elo και FIDE ID όπου βρεθούν. Δεν αναιρούνται αυτόματα. Συνέχεια;`,
      `Changes to “${db.name}”: ${fmtNum(keep.length)} renames, Elo and FIDE IDs where found. They cannot be undone automatically. Continue?`,
    );
    if (!window.confirm(what)) return;
    try {
      setJobId((await api.post<{ id: string }>(`/api/improve/${planId}/apply`, { renames: keep.map((r) => r.from) })).id);
      setStep('applying');
    } catch (e) {
      reportError(e);
    }
  };

  const toggle = (from: string) =>
    setRejected((s) => {
      const n = new Set(s);
      if (n.has(from)) n.delete(from);
      else n.add(from);
      return n;
    });

  const busy = step === 'analysing' || step === 'applying';
  const src = (s: 'db' | 'ref') => (s === 'db' ? L('βάση', 'database') : L('αναφορά', 'reference'));
  const items: Array<[keyof typeof o, string]> = [
    ['names', L('Ενοποίηση ονομάτων παικτών (π.χ. «Banikas, H» → «Banikas, Hristos»)', 'Unify player names (e.g. “Banikas, H” → “Banikas, Hristos”)')],
    ['elo', L('Συμπλήρωση Elo που λείπει (το πιο κοντινό, ως 6 μήνες)', 'Fill in missing Elo (nearest, within 6 months)')],
    ['fide', L('Συμπλήρωση FIDE ID', 'Fill in FIDE IDs')],
  ];

  return (
    <Dialog
      title={L(`Βελτίωση βάσης — ${db.name}`, `Improve database — ${db.name}`)}
      onClose={busy ? () => {} : onClose}
      width={step === 'preview' ? 820 : 560}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            {L('Άκυρο', 'Cancel')}
          </button>
          {step === 'preview' ? (
            <button className="primary" onClick={() => void apply()} disabled={!preview || (!preview.renames.length && !preview.elo.sides && !preview.fide.players)}>
              {L('Εφαρμογή', 'Apply')}
            </button>
          ) : (
            <button className="primary" disabled={busy || !Object.values(o).some(Boolean)} onClick={() => void analyse()}>
              {L('Ανάλυση', 'Analyse')}
            </button>
          )}
        </>
      }
    >
      {(step === 'setup' || step === 'analysing') && (
        <>
          <Field label={L('Βάση αναφοράς (Elo, FIDE ID, γραφή ονομάτων)', 'Reference database (Elo, FIDE IDs, name spelling)')} wide>
            <select value={ref} disabled={busy} onChange={(e) => setRef(e.target.value)}>
              <option value="">{L('— καμία: μόνο η ίδια η βάση —', '— none: this database only —')}</option>
              {others.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({fmtNum(d.games)})
                </option>
              ))}
            </select>
          </Field>
          {items.map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={o[k]} disabled={busy} onChange={(e) => setO({ ...o, [k]: e.target.checked })} /> {label}
            </label>
          ))}
          <p className="muted small">{L('Η ανάλυση δεν αλλάζει τίποτα· θα δεις τις προτάσεις και θα διαλέξεις τι θα εφαρμοστεί.', 'The analysis changes nothing; you will see the proposals and choose what to apply.')}</p>
        </>
      )}
      {busy && job && (
        <Progress
          value={job.progress.totalBytes ? job.progress.games / job.progress.totalBytes : 0}
          label={`${job.progress.message ?? ''}${job.progress.totalBytes ? ` · ${fmtNum(job.progress.games)} / ${fmtNum(job.progress.totalBytes)}` : ''}`}
        />
      )}
      {step === 'preview' && preview && (
        <div className="improve-preview">
          <h3 className="sub">
            {L('Ενοποίηση ονομάτων', 'Name unification')} ({fmtNum(preview.renames.length - rejected.size)} / {fmtNum(preview.renames.length)})
            {preview.renames.length > 0 && (
              <span className="improve-all">
                <button className="small-btn" onClick={() => setRejected(new Set())}>
                  {L('Όλες', 'All')}
                </button>
                <button className="small-btn" onClick={() => setRejected(new Set(preview.renames.map((r) => r.from)))}>
                  {L('Καμία', 'None')}
                </button>
                <button className="small-btn" title={L('Κράτα μόνο τις συμπληρώσεις ονομάτων (αρχικά → πλήρες)', 'Keep only name completions (initials → full)')} onClick={() => setRejected(new Set(preview.renames.filter((r) => r.kind === 'spelling').map((r) => r.from)))}>
                  {L('Χωρίς αλλαγές γραφής', 'No spelling changes')}
                </button>
              </span>
            )}
          </h3>
          {preview.renames.length ? (
            <div className="improve-list">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th />
                    <th>{L('Από', 'From')}</th>
                    <th>{L('Σε', 'To')}</th>
                    <th className="num">{L('Παρτίδες', 'Games')}</th>
                    <th>{L('Πηγή', 'Source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.renames.map((r) => (
                    <tr key={r.from} className={rejected.has(r.from) ? 'muted' : ''}>
                      <td>
                        <input type="checkbox" checked={!rejected.has(r.from)} onChange={() => toggle(r.from)} />
                      </td>
                      <td>{r.from}</td>
                      <td>{r.to}</td>
                      <td className="num">{fmtNum(r.games)}</td>
                      <td>
                        {src(r.source)} · {r.kind === 'spelling' ? L('γραφή', 'spelling') : L('συμπλήρωση', 'completion')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">{o.names ? L('Δεν βρέθηκαν παραλλαγές.', 'No variants found.') : L('Δεν ζητήθηκε.', 'Not requested.')}</p>
          )}
          {preview.ambiguous > 0 && (
            <p className="muted small">
              {L(`${fmtNum(preview.ambiguous)} ελλιπή ονόματα ταιριάζουν σε περισσότερους από έναν παίκτες και μένουν ως έχουν.`, `${fmtNum(preview.ambiguous)} incomplete names match more than one player and are left as they are.`)}
            </p>
          )}

          <h3 className="sub">Elo</h3>
          <p className="small">
            {o.elo
              ? L(
                  `${fmtNum(preview.elo.sides)} συμπληρώσεις σε ${fmtNum(preview.elo.games)} παρτίδες (από την αναφορά: ${fmtNum(preview.elo.fromRef)}).`,
                  `${fmtNum(preview.elo.sides)} fills in ${fmtNum(preview.elo.games)} games (from the reference: ${fmtNum(preview.elo.fromRef)}).`,
                )
              : L('Δεν ζητήθηκε.', 'Not requested.')}
          </p>
          {preview.elo.sample.length > 0 && (
            <div className="improve-sample">
              {preview.elo.sample.slice(0, 8).map((e) => (
                <span key={`${e.id}${e.side}`}>
                  {e.player} · {fmtDate(e.date)} · <b>{e.elo}</b> <span className="muted">({src(e.source)})</span>
                </span>
              ))}
            </div>
          )}

          <h3 className="sub">FIDE ID</h3>
          <p className="small">
            {o.fide
              ? L(`${fmtNum(preview.fide.players)} παίκτες, ${fmtNum(preview.fide.games)} παρτίδες.`, `${fmtNum(preview.fide.players)} players, ${fmtNum(preview.fide.games)} games.`)
              : L('Δεν ζητήθηκε.', 'Not requested.')}
          </p>
          {preview.fide.sample.length > 0 && (
            <div className="improve-sample">
              {preview.fide.sample.slice(0, 8).map((f) => (
                <span key={f.player}>
                  {f.player} · <b>{f.fideId}</b> <span className="muted">({src(f.source)})</span>
                </span>
              ))}
            </div>
          )}
          <p className="muted small">
            {L('Το Elo και τα FIDE ID ξαναϋπολογίζονται στην εφαρμογή, με όσες ενοποιήσεις κράτησες.', 'Elo and FIDE IDs are recomputed when applying, with the unifications you kept.')}
          </p>
        </div>
      )}
    </Dialog>
  );
}
