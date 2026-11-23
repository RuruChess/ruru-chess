/**
 * Παράθυρο βάσεων: οι βάσεις του χρήστη (αναζήτηση, φίλτρα, ταξινόμηση, αγαπημένες, ετικέτες είδους), άνοιγμα
 * αρχείων, μικρή σκακιέρα που ανοίγει σκακιέρα, προεπισκόπηση βάσης με «Συνέχεια μελέτης», εισαγωγές σε εξέλιξη και
 * στη δεξιά στήλη οι Φίλοι (ή, με ένα κουμπί, τα αρχεία του υπολογιστή).
 */
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Plus, FilePlus2, Database, Star, Clipboard, FileText, Archive, MoreVertical, X, Folder, ChevronRight, HardDrive, Download, Search, PanelRightClose, PanelRightOpen, BookOpen, Users, Send } from 'lucide-react';
import { START_FEN } from '../../core/chess.ts';
import { api, pickFiles, type DbInfo, type JobInfo } from '../api.ts';
import { L, fmtBytes, fmtNum } from '../i18n.ts';
import { newTabId, reportError, useApp } from '../store.ts';
import { ContextMenu, Dialog, Field, Progress, type MenuItem } from '../components/ui.tsx';
import { BookDialog, ImproveDialog, ReferenceDownload, UnannotateDialog } from '../components/DbTools.tsx';
import { SupportButton, UpdateBanner } from '../components/About.tsx';
import { BOARD_THEMES, pieceUrl } from '../components/Board.tsx';
import { BIG_DB, LIB_FILTERS, LIB_SORTS, RECENT_DAYS, dbBadges, inFilter, visibleDbs, type BadgeKind, type LibFilter, type LibSort } from '../libraryView.ts';
import { useLastStudy } from '../study.ts';
import { LibraryPreview } from './LibraryPreview.tsx';
import { QuickSearch } from '../components/QuickSearch.tsx';
import { setUiLater } from '../tactics/store.ts';
import { FriendsPanel } from '../social/FriendsPanel.tsx';
import { openSend } from '../social/social.ts';
import { SOCIAL } from '../../core/features.ts';

interface FsEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
}

function DbIcon({ db }: { db: DbInfo }) {
  if (db.kind === 'mygames') return <Star size={28} />;
  if (db.kind === 'clipboard') return <Clipboard size={28} />;
  const k = db.source?.kind;
  if (k === 'pgn') return <FileText size={28} />;
  if (k === '7z' || k === 'zip') return <Archive size={28} />;
  return <Database size={28} />;
}

const FILTER_LABEL: Record<LibFilter, () => string> = {
  all: () => L('Όλες', 'All'),
  fav: () => L('Αγαπημένες ★', 'Favourites ★'),
  books: () => L('Βιβλία', 'Books'),
  big: () => L('Μεγάλες βάσεις (≥100k)', 'Large databases (≥100k)'),
  recent: () => L('Πρόσφατες', 'Recent'),
};
const FILTER_TIP: Record<LibFilter, () => string> = {
  all: () => L('Όλες οι βάσεις', 'All databases'),
  fav: () => L('Όσες σημείωσες με το αστέρι', 'Those you marked with the star'),
  books: () => L('Βάσεις από το «Βιβλίο σε βάση»', 'Databases made with “Book to database”'),
  big: () => L(`Με ${fmtNum(BIG_DB)} παρτίδες και πάνω`, `With ${fmtNum(BIG_DB)} games or more`),
  recent: () => L(`Όσες άνοιξες τις τελευταίες ${RECENT_DAYS} μέρες`, `Those you opened in the last ${RECENT_DAYS} days`),
};
const SORT_LABEL: Record<LibSort, () => string> = {
  recent: () => L('Πρόσφατο άνοιγμα', 'Recently opened'),
  name: () => L('Όνομα', 'Name'),
  games: () => L('Πλήθος παρτίδων', 'Number of games'),
};
const BADGE: Record<BadgeKind, () => string> = {
  reference: () => L('Αναφορά', 'Reference'),
  book: () => L('Βιβλίο', 'Book'),
  mygames: () => L('Οι παρτίδες μου', 'My games'),
  clipboard: () => L('Πρόχειρο', 'Clipboard'),
};

/** Οι επιλογές της σελίδας που μένουν (ui.library): φίλτρο, ταξινόμηση, δεξιά στήλη, προεπισκόπηση. */
interface LibraryPrefs {
  filter?: LibFilter;
  sort?: LibSort;
  /** η δεξιά στήλη φαίνεται */
  files?: boolean;
  /** τι δείχνει: Φίλοι (προεπιλογή) ή αρχεία του υπολογιστή */
  side?: 'friends' | 'files';
  /** η προεπισκόπηση βάσης κάτω από τις κάρτες */
  preview?: 'open' | 'collapsed' | 'closed';
  /** το «Καλώς ήρθες» (πρόταση για βάση αναφοράς) κλείστηκε */
  welcomeOff?: boolean;
}

/** Μικρή σκακιέρα με την αρχική θέση, στα χρώματα και τα κομμάτια των ρυθμίσεων (το κουμπί «Σκακιέρα»). */
function BoardThumb() {
  const settings = useApp((st) => st.settings);
  const theme = BOARD_THEMES[settings?.boardTheme ?? 'classic'] ?? BOARD_THEMES.classic;
  const set = settings?.pieceSet ?? 'cburnett';
  const cells: Array<{ key: string; dark: boolean; piece: number }> = [];
  START_FEN.split(' ')[0]
    .split('/')
    .forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) {
          for (let i = 0; i < Number(ch); i++, f++) cells.push({ key: `${r}${f}`, dark: (r + f) % 2 === 1, piece: 0 });
        } else {
          cells.push({ key: `${r}${f}`, dark: (r + f) % 2 === 1, piece: ' PNBRQK'.indexOf(ch.toUpperCase()) + (ch === ch.toLowerCase() ? 8 : 0) });
          f++;
        }
      }
    });
  return (
    <span className="board-thumb" aria-hidden>
      {cells.map((c) => (
        <span key={c.key} style={{ background: c.dark ? theme.dark : theme.light }}>
          {c.piece > 0 && <img src={pieceUrl(set, c.piece)} alt="" draggable={false} />}
        </span>
      ))}
    </span>
  );
}

function JobLine({ job }: { job: JobInfo }) {
  const p = job.progress;
  const frac = p.existing ? p.existing.done / Math.max(1, p.existing.total) : p.totalBytes ? p.bytes / p.totalBytes : 0;
  const label =
    p.phase === 'indexing'
      ? p.message ?? L('Ευρετήριο…', 'Indexing…')
      : p.existing
      ? L(`Οι παρτίδες της βάσης στο ευρετήριο: ${fmtNum(p.existing.done)} / ${fmtNum(p.existing.total)}`, `Database games into the index: ${fmtNum(p.existing.done)} / ${fmtNum(p.existing.total)}`)
      : `${fmtNum(p.games)} ${L('παρτίδες', 'games')}${p.totalBytes > 1000 ? ` · ${Math.round(frac * 100)}%` : ''}`;
  return (
    <div className="job-line">
      <Progress value={p.phase === 'indexing' ? 1 : frac} label={label} />
      <button className="icon-btn" title={L('Ακύρωση', 'Cancel')} onClick={() => void api.post(`/api/jobs/${job.id}/cancel`)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function LibraryWindow() {
  const library = useApp((s) => s.library);
  const jobs = useApp((s) => s.jobs);
  const openTab = useApp((s) => s.openTab);
  const refresh = useApp((s) => s.refreshLibrary);
  const toast = useApp((s) => s.toast);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [quick, setQuick] = useState<Array<{ name: string; path: string }>>([]);
  const [folder, setFolder] = useState<{ dir: string; parent: string | null; entries: FsEntry[] } | null>(null);
  const [rename, setRename] = useState<DbInfo | null>(null);
  const [tool, setTool] = useState<{ kind: 'book' | 'unannotate' | 'improve'; db: DbInfo } | null>(null);
  const [refDialog, setRefDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const settings = useApp((s) => s.settings);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const prefs = (ui.library ?? {}) as LibraryPrefs;
  const filter: LibFilter = LIB_FILTERS.includes(prefs.filter as LibFilter) ? (prefs.filter as LibFilter) : 'all';
  const sort: LibSort = LIB_SORTS.includes(prefs.sort as LibSort) ? (prefs.sort as LibSort) : 'recent';
  const filesOpen = prefs.files !== false;
  const side = !SOCIAL || prefs.side === 'files' ? 'files' : 'friends';
  const setPrefs = (p: LibraryPrefs) => setUiLater({ library: { ...prefs, ...p } });
  const favorites = Array.isArray(ui.libraryFavorites) ? (ui.libraryFavorites as string[]) : [];
  const toggleFavorite = (db: DbInfo) => setUiLater({ libraryFavorites: favorites.includes(db.id) ? favorites.filter((x) => x !== db.id) : [...favorites, db.id] });
  const referenceDb = (ui.referenceDb as string | undefined) || null;
  const [q, setQ] = useState('');
  const study = useLastStudy();
  // η βάση της προεπισκόπησης: αυτή που πάτησες, αλλιώς αυτή που μελετούσες
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewMode = prefs.preview ?? 'open';
  // κάθε φορά που φαίνεται η σελίδα: νέα λίστα (π.χ. η βάση που μόλις άνοιξε μετρά στις «Πρόσφατες»)
  const shownNow = useApp((s) => s.active === 'library');
  useEffect(() => {
    if (shownNow) void refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownNow]);

  useEffect(() => {
    api.get<Array<{ name: string; path: string }>>('/api/fs/quick').then((q) => {
      setQuick(q);
      const chess = q.find((x) => /σκακι|σκάκι|chess/i.test(x.name)) ?? q[0];
      if (chess) void browse(chess.path);
    }).catch(() => {});
  }, []);

  const browse = async (dir: string) => {
    try {
      setFolder(await api.get(`/api/fs/list?dir=${encodeURIComponent(dir)}`));
    } catch (e) {
      reportError(e);
    }
  };

  const openDb = (db: DbInfo) => openTab({ id: `db-${db.id}`, kind: 'db', dbId: db.id, title: db.name });

  const openPaths = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const r = await api.post<{ opened: Array<{ entry: DbInfo; job: JobInfo | null }> }>('/api/library/open', { paths });
      await refresh();
      for (const o of r.opened) {
        if (o.job) {
          sessionStorage.setItem(`open-${o.job.id}`, '1');
          toast(L(`Εισαγωγή «${o.entry.name}»… θα ανοίξει όταν τελειώσει.`, `Importing “${o.entry.name}”… it will open when done.`));
        }
        else openTab({ id: `db-${o.entry.id}`, kind: 'db', dbId: o.entry.id, title: o.entry.name });
      }
    } catch (e) {
      reportError(e);
    }
  };

  // Όταν τελειώσει μια εισαγωγή: η βάση ανοίγει μόνο αν την ξεκίνησε αυτό το παράθυρο· για όσες
  // είδε να τρέχουν (π.χ. λήψη βάσης αναφοράς) μόνο μήνυμα. Εργασίες που είχαν ήδη τελειώσει όταν
  // άνοιξε το παράθυρο αγνοούνται (αλλιώς κάθε νέο παράθυρο ξανάνοιγε τη βάση).
  const watching = useRef(new Set<string>());
  useEffect(() => {
    for (const j of jobs) {
      if (j.status === 'running') {
        watching.current.add(j.id);
        continue;
      }
      const mine = sessionStorage.getItem(`open-${j.id}`) !== null;
      if (!mine && !watching.current.has(j.id)) continue;
      if (j.kind === 'import' && j.status === 'done') {
        const db = library.find((d) => d.id === j.dbId);
        if (!db) continue; // ξανά όταν ανανεωθεί η λίστα
        toast(L(`Έτοιμο: ${db.name} (${fmtNum(j.progress.games)} παρτίδες)`, `Done: ${db.name} (${fmtNum(j.progress.games)} games)`), 'ok');
        if (mine) openDb(db);
      } else if (j.kind === 'convert' && j.status === 'done') {
        toast(L(`Η βάση μετατράπηκε στη νέα μορφή: ${j.progress.message ?? ''}`, `Database converted to the new format: ${j.progress.message ?? ''}`), 'ok');
      } else if (j.status === 'error') toast(j.error ?? L('Σφάλμα εισαγωγής', 'Import error'), 'error');
      watching.current.delete(j.id);
      sessionStorage.removeItem(`open-${j.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, library]);

  const dbMenu = (db: DbInfo, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: L('Άνοιγμα', 'Open'), onClick: () => openDb(db) },
        { label: favorites.includes(db.id) ? L('Αφαίρεση από τις αγαπημένες', 'Remove from favourites') : L('Στις αγαπημένες ★', 'Add to favourites ★'), onClick: () => toggleFavorite(db) },
        { label: L('Μετονομασία…', 'Rename…'), onClick: () => setRename(db) },
        // οποιαδήποτε βάση (π.χ. GreekBase) για την καρτέλα «Αναφορά» (δέντρο και παρτίδες της θέσης)
        referenceDb === db.id
          ? { label: L('✓ Βάση αναφοράς', '✓ Reference database'), onClick: () => {}, disabled: true }
          : {
              label: L('Ορισμός ως βάση αναφοράς', 'Set as reference database'),
              onClick: () => {
                setUiLater({ referenceDb: db.id });
                toast(L(`Η «${db.name}» είναι τώρα η βάση αναφοράς (καρτέλα «Αναφορά»).`, `“${db.name}” is now the reference database (“Reference” tab).`), 'ok');
              },
              disabled: !db.games || db.busy?.kind === 'import',
            },
        {
          label: L('Εισαγωγή αρχείου σε αυτή τη βάση…', 'Import a file into this database…'),
          onClick: async () => {
            const paths = await pickFiles('open');
            if (paths[0]) await api.post(`/api/library/${db.id}/import`, { path: paths[0] }).catch(reportError);
            void refresh();
          },
        },
        { label: L('Ανακατασκευή ευρετηρίου θέσεων', 'Rebuild position index'), onClick: () => void api.post(`/api/library/${db.id}/reindex`).catch(reportError) },
        // βάσεις ως την 2.2.0: μικρότερο αρχείο με λεξικό ετικετών, μόνο όταν το ζητήσει ο χρήστης
        ...(db.format === 1
          ? [
              {
                label: L('Μετατροπή στη νέα μορφή (μικρότερο αρχείο)…', 'Convert to the new format (smaller file)…'),
                disabled: Boolean(db.busy),
                onClick: async () => {
                  const ok = window.confirm(
                    L(
                      `Μετατροπή της «${db.name}» στη νέα μορφή; Οι ετικέτες γράφονται με λεξικό και το αρχείο μικραίνει. Το παλιό αρχείο μένει δίπλα ως αντίγραφο ασφαλείας (.bak)· σβήσ' το όταν δεις ότι όλα είναι εντάξει. Μετά τη μετατροπή η βάση δεν ανοίγει σωστά σε παλαιότερες εκδόσεις (έως 2.2.0).`,
                      `Convert “${db.name}” to the new format? Tags are stored in a dictionary and the file gets smaller. The old file stays next to it as a backup (.bak); delete it once everything looks fine. After the conversion the database does not open correctly in older versions (up to 2.2.0).`,
                    ),
                  );
                  if (!ok) return;
                  await api.post(`/api/library/${db.id}/convert`).catch(reportError);
                  void refresh();
                },
              },
            ]
          : []),
        // όσο εισάγεται η βάση έχει ήδη παρτίδες, αλλά αυτά θέλουν ολόκληρη τη βάση και το ευρετήριό της
        { label: L('Εκπαίδευση ανοιγμάτων…', 'Opening training…'), onClick: () => openTab({ id: newTabId('train'), kind: 'trainer', title: L('Εκπαίδευση', 'Training'), dbId: db.id }), disabled: !db.games || Boolean(db.busy) },
        { label: L('Δημιουργία βιβλίου Polyglot…', 'Create Polyglot book…'), onClick: () => setTool({ kind: 'book', db }), disabled: !db.games || Boolean(db.busy) },
        { label: L('Βελτίωση βάσης (ονόματα, Elo, FIDE ID)…', 'Improve database (names, Elo, FIDE IDs)…'), onClick: () => setTool({ kind: 'improve', db }), disabled: !db.games || Boolean(db.busy) },
        { label: L('Αφαίρεση σχολιασμού…', 'Remove annotations…'), onClick: () => setTool({ kind: 'unannotate', db }), disabled: !db.games || Boolean(db.busy), danger: true },
        { label: L('Εμφάνιση στον φάκελο', 'Show in folder'), onClick: () => void api.post('/api/open-folder', { path: db.file }) },
        ...(SOCIAL ? [{ label: L('Αποστολή σε φίλο ή ομάδα…', 'Send to a friend or team…'), onClick: () => openSend({ dbId: db.id }), disabled: !db.games || db.busy?.kind === 'import' }] : []),
        { separator: true, label: '' },
        {
          label: L('Αφαίρεση από τη λίστα', 'Remove from list'),
          onClick: async () => {
            await api.post(`/api/library/${db.id}/remove`, { deleteFiles: false }).catch(reportError);
            void refresh();
          },
        },
        {
          label: L('Διαγραφή βάσης (και αρχείων)', 'Delete database (and files)'),
          danger: true,
          disabled: db.kind === 'mygames',
          onClick: async () => {
            if (!window.confirm(L(`Οριστική διαγραφή της βάσης «${db.name}»; (Το αρχικό αρχείο PGN/ChessBase δεν πειράζεται.)`, `Delete database “${db.name}” permanently? (The original PGN/ChessBase file is not touched.)`))) return;
            await api.post(`/api/library/${db.id}/remove`, { deleteFiles: true }).catch(reportError);
            void refresh();
          },
        },
      ],
    });

  const now = Date.now();
  const ctx = { favorites, now };
  const shown = visibleDbs(library, q, filter, sort, ctx);
  const countOf = (f: LibFilter) => library.filter((d) => inFilter(d, f, ctx)).length;
  const runningJobs = jobs.filter((j) => j.status === 'running');
  // «Συνέχεια μελέτης»: μόνο αν η βάση της παρτίδας υπάρχει ακόμη
  const studyDb = study ? library.find((d) => d.id === study.dbId) : undefined;
  const previewDb = library.find((d) => d.id === (previewId ?? studyDb?.id)) ?? null;

  return (
    <div className="library-window">
      <div className="toolbar big">
        <button
          className="primary"
          title={L('PGN, ChessBase (.cbh, .cbv), Scid (.si4), .7z/.zip με PGN ή Scid, βάσεις Ruru (.kbdb)', 'PGN, ChessBase (.cbh, .cbv), Scid (.si4), .7z/.zip with PGN or Scid, Ruru databases (.kbdb)')}
          onClick={async () => {
            try {
              await openPaths(await pickFiles('open', { initialDir: folder?.dir }));
            } catch (e) {
              reportError(e);
            }
          }}
        >
          <FolderOpen size={18} /> {L('Άνοιγμα αρχείου…', 'Open file…')}
        </button>
        <button data-guide="new-db" onClick={() => setCreating(true)}>
          <Plus size={18} /> {L('Νέα βάση', 'New database')}
        </button>
        <button data-guide="new-game" onClick={() => openTab({ id: newTabId('game'), kind: 'game', title: L('Νέα παρτίδα', 'New game'), fen: START_FEN })}>
          <FilePlus2 size={18} /> {L('Νέα παρτίδα', 'New game')}
        </button>
        <button
          className="board-tile"
          onClick={() => openTab({ id: newTabId('game'), kind: 'game', title: L('Σκακιέρα', 'Board'), pgn: `[Event "${L('Σκακιέρα', 'Board')}"]\n\n*\n` })}
          title={L('Σκακιέρα: άνοιξε μια σκακιέρα για ανάλυση ή για να στήσεις μια θέση', 'Board: open a board for analysis or to set up a position')}
          aria-label={L('Σκακιέρα', 'Board')}
        >
          <BoardThumb />
        </button>
        <QuickSearch />
        <button onClick={() => setRefDialog(true)} title={L('Λήψη βάσης αναφοράς (Lumbra’s Gigabase)', 'Download a reference database (Lumbra’s Gigabase)')}>
          <Download size={18} /> {L('Βάση αναφοράς', 'Reference database')}
        </button>
        <span className="spacer" />
        <SupportButton />
      </div>

      <UpdateBanner />


      {/* νέα εγκατάσταση (χωρίς μεγάλη βάση): πρόταση για βάση αναφοράς */}
      {!prefs.welcomeOff && !library.some((d) => d.games >= 100_000 || d.busy?.kind === 'import') && (
        <section className="welcome-card">
          <button className="icon-btn welcome-x" onClick={() => setPrefs({ welcomeOff: true })} title={L('Κλείσιμο (η βάση αναφοράς κατεβαίνει και αργότερα από το «Βάση αναφοράς»)', 'Close (you can download a reference database later from “Reference database”)')} aria-label={L('Κλείσιμο', 'Close')}>
            <X size={16} />
          </button>
          <h3>{L('Καλώς ήρθες στο Ruru!', 'Welcome to Ruru!')}</h3>
          <p className="small">
            {L(
              'Για την «Αναφορά» (δέντρο ανοιγμάτων και παρτίδες κάθε θέσης) χρειάζεται μια μεγάλη βάση παρτίδων. Κατέβασε μία δωρεάν — τη μικρή αν δεν θέλεις να πιάσει πολύ χώρο:',
              'The “Reference” (opening tree and games of each position) needs a large game database. Download a free one — the small one if you want to save disk space:',
            )}
          </p>
          <ReferenceDownload />
        </section>
      )}

      <div className="library-body">
        <div className="db-main">
          <div className="lib-filters">
            <div className="lib-search">
              <Search size={15} aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder={L('Αναζήτηση βάσης…', 'Search databases…')} aria-label={L('Αναζήτηση βάσης', 'Search databases')} />
              {q && (
                <button className="icon-btn" title={L('Καθαρισμός', 'Clear')} aria-label={L('Καθαρισμός', 'Clear')} onClick={() => setQ('')}>
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="lib-chips" role="group" aria-label={L('Φίλτρα', 'Filters')}>
              {LIB_FILTERS.map((f) => (
                <button key={f} className={`lib-chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} title={FILTER_TIP[f]()} onClick={() => setPrefs({ filter: f })}>
                  {FILTER_LABEL[f]()} <span className="n">{fmtNum(countOf(f))}</span>
                </button>
              ))}
            </div>
            <span className="spacer" />
            <label className="lib-sort">
              {L('Ταξινόμηση', 'Sort')}
              <select value={sort} onChange={(e) => setPrefs({ sort: e.target.value as LibSort })}>
                {LIB_SORTS.map((x) => (
                  <option key={x} value={x}>
                    {SORT_LABEL[x]()}
                  </option>
                ))}
              </select>
            </label>
            <button className="lib-files-toggle" data-guide="friends-toggle" aria-pressed={filesOpen} title={filesOpen ? L('Απόκρυψη της δεξιάς στήλης', 'Hide the right column') : L('Εμφάνιση της δεξιάς στήλης', 'Show the right column')} onClick={() => setPrefs({ files: !filesOpen })}>
              {filesOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              {!filesOpen && (SOCIAL ? L('Φίλοι', 'Friends') : L('Αρχεία', 'Files'))}
            </button>
          </div>
        <section className="db-grid">
          {!shown.length && (
            <div className="lib-empty muted">
              {q
                ? L(`Καμία βάση με «${q}»${filter !== 'all' ? ` στις «${FILTER_LABEL[filter]()}»` : ''}.`, `No database matching “${q}”${filter !== 'all' ? ` in “${FILTER_LABEL[filter]()}”` : ''}.`)
                : filter === 'fav'
                  ? L('Καμία αγαπημένη ακόμη: πάτα το ☆ σε μια κάρτα.', 'No favourites yet: click the ☆ on a card.')
                  : L('Καμία βάση εδώ.', 'No databases here.')}{' '}
              {(q || filter !== 'all') && (
                <button
                  className="link-btn"
                  onClick={() => {
                    setQ('');
                    setPrefs({ filter: 'all' });
                  }}
                >
                  {L('Όλες οι βάσεις', 'All databases')}
                </button>
              )}
            </div>
          )}
          {shown.map((db) => {
            const job = runningJobs.find((j) => j.dbId === db.id) ?? db.busy;
            const fav = favorites.includes(db.id);
            const badges = dbBadges(db, referenceDb);
            return (
              <div
                key={db.id}
                className={`db-card ${db.kind}${job ? ' busy' : ''}${previewDb?.id === db.id && previewMode !== 'closed' ? ' selected' : ''}`}
                onClick={() => {
                  setPreviewId(db.id);
                  if (previewMode !== 'open') setPrefs({ preview: 'open' });
                }}
                // και όσο εισάγεται: η λίστα δείχνει τις παρτίδες που έχουν ήδη μπει
                onDoubleClick={() => job?.kind !== 'convert' && openDb(db)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  dbMenu(db, e.clientX, e.clientY);
                }}
              >
                <div className="db-icon">
                  <DbIcon db={db} />
                </div>
                <div className="db-info">
                  <div className="db-name" title={db.file}>
                    {db.name}
                  </div>
                  {badges.length > 0 && (
                    <div className="db-badges">
                      {badges.map((b) => (
                        <span key={b} className={`db-badge ${b}`}>
                          {b === 'book' && <BookOpen size={11} aria-hidden />}
                          {b === 'reference' && <Database size={11} aria-hidden />}
                          {BADGE[b]()}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="db-meta">
                    {job && job.kind === 'import' ? L('εισαγωγή…', 'importing…') : job && job.kind === 'convert' ? L('μετατροπή…', 'converting…') : `${fmtNum(db.games)} ${L('παρτίδες', 'games')}`} · {fmtBytes(db.size)}
                    {db.indexStale && !job ? ` · ${L('ευρετήριο σε αναμονή', 'index pending')}` : ''}
                  </div>
                  {db.source && (
                    <div className="db-source" title={db.source.path}>
                      {L('από', 'from')} {db.source.path.split(/[\\/]/).slice(-2).join('\\')}
                    </div>
                  )}
                  {job && <JobLine job={job as JobInfo} />}
                </div>
                <div className="db-actions">
                  <div className="db-actions-top">
                    <button className={`icon-btn db-fav${fav ? ' on' : ''}`} aria-pressed={fav} onClick={() => toggleFavorite(db)} title={fav ? L('Αγαπημένη: πάτα για αφαίρεση', 'Favourite: click to remove') : L('Στις αγαπημένες', 'Add to favourites')}>
                      <Star size={15} fill={fav ? 'currentColor' : 'none'} />
                    </button>
                    {SOCIAL && <button className="icon-btn db-send" disabled={!db.games || db.busy?.kind === 'import'} onClick={() => openSend({ dbId: db.id })} title={L('Αποστολή σε φίλο ή ομάδα…', 'Send to a friend or team…')} aria-label={L('Αποστολή σε φίλο ή ομάδα', 'Send to a friend or team')}>
                      <Send size={15} />
                    </button>}
                    <button className="icon-btn" onClick={(e) => dbMenu(db, e.clientX, e.clientY)} title={L('Περισσότερα', 'More')}>
                      <MoreVertical size={16} />
                    </button>
                  </div>
                  <button disabled={job?.kind === 'convert'} onClick={() => openDb(db)}>
                    {L('Άνοιγμα', 'Open')}
                  </button>
                </div>
              </div>
            );
          })}
        </section>
          {previewMode !== 'closed' && (previewDb || studyDb) && (
            <LibraryPreview
              db={previewDb}
              study={study}
              studyDb={studyDb ?? null}
              collapsed={previewMode === 'collapsed'}
              onCollapse={(c) => setPrefs({ preview: c ? 'collapsed' : 'open' })}
              onClose={() => setPrefs({ preview: 'closed' })}
              onOpenDb={openDb}
            />
          )}
        </div>

        {filesOpen && (
        <aside className="files-side">
          <h3>
            <span data-guide={side === 'friends' ? 'friends' : undefined}>
              {side === 'friends' ? L('Φίλοι', 'Friends') : L('Αρχεία στον υπολογιστή', 'Files on this computer')}
            </span>
            <span className="side-btns">
              {SOCIAL && <button
                className="side-switch"
                title={side === 'friends' ? L('Αρχεία στον υπολογιστή (άνοιγμα βάσεων)', 'Files on this computer (open databases)') : L('Πίσω στους Φίλους', 'Back to Friends')}
                onClick={() => setPrefs({ side: side === 'friends' ? 'files' : 'friends' })}
              >
                {side === 'friends' ? <Folder size={13} /> : <Users size={13} />}
                {side === 'friends' ? L('Αρχεία', 'Files') : L('Φίλοι', 'Friends')}
              </button>}
              <button className="icon-btn" title={L('Απόκρυψη της στήλης', 'Hide the column')} aria-label={L('Απόκρυψη της στήλης', 'Hide the column')} onClick={() => setPrefs({ files: false })}>
                <PanelRightClose size={15} />
              </button>
            </span>
          </h3>
          {side === 'friends' && <FriendsPanel />}
          {side === 'files' && (
          <div className="quick-folders">
            {quick.map((q) => (
              <button key={q.path} className={folder?.dir === q.path ? 'on' : ''} onClick={() => void browse(q.path)}>
                <Folder size={14} /> {q.name}
              </button>
            ))}
            <button onClick={() => void browse('')}>
              <HardDrive size={14} /> {L('Δίσκοι', 'Drives')}
            </button>
          </div>
          )}
          {side === 'files' && folder && (
            <div className="file-list">
              <div className="file-path">
                {folder.parent !== null && (
                  <button className="link-btn" onClick={() => void browse(folder.parent ?? '')}>
                    ..
                  </button>
                )}
                <span title={folder.dir}>{folder.dir || L('Δίσκοι', 'Drives')}</span>
              </div>
              {folder.entries.map((e) => (
                <div key={e.path} className={`file-row${e.dir ? ' dir' : ''}`} onClick={() => (e.dir ? void browse(e.path) : void openPaths([e.path]))} title={e.dir ? '' : L('Κλικ για άνοιγμα', 'Click to open')}>
                  {e.dir ? <Folder size={14} /> : /\.(7z|zip)$/i.test(e.name) ? <Archive size={14} /> : /\.(cbh|si4)$/i.test(e.name) ? <Database size={14} /> : <FileText size={14} />}
                  <span className="fname">{e.name}</span>
                  {!e.dir && <span className="fsize">{fmtBytes(e.size)}</span>}
                  {e.dir && <ChevronRight size={14} />}
                </div>
              ))}
              {!folder.entries.length && <div className="muted small pad">{L('Δεν υπάρχουν βάσεις σκακιού εδώ', 'No chess databases here')}</div>}
            </div>
          )}
        </aside>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {creating && (
        <Dialog
          title={L('Νέα βάση', 'New database')}
          onClose={() => setCreating(false)}
          footer={
            <button
              className="primary"
              disabled={!newName.trim()}
              onClick={async () => {
                try {
                  const r = await api.post<{ entry: DbInfo }>('/api/library/new', { name: newName.trim() });
                  setCreating(false);
                  setNewName('');
                  await refresh();
                  openTab({ id: `db-${r.entry.id}`, kind: 'db', dbId: r.entry.id, title: r.entry.name });
                } catch (e) {
                  reportError(e);
                }
              }}
            >
              {L('Δημιουργία', 'Create')}
            </button>
          }
        >
          <Field label={L('Όνομα', 'Name')} wide>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={L('π.χ. Το ρεπερτόριό μου', 'e.g. My repertoire')} />
          </Field>
        </Dialog>
      )}
      {tool?.kind === 'book' && <BookDialog db={tool.db} onClose={() => setTool(null)} />}
      {tool?.kind === 'unannotate' && <UnannotateDialog db={tool.db} onClose={() => setTool(null)} />}
      {tool?.kind === 'improve' && <ImproveDialog db={tool.db} onClose={() => setTool(null)} />}
      {refDialog && (
        <Dialog title={L('Βάση αναφοράς', 'Reference database')} onClose={() => setRefDialog(false)} width={680}>
          <ReferenceDownload />
        </Dialog>
      )}
      {rename && (
        <Dialog
          title={L('Μετονομασία βάσης', 'Rename database')}
          onClose={() => setRename(null)}
          footer={
            <button
              className="primary"
              onClick={async () => {
                await api.post(`/api/library/${rename.id}/rename`, { name: newName || rename.name }).catch(reportError);
                setRename(null);
                setNewName('');
                void refresh();
              }}
            >
              OK
            </button>
          }
        >
          <Field label={L('Όνομα', 'Name')} wide>
            <input autoFocus defaultValue={rename.name} onChange={(e) => setNewName(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </div>
  );
}
