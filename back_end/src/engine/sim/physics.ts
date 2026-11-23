import type { Car } from '../../entities/car.entity';
import { ConnectorType, isDc } from '../../entities/enums';

// How much power a car takes from a connector. Deliberately simple, but it has
// the shape of the real thing: an on-board charger limited per phase on AC, a
// tapering curve on DC, and losses between the meter and the battery.

export const AC_VOLTAGE = 230;
/** IEC 61851: below 6 A per phase a car is not allowed to charge. */
export const MIN_AC_CURRENT = 6;
export const MIN_DC_POWER = 500;

const AC_EFFICIENCY = 0.92;
const DC_EFFICIENCY = 0.95;

export interface OutletSpec {
  type: ConnectorType;
  maxPowerW: number;
  /** AC phases wired to the outlet. */
  phases: number;
}

export interface ChargeRequest {
  /** Most the car would take right now from this outlet, at the meter, in W. */
  maxW: number;
  /** AC phases in use; 0 on DC. */
  phases: number;
  /** Phase voltage on AC, pack voltage on DC. */
  voltage: number;
  dc: boolean;
}

export const socFraction = (car: Car) =>
  car.batteryCapacityWh > 0
    ? Math.max(0, Math.min(1, car.batteryWh / car.batteryCapacityWh))
    : 0;

export const socPercent = (car: Car) => socFraction(car) * 100;

/** The battery has reached the level the car was told to charge to. */
export const reachedTarget = (car: Car) =>
  car.batteryWh >=
  (car.batteryCapacityWh * Math.min(100, car.targetSoc)) / 100 - 1e-6;

/** Share of peak DC power the battery accepts at a state of charge. */
function dcCurve(soc: number): number {
  if (soc < 0.05) return 0.7 + 6 * soc; // gentle start on a nearly empty pack
  if (soc <= 0.5) return 1;
  if (soc <= 0.8) return 1 - ((soc - 0.5) / 0.3) * 0.5; // 100 % → 50 %
  return Math.max(0.06, 0.5 - ((soc - 0.8) / 0.2) * 0.44); // 50 % → 6 %
}

/** The on-board charger backs off over the last few percent. */
function acTaper(soc: number): number {
  if (soc < 0.95) return 1;
  return Math.max(0.2, 1 - ((soc - 0.95) / 0.05) * 0.8);
}

export function efficiency(type: ConnectorType): number {
  return isDc(type) ? DC_EFFICIENCY : AC_EFFICIENCY;
}

export function outletVoltage(outlet: OutletSpec, car: Car | null): number {
  if (!isDc(outlet.type)) return AC_VOLTAGE;
  const nominal = car?.batteryVoltage || 400;
  const soc = car ? socFraction(car) : 0.5;
  return nominal * (0.86 + 0.14 * soc);
}

export function chargeRequest(car: Car, outlet: OutletSpec): ChargeRequest {
  const soc = socFraction(car);
  if (isDc(outlet.type)) {
    return {
      maxW: Math.min(outlet.maxPowerW, car.maxDcPowerW * dcCurve(soc)),
      phases: 0,
      voltage: outletVoltage(outlet, car),
      dc: true,
    };
  }
  const outletPhases = Math.max(1, outlet.phases);
  const carPhases = Math.max(1, car.acPhases);
  const phases = Math.min(outletPhases, carPhases);
  const carAmps = car.maxAcPowerW / (AC_VOLTAGE * carPhases);
  const outletAmps = outlet.maxPowerW / (AC_VOLTAGE * outletPhases);
  const amps = Math.min(carAmps, outletAmps) * acTaper(soc);
  return {
    maxW: amps * AC_VOLTAGE * phases,
    phases,
    voltage: AC_VOLTAGE,
    dc: false,
  };
}

/** Convert a smart-charging limit to watts for a given outlet and car. */
export function limitToWatts(
  limit: number,
  unit: 'A' | 'W',
  numberPhases: number | undefined,
  outlet: OutletSpec,
  car: Car | null,
): number {
  if (unit === 'W') return limit;
  if (isDc(outlet.type)) return limit * outletVoltage(outlet, car);
  const wired = Math.max(1, outlet.phases);
  const inUse = car ? Math.min(wired, Math.max(1, car.acPhases)) : wired;
  const phases = Math.min(numberPhases ?? 3, inUse);
  return limit * AC_VOLTAGE * phases;
}

export function wattsToLimit(
  watts: number,
  unit: 'A' | 'W',
  outlet: OutletSpec,
  car: Car | null,
): number {
  if (unit === 'W') return watts;
  if (isDc(outlet.type)) return watts / outletVoltage(outlet, car);
  const wired = Math.max(1, outlet.phases);
  const phases = car ? Math.min(wired, Math.max(1, car.acPhases)) : wired;
  return watts / (AC_VOLTAGE * phases);
}

/** Current per phase (AC) or pack current (DC) for a power level. */
export function currentFor(
  powerW: number,
  request: Pick<ChargeRequest, 'phases' | 'voltage' | 'dc'>,
): number {
  if (powerW <= 0 || request.voltage <= 0) return 0;
  return request.dc
    ? powerW / request.voltage
    : powerW / (request.voltage * Math.max(1, request.phases));
}
