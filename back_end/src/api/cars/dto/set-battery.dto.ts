import { IsNumber, Max, Min } from 'class-validator';

export class SetBatteryDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  socPercent: number;
}
