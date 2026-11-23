/** Γραφήματα του βαθμού (χωρίς βιβλιοθήκη): γραμμή μίας σειράς με σταυρόνημα και ένδειξη στο ποντίκι και στα βέλη, πίνακας τιμών, και η μικρή γραμμή τάσης του πλάγιου πάνελ. Ένα χρώμα σειράς (`--chart-bar`, ελεγμένο στο φωτεινό και στο σκοτεινό θέμα), κείμενα με τα χρώματα κειμένου. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { L, fmtNum, language } from '../i18n.ts';

export interface RatingPoint {
  day: string;
  value: number;
  n?: number;
}

const DAY = 86_400_000;
const dayTs = (d: string) => new Date(`${d}T12:00:00`).getTime();
const shortDay = (d: string) => {
  const [, m, dd] = d.split('-');
  return `${Number(dd)}/${Number(m)}`;
};
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(language() === 'el' ? 'el-GR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long' });

/** Στρογγυλά όρια και βήμα για τον άξονα του βαθμού. */
export function niceRange(min: number, max: number): { lo: number; hi: number; step: number } {
  const span = Math.max(20, max - min);
  const raw = span / 4;
  const step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => s >= raw) ?? 500;
  const lo = Math.floor((min - span * 0.08) / step) * step;
  const hi = Math.ceil((max + span * 0.08) / step) * step;
  return { lo, hi: hi === lo ? lo + step : hi, step };
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function RatingChart({ title, points, unitLabel }: { title: string; points: RatingPoint[]; unitLabel: string }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hot, setHot] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const H = 200;
  const pad = { l: 44, r: 56, t: 12, b: 26 };
  const geo = useMemo(() => {
    if (points.length < 1 || width <= 0) return null;
    const vals = points.map((p) => p.value);
    const { lo, hi, step } = niceRange(Math.min(...vals), Math.max(...vals));
    const t0 = dayTs(points[0].day);
    const t1 = dayTs(points[points.length - 1].day);
    const span = Math.max(DAY, t1 - t0);
    const iw = Math.max(10, width - pad.l - pad.r);
    const ih = H - pad.t - pad.b;
    const x = (d: string) => pad.l + (points.length === 1 ? iw / 2 : ((dayTs(d) - t0) / span) * iw);
    const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
    const xy = points.map((p) => [x(p.day), y(p.value)] as const);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + 0.001; v += step) ticks.push(v);
    return { xy, ticks, y, ih, iw, lo };
  }, [points, width]);

  const nearest = (clientX: number, el: SVGSVGElement) => {
    if (!geo) return null;
    const r = el.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i][0] - px) < Math.abs(geo.xy[best][0] - px)) best = i;
    return best;
  };

  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? Math.round(last.value) - Math.round(first.value) : 0;
  const summary = first && last ? L(`${title}: από ${fmtNum(Math.round(first.value))} (${shortDay(first.day)}) σε ${fmtNum(Math.round(last.value))} (${shortDay(last.day)})`, `${title}: from ${fmtNum(Math.round(first.value))} (${shortDay(first.day)}) to ${fmtNum(Math.round(last.value))} (${shortDay(last.day)})`) : title;
  const hp = hot !== null ? points[hot] : null;

  return (
    <figure className="chart tx-chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <button type="button" className="link-btn" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? L('Γράφημα', 'Chart') : L('Πίνακας', 'Table')}
        </button>
      </figcaption>
      {table ? (
        <div className="tx-chart-table">
          <table className="table chart-table">
            <thead>
              <tr>
                <th>{L('Ημέρα', 'Day')}</th>
                <th className="r">{unitLabel}</th>
                <th className="r">{L('Puzzles', 'Puzzles')}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day}>
                  <td>{longDay(p.day)}</td>
                  <td className="r">{fmtNum(Math.round(p.value))}</td>
                  <td className="r">{p.n ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="tx-chart-plot">
          {points.length < 2 ? (
            <p className="muted tx-chart-empty">
              {points.length
                ? L(`Μία μέρα ως τώρα: ${fmtNum(Math.round(points[0].value))}. Η γραμμή φαίνεται από τη δεύτερη μέρα με βαθμολογημένα puzzles.`, `One day so far: ${fmtNum(Math.round(points[0].value))}. The line appears after a second day of rated puzzles.`)
                : L('Δεν υπάρχουν ακόμη βαθμολογημένα puzzles σε αυτό το διάστημα.', 'No rated puzzles in this period yet.')}
            </p>
          ) : (
            geo && (
              <svg
                width={width}
                height={H}
                role="img"
                aria-label={summary}
                tabIndex={0}
                className="tx-chart-svg"
                onPointerMove={(e) => setHot(nearest(e.clientX, e.currentTarget))}
                onPointerLeave={() => setHot(null)}
                onBlur={() => setHot(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                    e.preventDefault();
                    e.stopPropagation();
                    const cur = hot ?? points.length - 1;
                    const n = e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : cur + (e.key === 'ArrowLeft' ? -1 : 1);
                    setHot(Math.max(0, Math.min(points.length - 1, n)));
                  }
                }}
              >
                {geo.ticks.map((v) => (
                  <g key={v}>
                    <line x1={pad.l} x2={width - pad.r} y1={geo.y(v)} y2={geo.y(v)} className="tx-grid" />
                    <text x={pad.l - 8} y={geo.y(v) + 4} textAnchor="end" className="tx-axis">
                      {fmtNum(v)}
                    </text>
                  </g>
                ))}
                {[0, Math.floor((points.length - 1) / 2), points.length - 1]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map((i) => (
                    <text key={i} x={geo.xy[i][0]} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="tx-axis">
                      {shortDay(points[i].day)}
                    </text>
                  ))}
                <path d={`M${geo.xy[0][0]},${pad.t + geo.ih} ${geo.xy.map(([x, y]) => `L${x},${y}`).join(' ')} L${geo.xy[geo.xy.length - 1][0]},${pad.t + geo.ih} Z`} className="tx-area" />
                <polyline points={geo.xy.map(([x, y]) => `${x},${y}`).join(' ')} className="tx-line-s" />
                {hp && hot !== null && <line x1={geo.xy[hot][0]} x2={geo.xy[hot][0]} y1={pad.t} y2={pad.t + geo.ih} className="tx-cross" />}
                {hot !== null && <circle cx={geo.xy[hot][0]} cy={geo.xy[hot][1]} r={4} className="tx-dot" />}
                <circle cx={geo.xy[geo.xy.length - 1][0]} cy={geo.xy[geo.xy.length - 1][1]} r={4} className="tx-dot" />
                <text x={geo.xy[geo.xy.length - 1][0] + 9} y={geo.xy[geo.xy.length - 1][1] + 4} className="tx-end-label">
                  {fmtNum(Math.round(last.value))}
                </text>
              </svg>
            )
          )}
          <div className="vbars-readout faint tnum" aria-live="polite">
            {hp ? (
              <>
                <b className="tx-readout-v">{fmtNum(Math.round(hp.value))}</b> {longDay(hp.day)}
                {hp.n ? L(` · ${hp.n} puzzles`, ` · ${hp.n} puzzles`) : ''}
              </>
            ) : points.length >= 2 ? (
              L(`Μεταβολή στο διάστημα: ${change > 0 ? '+' : change < 0 ? '−' : '±'}${fmtNum(Math.abs(change))}`, `Change in the period: ${change > 0 ? '+' : change < 0 ? '−' : '±'}${fmtNum(Math.abs(change))}`)
            ) : (
              ''
            )}
          </div>
        </div>
      )}
    </figure>
  );
}

/** Μικρή γραμμή τάσης (πλάγιο πάνελ): η σειρά στο γκρι, το σημερινό σημείο στο χρώμα έμφασης. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="spark-wrap spark-empty faint">{L('Η τάση φαίνεται από τη δεύτερη μέρα', 'The trend appears from the second day')}</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 300, 54 - ((v - min) / span) * 48] as const);
  const lastY = pts[pts.length - 1][1];
  return (
    <div className="spark-wrap" role="img" aria-label={label}>
      <svg className="spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden>
        <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      <i className="spark-dot" style={{ left: '100%', top: `${(lastY / 60) * 100}%` }} />
    </div>
  );
}
