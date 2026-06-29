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
const PREPARING_MS = 3000; // Available -> Preparing dwell before Charging
const FINISHING_MS = 3000; // Charging -> Finishing dwell before Available

interface Runtime {
  sessionId: string;
  chargePointId: string;
  connectorId: number;
  transactionId: number;
  timer: NodeJS.Timeout;
  lastTickTs: number;
  lastMeterTs: number;
  meterIntervalMs: number;
  // Latest computed sample, surfaced by commandTemplates() for live MeterValues.
  lastEnergyWh: number;
  lastPowerW: number;
  lastSoc: number;
}

interface Transition {
  timer: NodeJS.Timeout;
  phase: 'preparing' | 'finishing';
}

@Injectable()
export class SimulationService {
  private readonly runtimes = new Map<string, Runtime>();
  // Pending timed status transitions (Preparing/Finishing) keyed like runtimes.
  private readonly transitions = new Map<string, Transition>();

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
    if (this.runtimes.has(key) || this.transitions.has(key)) {
      throw new ConflictException('Connector is already in use.');
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

    // Enter Preparing (plug-in / handshake) before charging actually begins.
    connector.status = OcppConnectorStatus.Preparing;
    connector.currentSessionId = sessionId;
    await this.chargePoints.save(cp);
    await conn
      .statusNotification(connectorId, OcppConnectorStatus.Preparing)
      .catch(() => undefined);
    this.emitConnector(chargePointId, connectorId, connector.status, connector.totalEnergyWh);

    const timer = setTimeout(
      () => void this.beginCharging(key, chargePointId, connectorId, sessionId),
      PREPARING_MS,
    );
    this.transitions.set(key, { timer, phase: 'preparing' });

    this.events.emit(ENGINE_EVENTS.sessionStarted, { sessionId, chargePointId });
    return session;
  }

  // Preparing -> Charging: start the OCPP transaction and the meter tick loop.
  private async beginCharging(
    key: string,
    chargePointId: string,
    connectorId: number,
    sessionId: string,
  ) {
    this.transitions.delete(key);
    const cp = await this.chargePoints.findOneBy({
      _id: new ObjectId(chargePointId),
    });
    const connector = cp?.connectors.find((c) => c.connectorId === connectorId);
    const session = await this.sessions.findOneBy({
      _id: new ObjectId(sessionId),
    });
    if (!cp || !connector || !session || session.status !== SessionStatus.Active) {
      return;
    }

    const conn = this.connections.get(chargePointId);
    let transactionId: number | undefined;
    if (conn?.connected) {
      try {
        transactionId = await conn.startTransaction(
          connectorId,
          cp.idTag,
          connector.totalEnergyWh,
        );
      } catch {
        transactionId = undefined;
      }
    }
    if (transactionId == null) {
      // CSMS unreachable or rejected the transaction — unwind to Available.
      await this.abortToAvailable(cp, connector, session, 'Aborted');
      return;
    }

    session.ocppTransactionId = transactionId;
    await this.sessions.save(session);

    connector.status = OcppConnectorStatus.Charging;
    await this.chargePoints.save(cp);
    await conn
      ?.statusNotification(connectorId, OcppConnectorStatus.Charging)
      .catch(() => undefined);
    this.emitConnector(chargePointId, connectorId, connector.status, connector.totalEnergyWh);

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
      lastEnergyWh: connector.totalEnergyWh,
      lastPowerW: 0,
      lastSoc: 0,
    });
  }

  async stopCharging(chargePointId: string, connectorId: number, reason = 'Local') {
    const key = this.key(chargePointId, connectorId);
    const transition = this.transitions.get(key);
    if (transition?.phase === 'preparing' && !this.runtimes.has(key)) {
      // Stop requested while still Preparing — cancel before charging starts.
      clearTimeout(transition.timer);
      this.transitions.delete(key);
      const cp = await this.chargePoints.findOneBy({
        _id: new ObjectId(chargePointId),
      });
      const connector = cp?.connectors.find((c) => c.connectorId === connectorId);
      const session = connector?.currentSessionId
        ? await this.sessions.findOneBy({
            _id: new ObjectId(connector.currentSessionId),
          })
        : null;
      if (cp && connector && session) {
        await this.abortToAvailable(cp, connector, session, reason);
      }
      return session;
    }
    return this.endSession(key, reason);
  }

  // Roll a Preparing connector straight back to Available (no transaction ran).
  private async abortToAvailable(
    cp: ChargePoint,
    connector: ChargePoint['connectors'][number],
    session: ChargingSession,
    reason: string,
  ) {
    session.status = SessionStatus.Stopped;
    session.stoppedAt = new Date();
    session.stopReason = reason;
    session.meterStopWh = session.meterCurrentWh;
    await this.sessions.save(session);

    connector.status = OcppConnectorStatus.Available;
    connector.currentSessionId = undefined;
    await this.chargePoints.save(cp);
    const conn = this.connections.get(cp.id.toString());
    await conn
      ?.statusNotification(connector.connectorId, OcppConnectorStatus.Available)
      .catch(() => undefined);
    this.emitConnector(
      cp.id.toString(),
      connector.connectorId,
      connector.status,
      connector.totalEnergyWh,
    );
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

    rt.lastEnergyWh = session.meterCurrentWh;
    rt.lastPowerW = powerW;
    rt.lastSoc = soc * 100;

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
      // Enter Finishing (unplugging) before returning to Available.
      connector.status = OcppConnectorStatus.Finishing;
      await this.chargePoints.save(cp);
      this.emitConnector(rt.chargePointId, rt.connectorId, connector.status, connector.totalEnergyWh);
    }

    const conn = this.connections.get(rt.chargePointId);
    await conn
      ?.stopTransaction(rt.transactionId, session?.meterCurrentWh ?? 0, reason)
      .catch(() => undefined);
    await conn
      ?.statusNotification(rt.connectorId, OcppConnectorStatus.Finishing)
      .catch(() => undefined);

    const timer = setTimeout(
      () => void this.finishConnector(key, rt.chargePointId, rt.connectorId),
      FINISHING_MS,
    );
    this.transitions.set(key, { timer, phase: 'finishing' });

    this.events.emit(ENGINE_EVENTS.sessionEnded, {
      sessionId: rt.sessionId,
      chargePointId: rt.chargePointId,
      reason,
    });
    return session;
  }

  // Finishing -> Available: clear the session and report the connector free.
  private async finishConnector(
    key: string,
    chargePointId: string,
    connectorId: number,
  ) {
    this.transitions.delete(key);
    const cp = await this.chargePoints.findOneBy({
      _id: new ObjectId(chargePointId),
    });
    const connector = cp?.connectors.find((c) => c.connectorId === connectorId);
    if (!cp || !connector) return;
    connector.status = OcppConnectorStatus.Available;
    connector.currentSessionId = undefined;
    await this.chargePoints.save(cp);
    const conn = this.connections.get(chargePointId);
    await conn
      ?.statusNotification(connectorId, OcppConnectorStatus.Available)
      .catch(() => undefined);
    this.emitConnector(chargePointId, connectorId, connector.status, connector.totalEnergyWh);
  }

  // Manually force a connector into any OCPP status (Faulted, Suspended*,
  // Unavailable, Reserved, Available, ...) and report it to the CSMS. Tears
  // down any in-flight charging/transition for that connector first.
  async forceConnectorStatus(
    chargePointId: string,
    connectorId: number,
    status: OcppConnectorStatus,
    payload?: Record<string, unknown>,
  ) {
    const key = this.key(chargePointId, connectorId);
    const rt = this.runtimes.get(key);
    if (rt) {
      this.clearRuntime(key);
      const session = await this.sessions.findOneBy({
        _id: new ObjectId(rt.sessionId),
      });
      if (session && session.status === SessionStatus.Active) {
        session.status = SessionStatus.Stopped;
        session.stoppedAt = new Date();
        session.stopReason = `Forced:${status}`;
        session.meterStopWh = session.meterCurrentWh;
        await this.sessions.save(session);
      }
      const conn = this.connections.get(chargePointId);
      await conn
        ?.stopTransaction(rt.transactionId, session?.meterCurrentWh ?? 0, 'Other')
        .catch(() => undefined);
    }
    const transition = this.transitions.get(key);
    if (transition) {
      clearTimeout(transition.timer);
      this.transitions.delete(key);
    }

    const cp = await this.getChargePoint(chargePointId);
    const connector = cp.connectors.find((c) => c.connectorId === connectorId);
    if (!connector) {
      throw new NotFoundException('Connector not found.');
    }
    connector.status = status;
    if (status === OcppConnectorStatus.Available) {
      connector.currentSessionId = undefined;
    }
    await this.chargePoints.save(cp);

    const body = payload ?? {
      connectorId,
      errorCode: 'NoError',
      status,
      timestamp: new Date().toISOString(),
    };
    const conn = this.connections.get(chargePointId);
    await conn?.sendCall('StatusNotification', body).catch(() => undefined);
    this.emitConnector(chargePointId, connectorId, status, connector.totalEnergyWh);
    return { connectorId, status, payload: body };
  }

  // Default, ready-to-edit JSON payloads for every CP -> CSMS command. Values
  // are computed live, so MeterValues reflects the current meter each call.
  async commandTemplates(chargePointId: string): Promise<Record<string, unknown>> {
    const cp = await this.getChargePoint(chargePointId);
    const now = new Date().toISOString();
    const firstConn = cp.connectors[0];
    const firstConnId = firstConn?.connectorId ?? 1;

    let meterConnId = firstConnId;
    let energyWh = firstConn?.totalEnergyWh ?? 0;
    let powerW = 0;
    let soc = 0;
    let transactionId: number | undefined;
    for (const rt of this.runtimes.values()) {
      if (rt.chargePointId === chargePointId) {
        meterConnId = rt.connectorId;
        energyWh = rt.lastEnergyWh;
        powerW = rt.lastPowerW;
        soc = rt.lastSoc;
        transactionId = rt.transactionId;
        break;
      }
    }

    const sampledValue = [
      this.sample(energyWh, 'Energy.Active.Import.Register', 'Wh'),
      this.sample(powerW, 'Power.Active.Import', 'W'),
      this.sample(soc, 'SoC', 'Percent'),
    ].map((s) => ({ ...s, context: 'Sample.Clock' }));

    return {
      BootNotification: {
        chargePointVendor: cp.vendor,
        chargePointModel: cp.model,
        firmwareVersion: cp.firmwareVersion,
        chargePointSerialNumber: cp.chargePointId,
        chargeBoxSerialNumber: cp.chargePointId,
      },
      Heartbeat: {},
      Authorize: { idTag: cp.idTag },
      StatusNotification: {
        connectorId: firstConnId,
        errorCode: 'NoError',
        status: firstConn?.status ?? OcppConnectorStatus.Available,
        timestamp: now,
      },
      MeterValues: {
        connectorId: meterConnId,
        ...(transactionId != null ? { transactionId } : {}),
        meterValue: [{ timestamp: now, sampledValue }],
      },
      StopTransaction: {
        transactionId: transactionId ?? 0,
        meterStop: Math.round(energyWh),
        timestamp: now,
        reason: 'Local',
      },
      DataTransfer: { vendorId: 'evis', messageId: 'ping', data: '' },
      FirmwareStatusNotification: { status: 'Idle' },
      DiagnosticsStatusNotification: { status: 'Idle' },
    };
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
