import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ChargePoint } from './charge-point.entity';
import type {
  ConnectorType,
  SessionStatus,
  StartedBy,
  StopReason,
} from './enums';

/** One OCPP transaction: from StartTransaction to StopTransaction. */
@Entity({ name: 'charging_sessions' })
@Index(['chargePointId', 'connectorId'])
export class ChargingSession extends BaseEntity {
  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  @Column()
  connectorId: number;

  @Column({ type: 'varchar' })
  connectorType: ConnectorType;

  @Column({ type: 'integer', nullable: true })
  carId: number | null;

  /** Kept so history stays readable after the car is deleted. */
  @Column({ default: '' })
  carName: string;

  @Column()
  idTag: string;

  @Column({ type: 'varchar', nullable: true })
  parentIdTag: string | null;

  /** Assigned by the CSMS in StartTransaction.conf. Null until that arrives. */
  @Column({ type: 'integer', nullable: true })
  transactionId: number | null;

  @Column({ type: 'integer', nullable: true })
  reservationId: number | null;

  @Column({ type: 'varchar', default: 'Local' })
  startedBy: StartedBy;

  /** Connector meter at start, in Wh. */
  @Column({ type: 'integer' })
  meterStartWh: number;

  @Column({ type: 'integer', nullable: true })
  meterStopWh: number | null;

  @Column({ type: 'float', default: 0 })
  energyWh: number;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  stoppedAt: Date | null;

  @Column({ type: 'varchar', default: 'Active' })
  status: SessionStatus;

  @Column({ type: 'varchar', nullable: true })
  stopReason: StopReason | null;

  @Column({ type: 'float', nullable: true })
  startSoc: number | null;

  @Column({ type: 'float', nullable: true })
  stopSoc: number | null;

  @Column({ type: 'float', default: 0 })
  peakPowerW: number;

  /** Seconds during which energy actually flowed. */
  @Column({ type: 'float', default: 0 })
  chargingSec: number;

  /** StartTransaction.conf has been received. */
  @Column({ default: false })
  startConfirmed: boolean;

  /** StopTransaction.conf has been received. */
  @Column({ default: false })
  stopConfirmed: boolean;

  /** idTagInfo.status the CSMS returned for StartTransaction. */
  @Column({ type: 'varchar', nullable: true })
  idTagStatus: string | null;
}
