import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Car } from '../entities/car.entity';
import { ChargePoint } from '../entities/charge-point.entity';
import { ChargingSession } from '../entities/charging-session.entity';
import { ConnectionManager } from './connection-manager.service';
import { SimulationService } from './simulation/simulation.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChargePoint, Car, ChargingSession])],
  providers: [ConnectionManager, SimulationService],
  exports: [ConnectionManager, SimulationService],
})
export class OcppWsModule {}
