import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMinSize,
  IsArray,
  IsHexColor,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CONNECTOR_TYPES } from '../../../entities/enums';
import type { ConnectorType } from '../../../entities/enums';

export class CreateCarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  /** Plug types that fit the car's inlet. */
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(CONNECTOR_TYPES, { each: true })
  connectorTypes: ConnectorType[];

  @IsNumber()
  @Min(1000)
  @Max(1_000_000)
  batteryCapacityWh: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  batteryWh?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  targetSoc?: number;

  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(1_000_000)
  maxAcPowerW?: number;

  @IsOptional()
  @IsNumber()
  @Min(500)
  @Max(1_000_000)
  maxDcPowerW?: number;

  @IsOptional()
  @IsIn([1, 3])
  acPhases?: number;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(1000)
  batteryVoltage?: number;
}

export class UpdateCarDto extends PartialType(CreateCarDto) {}

export class SetBatteryDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  socPercent: number;
}
