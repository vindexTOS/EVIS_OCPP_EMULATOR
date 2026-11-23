import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DragContext,
  useLatest,
  zoneAt,
  type ActiveDrag,
  type DragApi,
  type Zone,
} from './dragContext';

/** Owns the drag in progress: follows the pointer and delivers the drop. */
export function DragProvider({ children }: { children: ReactNode }) {
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const zones = useRef(new Map<string, Zone>());
  const current = useLatest(drag);

  const register = useCallback((id: string, zone: Zone) => {
    zones.current.set(id, zone);
    return () => {
      if (zones.current.get(id) === zone) zones.current.delete(id);
    };
  }, []);

  const start = useCallback<DragApi['start']>((item, preview, point, onDropOutside) => {
    setDrag({ item, preview, x: point.x, y: point.y, over: zoneAt(point.x, point.y), onDropOutside });
  }, []);

  const active = drag !== null;
  useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent) => {
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, over: zoneAt(e.clientX, e.clientY) } : d));
    };
    const end = (e: PointerEvent) => {
      const dropped = current.current;
      setDrag(null);
      if (!dropped) return;
      const id = zoneAt(e.clientX, e.clientY);
      const zone = id ? zones.current.get(id) : undefined;
      if (zone) {
        if (zone.accepts(dropped.item).ok) zone.onDrop(dropped.item);
        return;
      }
      dropped.onDropOutside?.();
    };
    const cancel = () => setDrag(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    document.body.classList.add('is-dragging');
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      document.body.classList.remove('is-dragging');
    };
  }, [active, current]);

  const api = useMemo<DragApi>(() => ({ drag, start, register }), [drag, start, register]);

  return (
    <DragContext.Provider value={api}>
      {children}
      {drag &&
        createPortal(
          <div className="drag-ghost" style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }}>
            <div className="drag-ghost-inner">{drag.preview}</div>
          </div>,
          document.body,
        )}
    </DragContext.Provider>
  );
}
