/** Διάλογοι του παραθύρου σκακιέρας. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BLACK_BIT, Position, START_FEN, BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, chess960Fen } from '../../core/chess.ts';
import type { GameNode } from '../../core/game.ts';
import { EVAL_NAGS, MOVE_NAGS, NAG_NAMES, OTHER_NAGS, nagGroup, nagSymbol } from '../../core/nag.ts';
import { MEDALS, medalsToText, textToMedals } from '../../core/medals.ts';
import { api, onServerEvent, pickFiles, type DbInfo } from '../api.ts';
import { L, fmtNum, language } from '../i18n.ts';
import { useApp } from '../store.ts';
import type { GameController } from '../gameModel.ts';
import { annotateGame, type GameEval, type PlayerSummary } from '../annotate.ts';
import { Board, pieceUrl } from './Board.tsx';
import { Dialog, Field, Progress, WinDialog } from './ui.tsx';

// ---------------------------------------------------------------------------
// Παλέτα συμβόλων

export function NagPalette({ ctrl, node }: { ctrl: GameController; node: GameNode }) {
  const group = (nags: number[]) =>
    nags.map((n) => (
      <button
        key={n}
        className={`nag-btn${node.nags.includes(n) ? ' on' : ''}`}
        disabled={node.isRoot}
        title={NAG_NAMES[n] ? (language() === 'el' ? NAG_NAMES[n].el : NAG_NAMES[n].en) : `$${n}`}
        onClick={() => ctrl.toggleNag(node, n, nagGroup(n))}
      >
        {nagSymbol(n)}
      </button>
    ));
  return (
    <div className="nag-palette">
      <div className="nag-row">{group(MOVE_NAGS)}</div>
      <div className="nag-row">{group(EVAL_NAGS)}</div>
      <div className="nag-row">{group(OTHER_NAGS)}</div>
      <div className="nag-row">
        <button className="nag-btn wide" disabled={node.isRoot || !node.nags.length} onClick={() => ctrl.clearNags(node)}>
          {L('Καθαρισμός συμβόλων', 'Clear symbols')}
        </button>
        <button className="nag-btn wide" disabled={!node.shapes.length} onClick={() => ctrl.clearShapes(node)}>
          {L('Καθαρισμός γραφικών', 'Clear graphics')}
        </button>
      </div>
      <div className="muted tiny">{L('Γραφικά: δεξί κλικ / σύρσιμο στη σκακιέρα (Shift κόκκινο, Alt κίτρινο, Ctrl μπλε).', 'Graphics: right click / drag on the board (Shift red, Alt yellow, Ctrl blue).')}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Σχόλιο

export function CommentDialog({ ctrl, node, before, onClose }: { ctrl: GameController; node: GameNode; before: boolean; onClose: () => void }) {
  const [text, setText] = useState(before ? node.preComment : node.comment);
  const save = () => {
    ctrl.setComment(node, text, before);
    onClose();
  };
  return (
    <Dialog
      title={node.isRoot ? L('Σχόλιο παρτίδας', 'Game comment') : before ? L(`Σχόλιο πριν από το ${node.san}`, `Comment before ${node.san}`) : L(`Σχόλιο μετά το ${node.san}`, `Comment after ${node.san}`)}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
          <button className="primary" onClick={save}>
            OK
          </button>
        </>
      }
    >
      <textarea
        autoFocus
        className="comment-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
        }}
        rows={6}
      />
      <div className="muted tiny">{L('Ctrl+Enter για αποθήκευση', 'Ctrl+Enter to save')}</div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Κεφαλίδα παρτίδας

const MAIN_TAGS: Array<[string, string, string]> = [
  ['White', 'Λευκά', 'White'],
  ['WhiteElo', 'Elo λευκών', 'White Elo'],
  ['Black', 'Μαύρα', 'Black'],
  ['BlackElo', 'Elo μαύρων', 'Black Elo'],
  ['Event', 'Τουρνουά', 'Event'],
  ['Site', 'Τόπος', 'Site'],
  ['Date', 'Ημερομηνία', 'Date'],
  ['Round', 'Γύρος', 'Round'],
  ['ECO', 'ECO', 'ECO'],
  ['Annotator', 'Σχολιαστής', 'Annotator'],
];

/** `onOk`: αντί για `onClose` μετά το OK (π.χ. η πρώτη αποθήκευση συνεχίζει) */
export function HeaderDialog({ ctrl, onClose, onOk }: { ctrl: GameController; onClose: () => void; onOk?: () => void }) {
  const [h, setH] = useState<Record<string, string>>({ ...ctrl.game.headers });
  const [newKey, setNewKey] = useState('');
  const set = (k: string, v: string) => setH((x) => ({ ...x, [k]: v }));
  const extra = Object.keys(h).filter((k) => !MAIN_TAGS.some(([t]) => t === k) && !['Result', 'FEN', 'SetUp', 'Medals'].includes(k));
  const medals = textToMedals(h.Medals);
  const toggleMedal = (i: number) => set('Medals', medalsToText(medals ^ (1 << i)));
  return (
    <Dialog
      title={L('Στοιχεία παρτίδας', 'Game data')}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
          <button
            className="primary"
            onClick={() => {
              const clean: Record<string, string> = {};
              for (const [k, v] of Object.entries(h)) if (v !== undefined && v !== '') clean[k] = v;
              ctrl.setHeaders(clean);
              (onOk ?? onClose)();
            }}
          >
            OK
          </button>
        </>
      }
    >
      <div className="form-grid">
        {MAIN_TAGS.map(([k, el, en]) => (
          <Field key={k} label={L(el, en)}>
            <input value={h[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={k === 'Date' ? '2024.05.17' : ''} />
          </Field>
        ))}
        <Field label={L('Αποτέλεσμα', 'Result')}>
          <select value={h.Result ?? '*'} onChange={(e) => set('Result', e.target.value)}>
            <option value="1-0">1-0</option>
            <option value="1/2-1/2">½-½</option>
            <option value="0-1">0-1</option>
            <option value="*">*</option>
          </select>
        </Field>
      </div>
      <h3 className="sub">{L('Μετάλλια', 'Medals')}</h3>
      <div className="medal-grid">
        {MEDALS.map((m, i) => (
          <label key={m.key} className="check">
            <input type="checkbox" checked={Boolean(medals & (1 << i))} onChange={() => toggleMedal(i)} /> {language() === 'el' ? m.el : m.en}
          </label>
        ))}
      </div>
      {extra.length > 0 && <h3 className="sub">{L('Άλλες ετικέτες', 'Other tags')}</h3>}
      <div className="form-grid">
        {extra.map((k) => (
          <Field key={k} label={k}>
            <input value={h[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
      </div>
      <div className="row gap">
        <input value={newKey} onChange={(e) => setNewKey(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} placeholder={L('Νέα ετικέτα (π.χ. TimeControl)', 'New tag (e.g. TimeControl)')} />
        <button
          disabled={!newKey}
          onClick={() => {
            set(newKey, '');
            setNewKey('');
          }}
        >
          {L('Προσθήκη', 'Add')}
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Θέση (επεξεργασία θέσης)

const PALETTE = [KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN];

export function SetupDialog({ initialFen, onClose, onDone }: { initialFen: string; onClose: () => void; onDone: (fen: string) => void }) {
  const settings = useApp((s) => s.settings);
  const parse = (fen: string) => {
    const parts = fen.split(' ');
    const board = new Int8Array(128);
    const rows = parts[0].split('/');
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else {
          const idx = ' PNBRQK  pnbrqk'.indexOf(ch);
          if (idx > 0 && f < 8) board[(7 - r) * 16 + f] = idx;
          f++;
        }
      }
    });
    return { board, turn: parts[1] === 'b' ? 1 : 0, castling: parts[2] ?? '-', ep: parts[3] ?? '-', move: Number(parts[5] ?? 1) || 1 };
  };
  const init = parse(initialFen);
  const [board, setBoard] = useState(init.board);
  const [turn, setTurn] = useState(init.turn);
  const [castling, setCastling] = useState(init.castling === '-' ? '' : init.castling);
  const [ep, setEp] = useState(init.ep);
  const [moveNo, setMoveNo] = useState(init.move);
  const [brush, setBrush] = useState<number>(PAWN);
  const [fenText, setFenText] = useState('');

  const fen = useMemo(() => {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = board[r * 16 + f];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) s += empty;
        empty = 0;
        s += ' PNBRQK  pnbrqk'[p];
      }
      if (empty) s += empty;
      if (r) s += '/';
    }
    return `${s} ${turn ? 'b' : 'w'} ${castling || '-'} ${ep || '-'} 0 ${moveNo}`;
  }, [board, turn, castling, ep, moveNo]);

  useEffect(() => setFenText(fen), [fen]);

  const validation = useMemo(() => {
    const placed = fen.split(' ')[0];
    if (!placed.includes('K') || !placed.includes('k')) return L('Τοποθέτησε και τους δύο βασιλιάδες.', 'Place both kings.');
    try {
      const p = Position.fromFen(fen);
      // ο παίκτης που δεν παίζει δεν μπορεί να είναι σε σαχ
      if (p.isAttacked(p.kingSq[p.turn ^ 1], p.turn)) return L('Ο βασιλιάς της πλευράς που δεν παίζει είναι σε σαχ.', 'The side not to move is in check.');
      for (let f = 0; f < 8; f++) if ((board[f] & 7) === PAWN || (board[0x70 + f] & 7) === PAWN) return L('Πιόνι στην πρώτη ή τελευταία γραμμή.', 'Pawn on first or last rank.');
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [fen, board]);

  const apply = (sq: number, button: number) => {
    const b = board.slice();
    if (button === 2) b[sq] = 0;
    else if (brush === 0) b[sq] = 0;
    else b[sq] = b[sq] === brush ? 0 : brush;
    // ένας βασιλιάς ανά χρώμα
    if ((brush & 7) === KING && button !== 2) for (let s = 0; s < 128; s++) if (s !== sq && b[s] === brush) b[s] = 0;
    setBoard(b);
  };

  const toggleCastle = (c: string) => setCastling((x) => (x.includes(c) ? x.replace(c, '') : 'KQkq'.split('').filter((k) => k === c || x.includes(k)).join('')));

  return (
    <Dialog
      title={L('Θέση', 'Set up position')}
      onClose={onClose}
      width={860}
      footer={
        <>
          {validation && <span className="error-text">{validation}</span>}
          <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
          <button className="primary" disabled={Boolean(validation)} onClick={() => onDone(Position.fromFen(fen).fen())}>
            OK
          </button>
        </>
      }
    >
      <div className="setup">
        <div className="setup-board">
          <Board fen={fen} orientation="white" movable="none" theme={settings?.boardTheme} pieceSet={settings?.pieceSet} onSquareClick={apply} />
        </div>
        <div className="setup-side">
          <div className="palette">
            {[0, BLACK_BIT].map((color) => (
              <div key={color} className="palette-row">
                {PALETTE.map((t) => {
                  const p = t | color;
                  return (
                    <button key={p} className={brush === p ? 'on' : ''} onClick={() => setBrush(p)}>
                      <img src={pieceUrl(settings?.pieceSet ?? 'cburnett', p)} alt="" />
                    </button>
                  );
                })}
              </div>
            ))}
            <button className={brush === 0 ? 'on wide' : 'wide'} onClick={() => setBrush(0)}>
              {L('Γόμα', 'Eraser')}
            </button>
          </div>
          <div className="muted tiny">{L('Αριστερό κλικ: τοποθέτηση · δεξί κλικ: αφαίρεση', 'Left click: place · right click: remove')}</div>
          <Field label={L('Παίζουν', 'To move')}>
            <select value={turn} onChange={(e) => setTurn(Number(e.target.value))}>
              <option value={0}>{L('Λευκά', 'White')}</option>
              <option value={1}>{L('Μαύρα', 'Black')}</option>
            </select>
          </Field>
          <div className="field">
            <span>{L('Ροκέ', 'Castling')}</span>
            <div className="row gap">
              {['K', 'Q', 'k', 'q'].map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={castling.includes(c)} onChange={() => toggleCastle(c)} />
                  {c === 'K' ? 'O-O' : c === 'Q' ? 'O-O-O' : c === 'k' ? '...O-O' : '...O-O-O'}
                </label>
              ))}
            </div>
          </div>
          <Field label="En passant">
            <select value={ep} onChange={(e) => setEp(e.target.value)}>
              <option value="-">–</option>
              {'abcdefgh'.split('').map((f) => {
                const sq = `${f}${turn === 0 ? 6 : 3}`;
                return (
                  <option key={sq} value={sq}>
                    {sq}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label={L('Αριθμός κίνησης', 'Move number')}>
            <input type="number" min={1} value={moveNo} onChange={(e) => setMoveNo(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="FEN" wide>
            <input
              value={fenText}
              onChange={(e) => setFenText(e.target.value)}
              onBlur={() => {
                try {
                  const p = parse(Position.fromFen(fenText).fen());
                  setBoard(p.board);
                  setTurn(p.turn);
                  setCastling(p.castling === '-' ? '' : p.castling);
                  setEp(p.ep);
                  setMoveNo(p.move);
                } catch {
                  setFenText(fen);
                }
              }}
            />
          </Field>
          <div className="row gap wrap">
            <button onClick={() => {
              const p = parse(START_FEN);
              setBoard(p.board);
              setTurn(0);
              setCastling('KQkq');
              setEp('-');
              setMoveNo(1);
            }}>{L('Αρχική θέση', 'Start position')}</button>
            <button
              title={L('Τυχαία αρχική θέση Chess960 (μία από τις 960)', 'Random Chess960 start position (one of 960)')}
              onClick={() => {
                const p = parse(chess960Fen(Math.floor(Math.random() * 960)));
                setBoard(p.board);
                setTurn(0);
                setCastling('KQkq');
                setEp('-');
                setMoveNo(1);
              }}
            >
              Chess960
            </button>
            <button onClick={() => {
              setBoard(new Int8Array(128));
              setCastling('');
              setEp('-');
            }}>{L('Άδεια σκακιέρα', 'Empty board')}</button>
            <button onClick={() => {
              // αντιστροφή χρωμάτων
              const b = new Int8Array(128);
              for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
                const p = board[r * 16 + f];
                if (p) b[(7 - r) * 16 + f] = p ^ BLACK_BIT;
              }
              setBoard(b);
              setTurn(turn ^ 1);
            }}>{L('Αντιστροφή χρωμάτων', 'Swap colours')}</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Αποθήκευση

/**
 * «Επιλογή βάσης»: λίστα με τις βάσεις, OK / Νέα βάση… / Άκυρο. Η παρτίδα
 * αποθηκεύεται ως νέα στη βάση που διαλέγεις (διπλό κλικ ή Enter = OK).
 */
export function SaveDialog({ ctrl, source, onClose, onSaved }: { ctrl: GameController; source?: { dbId: string; gameId: number }; onClose: () => void; onSaved: (dbId: string, gameId: number) => void }) {
  const library = useApp((s) => s.library);
  const settings = useApp((s) => s.settings);
  const writable = library.filter((d) => !d.busy);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const last = writable.find((d) => d.id === ui.lastSaveDb);
  const mine = writable.find((d) => d.kind === 'mygames');
  const [target, setTarget] = useState(source?.dbId ?? last?.id ?? mine?.id ?? writable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.focus();
    listRef.current?.querySelector('.win-row.on')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const save = async (dbId: string) => {
    if (!dbId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ ids: number[] }>(`/api/db/${dbId}/games`, { pgn: ctrl.pgn() });
      if (ui.lastSaveDb !== dbId) void useApp.getState().saveUi({ lastSaveDb: dbId }).catch(() => {});
      ctrl.markSaved();
      onSaved(dbId, r.ids[0]);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  // «Νέα βάση…»: όνομα και φάκελος από το παράθυρο των Windows, και αποθήκευση εκεί
  const newDb = async () => {
    setErr(null);
    try {
      const file = (await pickFiles('savedb', { name: `${L('Νέα βάση', 'New database')}.kbdb` }))[0];
      if (!file) return;
      const name = file.split(/[\\/]/).pop()!.replace(/\.(kbdb|skdb)$/i, '');
      const r = await api.post<{ entry: DbInfo }>('/api/library/new', { name, file });
      await useApp.getState().refreshLibrary();
      await save(r.entry.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const i = writable.findIndex((d) => d.id === target);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = writable[Math.max(0, Math.min(writable.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setTarget(next.id);
      setTimeout(() => listRef.current?.querySelector('.win-row.on')?.scrollIntoView({ block: 'nearest' }), 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void save(target);
    }
  };
  return (
    <WinDialog
      title={L('Επιλογή βάσης', 'Select database')}
      width={460}
      onClose={onClose}
      footer={
        <>
          {err && <span className="error-text small">{err}</span>}
          <button className="win-btn default" disabled={busy || !target} onClick={() => void save(target)}>
            OK
          </button>
          <button className="win-btn" disabled={busy} onClick={() => void newDb()}>
            {L('Νέα βάση…', 'New database…')}
          </button>
          <button className="win-btn" onClick={onClose}>
            {L('Άκυρο', 'Cancel')}
          </button>
        </>
      }
    >
      <div className="win-list" ref={listRef} tabIndex={0} role="listbox" onKeyDown={onKey}>
        <div className="win-list-head">
          <span>{L('Τίτλος', 'Title')}</span>
          <span>{L('Παρτίδες', 'Games')}</span>
        </div>
        {writable.map((d: DbInfo) => (
          <div key={d.id} role="option" aria-selected={d.id === target} className={`win-row${d.id === target ? ' on' : ''}`} onClick={() => setTarget(d.id)} onDoubleClick={() => void save(d.id)} title={d.file}>
            <span>{d.name}</span>
            <span>{fmtNum(d.games)}</span>
          </div>
        ))}
      </div>
    </WinDialog>
  );
}

// ---------------------------------------------------------------------------
// Πλήρης ανάλυση / έλεγχος λαθών

export function FullAnalysisDialog({ ctrl, onClose, onDone }: { ctrl: GameController; onClose: () => void; onDone: (evals: GameEval[], summary: { white: PlayerSummary; black: PlayerSummary }) => void }) {
  const settings = useApp((s) => s.settings);
  const engines = (settings?.engines ?? []).filter((e) => !e.human);
  const [engineId, setEngineId] = useState(settings?.defaultEngine ?? engines[0]?.id ?? '');
  const [secs, setSecs] = useState(1);
  const [variations, setVariations] = useState(true);
  const [evals, setEvals] = useState(true);
  const [blundersOnly, setBlundersOnly] = useState(false);
  const [job, setJob] = useState<{ id: string; done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!job) return;
    return onServerEvent('gameAnalysis', async (ev: { id: string; status: string; done: number; total: number; error?: string }) => {
      if (ev.id !== job.id) return;
      setJob({ id: job.id, done: ev.done, total: ev.total });
      if (ev.status === 'error') setErr(ev.error ?? 'Σφάλμα');
      if (ev.status === 'done') {
        const full = await api.get<{ evals: GameEval[] }>(`/api/analysis/game/${job.id}`);
        const summary = annotateGame(ctrl, full.evals, { variations, evals, blundersOnly });
        onDone(full.evals, summary);
        onClose();
      }
    });
  }, [job, ctrl, variations, evals, blundersOnly, onDone, onClose]);

  const start = async () => {
    setErr(null);
    const fens = [ctrl.game.root, ...ctrl.game.mainline()].map((n) => n.fen);
    try {
      const r = await api.post<{ id: string; total: number }>('/api/analysis/game', { engineId, fens, movetime: Math.round(secs * 1000) });
      setJob({ id: r.id, done: 0, total: r.total });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const plies = ctrl.game.plyCount();
  return (
    <Dialog
      title={L('Πλήρης ανάλυση (έλεγχος λαθών)', 'Full analysis (blunder check)')}
      onClose={() => {
        if (job) void api.post(`/api/analysis/game/${job.id}/cancel`);
        onClose();
      }}
      footer={
        <>
          {err && <span className="error-text">{err}</span>}
          <button className="primary" disabled={Boolean(job) || !engineId || !plies} onClick={() => void start()}>
            {L('Έναρξη', 'Start')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={L('Μηχανή', 'Engine')}>
          <select value={engineId} onChange={(e) => setEngineId(e.target.value)} disabled={Boolean(job)}>
            {engines.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={L('Χρόνος ανά θέση (δευτ.)', 'Time per position (s)')}>
          <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} disabled={Boolean(job)}>
            {[0.3, 0.5, 1, 2, 3, 5, 10].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={variations} onChange={(e) => setVariations(e.target.checked)} /> {L('Πρόσθεσε βαριάντες με την καλύτερη συνέχεια', 'Add variations with the best line')}
      </label>
      <label className="check">
        <input type="checkbox" checked={evals} onChange={(e) => setEvals(e.target.checked)} /> {L('Γράψε την αξιολόγηση σε κάθε κίνηση', 'Write the evaluation after each move')}
      </label>
      <label className="check">
        <input type="checkbox" checked={blundersOnly} onChange={(e) => setBlundersOnly(e.target.checked)} /> {L('Μόνο λάθη και σοβαρά λάθη (όχι ανακρίβειες)', 'Only mistakes and blunders (no inaccuracies)')}
      </label>
      <p className="muted small">
        {L(`${plies} ημικινήσεις · περίπου ${Math.ceil(((plies + 1) * secs) / 60)} λεπτά`, `${plies} plies · about ${Math.ceil(((plies + 1) * secs) / 60)} min`)}
      </p>
      {job && <Progress value={job.total ? job.done / job.total : 0} label={`${job.done} / ${job.total}`} />}
    </Dialog>
  );
}

export function SummaryDialog({ summary, white, black, onClose }: { summary: { white: PlayerSummary; black: PlayerSummary }; white: string; black: string; onClose: () => void }) {
  const row = (name: string, s: PlayerSummary) => (
    <tr>
      <td>{name}</td>
      <td className="num">{s.accuracy}%</td>
      <td className="num">{s.acpl}</td>
      <td className="num">{s.inaccuracies}</td>
      <td className="num">{s.mistakes}</td>
      <td className="num">{s.blunders}</td>
    </tr>
  );
  return (
    <Dialog title={L('Αποτέλεσμα ανάλυσης', 'Analysis result')} onClose={onClose} footer={<button className="primary" onClick={onClose}>OK</button>}>
      <table className="data-table">
        <thead>
          <tr>
            <th>{L('Παίκτης', 'Player')}</th>
            <th className="num">{L('Ακρίβεια', 'Accuracy')}</th>
            <th className="num" title={L('Μέση απώλεια σε εκατοστά πιονιού', 'Average centipawn loss')}>ACPL</th>
            <th className="num">?!</th>
            <th className="num">?</th>
            <th className="num">??</th>
          </tr>
        </thead>
        <tbody>
          {row(white || L('Λευκά', 'White'), summary.white)}
          {row(black || L('Μαύρα', 'Black'), summary.black)}
        </tbody>
      </table>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Παιχνίδι εναντίον μηχανής

export interface PlaySettings {
  color: 'white' | 'black';
  level: number;
  movetime: number;
  /** ρολόι σε δευτερόλεπτα (βάση + προσαύξηση ανά κίνηση)· χωρίς ρολόι η μηχανή σκέφτεται movetime */
  clock: { base: number; inc: number } | null;
}

/** Χρονικοί έλεγχοι bullet / blitz / rapid (λεπτά + δευτερόλεπτα προσαύξησης). */
const TIME_CONTROLS = ['1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10', '30+0'];

export function PlayDialog({ onClose, onStart }: { onClose: () => void; onStart: (s: PlaySettings) => void }) {
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');
  const [level, setLevel] = useState(8);
  const [movetime, setMovetime] = useState(1000);
  const [tc, setTc] = useState('');
  const clock = tc ? { base: Number(tc.split('+')[0]) * 60, inc: Number(tc.split('+')[1]) } : null;
  return (
    <Dialog
      title={L('Παιχνίδι με τη μηχανή', 'Play against the engine')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
          <button className="primary" onClick={() => onStart({ color: color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color, level, movetime, clock })}>
            {L('Έναρξη', 'Start')}
          </button>
        </>
      }
    >
      <Field label={L('Παίζω με', 'I play')}>
        <select value={color} onChange={(e) => setColor(e.target.value as 'white')}>
          <option value="white">{L('Λευκά', 'White')}</option>
          <option value="black">{L('Μαύρα', 'Black')}</option>
          <option value="random">{L('Τυχαία', 'Random')}</option>
        </select>
      </Field>
      <Field label={`${L('Δύναμη μηχανής', 'Engine strength')}: ${level}/20`} wide>
        <input type="range" min={0} max={20} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
      </Field>
      <Field label={L('Ρολόι', 'Clock')}>
        <select value={tc} onChange={(e) => setTc(e.target.value)}>
          <option value="">{L('Χωρίς ρολόι', 'No clock')}</option>
          {TIME_CONTROLS.map((t) => (
            <option key={t} value={t}>
              {t.replace('+', ' + ')} {Number(t.split('+')[0]) < 3 ? '(bullet)' : Number(t.split('+')[0]) < 10 ? '(blitz)' : '(rapid)'}
            </option>
          ))}
        </select>
      </Field>
      {!clock && (
        <Field label={L('Χρόνος σκέψης μηχανής', 'Engine thinking time')}>
          <select value={movetime} onChange={(e) => setMovetime(Number(e.target.value))}>
            {[200, 500, 1000, 2000, 5000].map((t) => (
              <option key={t} value={t}>
                {t / 1000} s
              </option>
            ))}
          </select>
        </Field>
      )}
      <p className="muted small">{L('Η παρτίδα ξεκινά από την τρέχουσα θέση της σκακιέρας.', 'The game starts from the current board position.')}</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Προσθήκη της τρέχουσας γραμμής σε βάση ρεπερτορίου

export function RepertoireAddDialog({ ctrl, node, opening, onClose }: { ctrl: GameController; node: GameNode; opening: string; onClose: () => void }) {
  const library = useApp((s) => s.library);
  const toast = useApp((s) => s.toast);
  const writable = library.filter((d) => !d.busy && d.kind !== 'clipboard');
  const [target, setTarget] = useState(writable.find((d) => /ρεπερτ|repert/i.test(d.name))?.id ?? '');
  const [color, setColor] = useState<'white' | 'black'>(node.ply % 2 === 1 ? 'white' : 'black');
  const [busy, setBusy] = useState(false);
  const path = ctrl.game.pathTo(node);
  const lineText = path.map((n) => (n.whiteMoved(ctrl.game.startTurn) ? `${n.moveNumber(ctrl.game.startFullmove, ctrl.game.startTurn)}. ${n.san}` : n.san)).join(' ');
  const save = async () => {
    setBusy(true);
    try {
      let id = target;
      if (!id) {
        const r = await api.post<{ entry: DbInfo }>('/api/library/new', { name: L('Ρεπερτόριο', 'Repertoire') });
        id = r.entry.id;
      }
      const head = [
        `[Event "${L('Ρεπερτόριο', 'Repertoire')} ${color === 'white' ? L('λευκών', 'White') : L('μαύρων', 'Black')}"]`,
        `[White "${color === 'white' ? L('Ρεπερτόριο', 'Repertoire') : '?'}"]`,
        `[Black "${color === 'black' ? L('Ρεπερτόριο', 'Repertoire') : '?'}"]`,
        `[Result "*"]`,
        opening ? `[Annotator "${opening.replace(/"/g, "'")}"]` : '',
        ctrl.game.isStandardStart ? '' : `[SetUp "1"]\n[FEN "${ctrl.game.startFen}"]`,
      ]
        .filter(Boolean)
        .join('\n');
      await api.post(`/api/db/${id}/games`, { pgn: `${head}\n\n${lineText} *\n` });
      toast(L('Η γραμμή προστέθηκε στο ρεπερτόριο', 'Line added to the repertoire'), 'ok');
      void useApp.getState().refreshLibrary();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={L('Προσθήκη στο ρεπερτόριο', 'Add to repertoire')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
          <button className="primary" disabled={busy || !path.length} onClick={() => void save()}>
            {L('Προσθήκη', 'Add')}
          </button>
        </>
      }
    >
      <p className="small">{lineText || L('(καμία κίνηση)', '(no moves)')}</p>
      <div className="form-grid">
        <Field label={L('Βάση ρεπερτορίου', 'Repertoire database')}>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{L('Νέα βάση «Ρεπερτόριο»', 'New “Repertoire” database')}</option>
            {writable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={L('Χρώμα', 'Colour')}>
          <select value={color} onChange={(e) => setColor(e.target.value as 'white' | 'black')}>
            <option value="white">{L('Λευκά', 'White')}</option>
            <option value="black">{L('Μαύρα', 'Black')}</option>
          </select>
        </Field>
      </div>
      <p className="muted small">{L('Μετά, στην καρτέλα «Ρεπερτόριο» της βάσης, η αναφορά δείχνει τις νέες παρτίδες στις γραμμές σου.', 'Then the “Repertoire” tab of that database shows new games in your lines.')}</p>
    </Dialog>
  );
}

/**
 * Εύρεση καινοτομίας: η πρώτη κίνηση της κύριας γραμμής
 * που οδηγεί σε θέση χωρίς παλαιότερες παρτίδες στη βάση αναφοράς· σημειώνεται με N ($146).
 */
export function NoveltyDialog({ ctrl, source, defaultDb, onClose }: { ctrl: GameController; source?: { dbId: string; gameId?: number }; defaultDb: string | null; onClose: () => void }) {
  const library = useApp((s) => s.library);
  const dbs = library.filter((d) => !d.busy && d.games > 0).sort((a, b) => b.games - a.games);
  const [dbId, setDbId] = useState(defaultDb && dbs.some((d) => d.id === defaultDb) ? defaultDb : (dbs[0]?.id ?? ''));
  const [res, setRes] = useState<{ index: number; limited: boolean; before: number; ply?: number; beyondIndex?: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const main = useMemo(() => ctrl.game.mainline(), [ctrl]);

  useEffect(() => {
    if (!dbId) return;
    let alive = true;
    setRes(null);
    setErr(null);
    api
      .post<{ index: number; limited: boolean; before: number; ply?: number; beyondIndex?: boolean }>(`/api/db/${dbId}/novelty`, {
        fens: main.map((n) => n.fen),
        date: ctrl.game.headers.Date,
        white: ctrl.game.headers.White,
        black: ctrl.game.headers.Black,
        gameId: source?.dbId === dbId ? source.gameId : undefined,
      })
      .then((r) => alive && setRes(r))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [dbId, main, ctrl, source]);

  const g = ctrl.game;
  const node = res && res.index >= 0 ? main[res.index] : null;
  const moveText = (n: GameNode) => `${n.moveNumber(g.startFullmove, g.startTurn)}${n.whiteMoved(g.startTurn) ? '.' : '…'}${n.san}`;
  const mark = () => {
    if (!node) return;
    ctrl.edit(() => {
      if (!node.nags.includes(146)) node.nags.push(146);
    });
    ctrl.goTo(node);
    onClose();
  };

  return (
    <Dialog
      title={L('Εύρεση καινοτομίας', 'Find novelty')}
      onClose={onClose}
      width={520}
      footer={
        <>
          {err && <span className="error-text">{err}</span>}
          <button onClick={onClose}>{L('Κλείσιμο', 'Close')}</button>
          <button className="primary" disabled={!node} onClick={mark}>
            {L('Σήμανση με N', 'Mark with N')}
          </button>
        </>
      }
    >
      <Field label={L('Βάση αναφοράς', 'Reference database')} wide>
        <select value={dbId} onChange={(e) => setDbId(e.target.value)}>
          {dbs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({fmtNum(d.games)})
            </option>
          ))}
        </select>
      </Field>
      {!main.length ? (
        <p className="muted">{L('Η παρτίδα δεν έχει κινήσεις.', 'The game has no moves.')}</p>
      ) : !res ? (
        !err && <p className="muted">{L('Αναζήτηση…', 'Searching…')}</p>
      ) : node ? (
        <p>
          {L('Καινοτομία:', 'Novelty:')} <b>{moveText(node)}</b>{' '}
          {res.before === 1
            ? L('— η θέση πριν από την κίνηση υπήρχε σε 1 παλαιότερη παρτίδα.', '— the position before it occurred in 1 earlier game.')
            : L(`— η θέση πριν από την κίνηση υπήρχε σε ${fmtNum(res.before)} παλαιότερες παρτίδες.`, `— the position before it occurred in ${fmtNum(res.before)} earlier games.`)}
          {res.beyondIndex && (
            <span className="muted small">
              {' '}
              {L(
                '(Πέρα από το βάθος του ευρετηρίου θέσεων ακολουθήθηκαν μόνο οι παρτίδες της τελευταίας θέσης του, χωρίς μεταθέσεις.)',
                '(Beyond the depth of the position index only the games of its last position were followed, without transpositions.)',
              )}
            </span>
          )}
        </p>
      ) : res.limited ? (
        <p>
          {L(
            `Δεν βρέθηκε μέσα στο βάθος του ευρετηρίου της βάσης: μέχρι το ${moveText(main[Math.max(0, (res.ply ?? 1) - 1)])} υπήρχαν παρτίδες.`,
            `Not found within the depth of the database index: games exist up to ${moveText(main[Math.max(0, (res.ply ?? 1) - 1)])}.`,
          )}
        </p>
      ) : (
        <p>{L('Όλες οι θέσεις της κύριας γραμμής υπάρχουν σε παλαιότερες παρτίδες της βάσης.', 'Every position of the main line occurs in earlier games of the database.')}</p>
      )}
    </Dialog>
  );
}
