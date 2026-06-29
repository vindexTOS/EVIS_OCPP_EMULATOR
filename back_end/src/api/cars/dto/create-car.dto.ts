import { IsArray, IsEnum, IsNumber, IsString, Min } from 'class-validator';
import { ConnectorType } from '../../../entities/enums';

export class CreateCarDto {
  @IsString()
  name: string;

  @IsArray()
  @IsEnum(ConnectorType, { each: true })
  connectorTypes: ConnectorType[];

  @IsNumber()
  @Min(0)
  batteryCapacityWh: number;

  @IsNumber()
  @Min(0)
  batterySoCWh: number;

  @IsNumber()
  @Min(0)
  maxChargePowerW: number;
}
