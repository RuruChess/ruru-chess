/** Καρτέλες του παραθύρου βάσης: Παίκτες, Τουρνουά, Ανοίγματα, Στατιστικά, Προεπισκόπηση. */
import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Search } from 'lucide-react';
import { Position, START_FEN } from '../../../core/chess.ts';
import { parseGames } from '../../../core/pgn.ts';
import type { GameNode } from '../../../core/game.ts';
import type { TiebreakKey, Tiebreaks } from '../../../core/tiebreak.ts';
import { api, type GameRow } from '../../api.ts';
import { L, fmtDate, fmtNum, resultText } from '../../i18n.ts';
import { reportError, useApp } from '../../store.ts';
import { Board } from '../../components/Board.tsx';
import { useDrawnShapes } from '../../components/drawnShapes.ts';
import { TreePanel, ScoreBar } from '../../components/TreePanel.tsx';
import { displaySan, type NotationStyle } from '../../components/Notation.tsx';
import { useEcoBook } from '../../eco.ts';

// ---------------------------------------------------------------------------
// Παίκτες

interface PlayerRow {
  id: number;
  name: string;
  games: number;
  maxElo: number;
  first: number;
  last: number;
}

interface Dossier {
  name: string;
  games: number;
  score: { white: number[]; black: number[] };
  ratings: Array<{ year: number; elo: number }>;
  openings: { white: Array<{ eco: string; games: number; w: number; d: number; l: number }>; black: Array<{ eco: string; games: number; w: number; d: number; l: number }> };
  opponents: Array<{ name: string; games: number; w: number; d: number; l: number }>;
  first: number;
  last: number;
}

function RatingChart({ data }: { data: Array<{ year: number; elo: number }> }) {
  if (data.length < 2) return null;
  const W = 420;
  const H = 120;
  const minY = Math.min(...data.map((d) => d.elo)) - 30;
  const maxY = Math.max(...data.map((d) => d.elo)) + 30;
  const minX = data[0].year;
  const maxX = data[data.length - 1].year;
  const x = (y: number) => 30 + ((y - minX) / Math.max(1, maxX - minX)) * (W - 40);
  const y = (e: number) => H - 18 - ((e - minY) / Math.max(1, maxY - minY)) * (H - 28);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.year).toFixed(1)},${y(d.elo).toFixed(1)}`).join(' ');
  return (
    <svg className="rating-chart" viewBox={`0 0 ${W} ${H}`}>
      <line x1={30} x2={W - 10} y1={H - 18} y2={H - 18} className="axis" />
      <text x={30} y={H - 4} className="lbl">{minX}</text>
      <text x={W - 10} y={H - 4} className="lbl" textAnchor="end">{maxX}</text>
      <text x={2} y={y(maxY - 30) + 4} className="lbl">{maxY - 30}</text>
      <text x={2} y={y(minY + 30) + 4} className="lbl">{minY + 30}</text>
      <path d={path} className="line" fill="none" />
      {data.map((d) => (
        <circle key={d.year} cx={x(d.year)} cy={y(d.elo)} r={2.5} className="pt">
          <title>{`${d.year}: ${d.elo}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function PlayersPane({ dbId, onFilter }: { dbId: string; onFilter: (f: { player?: string; white?: string; black?: string }) => void }) {
  const [prefix, setPrefix] = useState('');
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const eco = useEcoBook();

  useEffect(() => {
    const t = setTimeout(() => {
      api.get<PlayerRow[]>(`/api/db/${dbId}/players?prefix=${encodeURIComponent(prefix)}&limit=300`).then(setRows).catch(reportError);
    }, 150);
    return () => clearTimeout(t);
  }, [dbId, prefix]);

  useEffect(() => {
    if (!sel) return;
    setDossier(null);
    api.get<Dossier>(`/api/db/${dbId}/player?name=${encodeURIComponent(sel)}`).then(setDossier).catch(reportError);
  }, [dbId, sel]);

  const ecoName = (code: string) => (eco ? eco.entries.find((e) => e.eco === code)?.name.split(':')[0] ?? '' : '');
  const pct = (s: number[]) => {
    const t = s[0] + s[1] + s[2];
    return t ? Math.round(((s[0] + s[1] / 2) / t) * 100) : 0;
  };

  return (
    <div className="split-pane">
      <div className="list-side">
        <div className="search-box">
          <Search size={14} />
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={L('Επώνυμο παίκτη…', 'Player surname…')} autoFocus />
        </div>
        <div className="simple-list">
          {rows.map((r) => (
            <div key={r.id} className={`sl-row${sel === r.name ? ' sel' : ''}`} onClick={() => setSel(r.name)} onDoubleClick={() => onFilter({ player: r.name })}>
              <span className="sl-main">{r.name}</span>
              <span className="sl-aux">{fmtNum(r.games)}</span>
              <span className="sl-aux">{r.maxElo || ''}</span>
              <span className="sl-aux">{r.first ? `${Math.floor(r.first / 10000)}–${Math.floor(r.last / 10000)}` : ''}</span>
            </div>
          ))}
          {!rows.length && <div className="muted small pad">{L('Κανένας παίκτης', 'No players')}</div>}
        </div>
      </div>
      <div className="detail-side">
        {!sel && <div className="muted pad">{L('Διάλεξε παίκτη για το «φάκελο» του (στατιστικά, ανοίγματα, βαθμολογία).', 'Pick a player to see the dossier (stats, openings, rating).')}</div>}
        {dossier && (
          <div className="dossier">
            <h2>{dossier.name}</h2>
            <div className="muted">
              {fmtNum(dossier.games)} {L('παρτίδες', 'games')} · {dossier.first}–{dossier.last}
            </div>
            <div className="row gap wrap actions">
              <button onClick={() => onFilter({ player: dossier.name })}>{L('Όλες οι παρτίδες', 'All games')}</button>
              <button onClick={() => onFilter({ white: dossier.name })}>{L('Με τα λευκά', 'With White')}</button>
              <button onClick={() => onFilter({ black: dossier.name })}>{L('Με τα μαύρα', 'With Black')}</button>
            </div>
            <div className="score-grid">
              <div>
                <b>{L('Με λευκά', 'As White')}</b> +{dossier.score.white[0]} ={dossier.score.white[1]} −{dossier.score.white[2]} ({pct(dossier.score.white)}%)
                <ScoreBar w={dossier.score.white[0]} d={dossier.score.white[1]} l={dossier.score.white[2]} />
              </div>
              <div>
                <b>{L('Με μαύρα', 'As Black')}</b> +{dossier.score.black[0]} ={dossier.score.black[1]} −{dossier.score.black[2]} ({pct(dossier.score.black)}%)
                <ScoreBar w={dossier.score.black[0]} d={dossier.score.black[1]} l={dossier.score.black[2]} />
              </div>
            </div>
            {dossier.ratings.length > 1 && (
              <>
                <h3>{L('Βαθμολογία Elo (μέγιστη ανά έτος)', 'Elo rating (max per year)')}</h3>
                <RatingChart data={dossier.ratings} />
              </>
            )}
            <div className="two-col">
              {(['white', 'black'] as const).map((c) => (
                <div key={c}>
                  <h3>{c === 'white' ? L('Ανοίγματα με λευκά', 'Openings as White') : L('Ανοίγματα με μαύρα', 'Openings as Black')}</h3>
                  <table className="data-table compact">
                    <tbody>
                      {dossier.openings[c].map((o) => (
                        <tr key={o.eco}>
                          <td>
                            <b>{o.eco}</b> <span className="muted">{ecoName(o.eco)}</span>
                          </td>
                          <td className="num">{o.games}</td>
                          <td className="num">{Math.round(((o.w + o.d / 2) / Math.max(1, o.games)) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <h3>{L('Συχνότεροι αντίπαλοι', 'Most frequent opponents')}</h3>
            <table className="data-table compact">
              <tbody>
                {dossier.opponents.map((o) => (
                  <tr key={o.name} onDoubleClick={() => onFilter({ white: dossier.name, black: o.name })}>
                    <td>{o.name}</td>
                    <td className="num">{o.games}</td>
                    <td className="num">
                      +{o.w} ={o.d} −{o.l}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Τουρνουά

interface TournamentRow {
  event: string;
  site: string;
  year: number;
  games: number;
  eventId: number;
  siteId: number;
}

interface Crosstable {
  event: string;
  site: string;
  maxRound: number;
  roundRobin: boolean;
  tiebreaks: TiebreakKey[];
  players: Array<{
    name: string;
    elo: number;
    points: number;
    games: number;
    tb: Tiebreaks;
    results: Array<string | null>;
    rounds: Array<{ round: number; opp: number; color: 'w' | 'b'; res: string }>;
  }>;
  ids: number[];
}

/** Συντομογραφία και εξήγηση κάθε tie-break. */
function tbLabel(k: TiebreakKey): [string, string] {
  if (k === 'bh') return ['BH', L('Buchholz: άθροισμα βαθμών των αντιπάλων', 'Buchholz: sum of the opponents’ scores')];
  if (k === 'bhc1') return ['BH-1', L('Buchholz χωρίς τον χαμηλότερο αντίπαλο', 'Buchholz without the lowest opponent')];
  if (k === 'sb') return ['SB', L('Sonneborn-Berger: βαθμοί κάθε αντιπάλου × αποτέλεσμα', 'Sonneborn-Berger: each opponent’s score × result')];
  return [L('Ν', 'W'), L('Νίκες', 'Wins')];
}

const fmtTb = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''));

export function TournamentsPane({ dbId, onShowIds }: { dbId: string; onShowIds: (ids: number[], label: string) => void }) {
  const [prefix, setPrefix] = useState('');
  const [rows, setRows] = useState<TournamentRow[]>([]);
  const [sel, setSel] = useState<TournamentRow | null>(null);
  const [table, setTable] = useState<Crosstable | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get<TournamentRow[]>(`/api/db/${dbId}/tournaments?prefix=${encodeURIComponent(prefix)}&limit=500`).then(setRows).catch(reportError);
    }, 150);
    return () => clearTimeout(t);
  }, [dbId, prefix]);

  useEffect(() => {
    if (!sel) return;
    setTable(null);
    api.get<Crosstable>(`/api/db/${dbId}/crosstable?event=${sel.eventId}&site=${sel.siteId}&year=${sel.year}`).then(setTable).catch(reportError);
  }, [dbId, sel]);

  return (
    <div className="split-pane">
      <div className="list-side">
        <div className="search-box">
          <Search size={14} />
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={L('Όνομα τουρνουά…', 'Tournament name…')} />
        </div>
        <div className="simple-list">
          {rows.map((r) => (
            <div key={`${r.eventId}-${r.siteId}-${r.year}`} className={`sl-row${sel === r ? ' sel' : ''}`} onClick={() => setSel(r)}>
              <span className="sl-main">{r.event || '?'}</span>
              <span className="sl-aux wide">{r.site}</span>
              <span className="sl-aux">{r.year || ''}</span>
              <span className="sl-aux">{fmtNum(r.games)}</span>
            </div>
          ))}
          {!rows.length && <div className="muted small pad">{L('Κανένα τουρνουά', 'No tournaments')}</div>}
        </div>
      </div>
      <div className="detail-side">
        {!sel && <div className="muted pad">{L('Διάλεξε τουρνουά για τον πίνακα αποτελεσμάτων.', 'Pick a tournament to see the crosstable.')}</div>}
        {table && sel && (
          <div className="crosstable-wrap">
            <h2>
              {table.event} <span className="muted">{table.site} {sel.year || ''}</span>
            </h2>
            <button onClick={() => onShowIds(table.ids, `${table.event} ${sel.year || ''}`)}>{L('Παρτίδες τουρνουά', 'Tournament games')}</button>
            <div className="table-scroll">
              {table.roundRobin ? (
                <table className="crosstable">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{L('Παίκτης', 'Player')}</th>
                      <th>Elo</th>
                      {table.players.map((_, i) => (
                        <th key={i}>{i + 1}</th>
                      ))}
                      <th>{L('Βαθμοί', 'Pts')}</th>
                      {table.tiebreaks.map((k) => (
                        <th key={k} title={tbLabel(k)[1]}>
                          {tbLabel(k)[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.players.map((p, i) => (
                      <tr key={p.name}>
                        <td>{i + 1}</td>
                        <td className="name">{p.name}</td>
                        <td>{p.elo || ''}</td>
                        {p.results.map((r, j) => (
                          <td key={j} className={r === null ? 'self' : ''}>
                            {r ?? ''}
                          </td>
                        ))}
                        <td className="pts">
                          {String(p.points).replace('.5', '½')} / {p.games}
                        </td>
                        {table.tiebreaks.map((k) => (
                          <td key={k} className="tb">
                            {fmtTb(p.tb[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="crosstable swiss">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{L('Παίκτης', 'Player')}</th>
                      <th>Elo</th>
                      {Array.from({ length: table.maxRound }, (_, i) => (
                        <th key={i}>{L('Γ', 'R')}{i + 1}</th>
                      ))}
                      <th>{L('Βαθμοί', 'Pts')}</th>
                      {table.tiebreaks.map((k) => (
                        <th key={k} title={tbLabel(k)[1]}>
                          {tbLabel(k)[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.players.map((p, i) => (
                      <tr key={p.name}>
                        <td>{i + 1}</td>
                        <td className="name">{p.name}</td>
                        <td>{p.elo || ''}</td>
                        {Array.from({ length: table.maxRound }, (_, r) => {
                          const g = p.rounds.find((x) => x.round === r + 1);
                          return (
                            <td key={r} title={g ? table.players[g.opp - 1]?.name : ''}>
                              {g ? `${g.opp}${g.color === 'w' ? L('λ', 'w') : L('μ', 'b')}${g.res}` : ''}
                            </td>
                          );
                        })}
                        <td className="pts">
                          {String(p.points).replace('.5', '½')} / {p.games}
                        </td>
                        {table.tiebreaks.map((k) => (
                          <td key={k} className="tb">
                            {fmtTb(p.tb[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ανοίγματα (εξερεύνηση δέντρου της βάσης)

export function OpeningsPane({ dbId, style, onPositionGames }: { dbId: string; style: NotationStyle; onPositionGames: (fen: string) => void }) {
  const settings = useApp((s) => s.settings);
  const [line, setLine] = useState<Array<{ uci: string; san: string; fen: string }>>([]);
  const fen = line.length ? line[line.length - 1].fen : START_FEN;
  const eco = useEcoBook();
  const opening = useMemo(() => {
    if (!eco) return null;
    for (let i = line.length - 1; i >= 0; i--) {
      const p = Position.fromFen(line[i].fen);
      const o = eco.lookup(p.hashHi, p.hashLo);
      if (o) return o;
    }
    return null;
  }, [eco, line]);

  const play = (uci: string) => {
    const p = Position.fromFen(fen);
    const m = p.parseUci(uci);
    if (!m) return;
    const san = p.san(m);
    p.makeMove(m);
    setLine((l) => [...l, { uci, san, fen: p.fen() }]);
  };
  const drawn = useDrawnShapes(fen);

  return (
    <div className="openings-pane">
      <div className="op-board">
        <Board
          fen={fen}
          orientation="white"
          movable="both"
          shapes={drawn.shapes}
          onShape={drawn.onShape}
          theme={settings?.boardTheme}
          pieceSet={settings?.pieceSet}
          onMove={(from, to, promo) => {
            const p = Position.fromFen(fen);
            const m = p.findMove(from, to, promo);
            if (m) play(p.moveToUci(m));
          }}
        />
        <div className="op-line">
          <button onClick={() => setLine([])}>{L('Αρχή', 'Start')}</button>
          <button onClick={() => setLine((l) => l.slice(0, -1))} disabled={!line.length}>
            {L('Πίσω', 'Back')}
          </button>
          <span className="op-moves">
            {line.map((m, i) => (
              <span key={i} className="pv-move" onClick={() => setLine((l) => l.slice(0, i + 1))}>
                {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
                {displaySan(m.san, style)}{' '}
              </span>
            ))}
          </span>
        </div>
        {opening && (
          <div className="opening-line">
            <b>{opening.eco}</b> {opening.name}
          </div>
        )}
      </div>
      <div className="op-tree">
        <TreePanel fen={fen} style={style} dbId={dbId} onDbChange={() => {}} onPlay={play} onShowGames={(_id, f) => onPositionGames(f)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Στατιστικά

interface DbStats {
  games: number;
  players: number;
  events: number;
  firstYear: number;
  lastYear: number;
  results: number[];
  avgElo: number;
}

export function StatsPane({ dbId }: { dbId: string }) {
  const [info, setInfo] = useState<{ stats: DbStats; index: { entries: number; maxPly: number; stale: boolean } | null } | null>(null);
  useEffect(() => {
    api.get<{ stats: DbStats; index: { entries: number; maxPly: number; stale: boolean } | null }>(`/api/db/${dbId}/info`).then(setInfo).catch(reportError);
  }, [dbId]);
  if (!info) return <div className="pad muted">…</div>;
  const s = info.stats;
  const total = s.results.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="stats-pane pad">
      <div className="stat-cards">
        <div className="stat-card">
          <div className="v">{fmtNum(s.games)}</div>
          <div className="k">{L('Παρτίδες', 'Games')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{fmtNum(s.players)}</div>
          <div className="k">{L('Παίκτες', 'Players')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{fmtNum(s.events)}</div>
          <div className="k">{L('Τουρνουά', 'Events')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{s.firstYear ? `${s.firstYear}–${s.lastYear}` : '–'}</div>
          <div className="k">{L('Χρονική περίοδος', 'Years')}</div>
        </div>
        <div className="stat-card">
          <div className="v">{s.avgElo || '–'}</div>
          <div className="k">{L('Μέσο Elo (λευκά και μαύρα)', 'Average Elo (White and Black)')}</div>
        </div>
      </div>
      <h3>{L('Αποτελέσματα', 'Results')}</h3>
      <ScoreBar w={s.results[0]} d={s.results[1]} l={s.results[2]} />
      <div className="muted small">
        1-0: {fmtNum(s.results[0])} ({Math.round((s.results[0] / total) * 100)}%) · ½-½: {fmtNum(s.results[1])} ({Math.round((s.results[1] / total) * 100)}%) · 0-1: {fmtNum(s.results[2])} ({Math.round((s.results[2] / total) * 100)}%) · *: {fmtNum(s.results[3])}
      </div>
      <h3>{L('Ευρετήριο θέσεων', 'Position index')}</h3>
      {info.index ? (
        <div className="muted small">
          {fmtNum(info.index.entries)} {L('θέσεις', 'positions')} · {L('βάθος', 'depth')} {info.index.maxPly >= 400 ? L('όλη η παρτίδα', 'whole game') : `${info.index.maxPly} ${L('ημικινήσεις', 'plies')}`}
          {info.index.stale ? ` · ${L('ενημερώνεται', 'updating')}` : ''}
        </div>
      ) : (
        <div className="muted small">{L('Δεν υπάρχει ακόμη.', 'Not built yet.')}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Προεπισκόπηση παρτίδας

/** Προεπισκόπηση της επιλεγμένης παρτίδας: δείχνει την τελική θέση· με ← / → στη λίστα (stepRef) κίνηση-κίνηση. */
export function GamePreview({ dbId, row, stepRef }: { dbId: string; row: GameRow | null; stepRef?: MutableRefObject<((dir: -1 | 1) => void) | null> }) {
  const settings = useApp((s) => s.settings);
  const style = (((settings?.ui as Record<string, unknown> | undefined)?.notation as NotationStyle | undefined) ?? 'figurine') as NotationStyle;
  const [data, setData] = useState<{ start: string; startTurn: number; startFullmove: number; main: GameNode[]; moves: string } | null>(null);
  const [ply, setPly] = useState(0);
  const last = data?.main.length ?? 0;
  if (stepRef) {
    // → στο τέλος ξεκινά από την πρώτη κίνηση
    stepRef.current = (dir) => data && setPly((p) => (dir > 0 && p >= last ? Math.min(1, last) : Math.max(0, Math.min(last, p + dir))));
  }
  useEffect(() => {
    if (!row) {
      setData(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .get<{ pgn: string }>(`/api/db/${dbId}/game/${row.id}`)
        .then((r) => {
          if (!alive) return;
          const g = parseGames(r.pgn)[0]?.game;
          if (!g) return;
          const main = g.mainline();
          const text = main
            .slice(0, 40)
            .map((n) => (n.whiteMoved(g.startTurn) ? `${n.moveNumber(g.startFullmove, g.startTurn)}.${n.san}` : n.san))
            .join(' ');
          setData({ start: g.startFen, startTurn: g.startTurn, startFullmove: g.startFullmove, main, moves: text + (main.length > 40 ? ' …' : '') });
          setPly(main.length);
        })
        .catch(() => {});
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [dbId, row]);
  if (!row) return <div className="preview muted pad">{L('Διάλεξε παρτίδα για προεπισκόπηση', 'Select a game to preview')}</div>;
  const node = data && ply > 0 ? data.main[ply - 1] : null;
  return (
    <div className="preview">
      <div className="preview-board">
        <Board fen={node ? node.fen : (data?.start ?? START_FEN)} orientation="white" movable="none" lastMove={node?.move} theme={settings?.boardTheme} pieceSet={settings?.pieceSet} coordinates={false} />
      </div>
      {data && (
        <div className="muted small tnum" title={L('← / → στη λίστα: κίνηση πίσω / μπροστά', '← / → in the list: move back / forward')}>
          {node ? `${node.moveNumber(data.startFullmove, data.startTurn)}${node.whiteMoved(data.startTurn) ? '.' : '…'}${displaySan(node.san, style)}` : L('αρχή', 'start')}
          {` · ← →`}
        </div>
      )}
      <div className="preview-head">
        <b>{row.white}</b> {row.welo ? `(${row.welo})` : ''} – <b>{row.black}</b> {row.belo ? `(${row.belo})` : ''} <span className="res">{resultText(row.result)}</span>
      </div>
      <div className="muted small">
        {[row.event, row.site, fmtDate(row.date), row.round ? `${L('γύρος', 'rd')} ${row.round}` : ''].filter(Boolean).join(' · ')}
      </div>
      <div className="preview-moves">{data?.moves}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ρεπερτόριο: ποιες νέες παρτίδες φτάνουν στο τέλος των γραμμών μου

interface RepLine {
  line: string;
  fen: string;
  ply: number;
  games: number;
  beyondIndex: boolean;
  recent: GameRow[];
}

export function RepertoirePane({ dbId, onOpenLine, onShowGames }: { dbId: string; onOpenLine: (pgn: string) => void; onShowGames: (refId: string, fen: string) => void }) {
  const library = useApp((s) => s.library);
  const others = library.filter((d) => d.id !== dbId && !d.busy && d.games > 0).sort((a, b) => b.games - a.games);
  const [ref, setRef] = useState(others[0]?.id ?? '');
  const [minPly, setMinPly] = useState(6);
  const [data, setData] = useState<{ lines: RepLine[]; truncated: boolean; indexMaxPly: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setData(await api.post('/api/repertoire/report', { repertoire: dbId, reference: ref, minPly }));
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pad repertoire-pane">
      <h2>{L('Αναφορά ρεπερτορίου', 'Repertoire report')}</h2>
      <p className="muted small">
        {L(
          'Οι γραμμές αυτής της βάσης θεωρούνται το ρεπερτόριό σου. Για το τέλος κάθε γραμμής βρίσκονται οι παρτίδες της βάσης αναφοράς που φτάνουν εκεί, με τις πιο πρόσφατες πρώτες.',
          'The lines of this database are treated as your repertoire. For the end of every line, the games of the reference database that reach it are listed, most recent first.',
        )}
      </p>
      <div className="row gap wrap">
        <label className="field">
          <span>{L('Βάση αναφοράς', 'Reference database')}</span>
          <select value={ref} onChange={(e) => setRef(e.target.value)}>
            {others.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({fmtNum(d.games)})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{L('Ελάχιστο βάθος (ημικινήσεις)', 'Minimum depth (plies)')}</span>
          <input type="number" min={1} max={60} value={minPly} onChange={(e) => setMinPly(Number(e.target.value) || 1)} />
        </label>
        <button className="primary" disabled={!ref || busy} onClick={() => void run()}>
          {busy ? L('Αναζήτηση…', 'Searching…') : L('Δημιουργία αναφοράς', 'Create report')}
        </button>
      </div>
      {data && (
        <>
          {data.truncated && <p className="muted small">{L('Δείχνονται οι πρώτες 1.000 γραμμές.', 'Showing the first 1,000 lines.')}</p>}
          <table className="data-table rep-table">
            <thead>
              <tr>
                <th>{L('Γραμμή', 'Line')}</th>
                <th className="num">{L('Παρτίδες', 'Games')}</th>
                <th>{L('Πιο πρόσφατες', 'Most recent')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.fen}>
                  <td className="rep-line" title={l.line}>
                    {l.line}
                  </td>
                  <td className="num">{l.beyondIndex && !l.games ? <span title={L('Πιο βαθιά από το ευρετήριο της βάσης αναφοράς', 'Deeper than the reference index')}>–</span> : fmtNum(l.games)}</td>
                  <td className="small">
                    {l.recent.map((g) => (
                      <div key={g.id}>
                        {fmtDate(g.date)} {g.white.split(',')[0]} – {g.black.split(',')[0]} {resultText(g.result)}
                      </div>
                    ))}
                  </td>
                  <td>
                    <div className="row gap">
                      <button className="small-btn" onClick={() => onOpenLine(`${l.line} *`)}>
                        {L('Σκακιέρα', 'Board')}
                      </button>
                      {l.games > 0 && (
                        <button className="small-btn" onClick={() => onShowGames(ref, l.fen)}>
                          {L('Παρτίδες', 'Games')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
