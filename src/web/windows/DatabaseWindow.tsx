/** Παράθυρο βάσης: λίστα παρτίδων, αναζήτηση, παίκτες, τουρνουά, ανοίγματα, στατιστικά. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, FilterX, FilePlus2, Copy, Trash2, RotateCcw, Download, Layers, ListTree, Users, Trophy, BarChart3, Rows3, DatabaseZap, Eraser, BookOpen } from 'lucide-react';
import { START_FEN } from '../../core/chess.ts';
import { api, onServerEvent, pickFiles, type ApiError, type GameRow, type SearchCriteria, type ViewSpec } from '../api.ts';
import { L, fmtNum } from '../i18n.ts';
import { newTabId, reportError, useApp, type Tab } from '../store.ts';
import { GameList } from '../components/GameList.tsx';
import { SearchDialog, describeFilter, type SearchSpec } from '../components/SearchDialog.tsx';
import { ContextMenu, Dialog, Field, Progress, type MenuItem } from '../components/ui.tsx';
import { GamePreview, OpeningsPane, PlayersPane, RepertoirePane, StatsPane, TournamentsPane } from './db/Panes.tsx';
import type { NotationStyle } from '../components/Notation.tsx';
import { openSend } from '../social/social.ts';
import { SOCIAL } from '../../core/features.ts';

type DbTab = Extract<Tab, { kind: 'db' }>;
type Pane = 'games' | 'players' | 'tournaments' | 'openings' | 'repertoire' | 'stats';

export function DatabaseWindow({ tab }: { tab: DbTab }) {
  const dbId = tab.dbId;
  const library = useApp((s) => s.library);
  const settings = useApp((s) => s.settings);
  const openTab = useApp((s) => s.openTab);
  const toast = useApp((s) => s.toast);
  const info = library.find((d) => d.id === dbId);
  const style: NotationStyle = ((settings?.ui as Record<string, unknown> | undefined)?.notation as NotationStyle) ?? 'figurine';

  const [pane, setPane] = useState<Pane>('games');
  const [search, setSearch] = useState<SearchSpec & { ids?: number[]; label?: string; deep?: boolean }>({ filter: tab.filter ?? {}, fen: tab.fen ?? null });
  const [sort, setSort] = useState<{ col: string; desc: boolean }>({ col: 'id', desc: false });
  const [view, setView] = useState<{ key: string; count: number; posTotal?: number; limited?: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState<GameRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [dialog, setDialog] = useState<null | 'search' | 'copy'>(tab.openSearch ? 'search' : null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [copyTarget, setCopyTarget] = useState('');
  const busy = info?.busy;
  // η βάση εισάγεται: λίστα και παρτίδες ανοίγουν ήδη· αλλαγές, αναζήτηση θέσης και δέντρο μετά το τέλος
  const importing = busy?.kind === 'import';

  // μεγάλες σαρώσεις (θέση, υλικό, ελιγμός): πρόοδος από τον server και ακύρωση
  const [scan, setScan] = useState<{ id: string; label: string; done: number; total: number; slow?: boolean } | null>(null);
  const scanRef = useRef<string | null>(null);
  const lastOk = useRef(search);
  useEffect(() => onServerEvent('scan', (d: { id: string; label: string; done: number; total: number }) => setScan((s) => (s && s.id === d.id ? { ...s, ...d } : s))), []);
  // ακύρωση από τον χρήστη: πίσω στην τελευταία αναζήτηση που ολοκληρώθηκε
  const cancelScan = () => {
    if (scanRef.current) void api.post(`/api/scan/${scanRef.current}/cancel`).catch(() => {});
    setSearch(lastOk.current);
  };

  const loadView = useCallback(async () => {
    if (busy?.kind === 'convert') return;
    // νέα αναζήτηση: η προηγούμενη σάρωση δεν χρειάζεται πια
    if (scanRef.current) void api.post(`/api/scan/${scanRef.current}/cancel`).catch(() => {});
    const scanId = Math.random().toString(36).slice(2);
    scanRef.current = scanId;
    setScan({ id: scanId, label: '', done: 0, total: 0 });
    setLoading(true);
    // χωρίς γνωστή πρόοδο (φίλτρα / ταξινόμηση σε worker): «Ακύρωση» μετά από 1,5 δευτ.
    const slow = setTimeout(() => setScan((s) => (s && s.id === scanId ? { ...s, slow: true } : s)), 1500);
    try {
      const spec: ViewSpec = { filter: search.ids ? { ...search.filter, ids: search.ids } : search.filter, fen: search.fen ?? undefined, sort, deep: search.deep };
      const r = await api.post<{ key: string; count: number; posTotal?: number; limited?: boolean }>(`/api/db/${dbId}/view`, { ...spec, scanId });
      if (scanRef.current === scanId) {
        setView(r);
        lastOk.current = search;
      }
    } catch (e) {
      const status = (e as ApiError).status;
      if (status !== 499) reportError(e);
      // π.χ. αναζήτηση θέσης όσο η βάση εισάγεται: πίσω στην τελευταία λίστα, αλλιώς το μήνυμα
      // θα ξαναβγαίνει σε κάθε ανανέωση της λίστας
      if (status === 409 && (search.label ?? describeFilter(search))) setSearch(lastOk.current === search ? { filter: {}, fen: null } : lastOk.current);
    } finally {
      clearTimeout(slow);
      if (scanRef.current === scanId) {
        scanRef.current = null;
        setScan(null);
        setLoading(false);
      }
    }
  }, [dbId, search, sort, busy]);

  useEffect(() => {
    void loadView();
  }, [loadView, refresh, info?.games]);

  // εισαγωγή σε ανοιχτή βάση: μόνο η λίστα παρτίδων ως το τέλος
  useEffect(() => {
    if (importing) setPane('games');
  }, [importing]);

  // αναζήτηση θέσης από άλλο παράθυρο (δέντρο ανοιγμάτων)
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ dbId: string; fen?: string | null; filter?: SearchCriteria; openSearch?: boolean }>).detail;
      if (d.dbId !== dbId) return;
      setPane('games');
      if (d.openSearch) setDialog('search');
      else setSearch({ filter: d.filter ?? {}, fen: d.fen ?? null });
    };
    window.addEventListener('knightbase:position-search', fn);
    return () => window.removeEventListener('knightbase:position-search', fn);
  }, [dbId]);

  // αλλαγές στη βάση από άλλο παράθυρο (π.χ. αποθήκευση παρτίδας): νέα φόρτωση της λίστας
  useEffect(() => {
    const fn = (e: Event) => {
      if ((e as CustomEvent<string>).detail === dbId) setRefresh((r) => r + 1);
    };
    window.addEventListener('knightbase:db-changed', fn);
    return () => window.removeEventListener('knightbase:db-changed', fn);
  }, [dbId]);

  const openGame = (row: GameRow) => {
    openTab({
      id: newTabId('game'),
      kind: 'game',
      title: `${row.white.split(',')[0]} – ${row.black.split(',')[0]}`,
      source: { dbId, gameId: row.id, viewKey: view?.key },
    });
  };

  const ids = () => [...selected];

  const markDeleted = async (deleted: boolean) => {
    if (!selected.size) return;
    await api.post(`/api/db/${dbId}/delete`, { ids: ids(), deleted }).catch(reportError);
    setRefresh((r) => r + 1);
  };

  const purge = async () => {
    if (!window.confirm(L('Να σβηστούν για πάντα οι παρτίδες που σημάδεψες για διαγραφή; Δεν αναιρείται.', 'Erase every game you flagged for deletion? This cannot be undone.'))) return;
    try {
      const r = await api.post<{ removed: number }>(`/api/db/${dbId}/purge`);
      toast(L(`Αφαιρέθηκαν ${r.removed} παρτίδες`, `Removed ${r.removed} games`), 'ok');
      setSelected(new Set());
      setRefresh((x) => x + 1);
      void useApp.getState().refreshLibrary();
    } catch (e) {
      reportError(e);
    }
  };

  const exportPgn = async (onlySelected: boolean) => {
    const name = `${info?.name ?? 'export'}.pgn`;
    const paths = await pickFiles('save', { name }).catch((e) => {
      reportError(e);
      return [];
    });
    if (!paths.length) return;
    try {
      const body = onlySelected && selected.size ? { ids: ids(), path: paths[0] } : { key: view?.key, path: paths[0] };
      const r = await api.post<{ exported: number; path: string }>(`/api/db/${dbId}/export`, body);
      toast(L(`Εξήχθησαν ${fmtNum(r.exported)} παρτίδες στο ${r.path}`, `Exported ${fmtNum(r.exported)} games to ${r.path}`), 'ok');
    } catch (e) {
      reportError(e);
    }
  };

  const copyTo = async () => {
    if (!copyTarget) return;
    try {
      const body = selected.size ? { ids: ids(), target: copyTarget } : { key: view?.key, target: copyTarget };
      const r = await api.post<{ copied: number }>(`/api/db/${dbId}/copy`, body);
      toast(L(`Αντιγράφηκαν ${fmtNum(r.copied)} παρτίδες`, `Copied ${fmtNum(r.copied)} games`), 'ok');
      setDialog(null);
      void useApp.getState().refreshLibrary();
    } catch (e) {
      reportError(e);
    }
  };

  const findDoubles = async () => {
    // με «Ακύρωση» όπως οι σαρώσεις (στη Lumbras κρατά ~2 λεπτά)
    if (scanRef.current) void api.post(`/api/scan/${scanRef.current}/cancel`).catch(() => {});
    const scanId = Math.random().toString(36).slice(2);
    scanRef.current = scanId;
    setScan({ id: scanId, label: L('Διπλές παρτίδες…', 'Duplicate games…'), done: 0, total: 0, slow: true });
    try {
      const r = await api.post<{ doubles: number }>(`/api/db/${dbId}/doubles`, { mark: true, scanId });
      toast(r.doubles ? L(`Βρέθηκαν ${r.doubles} διπλές παρτίδες — σημάνθηκαν για διαγραφή`, `Found ${r.doubles} duplicates — flagged for deletion`) : L('Δεν βρέθηκαν διπλές παρτίδες', 'No duplicates found'), 'ok');
      setRefresh((x) => x + 1);
    } catch (e) {
      if ((e as ApiError).status !== 499) reportError(e);
    } finally {
      if (scanRef.current === scanId) {
        scanRef.current = null;
        setScan(null);
      }
    }
  };

  const copyPgnToClipboard = async () => {
    try {
      const texts: string[] = [];
      for (const id of ids().slice(0, 200)) texts.push((await api.get<{ pgn: string }>(`/api/db/${dbId}/game/${id}`)).pgn);
      await navigator.clipboard.writeText(texts.join('\n\n'));
      toast(L('Το PGN αντιγράφηκε', 'PGN copied'), 'ok');
    } catch (e) {
      reportError(e);
    }
  };

  const rowMenu = (row: GameRow, x: number, y: number) => {
    setMenu({
      x,
      y,
      items: [
        { label: L('Άνοιγμα παρτίδας', 'Open game'), onClick: () => openGame(row) },
        { separator: true, label: '' },
        { label: L('Αντιγραφή σε βάση…', 'Copy to database…'), onClick: () => setDialog('copy'), disabled: importing },
        { label: L('Αντιγραφή PGN', 'Copy PGN'), onClick: () => void copyPgnToClipboard() },
        { label: L('Εξαγωγή επιλεγμένων σε PGN…', 'Export selected to PGN…'), onClick: () => void exportPgn(true), disabled: importing },
        ...(SOCIAL ? [{ label: L('Αποστολή επιλεγμένων σε φίλο ή ομάδα…', 'Send selected to a friend or team…'), onClick: () => openSend({ dbId, ids: selected.size ? ids() : [row.id] }) }] : []),
        { separator: true, label: '' },
        { label: L('Σήμανση για διαγραφή', 'Flag for deletion'), onClick: () => void markDeleted(true), danger: true, disabled: importing },
        { label: L('Επαναφορά', 'Undelete'), onClick: () => void markDeleted(false), disabled: importing },
      ],
    });
  };

  const filterText = search.label ?? describeFilter(search);
  const filtered = Boolean(filterText);

  const afterImport = L('μόλις τελειώσει η εισαγωγή', 'once the import finishes');
  const paneButton = (p: Pane, icon: React.ReactNode, label: string, off = false) => (
    <button className={pane === p ? 'on' : ''} disabled={off} onClick={() => setPane(p)} title={off ? `${label}: ${afterImport}` : label}>
      {icon}
      <span>{label}</span>
    </button>
  );

  if (busy?.kind === 'convert') {
    const p = busy.progress;
    return (
      <div className="db-window busy pad">
        <h2>{info?.name}</h2>
        <p>
          {L('Μετατροπή στη νέα μορφή…', 'Converting to the new format…')} {fmtNum(p.games)} {L('παρτίδες', 'games')}
          {p.totalBytes ? ` (${Math.round((p.bytes / p.totalBytes) * 100)}%)` : ''}
        </p>
        {p.message && <p className="muted">{p.message}</p>}
      </div>
    );
  }

  return (
    <div className="db-window">
      <nav className="db-side">
        {paneButton('games', <Rows3 size={18} />, L('Παρτίδες', 'Games'))}
        {paneButton('players', <Users size={18} />, L('Παίκτες', 'Players'), importing)}
        {paneButton('tournaments', <Trophy size={18} />, L('Τουρνουά', 'Tournaments'), importing)}
        {paneButton('openings', <ListTree size={18} />, L('Ανοίγματα', 'Openings'), importing)}
        {paneButton('repertoire', <BookOpen size={18} />, L('Ρεπερτόριο', 'Repertoire'), importing)}
        {paneButton('stats', <BarChart3 size={18} />, L('Στατιστικά', 'Statistics'), importing)}
      </nav>
      <div className="db-main">
        {importing && busy && (
          <div className="import-strip">
            {busy.progress.phase === 'indexing'
              ? `${L('Η εισαγωγή τελειώνει', 'The import is finishing')}: ${busy.progress.message ?? L('ευρετήρια…', 'indexes…')}`
              : busy.progress.existing
              ? `${L('Η εισαγωγή ξεκινά', 'The import is starting')}: ${L('οι παρτίδες της βάσης στο ευρετήριο θέσεων', "the database's games into the position index")} ${fmtNum(busy.progress.existing.done)} / ${fmtNum(busy.progress.existing.total)}`
              : `${L('Εισάγονται ακόμη', 'Still importing')}: ${fmtNum(busy.progress.games)} ${L('παρτίδες', 'games')}${busy.progress.totalBytes > 1000 ? ` (${Math.round((busy.progress.bytes / busy.progress.totalBytes) * 100)}%)` : ''}`}
            <span className="muted">
              {' · '}
              {L('η λίστα ανανεώνεται μόνη της· αναζήτηση θέσης, δέντρο, παίκτες, τουρνουά και αλλαγές μόλις τελειώσει.', 'the list refreshes by itself; position search, tree, players, tournaments and changes once it finishes.')}
            </span>
          </div>
        )}
        {pane === 'games' && (
          <>
            <div className="toolbar">
              <button
                className="primary new-game-btn"
                disabled={importing}
                onClick={() => openTab({ id: newTabId('game'), kind: 'game', title: L('Νέα παρτίδα', 'New game'), fen: START_FEN, targetDb: dbId })}
                title={L('Νέα παρτίδα σε αυτή τη βάση (αποθηκεύεται εδώ)', 'New game in this database (saved here)')}
              >
                <FilePlus2 size={16} /> {L('Νέα παρτίδα', 'New game')}
              </button>
              <span className="sep" />
              <button onClick={() => setDialog('search')} title={L('Αναζήτηση / φίλτρο', 'Search / filter')}>
                <Search size={16} /> {L('Αναζήτηση', 'Search')}
              </button>
              <button disabled={!filtered} onClick={() => setSearch({ filter: {}, fen: null })} title={L('Καθαρισμός φίλτρου', 'Clear filter')}>
                <FilterX size={16} />
              </button>
              <span className="sep" />
              <button disabled={importing} onClick={() => setDialog('copy')} title={L('Αντιγραφή σε άλλη βάση', 'Copy to another database')}>
                <Copy size={16} />
              </button>
              <button disabled={importing || !selected.size} onClick={() => void markDeleted(true)} title={L('Σήμανση για διαγραφή (Del)', 'Flag for deletion (Del)')}>
                <Trash2 size={16} />
              </button>
              <button disabled={importing || !selected.size} onClick={() => void markDeleted(false)} title={L('Επαναφορά', 'Undelete')}>
                <RotateCcw size={16} />
              </button>
              <button disabled={importing} onClick={() => void purge()} title={L('Σβήσιμο όσων σημάνθηκαν, για πάντα', 'Erase flagged games for good')}>
                <Eraser size={16} />
              </button>
              <span className="sep" />
              <button disabled={importing} onClick={() => void exportPgn(false)} title={L('Εξαγωγή λίστας σε PGN', 'Export list to PGN')}>
                <Download size={16} />
              </button>
              <button disabled={importing} onClick={() => void findDoubles()} title={L('Εύρεση διπλών παρτίδων', 'Find duplicate games')}>
                <Layers size={16} />
              </button>
              <button
                disabled={importing}
                onClick={() =>
                  api
                    .post(`/api/library/${dbId}/reindex`)
                    .then(() => toast(L('Το ευρετήριο θέσεων ξαναφτιάχνεται…', 'Rebuilding position index…')))
                    .catch(reportError)
                }
                title={L('Ανακατασκευή ευρετηρίου θέσεων', 'Rebuild position index')}
              >
                <DatabaseZap size={16} />
              </button>
              <span className="spacer" />
              {loading && <span className="spinner" />}
              {scan && (scan.total > 1 || scan.slow) && (
                <span className="scan-progress">
                  {scan.total > 1 ? (
                    <Progress value={scan.done / scan.total} label={`${scan.label} ${Math.round((100 * scan.done) / scan.total)}%`} />
                  ) : (
                    <span className="muted small">{scan.label || L('Αναζήτηση…', 'Searching…')}</span>
                  )}
                  <button className="small-btn" onClick={cancelScan}>
                    {L('Ακύρωση', 'Cancel')}
                  </button>
                </span>
              )}
              {filtered && (
                <span className="filter-chip" title={filterText}>
                  {L('Φίλτρο', 'Filter')}: {filterText}
                </span>
              )}
              {view?.limited && (
                <span className="warn-chip">
                  {L('Η θέση είναι πιο βαθιά από το ευρετήριο', 'The position is deeper than the index')}{' '}
                  <button className="link-btn" disabled={loading} onClick={() => setSearch((s) => ({ ...s, deep: true }))}>
                    {L('Σάρωση όλων των παρτίδων', 'Scan all games')}
                  </button>
                </span>
              )}
            </div>
            <div className="games-split">
              <GameList
                dbId={dbId}
                viewKey={view?.key ?? null}
                count={view?.count ?? 0}
                sort={sort}
                onSort={(col) => setSort((s) => ({ col, desc: s.col === col ? !s.desc : col === 'date' || col === 'welo' || col === 'belo' }))}
                selected={selected}
                onSelect={(s, r) => {
                  setSelected(s);
                  setFocus(r);
                }}
                onOpen={openGame}
                onContext={rowMenu}
                onDeleteKey={importing ? undefined : () => void markDeleted(true)}
                // κατά την εισαγωγή: νέες παρτίδες = οι σελίδες της λίστας ξαναφορτώνονται
                refreshToken={importing ? `${refresh}:${view?.count ?? 0}` : refresh}
              />
              <GamePreview dbId={dbId} row={focus} />
            </div>
          </>
        )}
        {pane === 'players' && (
          <PlayersPane
            dbId={dbId}
            onFilter={(f) => {
              setSearch({ filter: f, fen: null });
              setPane('games');
            }}
          />
        )}
        {pane === 'tournaments' && (
          <TournamentsPane
            dbId={dbId}
            onShowIds={(list, label) => {
              setSearch({ filter: {}, fen: null, ids: list, label });
              setPane('games');
            }}
          />
        )}
        {pane === 'openings' && (
          <OpeningsPane
            dbId={dbId}
            style={style}
            onPositionGames={(fen) => {
              setSearch({ filter: {}, fen });
              setPane('games');
            }}
          />
        )}
        {pane === 'repertoire' && (
          <RepertoirePane
            dbId={dbId}
            onOpenLine={(pgn) => openTab({ id: newTabId('game'), kind: 'game', title: L('Γραμμή ρεπερτορίου', 'Repertoire line'), pgn })}
            onShowGames={(refId, fen) => {
              const ref = library.find((d) => d.id === refId);
              openTab({ id: `db-${refId}`, kind: 'db', dbId: refId, title: ref?.name ?? 'DB', fen });
              setTimeout(() => window.dispatchEvent(new CustomEvent('knightbase:position-search', { detail: { dbId: refId, fen } })), 50);
            }}
          />
        )}
        {pane === 'stats' && <StatsPane dbId={dbId} />}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog === 'search' && (
        <SearchDialog
          initial={search}
          onClose={() => setDialog(null)}
          onSearch={(s) => {
            setSearch(s);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'copy' && (
        <Dialog
          title={selected.size ? L(`Αντιγραφή ${selected.size} παρτίδων`, `Copy ${selected.size} games`) : L(`Αντιγραφή όλης της λίστας (${fmtNum(view?.count ?? 0)})`, `Copy the whole list (${fmtNum(view?.count ?? 0)})`)}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button onClick={() => setDialog(null)}>{L('Άκυρο', 'Cancel')}</button>
              <button className="primary" disabled={!copyTarget} onClick={() => void copyTo()}>
                {L('Αντιγραφή', 'Copy')}
              </button>
            </>
          }
        >
          <Field label={L('Προς τη βάση', 'To database')} wide>
            <select value={copyTarget} onChange={(e) => setCopyTarget(e.target.value)}>
              <option value="">—</option>
              {library
                .filter((d) => d.id !== dbId && !d.busy)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({fmtNum(d.games)})
                  </option>
                ))}
            </select>
          </Field>
        </Dialog>
      )}
    </div>
  );
}
