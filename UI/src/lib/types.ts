export const CONNECTOR_TYPES = [
  'Type1',
  'Type2',
  'CCS1',
  'CCS2',
  'CHAdeMO',
  'GBT',
  'Domestic',
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export type ChargePointStatus = 'Offline' | 'Connecting' | 'Online' | 'Faulted';
export type ConnectorStatus =
  | 'Available'
  | 'Preparing'
  | 'Charging'
  | 'SuspendedEVSE'
  | 'SuspendedEV'
  | 'Finishing'
  | 'Reserved'
  | 'Unavailable'
  | 'Faulted';

export interface Connector {
  connectorId: number;
  type: ConnectorType;
  maxPowerW: number;
  status: ConnectorStatus;
  totalEnergyWh: number;
  currentSessionId?: string | null;
}

export interface ChargePoint {
  id: string;
  name: string;
  vendor: string;
  model: string;
  firmwareVersion: string;
  csmsUrl: string;
  ocppVersion: string;
  idTag: string;
  connectors: Connector[];
  configuration: Record<string, string>;
  lastStatus: ChargePointStatus;
  online: boolean;
}

export interface Car {
  id: string;
  name: string;
  connectorTypes: ConnectorType[];
  batteryCapacityWh: number;
  batterySoCWh: number;
  maxChargePowerW: number;
}

export interface MeterSample {
  ts: string;
  energyWh: number;
  powerW: number;
  soc: number;
}

export interface ChargingSession {
  id: string;
  chargePointId: string;
  connectorId: number;
  carId?: string;
  ocppTransactionId?: number;
  energyDeliveredWh: number;
  meterStartWh: number;
  meterCurrentWh: number;
  meterStopWh?: number;
  status: 'Active' | 'Stopped';
  stopReason?: string;
  startedAt: string;
  stoppedAt?: string;
  samples: MeterSample[];
}
