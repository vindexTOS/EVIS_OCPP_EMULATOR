import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { errorMessage, listCars, listChargers, listIdTags } from './api';

// The three lists the whole app is built on. Socket events keep them fresh
// (see live.tsx), so they are fetched once and never go stale by themselves.

export const useChargers = () =>
  useQuery({ queryKey: ['chargers'], queryFn: listChargers, staleTime: Infinity });

export const useCars = () => useQuery({ queryKey: ['cars'], queryFn: listCars, staleTime: Infinity });

export const useIdTags = () =>
  useQuery({ queryKey: ['id-tags'], queryFn: listIdTags, staleTime: Infinity });

/** Show a failed action as a red toast. */
export function toastError(error: unknown, fallback?: string) {
  notifications.show({ color: 'red', message: errorMessage(error, fallback) });
}
