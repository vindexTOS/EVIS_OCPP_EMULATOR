import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ChargePoint } from './charge-point.entity';

export type ReservationState = 'Active' | 'Used' | 'Expired' | 'Cancelled';

@Entity({ name: 'reservations' })
@Index(['chargePointId', 'reservationId'])
export class Reservation extends BaseEntity {
  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  /** 0 reserves "any connector" of the charge point. */
  @Column()
  connectorId: number;

  @Column()
  reservationId: number;

  @Column()
  idTag: string;

  @Column({ type: 'varchar', nullable: true })
  parentIdTag: string | null;

  @Column({ type: 'datetime' })
  expiryDate: Date;

  @Column({ type: 'varchar', default: 'Active' })
  state: ReservationState;
}
