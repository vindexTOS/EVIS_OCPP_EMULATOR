import { Button, Loader } from '@mantine/core';
import { IconChargingPile, IconPlus } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChargerForm } from '../components/ChargerForm';
import { StatePill } from '../components/Pills';
import { STATUS_META } from '../lib/connectors';
import { useCars, useChargers, useIdTags } from '../lib/queries';
import type { Charger } from '../lib/types';
import { ChargerView } from './ChargerView';

function RailItem({ charger, active }: { charger: Charger; active: boolean }) {
  return (
    <Link to={`/chargers/${charger.id}`} className={`rail-item${active ? ' active' : ''}`}>
      <div className="rail-item-top">
        <span className="rail-item-name truncate">{charger.name}</span>
        <StatePill state={charger.state} />
      </div>
      <div className="rail-item-id mono truncate">{charger.chargePointId}</div>
      <div className="rail-item-dots">
        {charger.connectors.map((c) => (
          <span key={c.id} className={`dot-chip tone-${STATUS_META[c.status].tone}`} title={`Connector ${c.connectorId}: ${c.status}`}>
            <i />
            {c.connectorId} · {STATUS_META[c.status].label}
          </span>
        ))}
      </div>
    </Link>
  );
}

/** The main page: the list of chargers on the left, the chosen one on the right. */
export function StationPage() {
  const { id, tab } = useParams();
  const navigate = useNavigate();
  const chargers = useChargers();
  const cars = useCars();
  const tags = useIdTags();
  const [creating, setCreating] = useState(false);

  const list = chargers.data ?? [];
  const selected = list.find((c) => String(c.id) === id) ?? null;

  // "/" and links to chargers that are gone lead to the first charger.
  useEffect(() => {
    if (!chargers.data) return;
    if (!selected && chargers.data.length > 0) {
      navigate(`/chargers/${chargers.data[0].id}`, { replace: true });
    } else if (!selected && id) {
      navigate('/', { replace: true });
    }
  }, [chargers.data, selected, id, navigate]);

  if (chargers.isLoading) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <Loader />
      </div>
    );
  }

  const form = creating && (
    <ChargerForm
      existing={list}
      onClose={() => setCreating(false)}
      onCreated={(charger) => {
        setCreating(false);
        navigate(`/chargers/${charger.id}`);
      }}
    />
  );

  if (list.length === 0) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <span className="empty-icon">
          <IconChargingPile size={28} />
        </span>
        <strong>No charger yet</strong>
        <span style={{ maxWidth: 420 }}>
          Create a charger, give it the link of your CSMS, and it connects like a real one. Then
          drag a car to it and start a transaction.
        </span>
        <Button mt={6} leftSection={<IconPlus size={17} />} onClick={() => setCreating(true)}>
          Create your first charger
        </Button>
        {form}
      </div>
    );
  }

  return (
    <div className="station">
      <aside className="rail">
        <div className="rail-head">
          <span className="section-label">Chargers</span>
          <Button size="compact-sm" variant="light" leftSection={<IconPlus size={15} />} onClick={() => setCreating(true)}>
            New
          </Button>
        </div>
        {list.map((c) => (
          <RailItem key={c.id} charger={c} active={c.id === selected?.id} />
        ))}
      </aside>
      <main className="station-main">
        {selected && (
          <ChargerView
            key={selected.id}
            charger={selected}
            cars={cars.data ?? []}
            tags={tags.data ?? []}
            tab={tab ?? 'station'}
          />
        )}
      </main>
      {form}
    </div>
  );
}
