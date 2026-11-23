import { ActionIcon } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { CarArt } from '../components/CarArt';
import { CarForm } from '../components/CarForm';
import { IdTagForm } from '../components/IdTagForm';
import { PlugIcon } from '../components/PlugIcon';
import { useDraggable, useDropZone } from '../dnd/dragContext';
import { unplugCar } from '../lib/api';
import { cls } from '../lib/hooks';
import { toastError } from '../lib/queries';
import type { Car, IdTag } from '../lib/types';

function CarCard({ car, onEdit }: { car: Car; onEdit: () => void }) {
  const parked = !!car.pluggedInto;
  const { onPointerDown, dragging } = useDraggable({
    item: parked ? null : { kind: 'car', car },
    preview: () => <CarArt color={car.color} soc={car.soc} width={170} />,
  });
  return (
    <div
      className={cls('car-card', parked && 'parked', dragging && 'dragging')}
      onPointerDown={onPointerDown}
      title={parked ? `Plugged into ${car.pluggedInto!.chargePointName}` : 'Drag onto a bay to plug in'}
    >
      <ActionIcon
        className="edit"
        size="sm"
        variant="default"
        aria-label={`Edit ${car.name}`}
        onClick={onEdit}
      >
        <IconPencil size={13} />
      </ActionIcon>
      <div className="car-card-top">
        <span className="car-card-name truncate">{car.name}</span>
      </div>
      <CarArt color={car.color} soc={car.soc} width={128} />
      <div className="car-card-foot">
        <span className="car-card-plugs">
          {car.connectorTypes.map((t) => (
            <PlugIcon key={t} type={t} size={16} />
          ))}
        </span>
        <span className="car-card-soc">
          {parked ? `at #${car.pluggedInto!.connectorId} · ` : ''}
          {Math.round(car.soc)}%
        </span>
      </div>
    </div>
  );
}

function CardChip({ tag, onEdit }: { tag: IdTag; onEdit: () => void }) {
  const { onPointerDown, dragging } = useDraggable({
    item: { kind: 'card', idTag: tag.idTag, label: tag.label, color: tag.color },
    preview: () => (
      <div className="rfid-card" style={{ ['--card' as string]: tag.color }}>
        <div className="rfid-card-top">{tag.label}</div>
        <div className="rfid-card-id">{tag.idTag}</div>
      </div>
    ),
  });
  return (
    <div
      className={cls('rfid-card', dragging && 'dragging')}
      style={{ ['--card' as string]: tag.color }}
      onPointerDown={onPointerDown}
      title="Drag onto the card reader, or onto a bay"
    >
      <div className="rfid-card-top">
        <span className="truncate">{tag.label}</span>
      </div>
      <div className="rfid-card-id truncate">{tag.idTag}</div>
      <ActionIcon
        className="edit"
        size="sm"
        variant="white"
        color="dark"
        aria-label={`Edit ${tag.label}`}
        onClick={onEdit}
      >
        <IconPencil size={13} />
      </ActionIcon>
    </div>
  );
}

/** Where the cars and the RFID cards wait until they are dragged to a charger. */
export function GarageDock({ cars, tags }: { cars: Car[]; tags: IdTag[] }) {
  const [carForm, setCarForm] = useState<Car | null | 'new'>(null);
  const [tagForm, setTagForm] = useState<IdTag | null | 'new'>(null);

  // Dropping a parked car back on the garage unplugs it.
  const drop = useDropZone('garage', {
    accepts: (item) => (item.kind === 'car' && item.from ? { ok: true } : null),
    onDrop: (item) => {
      if (item.kind === 'car' && item.from) {
        unplugCar(item.from.chargerId, item.from.connectorId).catch(toastError);
      }
    },
  });

  return (
    <div className={cls('garage', drop.state.active && 'drop-ok')} {...drop.props}>
      <div className="garage-group">
        <div className="garage-head">
          <span>Garage</span>
          <small>
            {drop.state.active
              ? 'Drop here to unplug'
              : cars.length === 0
                ? 'Create a car, then drag it onto a bay'
                : 'Drag a car onto a bay'}
          </small>
        </div>
        <div className="garage-list">
          {cars.map((car) => (
            <CarCard key={car.id} car={car} onEdit={() => setCarForm(car)} />
          ))}
          <button type="button" className="new-tile" onClick={() => setCarForm('new')}>
            <IconPlus size={18} />
            New car
          </button>
        </div>
      </div>

      <div className="garage-group">
        <div className="garage-head">
          <span>RFID cards</span>
          <small>Drag onto the reader</small>
        </div>
        <div className="garage-list">
          {tags.map((tag) => (
            <CardChip key={tag.id} tag={tag} onEdit={() => setTagForm(tag)} />
          ))}
          <button type="button" className="new-tile small" onClick={() => setTagForm('new')}>
            <IconPlus size={18} />
            New card
          </button>
        </div>
      </div>

      {carForm && <CarForm car={carForm === 'new' ? null : carForm} onClose={() => setCarForm(null)} />}
      {tagForm && <IdTagForm tag={tagForm === 'new' ? null : tagForm} onClose={() => setTagForm(null)} />}
    </div>
  );
}
