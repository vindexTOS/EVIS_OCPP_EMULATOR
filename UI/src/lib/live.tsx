import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { BackendContext, eventStore, logStore } from './liveStores';
import { EVENTS, socket } from './socket';
import type { Car, Charger, ChargerEvent, OcppLogEntry } from './types';

/** Things the CSMS did to a charger: worth a toast, because nobody clicked them. */
const REMOTE_TYPES = new Set(['RemoteStart', 'RemoteStop', 'Reset', 'Unlock', 'Reservation']);

const upsert = <T extends { id: number }>(list: T[] | undefined, item: T): T[] => {
  if (!list) return [item];
  return list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];
};

/** Keeps the query cache in step with what the engine pushes over Socket.IO. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [online, setOnline] = useState(socket.connected);

  useEffect(() => {
    const onCharger = (charger: Charger) =>
      qc.setQueryData<Charger[]>(['chargers'], (list) => upsert(list, charger));
    const onChargerRemoved = ({ id }: { id: number }) =>
      qc.setQueryData<Charger[]>(['chargers'], (list) => list?.filter((c) => c.id !== id));
    const onCar = (car: Car) => qc.setQueryData<Car[]>(['cars'], (list) => upsert(list, car));
    const onCarRemoved = ({ id }: { id: number }) =>
      qc.setQueryData<Car[]>(['cars'], (list) => list?.filter((c) => c.id !== id));
    const onLog = (entry: OcppLogEntry) => logStore.push(entry);
    const onEvent = (event: ChargerEvent) => {
      eventStore.push(event);
      if (event.severity === 'error' || REMOTE_TYPES.has(event.type)) {
        const charger = qc
          .getQueryData<Charger[]>(['chargers'])
          ?.find((c) => c.id === event.chargePointId);
        notifications.show({
          color: event.severity === 'error' ? 'red' : event.severity === 'warning' ? 'yellow' : 'blue',
          title: charger?.name,
          message: event.message,
        });
      }
    };
    const onSession = ({ chargePointId }: { chargePointId: number }) => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['history', chargePointId] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    };
    const onConnect = () => {
      setOnline(true);
      // Anything may have changed while we were away.
      void qc.invalidateQueries();
    };
    const onDisconnect = () => setOnline(false);

    socket.on(EVENTS.charger, onCharger);
    socket.on(EVENTS.chargerRemoved, onChargerRemoved);
    socket.on(EVENTS.car, onCar);
    socket.on(EVENTS.carRemoved, onCarRemoved);
    socket.on(EVENTS.log, onLog);
    socket.on(EVENTS.event, onEvent);
    socket.on(EVENTS.session, onSession);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off(EVENTS.charger, onCharger);
      socket.off(EVENTS.chargerRemoved, onChargerRemoved);
      socket.off(EVENTS.car, onCar);
      socket.off(EVENTS.carRemoved, onCarRemoved);
      socket.off(EVENTS.log, onLog);
      socket.off(EVENTS.event, onEvent);
      socket.off(EVENTS.session, onSession);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [qc]);

  return <BackendContext.Provider value={online}>{children}</BackendContext.Provider>;
}
