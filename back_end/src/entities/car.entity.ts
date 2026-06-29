import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ConnectorType } from './enums';

@Entity({ name: 'cars' })
export class Car extends BaseEntity {
  @Column()
  name: string;

  @Column()
  connectorTypes: ConnectorType[];

  @Column()
  batteryCapacityWh: number;

  @Column()
  batterySoCWh: number;

  @Column()
  maxChargePowerW: number;
}
