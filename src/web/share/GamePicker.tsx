/**
 * Κοινή ανάλυση: διάλεξε παρτίδα χωρίς PGN. Από μια βάση (αναζήτηση με όνομα παίκτη, οι πιο πρόσφατες πρώτα)
 * ή από αρχείο PGN του υπολογιστή (αν έχει πολλές παρτίδες, διαλέγεις μία).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, Database, FileText, FileUp, Folder, HardDrive, Search, Star } from 'lucide-react';
import { parseGames, writeGame } from '../../core/pgn.ts';
import { api, type DbInfo, type GameRow, type JobInfo } from '../api.ts';
import { L, fmtBytes, fmtDate, fmtNum, resultText } from '../i18n.ts';
import { reportError, useApp } from '../store.ts';

const LIST = 150;

interface FileGame {
  white: string;
  black: string;
  result: string;
  date: string;
  event: string;
  pgn: string;
}

function rowText(white: string, black: string) {
  return `${white || '?'} – ${black || '?'}`;
}

interface FsEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
}

/**
 * Παρτίδα από βάση: αριστερά οι βάσεις του Ruru και οι φάκελοι του υπολογιστή (όπως στη Βιβλιοθήκη),
 * δεξιά οι παρτίδες της βάσης που διάλεξες. Ένα αρχείο από φάκελο (PGN, ChessBase…) μπαίνει στις βάσεις και ανοίγει.
 */
export function DbPicker({ onPick }: { onPick: (pgn: string) => void }) {
  const library = useApp((s) => s.library);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const dbs = useMemo(
    () =>
      library
        .filter((d) => d.games > 0 || d.busy)
        .sort((a, b) => (a.kind === 'mygames' ? -1 : b.kind === 'mygames' ? 1 : (b.lastOpened ?? 0) - (a.lastOpened ?? 0))),
    [library],
  );
  const ready = dbs.filter((d) => !d.busy);
  const initial = ready.find((d) => d.id === ui.shareDb) ?? ready.find((d) => d.kind === 'mygames') ?? ready[0];
  const [dbId, setDbId] = useState(initial?.id ?? '');
  const [side, setSide] = useState<'dbs' | 'files'>('dbs');
  const [quick, setQuick] = useState<Array<{ name: string; path: string }>>([]);
  const [folder, setFolder] = useState<{ dir: string; parent: string | null; entries: FsEntry[] } | null>(null);
  /** αρχείο που μπαίνει τώρα στις βάσεις: διαλέγεται μόλις τελειώσει */
  const [waiting, setWaiting] = useState<string | null>(null);

  useEffect(() => {
    if (!dbId && initial) setDbId(initial.id);
  }, [dbId, initial]);

  useEffect(() => {
    if (side !== 'files' || quick.length) return;
    api
      .get<Array<{ name: string; path: string }>>('/api/fs/quick')
      .then((q) => {
        setQuick(q);
        if (!folder) void browse(q.find((x) => x.name === 'Βάσεις Ruru')?.path ?? q[0]?.path ?? '');
      })
      .catch(reportError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  const browse = async (dir: string) => {
    try {
      setFolder(await api.get(`/api/fs/list?dir=${encodeURIComponent(dir)}`));
    } catch (e) {
      reportError(e);
    }
  };

  // εισαγωγή αρχείου σε εξέλιξη: ανανέωση της λίστας μέχρι να είναι έτοιμη η βάση
  useEffect(() => {
    if (!waiting) return;
    const entry = library.find((d) => d.id === waiting);
    if (entry && !entry.busy) {
      setWaiting(null);
      setDbId(entry.id);
      setSide('dbs');
      return;
    }
    const t = setTimeout(() => void useApp.getState().refreshLibrary().catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [waiting, library]);

  const openFile = async (e: FsEntry) => {
    const same = (p?: string) => Boolean(p) && p!.toLowerCase() === e.path.toLowerCase();
    const known = library.find((d) => same(d.file) || same(d.source?.path));
    if (known && !known.busy) {
      setDbId(known.id);
      setSide('dbs');
      return;
    }
    try {
      const r = await api.post<{ opened: Array<{ entry: DbInfo; job: JobInfo | null }> }>('/api/library/open', { paths: [e.path] });
      await useApp.getState().refreshLibrary();
      const o = r.opened[0];
      if (!o) return;
      if (o.job) {
        toast(L(`Εισαγωγή «${o.entry.name}»… θα εμφανιστεί μόλις τελειώσει.`, `Importing “${o.entry.name}”… it will appear when done.`), 'info');
        setWaiting(o.entry.id);
      } else {
        setDbId(o.entry.id);
        setSide('dbs');
      }
    } catch (err) {
      reportError(err);
    }
  };
  const [player, setPlayer] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<GameRow[] | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);

  // λίγο μετά την πληκτρολόγηση
  useEffect(() => {
    const t = setTimeout(() => setQuery(player.trim()), 350);
    return () => clearTimeout(t);
  }, [player]);

  useEffect(() => {
    if (!dbId || library.find((d) => d.id === dbId)?.busy) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const v = await api.post<{ key: string; count: number }>(`/api/db/${dbId}/view`, { filter: query ? { player: query } : {}, sort: { col: 'date', desc: true } });
      const r = await api.get<{ rows: GameRow[] }>(`/api/db/${dbId}/rows?key=${encodeURIComponent(v.key)}&offset=0&limit=${LIST}`);
      if (!alive) return;
      setRows(r.rows);
      setCount(v.count);
    })()
      .catch((e) => alive && reportError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dbId, query]);

  const open = async (id: number) => {
    setOpening(id);
    try {
      const g = await api.get<{ pgn: string }>(`/api/db/${dbId}/game/${id}`);
      if (ui.shareDb !== dbId) void useApp.getState().saveUi({ shareDb: dbId }).catch(() => {});
      onPick(g.pgn);
    } catch (e) {
      reportError(e);
      setOpening(null);
    }
  };

  const current = library.find((d) => d.id === dbId);
  const fileIcon = (n: string) => (/\.(7z|zip)$/i.test(n) ? <Archive size={14} /> : /\.(cbh|cbv|cbz|si4|kbdb|skdb)$/i.test(n) ? <Database size={14} /> : <FileText size={14} />);

  return (
    <div className="gx">
      <div className="gx-nav">
        <div className="gx-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={side === 'dbs'} className={side === 'dbs' ? 'on' : ''} onClick={() => setSide('dbs')}>
            <Database size={14} aria-hidden /> {L('Βάσεις', 'Databases')}
          </button>
          <button type="button" role="tab" aria-selected={side === 'files'} className={side === 'files' ? 'on' : ''} onClick={() => setSide('files')}>
            <Folder size={14} aria-hidden /> {L('Φάκελοι', 'Folders')}
          </button>
        </div>

        {side === 'dbs' ? (
          <div className="gx-items" role="listbox" aria-label={L('Βάσεις', 'Databases')}>
            {!dbs.length && <div className="faint small gp-empty">{L('Δεν έχεις ακόμα βάση με παρτίδες. Δες στους «Φακέλους».', 'You have no database with games yet. Look in “Folders”.')}</div>}
            {dbs.map((d) => (
              <button key={d.id} type="button" role="option" aria-selected={d.id === dbId} className={`gx-item${d.id === dbId ? ' on' : ''}`} disabled={Boolean(d.busy)} onClick={() => setDbId(d.id)}>
                {d.kind === 'mygames' ? <Star size={14} aria-hidden /> : <Database size={14} aria-hidden />}
                <span className="gx-name">{d.name}</span>
                <span className="gx-count faint tnum">{d.busy ? L('εισαγωγή…', 'importing…') : fmtNum(d.games)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="gx-items">
            <div className="gx-quick">
              {quick.map((q) => (
                <button key={q.path} type="button" className={folder?.dir === q.path ? 'on' : ''} onClick={() => void browse(q.path)}>
                  <Folder size={13} aria-hidden /> {q.name}
                </button>
              ))}
              <button type="button" onClick={() => void browse('')}>
                <HardDrive size={13} aria-hidden /> {L('Δίσκοι', 'Drives')}
              </button>
            </div>
            {folder && (
              <>
                <div className="gx-path" title={folder.dir}>
                  {folder.parent !== null && (
                    <button type="button" className="gx-up" title={L('Πάνω φάκελος', 'Up one folder')} onClick={() => void browse(folder.parent ?? '')}>
                      <ChevronLeft size={14} />
                    </button>
                  )}
                  <span>{folder.dir || L('Δίσκοι', 'Drives')}</span>
                </div>
                {folder.entries.map((e) => (
                  <button key={e.path} type="button" className={`gx-item${e.dir ? ' dir' : ''}`} onClick={() => (e.dir ? void browse(e.path) : void openFile(e))} title={e.dir ? '' : L('Άνοιγμα', 'Open')}>
                    {e.dir ? <Folder size={14} aria-hidden /> : fileIcon(e.name)}
                    <span className="gx-name">{e.name}</span>
                    {e.dir ? <ChevronRight size={14} aria-hidden /> : <span className="gx-count faint">{fmtBytes(e.size)}</span>}
                  </button>
                ))}
                {!folder.entries.length && <div className="faint small gp-empty">{L('Δεν υπάρχουν βάσεις σκακιού εδώ.', 'No chess databases here.')}</div>}
              </>
            )}
            {waiting && <div className="faint small gp-empty">{L('Εισαγωγή του αρχείου… θα ανοίξει μόλις τελειώσει.', 'Importing the file… it will open when done.')}</div>}
          </div>
        )}
      </div>

      <div className="gp">
      <div className="gx-title">{current ? current.name : L('Διάλεξε βάση', 'Choose a database')}</div>
      <label className="gp-search">
        <Search size={14} aria-hidden />
        <input className="kb-input" value={player} placeholder={L('Όνομα παίκτη (π.χ. Carlsen)', 'Player name (e.g. Carlsen)')} onChange={(e) => setPlayer(e.target.value)} />
      </label>
      <div className="gp-list" role="listbox" aria-label={L('Παρτίδες', 'Games')} aria-busy={loading}>
        {rows === null || (loading && !rows.length) ? (
          <div className="faint small gp-empty">{L('Φόρτωση…', 'Loading…')}</div>
        ) : !rows.length ? (
          <div className="faint small gp-empty">{L('Δεν βρέθηκαν παρτίδες.', 'No games found.')}</div>
        ) : (
          rows.map((r) => (
            <button key={r.id} type="button" role="option" aria-selected={opening === r.id} className="gp-row" disabled={opening !== null} onClick={() => void open(r.id)}>
              <span className="gp-players">{rowText(r.white, r.black)}</span>
              <b className="gp-res tnum">{resultText(r.result)}</b>
              <span className="gp-meta">
                {[fmtDate(r.date), r.event, r.eco].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))
        )}
      </div>
      {count > LIST && (
        <div className="gp-more">{L(`Οι ${LIST} πιο πρόσφατες από ${fmtNum(count)}· γράψε όνομα για να βρεις άλλη.`, `The ${LIST} most recent of ${fmtNum(count)}; type a name to find another.`)}</div>
      )}
      </div>
    </div>
  );
}

/** Παρτίδα από αρχείο PGN του υπολογιστή. */
export function FilePicker({ onPick }: { onPick: (pgn: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [games, setGames] = useState<FileGame[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const read = async (f: File) => {
    setError(null);
    setGames(null);
    if (f.size > 20 * 1024 * 1024) {
      setError(L('Το αρχείο είναι πολύ μεγάλο: άνοιξέ το ως βάση από τις «Βάσεις» και διάλεξε από εκεί.', 'The file is too large: open it as a database from “Databases” and pick from there.'));
      return;
    }
    const text = await f.text();
    const parsed = parseGames(text).filter((p) => p.game.root.children.length || p.game.headers.FEN);
    if (!parsed.length) {
      setError(L('Δεν βρέθηκε παρτίδα στο αρχείο.', 'No game found in the file.'));
      return;
    }
    if (parsed.length === 1) {
      onPick(text);
      return;
    }
    // πολλές παρτίδες: το κείμενο της καθεμιάς για να ανοίξει μόνη της
    setName(f.name);
    setGames(
      parsed.slice(0, 500).map((p) => {
        const h = p.game.headers;
        return { white: h.White ?? '', black: h.Black ?? '', result: h.Result ?? '*', date: (h.Date ?? '').replace(/\.\?\?/g, '').replace(/^\?+$/, ''), event: h.Event && h.Event !== '?' ? h.Event : '', pgn: writeGame(p.game) };
      }),
    );
  };

  const list = useMemo(() => games ?? [], [games]);

  return (
    <div className="gp">
      <input
        ref={input}
        type="file"
        accept=".pgn,.txt,application/x-chess-pgn,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void read(f);
        }}
      />
      <button type="button" className="kb-btn" onClick={() => input.current?.click()}>
        <FileUp aria-hidden />
        {L('Άνοιγμα αρχείου PGN…', 'Open a PGN file…')}
      </button>
      {error && <div className="kb-callout danger">{error}</div>}
      {games && (
        <>
          <div className="gp-more">
            {name}: {L(`${fmtNum(list.length)} παρτίδες· διάλεξε μία`, `${fmtNum(list.length)} games; pick one`)}
          </div>
          <div className="gp-list" role="listbox">
            {list.map((g, i) => (
              <button key={i} type="button" role="option" aria-selected={false} className="gp-row" onClick={() => onPick(g.pgn)}>
                <span className="gp-players">{rowText(g.white, g.black)}</span>
                <b className="gp-res tnum">{g.result.replace('1/2-1/2', '½-½')}</b>
                <span className="gp-meta">{[g.date, g.event].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
