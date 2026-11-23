import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ChargePoint } from './charge-point.entity';

/** One OCPP-J frame (CALL / CALLRESULT / CALLERROR) seen on a charger's CSMS link. */
@Entity({ name: 'ocpp_logs' })
@Index(['chargePointId', 'id'])
export class OcppLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  @Column({ type: 'datetime' })
  ts: Date;

  @Column({ type: 'varchar' })
  direction: 'in' | 'out';

  /** 2 = CALL, 3 = CALLRESULT, 4 = CALLERROR. */
  @Column()
  messageType: number;

  @Column()
  action: string;

  @Column()
  messageId: string;

  @Column({ type: 'simple-json', nullable: true })
  payload: any;
}
