// Shapes of what the backend sends. They mirror back_end/src/engine/types.ts.

export const CONNECTOR_TYPES = [
  'Type1',
  'Type2',
  'CCS1',
  'CCS2',
  'CHAdeMO',
  'GBT_AC',
  'GBT_DC',
  'NACS',
  'Schuko',
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

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

export type ConnectionState =
  | 'Off'
  | 'Offline'
  | 'Connecting'
  | 'Booting'
  | 'Pending'
  | 'Rejected'
  | 'Accepted'
  | 'Rebooting';

export const ERROR_CODES = [
  'ConnectorLockFailure',
  'EVCommunicationError',
  'GroundFailure',
  'HighTemperature',
  'InternalError',
  'LocalListConflict',
  'OtherError',
  'OverCurrentFailure',
  'OverVoltage',
  'PowerMeterFailure',
  'PowerSwitchFailure',
  'ReaderFailure',
  'ResetFailure',
  'UnderVoltage',
  'WeakSignal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | 'NoError';

export type Availability = 'Operative' | 'Inoperative';
export type Side = 'left' | 'right';

export interface Telemetry {
  powerW: number;
  currentA: number;
  voltageV: number;
  offeredW: number;
  offeredA: number;
  limitW: number | null;
  limitSource: string | null;
  phases: number;
  temperatureC: number;
  soc: number | null;
}

export interface LiveSession {
  id: number;
  transactionId: number | null;
  idTag: string;
  startedAt: string;
  startedBy: 'Local' | 'Remote' | 'AutoStart';
  meterStartWh: number;
  energyWh: number;
  startSoc: number | null;
  chargingSec: number;
  startConfirmed: boolean;
  idTagStatus: string | null;
  deauthorized: boolean;
}

export interface ReservationInfo {
  reservationId: number;
  connectorId: number;
  idTag: string;
  parentIdTag: string | null;
  expiryDate: string;
}

export interface Connector {
  id: number;
  connectorId: number;
  type: ConnectorType;
  maxPowerW: number;
  phases: number;
  side: Side;
  status: ConnectorStatus;
  errorCode: ErrorCode;
  errorInfo: string;
  vendorErrorCode: string;
  availability: Availability;
  scheduledAvailability: Availability | null;
  meterWh: number;
  locked: boolean;
  finishing: boolean;
  evPaused: boolean;
  evsePaused: boolean;
  carId: number | null;
  authorizing: string | null;
  pending: { idTag: string; until: string; startedBy: string } | null;
  reservation: ReservationInfo | null;
  session: LiveSession | null;
  telemetry: Telemetry;
}

export interface ResponseOverride {
  mode: 'status' | 'error' | 'silent';
  status?: string;
  errorCode?: string;
  once?: boolean;
}

export interface ChargerSettings {
  name: string;
  chargePointId: string;
  vendor: string;
  model: string;
  serialNumber: string;
  chargeBoxSerialNumber: string;
  firmwareVersion: string;
  iccid: string;
  imsi: string;
  meterType: string;
  meterSerialNumber: string;
  csmsUrl: string;
  appendIdToUrl: boolean;
  basicAuthUser: string;
  basicAuthPassword: string;
  tlsVerify: boolean;
  tlsCaCert: string;
  tlsClientCert: string;
  defaultIdTag: string;
  autoStart: 'off' | 'plug';
  fullBatteryBehavior: 'auto' | 'suspend' | 'stop';
  speed: number;
  bootOnReconnect: boolean;
  rebootSeconds: number;
  perPhaseMeterValues: boolean;
  securityEvents: boolean;
  dataTransferMode: 'vendor' | 'Accepted' | 'Rejected' | 'UnknownMessageId' | 'UnknownVendorId';
  firmwareFailure: 'none' | 'download' | 'install';
  diagnosticsFailure: boolean;
  unlockFailure: boolean;
}

export interface Charger extends ChargerSettings {
  id: number;
  hasTlsClientKey: boolean;
  responseOverrides: Record<string, ResponseOverride>;
  poweredOn: boolean;
  networkUp: boolean;
  availability: Availability;
  localListVersion: number;
  firmwareStatus: string;
  diagnosticsStatus: string;
  lastBootAt: string | null;
  lastHeartbeatAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  createdAt: string;
  resolvedUrl: string;
  securityProfile: number;
  state: ConnectionState;
  stateSince: string;
  connection: {
    lastError: string | null;
    attempt: number;
    nextRetryAt: string | null;
    bootRetryAt: string | null;
    protocol: string | null;
    heartbeatInterval: number;
  };
  emergency: boolean;
  maintenance: boolean;
  queueLength: number;
  reservations: ReservationInfo[];
  connectors: Connector[];
}

export interface Car {
  id: number;
  name: string;
  color: string;
  connectorTypes: ConnectorType[];
  batteryCapacityWh: number;
  batteryWh: number;
  soc: number;
  targetSoc: number;
  maxAcPowerW: number;
  maxDcPowerW: number;
  acPhases: number;
  batteryVoltage: number;
  pluggedInto: { chargePointId: number; chargePointName: string; connectorId: number } | null;
  createdAt: string | null;
}

export interface IdTag {
  id: number;
  label: string;
  idTag: string;
  color: string;
}

export type Severity = 'info' | 'success' | 'warning' | 'error';

export interface ChargerEvent {
  id: number;
  chargePointId: number;
  connectorId: number | null;
  ts: string;
  type: string;
  severity: Severity;
  message: string;
  data: unknown;
}

export interface OcppLogEntry {
  id: number;
  chargePointId: number;
  ts: string;
  direction: 'in' | 'out';
  /** 2 = CALL, 3 = CALLRESULT, 4 = CALLERROR. */
  messageType: number;
  action: string;
  messageId: string;
  payload: unknown;
}

export interface SessionRow {
  id: number;
  chargePointId: number;
  connectorId: number;
  connectorType: ConnectorType;
  carId: number | null;
  carName: string;
  idTag: string;
  transactionId: number | null;
  reservationId: number | null;
  startedBy: string;
  meterStartWh: number;
  meterStopWh: number | null;
  energyWh: number;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number;
  chargingSec: number;
  status: 'Active' | 'Stopped';
  stopReason: string | null;
  startSoc: number | null;
  stopSoc: number | null;
  peakPowerW: number;
  startConfirmed: boolean;
  stopConfirmed: boolean;
  idTagStatus: string | null;
}

export interface MeterSample {
  ts: string;
  context: string;
  energyWh: number;
  powerW: number;
  currentA: number;
  voltageV: number;
  soc: number | null;
}

export interface ConnectorHistory {
  connectorId: number;
  type: ConnectorType;
  maxPowerW: number;
  status: ConnectorStatus;
  meterWh: number;
  sessions: number;
  energyWh: number;
  chargingSec: number;
  durationSec: number;
  peakPowerW: number;
  averageEnergyWh: number;
  lastSessionAt: string | null;
}

export interface ChargerHistory {
  chargePointId: number;
  days: number;
  since: string;
  totals: {
    sessions: number;
    energyWh: number;
    meterWh: number;
    chargingSec: number;
    durationSec: number;
  };
  connectors: ConnectorHistory[];
  daily: {
    day: string;
    energyWh: number;
    sessions: number;
    byConnector: { connectorId: number; energyWh: number }[];
  }[];
  stopReasons: { reason: string; count: number }[];
}

export interface ConfigEntry {
  key: string;
  profile: string;
  type: 'boolean' | 'integer' | 'string' | 'csl';
  readonly: boolean;
  default: string;
  description: string;
  unit?: string;
  min?: number;
  max?: number;
  allowed?: string[];
  writeOnly?: boolean;
  dynamic?: boolean;
  value: string;
  custom: boolean;
}

export interface Internals {
  queue: {
    id: number;
    action: string;
    sessionId: number | null;
    attempts: number;
    createdAt: string | null;
    payload: unknown;
  }[];
  reservations: ReservationInfo[];
  chargingProfiles: {
    id: number;
    connectorId: number;
    chargingProfileId: number;
    transactionId: number | null;
    stackLevel: number;
    purpose: string;
    kind: string;
    recurrencyKind: string | null;
    validFrom: string | null;
    validTo: string | null;
    schedule: {
      duration?: number;
      startSchedule?: string;
      chargingRateUnit: 'A' | 'W';
      chargingSchedulePeriod: { startPeriod: number; limit: number; numberPhases?: number }[];
      minChargingRate?: number;
    };
    installedAt: string | null;
  }[];
  localList: {
    version: number;
    enabled: boolean;
    entries: AuthInfo[];
  };
  authCache: AuthInfo[];
  limits: { connectorId: number; limitW: number | null; source: string | null }[];
}

export interface AuthInfo {
  idTag: string;
  status: string;
  parentIdTag: string | null;
  expiryDate: string | null;
}

export interface TapResult {
  outcome: 'started' | 'stopped' | 'authorized' | 'rejected';
  connectorId: number | null;
  status?: string;
  message: string;
}
