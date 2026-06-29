import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ConnectorType } from '../../../entities/enums';

export class ConnectorInputDto {
  @IsNumber()
  @Min(1)
  connectorId: number;

  @IsEnum(ConnectorType)
  type: ConnectorType;

  @IsNumber()
  @Min(0)
  maxPowerW: number;
}

export class CreateChargePointDto {
  @IsString()
  name: string;

  // OCPP identity sent in BootNotification (not auto-generated).
  @IsString()
  chargePointId: string;

  @IsString()
  vendor: string;

  @IsString()
  model: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;

  @IsString()
  csmsUrl: string;

  @IsOptional()
  @IsString()
  idTag?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConnectorInputDto)
  connectors: ConnectorInputDto[];
}
