/** Κενή κατάσταση: εικονίδιο, τίτλος, εξήγηση και κουμπί δράσης. */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({ icon: Icon, title, children, action, compact }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? ' empty-compact' : ''}`}>
      {Icon && (
        <span className="empty-icon" aria-hidden>
          <Icon className="ic ic-lg" />
        </span>
      )}
      <span className="empty-title">{title}</span>
      {children && <span className="empty-text">{children}</span>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
