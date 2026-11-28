/**
 * «Αναφορά»: οι κινήσεις της θέσης στη βάση αναφοράς
 * (παρτίδες, αποτελέσματα, Elo, επίδοση, έτος) και από κάτω οι παρτίδες που φτάνουν
 * εκεί — πρώτα οι πρόσφατες δυνατών παικτών. Εναλλακτικά: βιβλίο Polyglot (επιλογή, αλλαγή και αφαίρεση εδώ, στην
 * καρτέλα «Βιβλίο»· όχι στις Ρυθμίσεις). Με λίγα κομμάτια και online tablebase.
 */
import { useEffect, useMemo, useState } from 'react';
import { ListTree, ListOrdered, BookOpen, FolderOpen, X } from 'lucide-react';
import { Position } from '../../core/chess.ts';
import { api, pickFiles, type DbInfo, type TreeMoveInfo } from '../api.ts';
import { L, fmtNum } from '../i18n.ts';
import { reportError, useApp } from '../store.ts';
import { displaySan, type NotationStyle } from './Notation.tsx';

interface Props {
  fen: string;
  style: NotationStyle;
  dbId: string | null;
  onDbChange: (id: string) => void;
  onPlay: (uci: string) => void;
  onShowGames?: (dbId: string, fen: string) => void;
  /** διπλό κλικ σε παρτίδα της λίστας */
  onOpenGame?: (dbId: string, gameId: number) => void;
}

interface TreeResponse {
  indexed: boolean;
  stale?: boolean;
  total: number;
  moves: TreeMoveInfo[];
  maxPly?: number;
}

interface RefGame {
  id: number;
  white: string;
  black: string;
  welo: number;
  belo: number;
  result: number;
  date: number;
  event: string;
  /** οι επόμενες κινήσεις της παρτίδας από τη θέση (SAN) */
  next: string[];
}

interface BookResponse {
  configured: boolean;
  name?: string;
  moves: Array<{ uci: string; san: string; weight: number; pct: number }>;
}

interface TablebaseResponse {
  category: string;
  dtz: number | null;
  dtm: number | null;
  moves: Array<{ uci: string; san: string; category: string; dtz: number | null; dtm: number | null }>;
}

const RESULTS = ['*', '1-0', '½-½', '0-1'];
const surname = (name: string) => name.split(',')[0] || '?';

export function ScoreBar({ w, d, l }: { w: number; d: number; l: number }) {
  const t = w + d + l || 1;
  const pw = (w / t) * 100;
  const pd = (d / t) * 100;
  const pl = 100 - pw - pd;
  return (
    <div className="scorebar" title={`+${w} =${d} −${l}`}>
      <div className="sb-w" style={{ width: `${pw}%` }}>{pw >= 14 ? `${Math.round(pw)}%` : ''}</div>
      <div className="sb-d" style={{ width: `${pd}%` }}>{pd >= 14 ? `${Math.round(pd)}%` : ''}</div>
      <div className="sb-l" style={{ width: `${pl}%` }}>{pl >= 14 ? `${Math.round(pl)}%` : ''}</div>
    </div>
  );
}

export function TreePanel({ fen, style, dbId, onDbChange, onPlay, onShowGames, onOpenGame }: Props) {
  const library = useApp((s) => s.library);
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const [source, setSource] = useState<'db' | 'book'>('db');
  const [book, setBook] = useState<BookResponse | null>(null);
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [games, setGames] = useState<{ total: number; games: RefGame[] } | null>(null);
  const [tb, setTb] = useState<TablebaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const dbs = library.filter((d) => d.games > 0 && !d.busy);
  const effectiveDb = dbId && library.some((d) => d.id === dbId) ? dbId : (dbs.sort((a, b) => b.games - a.games)[0]?.id ?? null);
  const pieces = useMemo(() => {
    try {
      const p = Position.fromFen(fen);
      let n = 0;
      for (let sq = 0; sq < 128; sq++) if (!(sq & 0x88) && p.board[sq]) n++;
      return n;
    } catch {
      return 32;
    }
  }, [fen]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        if (source === 'db') {
          if (!effectiveDb) {
            setTree(null);
            setGames(null);
            return;
          }
          const r = await api.post<TreeResponse>(`/api/db/${effectiveDb}/tree`, { fen });
          if (!alive) return;
          setTree(r);
          // οι παρτίδες της θέσης μετά το δέντρο (το δέντρο φαίνεται αμέσως)
          const g = await api.post<{ total: number; games: RefGame[] }>(`/api/db/${effectiveDb}/position-games`, { fen, limit: 40 }).catch(() => null);
          if (alive) setGames(g);
        } else {
          const r = await api.get<BookResponse>(`/api/book?fen=${encodeURIComponent(fen)}`);
          if (alive) setBook(r);
        }
        if (settings?.onlineLookups && pieces <= 7) {
          const r = await api.get<TablebaseResponse | null>(`/api/online/tablebase?fen=${encodeURIComponent(fen)}`).catch(() => null);
          if (alive) setTb(r);
        } else if (alive) setTb(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [fen, source, effectiveDb, pieces, settings?.onlineLookups, settings?.bookPath]);

  /** Το βιβλίο Polyglot: διάλογος αρχείου (κενό = αφαίρεση· το αρχείο μένει στον δίσκο). */
  const chooseBook = async () => {
    const p = (await pickFiles('book').catch(() => []))[0];
    if (p) await saveSettings({ bookPath: p }).catch(reportError);
  };
  const removeBook = () => void saveSettings({ bookPath: '' }).catch(reportError);

  const pos = useMemo(() => {
    try {
      return Position.fromFen(fen);
    } catch {
      return Position.start();
    }
  }, [fen]);

  /** Κινήσεις με αρίθμηση από τη θέση (π.χ. «7.Nc3 d6 8.h3»). */
  const lineText = (sans: string[]) => {
    let n = pos.fullmove;
    let white = pos.turn === 0;
    return sans
      .map((s, i) => {
        const t = (white ? `${n}.` : i === 0 ? `${n}...` : '') + displaySan(s, style);
        if (!white) n++;
        white = !white;
        return t;
      })
      .join(' ');
  };

  const totalW = tree ? tree.moves.reduce((a, m) => a + m.w, 0) : 0;
  const totalD = tree ? tree.moves.reduce((a, m) => a + m.d, 0) : 0;
  const totalL = tree ? tree.moves.reduce((a, m) => a + m.l, 0) : 0;

  return (
    <div className="panel tree-panel">
      <div className="tree-head">
        <div className="seg">
          <button className={source === 'db' ? 'on' : ''} onClick={() => setSource('db')} title={L('Από τη βάση αναφοράς', 'From the reference database')}>
            <ListTree size={14} /> {L('Βάση', 'Database')}
          </button>
          <button className={source === 'book' ? 'on' : ''} onClick={() => setSource('book')} title={L('Βιβλίο ανοιγμάτων (Polyglot)', 'Opening book (Polyglot)')}>
            <BookOpen size={14} /> {L('Βιβλίο', 'Book')}
          </button>
        </div>
        {source === 'db' && (
          <select value={effectiveDb ?? ''} onChange={(e) => onDbChange(e.target.value)} title={L('Βάση αναφοράς', 'Reference database')}>
            {library
              .filter((d) => !d.busy)
              .map((d: DbInfo) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({fmtNum(d.games)})
                </option>
              ))}
          </select>
        )}
        {source === 'db' && tree && effectiveDb && onShowGames && tree.total > 0 && (
          <button className="link-btn" onClick={() => onShowGames(effectiveDb, fen)} title={L('Όλες οι παρτίδες της θέσης στο παράθυρο της βάσης', 'All games of this position in the database window')}>
            <ListOrdered size={14} /> {fmtNum(tree.total)} {L('παρτίδες', 'games')}
          </button>
        )}
        {source === 'book' && book?.configured && (
          <>
            <span className="book-name" title={settings?.bookPath}>
              {book.name}
            </span>
            <button className="link-btn" onClick={() => void chooseBook()} title={L('Άλλο βιβλίο Polyglot (.bin)', 'Another Polyglot book (.bin)')}>
              <FolderOpen size={14} /> {L('Αλλαγή…', 'Change…')}
            </button>
            <button className="link-btn" onClick={removeBook} title={L('Αφαίρεση βιβλίου (το αρχείο μένει στον δίσκο)', 'Remove book (the file stays on disk)')}>
              <X size={14} /> {L('Αφαίρεση', 'Remove')}
            </button>
          </>
        )}
        {loading && <span className="spinner" />}
      </div>
      {error && <div className="error-text">{error}</div>}
      {source === 'db' && tree && !tree.indexed && <div className="muted small">{L('Η βάση δεν έχει ευρετήριο θέσεων.', 'This database has no position index.')}</div>}
      {source === 'db' && tree?.stale && <div className="muted small">{L('Το ευρετήριο ενημερώνεται…', 'Index is being updated…')}</div>}
      {source === 'db' && tree && (
        <table className="tree-table">
          <thead>
            <tr>
              <th>{L('Κίνηση', 'Move')}</th>
              <th className="num">{L('Παρτίδες', 'Games')}</th>
              <th>{L('Αποτελέσματα', 'Results')}</th>
              <th className="num">{L('Βαθμ.', 'Score')}</th>
              <th className="num" title={L('Μέσο Elo όσων έπαιξαν την κίνηση', 'Average rating of players')}>Elo</th>
              <th className="num" title={L('Επίδοση', 'Performance')}>Perf</th>
              <th className="num" title={L('Τελευταία φορά που παίχτηκε', 'Last played')}>{L('Έτος', 'Year')}</th>
            </tr>
          </thead>
          <tbody>
            {tree.moves.map((m) => (
              <tr key={m.uci} onClick={() => onPlay(m.uci)}>
                <td className="tree-move">{displaySan(m.san, style)}</td>
                <td className="num">{fmtNum(m.games)}</td>
                <td>
                  <ScoreBar w={m.w} d={m.d} l={m.l} />
                </td>
                <td className="num">{Math.round(m.score * 100)}%</td>
                <td className="num">{m.elo || ''}</td>
                <td className="num">{m.perf || ''}</td>
                <td className="num">{m.year || ''}</td>
              </tr>
            ))}
            {tree.moves.length > 0 && (
              <tr className="total">
                <td>Σ</td>
                <td className="num">{fmtNum(tree.moves.reduce((a, m) => a + m.games, 0))}</td>
                <td>
                  <ScoreBar w={totalW} d={totalD} l={totalL} />
                </td>
                <td colSpan={4} />
              </tr>
            )}
            {!tree.moves.length && tree.indexed && (
              <tr>
                <td colSpan={7} className="muted small">
                  {tree.total > 0 ? L('Η θέση είναι τελική σε όλες τις παρτίδες.', 'This position ends all games.') : L('Καμία παρτίδα της βάσης δεν φτάνει σε αυτή τη θέση.', 'No game in this database reaches this position.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {source === 'db' && effectiveDb && games && games.games.length > 0 && (
        <div className="ref-games">
          <div className="ref-head">
            {L('Παρτίδες της θέσης', 'Games with this position')}{' '}
            <span className="muted">· {L('πρώτα οι πρόσφατες με παίκτες 2400+ · διπλό κλικ για άνοιγμα', 'recent 2400+ games first · double-click to open')}</span>
          </div>
          <table className="tree-table ref-table">
            <thead>
              <tr>
                <th>{L('Λευκά', 'White')}</th>
                <th className="num">Elo</th>
                <th>{L('Μαύρα', 'Black')}</th>
                <th className="num">Elo</th>
                <th>{L('Αποτ.', 'Res.')}</th>
                <th className="num">{L('Έτος', 'Year')}</th>
                <th>{L('Συνέχεια', 'Continuation')}</th>
              </tr>
            </thead>
            <tbody>
              {games.games.map((g) => (
                <tr key={g.id} onDoubleClick={() => onOpenGame?.(effectiveDb, g.id)} title={`${g.white} – ${g.black}${g.event ? ` · ${g.event}` : ''}`}>
                  <td>{surname(g.white)}</td>
                  <td className="num">{g.welo || ''}</td>
                  <td>{surname(g.black)}</td>
                  <td className="num">{g.belo || ''}</td>
                  <td>{RESULTS[g.result] ?? ''}</td>
                  <td className="num">{Math.floor(g.date / 10000) || ''}</td>
                  <td className="cont">{lineText(g.next)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {source === 'book' && book && !book.configured && (
        <div className="book-empty">
          <p className="muted small">
            {L(
              'Ένα βιβλίο ανοιγμάτων Polyglot (.bin) δείχνει επιλεγμένες κινήσεις για κάθε θέση, π.χ. το ρεπερτόριό σου από άλλο πρόγραμμα. Μπορείς να φτιάξεις ένα και από μια βάση σου («Δημιουργία βιβλίου Polyglot…» στις Βάσεις).',
              'A Polyglot opening book (.bin) shows chosen moves for each position, e.g. your repertoire from another program. You can also create one from one of your databases (“Create Polyglot book…” in Databases).',
            )}
          </p>
          <button className="kb-btn ghost sm" onClick={() => void chooseBook()}>
            <FolderOpen size={14} /> {L('Διάλεξε βιβλίο…', 'Choose book…')}
          </button>
        </div>
      )}
      {source === 'book' && book?.configured && (
        <table className="tree-table">
          <thead>
            <tr>
              <th>{L('Κίνηση', 'Move')}</th>
              <th className="num">{L('Βάρος', 'Weight')}</th>
              <th className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {book.moves.map((m) => (
              <tr key={m.uci} onClick={() => onPlay(m.uci)}>
                <td className="tree-move">{displaySan(m.san, style)}</td>
                <td className="num">{m.weight}</td>
                <td className="num">{Math.round(m.pct * 100)}%</td>
              </tr>
            ))}
            {!book.moves.length && (
              <tr>
                <td colSpan={3} className="muted small">
                  {L('Η θέση δεν υπάρχει στο βιβλίο.', 'Position not in book.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {tb && (
        <div className="tablebase">
          <div className="small">
            <b>Tablebase:</b> {tbCategory(tb.category)}
            {tb.dtm !== null ? ` · DTM ${Math.abs(tb.dtm)}` : ''}
            {tb.dtz !== null ? ` · DTZ ${Math.abs(tb.dtz)}` : ''}
          </div>
          {tb.moves.slice(0, 8).map((m) => (
            <span key={m.uci} className={`tb-move ${m.category}`} onClick={() => onPlay(m.uci)}>
              {displaySan(m.san, style)} <small>{tbCategory(invert(m.category))}</small>
            </span>
          ))}
        </div>
      )}
      <div className="muted tiny">{pos.turn === 0 ? L('Παίζουν τα λευκά', 'White to move') : L('Παίζουν τα μαύρα', 'Black to move')}</div>
    </div>
  );
}

function invert(c: string): string {
  return c === 'win' ? 'loss' : c === 'loss' ? 'win' : c;
}

function tbCategory(c: string): string {
  switch (c) {
    case 'win':
      return L('νίκη', 'win');
    case 'loss':
      return L('ήττα', 'loss');
    case 'draw':
      return L('ισοπαλία', 'draw');
    case 'cursed-win':
    case 'maybe-win':
      return L('νίκη (50 κιν.)', 'win (50-move)');
    case 'blessed-loss':
    case 'maybe-loss':
      return L('ήττα (50 κιν.)', 'loss (50-move)');
    default:
      return c;
  }
}
