import type { CertificateUse } from '../../entities/certificate.entity';
import type {
  ChargingSchedule,
  ProfileKind,
  ProfilePurpose,
} from '../../entities/charging-profile.entity';
import type { Availability } from '../../entities/enums';

// Payloads of the OCPP 1.6 messages this charger receives. A request only
// reaches its handler after validateRequest() has checked it against the
// matching schema, so handlers may rely on these shapes.

export interface IdTagInfo {
  status?: string;
  parentIdTag?: string;
  expiryDate?: string;
}

// --- Answers of the CSMS to the charger's own requests ---

export interface BootNotificationConf {
  status?: string;
  currentTime?: string;
  interval?: number;
}

export interface HeartbeatConf {
  currentTime?: string;
}

export interface AuthorizeConf {
  idTagInfo?: IdTagInfo;
}

export interface StartTransactionConf {
  transactionId?: number;
  idTagInfo?: IdTagInfo;
}

export interface StopTransactionConf {
  idTagInfo?: IdTagInfo;
}

export interface StatusConf {
  status?: string;
}

// --- Requests of the CSMS ---

export interface ChargingProfileReq {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose: ProfilePurpose;
  chargingProfileKind: ProfileKind;
  recurrencyKind?: 'Daily' | 'Weekly';
  validFrom?: string;
  validTo?: string;
  chargingSchedule: ChargingSchedule;
}

export interface RemoteStartTransactionReq {
  connectorId?: number;
  idTag: string;
  chargingProfile?: ChargingProfileReq;
}

export interface RemoteStopTransactionReq {
  transactionId: number;
}

export interface ResetReq {
  type: 'Hard' | 'Soft';
}

export interface UnlockConnectorReq {
  connectorId: number;
}

export interface ChangeAvailabilityReq {
  connectorId: number;
  type: Availability;
}

export interface ChangeConfigurationReq {
  key: string;
  value: string;
}

export interface GetConfigurationReq {
  key?: unknown[];
}

export interface DataTransferReq {
  vendorId: string;
  messageId?: string;
  data?: string;
}

export interface LocalListEntry {
  idTag?: unknown;
  idTagInfo?: IdTagInfo | null;
}

export interface SendLocalListReq {
  listVersion: number;
  updateType: 'Differential' | 'Full';
  localAuthorizationList?: LocalListEntry[];
}

export interface ReserveNowReq {
  connectorId: number;
  expiryDate: string;
  idTag: string;
  parentIdTag?: string;
  reservationId: number;
}

export interface CancelReservationReq {
  reservationId: number;
}

export interface SetChargingProfileReq {
  connectorId: number;
  csChargingProfiles: ChargingProfileReq;
}

export interface ClearChargingProfileReq {
  id?: number;
  connectorId?: number;
  chargingProfilePurpose?: ProfilePurpose;
  stackLevel?: number;
}

export interface GetCompositeScheduleReq {
  connectorId: number;
  duration: number;
  chargingRateUnit?: 'A' | 'W';
}

export interface TriggerMessageReq {
  requestedMessage: string;
  connectorId?: number;
}

export interface GetDiagnosticsReq {
  location: string;
  retries?: number;
  retryInterval?: number;
  startTime?: string;
  stopTime?: string;
}

export interface UpdateFirmwareReq {
  location: string;
  retrieveDate: string;
  retries?: number;
  retryInterval?: number;
}

// --- Security extension ---

export interface CertificateSignedReq {
  certificateChain: string;
}

export interface InstallCertificateReq {
  certificateType: CertificateUse;
  certificate: string;
}

export interface GetInstalledCertificateIdsReq {
  certificateType: CertificateUse;
}

export interface CertificateHashData {
  hashAlgorithm: string;
  issuerNameHash: string;
  issuerKeyHash: string;
  serialNumber: string;
}

export interface DeleteCertificateReq {
  certificateHashData: CertificateHashData;
}

export interface GetLogReq {
  logType: 'DiagnosticsLog' | 'SecurityLog';
  requestId: number;
  retries?: number;
  retryInterval?: number;
  log: {
    remoteLocation: string;
    oldestTimestamp?: string;
    latestTimestamp?: string;
  };
}

export interface SignedUpdateFirmwareReq {
  retries?: number;
  retryInterval?: number;
  requestId: number;
  firmware: {
    location: string;
    retrieveDateTime: string;
    installDateTime?: string;
    signingCertificate: string;
    signature: string;
  };
}
