import { IconCheck } from '@tabler/icons-react';
import { CONNECTOR_INFO, CONNECTOR_ORDER, IMPLIED_TYPES } from '../lib/connectors';
import type { ConnectorType } from '../lib/types';
import { PlugIcon } from './PlugIcon';

function Tile({
  type,
  selected,
  onClick,
}: {
  type: ConnectorType;
  selected: boolean;
  onClick: () => void;
}) {
  const info = CONNECTOR_INFO[type];
  return (
    <button
      type="button"
      className={`type-tile${selected ? ' selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      title={info.hint}
    >
      {selected && (
        <span className="type-tile-check">
          <IconCheck size={11} stroke={3.4} />
        </span>
      )}
      <PlugIcon type={type} size={30} />
      <span className="type-tile-name">{info.short}</span>
      <span className={`type-tile-kind ${info.current.toLowerCase()}`}>{info.current}</span>
    </button>
  );
}

/** Pick the one plug a charger connector has. */
export function TypePicker({
  value,
  onChange,
}: {
  value: ConnectorType;
  onChange: (type: ConnectorType) => void;
}) {
  return (
    <div className="type-grid">
      {CONNECTOR_ORDER.map((type) => (
        <Tile key={type} type={type} selected={value === type} onClick={() => onChange(type)} />
      ))}
    </div>
  );
}

/**
 * Pick the plugs that fit a car. A combo inlet (CCS) is built around an AC
 * inlet, so choosing it also selects the AC plug it takes.
 */
export function TypeMultiPicker({
  value,
  onChange,
}: {
  value: ConnectorType[];
  onChange: (types: ConnectorType[]) => void;
}) {
  const toggle = (type: ConnectorType) => {
    if (value.includes(type)) {
      onChange(value.filter((t) => t !== type));
      return;
    }
    const implied = IMPLIED_TYPES[type];
    const next = [...value, type];
    if (implied && !next.includes(implied)) next.push(implied);
    onChange(CONNECTOR_ORDER.filter((t) => next.includes(t)));
  };
  return (
    <div className="type-grid">
      {CONNECTOR_ORDER.map((type) => (
        <Tile key={type} type={type} selected={value.includes(type)} onClick={() => toggle(type)} />
      ))}
    </div>
  );
}
