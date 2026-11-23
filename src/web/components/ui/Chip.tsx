/** Chip φίλτρου (αφαιρείται με ×), ετικέτα (tag) και μικρές τελείες κατάστασης. */
import type { ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { L } from '../../i18n.ts';

export function Chip({ k, children, onRemove, title }: { k?: string; children: ReactNode; onRemove?: () => void; title?: string }) {
  return (
    <span className={`chip${onRemove ? '' : ' chip-plain'}`} title={title}>
      {k && <span className="k">{k}</span>}
      {children}
      {onRemove && (
        <button type="button" className="chip-x" aria-label={L(`Αφαίρεση φίλτρου ${k ?? ''}`.trim(), `Remove filter ${k ?? ''}`.trim())} onClick={onRemove}>
          <X className="ic ic-sm" aria-hidden />
        </button>
      )}
    </span>
  );
}

export function ChipAdd({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip chip-add" onClick={onClick}>
      <Plus className="ic ic-sm" aria-hidden />
      {children}
    </button>
  );
}

export type TagTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger';

export function Tag({ tone = 'default', children, title }: { tone?: TagTone; children: ReactNode; title?: string }) {
  return (
    <span className={`tag${tone !== 'default' ? ` tag-${tone}` : ''}`} title={title}>
      {children}
    </span>
  );
}
