import {
  Button,
  Modal,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { createCar, deleteCar, updateCar, type CarInput } from '../lib/api';
import { isDc } from '../lib/connectors';
import { useApplyCar, useBusy } from '../lib/hooks';
import type { Car, ConnectorType } from '../lib/types';
import { CarArt } from './CarArt';
import { TypeMultiPicker } from './TypePicker';

const CAR_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#e5e7eb',
  '#64748b',
  '#0f172a',
  '#0ea5e9',
];

interface Draft {
  name: string;
  color: string;
  connectorTypes: ConnectorType[];
  capacityKwh: number;
  soc: number;
  targetSoc: number;
  acKw: number;
  dcKw: number;
  acPhases: string;
  batteryVoltage: string;
}

const PRESETS: { label: string; draft: Partial<Draft> }[] = [
  {
    label: 'Compact hatch',
    draft: { connectorTypes: ['Type2', 'CCS2'], capacityKwh: 58, acKw: 11, dcKw: 120, acPhases: '3', batteryVoltage: '400' },
  },
  {
    label: 'City car',
    draft: { connectorTypes: ['Type2'], capacityKwh: 36, acKw: 7.4, dcKw: 50, acPhases: '1', batteryVoltage: '400' },
  },
  {
    label: 'Long-range SUV',
    draft: { connectorTypes: ['Type2', 'CCS2'], capacityKwh: 82, acKw: 22, dcKw: 250, acPhases: '3', batteryVoltage: '800' },
  },
  {
    label: 'CHAdeMO classic',
    draft: { connectorTypes: ['Type1', 'CHAdeMO'], capacityKwh: 40, acKw: 6.6, dcKw: 50, acPhases: '1', batteryVoltage: '400' },
  },
  {
    label: 'NACS sedan',
    draft: { connectorTypes: ['NACS'], capacityKwh: 75, acKw: 11, dcKw: 250, acPhases: '1', batteryVoltage: '400' },
  },
];

const draftOf = (car: Car | null): Draft =>
  car
    ? {
        name: car.name,
        color: car.color,
        connectorTypes: car.connectorTypes,
        capacityKwh: car.batteryCapacityWh / 1000,
        soc: Math.round(car.soc),
        targetSoc: car.targetSoc,
        acKw: car.maxAcPowerW / 1000,
        dcKw: car.maxDcPowerW / 1000,
        acPhases: String(car.acPhases),
        batteryVoltage: String(car.batteryVoltage >= 600 ? 800 : 400),
      }
    : {
        name: '',
        color: CAR_COLORS[0],
        connectorTypes: ['Type2', 'CCS2'],
        capacityKwh: 58,
        soc: 20,
        targetSoc: 100,
        acKw: 11,
        dcKw: 120,
        acPhases: '3',
        batteryVoltage: '400',
      };

/** Create or edit a car: its looks, its charge port and its battery. */
export function CarForm({ car, onClose }: { car: Car | null; onClose: () => void }) {
  const applyCar = useApplyCar();
  const { busy, run } = useBusy();
  const [d, setD] = useState<Draft>(() => draftOf(car));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const hasDc = d.connectorTypes.some(isDc);
  const valid = d.name.trim().length > 0 && d.connectorTypes.length > 0 && d.capacityKwh > 0;

  const save = () =>
    run('save', async () => {
      const body: CarInput = {
        name: d.name.trim(),
        color: d.color,
        connectorTypes: d.connectorTypes,
        batteryCapacityWh: Math.round(d.capacityKwh * 1000),
        batteryWh: Math.round(d.capacityKwh * 10 * d.soc),
        targetSoc: d.targetSoc,
        maxAcPowerW: Math.round(d.acKw * 1000),
        maxDcPowerW: Math.round(d.dcKw * 1000),
        acPhases: Number(d.acPhases),
        batteryVoltage: Number(d.batteryVoltage),
      };
      applyCar(car ? await updateCar(car.id, body) : await createCar(body));
      onClose();
    });

  return (
    <Modal opened onClose={onClose} title={car ? `Edit ${car.name}` : 'New car'} size="lg">
      <Stack gap={0}>
        <div className="form-section">
          <div className="row" style={{ gap: 18, alignItems: 'center' }}>
            <CarArt color={d.color} soc={d.soc} width={170} />
            <Stack gap="xs" style={{ flex: 1 }}>
              <TextInput
                label="Name"
                placeholder="Blue hatch"
                maxLength={60}
                data-autofocus
                value={d.name}
                onChange={(e) => set('name', e.currentTarget.value)}
              />
              <div className="swatches">
                {CAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch${d.color === c ? ' selected' : ''}`}
                    style={{ ['--c' as string]: c }}
                    aria-label={`Colour ${c}`}
                    onClick={() => set('color', c)}
                  />
                ))}
              </div>
            </Stack>
          </div>
          {!car && (
            <div className="row wrap" style={{ gap: 6 }}>
              <Text size="xs" c="dimmed">
                Start from:
              </Text>
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="compact-xs"
                  variant="default"
                  onClick={() => setD((prev) => ({ ...prev, ...p.draft, name: prev.name || p.label }))}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="form-section">
          <header>
            <h3>Charge port</h3>
            <p>The plugs that fit this car. A CCS port also takes the AC plug it is built around.</p>
          </header>
          <TypeMultiPicker value={d.connectorTypes} onChange={(v) => set('connectorTypes', v)} />
        </div>

        <div className="form-section">
          <header>
            <h3>Battery</h3>
          </header>
          <div className="form-grid">
            <NumberInput
              label="Capacity"
              suffix=" kWh"
              min={1}
              max={1000}
              decimalScale={1}
              value={d.capacityKwh}
              onChange={(v) => set('capacityKwh', Number(v) || 0)}
            />
            <NumberInput
              label="Charge to"
              description="The car stops drawing power here"
              suffix=" %"
              min={1}
              max={100}
              value={d.targetSoc}
              onChange={(v) => set('targetSoc', Math.min(100, Math.max(1, Number(v) || 100)))}
            />
            <div className="wide">
              <Text size="sm" fw={500}>
                Charge level now: {d.soc}%
              </Text>
              <Slider
                mt={6}
                mb={4}
                min={0}
                max={100}
                value={d.soc}
                onChange={(v) => set('soc', v)}
                label={(v) => `${v}%`}
                marks={[{ value: 20 }, { value: 50 }, { value: 80 }]}
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <header>
            <h3>How fast it charges</h3>
          </header>
          <div className="form-grid">
            <NumberInput
              label="AC: on-board charger"
              suffix=" kW"
              min={0.5}
              max={1000}
              decimalScale={1}
              value={d.acKw}
              onChange={(v) => set('acKw', Number(v) || 0)}
            />
            <div>
              <Text size="sm" fw={500} mb={3}>
                AC phases
              </Text>
              <SegmentedControl
                fullWidth
                value={d.acPhases}
                onChange={(v) => set('acPhases', v)}
                data={[
                  { value: '1', label: 'Single phase' },
                  { value: '3', label: 'Three phase' },
                ]}
              />
            </div>
            {hasDc && (
              <>
                <NumberInput
                  label="DC: peak fast-charging power"
                  suffix=" kW"
                  min={0.5}
                  max={1000}
                  decimalScale={1}
                  value={d.dcKw}
                  onChange={(v) => set('dcKw', Number(v) || 0)}
                />
                <div>
                  <Text size="sm" fw={500} mb={3}>
                    Battery voltage
                  </Text>
                  <SegmentedControl
                    fullWidth
                    value={d.batteryVoltage}
                    onChange={(v) => set('batteryVoltage', v)}
                    data={[
                      { value: '400', label: '400 V' },
                      { value: '800', label: '800 V' },
                    ]}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="row between" style={{ paddingTop: 8 }}>
          {car ? (
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={busy === 'delete'}
              onClick={() =>
                run('delete', async () => {
                  await deleteCar(car.id);
                  onClose();
                })
              }
            >
              Delete car
            </Button>
          ) : (
            <span />
          )}
          <div className="row">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!valid} loading={busy === 'save'} onClick={() => void save()}>
              {car ? 'Save car' : 'Create car'}
            </Button>
          </div>
        </div>
      </Stack>
    </Modal>
  );
}
