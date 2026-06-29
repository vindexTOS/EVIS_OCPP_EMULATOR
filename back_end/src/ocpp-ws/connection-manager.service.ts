import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';
import { ChargePoint } from '../entities/charge-point.entity';
import { ChargePointStatus } from '../entities/enums';
import { ENGINE_EVENTS } from './events';
import {
  ChangeConfigurationReq,
  RemoteStartTransactionReq,
  RemoteStopTransactionReq,
} from './ocpp16/messages';
import { ChargePoint16Connection } from './ocpp16/charge-point16.connection';

@Injectable()
export class ConnectionManager {
  private readonly connections = new Map<string, ChargePoint16Connection>();

  constructor(
    @InjectRepository(ChargePoint)
    private readonly chargePoints: MongoRepository<ChargePoint>,
    private readonly events: EventEmitter2,
  ) {}

  get(id: string): ChargePoint16Connection | undefined {
    return this.connections.get(id);
  }

  isOnline(id: string): boolean {
    return this.connections.get(id)?.connected ?? false;
  }

  async start(id: string) {
    if (this.connections.has(id)) return;
    const cp = await this.chargePoints.findOneBy({ _id: new ObjectId(id) });
    if (!cp) {
      throw new NotFoundException('Charge point not found.');
    }
    const conn = new ChargePoint16Connection({
      csmsUrl: cp.csmsUrl,
      vendor: cp.vendor,
      model: cp.model,
      firmwareVersion: cp.firmwareVersion,
      idTag: cp.idTag,
      connectorIds: cp.connectors.map((c) => c.connectorId),
      configuration: { ...cp.configuration },
    });
    this.wire(id, conn);
    this.connections.set(id, conn);
    await this.setStatus(id, ChargePointStatus.Connecting);
    conn.start();
  }

  async stop(id: string) {
    const conn = this.connections.get(id);
    if (!conn) return;
    conn.stop();
    this.connections.delete(id);
    await this.setStatus(id, ChargePointStatus.Offline);
  }

  private wire(id: string, conn: ChargePoint16Connection) {
    conn.on('boot', () => void this.setStatus(id, ChargePointStatus.Online));
    conn.on('close', () => void this.setStatus(id, ChargePointStatus.Offline));
    conn.on('error', () => undefined);
    conn.on('remoteStart', (e: Omit<RemoteStartTransactionReq, 'idTag'> & { connectorId: number; idTag: string }) =>
      this.events.emit(ENGINE_EVENTS.remoteStart, { chargePointId: id, ...e }),
    );
    conn.on('remoteStop', (e: RemoteStopTransactionReq) =>
      this.events.emit(ENGINE_EVENTS.remoteStop, { chargePointId: id, ...e }),
    );
    conn.on('configChanged', (e: ChangeConfigurationReq) =>
      void this.persistConfig(id, e.key, e.value),
    );
  }

  private async setStatus(id: string, status: ChargePointStatus) {
    await this.chargePoints.updateOne(
      { _id: new ObjectId(id) },
      { $set: { lastStatus: status } },
    );
    this.events.emit(ENGINE_EVENTS.chargePointStatus, {
      chargePointId: id,
      status,
    });
  }

  private async persistConfig(id: string, key: string, value: string) {
    await this.chargePoints.updateOne(
      { _id: new ObjectId(id) },
      { $set: { [`configuration.${key}`]: value } },
    );
  }
}
