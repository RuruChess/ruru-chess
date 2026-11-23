/**
 * Απλό ραβδόγραμμα μίας σειράς (χωρίς βιβλιοθήκη): λεπτές ράβδοι ενός χρώματος (--chart-bar,
 * ελεγμένο για αντίθεση σε φωτεινό και σκοτεινό θέμα), tooltip σε κάθε ράβδο και πίνακας με τις
 * τιμές για όποιον δεν βλέπει το γράφημα. Οριζόντιο για κατηγορίες, κάθετο για τον χρόνο.
 */
import { useState } from 'react';
import { L, fmtNum } from '../i18n.ts';

export interface Bar {
  label: string;
  value: number;
  /** κείμενο για το tooltip (αλλιώς η τιμή) */
  note?: string;
}

export function BarChart({ title, bars, orientation = 'horizontal', unit, valueLabel }: { title: string; bars: Bar[]; orientation?: 'horizontal' | 'vertical'; unit?: string; valueLabel?: (v: number) => string }) {
  const [hot, setHot] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const fmt = valueLabel ?? ((v: number) => `${fmtNum(v)}${unit ? ` ${unit}` : ''}`);
  const tip = (b: Bar) => `${b.label}: ${b.note ?? fmt(b.value)}`;
  return (
    <figure className={`chart chart-${orientation}`}>
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <button type="button" className="link-btn" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? L('Γράφημα', 'Chart') : L('Πίνακας', 'Table')}
        </button>
      </figcaption>
      {table ? (
        <table className="table chart-table">
          <thead>
            <tr>
              <th>{orientation === 'vertical' ? L('Περίοδος', 'Period') : L('Τιμή', 'Item')}</th>
              <th className="r">{L('Πλήθος', 'Count')}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td className="r">{b.note ?? fmt(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : orientation === 'horizontal' ? (
        <div className="hbars" role="list">
          {bars.map((b, i) => (
            <div key={b.label} className={`hbar${hot === i ? ' is-hot' : ''}`} role="listitem" title={tip(b)} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)}>
              <span className="hbar-label">{b.label}</span>
              <span className="hbar-track" aria-hidden>
                <i style={{ width: `${(b.value / max) * 100}%` }} />
              </span>
              <span className="hbar-value tnum">{b.note ?? fmt(b.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="vbars-wrap">
          <div className="vbars" role="list" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
            {bars.map((b, i) => (
              <div key={b.label} className={`vbar${hot === i ? ' is-hot' : ''}`} role="listitem" aria-label={tip(b)} title={tip(b)} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)}>
                <i style={{ height: `${(b.value / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="vbars-axis" aria-hidden style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
            {bars.map((b, i) => (
              <span key={b.label}>{i % Math.ceil(bars.length / 10) === 0 ? b.label : ''}</span>
            ))}
          </div>
          <div className="vbars-readout faint tnum" aria-live="polite">
            {hot !== null ? tip(bars[hot]) : L(`Μέγιστο: ${fmt(max)}`, `Peak: ${fmt(max)}`)}
          </div>
        </div>
      )}
    </figure>
  );
}
