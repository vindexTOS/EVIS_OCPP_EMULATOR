import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';
import { Car } from '../../entities/car.entity';
import { ChargePoint } from '../../entities/charge-point.entity';
import { ChargingSession } from '../../entities/charging-session.entity';
import { OcppConnectorStatus, SessionStatus } from '../../entities/enums';
import { ConnectionManager } from '../connection-manager.service';
import { ENGINE_EVENTS } from '../events';
import type { RemoteStartEvent, RemoteStopEvent } from '../events';

const TICK_MS = 2000;
const SAMPLE_FLOOR = 0.9; // taper charging power above this SoC fraction

interface Runtime {
  sessionId: string;
  chargePointId: string;
  connectorId: number;
  transactionId: number;
  timer: NodeJS.Timeout;
  lastTickTs: number;
  lastMeterTs: number;
  meterIntervalMs: number;
}

@Injectable()
export class SimulationService {
  private readonly runtimes = new Map<string, Runtime>();

  constructor(
    @InjectRepository(ChargePoint)
    private readonly chargePoints: MongoRepository<ChargePoint>,
    @InjectRepository(Car)
    private readonly cars: MongoRepository<Car>,
    @InjectRepository(ChargingSession)
    private readonly sessions: MongoRepository<ChargingSession>,
    private readonly connections: ConnectionManager,
    private readonly events: EventEmitter2,
  ) {}

  async startCharging(chargePointId: string, connectorId: number, carId?: string) {
    const key = this.key(chargePointId, connectorId);
    if (this.runtimes.has(key)) {
      throw new ConflictException('Connector is already charging.');
    }
    const cp = await this.getChargePoint(chargePointId);
    const connector = cp.connectors.find((c) => c.connectorId === connectorId);
    if (!connector) {
      throw new NotFoundException('Connector not found.');
    }
    const conn = this.connections.get(chargePointId);
    if (!conn?.connected) {
      throw new BadRequestException('Charge point is not connected to a CSMS.');
    }

    let car: Car | null = null;
    if (carId) {
      car = await this.cars.findOneBy({ _id: new ObjectId(carId) });
      if (!car) {
        throw new NotFoundException('Car not found.');
      }
      if (!car.connectorTypes.includes(connector.type)) {
        throw new BadRequestException(
          `Car is not compatible with a ${connector.type} connector.`,
        );
      }
    }

    const session = await this.sessions.save(
      this.sessions.create({
        chargePointId,
        connectorId,
        carId: carId ?? undefined,
        idTag: cp.idTag,
        meterStartWh: connector.totalEnergyWh,
        meterCurrentWh: connector.totalEnergyWh,
        energyDeliveredWh: 0,
        status: SessionStatus.Active,
        startedAt: new Date(),
        samples: [],
      }),
    );
    const sessionId = session.id.toString();

    connector.status = OcppConnectorStatus.Charging;
    connector.currentSessionId = sessionId;
    await this.chargePoints.save(cp);

    const transactionId = await conn.startTransaction(
      connectorId,
      cp.idTag,
      connector.totalEnergyWh,
    );
    session.ocppTransactionId = transactionId;
    await this.sessions.save(session);
    await conn
      .statusNotification(connectorId, OcppConnectorStatus.Charging)
      .catch(() => undefined);

    const now = Date.now();
    const meterIntervalMs =
      Number(cp.configuration.MeterValueSampleInterval ?? 10) * 1000;
    const timer = setInterval(() => void this.tick(key), TICK_MS);
    this.runtimes.set(key, {
      sessionId,
      chargePointId,
      connectorId,
      transactionId,
      timer,
      lastTickTs: now,
      lastMeterTs: now,
      meterIntervalMs,
    });

    this.events.emit(ENGINE_EVENTS.sessionStarted, { sessionId, chargePointId });
    this.emitConnector(chargePointId, connector.connectorId, connector.status, connector.totalEnergyWh);
    return session;
  }

  async stopCharging(chargePointId: string, connectorId: number, reason = 'Local') {
    return this.endSession(this.key(chargePointId, connectorId), reason);
  }

  @OnEvent(ENGINE_EVENTS.remoteStart)
  async onRemoteStart(e: RemoteStartEvent) {
    const key = this.key(e.chargePointId, e.connectorId);
    if (this.runtimes.has(key)) return;
    const car = await this.pickCompatibleCar(e.chargePointId, e.connectorId);
    await this.startCharging(e.chargePointId, e.connectorId, car?.id.toString()).catch(
      () => undefined,
    );
  }

  @OnEvent(ENGINE_EVENTS.remoteStop)
  async onRemoteStop(e: RemoteStopEvent) {
    for (const [key, rt] of this.runtimes) {
      if (rt.chargePointId === e.chargePointId && rt.transactionId === e.transactionId) {
        await this.endSession(key, 'Remote');
        return;
      }
    }
  }

  private async tick(key: string) {
    const rt = this.runtimes.get(key);
    if (!rt) return;

    const session = await this.sessions.findOneBy({
      _id: new ObjectId(rt.sessionId),
    });
    if (!session || session.status !== SessionStatus.Active) {
      this.clearRuntime(key);
      return;
    }
    const cp = await this.chargePoints.findOneBy({
      _id: new ObjectId(rt.chargePointId),
    });
    const connector = cp?.connectors.find((c) => c.connectorId === rt.connectorId);
    if (!cp || !connector) {
      await this.endSession(key, 'Other');
      return;
    }
    const car = session.carId
      ? await this.cars.findOneBy({ _id: new ObjectId(session.carId) })
      : null;

    if (car && car.batterySoCWh >= car.batteryCapacityWh) {
      await this.endSession(key, 'Local');
      return;
    }

    const now = Date.now();
    const dtSec = (now - rt.lastTickTs) / 1000;
    rt.lastTickTs = now;

    const soc = car ? car.batterySoCWh / car.batteryCapacityWh : 0;
    const powerW = this.computePower(connector.maxPowerW, car, soc, rt);
    let deltaWh = (powerW * dtSec) / 3600;

    if (car) {
      const newSoc = Math.min(car.batteryCapacityWh, car.batterySoCWh + deltaWh);
      deltaWh = newSoc - car.batterySoCWh;
      car.batterySoCWh = newSoc;
      await this.cars.save(car);
    }

    session.meterCurrentWh += deltaWh;
    session.energyDeliveredWh += deltaWh;
    connector.totalEnergyWh += deltaWh;

    if (now - rt.lastMeterTs >= rt.meterIntervalMs) {
      rt.lastMeterTs = now;
      session.samples.push({
        ts: new Date(),
        energyWh: session.meterCurrentWh,
        powerW,
        soc: soc * 100,
      });
      const conn = this.connections.get(rt.chargePointId);
      await conn
        ?.meterValues(rt.connectorId, rt.transactionId, [
          this.sample(session.meterCurrentWh, 'Energy.Active.Import.Register', 'Wh'),
          this.sample(powerW, 'Power.Active.Import', 'W'),
          this.sample(soc * 100, 'SoC', 'Percent'),
        ])
        .catch(() => undefined);
    }

    await this.sessions.save(session);
    await this.chargePoints.save(cp);

    this.events.emit(ENGINE_EVENTS.sessionTick, {
      sessionId: rt.sessionId,
      chargePointId: rt.chargePointId,
      connectorId: rt.connectorId,
      carId: session.carId,
      powerW,
      energyDeliveredWh: session.energyDeliveredWh,
      soc: soc * 100,
    });
  }

  private async endSession(key: string, reason: string) {
    const rt = this.runtimes.get(key);
    if (!rt) return;
    this.clearRuntime(key);

    const session = await this.sessions.findOneBy({
      _id: new ObjectId(rt.sessionId),
    });
    if (session) {
      session.status = SessionStatus.Stopped;
      session.stoppedAt = new Date();
      session.stopReason = reason;
      session.meterStopWh = session.meterCurrentWh;
      await this.sessions.save(session);
    }

    const cp = await this.chargePoints.findOneBy({
      _id: new ObjectId(rt.chargePointId),
    });
    const connector = cp?.connectors.find((c) => c.connectorId === rt.connectorId);
    if (cp && connector) {
      connector.status = OcppConnectorStatus.Available;
      connector.currentSessionId = undefined;
      await this.chargePoints.save(cp);
      this.emitConnector(rt.chargePointId, rt.connectorId, connector.status, connector.totalEnergyWh);
    }

    const conn = this.connections.get(rt.chargePointId);
    await conn
      ?.stopTransaction(rt.transactionId, session?.meterCurrentWh ?? 0, reason)
      .catch(() => undefined);
    await conn
      ?.statusNotification(rt.connectorId, OcppConnectorStatus.Available)
      .catch(() => undefined);

    this.events.emit(ENGINE_EVENTS.sessionEnded, {
      sessionId: rt.sessionId,
      chargePointId: rt.chargePointId,
      reason,
    });
    return session;
  }

  private computePower(connectorMaxW: number, car: Car | null, soc: number, rt: Runtime): number {
    const limits = [connectorMaxW];
    if (car) limits.push(car.maxChargePowerW);
    const profileLimit = this.connections
      .get(rt.chargePointId)
      ?.getProfileLimitW(rt.connectorId);
    if (profileLimit != null) limits.push(profileLimit);
    let power = Math.min(...limits);
    if (car && soc > SAMPLE_FLOOR) {
      power *= Math.max(0.1, (1 - soc) / (1 - SAMPLE_FLOOR));
    }
    return Math.max(0, power);
  }

  private async pickCompatibleCar(chargePointId: string, connectorId: number) {
    const cp = await this.chargePoints.findOneBy({
      _id: new ObjectId(chargePointId),
    });
    const connector = cp?.connectors.find((c) => c.connectorId === connectorId);
    if (!connector) return null;
    const cars = await this.cars.find();
    return (
      cars.find(
        (c) =>
          c.connectorTypes.includes(connector.type) &&
          c.batterySoCWh < c.batteryCapacityWh,
      ) ?? null
    );
  }

  private sample(value: number, measurand: string, unit: string) {
    return {
      value: String(Math.round(value)),
      measurand,
      unit,
      context: 'Sample.Periodic',
    };
  }

  private emitConnector(
    chargePointId: string,
    connectorId: number,
    status: OcppConnectorStatus,
    totalEnergyWh: number,
  ) {
    this.events.emit(ENGINE_EVENTS.connectorUpdate, {
      chargePointId,
      connectorId,
      status,
      totalEnergyWh,
    });
  }

  private async getChargePoint(id: string): Promise<ChargePoint> {
    const cp = await this.chargePoints.findOneBy({ _id: new ObjectId(id) });
    if (!cp) {
      throw new NotFoundException('Charge point not found.');
    }
    return cp;
  }

  private clearRuntime(key: string) {
    const rt = this.runtimes.get(key);
    if (rt) {
      clearInterval(rt.timer);
      this.runtimes.delete(key);
    }
  }

  private key(chargePointId: string, connectorId: number) {
    return `${chargePointId}:${connectorId}`;
  }
}
