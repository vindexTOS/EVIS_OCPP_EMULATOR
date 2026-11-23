import { useState, type ReactNode } from 'react';
import { compact, niceTicks, useWidth } from './chartUtils';

// Small hand-built SVG charts. They follow one set of rules: thin marks, a
// hairline grid, text in ink (never in the series colour), a tooltip that adds
// to what is on screen instead of hiding it, and a table twin for every chart.

export interface Series {
  key: string;
  label: string;
  color: string;
}

export function Legend({ series, line }: { series: Series[]; line?: boolean }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}>
          <i className={line ? 'line' : undefined} style={{ ['--c' as string]: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; color: string }[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <header>{tip.title}</header>
      {tip.rows.map((row) => (
        <div key={row.label}>
          <span>
            <i style={{ ['--c' as string]: row.color }} />
            {row.label}
          </span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

/** A column with a rounded data end and a square foot on the baseline. */
function columnPath(x: number, top: number, width: number, height: number, rounded: boolean): string {
  const r = rounded ? Math.min(4, height / 2, width / 2) : 0;
  const bottom = top + height;
  return (
    `M ${x} ${bottom} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} ` +
    `L ${x + width - r} ${top} Q ${x + width} ${top} ${x + width} ${top + r} L ${x + width} ${bottom} Z`
  );
}

export interface StackedPoint {
  /** Shown under the column. */
  label: string;
  /** Shown in the tooltip. */
  title: string;
  values: Record<string, number>;
}

/**
 * Stacked columns over time: one column per period, one segment per series.
 * Hovering a column lists every series for that period.
 */
export function StackedColumns({
  points,
  series,
  unit,
  format,
  height = 210,
}: {
  points: StackedPoint[];
  series: Series[];
  unit: string;
  format: (value: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 10, right: 6, bottom: 24, left: 40 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const totals = points.map((p) => series.reduce((sum, s) => sum + (p.values[s.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const band = points.length ? plotW / points.length : 0;
  const barW = Math.max(3, Math.min(24, band * 0.62));
  // Label every nth column so the labels never collide.
  const every = Math.max(1, Math.ceil((points.length * 46) / Math.max(plotW, 1)));

  const tip: Tip | null =
    hover !== null && points[hover]
      ? {
          x: pad.left + band * hover + band / 2,
          y: y(totals[hover]),
          title: points[hover].title,
          rows: [
            ...series
              .filter((s) => (points[hover].values[s.key] ?? 0) > 0 || series.length <= 4)
              .map((s) => ({
                label: s.label,
                value: format(points[hover].values[s.key] ?? 0),
                color: s.color,
              })),
            ...(series.length > 1
              ? [{ label: 'Total', value: format(totals[hover]), color: 'transparent' }]
              : []),
          ],
        }
      : null;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Stacked columns, ${unit} per period`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'axis' : 'grid'} x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          <g className={hover !== null ? 'dim' : undefined}>
            {points.map((p, i) => {
              const x = pad.left + band * i + (band - barW) / 2;
              let below = 0;
              const present = series.filter((s) => (p.values[s.key] ?? 0) > 0);
              return (
                <g
                  key={i}
                  className={hover === i ? 'hot' : undefined}
                  tabIndex={0}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover((h) => (h === i ? null : h))}
                  style={{ outline: 'none' }}
                >
                  {/* The hit area is the whole band, not just the painted column. */}
                  <rect x={pad.left + band * i} y={pad.top} width={band} height={plotH} fill="transparent" />
                  {present.map((s, j) => {
                    const value = p.values[s.key] ?? 0;
                    const full = (value / top) * plotH;
                    // A 2px gap in the surface colour separates stacked segments.
                    const gap = j > 0 && full > 3 ? 2 : 0;
                    const segTop = y(below + value);
                    below += value;
                    return (
                      <path
                        key={s.key}
                        className="bar"
                        d={columnPath(x, segTop, barW, Math.max(1, full - gap), j === present.length - 1)}
                        fill={s.color}
                      />
                    );
                  })}
                  {i % every === 0 && (
                    <text x={pad.left + band * i + band / 2} y={height - 7} textAnchor="middle">
                      {p.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export interface TimePoint {
  t: number;
  value: number;
}

/**
 * One measure over time: a 2px line with a faint wash under it. The crosshair
 * snaps to the nearest reading, so nobody has to aim at the line itself.
 */
export function TimeLine({
  points,
  color,
  label,
  unit,
  format,
  timeLabel,
  height = 150,
  max,
  hoverT,
  onHover,
}: {
  points: TimePoint[];
  color: string;
  label: string;
  unit: string;
  format: (value: number) => string;
  timeLabel: (t: number) => string;
  height?: number;
  /** Fix the top of the scale (e.g. 100 for a percentage). */
  max?: number;
  /** Shared crosshair position, so stacked charts move together. */
  hoverT?: number | null;
  onHover?: (t: number | null) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [own, setOwn] = useState<number | null>(null);
  const cross = hoverT !== undefined ? hoverT : own;
  const setCross = onHover ?? setOwn;

  const pad = { top: 12, right: 12, bottom: 22, left: 40 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const span = Math.max(1, t1 - t0);
  const ticks = niceTicks(max ?? Math.max(...points.map((p) => p.value), 0));
  const top = max ?? ticks[ticks.length - 1];
  const x = (t: number) => pad.left + ((t - t0) / span) * plotW;
  const y = (v: number) => pad.top + plotH - (Math.min(v, top) / top) * plotH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.t).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = points.length
    ? `${line} L ${x(t1).toFixed(1)} ${y(0)} L ${x(t0).toFixed(1)} ${y(0)} Z`
    : '';

  let nearest: TimePoint | null = null;
  if (cross !== null && points.length) {
    nearest = points.reduce((best, p) => (Math.abs(p.t - cross) < Math.abs(best.t - cross) ? p : best));
  }
  const last = points[points.length - 1];
  const xTicks = points.length > 1 ? [t0, t0 + span / 2, t1] : [t0];

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} over time`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - box.left - pad.left) / Math.max(plotW, 1)));
            setCross(t0 + ratio * span);
          }}
          onPointerLeave={() => setCross(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'axis' : 'grid'} x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={x(t)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {timeLabel(t)}
            </text>
          ))}
          {points.length > 1 && (
            <>
              <path d={area} fill={color} opacity={0.1} />
              <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          {nearest ? (
            <>
              <line className="cross" x1={x(nearest.t)} x2={x(nearest.t)} y1={pad.top} y2={pad.top + plotH} />
              <circle cx={x(nearest.t)} cy={y(nearest.value)} r={5} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
            </>
          ) : (
            last && (
              <circle cx={x(last.t)} cy={y(last.value)} r={4.5} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
            )
          )}
        </svg>
      )}
      <Tooltip
        tip={
          nearest
            ? {
                x: x(nearest.t),
                y: y(nearest.value),
                title: timeLabel(nearest.t),
                rows: [{ label, value: `${format(nearest.value)} ${unit}`.trim(), color }],
              }
            : null
        }
      />
    </div>
  );
}

/** Rows of one hue, longest first: for comparing a few named amounts. */
export function RankedBars({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="rank">
      {rows.map((row) => (
        <RankRow key={row.label} label={row.label} width={(row.value / max) * 100} display={row.display} />
      ))}
    </div>
  );
}

function RankRow({ label, width, display }: { label: string; width: number; display: ReactNode }) {
  return (
    <>
      <span>{label}</span>
      <div className="track">
        <div className="fill" style={{ width: `${width}%` }} />
      </div>
      <span className="n">{display}</span>
    </>
  );
}
