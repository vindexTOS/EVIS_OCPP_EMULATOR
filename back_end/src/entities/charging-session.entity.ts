import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';
import { SessionStatus } from './enums';

export interface MeterSample {
  ts: Date;
  energyWh: number;
  powerW: number;
  soc: number;
}

@Entity({ name: 'charging_sessions' })
export class ChargingSession extends BaseEntity {
  @Column()
  chargePointId: string;

  @Column()
  connectorId: number;

  @Column({ nullable: true })
  carId?: string;

  @Column({ nullable: true })
  ocppTransactionId?: number;

  @Column()
  idTag: string;

  @Column()
  meterStartWh: number;

  @Column()
  meterCurrentWh: number;

  @Column({ nullable: true })
  meterStopWh?: number;

  @Column()
  energyDeliveredWh: number;

  @Column()
  status: SessionStatus;

  @Column({ nullable: true })
  stopReason?: string;

  @Column()
  startedAt: Date;

  @Column({ nullable: true })
  stoppedAt?: Date;

  @Column()
  samples: MeterSample[];
}
