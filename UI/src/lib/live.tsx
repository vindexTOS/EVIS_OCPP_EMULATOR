import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ENGINE_EVENTS, socket, type SessionTick } from './socket';

type Ticks = Record<string, SessionTick>;

const LiveContext = createContext<Ticks>({});

export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ticks, setTicks] = useState<Ticks>({});

  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['charge-points'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
    };
    const onTick = (t: SessionTick) =>
      setTicks((prev) => ({ ...prev, [`${t.chargePointId}:${t.connectorId}`]: t }));

    socket.on(ENGINE_EVENTS.chargePointStatus, invalidate);
    socket.on(ENGINE_EVENTS.connectorUpdate, invalidate);
    socket.on(ENGINE_EVENTS.sessionStarted, invalidate);
    socket.on(ENGINE_EVENTS.sessionEnded, invalidate);
    socket.on(ENGINE_EVENTS.sessionTick, onTick);
    return () => {
      socket.off(ENGINE_EVENTS.chargePointStatus, invalidate);
      socket.off(ENGINE_EVENTS.connectorUpdate, invalidate);
      socket.off(ENGINE_EVENTS.sessionStarted, invalidate);
      socket.off(ENGINE_EVENTS.sessionEnded, invalidate);
      socket.off(ENGINE_EVENTS.sessionTick, onTick);
    };
  }, [queryClient]);

  return <LiveContext.Provider value={ticks}>{children}</LiveContext.Provider>;
}

export const useTick = (chargePointId: string, connectorId: number) =>
  useContext(LiveContext)[`${chargePointId}:${connectorId}`];
