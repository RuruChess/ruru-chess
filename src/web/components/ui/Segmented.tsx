/** Τμηματικός επιλογέας (μία από λίγες επιλογές) και υπογραμμισμένες καρτέλες μέσα σε πάνελ. */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  title?: string;
}

/** `kb`: ο διακόπτης του νέου σχεδίου (.kb-sgc στο styles.css), σε όλο το πλάτος */
export function Segmented<T extends string>({ value, options, onChange, label, large, kb }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; label: string; large?: boolean; kb?: boolean }) {
  return (
    <div className={kb ? 'kb-sgc' : `seg${large ? ' seg-lg' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon className="ic ic-sm" aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface UTab<T extends string> {
  value: T;
  label: ReactNode;
  count?: string;
}

/** Καρτέλες με υπογράμμιση (role="tablist"), με ← → ανάμεσά τους. */
export function UTabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: UTab<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <div
      className="utabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = tabs.findIndex((t) => t.value === value);
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        if (n) {
          e.preventDefault();
          onChange(n.value);
          const btn = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[tabs.indexOf(n)];
          btn?.focus();
        }
      }}
    >
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" className="utab" aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
