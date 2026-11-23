import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AuthEntry,
  Car,
  Certificate,
  ChargePoint,
  ChargerEvent,
  ChargingProfile,
  ChargingSession,
  Connector,
  MeterSample,
  OcppLog,
  QueuedMessage,
  Reservation,
} from '../entities';
import { Engine } from './engine';
import { EngineDb, SystemClock } from './types';

/** Name of the in-process event every engine event is wrapped in. */
export const ENGINE_BUS = 'engine';

export interface EngineBusMessage {
  event: string;
  payload: unknown;
}

export function engineDb(dataSource: DataSource): EngineDb {
  return {
    chargePoints: dataSource.getRepository(ChargePoint),
    connectors: dataSource.getRepository(Connector),
    cars: dataSource.getRepository(Car),
    sessions: dataSource.getRepository(ChargingSession),
    samples: dataSource.getRepository(MeterSample),
    events: dataSource.getRepository(ChargerEvent),
    logs: dataSource.getRepository(OcppLog),
    reservations: dataSource.getRepository(Reservation),
    profiles: dataSource.getRepository(ChargingProfile),
    auth: dataSource.getRepository(AuthEntry),
    queue: dataSource.getRepository(QueuedMessage),
    certificates: dataSource.getRepository(Certificate),
  };
}

/** Runs the engine for the lifetime of the Nest application. */
@Injectable()
export class EngineService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Engine');
  readonly engine: Engine;
  private readonly autoTick: boolean;

  constructor(
    @InjectDataSource() dataSource: DataSource,
    events: EventEmitter2,
    config: ConfigService,
  ) {
    this.autoTick = config.get<string>('ENGINE_AUTOTICK', 'true') !== 'false';
    this.engine = new Engine(
      engineDb(dataSource),
      (event, payload) =>
        events.emit(ENGINE_BUS, { event, payload } satisfies EngineBusMessage),
      new SystemClock(),
      {},
      (message) => this.logger.warn(message),
    );
  }

  async onApplicationBootstrap() {
    await this.engine.start(this.autoTick);
    this.logger.log(
      `Engine running: ${this.engine.list().length} charger(s), ${this.engine.listCars().length} car(s)`,
    );
  }

  async onApplicationShutdown() {
    await this.engine.stop();
  }
}
