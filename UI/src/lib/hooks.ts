import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { tapCard } from './api';
import { toastError } from './queries';
import type { Car, Charger, TapResult } from './types';

const upsert = <T extends { id: number }>(list: T[] | undefined, item: T): T[] => {
  if (!list) return [item];
  return list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];
};

/** Put a charger the API just returned into the cache, without waiting for the socket. */
export function useApplyCharger() {
  const qc = useQueryClient();
  return useCallback(
    (charger: Charger) => {
      qc.setQueryData<Charger[]>(['chargers'], (list) => upsert(list, charger));
    },
    [qc],
  );
}

export function useApplyCar() {
  const qc = useQueryClient();
  return useCallback(
    (car: Car) => {
      qc.setQueryData<Car[]>(['cars'], (list) => upsert(list, car));
    },
    [qc],
  );
}

/**
 * Runs an action, remembers which one is in flight (for button spinners) and
 * shows a failure as a toast.
 */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      return true;
    } catch (error) {
      toastError(error);
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, run };
}

const TAP_TONE: Record<TapResult['outcome'], string> = {
  started: 'evis',
  stopped: 'blue',
  authorized: 'blue',
  rejected: 'red',
};

/** Hold a card to a charger's reader and tell the user what the charger decided. */
export async function tapAndTell(chargerId: number, idTag: string, connectorId?: number) {
  try {
    const result = await tapCard(chargerId, idTag, connectorId);
    notifications.show({
      color: TAP_TONE[result.outcome],
      title: `Card ${idTag}`,
      message: result.message,
    });
    return result;
  } catch (error) {
    toastError(error, 'The card could not be read');
    return null;
  }
}

export const cls = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');
