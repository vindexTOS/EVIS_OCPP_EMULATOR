import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ChargePoint } from './charge-point.entity';

export interface SchedulePeriod {
  startPeriod: number;
  limit: number;
  numberPhases?: number;
}

export interface ChargingSchedule {
  duration?: number;
  startSchedule?: string;
  chargingRateUnit: 'A' | 'W';
  chargingSchedulePeriod: SchedulePeriod[];
  minChargingRate?: number;
}

export type ProfilePurpose =
  | 'ChargePointMaxProfile'
  | 'TxDefaultProfile'
  | 'TxProfile';
export type ProfileKind = 'Absolute' | 'Recurring' | 'Relative';

/** A smart-charging profile installed by SetChargingProfile or RemoteStartTransaction. */
@Entity({ name: 'charging_profiles' })
@Index(['chargePointId', 'connectorId'])
export class ChargingProfile extends BaseEntity {
  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  @Column()
  connectorId: number;

  @Column()
  chargingProfileId: number;

  /** OCPP transactionId from the profile, when the CSMS sent one. */
  @Column({ type: 'integer', nullable: true })
  transactionId: number | null;

  /** Emulator session a TxProfile belongs to. Removed when that session ends. */
  @Column({ type: 'integer', nullable: true })
  sessionId: number | null;

  @Column()
  stackLevel: number;

  @Column({ type: 'varchar' })
  purpose: ProfilePurpose;

  @Column({ type: 'varchar' })
  kind: ProfileKind;

  @Column({ type: 'varchar', nullable: true })
  recurrencyKind: 'Daily' | 'Weekly' | null;

  @Column({ type: 'datetime', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'datetime', nullable: true })
  validTo: Date | null;

  @Column({ type: 'simple-json' })
  schedule: ChargingSchedule;

  /** When the profile took effect here: the reference point for Relative schedules. */
  @Column({ type: 'datetime' })
  installedAt: Date;
}
