// Shared vocabulary of the emulator: connector hardware, OCPP 1.6 enumerations
// and the emulator's own connection states.

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

export interface ConnectorTypeInfo {
  label: string;
  current: 'AC' | 'DC';
  /** Phases a connector of this type can carry (AC only). */
  maxPhases: 1 | 3;
  defaultPowerW: number;
}

export const CONNECTOR_TYPE_INFO: Record<ConnectorType, ConnectorTypeInfo> = {
  Type1: {
    label: 'Type 1 (J1772)',
    current: 'AC',
    maxPhases: 1,
    defaultPowerW: 7400,
  },
  Type2: { label: 'Type 2', current: 'AC', maxPhases: 3, defaultPowerW: 22000 },
  CCS1: { label: 'CCS1', current: 'DC', maxPhases: 3, defaultPowerW: 150000 },
  CCS2: { label: 'CCS2', current: 'DC', maxPhases: 3, defaultPowerW: 150000 },
  CHAdeMO: {
    label: 'CHAdeMO',
    current: 'DC',
    maxPhases: 3,
    defaultPowerW: 50000,
  },
  GBT_AC: {
    label: 'GB/T AC',
    current: 'AC',
    maxPhases: 3,
    defaultPowerW: 7000,
  },
  GBT_DC: {
    label: 'GB/T DC',
    current: 'DC',
    maxPhases: 3,
    defaultPowerW: 120000,
  },
  NACS: {
    label: 'NACS (Tesla)',
    current: 'DC',
    maxPhases: 3,
    defaultPowerW: 250000,
  },
  Schuko: {
    label: 'Schuko (domestic)',
    current: 'AC',
    maxPhases: 1,
    defaultPowerW: 2300,
  },
};

export const isDc = (type: ConnectorType) =>
  CONNECTOR_TYPE_INFO[type].current === 'DC';

/** OCPP 1.6 ChargePointStatus. */
export const CONNECTOR_STATUSES = [
  'Available',
  'Preparing',
  'Charging',
  'SuspendedEVSE',
  'SuspendedEV',
  'Finishing',
  'Reserved',
  'Unavailable',
  'Faulted',
] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

/** OCPP 1.6 ChargePointErrorCode. */
export const ERROR_CODES = [
  'NoError',
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
export type ErrorCode = (typeof ERROR_CODES)[number];

/** OCPP 1.6 StopTransaction reason. */
export const STOP_REASONS = [
  'DeAuthorized',
  'EmergencyStop',
  'EVDisconnected',
  'HardReset',
  'Local',
  'Other',
  'PowerLoss',
  'Reboot',
  'Remote',
  'SoftReset',
  'UnlockCommand',
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export type Availability = 'Operative' | 'Inoperative';

/**
 * Where the charger is on its way to the CSMS.
 * Off        – powered down
 * Offline    – powered, but the (simulated) network link is down
 * Connecting – dialing or waiting to redial
 * Booting    – socket open, BootNotification sent
 * Pending / Rejected / Accepted – the CSMS's answer to BootNotification
 * Rebooting  – restarting after Reset, firmware install or a local reboot
 */
export type ConnectionState =
  | 'Off'
  | 'Offline'
  | 'Connecting'
  | 'Booting'
  | 'Pending'
  | 'Rejected'
  | 'Accepted'
  | 'Rebooting';

export type AuthorizationStatus =
  | 'Accepted'
  | 'Blocked'
  | 'Expired'
  | 'Invalid'
  | 'ConcurrentTx';

export type SessionStatus = 'Active' | 'Stopped';
export type StartedBy = 'Local' | 'Remote' | 'AutoStart';

export type FirmwareStatus =
  | 'Idle'
  | 'Downloading'
  | 'Downloaded'
  | 'DownloadFailed'
  | 'Installing'
  | 'InstallationFailed'
  | 'Installed';

export type DiagnosticsStatus =
  | 'Idle'
  | 'Uploading'
  | 'Uploaded'
  | 'UploadFailed';
