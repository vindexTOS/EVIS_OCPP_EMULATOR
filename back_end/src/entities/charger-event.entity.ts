import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChargePoint } from './charge-point.entity';

export type EventSeverity = 'info' | 'success' | 'warning' | 'error';

/** The charger's own logbook: boots, faults, resets, plug events, CSMS commands. */
@Entity({ name: 'charger_events' })
@Index(['chargePointId', 'id'])
export class ChargerEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  @Column({ type: 'integer', nullable: true })
  connectorId: number | null;

  @Column({ type: 'datetime' })
  ts: Date;

  @Column()
  type: string;

  @Column({ type: 'varchar', default: 'info' })
  severity: EventSeverity;

  @Column()
  message: string;

  @Column({ type: 'simple-json', nullable: true })
  data: any;
}
