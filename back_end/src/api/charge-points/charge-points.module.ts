import { Module } from '@nestjs/common';
import { ChargePointsController } from './charge-points.controller';

@Module({ controllers: [ChargePointsController] })
export class ChargePointsModule {}
