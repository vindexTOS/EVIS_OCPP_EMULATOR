import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChargingSession } from './charging-session.entity';

/** A meter reading taken during a session (what MeterValues reported). */
@Entity({ name: 'meter_samples' })
export class MeterSample {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChargingSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session?: ChargingSession;

  @Index()
  @Column()
  sessionId: number;

  @Column({ type: 'datetime' })
  ts: Date;

  /** OCPP reading context: Transaction.Begin, Sample.Periodic, Transaction.End, ... */
  @Column({ default: 'Sample.Periodic' })
  context: string;

  /** Connector meter register, in Wh. */
  @Column({ type: 'float' })
  energyWh: number;

  @Column({ type: 'float' })
  powerW: number;

  @Column({ type: 'float', default: 0 })
  currentA: number;

  @Column({ type: 'float', default: 0 })
  voltageV: number;

  @Column({ type: 'float', nullable: true })
  soc: number | null;
}
