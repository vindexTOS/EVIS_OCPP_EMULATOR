import type { Repository } from 'typeorm';
import type {
  AuthEntry,
  Car,
  Certificate,
  ChargePoint,
  ChargerEvent,
  ChargingProfile,
  ChargingSession,
  Connector,
  MeterSample,
  OcppLog,
  QueuedMessage,
  Reservation,
} from '../entities';
import type { ResponseOverride } from '../entities/charge-point.entity';
import type { EventSeverity } from '../entities/charger-event.entity';
import type {
  Availability,
  ConnectionState,
  ConnectorStatus,
  ConnectorType,
  DiagnosticsStatus,
  ErrorCode,
  FirmwareStatus,
  StartedBy,
} from '../entities/enums';

// --- Time ---

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now() {
    return Date.now();
  }
}

/** A clock tests move by hand. */
export class ManualClock implements Clock {
  constructor(private t = Date.now()) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

// --- Wiring ---

export interface EngineOptions {
  callTimeoutMs: number;
  handshakeTimeoutMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  /** How long the simulated firmware download, install and file uploads take. */
  firmwareDownloadMs: number;
  firmwareInstallMs: number;
  uploadMs: number;
  /** Longest a soft reset waits for its StopTransaction messages to be delivered. */
  softResetGraceMs: number;
  /** BootNotification retry period when the CSMS gives none. */
  bootRetrySec: number;
  /** History sample period when MeterValues are switched off. */
  historySampleSec: number;
  maxQueuedMeterValues: number;
  /** OCPP log rows kept per charger. */
  logRetention: number;
  /** The log is trimmed after this many new rows. */
  logPruneEvery: number;
  /** Add a little noise to readings so they look alive. */
  jitter: boolean;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  callTimeoutMs: 30_000,
  handshakeTimeoutMs: 15_000,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
  firmwareDownloadMs: 6_000,
  firmwareInstallMs: 5_000,
  uploadMs: 4_000,
  softResetGraceMs: 5_000,
  bootRetrySec: 30,
  historySampleSec: 30,
  maxQueuedMeterValues: 500,
  logRetention: 3_000,
  logPruneEvery: 500,
  jitter: true,
};

export interface EngineDb {
  chargePoints: Repository<ChargePoint>;
  connectors: Repository<Connector>;
  cars: Repository<Car>;
  sessions: Repository<ChargingSession>;
  samples: Repository<MeterSample>;
  events: Repository<ChargerEvent>;
  logs: Repository<OcppLog>;
  reservations: Repository<Reservation>;
  profiles: Repository<ChargingProfile>;
  auth: Repository<AuthEntry>;
  queue: Repository<QueuedMessage>;
  certificates: Repository<Certificate>;
}

/** What a virtual charger needs from the outside world. */
export interface EngineHost {
  db: EngineDb;
  clock: Clock;
  options: EngineOptions;
  /** Publish to the UI (Socket.IO) and to in-process listeners. */
  emit(event: string, payload: unknown): void;
  car(id: number): Car | undefined;
  /** The engine changed a car's battery: persist it and tell the UI. */
  carChanged(car: Car): void;
  warn(message: string): void;
}

export const ENGINE_EVENTS = {
  chargePoint: 'chargepoint.update',
  chargePointRemoved: 'chargepoint.removed',
  car: 'car.update',
  carRemoved: 'car.removed',
  log: 'ocpp.log',
  event: 'chargepoint.event',
  session: 'session.update',
} as const;

// --- What the UI sees ---

export interface TelemetryDto {
  powerW: number;
  /** Per phase on AC, pack current on DC. */
  currentA: number;
  voltageV: number;
  /** What the charger is willing to deliver right now. */
  offeredW: number;
  offeredA: number;
  /** Smart-charging limit in force, when there is one. */
  limitW: number | null;
  limitSource: string | null;
  /** AC phases in use; 0 on DC. */
  phases: number;
  temperatureC: number;
  soc: number | null;
}

export interface SessionDto {
  id: number;
  transactionId: number | null;
  idTag: string;
  startedAt: string;
  startedBy: StartedBy;
  meterStartWh: number;
  energyWh: number;
  startSoc: number | null;
  chargingSec: number;
  startConfirmed: boolean;
  idTagStatus: string | null;
  /** The CSMS rejected the idTag after the transaction had started. */
  deauthorized: boolean;
}

export interface ReservationDto {
  reservationId: number;
  connectorId: number;
  idTag: string;
  parentIdTag: string | null;
  expiryDate: string;
}

export interface ConnectorDto {
  id: number;
  connectorId: number;
  type: ConnectorType;
  maxPowerW: number;
  phases: number;
  side: 'left' | 'right';
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
  /** idTag currently being checked with the CSMS. */
  authorizing: string | null;
  /** Authorized and waiting for the cable. */
  pending: { idTag: string; until: string; startedBy: StartedBy } | null;
  reservation: ReservationDto | null;
  session: SessionDto | null;
  telemetry: TelemetryDto;
}

export interface ChargePointDto {
  id: number;
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
  /** The key itself never leaves the backend. */
  hasTlsClientKey: boolean;
  defaultIdTag: string;
  autoStart: string;
  fullBatteryBehavior: string;
  speed: number;
  bootOnReconnect: boolean;
  rebootSeconds: number;
  perPhaseMeterValues: boolean;
  securityEvents: boolean;
  dataTransferMode: string;
  responseOverrides: Record<string, ResponseOverride>;
  firmwareFailure: string;
  diagnosticsFailure: boolean;
  unlockFailure: boolean;
  poweredOn: boolean;
  networkUp: boolean;
  availability: Availability;
  localListVersion: number;
  firmwareStatus: FirmwareStatus;
  diagnosticsStatus: DiagnosticsStatus;
  lastBootAt: string | null;
  lastHeartbeatAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  createdAt: string;

  // --- Runtime ---
  /** The URL that is actually dialed. Empty when the configured one is not usable. */
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
  /** Connectors are out of service while firmware installs. */
  maintenance: boolean;
  /** Transaction messages waiting to be delivered. */
  queueLength: number;
  reservations: ReservationDto[];
  connectors: ConnectorDto[];
}

export interface EventDto {
  id: number;
  chargePointId: number;
  connectorId: number | null;
  ts: string;
  type: string;
  severity: EventSeverity;
  message: string;
  data: unknown;
}

export interface OcppLogDto {
  id: number;
  chargePointId: number;
  ts: string;
  direction: 'in' | 'out';
  messageType: number;
  action: string;
  messageId: string;
  payload: unknown;
}

/** Outcome of presenting an RFID card. */
export interface TapResult {
  outcome: 'started' | 'stopped' | 'authorized' | 'rejected';
  connectorId: number | null;
  status?: string;
  message: string;
}

/** An error the API should report to the caller as a 4xx. */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'not-found'
      | 'conflict'
      | 'bad-request' = 'bad-request',
  ) {
    super(message);
  }
}
