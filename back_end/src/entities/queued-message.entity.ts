import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChargePoint } from './charge-point.entity';

/**
 * A transaction-related message (StartTransaction, StopTransaction, MeterValues)
 * waiting to be delivered. Rows are sent strictly in id order, and they survive
 * a network outage and a restart, like the flash queue of a real charger.
 */
@Entity({ name: 'queued_messages' })
@Index(['chargePointId', 'id'])
export class QueuedMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  @Column()
  action: string;

  @Column({ type: 'simple-json' })
  payload: Record<string, unknown>;

  /** Session whose CSMS transactionId must be filled in at send time. */
  @Column({ type: 'integer', nullable: true })
  sessionId: number | null;

  @Column({ default: 0 })
  attempts: number;

  @CreateDateColumn()
  createdAt: Date;
}
