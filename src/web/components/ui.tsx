/** Μικρά κοινά στοιχεία: διάλογος, μενού περιβάλλοντος, μηνύματα. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../store.ts';
import { L } from '../i18n.ts';

export function Dialog({ title, onClose, children, footer, width }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Κλείσιμο">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Μικρό παράθυρο διαλόγου σαν των Windows (ερωτήσεις αποθήκευσης, επιλογή βάσης):
 * μπλε γραμμή τίτλου, περιεχόμενο, κουμπιά κάτω δεξιά. Esc = κλείσιμο.
 */
export function WinDialog({ title, onClose, children, footer, width = 380 }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop win-backdrop">
      <div className="win-dialog" style={{ width }} role="dialog" aria-label={title}>
        <div className="win-title">
          <span>{title}</span>
          <button onClick={onClose} aria-label={L('Κλείσιμο', 'Close')}>
            <X size={14} />
          </button>
        </div>
        <div className="win-body">{children}</div>
        <div className="win-foot">{footer}</div>
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  shortcut?: string;
  /** σύμβολο σε δική του στήλη αριστερά (π.χ. «!?» στα υπομενού συμβόλων) */
  symbol?: string;
  /** σημάδι ✓ (π.χ. το σύμβολο που έχει ήδη η κίνηση) */
  checked?: boolean;
  /** υπομενού: ανοίγει με το ποντίκι από πάνω, με κλικ ή με → */
  submenu?: MenuItem[];
  /** επικεφαλίδα ενότητας (δεν πατιέται) */
  heading?: boolean;
}

const usable = (it: MenuItem) => !it.separator && !it.heading && !it.disabled;

/** Το επόμενο / προηγούμενο ενεργό στοιχείο (κυκλικά), για τα βελάκια. */
function stepItem(items: MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  const start = from < 0 ? (dir === 1 ? -1 : n) : from;
  for (let k = 1; k <= n; k++) {
    const i = (((start + dir * k) % n) + n) % n;
    if (usable(items[i])) return i;
  }
  return from;
}

interface OpenSub {
  index: number;
  /** επιλεγμένο στοιχείο του υπομενού (-1: η εστίαση είναι ακόμη στο κύριο μενού) */
  hot: number;
  left: number;
  top: number;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [hot, setHot] = useState(-1);
  const [sub, setSub] = useState<OpenSub | null>(null);
  // μικρή καθυστέρηση στην αλλαγή υπομενού, για να φτάνει το ποντίκι σε αυτό διαγώνια
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const subItems = sub ? (items[sub.index].submenu ?? []) : [];

  const run = (it: MenuItem) => {
    onClose();
    it.onClick?.();
  };
  // το υπομενού ανοίγει δεξιά από το στοιχείο, ή αριστερά αν δεν χωράει
  const openSub = (index: number, keyboard: boolean) => {
    const it = items[index];
    const r = buttons.current[index]?.getBoundingClientRect();
    if (!it.submenu || !usable(it) || !r) return;
    const width = 250;
    const height = it.submenu.length * 29 + 12;
    const left = r.right + width > window.innerWidth ? Math.max(4, r.left - width + 4) : r.right - 4;
    const top = Math.max(4, Math.min(r.top - 5, window.innerHeight - height - 4));
    setSub({ index, hot: keyboard ? stepItem(it.submenu, -1, 1) : -1, left, top });
  };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const inSub = sub !== null && sub.hot >= 0;
    switch (e.key) {
      case 'Escape':
        if (sub) setSub(null);
        else onClose();
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        if (sub && inSub) setSub({ ...sub, hot: stepItem(subItems, sub.hot, dir) });
        else {
          setHot(stepItem(items, hot, dir));
          setSub(null);
        }
        break;
      }
      case 'ArrowRight':
        if (!inSub && hot >= 0) openSub(hot, true);
        break;
      case 'ArrowLeft':
        if (sub) setSub(null);
        break;
      case 'Enter':
      case ' ': {
        const it = sub && inSub ? subItems[sub.hot] : items[hot];
        if (!it || !usable(it)) break;
        if (it.submenu) openSub(hot, true);
        else run(it);
        break;
      }
      default:
        return;
    }
    // το μενού έχει προτεραιότητα: τα βελάκια δεν κινούν και την παρτίδα από πίσω
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => keyRef.current(e);
    // (αν το effect ξανατρέξει πριν από το setTimeout, π.χ. νέα σχεδίαση αμέσως μετά το άνοιγμα, ο παλιός ακροατής
    // δεν πρέπει να μπει ποτέ: αλλιώς μένει και κλείνει το επόμενο μενού μόλις πατηθεί το ποντίκι πάνω του)
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const row = (it: MenuItem, i: number, symbols: boolean, isHot: boolean, enter: () => void, click: () => void, refFn?: (el: HTMLButtonElement | null) => void) =>
    it.separator ? (
      <div key={i} className="sep" />
    ) : it.heading ? (
      <div key={i} className="menu-head">
        {it.label}
      </div>
    ) : (
      <button
        key={i}
        ref={refFn}
        className={[it.danger && 'danger', isHot && 'hot', it.checked && 'checked'].filter(Boolean).join(' ')}
        disabled={it.disabled}
        onMouseEnter={enter}
        onClick={click}
      >
        {symbols && <span className="menu-sym">{it.symbol ?? ''}</span>}
        <span className="menu-label">{it.label}</span>
        {it.checked && <span className="menu-check">✓</span>}
        {it.shortcut && <kbd>{it.shortcut}</kbd>}
        {it.submenu && <span className="menu-arrow">›</span>}
      </button>
    );

  // να μη βγαίνει έξω από το παράθυρο
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.max(4, Math.min(y, window.innerHeight - items.length * 30 - 20));
  const subSymbols = subItems.some((it) => it.symbol);
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      <div className="context-menu" style={{ left, top }}>
        {items.map((it, i) =>
          row(
            it,
            i,
            false,
            hot === i || sub?.index === i,
            () => {
              setHot(i);
              clearTimeout(timer.current);
              if (sub?.index === i) return;
              timer.current = window.setTimeout(() => (it.submenu ? openSub(i, false) : setSub(null)), sub ? 200 : 60);
            },
            () => (it.submenu ? openSub(i, false) : run(it)),
            (el) => {
              buttons.current[i] = el;
            },
          ),
        )}
      </div>
      {sub && (
        <div
          className="context-menu sub"
          style={{ left: sub.left, top: sub.top }}
          onMouseEnter={() => {
            clearTimeout(timer.current);
            setHot(sub.index);
          }}
        >
          {subItems.map((it, j) =>
            row(
              it,
              j,
              subSymbols,
              sub.hot === j,
              () => setSub({ ...sub, hot: j }),
              () => run(it),
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" title={label}>
      <div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
      {label && <span>{label}</span>}
    </div>
  );
}
