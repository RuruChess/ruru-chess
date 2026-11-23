// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2012-2026 the lila authors (AGPL-3.0-or-later), https://github.com/lichess-org/lila
//   from lila: winning chances formula
// Translated to TypeScript and modified for Ruru Chess: 2026-10-22 to 2026-11-22.
// License texts: LICENSE, licenses/AGPL-3.0.txt, licenses/NOTICES.txt
/** Παράθυρο μηχανής (UCI): άπειρη ανάλυση, πολλές γραμμές, απειλή, μπάρα αξιολόγησης. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Plus, Minus, Swords, X } from 'lucide-react';
import { Position, START_FEN } from '../../core/chess.ts';
import { api, onServerEvent, type AnalysisEvent, type EngineConfig, type PvLine } from '../api.ts';
import { L, fmtNum } from '../i18n.ts';
import { reportError, useApp } from '../store.ts';
import { displaySan, type NotationStyle } from './Notation.tsx';
import { StockfishInstall } from './StockfishInstall.tsx';

export function formatEval(cp: number | null, mate: number | null): string {
  if (mate !== null && mate !== undefined) return mate > 0 ? `#${mate}` : `#${mate}`.replace('#-', '−#');
  if (cp === null || cp === undefined) return '–';
  const v = cp / 100;
  if (Math.abs(v) < 0.005) return '0.00';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
}

/** Πιθανότητα νίκης λευκών (0..1) από εκατοστά πιονιού. */
export function winChance(cp: number | null, mate: number | null): number {
  if (mate !== null && mate !== undefined) return mate > 0 ? 1 : 0;
  if (cp === null || cp === undefined) return 0.5;
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

export function EvalBar({ cp, mate, flipped }: { cp: number | null; mate: number | null; flipped: boolean }) {
  const w = winChance(cp, mate);
  const whitePct = Math.round(w * 1000) / 10;
  return (
    <div className={`evalbar${flipped ? ' flipped' : ''}`} title={formatEval(cp, mate)}>
      <div className="evalbar-white" style={{ height: `${whitePct}%` }} />
      <span className="evalbar-label">{formatEval(cp, mate)}</span>
    </div>
  );
}

interface Props {
  session: string;
  fen: string;
  style: NotationStyle;
  /** παίζει μια σειρά κινήσεων UCI από την τρέχουσα θέση */
  onPlayLine: (uci: string[]) => void;
  /** καλύτερες κινήσεις για βέλη στη σκακιέρα */
  /** οι καλύτερες γραμμές της τρέχουσας θέσης και αν η μηχανή τρέχει (γραμμές κενές = αναμονή) */
  onBest?: (lines: PvLine[], running: boolean) => void;
  onClose?: () => void;
  autoStart?: boolean;
  /** επιπλέον κουμπιά στην κεφαλίδα (π.χ. «Βέλη», «Δεύτερη») */
  extra?: React.ReactNode;
}

export function EnginePanel({ session, fen, style, onPlayLine, onBest, onClose, autoStart, extra }: Props) {
  const settings = useApp((s) => s.settings);
  // η Maia (ένας κόμβος ανά κίνηση) δεν είναι για ανάλυση
  const engines: EngineConfig[] = (settings?.engines ?? []).filter((e) => !e.human);
  const [engineId, setEngineId] = useState<string>(settings?.defaultEngine ?? engines[0]?.id ?? '');
  const [running, setRunning] = useState(Boolean(autoStart));
  const [multipv, setMultipv] = useState(3);
  const [threat, setThreat] = useState(false);
  const [data, setData] = useState<AnalysisEvent | null>(null);
  const fenRef = useRef(fen);

  useEffect(() => {
    if (!engineId && engines[0]) setEngineId(settings?.defaultEngine ?? engines[0].id);
  }, [engines, engineId, settings?.defaultEngine]);

  // θέση για ανάλυση (με «απειλή»: παίζει ο αντίπαλος δεύτερη φορά)
  const analysisFen = useMemo(() => {
    if (!threat) return fen;
    try {
      const p = Position.fromFen(fen);
      if (p.inCheck()) return fen;
      const parts = p.fen().split(' ');
      parts[1] = parts[1] === 'w' ? 'b' : 'w';
      parts[3] = '-';
      return parts.join(' ');
    } catch {
      return fen;
    }
  }, [fen, threat]);
  fenRef.current = analysisFen;

  useEffect(
    () =>
      onServerEvent('analysis', (ev: AnalysisEvent) => {
        if (ev.session !== session || ev.fen !== fenRef.current) return;
        setData(ev);
      }),
    [session],
  );

  useEffect(() => {
    // και σταματημένη: οι γραμμές μιας άλλης θέσης φεύγουν
    setData((d) => (d && d.fen === analysisFen ? d : null));
    if (!running || !engineId) return;
    const t = setTimeout(() => {
      api.post('/api/analysis/start', { session, engineId, fen: analysisFen || START_FEN, multipv }).catch((e) => {
        reportError(e);
        setRunning(false);
      });
    }, 60);
    return () => clearTimeout(t);
  }, [running, analysisFen, multipv, engineId, session]);

  useEffect(() => {
    if (!running) void api.post('/api/analysis/stop', { session }).catch(() => {});
  }, [running, session]);

  useEffect(() => () => void api.post('/api/analysis/close', { session }).catch(() => {}), [session]);

  useEffect(() => {
    onBest?.(running && data && !threat ? data.lines : [], running);
  }, [data, running, threat]);

  const pos = useMemo(() => {
    try {
      return Position.fromFen(analysisFen);
    } catch {
      return Position.start();
    }
  }, [analysisFen]);

  const lineText = (l: PvLine) => {
    const out: Array<{ text: string; idx: number }> = [];
    let num = pos.fullmove;
    let white = pos.turn === 0;
    l.san.slice(0, 18).forEach((s, i) => {
      const prefix = white ? `${num}.` : i === 0 ? `${num}...` : '';
      out.push({ text: (prefix ? prefix + ' ' : '') + displaySan(s, style), idx: i });
      if (!white) num++;
      white = !white;
    });
    return out;
  };

  if (!engines.length) {
    return (
      <div className="panel engine-panel empty">
        <p>{L('Δεν έχει οριστεί μηχανή ανάλυσης.', 'No analysis engine configured.')}</p>
        <p className="muted">{L('Κατέβασε το Stockfish με ένα κλικ ή πρόσθεσε άλλη μηχανή από τις Ρυθμίσεις → Μηχανές.', 'Download Stockfish with one click, or add another engine in Settings → Engines.')}</p>
        <StockfishInstall />
      </div>
    );
  }

  const top = data?.lines[0];
  return (
    <div className="panel engine-panel">
      <div className="engine-head">
        <button className={`kb-btn sm${running ? '' : ' primary'}`} onClick={() => setRunning(!running)} title={running ? L('Διακοπή ανάλυσης', 'Stop analysis') : L('Άπειρη ανάλυση', 'Infinite analysis')}>
          {running ? <Pause size={14} /> : <Play size={14} />}
          {running ? L('Στάση', 'Stop') : L('Έναρξη', 'Start')}
        </button>
        <select value={engineId} onChange={(e) => setEngineId(e.target.value)} title={L('Μηχανή', 'Engine')}>
          {engines.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <span className={`eval-big ${top ? ((top.mate ?? top.cp ?? 0) >= 0 ? 'pos' : 'neg') : ''}`}>{top ? formatEval(top.cp, top.mate) : ''}</span>
        <span className="engine-stats">
          {data
            ? running
              ? `${L('βάθος', 'depth')} ${data.depth} · ${fmtNum(Math.round((data.nps || 0) / 1000))} kN/s`
              : `${L('σταμάτησε', 'stopped')} · ${L('βάθος', 'depth')} ${data.depth}`
            : running
              ? L('εκκίνηση…', 'starting…')
              : ''}
        </span>
        <div className="spacer" />
        {extra}
        <button className={`icon-btn${threat ? ' active' : ''}`} onClick={() => setThreat(!threat)} title={L('Απειλή: τι θα έπαιζε ο αντίπαλος', 'Threat: what the opponent would play')}>
          <Swords size={15} />
        </button>
        <button className="icon-btn" onClick={() => setMultipv(Math.max(1, multipv - 1))} title={L('Λιγότερες γραμμές', 'Fewer lines')}>
          <Minus size={14} />
        </button>
        <span className="multipv">{multipv}</span>
        <button className="icon-btn" onClick={() => setMultipv(Math.min(8, multipv + 1))} title={L('Περισσότερες γραμμές', 'More lines')}>
          <Plus size={14} />
        </button>
        {onClose && (
          <button className="icon-btn" onClick={onClose} title={L('Κλείσιμο', 'Close')}>
            <X size={14} />
          </button>
        )}
      </div>
      {threat && <div className="threat-note">{L('Ανάλυση απειλής (σαν να ξαναπαίζει ο αντίπαλος)', 'Threat analysis (opponent to move again)')}</div>}
      <div className={`engine-lines${running ? '' : ' stopped'}`}>
        {(data?.lines ?? []).map((l) => (
          <div key={l.multipv} className="engine-line">
            <span className={`line-eval ${(l.mate ?? l.cp ?? 0) >= 0 ? 'pos' : 'neg'}`}>{formatEval(l.cp, l.mate)}</span>
            <span className="line-depth">{l.depth}</span>
            <span className="line-moves">
              {lineText(l).map((m) => (
                <span key={m.idx} className="pv-move" onClick={() => !threat && onPlayLine(l.uci.slice(0, m.idx + 1))} title={threat ? '' : L('Πρόσθεσε ως βαριάντα ως εδώ', 'Add as variation up to here')}>
                  {m.text}{' '}
                </span>
              ))}
            </span>
          </div>
        ))}
        {running && !data && <div className="muted small">{L('Η μηχανή σκέφτεται…', 'Engine is thinking…')}</div>}
      </div>
    </div>
  );
}
