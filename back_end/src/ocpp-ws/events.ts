import { ChargePointStatus, OcppConnectorStatus } from '../entities/enums';

export const ENGINE_EVENTS = {
  chargePointStatus: 'chargepoint.status',
  connectorUpdate: 'connector.update',
  sessionStarted: 'session.started',
  sessionTick: 'session.tick',
  sessionEnded: 'session.ended',
  ocppLog: 'ocpp.log',
  remoteStart: 'ocpp.remoteStart',
  remoteStop: 'ocpp.remoteStop',
} as const;

export interface ChargePointStatusEvent {
  chargePointId: string;
  status: ChargePointStatus;
}

export interface ConnectorUpdateEvent {
  chargePointId: string;
  connectorId: number;
  status: OcppConnectorStatus;
  totalEnergyWh: number;
}

export interface SessionTickEvent {
  sessionId: string;
  chargePointId: string;
  connectorId: number;
  carId: string;
  powerW: number;
  energyDeliveredWh: number;
  soc: number;
}

export interface RemoteStartEvent {
  chargePointId: string;
  connectorId: number;
  idTag: string;
}

export interface RemoteStopEvent {
  chargePointId: string;
  transactionId: number;
}
