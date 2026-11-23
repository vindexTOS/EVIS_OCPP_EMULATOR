import type { ReactNode } from 'react';
import type { ConnectorType } from '../lib/types';

// The face of each plug type, simplified but recognisable: the housing outline
// and the pin pattern. Drawn in currentColor so it takes the tone around it.

type Pin = [cx: number, cy: number, r: number];

const pins = (list: Pin[]) =>
  list.map(([cx, cy, r], i) => <circle key={i} cx={cx} cy={cy} r={r} fill="currentColor" />);

const housing = (d: string) => <path d={d} className="plug-housing" />;
const round = (cx: number, cy: number, r: number) => (
  <circle cx={cx} cy={cy} r={r} className="plug-housing" />
);

/** A circle with its top cut flat (Type 2 and its relatives). */
const flatTop = (cx: number, cy: number, r: number, cut: number) => {
  const dy = cut - cy;
  const dx = Math.sqrt(r * r - dy * dy);
  return `M ${cx - dx} ${cut} L ${cx + dx} ${cut} A ${r} ${r} 0 1 1 ${cx - dx} ${cut} Z`;
};

const DC_PINS: Pin[] = [
  [13.5, 32.4, 3.5],
  [26.5, 32.4, 3.5],
];
const dcBlock = <rect x="6.5" y="26.6" width="27" height="11.6" rx="5.8" className="plug-housing" />;

const FACES: Record<ConnectorType, ReactNode> = {
  Type2: (
    <>
      {housing(flatTop(20, 21, 17, 8))}
      {pins([
        [14.5, 13.5, 2.1],
        [25.5, 13.5, 2.1],
        [10.5, 21.5, 3],
        [20, 21.5, 3],
        [29.5, 21.5, 3],
        [15, 30, 3],
        [25, 30, 3],
      ])}
    </>
  ),
  Type1: (
    <>
      <rect x="16.5" y="1.2" width="7" height="3.4" rx="1.2" fill="currentColor" />
      {round(20, 21, 16.5)}
      {pins([
        [13.2, 15.2, 3.3],
        [26.8, 15.2, 3.3],
        [20, 29.2, 3.3],
        [10.6, 25, 2],
        [29.4, 25, 2],
      ])}
    </>
  ),
  CCS2: (
    <>
      {housing(flatTop(20, 13.2, 11.6, 4.2))}
      {dcBlock}
      {pins([
        [16.4, 8.2, 1.4],
        [23.6, 8.2, 1.4],
        [13.4, 13.4, 2],
        [20, 13.4, 2],
        [26.6, 13.4, 2],
        [16.6, 19, 2],
        [23.4, 19, 2],
        ...DC_PINS,
      ])}
    </>
  ),
  CCS1: (
    <>
      {round(20, 13.2, 11.6)}
      {dcBlock}
      {pins([
        [15.4, 9.4, 2.2],
        [24.6, 9.4, 2.2],
        [20, 19.2, 2.2],
        [13, 16, 1.4],
        [27, 16, 1.4],
        ...DC_PINS,
      ])}
    </>
  ),
  CHAdeMO: (
    <>
      {round(20, 20, 17)}
      {pins([
        [11.6, 20, 4.2],
        [28.4, 20, 4.2],
        [17, 10.4, 1.7],
        [23, 10.4, 1.7],
        [17, 29.6, 1.7],
        [23, 29.6, 1.7],
      ])}
    </>
  ),
  GBT_AC: (
    <>
      <g transform="translate(0 41) scale(1 -1)">{housing(flatTop(20, 21, 17, 8))}</g>
      {pins([
        [15, 11.5, 2.8],
        [25, 11.5, 2.8],
        [10.5, 20, 2.8],
        [20, 20, 2.8],
        [29.5, 20, 2.8],
        [15, 28.2, 2],
        [25, 28.2, 2],
      ])}
    </>
  ),
  GBT_DC: (
    <>
      {housing(flatTop(20, 21, 17, 8))}
      {pins([
        [12, 19.5, 4.3],
        [28, 19.5, 4.3],
        [20, 28.6, 3],
        [14.4, 11.6, 1.5],
        [20, 10.8, 1.5],
        [25.6, 11.6, 1.5],
        [11.2, 29.4, 1.5],
        [28.8, 29.4, 1.5],
      ])}
    </>
  ),
  NACS: (
    <>
      {housing('M 7.5 15 C 7.5 5.5 32.5 5.5 32.5 15 L 30.2 26.5 C 29 35.5 11 35.5 9.8 26.5 Z')}
      {pins([
        [14, 15, 4],
        [26, 15, 4],
        [20, 24.6, 2.6],
        [14.6, 28.4, 1.5],
        [25.4, 28.4, 1.5],
      ])}
    </>
  ),
  Schuko: (
    <>
      {round(20, 20, 17)}
      <rect x="18" y="3.6" width="4" height="4.4" rx="1" fill="currentColor" />
      <rect x="18" y="32" width="4" height="4.4" rx="1" fill="currentColor" />
      {pins([
        [12.8, 20, 2.9],
        [27.2, 20, 2.9],
      ])}
    </>
  ),
};

export function PlugIcon({
  type,
  size = 22,
  className,
}: {
  type: ConnectorType;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={`plug-icon${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {FACES[type]}
    </svg>
  );
}
