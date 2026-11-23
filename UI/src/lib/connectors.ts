import type { Car, ConnectionState, ConnectorStatus, ConnectorType } from './types';

export interface ConnectorTypeInfo {
  label: string;
  short: string;
  current: 'AC' | 'DC';
  maxPhases: 1 | 3;
  defaultPowerW: number;
  hint: string;
}

/** Mirrors CONNECTOR_TYPE_INFO in the backend. */
export const CONNECTOR_INFO: Record<ConnectorType, ConnectorTypeInfo> = {
  Type2: { label: 'Type 2', short: 'Type 2', current: 'AC', maxPhases: 3, defaultPowerW: 22000, hint: 'AC, Europe' },
  CCS2: { label: 'CCS2', short: 'CCS2', current: 'DC', maxPhases: 3, defaultPowerW: 150000, hint: 'DC fast, Europe' },
  Type1: { label: 'Type 1 (J1772)', short: 'Type 1', current: 'AC', maxPhases: 1, defaultPowerW: 7400, hint: 'AC, North America / Japan' },
  CCS1: { label: 'CCS1', short: 'CCS1', current: 'DC', maxPhases: 3, defaultPowerW: 150000, hint: 'DC fast, North America' },
  CHAdeMO: { label: 'CHAdeMO', short: 'CHAdeMO', current: 'DC', maxPhases: 3, defaultPowerW: 50000, hint: 'DC fast, Japan' },
  NACS: { label: 'NACS (Tesla)', short: 'NACS', current: 'DC', maxPhases: 3, defaultPowerW: 250000, hint: 'DC fast, Tesla' },
  GBT_AC: { label: 'GB/T AC', short: 'GB/T AC', current: 'AC', maxPhases: 3, defaultPowerW: 7000, hint: 'AC, China' },
  GBT_DC: { label: 'GB/T DC', short: 'GB/T DC', current: 'DC', maxPhases: 3, defaultPowerW: 120000, hint: 'DC fast, China' },
  Schuko: { label: 'Schuko', short: 'Schuko', current: 'AC', maxPhases: 1, defaultPowerW: 2300, hint: 'Household socket' },
};

/** Order in which pickers offer the types: the common ones first. */
export const CONNECTOR_ORDER: ConnectorType[] = [
  'Type2',
  'CCS2',
  'Type1',
  'CCS1',
  'CHAdeMO',
  'NACS',
  'GBT_AC',
  'GBT_DC',
  'Schuko',
];

/** A combo inlet also takes the AC plug it is built around. */
export const IMPLIED_TYPES: Partial<Record<ConnectorType, ConnectorType>> = {
  CCS2: 'Type2',
  CCS1: 'Type1',
  GBT_DC: 'GBT_AC',
};

export const isDc = (type: ConnectorType) => CONNECTOR_INFO[type].current === 'DC';

export const fits = (car: Pick<Car, 'connectorTypes'>, type: ConnectorType) =>
  car.connectorTypes.includes(type);

export function defaultPhases(type: ConnectorType, maxPowerW: number): number {
  const info = CONNECTOR_INFO[type];
  if (info.current === 'DC') return 3;
  if (info.maxPhases === 1) return 1;
  return maxPowerW > 7400 ? 3 : 1;
}

export type Tone = 'idle' | 'ok' | 'energy' | 'warn' | 'info' | 'violet' | 'crit' | 'off';

export const STATUS_META: Record<ConnectorStatus, { label: string; tone: Tone; hint: string }> = {
  Available: { label: 'Available', tone: 'ok', hint: 'Free to use' },
  Preparing: { label: 'Preparing', tone: 'warn', hint: 'Waiting for a card or a cable' },
  Charging: { label: 'Charging', tone: 'energy', hint: 'Energy is flowing' },
  SuspendedEV: { label: 'SuspendedEV', tone: 'info', hint: 'The car is not drawing power' },
  SuspendedEVSE: { label: 'SuspendedEVSE', tone: 'warn', hint: 'The charger is holding power back' },
  Finishing: { label: 'Finishing', tone: 'info', hint: 'Done. Unplug to free the connector' },
  Reserved: { label: 'Reserved', tone: 'violet', hint: 'Held for a reservation' },
  Unavailable: { label: 'Unavailable', tone: 'off', hint: 'Out of service' },
  Faulted: { label: 'Faulted', tone: 'crit', hint: 'Out of order' },
};

export const STATE_META: Record<ConnectionState, { label: string; tone: Tone; busy?: boolean }> = {
  Off: { label: 'Powered off', tone: 'off' },
  Offline: { label: 'No network', tone: 'crit' },
  Connecting: { label: 'Connecting', tone: 'warn', busy: true },
  Booting: { label: 'Booting', tone: 'warn', busy: true },
  Pending: { label: 'Boot pending', tone: 'warn', busy: true },
  Rejected: { label: 'Boot rejected', tone: 'crit' },
  Accepted: { label: 'Online', tone: 'ok' },
  Rebooting: { label: 'Restarting', tone: 'warn', busy: true },
};
