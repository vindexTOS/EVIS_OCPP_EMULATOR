import { useSyncExternalStore } from 'react';

/**
 * A bounded, append-only list per charger (OCPP frames, logbook entries) that
 * components can subscribe to without re-rendering the whole app.
 */
export class KeyedLog<T extends { id: number; chargePointId: number }> {
  private readonly lists = new Map<number, T[]>();
  private readonly listeners = new Set<() => void>();
  private static readonly EMPTY: never[] = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  get = (chargePointId: number): T[] => this.lists.get(chargePointId) ?? (KeyedLog.EMPTY as T[]);

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(chargePointId: number, rows: T[]) {
    this.lists.set(chargePointId, rows.slice(-this.max));
    for (const listener of this.listeners) listener();
  }

  /** Merge rows fetched from the API with what arrived live. */
  seed(chargePointId: number, rows: T[]) {
    const byId = new Map<number, T>();
    for (const row of rows) byId.set(row.id, row);
    for (const row of this.get(chargePointId)) byId.set(row.id, row);
    this.set(chargePointId, [...byId.values()].sort((a, b) => a.id - b.id));
  }

  push(row: T) {
    const list = this.get(row.chargePointId);
    if (list.length && list[list.length - 1].id >= row.id) {
      if (list.some((r) => r.id === row.id)) return;
      this.set(row.chargePointId, [...list, row].sort((a, b) => a.id - b.id));
      return;
    }
    this.set(row.chargePointId, [...list, row]);
  }

  clear(chargePointId: number) {
    this.set(chargePointId, []);
  }
}

export function useKeyedLog<T extends { id: number; chargePointId: number }>(
  store: KeyedLog<T>,
  chargePointId: number,
): T[] {
  return useSyncExternalStore(store.subscribe, () => store.get(chargePointId));
}

// --- One shared clock for every countdown and timer on the page ---

let now = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      now = Date.now();
      for (const l of clockListeners) l();
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/** The current time, refreshed once a second. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, () => now);
}
