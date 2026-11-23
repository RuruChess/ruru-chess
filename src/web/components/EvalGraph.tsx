/** Γράφημα αξιολόγησης παρτίδας (από [%eval] ή από την ανάλυση μηχανής). */
import { winChance } from './EnginePanel.tsx';

export interface EvalPoint {
  cp: number | null;
  mate: number | null;
  /** σήμανση λάθους: 1 ?!, 2 ?, 3 ?? */
  mark?: number;
}

export function EvalGraph({ points, current, onSelect }: { points: Array<EvalPoint | null>; current: number; onSelect: (ply: number) => void }) {
  const n = points.length;
  if (n < 2) return null;
  const W = 600;
  const H = 90;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (p: EvalPoint | null) => (1 - (p ? winChance(p.cp, p.mate) : 0.5)) * H;
  let d = `M0,${H / 2}`;
  points.forEach((p, i) => {
    d += ` L${x(i).toFixed(1)},${y(p).toFixed(1)}`;
  });
  const area = `${d} L${W},${H / 2} Z`;
  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
        onSelect(Math.max(0, Math.min(n - 1, i)));
      }}
    >
      <rect x={0} y={0} width={W} height={H / 2} className="eg-black" />
      <rect x={0} y={H / 2} width={W} height={H / 2} className="eg-white" />
      <path d={area} className="eg-area" />
      <path d={d} className="eg-line" fill="none" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      {points.map((p, i) =>
        p?.mark ? <circle key={i} cx={x(i)} cy={y(p)} r={p.mark === 3 ? 4 : 3} className={`eg-mark m${p.mark}`} /> : null,
      )}
      {current >= 0 && current < n && <line x1={x(current)} x2={x(current)} y1={0} y2={H} className="eg-cursor" />}
    </svg>
  );
}
