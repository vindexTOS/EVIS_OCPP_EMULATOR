import { Car, ChargePoint } from '../entities';
import {
  CONNECTOR_TYPE_INFO,
  CONNECTOR_TYPES,
  ConnectorType,
} from '../entities/enums';
import { defaultConfiguration } from './ocpp16/config-keys';
import {
  ChargePointDto,
  Clock,
  DEFAULT_ENGINE_OPTIONS,
  ENGINE_EVENTS,
  EngineDb,
  EngineError,
  EngineHost,
  EngineOptions,
  SystemClock,
} from './types';
import { VirtualChargePoint, defaultPhases } from './virtual-charge-point';

export interface CarDto {
  id: number;
  name: string;
  color: string;
  connectorTypes: ConnectorType[];
  batteryCapacityWh: number;
  batteryWh: number;
  soc: number;
  targetSoc: number;
  maxAcPowerW: number;
  maxDcPowerW: number;
  acPhases: number;
  batteryVoltage: number;
  pluggedInto: {
    chargePointId: number;
    chargePointName: string;
    connectorId: number;
  } | null;
  createdAt: string | null;
}

export interface ConnectorInput {
  type: ConnectorType;
  maxPowerW?: number;
  phases?: number;
  side?: 'left' | 'right';
}

export interface CarInput {
  name: string;
  color?: string;
  connectorTypes: ConnectorType[];
  batteryCapacityWh: number;
  batteryWh?: number;
  targetSoc?: number;
  maxAcPowerW?: number;
  maxDcPowerW?: number;
  acPhases?: number;
  batteryVoltage?: number;
}

/** Settings of a charger that the API may write. Everything else is engine state. */
export const SETTINGS_FIELDS = [
  'name',
  'chargePointId',
  'vendor',
  'model',
  'serialNumber',
  'chargeBoxSerialNumber',
  'firmwareVersion',
  'iccid',
  'imsi',
  'meterType',
  'meterSerialNumber',
  'csmsUrl',
  'appendIdToUrl',
  'basicAuthUser',
  'basicAuthPassword',
  'tlsVerify',
  'tlsCaCert',
  'tlsClientCert',
  'tlsClientKey',
  'defaultIdTag',
  'autoStart',
  'fullBatteryBehavior',
  'speed',
  'bootOnReconnect',
  'rebootSeconds',
  'perPhaseMeterValues',
  'securityEvents',
  'dataTransferMode',
  'firmwareFailure',
  'diagnosticsFailure',
  'unlockFailure',
] as const;
export type SettingsField = (typeof SETTINGS_FIELDS)[number];
export type SettingsPatch = Partial<Pick<ChargePoint, SettingsField>>;

/**
 * The emulator's engine room: owns every virtual charger and every car, keeps
 * them in step with SQLite and drives the one-second clock.
 */
export class Engine implements EngineHost {
  readonly options: EngineOptions;
  private readonly chargers = new Map<number, VirtualChargePoint>();
  private readonly cars = new Map<number, Car>();
  private ticker?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    readonly db: EngineDb,
    private readonly sink: (event: string, payload: unknown) => void,
    readonly clock: Clock = new SystemClock(),
    options: Partial<EngineOptions> = {},
    private readonly onWarn: (message: string) => void = (m) => console.warn(m),
  ) {
    this.options = { ...DEFAULT_ENGINE_OPTIONS, ...options };
  }

  // --------------------------------------------------------------- host API

  emit(event: string, payload: unknown) {
    try {
      this.sink(event, payload);
    } catch (err) {
      this.onWarn(`event sink failed: ${(err as Error).message}`);
    }
  }

  car(id: number): Car | undefined {
    return this.cars.get(id);
  }

  carChanged(car: Car) {
    void this.db.cars
      .update(car.id, { batteryWh: car.batteryWh })
      .catch((err) =>
        this.onWarn(`could not store car ${car.id}: ${(err as Error).message}`),
      );
    this.emit(ENGINE_EVENTS.car, this.carDto(car));
  }

  warn(message: string) {
    this.onWarn(message);
  }

  // -------------------------------------------------------------- lifecycle

  async start(autoTick = true) {
    for (const car of await this.db.cars.find()) this.cars.set(car.id, car);
    const rows = await this.db.chargePoints.find({ order: { id: 'ASC' } });
    for (const cp of rows) {
      const v = new VirtualChargePoint(cp, this);
      this.chargers.set(cp.id, v);
      await v.init();
    }
    if (autoTick) {
      this.ticker = setInterval(() => void this.tick(), 1000);
    }
  }

  async stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    await Promise.all(
      [...this.chargers.values()].map((v) =>
        v.settled().catch(() => undefined),
      ),
    );
    for (const v of this.chargers.values()) v.dispose();
  }

  /** One beat for every charger. Beats never overlap. */
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await Promise.all(
        [...this.chargers.values()].map((v) => v.tick().catch(() => undefined)),
      );
    } finally {
      this.ticking = false;
    }
  }

  /** Resolves once nothing is in flight anywhere. For tests. */
  async quiet(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let calm = 0;
    while (Date.now() < deadline) {
      await Promise.all([...this.chargers.values()].map((v) => v.settled()));
      const idle = [...this.chargers.values()].every((v) => v.idle);
      calm = idle ? calm + 1 : 0;
      if (calm >= 3) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  // ---------------------------------------------------------------- chargers

  list(): ChargePointDto[] {
    return [...this.chargers.values()].map((v) => v.toDto());
  }

  get(id: number): VirtualChargePoint {
    const v = this.chargers.get(id);
    if (!v) throw new EngineError('Charger not found.', 'not-found');
    return v;
  }

  private assertFreeIdentity(chargePointId: string, exceptId?: number) {
    const taken = [...this.chargers.values()].find(
      (v) =>
        v.cp.chargePointId.toLowerCase() === chargePointId.toLowerCase() &&
        v.id !== exceptId,
    );
    if (taken) {
      throw new EngineError(
        `Another charger already uses the ID "${chargePointId}".`,
        'conflict',
      );
    }
  }

  async create(
    input: SettingsPatch & { connectors?: ConnectorInput[] },
  ): Promise<ChargePointDto> {
    const identity = (input.chargePointId ?? '').trim();
    if (!identity) throw new EngineError('A charger needs a charge point ID.');
    this.assertFreeIdentity(identity);

    const settings: SettingsPatch = {};
    for (const field of SETTINGS_FIELDS) {
      if (input[field] !== undefined)
        (settings as Record<string, unknown>)[field] = input[field];
    }
    const saved = await this.db.chargePoints.save(
      this.db.chargePoints.create({
        ...settings,
        name: (input.name ?? '').trim() || identity,
        chargePointId: identity,
        // A real charger reports a serial number; default it to the identity.
        serialNumber: input.serialNumber ?? identity,
        configuration: defaultConfiguration(),
        poweredOn: false,
        networkUp: true,
      }),
    );
    const connectors = input.connectors?.length
      ? input.connectors
      : [{ type: 'Type2' as ConnectorType }];
    let connectorId = 0;
    for (const c of connectors) {
      connectorId += 1;
      const maxPowerW =
        c.maxPowerW ?? CONNECTOR_TYPE_INFO[c.type].defaultPowerW;
      await this.db.connectors.save(
        this.db.connectors.create({
          chargePointId: saved.id,
          connectorId,
          type: c.type,
          maxPowerW,
          phases: c.phases ?? defaultPhases(c.type, maxPowerW),
          side: c.side ?? (connectorId % 2 === 1 ? 'left' : 'right'),
        }),
      );
    }
    // Read it back so every column default is filled in.
    const cp = await this.db.chargePoints.findOneByOrFail({ id: saved.id });
    const v = new VirtualChargePoint(cp, this);
    this.chargers.set(cp.id, v);
    await v.init();
    const dto = v.toDto();
    this.emit(ENGINE_EVENTS.chargePoint, dto);
    return dto;
  }

  async update(id: number, patch: SettingsPatch): Promise<ChargePointDto> {
    const v = this.get(id);
    const clean: SettingsPatch = {};
    for (const field of SETTINGS_FIELDS) {
      if (patch[field] !== undefined)
        (clean as Record<string, unknown>)[field] = patch[field];
    }
    if (clean.chargePointId !== undefined) {
      clean.chargePointId = clean.chargePointId.trim();
      if (!clean.chargePointId)
        throw new EngineError('A charger needs a charge point ID.');
      this.assertFreeIdentity(clean.chargePointId, id);
    }
    await v.updateSettings(clean);
    return v.toDto();
  }

  async remove(id: number) {
    const v = this.get(id);
    await v.settled().catch(() => undefined);
    v.dispose();
    this.chargers.delete(id);
    // Children go with it (ON DELETE CASCADE).
    await this.db.chargePoints.delete(id);
    this.emit(ENGINE_EVENTS.chargePointRemoved, { id });
    for (const car of this.cars.values())
      this.emit(ENGINE_EVENTS.car, this.carDto(car));
  }

  // -------------------------------------------------------------------- cars

  private findPlug(carId: number) {
    for (const v of this.chargers.values()) {
      const c = v.connectors.find((x) => x.entity.carId === carId);
      if (c) return { v, connectorId: c.entity.connectorId };
    }
    return null;
  }

  carDto(car: Car): CarDto {
    const plug = this.findPlug(car.id);
    return {
      id: car.id,
      name: car.name,
      color: car.color,
      connectorTypes: car.connectorTypes,
      batteryCapacityWh: car.batteryCapacityWh,
      batteryWh: car.batteryWh,
      soc:
        car.batteryCapacityWh > 0
          ? (car.batteryWh / car.batteryCapacityWh) * 100
          : 0,
      targetSoc: car.targetSoc,
      maxAcPowerW: car.maxAcPowerW,
      maxDcPowerW: car.maxDcPowerW,
      acPhases: car.acPhases,
      batteryVoltage: car.batteryVoltage,
      pluggedInto: plug
        ? {
            chargePointId: plug.v.id,
            chargePointName: plug.v.cp.name,
            connectorId: plug.connectorId,
          }
        : null,
      createdAt: car.createdAt ? car.createdAt.toISOString() : null,
    };
  }

  listCars(): CarDto[] {
    return [...this.cars.values()].map((car) => this.carDto(car));
  }

  private needCar(id: number): Car {
    const car = this.cars.get(id);
    if (!car) throw new EngineError('Car not found.', 'not-found');
    return car;
  }

  private checkCar(input: Partial<CarInput>) {
    if (input.connectorTypes !== undefined) {
      const bad = input.connectorTypes.filter(
        (t) => !CONNECTOR_TYPES.includes(t),
      );
      if (bad.length)
        throw new EngineError(`Unknown connector type: ${bad.join(', ')}`);
      if (input.connectorTypes.length === 0) {
        throw new EngineError(
          'A car needs at least one plug type that fits it.',
        );
      }
    }
  }

  async createCar(input: CarInput): Promise<CarDto> {
    this.checkCar(input);
    const capacity = input.batteryCapacityWh;
    const saved = await this.db.cars.save(
      this.db.cars.create({
        name: input.name.trim(),
        color: input.color ?? '#3b82f6',
        connectorTypes: input.connectorTypes,
        batteryCapacityWh: capacity,
        batteryWh: Math.min(
          capacity,
          Math.max(0, input.batteryWh ?? capacity * 0.2),
        ),
        targetSoc: input.targetSoc ?? 100,
        maxAcPowerW: input.maxAcPowerW ?? 11000,
        maxDcPowerW: input.maxDcPowerW ?? 150000,
        acPhases: input.acPhases ?? 3,
        batteryVoltage: input.batteryVoltage ?? 400,
      }),
    );
    const car = await this.db.cars.findOneByOrFail({ id: saved.id });
    this.cars.set(car.id, car);
    const dto = this.carDto(car);
    this.emit(ENGINE_EVENTS.car, dto);
    return dto;
  }

  async updateCar(id: number, patch: Partial<CarInput>): Promise<CarDto> {
    const car = this.needCar(id);
    this.checkCar(patch);
    const plug = this.findPlug(id);
    if (plug && patch.connectorTypes) {
      const type = plug.v.connector(plug.connectorId)!.entity.type;
      if (!patch.connectorTypes.includes(type)) {
        throw new EngineError(
          `${car.name} is plugged into a ${CONNECTOR_TYPE_INFO[type].label} connector. Unplug it before removing that plug type.`,
          'conflict',
        );
      }
    }
    const fields: (keyof CarInput)[] = [
      'name',
      'color',
      'connectorTypes',
      'batteryCapacityWh',
      'batteryWh',
      'targetSoc',
      'maxAcPowerW',
      'maxDcPowerW',
      'acPhases',
      'batteryVoltage',
    ];
    for (const field of fields) {
      if (patch[field] !== undefined)
        (car as unknown as Record<string, unknown>)[field] = patch[field];
    }
    car.batteryWh = Math.min(car.batteryCapacityWh, Math.max(0, car.batteryWh));
    await this.db.cars.save(car);
    if (plug) await plug.v.carUpdated(id);
    const dto = this.carDto(car);
    this.emit(ENGINE_EVENTS.car, dto);
    return dto;
  }

  async setBattery(id: number, socPercent: number): Promise<CarDto> {
    const car = this.needCar(id);
    return this.updateCar(id, {
      batteryWh:
        (car.batteryCapacityWh * Math.min(100, Math.max(0, socPercent))) / 100,
    });
  }

  async deleteCar(id: number) {
    const car = this.needCar(id);
    const plug = this.findPlug(id);
    if (plug) {
      throw new EngineError(
        `${car.name} is plugged into ${plug.v.cp.name}. Unplug it first.`,
        'conflict',
      );
    }
    this.cars.delete(id);
    await this.db.cars.delete(id);
    this.emit(ENGINE_EVENTS.carRemoved, { id });
  }

  // ------------------------------------------------------- plug in and out

  async plug(chargePointId: number, connectorId: number, carId: number) {
    const v = this.get(chargePointId);
    const car = this.needCar(carId);
    const plug = this.findPlug(carId);
    if (plug) {
      throw new EngineError(
        `${car.name} is already plugged into ${plug.v.cp.name}, connector ${plug.connectorId}.`,
        'conflict',
      );
    }
    await v.plug(connectorId, car);
    this.emit(ENGINE_EVENTS.car, this.carDto(car));
  }

  async unplug(chargePointId: number, connectorId: number) {
    const v = this.get(chargePointId);
    const carId = v.connector(connectorId)?.entity.carId ?? null;
    await v.unplug(connectorId);
    const car = carId != null ? this.cars.get(carId) : undefined;
    if (car) this.emit(ENGINE_EVENTS.car, this.carDto(car));
  }
}
