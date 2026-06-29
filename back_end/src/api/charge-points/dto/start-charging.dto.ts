import { IsMongoId, IsOptional } from 'class-validator';

export class StartChargingDto {
  @IsOptional()
  @IsMongoId()
  carId?: string;
}
