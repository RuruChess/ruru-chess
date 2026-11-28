/**
 * Βάσεις → «Προεπισκόπηση βάσης»: κάτω από τις κάρτες, οι παρτίδες της
 * βάσης που διάλεξες με κλικ (αλλιώς αυτής που μελετούσες) και δίπλα σκακιέρα με την επιλεγμένη παρτίδα, κίνηση-κίνηση.
 * Στη γραμμή της, η «Συνέχεια μελέτης»: η τελευταία παρτίδα βάσης που μελέτησες, στην κίνηση όπου έμεινες.
 */
import { Fragment, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft, ChevronsRight, CirclePlay, FolderOpen, X } from 'lucide-react';
import { START_FEN } from '../../core/chess.ts';
import type { GameNode } from '../../core/game.ts';
import { parseGames } from '../../core/pgn.ts';
import { api, type DbInfo, type GameRow } from '../api.ts';
import { Board } from '../components/Board.tsx';
import { GameList } from '../components/GameList.tsx';
import { displaySan, type NotationStyle } from '../components/Notation.tsx';
import { L, fmtNum } from '../i18n.ts';
import { newTabId, reportError, useApp } from '../store.ts';
import type { StudyRecord } from '../study.ts';

/** «πριν από 5 λεπτά» / «χθες» / «12/10». */
export function ago(ms: number, now: number): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return L('μόλις τώρα', 'just now');
  if (m < 60) return L(`πριν από ${m} λεπτ${m === 1 ? 'ό' : 'ά'}`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 24) return L(`πριν από ${h} ώρ${h === 1 ? 'α' : 'ες'}`, `${h} h ago`);
  const d = Math.round(h / 24);
  if (d === 1) return L('χθες', 'yesterday');
  if (d < 7) return L(`πριν από ${d} μέρες`, `${d} days ago`);
  return new Date(ms).toLocaleDateString(L('el-GR', 'en-GB'), { day: 'numeric', month: 'numeric' });
}

/** «Κίνηση 5» από ημικίνηση (1 = η πρώτη κίνηση). */
const moveNo = (ply: number) => Math.ceil(ply / 2);

interface Props {
  /** η βάση που φαίνεται (null: καμία ακόμη) */
  db: DbInfo | null;
  /** η τελευταία παρτίδα βάσης που μελέτησε ο χρήστης, και η βάση της */
  study: StudyRecord | null;
  studyDb: DbInfo | null;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onClose: () => void;
  onOpenDb: (db: DbInfo) => void;
}

export function LibraryPreview({ db, study, studyDb, collapsed, onCollapse, onClose, onOpenDb }: Props) {
  const openTab = useApp((s) => s.openTab);
  const [sort, setSort] = useState<{ col: string; desc: boolean }>({ col: 'id', desc: false });
  const [view, setView] = useState<{ key: string; count: number } | null>(null);
  // η μελέτη ανήκει στη βάση που φαίνεται: η παρτίδα της επιλεγμένη, η σκακιέρα στην κίνηση όπου έμεινες
  const studied = study && db && study.dbId === db.id ? study : null;
  const [selected, setSelected] = useState<number | null>(studied?.gameId ?? null);
  // ← / → στη λίστα: κίνηση-κίνηση στη σκακιέρα δίπλα
  const previewStep = useRef<((dir: -1 | 1) => void) | null>(null);
  const importing = db?.busy?.kind === 'import';

  useEffect(() => {
    setSelected(studied?.gameId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db?.id, studied?.gameId]);

  useEffect(() => {
    setView(null);
    if (!db || collapsed || !db.games) return;
    let alive = true;
    api
      .post<{ key: string; count: number }>(`/api/db/${db.id}/view`, { sort })
      .then((r) => alive && setView(r))
      .catch(reportError);
    return () => {
      alive = false;
    };
  }, [db?.id, db?.games, sort, collapsed]);

  const openGame = (dbId: string, gameId: number, ply = 0, title = '…') => openTab({ id: newTabId('game'), kind: 'game', title, source: { dbId, gameId }, ...(ply ? { ply } : {}) });

  return (
    <section className={`lib-preview${collapsed ? ' collapsed' : ''}`} aria-label={L('Προεπισκόπηση βάσης', 'Database preview')}>
      <div className="lib-preview-bar">
        <span className="lib-preview-title">
          {L('Προεπισκόπηση βάσης', 'Database preview')}
          {db ? (
            <>
              : <b>{db.name}</b> <span className="muted">· {fmtNum(db.games)} {L('παρτίδες', 'games')}</span>
            </>
          ) : (
            <span className="muted"> · {L('κάνε κλικ σε μια βάση', 'click a database')}</span>
          )}
        </span>
        {study && studyDb && (
          <span className="lib-preview-study" title={L('Η τελευταία παρτίδα που μελέτησες', 'The last game you studied')}>
            <CirclePlay size={15} aria-hidden />
            <span className="lbl">{L('Συνέχεια μελέτης:', 'Continue studying:')}</span>
            <b className="ellipsis">{study.title}</b>
            <span className="muted">
              {[studyDb.id !== db?.id ? studyDb.name : '', study.ply ? L(`κίνηση ${moveNo(study.ply)}`, `move ${moveNo(study.ply)}`) : '', study.at ? ago(study.at, Date.now()) : ''].filter(Boolean).join(' · ')}
            </span>
            <button className="primary" onClick={() => openGame(study.dbId, study.gameId, study.ply, study.title)}>
              {L('Συνέχεια', 'Continue')}
            </button>
          </span>
        )}
        <span className="spacer" />
        {db && (
          <button className="icon-btn" title={L('Άνοιγμα της βάσης', 'Open the database')} aria-label={L('Άνοιγμα της βάσης', 'Open the database')} onClick={() => onOpenDb(db)}>
            <FolderOpen size={14} />
          </button>
        )}
        <button className="icon-btn" title={collapsed ? L('Άνοιγμα της προεπισκόπησης', 'Expand the preview') : L('Σύμπτυξη', 'Collapse')} aria-label={collapsed ? L('Άνοιγμα της προεπισκόπησης', 'Expand the preview') : L('Σύμπτυξη', 'Collapse')} onClick={() => onCollapse(!collapsed)}>
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button className="icon-btn" title={L('Κλείσιμο της προεπισκόπησης', 'Close the preview')} aria-label={L('Κλείσιμο της προεπισκόπησης', 'Close the preview')} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="lib-preview-body">
          <div className="lib-preview-list">
            {!db ? (
              <div className="lib-preview-empty muted">{L('Κάνε κλικ σε μια βάση για να δεις τις παρτίδες της· διπλό κλικ την ανοίγει.', 'Click a database to see its games; double-click opens it.')}</div>
            ) : importing && !db.games ? (
              <div className="lib-preview-empty muted">{L('Η βάση εισάγεται…', 'The database is being imported…')}</div>
            ) : !db.games ? (
              <div className="lib-preview-empty muted">{L('Η βάση δεν έχει ακόμη παρτίδες.', 'The database has no games yet.')}</div>
            ) : (
              <GameList
                dbId={db.id}
                viewKey={view?.key ?? null}
                count={view?.count ?? 0}
                sort={sort}
                onSort={(col) => setSort((s) => ({ col, desc: s.col === col ? !s.desc : col === 'date' || col === 'welo' || col === 'belo' }))}
                selected={new Set(selected === null ? [] : [selected])}
                onSelect={(_ids, row: GameRow | null) => row && setSelected(row.id)}
                onOpen={(row) => openGame(db.id, row.id)}
                onStep={(d) => previewStep.current?.(d)}
              />
            )}
          </div>
          <PreviewGame dbId={db?.id ?? null} gameId={selected} startPly={studied && selected === studied.gameId ? studied.ply : 0} onOpen={(ply, title) => db && selected !== null && openGame(db.id, selected, ply, title)} stepRef={previewStep} />
        </div>
      )}
    </section>
  );
}

/** Η επιλεγμένη παρτίδα: σκακιέρα, κίνηση-κίνηση με τα βελάκια, οι κινήσεις της κύριας γραμμής με κλικ, άνοιγμα. */
function PreviewGame({ dbId, gameId, startPly, onOpen, stepRef }: { dbId: string | null; gameId: number | null; startPly: number; onOpen: (ply: number, title: string) => void; stepRef: MutableRefObject<((dir: -1 | 1) => void) | null> }) {
  const settings = useApp((s) => s.settings);
  const style = (((settings?.ui as Record<string, unknown> | undefined)?.notation as NotationStyle | undefined) ?? 'figurine') as NotationStyle;
  const [g, setG] = useState<{ head: Record<string, string>; start: string; startTurn: number; startFullmove: number; main: GameNode[] } | null>(null);
  const [ply, setPly] = useState(0);

  useEffect(() => {
    setG(null);
    setPly(0);
    if (!dbId || gameId === null) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .get<{ pgn: string }>(`/api/db/${dbId}/game/${gameId}`)
        .then((r) => {
          if (!alive) return;
          const game = parseGames(r.pgn)[0]?.game;
          if (!game) return;
          const main = game.mainline();
          setG({ head: game.headers, start: game.startFen, startTurn: game.startTurn, startFullmove: game.startFullmove, main });
          setPly(Math.min(startPly, main.length));
        })
        .catch(() => {});
    }, 100);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [dbId, gameId, startPly]);

  if (!dbId || gameId === null) return <div className="lib-preview-game lib-preview-empty muted">{dbId ? L('Διάλεξε μια παρτίδα για να τη δεις εδώ.', 'Select a game to see it here.') : ''}</div>;
  const last = g ? g.main.length : 0;
  const node = g && ply > 0 ? g.main[ply - 1] : null;
  const fen = !g ? START_FEN : node ? node.fen : g.start;
  const name = (v: string | undefined) => (v && v !== '?' ? v.split(',')[0] : '?');
  const title = g ? `${name(g.head.White)} – ${name(g.head.Black)}` : '…';
  const go = (p: number) => setPly(Math.max(0, Math.min(last, p)));
  stepRef.current = (d) => go(ply + d);
  const label = (n: GameNode) => displaySan(n.san, style);

  return (
    <div
      className="lib-preview-game"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(ply - 1);
        else if (e.key === 'ArrowRight') go(ply + 1);
        else if (e.key === 'Home') go(0);
        else if (e.key === 'End') go(last);
        else if (e.key === 'Enter') onOpen(ply, title);
        else return;
        e.preventDefault();
      }}
    >
      <div className="lib-preview-board">
        <Board fen={fen} orientation="white" movable="none" lastMove={node?.move} theme={settings?.boardTheme} pieceSet={settings?.pieceSet} coordinates={false} />
      </div>
      <div className="lib-preview-nav">
        <button className="icon-btn" title={L('Αρχή (Home)', 'Start (Home)')} aria-label={L('Αρχή', 'Start')} disabled={!ply} onClick={() => go(0)}>
          <ChevronsLeft size={15} />
        </button>
        <button className="icon-btn" title={L('Πίσω (←)', 'Back (←)')} aria-label={L('Πίσω', 'Back')} disabled={!ply} onClick={() => go(ply - 1)}>
          <ChevronLeft size={15} />
        </button>
        <span className="tnum lib-preview-ply">{node ? `${node.moveNumber(g!.startFullmove, g!.startTurn)}${node.whiteMoved(g!.startTurn) ? '.' : '…'}${label(node)}` : L('αρχή', 'start')}</span>
        <button className="icon-btn" title={L('Μπροστά (→)', 'Forward (→)')} aria-label={L('Μπροστά', 'Forward')} disabled={ply >= last} onClick={() => go(ply + 1)}>
          <ChevronRight size={15} />
        </button>
        <button className="icon-btn" title={L('Τέλος (End)', 'End (End)')} aria-label={L('Τέλος', 'End')} disabled={ply >= last} onClick={() => go(last)}>
          <ChevronsRight size={15} />
        </button>
      </div>
      {g && (
        <>
          <div className="lib-preview-head">
            <b>{name(g.head.White)}</b>
            {g.head.WhiteElo ? ` (${g.head.WhiteElo})` : ''} – <b>{name(g.head.Black)}</b>
            {g.head.BlackElo ? ` (${g.head.BlackElo})` : ''} <span className="res">{g.head.Result && g.head.Result !== '*' ? g.head.Result : ''}</span>
          </div>
          <div className="muted small">{[g.head.Event, g.head.Date?.replace(/\.\?\?/g, '')].filter((x) => x && x !== '?').join(' · ')}</div>
          <div className="lib-preview-moves">
            {g.main.map((n, i) => (
              <Fragment key={i}>
                {(n.whiteMoved(g.startTurn) || i === 0) && <span className="mn">{`${n.moveNumber(g.startFullmove, g.startTurn)}${n.whiteMoved(g.startTurn) ? '.' : '…'}`}</span>}
                <button className={ply === i + 1 ? 'cur' : ''} onClick={() => go(i + 1)}>
                  {label(n)}
                </button>
              </Fragment>
            ))}
          </div>
          <button className="primary lib-preview-open" onClick={() => onOpen(ply, title)}>
            {L('Άνοιγμα στη σκακιέρα', 'Open on the board')}
          </button>
        </>
      )}
    </div>
  );
}
