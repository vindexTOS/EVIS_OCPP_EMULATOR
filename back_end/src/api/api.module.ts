import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CarsModule } from './cars/cars.module';
import { ChargePointsModule } from './charge-points/charge-points.module';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [AuthModule, ChargePointsModule, CarsModule, SessionsModule],
})
export class ApiModule {}
