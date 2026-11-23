/** Μπάρα προόδου και δείκτης φόρτωσης. */

/** Μπάρα προόδου (0…1)· χωρίς τιμή (null) δείχνει ότι δουλεύει χωρίς γνωστό ποσοστό. */
export function Progress({ value, label, small, ok }: { value: number | null; label?: string; small?: boolean; ok?: boolean }) {
  const pct = value === null ? null : Math.max(0, Math.min(100, value * 100));
  return (
    <div className="progress-wrap">
      <div
        className={`progress${small ? ' progress-sm' : ''}${ok ? ' is-ok' : ''}${pct === null ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct === null ? undefined : Math.round(pct)}
        aria-label={label}
      >
        <span style={{ width: pct === null ? '30%' : `${pct}%` }} />
      </div>
      {label && <span className="progress-label tnum">{label}</span>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}
