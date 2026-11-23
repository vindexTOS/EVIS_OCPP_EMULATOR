import { useId } from 'react';

// A car in side view, drawn facing left: nose on the left, charge port at the
// rear on the right. The battery pack in the floor fills with the state of
// charge, so the level reads at a glance.

const BODY =
  'M 14 70 C 12 58 18 50 34 46 L 70 40 C 86 22 104 14 128 14 L 168 14 ' +
  'C 190 15 206 26 214 44 C 224 46 228 54 228 64 L 228 70 C 228 74 224 76 220 76 ' +
  'L 198 76 A 20 20 0 0 0 158 76 L 82 76 A 20 20 0 0 0 42 76 L 20 76 C 16 76 14 74 14 70 Z';

export function CarArt({
  color,
  soc,
  charging = false,
  plugged = false,
  mirrored = false,
  width = 240,
}: {
  color: string;
  /** State of charge, 0–100. */
  soc: number;
  charging?: boolean;
  plugged?: boolean;
  /** Flip so the charge port is on the left. */
  mirrored?: boolean;
  width?: number;
}) {
  const id = useId().replace(/:/g, '');
  const level = Math.max(0, Math.min(100, soc));
  const packWidth = 72;
  const fill = (packWidth * level) / 100;
  const tone = charging
    ? 'var(--tone-energy)'
    : level < 15
      ? 'var(--tone-crit)'
      : level < 30
        ? 'var(--tone-warn)'
        : 'var(--tone-ok)';

  return (
    <svg
      viewBox="0 0 240 104"
      width={width}
      height={(width * 104) / 240}
      className={`car-art${charging ? ' is-charging' : ''}`}
      style={{ transform: mirrored ? 'scaleX(-1)' : undefined, color }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`paint-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.34" />
        </linearGradient>
        <clipPath id={`body-${id}`}>
          <path d={BODY} />
        </clipPath>
        <clipPath id={`pack-${id}`}>
          <rect x="84" y="60.5" width={packWidth} height="9" rx="3" />
        </clipPath>
      </defs>

      <ellipse cx="120" cy="95" rx="100" ry="6" fill="#000" opacity="0.28" />

      {/* Paint, then shading on top of it. */}
      <path d={BODY} fill="currentColor" />
      <path d={BODY} fill={`url(#paint-${id})`} />
      <g clipPath={`url(#body-${id})`}>
        <rect x="10" y="69" width="222" height="9" fill="#000" opacity="0.32" />
      </g>

      {/* Glass */}
      <path d="M 78 40 C 90 27 104 21 123 20.5 L 123 40 Z" fill="#0b1118" opacity="0.88" />
      <path d="M 130 20.5 L 166 20.5 C 182 21.5 194 28.5 202 40 L 130 40 Z" fill="#0b1118" opacity="0.88" />
      <path d="M 84 37 C 93 28 104 24 118 23.5" stroke="#fff" strokeOpacity="0.22" strokeWidth="1.4" fill="none" strokeLinecap="round" />

      {/* Door seam, handle, lights */}
      <path d="M 127 42 L 127 71" stroke="#000" strokeOpacity="0.22" strokeWidth="1" />
      <rect x="136" y="47" width="12" height="2.6" rx="1.3" fill="#000" opacity="0.28" />
      <rect x="17" y="51" width="13" height="4.6" rx="2.3" fill="#fff6cf" />
      <rect x="221.5" y="48" width="6" height="9.5" rx="2.4" fill="#ff5a4f" />

      {/* Battery pack in the floor */}
      <rect x="84" y="60.5" width={packWidth} height="9" rx="3" fill="#05080b" opacity="0.62" />
      <g clipPath={`url(#pack-${id})`}>
        <rect
          className="car-pack-fill"
          x="84"
          y="60.5"
          width={fill}
          height="9"
          fill={tone}
          style={{ transition: 'width 1s linear, fill 0.4s' }}
        />
        {charging && <rect className="car-pack-shine" x="84" y="60.5" width="22" height="9" fill="#fff" opacity="0.38" />}
      </g>
      <rect x="84" y="60.5" width={packWidth} height="9" rx="3" fill="none" stroke="#fff" strokeOpacity="0.2" strokeWidth="0.8" />

      {/* Wheels */}
      {[62, 178].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="76" r="17" fill="#090c10" />
          <circle cx={cx} cy="76" r="10.5" fill="#2b333e" />
          <circle cx={cx} cy="76" r="10.5" fill="none" stroke="#8a95a3" strokeOpacity="0.55" strokeWidth="1.4" />
          <circle cx={cx} cy="76" r="3.6" fill="#97a2b0" />
        </g>
      ))}

      {/* Charge port */}
      <circle cx="207" cy="53" r="5.2" fill="#0a0e13" stroke={plugged ? 'var(--tone-energy)' : '#ffffff'} strokeOpacity={plugged ? 1 : 0.35} strokeWidth="1.4" />
      {plugged && <circle className="car-port-glow" cx="207" cy="53" r="8.5" fill="none" stroke="var(--tone-energy)" strokeWidth="1.2" />}
    </svg>
  );
}
