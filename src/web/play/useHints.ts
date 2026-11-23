/**
 * Βοήθειες στο παιχνίδι με bot (ανάβουν και σβήνουν): βέλος της καλύτερης κίνησης, βέλος της απειλής και
 * αξιολόγηση για τη μπάρα, μόνο στη σειρά του χρήστη. Από το RealChessBase (Λάζαρος Μπατσής, GPL-3.0).
 */
import { useEffect, useState } from 'react';
import { Position, moveFrom, moveTo } from '../../core/chess.ts';
import type { Shape } from '../../core/game.ts';
import { api, type PvLine } from '../api.ts';
import { threatFen, type PlayHints } from './session.ts';

export interface HintState {
  arrows: Shape[];
  /** αξιολόγηση από την πλευρά των λευκών (για τη μπάρα) */
  eval: { cp: number | null; mate: number | null } | null;
}

const EMPTY: HintState = { arrows: [], eval: null };

function arrowOf(fen: string, uci: string | undefined, color: string): Shape | null {
  if (!uci) return null;
  try {
    const m = Position.fromFen(fen).parseUci(uci);
    return m ? ({ color, from: moveFrom(m), to: moveTo(m) } as Shape) : null;
  } catch {
    return null;
  }
}

/**
 * Υπολογίζει τις βοήθειες για τη θέση `fen` όταν παίζει ο χρήστης (`active`): μία σύντομη αναζήτηση της
 * προεπιλεγμένης μηχανής (πλήρης δύναμη) για το βέλος και τη μπάρα, και μία για την απειλή.
 */
export function usePlayHints(fen: string, hints: PlayHints, active: boolean): HintState {
  const [state, setState] = useState<{ fen: string; h: HintState }>({ fen: '', h: EMPTY });
  const want = active && (hints.best || hints.threat || hints.evalBar);
  useEffect(() => {
    if (!want) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const out: HintState = { arrows: [], eval: null };
      try {
        if (hints.best || hints.evalBar) {
          const r = await api.post<{ bestmove?: string; line: PvLine | null }>('/api/engine/move', { fen, movetime: 700 });
          if (r.line) out.eval = { cp: r.line.cp, mate: r.line.mate };
          const a = hints.best ? arrowOf(fen, r.bestmove, 'G') : null;
          if (a) out.arrows.push(a);
        }
        const tf = hints.threat ? threatFen(fen) : null;
        if (tf && !cancelled) {
          const r = await api.post<{ bestmove?: string }>('/api/engine/move', { fen: tf, movetime: 400 });
          const a = arrowOf(tf, r.bestmove, 'R');
          if (a) out.arrows.push(a);
        }
      } catch {
        // χωρίς μηχανή: χωρίς βοήθειες
      }
      if (!cancelled) setState({ fen, h: out });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fen, want, hints.best, hints.threat, hints.evalBar]);
  if (!want || state.fen !== fen) return EMPTY;
  return {
    arrows: state.h.arrows.filter((a) => (a.color === 'G' ? hints.best : hints.threat)),
    eval: hints.evalBar ? state.h.eval : null,
  };
}
