import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CONNECTOR_TYPES, ERROR_CODES } from '../../../entities/enums';
import type { ConnectorType, ErrorCode } from '../../../entities/enums';

/** The identity ends up as a URL path segment. */
const IDENTITY = /^[^\s/?#]+$/;
const IDENTITY_MESSAGE =
  'chargePointId must not contain spaces, "/", "?" or "#"';

export class ConnectorInputDto {
  @IsIn(CONNECTOR_TYPES)
  type: ConnectorType;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(1_000_000)
  maxPowerW?: number;

  @IsOptional()
  @IsIn([1, 3])
  phases?: number;

  @IsOptional()
  @IsIn(['left', 'right'])
  side?: 'left' | 'right';
}

export class UpdateConnectorDto {
  @IsOptional()
  @IsIn(CONNECTOR_TYPES)
  type?: ConnectorType;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(1_000_000)
  maxPowerW?: number;

  @IsOptional()
  @IsIn([1, 3])
  phases?: number;

  @IsOptional()
  @IsIn(['left', 'right'])
  side?: 'left' | 'right';
}

/** Everything about a charger a user may set. All optional: PATCH sends what changed. */
export class ChargePointSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  // --- Nameplate (BootNotification field lengths) ---
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  vendor?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  chargeBoxSerialNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firmwareVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  iccid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  imsi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  meterType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  meterSerialNumber?: string;

  // --- Connection ---
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  csmsUrl?: string;

  @IsOptional()
  @IsBoolean()
  appendIdToUrl?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  basicAuthUser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  basicAuthPassword?: string;

  @IsOptional()
  @IsBoolean()
  tlsVerify?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  tlsCaCert?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  tlsClientCert?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  tlsClientKey?: string;

  // --- Behaviour ---
  @IsOptional()
  @IsString()
  @MaxLength(20)
  defaultIdTag?: string;

  @IsOptional()
  @IsIn(['off', 'plug'])
  autoStart?: 'off' | 'plug';

  @IsOptional()
  @IsIn(['auto', 'suspend', 'stop'])
  fullBatteryBehavior?: 'auto' | 'suspend' | 'stop';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  speed?: number;

  @IsOptional()
  @IsBoolean()
  bootOnReconnect?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(600)
  rebootSeconds?: number;

  @IsOptional()
  @IsBoolean()
  perPhaseMeterValues?: boolean;

  @IsOptional()
  @IsBoolean()
  securityEvents?: boolean;

  @IsOptional()
  @IsIn([
    'vendor',
    'Accepted',
    'Rejected',
    'UnknownMessageId',
    'UnknownVendorId',
  ])
  dataTransferMode?:
    | 'vendor'
    | 'Accepted'
    | 'Rejected'
    | 'UnknownMessageId'
    | 'UnknownVendorId';

  // --- Test switches ---
  @IsOptional()
  @IsIn(['none', 'download', 'install'])
  firmwareFailure?: 'none' | 'download' | 'install';

  @IsOptional()
  @IsBoolean()
  diagnosticsFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  unlockFailure?: boolean;
}

export class CreateChargePointDto extends ChargePointSettingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  @Matches(IDENTITY, { message: IDENTITY_MESSAGE })
  chargePointId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => ConnectorInputDto)
  connectors?: ConnectorInputDto[];
}

export class UpdateChargePointDto extends ChargePointSettingsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(48)
  @Matches(IDENTITY, { message: IDENTITY_MESSAGE })
  chargePointId?: string;
}

export class PowerDto {
  @IsBoolean()
  on: boolean;
}

export class NetworkDto {
  @IsBoolean()
  up: boolean;
}

export class EmergencyDto {
  @IsBoolean()
  pressed: boolean;
}

export class RfidDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  idTag: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  connectorId?: number;
}

export class PlugDto {
  @IsInt()
  carId: number;
}

export class FaultDto {
  @IsIn(ERROR_CODES)
  errorCode: ErrorCode;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  info?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vendorErrorCode?: string;

  /** false reports the error code once without taking the connector down. */
  @IsOptional()
  @IsBoolean()
  fatal?: boolean;
}

export class PauseDto {
  @IsIn(['ev', 'evse'])
  who: 'ev' | 'evse';

  @IsBoolean()
  paused: boolean;
}

export class AvailabilityDto {
  @IsInt()
  @Min(0)
  connectorId: number;

  @IsIn(['Operative', 'Inoperative'])
  type: 'Operative' | 'Inoperative';
}

export class ConfigValueDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  key: string;

  @IsString()
  @MaxLength(500)
  value: string;
}

export class OcppCallDto {
  @IsString()
  @IsNotEmpty()
  action: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class OverrideDto {
  @IsString()
  @IsNotEmpty()
  action: string;

  /** Leave out to remove the override. */
  @IsOptional()
  @IsIn(['status', 'error', 'silent'])
  mode?: 'status' | 'error' | 'silent';

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  errorCode?: string;

  @IsOptional()
  @IsBoolean()
  once?: boolean;
}

export class SecurityEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  techInfo?: string;
}
