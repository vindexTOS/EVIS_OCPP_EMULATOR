import { Button, Modal, NumberInput, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TypePicker } from '../components/TypePicker';
import { addConnector } from '../lib/api';
import { CONNECTOR_INFO, STATUS_META, defaultPhases, isDc } from '../lib/connectors';
import { useApplyCharger, useBusy } from '../lib/hooks';
import type { Car, Charger, ConnectorType, IdTag, Side } from '../lib/types';
import { Bay } from './Bay';
import { ChargerBody } from './ChargerBody';

interface Cable {
  connectorId: number;
  d: string;
  end: { x: number; y: number };
  plugged: boolean;
  charging: boolean;
  tone: string;
}

const half = (n: number) => Math.round(n * 2) / 2;

/** A cable hanging between the charger's socket and wherever its plug is. */
function cablePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  side: Side,
  plugged: boolean,
): string {
  const dir = side === 'left' ? -1 : 1;
  const span = Math.abs(to.x - from.x);
  const reach = Math.max(10, span * 0.42);
  const sag = plugged ? Math.min(54, 16 + span * 0.2) : 12;
  return (
    `M ${half(from.x)} ${half(from.y)} ` +
    `C ${half(from.x + dir * reach)} ${half(from.y + sag)}, ` +
    `${half(to.x - dir * reach)} ${half(to.y + sag)}, ` +
    `${half(to.x)} ${half(to.y)}`
  );
}

/** The picture: bays left and right of the charger, cables in between. */
export function Scene({ charger, cars, tags }: { charger: Charger; cars: Car[]; tags: IdTag[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cables, setCables] = useState<Cable[]>([]);
  // Height of each socket on the charger, so a cable leaves level with its plug.
  const [portTops, setPortTops] = useState<Record<number, number>>({});
  const [adding, setAdding] = useState<Side | null>(null);
  const left = charger.connectors.filter((c) => c.side === 'left');
  const right = charger.connectors.filter((c) => c.side === 'right');

  const measure = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const at = (name: string) => {
      const el = root.querySelector<HTMLElement>(`[data-anchor="${name}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    };
    const body = root.querySelector<HTMLElement>('.charger-body')?.getBoundingClientRect();
    const next: Cable[] = [];
    const tops: Record<number, number> = {};
    for (const c of charger.connectors) {
      const from = at(`port:${c.connectorId}`);
      const car = at(`car:${c.connectorId}`);
      const to = car ?? at(`rest:${c.connectorId}`);
      if (!from || !to) continue;
      if (body) {
        const top = to.y - (body.top - box.top);
        tops[c.connectorId] = Math.round(Math.min(body.height - 30, Math.max(30, top)));
      }
      next.push({
        connectorId: c.connectorId,
        d: cablePath(from, to, c.side, !!car),
        end: { x: half(to.x), y: half(to.y) },
        plugged: !!car,
        charging: c.status === 'Charging',
        tone: STATUS_META[c.status].tone,
      });
    }
    setCables((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setPortTops((prev) => (JSON.stringify(prev) === JSON.stringify(tops) ? prev : tops));
  }, [charger.connectors]);

  // Positions depend on layout, so measure after every render...
  useLayoutEffect(measure);
  // ...and whenever the scene changes size.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  const fewer: Side = left.length <= right.length ? 'left' : 'right';
  const canAdd = charger.connectors.length < 8;
  const emptySide = (side: Side) => (
    <button type="button" className="add-bay tall" onClick={() => setAdding(side)}>
      <IconPlus size={18} />
      Add a connector on this side
    </button>
  );

  return (
    <div className="scene">
      <div className="scene-bar">
        <span>
          Drag a car into a bay to plug it in. Drag it back out to unplug. Drop a card on the reader
          to start.
        </span>
        {canAdd && (
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<IconPlus size={14} />}
            onClick={() => setAdding(fewer)}
          >
            Add connector
          </Button>
        )}
      </div>
      <div className="scene-scroll">
        <div ref={ref} style={{ position: 'relative' }}>
          <svg className="cables" aria-hidden="true">
            {cables.map((cable) => (
              <g key={cable.connectorId} className={`tone-${cable.tone}`}>
                <path className="cable-path" d={cable.d} />
                <path className="cable-edge" d={cable.d} />
                {cable.charging && <path className="cable-flow" d={cable.d} />}
                {cable.plugged && (
                  <circle className="cable-plug" cx={cable.end.x} cy={cable.end.y} r={6.5} />
                )}
              </g>
            ))}
          </svg>
          <div className="scene-grid">
            <div className="bays left">
              {left.map((c) => (
                <Bay key={c.id} charger={charger} connector={c} cars={cars} tags={tags} />
              ))}
              {left.length === 0 && canAdd && emptySide('left')}
            </div>
            <ChargerBody charger={charger} tags={tags} portTops={portTops} />
            <div className="bays right">
              {right.map((c) => (
                <Bay key={c.id} charger={charger} connector={c} cars={cars} tags={tags} />
              ))}
              {right.length === 0 && canAdd && emptySide('right')}
            </div>
          </div>
        </div>
      </div>
      <div className="scene-floor" />
      {adding && <AddConnector charger={charger} side={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function AddConnector({ charger, side, onClose }: { charger: Charger; side: Side; onClose: () => void }) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const [type, setType] = useState<ConnectorType>('Type2');
  const [kw, setKw] = useState(CONNECTOR_INFO.Type2.defaultPowerW / 1000);
  const [where, setWhere] = useState<Side>(side);

  return (
    <Modal opened onClose={onClose} title={`Add connector ${charger.connectors.length + 1}`} size="md">
      <Stack>
        <div>
          <Text size="sm" fw={500} mb={6}>
            Plug type
          </Text>
          <TypePicker
            value={type}
            onChange={(next) => {
              setType(next);
              setKw(CONNECTOR_INFO[next].defaultPowerW / 1000);
            }}
          />
        </div>
        <div className="form-grid">
          <NumberInput
            label="Max power"
            suffix=" kW"
            min={0.1}
            max={1000}
            decimalScale={1}
            value={kw}
            onChange={(v) => setKw(Number(v) || 0)}
          />
          <div>
            <Text size="sm" fw={500} mb={3}>
              Side of the charger
            </Text>
            <SegmentedControl
              fullWidth
              value={where}
              onChange={(v) => setWhere(v as Side)}
              data={[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </div>
        </div>
        <Button
          loading={busy === 'add'}
          onClick={async () => {
            const maxPowerW = Math.round(kw * 1000);
            const ok = await run('add', async () =>
              apply(
                await addConnector(charger.id, {
                  type,
                  maxPowerW,
                  side: where,
                  phases: isDc(type) ? undefined : defaultPhases(type, maxPowerW),
                }),
              ),
            );
            if (ok) onClose();
          }}
        >
          Add connector
        </Button>
      </Stack>
    </Modal>
  );
}
