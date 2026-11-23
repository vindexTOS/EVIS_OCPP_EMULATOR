import { DataSource } from 'typeorm';
import { ENTITIES } from '../../src/entities';
import {
  CarInput,
  ConnectorInput,
  Engine,
  SettingsPatch,
} from '../../src/engine/engine';
import { engineDb } from '../../src/engine/engine.service';
import { EngineOptions, ManualClock } from '../../src/engine/types';
import type { VirtualChargePoint } from '../../src/engine/virtual-charge-point';
import { MockCsms } from './mock-csms';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Harness {
  csms: MockCsms;
  engine: Engine;
  clock: ManualClock;
  dataSource: DataSource;
  events: { event: string; payload: any }[];
  /** Create a charger pointed at the mock CSMS. */
  charger(
    id?: string,
    connectors?: ConnectorInput[],
    settings?: SettingsPatch,
  ): Promise<VirtualChargePoint>;
  /** Create a charger, power it on and wait until the CSMS accepted it. */
  online(
    id?: string,
    connectors?: ConnectorInput[],
    settings?: SettingsPatch,
  ): Promise<VirtualChargePoint>;
  car(input?: Partial<CarInput>): Promise<number>;
  /** Let `seconds` of charger time pass, one tick per second. */
  advance(seconds: number): Promise<void>;
  /** Wait until nothing is in flight. */
  settle(): Promise<void>;
  /** Poll (in real time) until the condition holds. */
  until(
    condition: () => boolean,
    what?: string,
    timeoutMs?: number,
  ): Promise<void>;
  /** Restart the engine on the same database, as if the process had been killed. */
  restartEngine(): Promise<Engine>;
  close(): Promise<void>;
}

export const TEST_OPTIONS: Partial<EngineOptions> = {
  callTimeoutMs: 400,
  handshakeTimeoutMs: 2000,
  reconnectBaseMs: 20,
  reconnectMaxMs: 60,
  firmwareDownloadMs: 2000,
  firmwareInstallMs: 2000,
  uploadMs: 2000,
  softResetGraceMs: 1000,
  bootRetrySec: 3,
  jitter: false,
};

export async function createHarness(
  options: {
    password?: string;
    engine?: Partial<EngineOptions>;
    tls?: { key: string; cert: string; ca?: string };
  } = {},
): Promise<Harness> {
  // Noon, so nothing in a test straddles midnight.
  const clock = new ManualClock(Date.UTC(2026, 5, 15, 12, 0, 0));
  const csms = new MockCsms({
    password: options.password,
    tls: options.tls,
    now: () => clock.now(),
  });
  await csms.start();

  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: ENTITIES,
    synchronize: true,
  });
  await dataSource.initialize();

  const events: { event: string; payload: any }[] = [];
  const engineOptions = { ...TEST_OPTIONS, ...options.engine };
  const makeEngine = () =>
    new Engine(
      engineDb(dataSource),
      (event, payload) => events.push({ event, payload }),
      clock,
      engineOptions,
      () => undefined,
    );
  let engine = makeEngine();
  await engine.start(false);

  const h: Harness = {
    csms,
    get engine() {
      return engine;
    },
    clock,
    dataSource,
    events,

    async charger(id = 'CP001', connectors, settings = {}) {
      const dto = await engine.create({
        name: id,
        chargePointId: id,
        csmsUrl: csms.url(),
        rebootSeconds: 2,
        ...settings,
        connectors: connectors ?? [{ type: 'Type2', maxPowerW: 22000 }],
      });
      return engine.get(dto.id);
    },

    async online(id = 'CP001', connectors, settings) {
      const v = await h.charger(id, connectors, settings);
      await v.powerOn();
      await h.until(() => v.state === 'Accepted', `${id} to be accepted`);
      await h.settle();
      return v;
    },

    async car(input = {}) {
      const dto = await engine.createCar({
        name: 'Test car',
        connectorTypes: ['Type2', 'CCS2'],
        batteryCapacityWh: 60000,
        batteryWh: 12000,
        maxAcPowerW: 11000,
        maxDcPowerW: 150000,
        ...input,
      });
      return dto.id;
    },

    async advance(seconds) {
      for (let i = 0; i < seconds; i++) {
        clock.advance(1000);
        await engine.tick();
        await engine.quiet();
      }
    },

    async settle() {
      await engine.quiet();
    },

    async until(condition, what = 'condition', timeoutMs = 4000) {
      const deadline = Date.now() + timeoutMs;
      while (!condition()) {
        if (Date.now() > deadline)
          throw new Error(`Timed out waiting for ${what}`);
        await sleep(5);
      }
    },

    async restartEngine() {
      await engine.stop();
      engine = makeEngine();
      await engine.start(false);
      return engine;
    },

    async close() {
      await engine.stop();
      await csms.stop();
      await dataSource.destroy();
    },
  };
  return h;
}
