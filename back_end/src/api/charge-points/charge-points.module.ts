import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChargePoint } from '../../entities/charge-point.entity';
import { OcppWsModule } from '../../ocpp-ws/ocpp-ws.module';
import { ChargePointsController } from './charge-points.controller';
import { ChargePointsService } from './charge-points.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChargePoint]), OcppWsModule],
  controllers: [ChargePointsController],
  providers: [ChargePointsService],
  exports: [ChargePointsService],
})
export class ChargePointsModule {}
