import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { ConnectorType } from './enums';

@Entity({ name: 'cars' })
export class Car extends BaseEntity {
  @Column()
  name: string;

  @Column({ default: '#3b82f6' })
  color: string;

  /** Plug types that physically fit this car's inlet. */
  @Column({ type: 'simple-json' })
  connectorTypes: ConnectorType[];

  @Column({ type: 'float' })
  batteryCapacityWh: number;

  /** Energy currently in the battery, in Wh. */
  @Column({ type: 'float' })
  batteryWh: number;

  /** The car stops drawing power at this state of charge (percent). */
  @Column({ type: 'float', default: 100 })
  targetSoc: number;

  /** Limit of the on-board charger (AC). */
  @Column({ type: 'float', default: 11000 })
  maxAcPowerW: number;

  /** Peak DC fast-charging power. */
  @Column({ type: 'float', default: 150000 })
  maxDcPowerW: number;

  /** Phases the on-board charger uses (1 or 3). */
  @Column({ default: 3 })
  acPhases: number;

  /** Nominal pack voltage, used for DC current and voltage readings. */
  @Column({ default: 400 })
  batteryVoltage: number;
}
