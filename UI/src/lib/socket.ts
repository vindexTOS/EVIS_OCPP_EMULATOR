import { io } from 'socket.io-client';

export const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3000';

export const socket = io(WS_URL, { transports: ['websocket'] });

export const ENGINE_EVENTS = {
  chargePointStatus: 'chargepoint.status',
  connectorUpdate: 'connector.update',
  sessionStarted: 'session.started',
  sessionTick: 'session.tick',
  sessionEnded: 'session.ended',
} as const;

export interface SessionTick {
  sessionId: string;
  chargePointId: string;
  connectorId: number;
  carId?: string;
  powerW: number;
  energyDeliveredWh: number;
  soc: number;
}
