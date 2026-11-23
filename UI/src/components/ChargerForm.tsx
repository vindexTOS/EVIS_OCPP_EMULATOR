import {
  ActionIcon,
  Button,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { createCharger, setPower, type ConnectorInput } from '../lib/api';
import { CONNECTOR_INFO, CONNECTOR_ORDER } from '../lib/connectors';
import { useApplyCharger, useBusy } from '../lib/hooks';
import type { Charger, ConnectorType, Side } from '../lib/types';
import { resolveUrl } from '../lib/url';
import { ConnectionFields, type ConnectionValue } from './ConnectionFields';
import { PlugIcon } from './PlugIcon';

interface ConnectorDraft {
  type: ConnectorType;
  kw: number;
  side: Side;
}

const TYPE_OPTIONS = CONNECTOR_ORDER.map((type) => ({
  value: type,
  label: `${CONNECTOR_INFO[type].label} · ${CONNECTOR_INFO[type].current}`,
}));

/** Suggest "CP002" after "CP001". */
function nextIdentity(existing: Charger[]): string {
  const taken = new Set(existing.map((c) => c.chargePointId.toUpperCase()));
  for (let n = existing.length + 1; ; n++) {
    const id = `CP${String(n).padStart(3, '0')}`;
    if (!taken.has(id)) return id;
  }
}

/** The dialog that creates a charger: who it is, where it connects, what it has. */
export function ChargerForm({
  existing,
  onClose,
  onCreated,
}: {
  existing: Charger[];
  onClose: () => void;
  onCreated: (charger: Charger) => void;
}) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const last = existing[existing.length - 1];
  const [name, setName] = useState('');
  const [chargePointId, setChargePointId] = useState(() => nextIdentity(existing));
  const [powerOn, setPowerOn] = useState(true);
  const [connection, setConnection] = useState<ConnectionValue>({
    // The next charger most likely talks to the same backend as the last one.
    csmsUrl: last?.csmsUrl ?? '',
    appendIdToUrl: last?.appendIdToUrl ?? true,
    basicAuthUser: '',
    basicAuthPassword: '',
    tlsVerify: last?.tlsVerify ?? true,
    tlsCaCert: last?.tlsCaCert ?? '',
    tlsClientCert: '',
    tlsClientKey: '',
  });
  const [connectors, setConnectors] = useState<ConnectorDraft[]>([
    { type: 'Type2', kw: 22, side: 'left' },
    { type: 'CCS2', kw: 150, side: 'right' },
  ]);

  const patch = (i: number, change: Partial<ConnectorDraft>) =>
    setConnectors((list) => list.map((c, j) => (j === i ? { ...c, ...change } : c)));

  const idOk = /^[^\s/?#]+$/.test(chargePointId);
  const urlOk = !connection.csmsUrl.trim() || !!resolveUrl(connection.csmsUrl, connection.appendIdToUrl, chargePointId);
  const valid = idOk && urlOk && connectors.length > 0 && connectors.every((c) => c.kw > 0);

  const submit = () =>
    run('create', async () => {
      const body = {
        name: name.trim() || chargePointId,
        chargePointId: chargePointId.trim(),
        ...connection,
        tlsClientKey: connection.tlsClientKey || undefined,
        connectors: connectors.map<ConnectorInput>((c) => ({
          type: c.type,
          maxPowerW: Math.round(c.kw * 1000),
          side: c.side,
        })),
      };
      let charger = await createCharger(body);
      if (powerOn && connection.csmsUrl.trim()) charger = await setPower(charger.id, true);
      apply(charger);
      onCreated(charger);
    });

  return (
    <Modal opened onClose={onClose} title="New charger" size="lg">
      <Stack gap={0}>
        <div className="form-section">
          <div className="form-grid">
            <TextInput
              label="Name"
              description="Only for you, in this emulator"
              placeholder="Lobby charger"
              maxLength={100}
              data-autofocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <TextInput
              label="Charge point ID"
              description="The identity your CSMS knows this charger by"
              maxLength={48}
              required
              error={idOk ? undefined : 'No spaces, "/", "?" or "#"'}
              value={chargePointId}
              onChange={(e) => setChargePointId(e.currentTarget.value)}
              styles={{ input: { fontFamily: 'var(--font-mono)' } }}
            />
          </div>
        </div>

        <div className="form-section">
          <header>
            <h3>Connection</h3>
            <p>Paste the link of your backend. You can change all of this later.</p>
          </header>
          <ConnectionFields
            value={connection}
            onChange={(p) => setConnection((c) => ({ ...c, ...p }))}
            chargePointId={chargePointId}
          />
        </div>

        <div className="form-section">
          <header>
            <h3>Connectors</h3>
            <p>One cable per connector. Types and power can be changed any time.</p>
          </header>
          <div className="conn-lines">
            {connectors.map((c, i) => (
              <div key={i} className="conn-line">
                <div className="n">{i + 1}</div>
                <Select
                  label={i === 0 ? 'Plug type' : undefined}
                  allowDeselect={false}
                  data={TYPE_OPTIONS}
                  value={c.type}
                  leftSection={<PlugIcon type={c.type} size={18} />}
                  onChange={(v) => {
                    if (!v) return;
                    const type = v as ConnectorType;
                    patch(i, { type, kw: CONNECTOR_INFO[type].defaultPowerW / 1000 });
                  }}
                />
                <NumberInput
                  label={i === 0 ? 'Max power' : undefined}
                  suffix=" kW"
                  min={0.1}
                  max={1000}
                  decimalScale={1}
                  value={c.kw}
                  onChange={(v) => patch(i, { kw: Number(v) || 0 })}
                />
                <SegmentedControl
                  size="sm"
                  value={c.side}
                  onChange={(v) => patch(i, { side: v as Side })}
                  data={[
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                  ]}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size={36}
                  disabled={connectors.length === 1}
                  aria-label={`Remove connector ${i + 1}`}
                  onClick={() => setConnectors((list) => list.filter((_, j) => j !== i))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </div>
            ))}
          </div>
          <div>
            <Button
              variant="default"
              size="xs"
              leftSection={<IconPlus size={15} />}
              disabled={connectors.length >= 8}
              onClick={() =>
                setConnectors((list) => [
                  ...list,
                  { type: 'Type2', kw: 22, side: list.length % 2 === 0 ? 'left' : 'right' },
                ])
              }
            >
              Add connector
            </Button>
          </div>
        </div>

        <div className="row between" style={{ paddingTop: 10 }}>
          <Switch
            checked={powerOn}
            onChange={(e) => setPowerOn(e.currentTarget.checked)}
            label="Power on and connect right away"
          />
          <div className="row">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!valid} loading={busy === 'create'} onClick={() => void submit()}>
              Create charger
            </Button>
          </div>
        </div>
      </Stack>
    </Modal>
  );
}
