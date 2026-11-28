/**
 * «Βιβλίο σε βάση»: ένα σκακιστικό βιβλίο σε PDF γίνεται νέα βάση στις Βάσεις, με όλες τις κινήσεις,
 * βαριάντες, υποβαριάντες και σχόλια, βέλη για τα πλάνα και κύκλους για τις αδυναμίες (server: books/import.ts).
 * Το PDF το διαλέγει το παράθυρο αρχείων του browser (ή σύρεται πάνω στο παράθυρο) και φορτώνεται στον τοπικό server.
 * Σχέδιο: mockups/book-screen.html (η πρώτη οθόνη με τα .kb-* του styles.css).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Check, ChevronRight, Database, FolderOpen, GitBranch, Info, Lock, ScanLine, Upload, X } from 'lucide-react';
import { ApiError, api, onServerEvent } from '../api.ts';
import { L, fmtBytes, fmtNum } from '../i18n.ts';
import { reportError, useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import type { BookIssue, BookLevel, BookVerdict } from '../../core/bookquality.ts';
import { ScanPack } from '../books/ScanPack.tsx';
import '../books/books.css';

interface BookStats {
  games: number;
  moves: number;
  variations: number;
  comments: number;
  nags: number;
  arrows: number;
  circles: number;
  unplaced: number;
  exercises?: number;
  solved?: number;
  diagrams?: number;
  verified?: number;
  ocrPages?: number;
}

interface BookImport {
  id: string;
  file: string;
  title: string;
  status: 'reading' | 'ocr' | 'parsing' | 'importing' | 'done' | 'error' | 'cancelled';
  page: number;
  pages: number;
  error?: string;
  stats?: BookStats;
  warnings?: Array<{ page: number; text: string }>;
  early?: 'scanned' | 'garbled';
  verdict?: BookVerdict;
  dbId?: string;
  jobId?: string;
  started: number;
}

/** Το μεγαλύτερο PDF που δέχεται ο server (`MAX_PDF` στο server/books/import.ts). */
const MAX_PDF = 512 * 1024 * 1024;

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isReading = (j: BookImport) => j.status === 'reading' || j.status === 'ocr' || j.status === 'parsing';

/** Το αρχείο που διάλεξε ή έσυρε ο χρήστης: PDF και μέσα στο όριο του server. */
function acceptPdf(f: File | undefined, set: (f: File) => void): void {
  if (!f) return;
  if (!isPdf(f)) reportError(new Error(L(`Το «${f.name}» δεν είναι PDF.`, `“${f.name}” is not a PDF.`)));
  else if (f.size > MAX_PDF) reportError(new Error(L(`Το PDF είναι πολύ μεγάλο (${fmtBytes(f.size)}· το όριο είναι 512 MB).`, `The PDF is too large (${fmtBytes(f.size)}; the limit is 512 MB).`)));
  else set(f);
}

/** Φόρτωση του PDF στον τοπικό server, με πρόοδο (το fetch δεν δίνει πρόοδο αποστολής). */
function uploadPdf(url: string, pdf: File, onProgress: (sent: number) => void, ref: { current: XMLHttpRequest | null }): Promise<{ job: BookImport }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    ref.current = x;
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'application/pdf');
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => {
      let data: { job?: BookImport; error?: string } | null = null;
      try {
        data = JSON.parse(x.responseText);
      } catch {
        /* όχι JSON */
      }
      if (x.status >= 200 && x.status < 300 && data?.job) resolve({ job: data.job });
      else reject(new ApiError(x.status, data?.error ?? `Σφάλμα ${x.status}`));
    };
    x.onerror = () =>
      reject(new Error(L('Το PDF δεν έφτασε στο Ruru. Έλεγξε ότι το αρχείο υπάρχει ακόμη και δοκίμασε ξανά.', 'The PDF did not reach Ruru. Check that the file still exists and try again.')));
    x.onabort = () => reject(new DOMException('cancelled', 'AbortError'));
    x.send(pdf);
  });
}

const STEPS = [
  { Icon: ScanLine, t: () => L('Διαβάζει τις σελίδες', 'Reads the pages'), d: () => L('Κείμενο, ή OCR στις σκαναρισμένες', 'Text, or OCR on scanned pages') },
  { Icon: GitBranch, t: () => L('Βρίσκει τις κινήσεις', 'Finds the moves'), d: () => L('Βαριάντες, σχόλια, διαγράμματα', 'Variations, comments, diagrams') },
  { Icon: Database, t: () => L('Φτιάχνει τη βάση', 'Builds the database'), d: () => L('Μία παρτίδα ανά κεφάλαιο', 'One game per chapter') },
];

export function BooksWindow({ active }: { active: boolean }) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [year, setYear] = useState('');
  const [shapes, setShapes] = useState(false);
  const [jobs, setJobs] = useState<BookImport[]>([]);
  /** πόσα bytes του PDF έφτασαν στον server (null: δεν φορτώνεται τίποτα) */
  const [sent, setSent] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ jobs: BookImport[] }>('/api/book/imports')
      .then((r) => alive && setJobs(r.jobs))
      .catch(() => {});
    const off = onServerEvent('bookImport', (j: BookImport) => setJobs((all) => [...all.filter((x) => x.id !== j.id), j]));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Σύρσιμο ενός PDF οπουδήποτε στο παράθυρο όσο φαίνεται αυτή η καρτέλα. Στις άλλες καρτέλες το αρχείο απλώς
  // δεν γίνεται δεκτό: χωρίς το preventDefault ο browser θα άνοιγε το PDF στη θέση της εφαρμογής.
  useEffect(() => {
    let depth = 0;
    const files = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const enter = (e: DragEvent) => {
      if (!active || !files(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!active || !files(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = active ? 'copy' : 'none';
    };
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const list = [...(e.dataTransfer?.files ?? [])];
      if (active) acceptPdf(list.find(isPdf) ?? list[0], setPdf);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      setDragging(false);
    };
  }, [active]);

  const start = async () => {
    if (!pdf) return;
    const file = pdf;
    setSent(0);
    try {
      const q = new URLSearchParams({ name: file.name, title, author, year, shapes: shapes ? '1' : '0' });
      const r = await uploadPdf(`/api/book/upload?${q}`, file, setSent, xhr);
      setJobs((all) => [...all.filter((x) => x.id !== r.job.id), r.job]);
      // το βιβλίο ξεκίνησε: η φόρμα κλείνει και φαίνεται η κάρτα της ανάγνωσης
      setPdf((p) => (p === file ? null : p));
      setTitle('');
      setAuthor('');
      setYear('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') reportError(e);
    } finally {
      xhr.current = null;
      setSent(null);
    }
  };

  const recent = useMemo(() => [...jobs].sort((a, b) => b.started - a.started), [jobs]);
  const running = recent.some((j) => isReading(j) || j.status === 'importing');
  const uploading = sent !== null;
  const pick = () => input.current?.click();
  const showDrop = !uploading && (dragging || (!pdf && !recent.length));
  const fresh = useMemo(() => new Set(jobs.filter((j) => j.status === 'done' && j.dbId).map((j) => j.dbId!)), [jobs]);

  // τα τρία βήματα δείχνουν πού είναι το πιο πρόσφατο βιβλίο: 0–2 το βήμα που τρέχει, 3 τελείωσε
  const newest = recent[0];
  const newestLib = useApp((s) => (newest?.jobId ? s.jobs.find((x) => x.id === newest.jobId) : undefined));
  const stage =
    pdf || !newest
      ? null
      : newest.status === 'reading' || newest.status === 'ocr'
        ? 0
        : newest.status === 'parsing'
          ? 1
          : newest.status === 'importing' || (newest.status === 'done' && newestLib?.status === 'running')
            ? 2
            : newest.status === 'done' && newestLib?.status !== 'error'
              ? 3
              : null;

  return (
    <div className="books" aria-hidden={!active}>
      <div className="books-page">
        <header className="books-head">
          <div className="kb-head with-ic">
            <span className="kb-head-ic" aria-hidden>
              <BookOpen size={28} />
            </span>
            <div>
              <h1 className="kb-title" data-guide="books">
                {L('Βιβλίο σε βάση', 'Book to database')} <span className="kb-pill">BETA</span>
              </h1>
              <p className="kb-sub">
                {L(
                  'Ένα σκακιστικό βιβλίο σε PDF γίνεται βάση στις Βάσεις: κινήσεις, βαριάντες, υποβαριάντες, σχόλια και διαγράμματα, μία παρτίδα ανά κεφάλαιο ή ενότητα.',
                  'A chess book in PDF becomes a database under Databases: moves, variations, sub-variations, comments and diagrams, one game per chapter or section.',
                )}
              </p>
            </div>
          </div>
          <details className="books-how">
            <summary>
              <Info aria-hidden />
              {L('Πώς δουλεύει;', 'How does it work?')}
            </summary>
            <div className="books-pop">
              <ul>
                <li>
                  <b>{L('Ψηφιακά PDF', 'Digital PDFs')}</b> {L('(με κανονικό κείμενο): υποστηρίζονται κυρίως αυτά και δίνουν το καλύτερο αποτέλεσμα.', '(with real text): these are mainly supported and give the best result.')}
                </li>
                <li>
                  <b>{L('Σκαναρισμένα', 'Scanned books')}</b>{' '}
                  {L(
                    'είναι πειραματικά: οι σελίδες διαβάζονται με OCR (πιο αργά, με περισσότερα λάθη) και τα διαγράμματα-εικόνες γίνονται θέσεις. Το αποτέλεσμα θα έχει κενά.',
                    'are experimental: the pages are read with OCR (slower, with more errors) and picture diagrams become positions. The result will have gaps.',
                  )}
                </li>
                <li>
                  <b>{L('Βιβλία ασκήσεων', 'Exercise books')}</b>
                  {L(
                    ': κάθε άσκηση γίνεται παρτίδα από τη θέση του διαγράμματος, με τη λύση από το τέλος του βιβλίου, και ανοίγει σε εκπαίδευση ώστε να μη βλέπεις τη λύση.',
                    ': every exercise becomes a game from the diagram position, with the solution from the back of the book, and opens in training so that the solution stays hidden.',
                  )}
                </li>
              </ul>
            </div>
          </details>
        </header>

        <div className="books-grid">
          <div className="books-main">
            <input
              ref={input}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(e) => {
                acceptPdf(e.target.files?.[0], setPdf);
                e.target.value = '';
              }}
            />

            {showDrop && (
              <div className={dragging ? 'kb-drop over' : 'kb-drop'}>
                <span className="kb-drop-ic">
                  <Upload size={30} aria-hidden />
                </span>
                <h2>{dragging ? L('Άφησε το PDF εδώ', 'Drop the PDF here') : L('Σύρε ένα PDF εδώ', 'Drag a PDF here')}</h2>
                <p>{L('ή', 'or')}</p>
                <button type="button" className="kb-btn primary lg" data-guide="books-pick" onClick={pick}>
                  <FolderOpen aria-hidden />
                  {L('Διάλεξε PDF…', 'Choose PDF…')}
                </button>
                <p className="kb-drop-hint">{L('Καλύτερα ψηφιακά PDF · τα σκαναρισμένα είναι πειραματικά', 'Digital PDFs work best · scanned ones are experimental')}</p>
                <ScanPack variant="hint" />
              </div>
            )}

            {pdf && !showDrop && (
              <section className="kb-card">
                <div className="books-row">
                  <span className="books-pdf">PDF</span>
                  <div className="books-bt">
                    <b title={pdf.name}>{pdf.name}</b>
                    <span>{fmtBytes(pdf.size)}</span>
                  </div>
                  <button type="button" className="kb-btn ghost" data-guide="books-pick" disabled={uploading} onClick={pick}>
                    {L('Αλλαγή', 'Change')}
                  </button>
                </div>
                <div className="books-form">
                  <div className="books-fields">
                    <label className="kb-field">
                      {L('Τίτλος', 'Title')}
                      <input className="kb-input" value={title} placeholder={L('από το PDF', 'from the PDF')} onChange={(e) => setTitle(e.target.value)} />
                    </label>
                    <label className="kb-field">
                      {L('Συγγραφέας', 'Author')}
                      <input className="kb-input" value={author} placeholder={L('από το PDF', 'from the PDF')} onChange={(e) => setAuthor(e.target.value)} />
                    </label>
                    <label className="kb-field">
                      {L('Έτος', 'Year')}
                      <input className="kb-input" inputMode="numeric" maxLength={4} value={year} placeholder="—" onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} />
                    </label>
                  </div>
                  <p className="books-note">{L('Όσα αφήσεις κενά συμπληρώνονται από το PDF.', 'Whatever you leave empty is taken from the PDF.')}</p>
                  <label className="kb-check books-opt">
                    <input type="checkbox" checked={shapes} onChange={(e) => setShapes(e.target.checked)} />
                    {L('Λίγα βέλη και κύκλοι, μόνο όπου το κείμενο λέει ρητά πλάνο ή αδυναμία', 'A few arrows and circles, only where the text names a plan or a weakness')}
                  </label>
                </div>
                {uploading ? (
                  <div className="books-foot">
                    <div className="books-prog">
                      <Bar value={pdf.size ? sent / pdf.size : 0} />
                      <div className="books-status">
                        <span>{L(`Φόρτωση του PDF: ${fmtBytes(sent)} από ${fmtBytes(pdf.size)}`, `Loading the PDF: ${fmtBytes(sent)} of ${fmtBytes(pdf.size)}`)}</span>
                      </div>
                    </div>
                    <button type="button" className="kb-btn ghost" onClick={() => xhr.current?.abort()}>
                      {L('Ακύρωση', 'Cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="books-foot">
                    <button type="button" className="kb-btn primary lg" disabled={running} onClick={() => void start()}>
                      <Database aria-hidden />
                      {L('Δημιουργία βάσης', 'Create database')}
                    </button>
                    <button type="button" className="kb-btn ghost" onClick={() => setPdf(null)}>
                      {L('Ακύρωση', 'Cancel')}
                    </button>
                    {running && <span className="books-wait">{L('Πρώτα πρέπει να τελειώσει το βιβλίο που διαβάζεται τώρα.', 'The book being read now has to finish first.')}</span>}
                  </div>
                )}
              </section>
            )}

            {recent.map((j, i) => (
              <ImportCard
                key={j.id}
                j={j}
                onNew={i === 0 && !pdf ? pick : undefined}
                onForget={() => {
                  void api.post(`/api/book/${j.id}/forget`, {}).catch(() => {});
                  setJobs((all) => all.filter((x) => x.id !== j.id));
                }}
              />
            ))}

            <ol className="kb-steps">
              {STEPS.map(({ Icon, t, d }, k) => (
                <li key={k} className={stage === null ? 'kb-step' : `kb-step ${k < stage ? 'done' : k === stage ? 'active' : 'wait'}`}>
                  <span className="kb-step-ic">
                    <Icon size={18} aria-hidden />
                  </span>
                  <div>
                    <b>{t()}</b>
                    <span>{d()}</span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="books-priv">
              <Lock aria-hidden />
              {L('Για βιβλία που έχεις ήδη: η βάση μένει μόνο στον υπολογιστή σου.', 'For books you already own: the database stays on your computer only.')}
            </p>
          </div>

          <Shelf fresh={fresh} />
        </div>
      </div>
    </div>
  );
}

/** Γραμμή προόδου· `null`: σε εξέλιξη χωρίς ποσοστό. */
function Bar({ value, ok }: { value: number | null; ok?: boolean }) {
  const v = value === null ? null : Math.max(0, Math.min(1, value));
  return (
    <div
      className={`kb-bar${ok ? ' ok' : ''}${v === null ? ' busy' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v === null ? undefined : Math.round(v * 100)}
    >
      <i style={{ width: v === null ? '100%' : `${v * 100}%` }} />
    </div>
  );
}

function ImportCard({ j, onForget, onNew }: { j: BookImport; onForget: () => void; onNew?: () => void }) {
  const libJob = useApp((s) => (j.jobId ? s.jobs.find((x) => x.id === j.jobId) : undefined));
  const db = useApp((s) => (j.dbId ? s.library.find((d) => d.id === j.dbId) : undefined));
  const openTab = useApp((s) => s.openTab);
  const reading = isReading(j);
  const importing = j.status === 'importing' || (j.status === 'done' && libJob?.status === 'running');
  const ready = j.status === 'done' && !importing && libJob?.status !== 'error';
  const failed = j.status === 'error' || libJob?.status === 'error';
  const st = j.stats;
  const name = j.title || baseName(j.file);

  // η πρόοδος της φάσης που τρέχει (null: χωρίς ποσοστό)
  let value: number | null = null;
  let label = '';
  if (j.status === 'reading') {
    value = j.pages ? j.page / j.pages : 0;
    label = j.pages ? L(`Ανάγνωση σελίδας ${j.page} από ${j.pages}`, `Reading page ${j.page} of ${j.pages}`) : L('Άνοιγμα του PDF…', 'Opening the PDF…');
  } else if (j.status === 'ocr') {
    value = j.pages ? j.page / j.pages : 0;
    label = L(`Αναγνώριση κειμένου (OCR): σελίδα ${j.page} από ${j.pages} χωρίς κανονικό κείμενο`, `Text recognition (OCR): page ${j.page} of ${j.pages} without proper text`);
  } else if (j.status === 'parsing') {
    label = L('Ανάλυση του κειμένου: κινήσεις, βαριάντες, σχόλια, διαγράμματα…', 'Analysing the text: moves, variations, comments, diagrams…');
  } else if (importing) {
    value = libJob && st ? libJob.progress.games / Math.max(1, st.games) : 0;
    label = L(`Αποθήκευση στη βάση: ${fmtNum(libJob?.progress.games ?? 0)} από ${fmtNum(st?.games ?? 0)} παρτίδες`, `Saving to the database: ${fmtNum(libJob?.progress.games ?? 0)} of ${fmtNum(st?.games ?? 0)} games`);
  }
  const sub = ready
    ? name
    : label || (failed ? L('Η βάση δεν φτιάχτηκε.', 'The database was not created.') : j.status === 'cancelled' ? L('Ακυρώθηκε.', 'Cancelled.') : '');

  const stats: Array<[number, string]> = st
    ? [
        [st.games, L('παρτίδες (κεφάλαια, ενότητες)', 'games (chapters, sections)')],
        ...(st.exercises
          ? ([[st.exercises, L(`ασκήσεις σε εκπαίδευση · ${fmtNum(st.solved ?? 0)} με τη λύση του βιβλίου`, `exercises in training · ${fmtNum(st.solved ?? 0)} with the book’s solution`)]] as Array<[number, string]>)
          : []),
        [st.moves, L('κινήσεις', 'moves')],
        [st.variations, L('βαριάντες', 'variations')],
        [st.comments, L('σχόλια', 'comments')],
        [st.nags, L('σύμβολα αξιολόγησης', 'evaluation symbols')],
        ...(st.diagrams
          ? ([[st.diagrams, L(`διαγράμματα-εικόνες · ${fmtNum(st.verified ?? 0)} επιβεβαιωμένα`, `picture diagrams · ${fmtNum(st.verified ?? 0)} confirmed`)]] as Array<[number, string]>)
          : []),
        ...(st.ocrPages ? ([[st.ocrPages, L('σελίδες με OCR', 'pages read with OCR')]] as Array<[number, string]>) : []),
        ...(st.arrows + st.circles > 0
          ? ([
              [st.arrows, L('βέλη πλάνων', 'plan arrows')],
              [st.circles, L('κύκλοι αδυναμιών', 'weakness circles')],
            ] as Array<[number, string]>)
          : []),
      ]
    : [];
  const showStats = st && (j.status === 'importing' || j.status === 'done');
  const early = j.early && !j.verdict && j.status !== 'cancelled';
  // βιβλίο που διαβάστηκε (ή διαβάζεται) με OCR: πρόταση για τον βελτιωμένο αναγνώστη, όσο λείπει
  const offer = Boolean(j.early || st?.ocrPages) && j.status !== 'cancelled';
  const errors = [j.status === 'error' ? j.error : undefined, libJob?.status === 'error' ? libJob.error : undefined].filter(Boolean);

  return (
    <section className="kb-card">
      <div className="books-row">
        {ready ? (
          <span className="books-okc">
            <Check size={22} aria-hidden />
          </span>
        ) : (
          <span className="books-pdf">PDF</span>
        )}
        <div className="books-bt">
          <b className={ready ? 'h2' : undefined} title={j.file}>
            {ready ? L('Η βάση είναι έτοιμη', 'The database is ready') : name}
          </b>
          {sub && <span>{sub}</span>}
        </div>
        {showStats && j.verdict && <span className={`kb-pill ${PILL[j.verdict.level]}`}>{LEVEL[j.verdict.level]()}</span>}
        {reading && (
          <button type="button" className="kb-btn" onClick={() => void api.post(`/api/book/${j.id}/cancel`, {}).catch(reportError)}>
            {L('Ακύρωση', 'Cancel')}
          </button>
        )}
        {!(reading || importing) && (
          <button type="button" className="kb-btn ghost icon" aria-label={L('Απόκρυψη', 'Dismiss')} title={L('Απόκρυψη', 'Dismiss')} onClick={onForget}>
            <X aria-hidden />
          </button>
        )}
      </div>

      {(reading || importing) && (
        <div className="books-prog">
          <Bar value={value} />
          <div className="books-status">
            <span>{value === null ? '' : `${Math.round(Math.min(1, value) * 100)}%`}</span>
            <span>{L('Μπορείς να δουλεύεις σε άλλη καρτέλα· η ανάγνωση συνεχίζει.', 'You can work in another tab; reading continues.')}</span>
          </div>
        </div>
      )}

      {(early || offer || errors.length > 0 || showStats) && (
        <div className="books-body">
          {early && (
            <p className="kb-callout warn" role="status">
              {j.early === 'scanned'
                ? L('Σκαναρισμένο βιβλίο: πειραματική ανάγνωση με OCR, το αποτέλεσμα θα έχει κενά.', 'Scanned book: experimental reading with OCR, the result will have gaps.')
                : L('Κακό κείμενο στο PDF (χαλασμένες κινήσεις): πειραματική ανάγνωση, το αποτέλεσμα θα έχει κενά.', 'Poor text in the PDF (garbled moves): experimental reading, the result will have gaps.')}
            </p>
          )}
          {offer && <ScanPack variant="offer" />}
          {errors.map((e, i) => (
            <p key={i} className="kb-callout danger" role="alert">
              {e}
            </p>
          ))}
          {showStats && st && (
            <>
              <div className="kb-stats" role="list">
                {stats.map(([n, l]) => (
                  <div key={l} className="kb-stat" role="listitem">
                    <b>{fmtNum(n)}</b>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
              {j.verdict && <Verdict v={j.verdict} />}
              {st.unplaced > 0 && (
                <details className="books-warn">
                  <summary>
                    {L(
                      `${fmtNum(st.unplaced)} κινήσεις δεν βρήκαν θέση στο δέντρο και έμειναν ως κείμενο μέσα στα σχόλια`,
                      `${fmtNum(st.unplaced)} moves did not fit in the tree and stayed as text in the comments`,
                    )}
                  </summary>
                  <p>
                    {L(
                      'Συνήθως πρόκειται για ασκήσεις με θέση που υπάρχει μόνο ως εικόνα στο βιβλίο ή για αναφορές σε άλλες γραμμές. Τίποτε δεν χάνεται: το κείμενο είναι στο σχόλιο της αντίστοιχης κίνησης.',
                      'Usually exercises whose position exists only as a picture in the book, or references to other lines. Nothing is lost: the text is in the comment of the corresponding move.',
                    )}
                  </p>
                  <ul>
                    {(j.warnings ?? []).map((w, i) => (
                      <li key={i}>
                        <span className="books-page-no">{L(`σ. ${w.page}`, `p. ${w.page}`)}</span> {w.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {((ready && j.dbId) || (onNew && !reading && !importing)) && (
        <div className="books-foot">
          {ready && j.dbId && (
            <button type="button" className="kb-btn primary lg" onClick={() => openTab({ id: `db-${j.dbId}`, kind: 'db', dbId: j.dbId!, title: db?.name ?? j.title })}>
              <Database aria-hidden />
              {L('Άνοιξε τη βάση', 'Open the database')}
            </button>
          )}
          {onNew && !reading && !importing && (
            <button type="button" className="kb-btn ghost" onClick={onNew}>
              {L('Νέο βιβλίο', 'New book')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const LEVEL: Record<BookLevel, () => string> = {
  good: () => L('Καλή ανάγνωση', 'Good reading'),
  partial: () => L('Μερική ανάγνωση', 'Partial reading'),
  experimental: () => L('Πειραματική ανάγνωση', 'Experimental reading'),
};
const PILL: Record<BookLevel, string> = { good: 'ok', partial: 'warn', experimental: 'danger' };
const ISSUE: Record<BookIssue, () => string> = {
  moves: () => L('αρκετές κινήσεις έμειναν εκτός δέντρου', 'many moves stayed out of the tree'),
  ocr: () => L('σελίδες διαβάστηκαν με OCR', 'pages were read with OCR'),
  diagrams: () => L('λίγα διαγράμματα-εικόνες επιβεβαιώθηκαν', 'few picture diagrams were confirmed'),
  text: () => L('χαλασμένο κείμενο κινήσεων στο PDF', 'garbled move text in the PDF'),
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Η ποιότητα κάτω από τα στατιστικά (το επίπεδο είναι στην κορυφή της κάρτας): ποσοστά, αιτίες, σελίδες με προβλήματα. */
function Verdict({ v }: { v: BookVerdict }) {
  const extra = [
    v.ocr >= 0.005 ? L(`σελίδες με OCR ${pct(v.ocr)}`, `pages with OCR ${pct(v.ocr)}`) : '',
    v.confirmed !== undefined ? L(`επιβεβαιωμένα διαγράμματα ${pct(v.confirmed)}`, `confirmed diagrams ${pct(v.confirmed)}`) : '',
    ...v.issues.map((i) => ISSUE[i]()),
  ].filter(Boolean);
  return (
    <div className="books-meter" role="status">
      <div className="books-status">
        <span>{L('Κινήσεις στο δέντρο', 'Moves in the tree')}</span>
        <b>{pct(v.placed)}</b>
      </div>
      <Bar value={v.placed} ok={v.level === 'good'} />
      {extra.length > 0 && <p className="books-quality">{extra.join(' · ')}</p>}
      {v.level !== 'good' && v.worst.length > 0 && (
        <p className="books-quality">
          {L('Σελίδες με τα περισσότερα προβλήματα: ', 'Pages with the most problems: ')}
          {v.worst.map((w) => L(`σ. ${w.page} (${w.count})`, `p. ${w.page} (${w.count})`)).join(', ')}
        </p>
      )}
    </div>
  );
}

const COVERS = ['#2b4c7e', '#3d5a80', '#7a2e3a', '#2f6b4f', '#9a6b1f', '#1f6f78'];
const SKIP = new Set(['the', 'a', 'an', 'of', 'on', 'and', 'with', 'for', 'to', 'in', 'pdf']);

/** Δύο αρχικά για το «εξώφυλλο» (χωρίς άρθρα). */
function initials(name: string): string {
  const words = name.match(/\p{L}+/gu) ?? [];
  const keep = words.filter((w) => !SKIP.has(w.toLowerCase()));
  return (keep.length ? keep : words)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function coverColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length];
}

/** «Τα βιβλία σου»: οι βάσεις της Βιβλιοθήκης που βγήκαν από PDF (origin: 'book'), οι νεότερες πρώτες. */
function Shelf({ fresh }: { fresh: Set<string> }) {
  const library = useApp((s) => s.library);
  const openTab = useApp((s) => s.openTab);
  const books = useMemo(() => library.filter((d) => d.origin === 'book').sort((a, b) => b.created - a.created), [library]);
  const all = () => {
    const ui = (useApp.getState().settings?.ui ?? {}) as Record<string, unknown>;
    setUiLater({ library: { ...((ui.library ?? {}) as Record<string, unknown>), filter: 'books' } });
    openTab({ id: 'library', kind: 'library', title: 'Βάσεις' });
  };
  return (
    <aside className="kb-card books-shelf" aria-label={L('Τα βιβλία σου', 'Your books')}>
      <div className="books-shelf-h">
        <h2>{L('Τα βιβλία σου', 'Your books')}</h2>
        {books.length > 0 && (
          <button type="button" className="kb-link" onClick={all}>
            {L('Όλα στις Βάσεις', 'All in Databases')}
            <ChevronRight aria-hidden />
          </button>
        )}
      </div>
      {books.length ? (
        <ul>
          {books.map((d) => (
            <li key={d.id}>
              <button type="button" className="books-item" onClick={() => openTab({ id: `db-${d.id}`, kind: 'db', dbId: d.id, title: d.name })}>
                <span className="books-cover" style={{ '--c': coverColor(d.name) } as CSSProperties} aria-hidden>
                  {initials(d.name)}
                </span>
                <span className="books-bt">
                  <b title={d.name}>{d.name}</b>
                  <span>{L(`${fmtNum(d.games)} παρτίδες`, `${fmtNum(d.games)} games`)}</span>
                </span>
                {fresh.has(d.id) ? <span className="kb-pill ok">{L('Νέο', 'New')}</span> : <ChevronRight className="books-chev" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="books-empty">{L('Οι βάσεις που φτιάχνεις από βιβλία θα εμφανίζονται εδώ.', 'The databases you make from books will appear here.')}</p>
      )}
    </aside>
  );
}
