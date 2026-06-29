import axios from 'axios';
import type {
  Car,
  ChargePoint,
  ChargingSession,
  ConnectorStatus,
  OcppLogEntry,
} from './types';

export const API_URL =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

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

// --- Auth ---
export const getAuthStatus = () =>
  api.get<{ locked: boolean }>('/auth/status').then((r) => r.data);
export const login = (email: string, password: string) =>
  api.post<{ accessToken: string }>('/auth/login', { email, password }).then((r) => r.data);
export const register = (email: string, password: string) =>
  api.post<{ accessToken: string }>('/auth/register', { email, password }).then((r) => r.data);

// --- Charge points ---
export const listChargePoints = () =>
  api.get<ChargePoint[]>('/charge-points').then((r) => r.data);
export const createChargePoint = (body: unknown) =>
  api.post<ChargePoint>('/charge-points', body).then((r) => r.data);
export const updateChargePoint = (id: string, body: unknown) =>
  api.patch<ChargePoint>(`/charge-points/${id}`, body).then((r) => r.data);
export const deleteChargePoint = (id: string) =>
  api.delete(`/charge-points/${id}`).then((r) => r.data);
export const connectChargePoint = (id: string) =>
  api.post(`/charge-points/${id}/connect`).then((r) => r.data);
export const disconnectChargePoint = (id: string) =>
  api.post(`/charge-points/${id}/disconnect`).then((r) => r.data);
export const startCharging = (id: string, connectorId: number, carId?: string) =>
  api.post(`/charge-points/${id}/connectors/${connectorId}/start`, { carId }).then((r) => r.data);
export const stopCharging = (id: string, connectorId: number) =>
  api.post(`/charge-points/${id}/connectors/${connectorId}/stop`).then((r) => r.data);
export const forceConnectorStatus = (
  id: string,
  connectorId: number,
  status: ConnectorStatus,
  payload?: Record<string, unknown>,
) =>
  api
    .post(`/charge-points/${id}/connectors/${connectorId}/status`, { status, payload })
    .then((r) => r.data);
export const ocppCall = (id: string, action: string, payload?: unknown) =>
  api.post(`/charge-points/${id}/ocpp/call`, { action, payload }).then((r) => r.data);
export const getCommandTemplates = (id: string) =>
  api
    .get<Record<string, unknown>>(`/charge-points/${id}/ocpp/templates`)
    .then((r) => r.data);
export const simulateReject = (
  id: string,
  body: { boot?: boolean; authorize?: boolean },
) => api.post(`/charge-points/${id}/simulate/reject`, body).then((r) => r.data);
export const getChargePointLogs = (id: string, limit = 200) =>
  api
    .get<OcppLogEntry[]>(`/charge-points/${id}/logs`, { params: { limit } })
    .then((r) => r.data);

// --- Cars ---
export const listCars = () => api.get<Car[]>('/cars').then((r) => r.data);
export const createCar = (body: unknown) =>
  api.post<Car>('/cars', body).then((r) => r.data);
export const updateCar = (id: string, body: unknown) =>
  api.patch<Car>(`/cars/${id}`, body).then((r) => r.data);
export const setCarBattery = (id: string, socPercent: number) =>
  api.post<Car>(`/cars/${id}/battery`, { socPercent }).then((r) => r.data);
export const deleteCar = (id: string) =>
  api.delete(`/cars/${id}`).then((r) => r.data);

// --- Sessions ---
export const listSessions = () =>
  api.get<ChargingSession[]>('/sessions').then((r) => r.data);
