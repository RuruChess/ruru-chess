/**
 * Σχέδια του χρήστη πάνω σε σκακιέρα που δεν τα αποθηκεύει (ασκήσεις, μαθήματα): δεξί κλικ κύκλος,
 * δεξί σύρσιμο βέλος. Μένουν όσο μένει η θέση· το ίδιο σχέδιο ξανά το σβήνει, άλλο χρώμα το αλλάζει.
 */
import { useState } from 'react';
import type { Shape } from '../../core/game.ts';

export function useDrawnShapes(fen: string | undefined): { shapes: Shape[]; onShape: (s: Shape) => void } {
  const [st, setSt] = useState<{ fen: string; list: Shape[] }>({ fen: '', list: [] });
  const key = fen ?? '';
  const onShape = (sh: Shape) =>
    setSt((d) => {
      const list = d.fen === key ? d.list : [];
      const i = list.findIndex((x) => x.from === sh.from && x.to === sh.to);
      const same = i >= 0 && list[i].color === sh.color;
      return { fen: key, list: [...list.filter((_, k) => k !== i), ...(same ? [] : [sh])] };
    });
  return { shapes: key && st.fen === key ? st.list : [], onShape };
}
