import { ActionIcon, Button, Loader, Slider, Tooltip } from '@mantine/core';
import { IconCar, IconPencil, IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { CarArt } from '../components/CarArt';
import { CarForm } from '../components/CarForm';
import { IdTagForm } from '../components/IdTagForm';
import { PlugIcon } from '../components/PlugIcon';
import { setCarBattery } from '../lib/api';
import { CONNECTOR_INFO, isDc } from '../lib/connectors';
import { fmtEnergy, fmtPower } from '../lib/format';
import { useApplyCar } from '../lib/hooks';
import { toastError, useCars, useIdTags } from '../lib/queries';
import type { Car, IdTag } from '../lib/types';

function CarTile({ car, onEdit }: { car: Car; onEdit: () => void }) {
  const applyCar = useApplyCar();
  // While the slider is held it shows the hand's value; otherwise the battery's own.
  const [held, setHeld] = useState<number | null>(null);
  const level = held ?? Math.round(car.soc);
  const hasDc = car.connectorTypes.some(isDc);

  return (
    <div className="card card-pad garage-tile">
      <div className="row between">
        <div style={{ minWidth: 0 }}>
          <div className="garage-tile-name truncate">{car.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {car.pluggedInto
              ? `Plugged into ${car.pluggedInto.chargePointName}, connector ${car.pluggedInto.connectorId}`
              : 'In the garage'}
          </div>
        </div>
        <Tooltip label="Edit">
          <ActionIcon variant="default" aria-label={`Edit ${car.name}`} onClick={onEdit}>
            <IconPencil size={15} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div style={{ display: 'grid', placeItems: 'center', padding: '6px 0 2px' }}>
        <CarArt color={car.color} soc={level} width={210} plugged={!!car.pluggedInto} />
      </div>
      <div>
        <div className="row between" style={{ fontSize: 13 }}>
          <span>
            Battery <b>{level}%</b>
          </span>
          <span className="dim">
            {fmtEnergy((car.batteryCapacityWh * level) / 100)} of {fmtEnergy(car.batteryCapacityWh)}
          </span>
        </div>
        <Slider
          mt={6}
          min={0}
          max={100}
          value={level}
          label={(v) => `${v}%`}
          onChange={setHeld}
          onChangeEnd={(v) => {
            setCarBattery(car.id, v)
              .then(applyCar)
              .catch(toastError)
              .finally(() => setHeld(null));
          }}
        />
      </div>
      <dl className="kv" style={{ fontSize: 12.5 }}>
        <dt>Charge port</dt>
        <dd>
          <span className="row wrap" style={{ gap: 6 }}>
            {car.connectorTypes.map((t) => (
              <span key={t} className="chip">
                <PlugIcon type={t} size={14} />
                {CONNECTOR_INFO[t].short}
              </span>
            ))}
          </span>
        </dd>
        <dt>AC charging</dt>
        <dd>
          {fmtPower(car.maxAcPowerW)} · {car.acPhases === 1 ? 'single phase' : 'three phase'}
        </dd>
        {hasDc && (
          <>
            <dt>DC charging</dt>
            <dd>
              up to {fmtPower(car.maxDcPowerW)} · {car.batteryVoltage} V battery
            </dd>
          </>
        )}
        <dt>Charges to</dt>
        <dd>{Math.round(car.targetSoc)}%</dd>
      </dl>
    </div>
  );
}

/** Every car and every RFID card, with room to set them up properly. */
export function GaragePage() {
  const cars = useCars();
  const tags = useIdTags();
  const [carForm, setCarForm] = useState<Car | null | 'new'>(null);
  const [tagForm, setTagForm] = useState<IdTag | null | 'new'>(null);

  if (cars.isLoading) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <Loader />
      </div>
    );
  }
  const list = cars.data ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Garage</h1>
          <p>The cars you plug into chargers, and the RFID cards you tap on them.</p>
        </div>
        <Button leftSection={<IconPlus size={17} />} onClick={() => setCarForm('new')}>
          New car
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="card empty">
          <span className="empty-icon">
            <IconCar size={26} />
          </span>
          <strong>No car yet</strong>
          <span>Create a car, choose its charge port and battery, then drag it to a charger.</span>
          <Button mt={6} leftSection={<IconPlus size={17} />} onClick={() => setCarForm('new')}>
            Create a car
          </Button>
        </div>
      ) : (
        <div className="garage-grid">
          {list.map((car) => (
            <CarTile key={car.id} car={car} onEdit={() => setCarForm(car)} />
          ))}
        </div>
      )}

      <div className="page-head" style={{ marginTop: 34 }}>
        <div>
          <h1 style={{ fontSize: 19 }}>RFID cards</h1>
          <p>Each card is an idTag. Tap one on a charger to start or stop a transaction.</p>
        </div>
        <Button variant="default" leftSection={<IconPlus size={17} />} onClick={() => setTagForm('new')}>
          New card
        </Button>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        {(tags.data ?? []).map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="rfid-card"
            style={{ ['--card' as string]: tag.color, border: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer', width: 168, height: 100 }}
            onClick={() => setTagForm(tag)}
          >
            <div className="rfid-card-top">
              <span className="truncate">{tag.label}</span>
            </div>
            <div className="rfid-card-id truncate">{tag.idTag}</div>
          </button>
        ))}
        {(tags.data ?? []).length === 0 && (
          <span className="muted" style={{ fontSize: 13.5 }}>
            No card yet. Without one, a charger uses its default idTag.
          </span>
        )}
      </div>

      {carForm && <CarForm car={carForm === 'new' ? null : carForm} onClose={() => setCarForm(null)} />}
      {tagForm && <IdTagForm tag={tagForm === 'new' ? null : tagForm} onClose={() => setTagForm(null)} />}
    </div>
  );
}
