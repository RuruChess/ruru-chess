/** Αναφορά ανοίγματος για την τρέχουσα θέση. */
import { useEffect, useState } from 'react';
import { Position } from '../../core/chess.ts';
import { api } from '../api.ts';
import { L, fmtNum } from '../i18n.ts';
import { useApp } from '../store.ts';
import { Dialog } from './ui.tsx';

interface ReportTree {
  indexed: boolean;
  total: number;
  moves: Array<{ san: string; uci: string; games: number; w: number; d: number; l: number; score: number; elo: number; perf: number; year: number }>;
}

interface GameRowLite {
  id: number;
  white: string;
  black: string;
  welo: number;
  belo: number;
  date: number;
  result: number;
}

interface Props {
  fen: string;
  opening: string;
  defaultDb: string | null;
  onOpenGame: (dbId: string, gameId: number, viewKey: string) => void;
  onClose: () => void;
}

export function OpeningReportDialog({ fen, opening, defaultDb, onOpenGame, onClose }: Props) {
  const library = useApp((s) => s.library);
  const dbs = library.filter((d) => !d.busy && d.games > 0).sort((a, b) => b.games - a.games);
  const [dbId, setDbId] = useState(defaultDb && dbs.some((d) => d.id === defaultDb) ? defaultDb : (dbs[0]?.id ?? ''));
  const [tree, setTree] = useState<ReportTree | null>(null);
  const [best, setBest] = useState<{ key: string; rows: GameRowLite[] } | null>(null);
  const [recent, setRecent] = useState<{ key: string; rows: GameRowLite[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!dbId) return;
    let alive = true;
    setTree(null);
    setBest(null);
    setRecent(null);
    setErr(null);
    const list = async (sort: { col: string; desc: boolean }) => {
      const v = await api.post<{ key: string }>(`/api/db/${dbId}/view`, { fen, sort });
      const r = await api.get<{ rows: GameRowLite[] }>(`/api/db/${dbId}/rows?key=${encodeURIComponent(v.key)}&offset=0&limit=12`);
      return { key: v.key, rows: r.rows };
    };
    (async () => {
      try {
        const t = await api.post<ReportTree>(`/api/db/${dbId}/tree`, { fen });
        if (!alive) return;
        setTree(t);
        const [b, r] = await Promise.all([list({ col: 'welo', desc: true }), list({ col: 'date', desc: true })]);
        if (!alive) return;
        setBest(b);
        setRecent(r);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dbId, fen]);

  const pos = Position.fromFen(fen);
  const tw = tree?.moves.reduce((a, m) => a + m.w, 0) ?? 0;
  const td = tree?.moves.reduce((a, m) => a + m.d, 0) ?? 0;
  const tl = tree?.moves.reduce((a, m) => a + m.l, 0) ?? 0;
  const bestScore = tree ? [...tree.moves].filter((m) => m.games >= 5).sort((a, b) => b.score - a.score)[0] : undefined;

  const gamesTable = (title: string, data: { key: string; rows: GameRowLite[] } | null) => (
    <div>
      <h3 className="sub">{title}</h3>
      <table className="data-table compact">
        <tbody>
          {(data?.rows ?? []).map((g) => (
            <tr key={g.id} className="clickable" onDoubleClick={() => onOpenGame(dbId, g.id, data!.key)} title={L('Διπλό κλικ για άνοιγμα', 'Double click to open')}>
              <td>
                {g.white.split(',')[0]} {g.welo ? `(${g.welo})` : ''} – {g.black.split(',')[0]} {g.belo ? `(${g.belo})` : ''}
              </td>
              <td className="num">{['*', '1-0', '½-½', '0-1'][g.result]}</td>
              <td className="num">{g.date ? Math.floor(g.date / 10000) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Dialog title={L('Αναφορά ανοίγματος', 'Opening report')} onClose={onClose} width={860}>
      <div className="row gap wrap">
        {opening && <b>{opening}</b>}
        <span className="spacer" />
        <select value={dbId} onChange={(e) => setDbId(e.target.value)}>
          {dbs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({fmtNum(d.games)})
            </option>
          ))}
        </select>
      </div>
      {err && <div className="error-text">{err}</div>}
      {tree && (
        <>
          <p>
            {fmtNum(tree.total)} {L('παρτίδες φτάνουν σε αυτή τη θέση', 'games reach this position')} · +{fmtNum(tw)} ={fmtNum(td)} −{fmtNum(tl)} ·{' '}
            {pos.turn === 0 ? L('παίζουν τα λευκά', 'White to move') : L('παίζουν τα μαύρα', 'Black to move')}
          </p>
          <h3 className="sub">{L('Συνέχειες', 'Continuations')}</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>{L('Κίνηση', 'Move')}</th>
                <th className="num">{L('Παρτίδες', 'Games')}</th>
                <th className="num">{L('Βαθμ.', 'Score')}</th>
                <th className="num">Elo</th>
                <th className="num">Perf</th>
                <th className="num">{L('Τελευταία', 'Last')}</th>
              </tr>
            </thead>
            <tbody>
              {tree.moves.slice(0, 12).map((m) => (
                <tr key={m.uci}>
                  <td>
                    <b>{m.san}</b>
                  </td>
                  <td className="num">{fmtNum(m.games)}</td>
                  <td className="num">{Math.round(m.score * 100)}%</td>
                  <td className="num">{m.elo || ''}</td>
                  <td className="num">{m.perf || ''}</td>
                  <td className="num">{m.year || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tree.moves.length > 1 && (
            <p className="small muted">
              {L('Καλύτερο σκορ', 'Best score')}: <b>{bestScore?.san ?? '–'}</b> · {L('Πιο δημοφιλής', 'Most popular')}: <b>{tree.moves[0]?.san}</b>
            </p>
          )}
          <div className="two-col">
            {gamesTable(L('Παρτίδες με το υψηλότερο Elo', 'Highest rated games'), best)}
            {gamesTable(L('Πιο πρόσφατες παρτίδες', 'Most recent games'), recent)}
          </div>
        </>
      )}
      {!tree && !err && <div className="muted">…</div>}
    </Dialog>
  );
}
