import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ChargePoint } from './charge-point.entity';
import type {
  Availability,
  ConnectorStatus,
  ConnectorType,
  ErrorCode,
} from './enums';

@Entity({ name: 'connectors' })
@Index(['chargePointId', 'connectorId'], { unique: true })
export class Connector extends BaseEntity {
  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  /** OCPP connectorId: 1..n, contiguous. */
  @Column()
  connectorId: number;

  @Column({ type: 'varchar' })
  type: ConnectorType;

  @Column()
  maxPowerW: number;

  /** AC phases wired to this connector (1 or 3). Ignored for DC. */
  @Column({ default: 3 })
  phases: number;

  /** Which side of the charger the cable hangs on. */
  @Column({ type: 'varchar', default: 'left' })
  side: 'left' | 'right';

  // --- Live state, persisted so a restart resumes where it stopped ---
  @Column({ type: 'varchar', default: 'Available' })
  status: ConnectorStatus;

  @Column({ type: 'varchar', default: 'NoError' })
  errorCode: ErrorCode;

  @Column({ default: '' })
  errorInfo: string;

  @Column({ default: '' })
  vendorErrorCode: string;

  @Column({ type: 'varchar', default: 'Operative' })
  availability: Availability;

  /** A ChangeAvailability that waits for the running transaction to end. */
  @Column({ type: 'varchar', nullable: true })
  scheduledAvailability: Availability | null;

  /** Lifetime energy register of this outlet, in Wh. Never resets. */
  @Column({ type: 'float', default: 0 })
  meterWh: number;

  /** The car whose inlet this cable is plugged into. */
  @Column({ type: 'integer', nullable: true })
  carId: number | null;

  /** A transaction ended here and the cable has not been removed yet. */
  @Column({ default: false })
  finishing: boolean;

  @Column({ default: false })
  locked: boolean;

  /** The car paused charging (it still holds the transaction). */
  @Column({ default: false })
  evPaused: boolean;

  /** The charger paused charging (it still holds the transaction). */
  @Column({ default: false })
  evsePaused: boolean;
}
