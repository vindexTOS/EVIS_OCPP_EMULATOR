import { Button, Popover, Select, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconCreditCard, IconNfc, IconWifi, IconWifiOff } from '@tabler/icons-react';
import { useState } from 'react';
import { useDropZone } from '../dnd/dragContext';
import { emergencyStop } from '../lib/api';
import { STATUS_META } from '../lib/connectors';
import { fmtClock, fmtKw, fmtKwhFixed as fmtKwh } from '../lib/format';
import { cls, tapAndTell, useApplyCharger, useBusy } from '../lib/hooks';
import { useNow } from '../lib/stores';
import type { Charger, Connector, IdTag } from '../lib/types';

/** What the light bar on top of the charger shows. */
function led(charger: Charger): { tone: string; pulse: boolean } {
  if (!charger.poweredOn) return { tone: 'off', pulse: false };
  if (charger.state === 'Rebooting') return { tone: 'warn', pulse: true };
  if (charger.emergency || charger.connectors.some((c) => c.status === 'Faulted')) {
    return { tone: 'crit', pulse: charger.emergency };
  }
  if (charger.connectors.some((c) => c.status === 'Charging')) return { tone: 'energy', pulse: false };
  if (charger.state === 'Accepted') return { tone: 'ok', pulse: false };
  return { tone: 'warn', pulse: true };
}

const NET_LABEL: Record<Charger['state'], string> = {
  Off: '',
  Offline: 'Offline',
  Connecting: 'Connecting',
  Booting: 'Starting',
  Pending: 'Waiting for backend',
  Rejected: 'Refused by backend',
  Accepted: 'Online',
  Rebooting: '',
};

/** The line a real charger would show its user for one connector. */
function message(c: Connector, now: number): { big: string; sub: string; alert?: boolean } {
  const s = c.session;
  if (c.authorizing) return { big: 'Checking card…', sub: 'One moment' };
  switch (c.status) {
    case 'Charging':
      return {
        big: `${fmtKw(c.telemetry.powerW)} kW`,
        sub: `${fmtKwh(s?.energyWh ?? 0)} kWh · ${fmtClock((now - new Date(s?.startedAt ?? now).getTime()) / 1000)}`,
      };
    case 'SuspendedEV':
      return { big: 'Paused by the car', sub: `${fmtKwh(s?.energyWh ?? 0)} kWh so far` };
    case 'SuspendedEVSE':
      return { big: 'Paused by the charger', sub: `${fmtKwh(s?.energyWh ?? 0)} kWh so far` };
    case 'Preparing':
      return c.carId != null
        ? { big: 'Tap your card', sub: 'to start charging' }
        : { big: 'Plug in your car', sub: 'Card accepted' };
    case 'Finishing':
      return { big: 'Charging complete', sub: 'Unplug the cable' };
    case 'Reserved':
      return { big: 'Reserved', sub: c.reservation ? `for ${c.reservation.idTag}` : '' };
    case 'Unavailable':
      return { big: 'Out of service', sub: 'Please use another charger' };
    case 'Faulted':
      return { big: 'Out of order', sub: c.errorCode, alert: true };
    default:
      return { big: 'Ready', sub: 'Plug in your car or tap a card' };
  }
}

function Screen({ charger }: { charger: Charger }) {
  const now = useNow();
  if (!charger.poweredOn) return <div className="screen off" />;
  if (charger.state === 'Rebooting') {
    return (
      <div className="screen">
        <div className="screen-main">
          <div className="screen-big">Restarting…</div>
          <div className="screen-sub">Firmware {charger.firmwareVersion}</div>
        </div>
      </div>
    );
  }
  if (charger.emergency) {
    return (
      <div className="screen alert">
        <div className="screen-main">
          <div className="screen-big">Emergency stop</div>
          <div className="screen-sub">Release the red button to continue</div>
        </div>
      </div>
    );
  }

  const online = charger.state === 'Accepted';
  const top = (
    <div className="screen-top">
      <span>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span className={cls('net', !online && 'bad')}>
        {online ? <IconWifi size={12} /> : <IconWifiOff size={12} />}
        {NET_LABEL[charger.state]}
      </span>
    </div>
  );

  if (charger.maintenance) {
    return (
      <div className="screen">
        {top}
        <div className="screen-main">
          <div className="screen-big">Updating firmware</div>
          <div className="screen-sub">{charger.firmwareStatus}</div>
        </div>
      </div>
    );
  }

  if (charger.connectors.length === 1) {
    const m = message(charger.connectors[0], now);
    return (
      <div className={cls('screen', m.alert && 'alert')}>
        {top}
        <div className="screen-main">
          <div className="screen-big">{m.big}</div>
          <div className="screen-sub">{m.sub}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {top}
      <div className="screen-main">
        {charger.connectors.slice(0, 4).map((c) => {
          const m = message(c, now);
          const active = c.status === 'Charging';
          return (
            <div key={c.id} className={`screen-row tone-${STATUS_META[c.status].tone}`}>
              <b>{c.connectorId}</b>
              <span>{active ? `${fmtKwh(c.session?.energyWh ?? 0)} kWh` : m.big}</span>
              <em>{active ? `${fmtKw(c.telemetry.powerW)} kW` : ''}</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RfidReader({ charger, tags }: { charger: Charger; tags: IdTag[] }) {
  const [opened, setOpened] = useState(false);
  const [custom, setCustom] = useState('');
  const [target, setTarget] = useState('auto');
  const { busy, run } = useBusy();
  const live = charger.poweredOn && charger.state !== 'Rebooting';
  const wants =
    live &&
    charger.connectors.some(
      (c) => c.status === 'Preparing' && c.carId != null && !c.pending && !c.authorizing,
    );

  const tap = (idTag: string) =>
    run('tap', async () => {
      setOpened(false);
      await tapAndTell(charger.id, idTag, target === 'auto' ? undefined : Number(target));
    });

  const drop = useDropZone(`rfid:${charger.id}`, {
    accepts: (item) =>
      item.kind !== 'card' ? null : live ? { ok: true } : { ok: false, reason: 'The charger is off' },
    onDrop: (item) => {
      if (item.kind === 'card') void tap(item.idTag);
    },
  });

  return (
    <Popover opened={opened} onChange={setOpened} position="right-start" width={290} trapFocus>
      <Popover.Target>
        <button
          type="button"
          className={cls(
            'rfid',
            wants && 'wants',
            drop.state.active && drop.state.ok && 'drop-ok',
            drop.state.over && 'drop-over',
          )}
          disabled={!live}
          onClick={() => setOpened((o) => !o)}
          {...drop.props}
        >
          <span className="rfid-pad">
            <IconNfc size={21} stroke={1.7} />
          </span>
          <span>
            <strong>{drop.state.active && drop.state.ok ? 'Drop the card here' : 'Card reader'}</strong>
            {busy === 'tap' ? 'Reading…' : wants ? 'Waiting for a card' : 'Tap or drop a card'}
          </span>
        </button>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <Stack gap="xs">
          <Text size="sm" fw={620}>
            Tap a card
          </Text>
          {charger.connectors.length > 1 && (
            <Select
              size="xs"
              label="On connector"
              allowDeselect={false}
              value={target}
              onChange={(v) => v && setTarget(v)}
              data={[
                { value: 'auto', label: 'Let the charger decide' },
                ...charger.connectors.map((c) => ({
                  value: String(c.connectorId),
                  label: `Connector ${c.connectorId}`,
                })),
              ]}
            />
          )}
          {tags.length === 0 && !charger.defaultIdTag && (
            <Text size="xs" c="dimmed">
              No cards yet. Create one in the garage below, or type an idTag.
            </Text>
          )}
          {charger.defaultIdTag && (
            <UnstyledButton className="rail-item" onClick={() => void tap(charger.defaultIdTag)}>
              <Text size="sm" fw={600}>
                Default idTag
              </Text>
              <Text size="xs" c="dimmed" className="mono">
                {charger.defaultIdTag}
              </Text>
            </UnstyledButton>
          )}
          {tags.map((t) => (
            <UnstyledButton key={t.id} className="rail-item" onClick={() => void tap(t.idTag)}>
              <div className="row" style={{ gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color }} />
                <Text size="sm" fw={600}>
                  {t.label}
                </Text>
              </div>
              <Text size="xs" c="dimmed" className="mono">
                {t.idTag}
              </Text>
            </UnstyledButton>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) void tap(custom.trim());
            }}
          >
            <div className="row" style={{ alignItems: 'flex-end', gap: 6 }}>
              <TextInput
                size="xs"
                label="Another idTag"
                placeholder="04A2B91C"
                maxLength={20}
                style={{ flex: 1 }}
                value={custom}
                onChange={(e) => setCustom(e.currentTarget.value)}
              />
              <Button size="xs" type="submit" leftSection={<IconCreditCard size={14} />} disabled={!custom.trim()}>
                Tap
              </Button>
            </div>
          </form>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** The charging post itself. */
export function ChargerBody({
  charger,
  tags,
  portTops,
}: {
  charger: Charger;
  tags: IdTag[];
  /** Height of each socket, measured so a cable leaves level with its plug. */
  portTops: Record<number, number>;
}) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const live = charger.poweredOn && charger.state !== 'Rebooting';
  const light = led(charger);
  const totalWh = charger.connectors.reduce((sum, c) => sum + c.meterWh, 0);
  const sides = {
    left: charger.connectors.filter((c) => c.side === 'left'),
    right: charger.connectors.filter((c) => c.side === 'right'),
  };

  return (
    <div className={cls('charger', `led-${light.tone}`, light.pulse && 'led-pulse')}>
      <div className="charger-cap">
        <div className="charger-led" />
      </div>
      <div className="charger-body">
        {(['left', 'right'] as const).map((side) =>
          sides[side].map((c, i) => (
            <div
              key={c.id}
              className={`port ${side} tone-${STATUS_META[c.status].tone}`}
              style={{
                top: portTops[c.connectorId] ?? `${((i + 0.5) / sides[side].length) * 100}%`,
              }}
              data-anchor={`port:${c.connectorId}`}
            >
              <span>{c.connectorId}</span>
            </div>
          )),
        )}
        <div className="charger-glass">
          <div className="charger-brand">
            <span>{charger.vendor.toUpperCase()}</span>
            <span>{charger.model}</span>
          </div>
          <Screen charger={charger} />
          <RfidReader charger={charger} tags={tags} />
        </div>
        <div className="charger-controls">
          <div className="charger-meter" title="Energy meter: everything this charger has delivered">
            <label>kWh</label>
            <span>{(totalWh / 1000).toFixed(1).padStart(7, '0')}</span>
          </div>
          <Tooltip label={charger.emergency ? 'Release the emergency stop' : 'Emergency stop'}>
            <button
              type="button"
              className={cls('estop', charger.emergency && 'pressed')}
              disabled={!live || busy === 'estop'}
              aria-label="Emergency stop"
              aria-pressed={charger.emergency}
              onClick={() =>
                run('estop', async () => apply(await emergencyStop(charger.id, !charger.emergency)))
              }
            />
          </Tooltip>
        </div>
        <div className="charger-spacer" />
        <div className="charger-plate">
          <b>{charger.chargePointId}</b>
          {charger.model} · firmware {charger.firmwareVersion}
        </div>
        <div className="charger-vents" />
      </div>
      <div className="charger-foot" />
    </div>
  );
}
