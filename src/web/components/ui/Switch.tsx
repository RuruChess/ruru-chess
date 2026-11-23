/** Διακόπτης (role="switch") και κουτάκι επιλογής (role="checkbox") του συστήματος σχεδίασης. */
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export function Switch({ checked, onChange, label, title, disabled, hideLabel, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; title?: string; disabled?: boolean; hideLabel?: boolean; id?: string }) {
  return (
    <button
      type="button"
      id={id}
      className="switch"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      aria-label={hideLabel && typeof label === 'string' ? label : undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="track" aria-hidden />
      {!hideLabel && label}
    </button>
  );
}

export function Checkbox({ checked, onChange, label, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <span
      className={`check${disabled ? ' is-disabled' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      title={title}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <span className="box" aria-hidden>
        <Check className="ic" />
      </span>
      {label}
    </span>
  );
}
