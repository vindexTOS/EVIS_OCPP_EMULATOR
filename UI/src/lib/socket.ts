import { io } from 'socket.io-client';
import { API_URL, token } from './api';

/** undefined = this page's own origin, where Vite forwards /socket.io to the backend. */
export const WS_URL: string | undefined =
  import.meta.env.VITE_WS_URL ||
  (/^https?:\/\//i.test(API_URL) ? API_URL.replace(/\/api\/?$/, '') : undefined);

export const socket = io(WS_URL, {
  transports: ['websocket'],
  // Read the token at each (re)connect, so a login takes effect without a reload.
  auth: (cb) => cb({ token: token.get() }),
});

/** Names of the events the backend pushes (ENGINE_EVENTS in the backend). */
export const EVENTS = {
  charger: 'chargepoint.update',
  chargerRemoved: 'chargepoint.removed',
  car: 'car.update',
  carRemoved: 'car.removed',
  log: 'ocpp.log',
  event: 'chargepoint.event',
  session: 'session.update',
} as const;
