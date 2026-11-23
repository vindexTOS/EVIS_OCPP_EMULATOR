import axios from 'axios';
import type {
  Car,
  Charger,
  ChargerEvent,
  ChargerHistory,
  ChargerSettings,
  ConfigEntry,
  ConnectorType,
  IdTag,
  Internals,
  MeterSample,
  OcppLogEntry,
  ResponseOverride,
  SessionRow,
  Side,
  TapResult,
} from './types';

/**
 * Same origin by default: the Vite server forwards /api to BACKEND_URL (see
 * vite.config.ts). Set VITE_API_URL only for a build served without that proxy.
 */
export const API_URL = import.meta.env.VITE_API_URL || '/api';

const TOKEN_KEY = 'ocpp_token';

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const t = token.get();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

/** The message the backend sent with an error, or a fallback. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(message)) return message.join('. ');
    if (message) return message;
    if (!error.response) return 'The emulator backend is not reachable';
  }
  return fallback;
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

// --- Auth ---
export const getAuthStatus = () => data(api.get<{ locked: boolean }>('/auth/status'));
export const login = (email: string, password: string) =>
  data(api.post<{ accessToken: string }>('/auth/login', { email, password }));
export const register = (email: string, password: string) =>
  data(api.post<{ accessToken: string }>('/auth/register', { email, password }));

// --- Chargers ---
export interface ConnectorInput {
  type: ConnectorType;
  maxPowerW?: number;
  phases?: number;
  side?: Side;
}
export type ChargerInput = Partial<ChargerSettings> & {
  chargePointId: string;
  tlsClientKey?: string;
  connectors?: ConnectorInput[];
};
export type ChargerPatch = Partial<ChargerSettings> & { tlsClientKey?: string };

const cp = (id: number) => `/charge-points/${id}`;

export const listChargers = () => data(api.get<Charger[]>('/charge-points'));
export const createCharger = (body: ChargerInput) => data(api.post<Charger>('/charge-points', body));
export const updateCharger = (id: number, body: ChargerPatch) =>
  data(api.patch<Charger>(cp(id), body));
export const deleteCharger = (id: number) => data(api.delete(cp(id)));
export const setPower = (id: number, on: boolean) => data(api.post<Charger>(`${cp(id)}/power`, { on }));
export const setNetwork = (id: number, up: boolean) =>
  data(api.post<Charger>(`${cp(id)}/network`, { up }));
export const rebootCharger = (id: number) => data(api.post<Charger>(`${cp(id)}/reboot`));
export const emergencyStop = (id: number, pressed: boolean) =>
  data(api.post<Charger>(`${cp(id)}/emergency-stop`, { pressed }));
export const tapCard = (id: number, idTag: string, connectorId?: number) =>
  data(api.post<TapResult>(`${cp(id)}/rfid`, { idTag, connectorId }));
export const setAvailability = (id: number, connectorId: number, type: 'Operative' | 'Inoperative') =>
  data(api.post(`${cp(id)}/availability`, { connectorId, type }));

// --- Connectors ---
export const addConnector = (id: number, body: ConnectorInput) =>
  data(api.post<Charger>(`${cp(id)}/connectors`, body));
export const updateConnector = (id: number, connectorId: number, body: Partial<ConnectorInput>) =>
  data(api.patch<Charger>(`${cp(id)}/connectors/${connectorId}`, body));
export const removeLastConnector = (id: number) =>
  data(api.delete<Charger>(`${cp(id)}/connectors/last`));
export const plugCar = (id: number, connectorId: number, carId: number) =>
  data(api.post<Charger>(`${cp(id)}/connectors/${connectorId}/plug`, { carId }));
export const unplugCar = (id: number, connectorId: number) =>
  data(api.post<Charger>(`${cp(id)}/connectors/${connectorId}/unplug`));
export const stopCharging = (id: number, connectorId: number) =>
  data(api.post<Charger>(`${cp(id)}/connectors/${connectorId}/stop`));
export const setFault = (
  id: number,
  connectorId: number,
  body: { errorCode: string; info?: string; vendorErrorCode?: string; fatal?: boolean },
) => data(api.post<Charger>(`${cp(id)}/connectors/${connectorId}/fault`, body));
export const clearFault = (id: number, connectorId: number) =>
  data(api.delete<Charger>(`${cp(id)}/connectors/${connectorId}/fault`));
export const setPaused = (id: number, connectorId: number, who: 'ev' | 'evse', paused: boolean) =>
  data(api.post<Charger>(`${cp(id)}/connectors/${connectorId}/pause`, { who, paused }));

// --- Configuration ---
export const getConfiguration = (id: number) =>
  data(api.get<ConfigEntry[]>(`${cp(id)}/configuration`));
export const setConfiguration = (id: number, key: string, value: string) =>
  data(api.put<{ status: string; configuration: ConfigEntry[] }>(`${cp(id)}/configuration`, { key, value }));
export const removeConfiguration = (id: number, key: string) =>
  data(api.delete<ConfigEntry[]>(`${cp(id)}/configuration/${encodeURIComponent(key)}`));

// --- OCPP by hand and test switches ---
export const getTemplates = (id: number) =>
  data(api.get<Record<string, unknown>>(`${cp(id)}/ocpp/templates`));
export const ocppCall = (id: number, action: string, payload: unknown) =>
  data(api.post<{ action: string; result: unknown }>(`${cp(id)}/ocpp/call`, { action, payload }));
export const getOverridableActions = (id: number) =>
  data(api.get<string[]>(`${cp(id)}/overrides/actions`));
export const setOverride = (id: number, action: string, override: ResponseOverride | null) =>
  data(api.put<Charger>(`${cp(id)}/overrides`, { action, ...(override ?? {}) }));
export const sendSecurityEvent = (id: number, type: string, techInfo?: string) =>
  data(api.post(`${cp(id)}/security/event`, { type, techInfo }));
export const signCertificate = (id: number) => data(api.post(`${cp(id)}/security/sign-certificate`));
export const clearAuthorization = (id: number, source: 'list' | 'cache') =>
  data(api.delete<Internals>(`${cp(id)}/authorization/${source}`));

// --- Insights ---
export const getInternals = (id: number) => data(api.get<Internals>(`${cp(id)}/internals`));
export const getHistory = (id: number, days: number) =>
  data(
    api.get<ChargerHistory>(`${cp(id)}/history`, {
      params: { days, tz: -new Date().getTimezoneOffset() },
    }),
  );
export const getEvents = (id: number, limit = 100) =>
  data(api.get<ChargerEvent[]>(`${cp(id)}/events`, { params: { limit } }));
export const clearEvents = (id: number) => data(api.delete(`${cp(id)}/events`));
export const getLogs = (id: number, limit = 300) =>
  data(api.get<OcppLogEntry[]>(`${cp(id)}/logs`, { params: { limit } }));
export const clearLogs = (id: number) => data(api.delete(`${cp(id)}/logs`));

// --- Cars ---
export interface CarInput {
  name: string;
  color?: string;
  connectorTypes: ConnectorType[];
  batteryCapacityWh: number;
  batteryWh?: number;
  targetSoc?: number;
  maxAcPowerW?: number;
  maxDcPowerW?: number;
  acPhases?: number;
  batteryVoltage?: number;
}
export const listCars = () => data(api.get<Car[]>('/cars'));
export const createCar = (body: CarInput) => data(api.post<Car>('/cars', body));
export const updateCar = (id: number, body: Partial<CarInput>) => data(api.patch<Car>(`/cars/${id}`, body));
export const setCarBattery = (id: number, socPercent: number) =>
  data(api.post<Car>(`/cars/${id}/battery`, { socPercent }));
export const deleteCar = (id: number) => data(api.delete(`/cars/${id}`));

// --- RFID cards ---
export const listIdTags = () => data(api.get<IdTag[]>('/id-tags'));
export const createIdTag = (body: Omit<IdTag, 'id'>) => data(api.post<IdTag>('/id-tags', body));
export const updateIdTag = (id: number, body: Partial<Omit<IdTag, 'id'>>) =>
  data(api.patch<IdTag>(`/id-tags/${id}`, body));
export const deleteIdTag = (id: number) => data(api.delete(`/id-tags/${id}`));

// --- Sessions ---
export interface SessionQuery {
  chargePointId?: number;
  connectorId?: number;
  carId?: number;
  status?: 'Active' | 'Stopped';
  /** ISO instant: only sessions that started at or after it. */
  since?: string;
  limit?: number;
  offset?: number;
}
export const listSessions = (params: SessionQuery) =>
  data(api.get<{ items: SessionRow[]; total: number }>('/sessions', { params }));
export const getSession = (id: number) =>
  data(api.get<{ session: SessionRow; samples: MeterSample[] }>(`/sessions/${id}`));
export const getOverview = () =>
  data(
    api.get<{ sessions: number; energyWh: number; chargingSec: number; active: number }>(
      '/sessions/overview',
    ),
  );
