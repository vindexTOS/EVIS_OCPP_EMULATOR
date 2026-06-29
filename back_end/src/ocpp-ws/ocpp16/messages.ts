// OCPP 1.6J message payloads (subset used by the emulator).

export interface BootNotificationReq {
  chargePointVendor: string;
  chargePointModel: string;
  firmwareVersion?: string;
}
export interface BootNotificationConf {
  status: 'Accepted' | 'Pending' | 'Rejected';
  currentTime: string;
  interval: number;
}

export interface StatusNotificationReq {
  connectorId: number;
  errorCode: string;
  status: string;
  timestamp?: string;
}

export interface AuthorizeConf {
  idTagInfo: { status: string };
}

export interface StartTransactionConf {
  transactionId: number;
  idTagInfo: { status: string };
}

export interface StopTransactionReq {
  transactionId: number;
  meterStop: number;
  timestamp: string;
  reason?: string;
}

export interface SampledValue {
  value: string;
  measurand?: string;
  unit?: string;
  context?: string;
}
export interface MeterValue {
  timestamp: string;
  sampledValue: SampledValue[];
}

export interface RemoteStartTransactionReq {
  idTag: string;
  connectorId?: number;
}
export interface RemoteStopTransactionReq {
  transactionId: number;
}

export interface ChangeConfigurationReq {
  key: string;
  value: string;
}
export interface GetConfigurationReq {
  key?: string[];
}
export interface ResetReq {
  type: 'Hard' | 'Soft';
}
export interface UnlockConnectorReq {
  connectorId: number;
}
export interface ChangeAvailabilityReq {
  connectorId: number;
  type: 'Inoperative' | 'Operative';
}
export interface TriggerMessageReq {
  requestedMessage: string;
  connectorId?: number;
}

export interface ChargingSchedulePeriod {
  startPeriod: number;
  limit: number;
}
export interface ChargingProfile {
  chargingProfileId: number;
  chargingSchedule: {
    chargingRateUnit: 'W' | 'A';
    chargingSchedulePeriod: ChargingSchedulePeriod[];
  };
}
export interface SetChargingProfileReq {
  connectorId: number;
  csChargingProfiles: ChargingProfile;
}
