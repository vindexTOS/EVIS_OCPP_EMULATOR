const trim = (n: number, digits: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** 850 → "850 Wh", 12 340 → "12.34 kWh", 1 234 000 → "1.23 MWh". */
export function fmtEnergy(wh: number): string {
  const v = Math.max(0, wh);
  if (v >= 1_000_000) return `${trim(v / 1_000_000, 2)} MWh`;
  if (v >= 1000) return `${trim(v / 1000, 2)} kWh`;
  return `${Math.round(v)} Wh`;
}

export const fmtKwh = (wh: number, digits = 2) => trim(Math.max(0, wh) / 1000, digits);

/** Always two decimals, so a live counter does not change width as it runs. */
export const fmtKwhFixed = (wh: number) => (Math.max(0, wh) / 1000).toFixed(2);

/** 800 → "800 W", 11 000 → "11 kW", 22 080 → "22.1 kW". */
export function fmtPower(w: number): string {
  const v = Math.max(0, w);
  if (v >= 1000) return `${trim(v / 1000, 1)} kW`;
  return `${Math.round(v)} W`;
}

export const fmtKw = (w: number, digits = 1) => trim(Math.max(0, w) / 1000, digits);

/** 75 → "1:15", 3 725 → "1:02:05". */
export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 75 → "1 min", 3 725 → "1 h 2 min", 40 → "40 s". */
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** 14:37:26 – compact, for logs. */
export const fmtLogTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });

/** "3 s ago", "12 min ago", "2 h ago", then a date. */
export function fmtAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec} s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return fmtDateTime(iso);
}

export const secondsUntil = (iso: string | null, now = Date.now()) =>
  iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0;
