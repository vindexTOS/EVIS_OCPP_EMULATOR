import { useEffect, useRef, useState } from 'react';

/** Width of an element, tracked as it resizes. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round tick values that cover 0…max in about `count` steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** 1,284 below ten thousand, 12.9K from there on. */
export const compact = (n: number) =>
  n >= 10_000
    ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`
    : n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 1 : 0 });

/** Colour of a connector's series: fixed by its number, never by its rank. */
export const connectorColor = (connectorId: number) =>
  connectorId >= 1 && connectorId <= 8 ? `var(--series-${connectorId})` : 'var(--series-other)';

