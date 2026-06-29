import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { OcppConnectorStatus } from '../../../entities/enums';

export class ForceStatusDto {
  @IsEnum(OcppConnectorStatus)
  status: OcppConnectorStatus;

  // Full StatusNotification payload to send verbatim; defaults are built when omitted.
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class OcppCallDto {
  @IsString()
  action: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class SimulateRejectDto {
  @IsOptional()
  @IsBoolean()
  boot?: boolean;

  @IsOptional()
  @IsBoolean()
  authorize?: boolean;
}
