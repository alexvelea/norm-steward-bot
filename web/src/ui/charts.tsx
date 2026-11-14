// Hand-drawn SVG line charts for the Chronicle: a few series over game ticks, a soft area under the
// first, gridlines on round numbers, and a crosshair that reads every series at the pointer.
import { useId, useMemo, useState, type PointerEvent } from "react";
import { formatCompact } from "../lib/format";

export interface Series {
  name: string;
  color: string;
  values: number[];
}

const W = 400;
const H = 168;
const PAD = { left: 40, right: 10, top: 12, bottom: 22 };

function niceStep(range: number, steps: number): number {
  const raw = range / Math.max(1, steps);
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

export function LineChart({ ticks, series, area = true }: { ticks: number[]; series: Series[]; area?: boolean }) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const step = niceStep(max, 4);
    const top = Math.ceil(max / step) * step;
    const first = ticks[0] ?? 0;
    const last = ticks[ticks.length - 1] ?? 1;
    const x = (t: number) => PAD.left + ((t - first) / Math.max(1, last - first)) * (W - PAD.left - PAD.right);
    const y = (v: number) => H - PAD.bottom - (v / top) * (H - PAD.top - PAD.bottom);
    const grid: number[] = [];
    for (let v = 0; v <= top + step / 2; v += step) grid.push(v);
    return { x, y, grid, first, last };
  }, [ticks, series]);

  if (ticks.length < 2) return <p className="empty">The chronicle starts with the first samples.</p>;
  const { x, y, grid, first, last } = geometry;
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(ticks[i]!).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = first + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (last - first);
    let best = 0;
    for (let i = 1; i < ticks.length; i++) if (Math.abs(ticks[i]! - t) < Math.abs(ticks[best]! - t)) best = i;
    setHover(best);
  };

  const hx = hover !== null ? x(ticks[hover]!) : 0;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={series[0]?.color} stopOpacity="0.32" />
            <stop offset="1" stopColor={series[0]?.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={PAD.left - 6} y={y(v) + 3} className="chart-label" textAnchor="end">
              {formatCompact(v)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="chart-label">
          t{first}
        </text>
        <text x={W - PAD.right} y={H - 6} className="chart-label" textAnchor="end">
          t{last}
        </text>
        {area && series[0] && (
          <path d={`${path(series[0].values)}L${x(last)},${y(0)}L${x(first)},${y(0)}Z`} fill={`url(#${gradientId})`} />
        )}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover !== null && (
          <g>
            <line x1={hx} x2={hx} y1={PAD.top} y2={H - PAD.bottom} className="chart-cross" />
            {series.map((s) => (
              <circle key={s.name} cx={hx} cy={y(s.values[hover] ?? 0)} r="3.2" fill={s.color} stroke="var(--ink)" strokeWidth="1.2" />
            ))}
          </g>
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
            {hover !== null && <b className="mono">{formatCompact(s.values[hover] ?? 0)}</b>}
          </span>
        ))}
        {hover !== null && <span className="muted mono chart-at">t{ticks[hover]}</span>}
      </div>
    </div>
  );
}
