import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { Car } from '../lib/types';

// Drag and drop built on pointer events, so that a dragged car follows the
// cursor smoothly (and works with touch), which HTML5 drag-and-drop does not.

export type DragItem =
  | {
      kind: 'car';
      car: Car;
      /** Where the car is parked now, when it is dragged out of a bay. */
      from?: { chargerId: number; connectorId: number };
    }
  | { kind: 'card'; idTag: string; label: string; color: string };

export interface DropVerdict {
  ok: boolean;
  /** Why not, in a few words. Shown in the drop zone. */
  reason?: string;
}

export interface Zone {
  accepts: (item: DragItem) => DropVerdict;
  onDrop: (item: DragItem) => void;
}

export interface ActiveDrag {
  item: DragItem;
  preview: ReactNode;
  x: number;
  y: number;
  over: string | null;
  onDropOutside?: () => void;
}

export interface DragApi {
  drag: ActiveDrag | null;
  start: (
    item: DragItem,
    preview: ReactNode,
    point: { x: number; y: number },
    onDropOutside?: () => void,
  ) => void;
  register: (id: string, zone: Zone) => () => void;
}

export const DragContext = createContext<DragApi | null>(null);

const useDragApi = () => {
  const api = useContext(DragContext);
  if (!api) throw new Error('DragProvider is missing');
  return api;
};

/** The id of the drop zone under a point, if there is one. */
export const zoneAt = (x: number, y: number): string | null =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-id]')?.dataset.dropId ?? null;

/** A ref that always holds the value of the latest render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** What is being dragged right now, if anything. */
export function useDragItem(): DragItem | null {
  return useDragApi().drag?.item ?? null;
}

const THRESHOLD = 6;

/**
 * Makes an element draggable. The drag only begins once the pointer has moved
 * a little, so a plain click still reaches the element.
 */
export function useDraggable(options: {
  item: DragItem | null;
  preview: () => ReactNode;
  disabled?: boolean;
  onDropOutside?: () => void;
}) {
  const { drag, start } = useDragApi();
  const latest = useLatest(options);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const { item, disabled } = latest.current;
      if (!item || disabled || e.button !== 0) return;
      // Controls inside a draggable keep working as controls.
      if ((e.target as HTMLElement).closest('button, a, input, [data-no-drag]')) return;
      const origin = { x: e.clientX, y: e.clientY };

      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      const move = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < THRESHOLD) return;
        stop();
        const current = latest.current;
        if (current.item) {
          start(
            current.item,
            current.preview(),
            { x: ev.clientX, y: ev.clientY },
            current.onDropOutside,
          );
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    },
    [start, latest],
  );

  const item = options.item;
  const dragging =
    !!drag &&
    !!item &&
    ((drag.item.kind === 'car' && item.kind === 'car' && drag.item.car.id === item.car.id) ||
      (drag.item.kind === 'card' && item.kind === 'card' && drag.item.idTag === item.idTag));

  return { onPointerDown, dragging };
}

export interface DropState {
  /** Something is being dragged that this zone has an opinion about. */
  active: boolean;
  /** The pointer is over this zone. */
  over: boolean;
  ok: boolean;
  reason?: string;
}

/** Makes an element a drop target. Spread `props` on it. */
export function useDropZone(
  id: string,
  options: {
    accepts: (item: DragItem) => DropVerdict | null;
    onDrop: (item: DragItem) => void;
  },
): { props: { 'data-drop-id': string }; state: DropState } {
  const { drag, register } = useDragApi();
  const latest = useLatest(options);

  useEffect(
    () =>
      register(id, {
        accepts: (item) => latest.current.accepts(item) ?? { ok: false },
        onDrop: (item) => latest.current.onDrop(item),
      }),
    [id, register, latest],
  );

  const verdict = drag ? options.accepts(drag.item) : null;
  return {
    props: { 'data-drop-id': id },
    state: {
      active: verdict !== null,
      over: !!drag && drag.over === id && verdict !== null,
      ok: !!verdict?.ok,
      reason: verdict?.reason,
    },
  };
}
