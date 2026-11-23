import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CarsModule } from './cars/cars.module';
import { ChargePointsModule } from './charge-points/charge-points.module';
import { IdTagsModule } from './id-tags/id-tags.module';
import { MetaController } from './meta/meta.controller';
import { SessionsModule } from './sessions/sessions.module';

@Module({
  imports: [
    AuthModule,
    ChargePointsModule,
    CarsModule,
    IdTagsModule,
    SessionsModule,
  ],
  controllers: [MetaController],
})
export class ApiModule {}
