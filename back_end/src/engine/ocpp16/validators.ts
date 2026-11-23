import { OcppError } from '../rpc/ocpp-message';

// Shape checks for the requests a CSMS can send. A real charger answers a
// malformed request with a CALLERROR instead of acting on it, so does this one.

type FieldType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'datetime';

interface Field {
  type: FieldType;
  required?: boolean;
  enum?: readonly string[];
  maxLength?: number;
  min?: number;
  fields?: Schema;
}
type Schema = Record<string, Field>;

const str = (required = false, maxLength?: number): Field => ({
  type: 'string',
  required,
  maxLength,
});
const int = (required = false, min?: number): Field => ({
  type: 'integer',
  required,
  min,
});
const oneOf = (values: readonly string[], required = true): Field => ({
  type: 'string',
  required,
  enum: values,
});
const date = (required = false): Field => ({ type: 'datetime', required });

const ID_TAG = 20;

const CHARGING_SCHEDULE: Schema = {
  duration: int(false, 0),
  startSchedule: date(),
  chargingRateUnit: oneOf(['A', 'W']),
  chargingSchedulePeriod: { type: 'array', required: true },
  minChargingRate: { type: 'number' },
};

const CHARGING_PROFILE: Schema = {
  chargingProfileId: int(true),
  transactionId: int(),
  stackLevel: int(true, 0),
  chargingProfilePurpose: oneOf([
    'ChargePointMaxProfile',
    'TxDefaultProfile',
    'TxProfile',
  ]),
  chargingProfileKind: oneOf(['Absolute', 'Recurring', 'Relative']),
  recurrencyKind: oneOf(['Daily', 'Weekly'], false),
  validFrom: date(),
  validTo: date(),
  chargingSchedule: {
    type: 'object',
    required: true,
    fields: CHARGING_SCHEDULE,
  },
};

export const MESSAGE_TRIGGERS = [
  'BootNotification',
  'DiagnosticsStatusNotification',
  'FirmwareStatusNotification',
  'Heartbeat',
  'MeterValues',
  'StatusNotification',
] as const;

export const EXTENDED_TRIGGERS = [
  'BootNotification',
  'LogStatusNotification',
  'FirmwareStatusNotification',
  'Heartbeat',
  'MeterValues',
  'SignChargePointCertificate',
  'StatusNotification',
] as const;

const CERTIFICATE_HASH: Schema = {
  hashAlgorithm: oneOf(['SHA256', 'SHA384', 'SHA512']),
  issuerNameHash: str(true),
  issuerKeyHash: str(true),
  serialNumber: str(true),
};

const SCHEMAS: Record<string, Schema> = {
  // Core
  ChangeAvailability: {
    connectorId: int(true, 0),
    type: oneOf(['Inoperative', 'Operative']),
  },
  ChangeConfiguration: { key: str(true, 50), value: str(true, 500) },
  ClearCache: {},
  DataTransfer: {
    vendorId: str(true, 255),
    messageId: str(false, 50),
    data: str(),
  },
  GetConfiguration: { key: { type: 'array' } },
  RemoteStartTransaction: {
    connectorId: int(false, 1),
    idTag: str(true, ID_TAG),
    chargingProfile: { type: 'object', fields: CHARGING_PROFILE },
  },
  RemoteStopTransaction: { transactionId: int(true) },
  Reset: { type: oneOf(['Hard', 'Soft']) },
  UnlockConnector: { connectorId: int(true, 1) },

  // Firmware management
  GetDiagnostics: {
    location: str(true),
    retries: int(false, 0),
    retryInterval: int(false, 0),
    startTime: date(),
    stopTime: date(),
  },
  UpdateFirmware: {
    location: str(true),
    retrieveDate: date(true),
    retries: int(false, 0),
    retryInterval: int(false, 0),
  },

  // Local auth list
  GetLocalListVersion: {},
  SendLocalList: {
    listVersion: int(true),
    updateType: oneOf(['Differential', 'Full']),
    localAuthorizationList: { type: 'array' },
  },

  // Reservation
  ReserveNow: {
    connectorId: int(true, 0),
    expiryDate: date(true),
    idTag: str(true, ID_TAG),
    parentIdTag: str(false, ID_TAG),
    reservationId: int(true),
  },
  CancelReservation: { reservationId: int(true) },

  // Smart charging
  SetChargingProfile: {
    connectorId: int(true, 0),
    csChargingProfiles: {
      type: 'object',
      required: true,
      fields: CHARGING_PROFILE,
    },
  },
  ClearChargingProfile: {
    id: int(),
    connectorId: int(false, 0),
    chargingProfilePurpose: oneOf(
      ['ChargePointMaxProfile', 'TxDefaultProfile', 'TxProfile'],
      false,
    ),
    stackLevel: int(false, 0),
  },
  GetCompositeSchedule: {
    connectorId: int(true, 0),
    duration: int(true, 0),
    chargingRateUnit: oneOf(['A', 'W'], false),
  },

  // Remote trigger
  // An unknown requestedMessage is answered with status NotImplemented, not a CALLERROR.
  TriggerMessage: {
    requestedMessage: str(true),
    connectorId: int(false, 1),
  },

  // Security extension
  ExtendedTriggerMessage: {
    requestedMessage: str(true),
    connectorId: int(false, 1),
  },
  CertificateSigned: { certificateChain: str(true, 10000) },
  InstallCertificate: {
    certificateType: oneOf([
      'CentralSystemRootCertificate',
      'ManufacturerRootCertificate',
    ]),
    certificate: str(true, 5500),
  },
  GetInstalledCertificateIds: {
    certificateType: oneOf([
      'CentralSystemRootCertificate',
      'ManufacturerRootCertificate',
    ]),
  },
  DeleteCertificate: {
    certificateHashData: {
      type: 'object',
      required: true,
      fields: CERTIFICATE_HASH,
    },
  },
  GetLog: {
    logType: oneOf(['DiagnosticsLog', 'SecurityLog']),
    requestId: int(true),
    retries: int(false, 0),
    retryInterval: int(false, 0),
    log: {
      type: 'object',
      required: true,
      fields: {
        remoteLocation: str(true, 512),
        oldestTimestamp: date(),
        latestTimestamp: date(),
      },
    },
  },
  SignedUpdateFirmware: {
    retries: int(false, 0),
    retryInterval: int(false, 0),
    requestId: int(true),
    firmware: {
      type: 'object',
      required: true,
      fields: {
        location: str(true, 512),
        retrieveDateTime: date(true),
        installDateTime: date(),
        signingCertificate: str(true, 5500),
        signature: str(true, 800),
      },
    },
  },
};

function check(schema: Schema, value: Record<string, unknown>, path: string) {
  for (const [name, field] of Object.entries(schema)) {
    const v = value[name];
    const where = path ? `${path}.${name}` : name;
    if (v === undefined || v === null) {
      if (field.required) {
        throw new OcppError(
          'OccurenceConstraintViolation',
          `Missing required field "${where}"`,
        );
      }
      continue;
    }
    switch (field.type) {
      case 'string':
        if (typeof v !== 'string') wrongType(where, 'a string');
        break;
      case 'integer':
        if (typeof v !== 'number' || !Number.isInteger(v))
          wrongType(where, 'an integer');
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v))
          wrongType(where, 'a number');
        break;
      case 'boolean':
        if (typeof v !== 'boolean') wrongType(where, 'a boolean');
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v))
          wrongType(where, 'an object');
        break;
      case 'array':
        if (!Array.isArray(v)) wrongType(where, 'an array');
        break;
      case 'datetime':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
          wrongType(where, 'an ISO 8601 date-time');
        }
        break;
    }
    if (field.enum && !field.enum.includes(v as string)) {
      throw new OcppError(
        'PropertyConstraintViolation',
        `"${where}" must be one of: ${field.enum.join(', ')}`,
      );
    }
    if (
      field.maxLength !== undefined &&
      (v as string).length > field.maxLength
    ) {
      throw new OcppError(
        'PropertyConstraintViolation',
        `"${where}" is longer than ${field.maxLength} characters`,
      );
    }
    if (field.min !== undefined && (v as number) < field.min) {
      throw new OcppError(
        'PropertyConstraintViolation',
        `"${where}" must be at least ${field.min}`,
      );
    }
    if (field.fields) check(field.fields, v as Record<string, unknown>, where);
  }
}

function wrongType(where: string, expected: string): never {
  throw new OcppError(
    'TypeConstraintViolation',
    `"${where}" must be ${expected}`,
  );
}

/** Throws an OcppError when the payload does not fit the request's schema. */
export function validateRequest(
  action: string,
  payload: Record<string, unknown>,
) {
  const schema = SCHEMAS[action];
  if (schema) check(schema, payload, '');
}

export const KNOWN_REQUESTS = Object.keys(SCHEMAS);
