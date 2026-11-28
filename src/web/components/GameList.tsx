/** Λίστα παρτίδων με εικονική κύλιση (φορτώνονται μόνο οι ορατές γραμμές). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api, type GameRow } from '../api.ts';
import { L, fmtDate, fmtNum, resultText } from '../i18n.ts';
import { medalsOfFlags } from '../../core/medals.ts';

const PAGE = 100;

export interface Column {
  key: string;
  label: () => string;
  width: number;
  align?: 'right' | 'center';
  render: (r: GameRow) => string;
}

export const COLUMNS: Column[] = [
  { key: 'id', label: () => '#', width: 64, align: 'right', render: (r) => String(r.id) },
  { key: 'white', label: () => L('Λευκά', 'White'), width: 170, render: (r) => r.white },
  { key: 'welo', label: () => 'Elo', width: 48, align: 'right', render: (r) => (r.welo ? String(r.welo) : '') },
  { key: 'black', label: () => L('Μαύρα', 'Black'), width: 170, render: (r) => r.black },
  { key: 'belo', label: () => 'Elo', width: 48, align: 'right', render: (r) => (r.belo ? String(r.belo) : '') },
  { key: 'result', label: () => L('Αποτ.', 'Result'), width: 46, align: 'center', render: (r) => resultText(r.result) },
  { key: 'plies', label: () => L('Κιν.', 'Moves'), width: 44, align: 'right', render: (r) => (r.plies ? String(Math.ceil(r.plies / 2)) : '') },
  {
    key: 'flags',
    label: () => L('Σχολ.', 'Notes'),
    width: 50,
    render: (r) => (r.flags & 1 ? 'V' : '') + (r.flags & 2 ? 'C' : '') + (r.flags & 4 ? '!' : '') + (r.flags & 16 ? '↗' : '') + (r.flags & 8 ? 'P' : '') + (medalsOfFlags(r.flags) ? '★' : ''),
  },
  { key: 'eco', label: () => 'ECO', width: 44, render: (r) => r.eco },
  { key: 'event', label: () => L('Τουρνουά', 'Event'), width: 190, render: (r) => r.event },
  { key: 'site', label: () => L('Τόπος', 'Site'), width: 120, render: (r) => r.site },
  { key: 'date', label: () => L('Ημ/νία', 'Date'), width: 78, render: (r) => fmtDate(r.date) },
  { key: 'round', label: () => L('Γύρος', 'Round'), width: 46, align: 'right', render: (r) => r.round },
  { key: 'annotator', label: () => L('Σχολιαστής', 'Annotator'), width: 90, render: (r) => r.annotator },
];

interface Props {
  dbId: string;
  viewKey: string | null;
  count: number;
  sort: { col: string; desc: boolean };
  onSort: (col: string) => void;
  selected: Set<number>;
  onSelect: (ids: Set<number>, focus: GameRow | null) => void;
  onOpen: (row: GameRow) => void;
  onContext?: (row: GameRow, x: number, y: number) => void;
  /** πλήκτρο Delete στη λίστα */
  onDeleteKey?: () => void;
  /** ← / → στη λίστα: κίνηση πίσω / μπροστά στην προεπισκόπηση της επιλεγμένης παρτίδας */
  onStep?: (dir: -1 | 1) => void;
  /** αλλαγή δεδομένων χωρίς αλλαγή κλειδιού */
  refreshToken?: number | string;
}

export function GameList({ dbId, viewKey, count, sort, onSort, selected, onSelect, onOpen, onContext, onDeleteKey, onStep, refreshToken }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Map<number, GameRow[]>>(new Map());
  const loading = useRef(new Set<number>());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number>(-1);

  useEffect(() => {
    setPages(new Map());
    loading.current.clear();
    setCursor(-1);
  }, [viewKey, refreshToken]);

  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 20,
  });
  const items = rowVirtualizer.getVirtualItems();

  const loadPage = useCallback(
    (p: number) => {
      if (!viewKey || loading.current.has(p)) return;
      loading.current.add(p);
      api
        .get<{ rows: GameRow[] }>(`/api/db/${dbId}/rows?key=${encodeURIComponent(viewKey)}&offset=${p * PAGE}&limit=${PAGE}`)
        .then((r) => setPages((m) => new Map(m).set(p, r.rows)))
        .catch(() => loading.current.delete(p));
    },
    [dbId, viewKey],
  );

  useEffect(() => {
    if (!items.length) return;
    const first = Math.floor(items[0].index / PAGE);
    const last = Math.floor(items[items.length - 1].index / PAGE);
    for (let p = first; p <= last; p++) if (!pages.has(p)) loadPage(p);
  }, [items, pages, loadPage]);

  const rowAt = useCallback((i: number): GameRow | null => pages.get(Math.floor(i / PAGE))?.[i % PAGE] ?? null, [pages]);

  const click = (i: number, row: GameRow, e: React.MouseEvent) => {
    let next: Set<number>;
    if (e.shiftKey && anchor !== null) {
      next = new Set(e.ctrlKey ? selected : []);
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      for (let k = a; k <= b; k++) {
        const r = rowAt(k);
        if (r) next.add(r.id);
      }
    } else if (e.ctrlKey || e.metaKey) {
      next = new Set(selected);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      setAnchor(i);
    } else {
      next = new Set([row.id]);
      setAnchor(i);
    }
    setCursor(i);
    onSelect(next, row);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!count) return;
    let i = cursor;
    if (e.key === 'ArrowDown') i = Math.min(count - 1, cursor + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, cursor - 1);
    else if (e.key === 'PageDown') i = Math.min(count - 1, cursor + 20);
    else if (e.key === 'PageUp') i = Math.max(0, cursor - 20);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = count - 1;
    else if (e.key === 'Enter') {
      const r = rowAt(cursor);
      if (r) onOpen(r);
      return;
    } else if (e.key === 'Delete') {
      onDeleteKey?.();
      return;
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onStep) {
      e.preventDefault();
      onStep(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    } else return;
    e.preventDefault();
    setCursor(i);
    rowVirtualizer.scrollToIndex(i, { align: 'auto' });
    const r = rowAt(i);
    if (r) {
      setAnchor(i);
      onSelect(new Set([r.id]), r);
    }
  };

  const totalWidth = useMemo(() => COLUMNS.reduce((a, c) => a + c.width, 0), []);

  return (
    <div className="game-list" tabIndex={0} onKeyDown={onKey}>
      <div className="gl-head" style={{ minWidth: totalWidth }}>
        {COLUMNS.map((c) => (
          <div key={c.key} className={`gl-cell ${c.align ?? ''}`} style={{ width: c.width }} onClick={() => c.key !== 'flags' && onSort(c.key)} title={c.key === 'flags' ? L('V βαριάντες · C σχόλια · ! σύμβολα · ↗ γραφικά · P θέση · ★ μετάλλια', 'V variations · C comments · ! symbols · ↗ graphics · P position · ★ medals') : L('Ταξινόμηση', 'Sort')}>
            {c.label()}
            {sort.col === c.key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
          </div>
        ))}
      </div>
      <div className="gl-body" ref={parentRef}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', minWidth: totalWidth }}>
          {items.map((vi) => {
            const row = rowAt(vi.index);
            const sel = row ? selected.has(row.id) : false;
            const deleted = row ? (row.flags & 0x100) !== 0 : false;
            return (
              <div
                key={vi.key}
                className={`gl-row${sel ? ' sel' : ''}${vi.index === cursor ? ' cursor' : ''}${deleted ? ' deleted' : ''}${vi.index % 2 ? ' odd' : ''}`}
                style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}
                onClick={(e) => row && click(vi.index, row, e)}
                onDoubleClick={() => row && onOpen(row)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!row) return;
                  if (!selected.has(row.id)) click(vi.index, row, e);
                  onContext?.(row, e.clientX, e.clientY);
                }}
              >
                {row ? (
                  COLUMNS.map((c) => (
                    <div key={c.key} className={`gl-cell ${c.align ?? ''}${c.key === 'result' ? ` res${row.result}` : ''}`} style={{ width: c.width }}>
                      {c.render(row)}
                    </div>
                  ))
                ) : (
                  <div className="gl-cell loading">…</div>
                )}
              </div>
            );
          })}
        </div>
        {count === 0 && <div className="gl-empty">{L('Καμία παρτίδα', 'No games')}</div>}
      </div>
      <div className="gl-foot">
        {fmtNum(count)} {L('παρτίδες', 'games')}
        {selected.size > 1 && ` · ${fmtNum(selected.size)} ${L('επιλεγμένες', 'selected')}`}
      </div>
    </div>
  );
}
