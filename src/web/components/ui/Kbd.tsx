/** Πλήκτρα (`kbd`): ένα πλήκτρο ή συνδυασμός όπως «Ctrl+Shift+A». */
import { splitKeys } from '../../commands.ts';

export function Kbd({ children }: { children: string }) {
  return <span className="kbd">{children}</span>;
}

export function Keys({ keys, className }: { keys: string; className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center' }} aria-label={keys}>
      {splitKeys(keys).map((k, i) => (
        <span key={i} className="kbd" aria-hidden>
          {k}
        </span>
      ))}
    </span>
  );
}
