// Builds the sampledValue list of MeterValues / StopTransaction.transactionData
// from one reading of a connector's meter.

export interface SampledValue {
  value: string;
  context?: string;
  format?: string;
  measurand?: string;
  phase?: string;
  location?: string;
  unit?: string;
}

export interface MeterReading {
  /** Lifetime register of the outlet, Wh. */
  energyWh: number;
  /** Energy since the previous reading, Wh. */
  intervalWh: number;
  powerW: number;
  /** Per phase on AC, pack current on DC. */
  currentA: number;
  voltageV: number;
  offeredW: number;
  offeredA: number;
  /** AC phases in use; 0 means DC. */
  phases: number;
  soc: number | null;
  temperatureC: number;
  frequencyHz: number;
}

export type ReadingContext =
  | 'Sample.Periodic'
  | 'Sample.Clock'
  | 'Transaction.Begin'
  | 'Transaction.End'
  | 'Trigger'
  | 'Interruption.Begin'
  | 'Interruption.End'
  | 'Other';

const PHASE_SUFFIX = /\.(L[123](?:-N|-L[123])?|N)$/;
const fix = (n: number, digits: number) => n.toFixed(digits);

/**
 * One sampledValue per requested measurand, in the requested order.
 * With `perPhase` an AC outlet reports current and voltage for each phase,
 * otherwise a single unphased value.
 */
export function buildSampledValues(
  measurands: string[],
  reading: MeterReading,
  context: ReadingContext,
  perPhase: boolean,
): SampledValue[] {
  const out: SampledValue[] = [];
  const base = { context, format: 'Raw' };
  const add = (
    measurand: string,
    value: string,
    unit: string,
    location = 'Outlet',
    phase?: string,
  ) =>
    out.push({
      value,
      ...base,
      measurand,
      ...(phase ? { phase } : {}),
      location,
      unit,
    });

  const phaseNames = ['L1', 'L2', 'L3'].slice(0, Math.max(0, reading.phases));

  for (const requested of measurands) {
    const suffix = PHASE_SUFFIX.exec(requested)?.[1];
    const measurand = requested.replace(PHASE_SUFFIX, '');
    switch (measurand) {
      case 'Energy.Active.Import.Register':
        add(measurand, fix(reading.energyWh, 0), 'Wh');
        break;
      case 'Energy.Active.Import.Interval':
        add(measurand, fix(reading.intervalWh, 0), 'Wh');
        break;
      case 'Power.Active.Import':
        add(measurand, fix(reading.powerW, 0), 'W');
        break;
      case 'Power.Offered':
        add(measurand, fix(reading.offeredW, 0), 'W');
        break;
      case 'Power.Factor':
        add(measurand, reading.powerW > 0 ? '0.99' : '1.00', '');
        // Power.Factor has no unit of measure in OCPP 1.6.
        delete out[out.length - 1].unit;
        break;
      case 'Current.Import':
        if (suffix) {
          const active = phaseNames.includes(suffix) || reading.phases === 0;
          add(
            measurand,
            fix(active ? reading.currentA : 0, 1),
            'A',
            'Outlet',
            suffix,
          );
        } else if (perPhase && phaseNames.length > 0) {
          for (const p of phaseNames)
            add(measurand, fix(reading.currentA, 1), 'A', 'Outlet', p);
        } else {
          add(measurand, fix(reading.currentA, 1), 'A');
        }
        break;
      case 'Current.Offered':
        add(measurand, fix(reading.offeredA, 1), 'A');
        break;
      case 'Voltage':
        if (suffix) {
          add(measurand, fix(reading.voltageV, 1), 'V', 'Outlet', suffix);
        } else if (perPhase && phaseNames.length > 0) {
          for (const p of phaseNames) {
            add(measurand, fix(reading.voltageV, 1), 'V', 'Outlet', `${p}-N`);
          }
        } else {
          add(measurand, fix(reading.voltageV, 1), 'V');
        }
        break;
      case 'Frequency':
        add(measurand, fix(reading.frequencyHz, 2), 'Hertz');
        // Hertz is not in the 1.6 unit list; real chargers send the measurand bare.
        delete out[out.length - 1].unit;
        break;
      case 'SoC':
        // A charger only knows the battery level when the car tells it.
        if (reading.soc !== null)
          add(measurand, fix(reading.soc, 0), 'Percent', 'EV');
        break;
      case 'Temperature':
        add(measurand, fix(reading.temperatureC, 1), 'Celsius', 'Body');
        break;
      default:
        break;
    }
  }
  return out;
}
