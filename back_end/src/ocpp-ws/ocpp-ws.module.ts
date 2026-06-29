import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Car } from '../entities/car.entity';
import { ChargePoint } from '../entities/charge-point.entity';
import { ChargingSession } from '../entities/charging-session.entity';
import { OcppLog } from '../entities/ocpp-log.entity';
import { ConnectionManager } from './connection-manager.service';
import { OcppLogService } from './ocpp-log.service';
import { SimulationService } from './simulation/simulation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChargePoint, Car, ChargingSession, OcppLog]),
  ],
  providers: [ConnectionManager, SimulationService, OcppLogService],
  exports: [ConnectionManager, SimulationService, OcppLogService],
})
export class OcppWsModule {}
