import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';
import {
  ChargePointStatus,
  ConnectorType,
  OcppConnectorStatus,
} from './enums';

export interface Connector {
  connectorId: number;
  type: ConnectorType;
  maxPowerW: number;
  status: OcppConnectorStatus;
  totalEnergyWh: number;
  currentSessionId?: string;
}

@Entity({ name: 'charge_points' })
export class ChargePoint extends BaseEntity {
  @Column()
  name: string;

  @Column()
  vendor: string;

  @Column()
  model: string;

  @Column()
  firmwareVersion: string;

  @Column()
  csmsUrl: string;

  @Column()
  ocppVersion: string;

  @Column()
  idTag: string;

  @Column()
  connectors: Connector[];

  @Column()
  configuration: Record<string, string>;

  @Column()
  lastStatus: ChargePointStatus;
}
