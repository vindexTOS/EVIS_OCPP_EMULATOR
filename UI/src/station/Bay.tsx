import {
  ActionIcon,
  Button,
  Menu,
  Modal,
  NumberInput,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconBolt,
  IconChevronDown,
  IconClockHour4,
  IconCreditCard,
  IconDots,
  IconInfoCircle,
  IconLock,
  IconParking,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlugConnected,
  IconPlugConnectedX,
  IconTool,
  IconTrash,
} from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { CarArt } from '../components/CarArt';
import { CAR_PORT } from '../components/carPort';
import { StatusPill } from '../components/Pills';
import { PlugIcon } from '../components/PlugIcon';
import { TypePicker } from '../components/TypePicker';
import { useDraggable, useDropZone } from '../dnd/dragContext';
import {
  clearFault,
  plugCar,
  removeLastConnector,
  setAvailability,
  setFault,
  setPaused,
  stopCharging,
  unplugCar,
  updateConnector,
} from '../lib/api';
import { CONNECTOR_INFO, STATUS_META, defaultPhases, fits, isDc } from '../lib/connectors';
import { fmtClock, fmtEnergy, fmtKw, fmtKwhFixed, fmtPower, fmtTime, secondsUntil } from '../lib/format';
import { cls, tapAndTell, useApplyCharger, useBusy } from '../lib/hooks';
import { useNow } from '../lib/stores';
import {
  ERROR_CODES,
  type Car,
  type Charger,
  type Connector,
  type ConnectorType,
  type IdTag,
  type Side,
} from '../lib/types';

interface BayProps {
  charger: Charger;
  connector: Connector;
  cars: Car[];
  tags: IdTag[];
}

/** One parking bay: the connector, the car plugged into it, and what is happening. */
export function Bay({ charger, connector, cars, tags }: BayProps) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const now = useNow();
  const [faultOpen, setFaultOpen] = useState(false);
  const [customTag, setCustomTag] = useState<string | null>(null);

  const id = connector.connectorId;
  const car = cars.find((c) => c.id === connector.carId) ?? null;
  const session = connector.session;
  const live = charger.poweredOn && charger.state !== 'Rebooting';
  const info = CONNECTOR_INFO[connector.type];
  const usable =
    live &&
    connector.errorCode === 'NoError' &&
    connector.availability === 'Operative' &&
    !charger.maintenance;

  const doPlug = (carToPlug: Car, from?: { chargerId: number; connectorId: number }) =>
    run('plug', async () => {
      if (from) await unplugCar(from.chargerId, from.connectorId);
      apply(await plugCar(charger.id, id, carToPlug.id));
    });
  const doUnplug = () => run('unplug', async () => apply(await unplugCar(charger.id, id)));
  const tap = (idTag: string) => run('tap', () => tapAndTell(charger.id, idTag, id));

  const drop = useDropZone(`bay:${charger.id}:${id}`, {
    accepts: (item) => {
      if (item.kind === 'card') {
        return live ? { ok: true } : { ok: false, reason: 'The charger is off' };
      }
      if (connector.carId === item.car.id) return { ok: true };
      if (connector.carId != null) return { ok: false, reason: 'This bay is taken' };
      if (!fits(item.car, connector.type)) {
        return { ok: false, reason: `${info.short} does not fit ${item.car.name}` };
      }
      return { ok: true };
    },
    onDrop: (item) => {
      if (item.kind === 'card') void tap(item.idTag);
      else if (connector.carId !== item.car.id) void doPlug(item.car, item.from);
    },
  });

  const startDisabledReason = !live
    ? 'The charger is off'
    : connector.errorCode !== 'NoError'
      ? 'The connector is faulted'
      : !usable
        ? 'The connector is out of service'
        : null;

  // --- The one or two things worth saying about this bay right now ---
  const notes: { tone: string; icon: ReactNode; body: ReactNode; action?: ReactNode }[] = [];
  if (connector.errorCode !== 'NoError') {
    notes.push({
      tone: 'crit',
      icon: <IconAlertTriangle size={15} />,
      body: (
        <>
          <b>{connector.errorCode}</b>
          {connector.errorInfo ? ` · ${connector.errorInfo}` : ''}
        </>
      ),
      action: (
        <Button
          size="compact-xs"
          variant="white"
          color="dark"
          loading={busy === 'clear'}
          onClick={() => run('clear', async () => apply(await clearFault(charger.id, id)))}
        >
          Clear
        </Button>
      ),
    });
  } else if (charger.maintenance) {
    notes.push({ tone: 'off', icon: <IconTool size={15} />, body: 'Out of service while firmware installs.' });
  } else if (connector.availability === 'Inoperative') {
    notes.push({
      tone: 'off',
      icon: <IconTool size={15} />,
      body: 'Out of service.',
      action: (
        <Button
          size="compact-xs"
          variant="default"
          loading={busy === 'avail'}
          onClick={() => run('avail', () => setAvailability(charger.id, id, 'Operative'))}
        >
          Put in service
        </Button>
      ),
    });
  }
  if (connector.authorizing) {
    notes.push({
      tone: 'info',
      icon: <IconCreditCard size={15} />,
      body: (
        <>
          Checking card <span className="mono">{connector.authorizing}</span> with the CSMS…
        </>
      ),
    });
  }
  if (connector.pending) {
    notes.push({
      tone: 'warn',
      icon: <IconClockHour4 size={15} />,
      body: (
        <>
          Card <span className="mono">{connector.pending.idTag}</span> accepted. Plug in within{' '}
          <b>{secondsUntil(connector.pending.until, now)} s</b>.
        </>
      ),
      action: (
        <Button
          size="compact-xs"
          variant="default"
          loading={busy === 'stop'}
          onClick={() => run('stop', async () => apply(await stopCharging(charger.id, id)))}
        >
          Cancel
        </Button>
      ),
    });
  }
  if (connector.reservation && !session) {
    notes.push({
      tone: 'violet',
      icon: <IconLock size={15} />,
      body: (
        <>
          Reserved for <span className="mono">{connector.reservation.idTag}</span> until{' '}
          {fmtTime(connector.reservation.expiryDate)}.
        </>
      ),
    });
  }
  if (session?.deauthorized) {
    notes.push({
      tone: 'crit',
      icon: <IconAlertTriangle size={15} />,
      body: 'The CSMS rejected this idTag. Energy is cut off.',
    });
  } else if (session && connector.telemetry.limitW != null && connector.telemetry.limitW < connector.maxPowerW) {
    notes.push({
      tone: 'info',
      icon: <IconInfoCircle size={15} />,
      body: (
        <>
          Limited to <b>{fmtPower(connector.telemetry.limitW)}</b> by {connector.telemetry.limitSource}.
        </>
      ),
    });
  } else if (session && (connector.status === 'SuspendedEV' || connector.status === 'SuspendedEVSE')) {
    notes.push({
      tone: 'info',
      icon: <IconInfoCircle size={15} />,
      body: `${STATUS_META[connector.status].hint}.`,
    });
  }
  if (connector.scheduledAvailability === 'Inoperative') {
    notes.push({
      tone: 'off',
      icon: <IconTool size={15} />,
      body: 'Goes out of service when this transaction ends.',
    });
  }
  if (!session && car && connector.status === 'Finishing') {
    notes.push({
      tone: 'info',
      icon: <IconInfoCircle size={15} />,
      body: 'Transaction ended. Unplug to free the connector, or start again.',
    });
  }

  const unplugged = cars.filter((c) => !c.pluggedInto);

  return (
    <div
      className={cls(
        'bay',
        drop.state.active && (drop.state.ok ? 'drop-ok' : 'drop-no'),
        drop.state.over && 'drop-over',
      )}
      {...drop.props}
    >
      <div className="bay-head">
        <ConnectorChip charger={charger} connector={connector} />
        <div className="row" style={{ gap: 6 }}>
          <StatusPill status={connector.status} />
          <Menu position="bottom-end" width={230}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label={`Connector ${id} actions`}>
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Connector {id}</Menu.Label>
              {session && (
                <>
                  <Menu.Item
                    leftSection={<IconCreditCard size={15} />}
                    onClick={() => void tap(session.idTag)}
                  >
                    Stop by tapping card {session.idTag}
                  </Menu.Item>
                  <Menu.Item
                    onClick={() =>
                      run('pause', async () =>
                        apply(await setPaused(charger.id, id, 'ev', !connector.evPaused)),
                      )
                    }
                  >
                    {connector.evPaused ? 'Car resumes charging' : 'Car pauses charging'}
                  </Menu.Item>
                  <Menu.Item
                    onClick={() =>
                      run('pause', async () =>
                        apply(await setPaused(charger.id, id, 'evse', !connector.evsePaused)),
                      )
                    }
                  >
                    {connector.evsePaused ? 'Charger resumes charging' : 'Charger pauses charging'}
                  </Menu.Item>
                  <Menu.Divider />
                </>
              )}
              <Menu.Item leftSection={<IconAlertTriangle size={15} />} onClick={() => setFaultOpen(true)}>
                Report a fault…
              </Menu.Item>
              <Menu.Item
                leftSection={<IconTool size={15} />}
                onClick={() =>
                  run('avail', () =>
                    setAvailability(
                      charger.id,
                      id,
                      connector.availability === 'Operative' ? 'Inoperative' : 'Operative',
                    ),
                  )
                }
              >
                {connector.availability === 'Operative' ? 'Take out of service' : 'Put back in service'}
              </Menu.Item>
              <Menu.Divider />
              <Tooltip
                label="Connector numbers must stay 1…n, so only the last one can be removed"
                disabled={id === charger.connectors.length && charger.connectors.length > 1}
              >
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={15} />}
                  disabled={id !== charger.connectors.length || charger.connectors.length === 1}
                  onClick={() => run('remove', async () => apply(await removeLastConnector(charger.id)))}
                >
                  Remove connector
                </Menu.Item>
              </Tooltip>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      <div className="bay-stage">
        {car ? (
          <ParkedCar
            car={car}
            charger={charger}
            connector={connector}
            onUnplug={() => void doUnplug()}
          />
        ) : (
          <>
            <div className={cls('slot', drop.state.active && !drop.state.ok && 'reason')}>
              {drop.state.active ? (
                drop.state.ok ? (
                  <strong>Drop to plug in</strong>
                ) : (
                  <strong>{drop.state.reason}</strong>
                )
              ) : (
                <>
                  <IconParking size={22} stroke={1.6} />
                  <strong>Drag a car here</strong>
                  <span>to plug in the {info.short} cable</span>
                </>
              )}
            </div>
            <div
              className={`holster tone-${STATUS_META[connector.status].tone}`}
              data-anchor={`rest:${id}`}
              title={`${info.label} plug`}
            >
              <PlugIcon type={connector.type} size={21} />
            </div>
          </>
        )}
      </div>

      {session && (
        <div className="readout">
          <div>
            <label>Power</label>
            <b>
              {fmtKw(connector.telemetry.powerW)}
              <small>kW</small>
            </b>
          </div>
          <div>
            <label>Energy</label>
            <b>
              {fmtKwhFixed(session.energyWh)}
              <small>kWh</small>
            </b>
          </div>
          <div>
            <label>Time</label>
            <b>{fmtClock((now - new Date(session.startedAt).getTime()) / 1000)}</b>
          </div>
        </div>
      )}

      <div className="bay-meta">
        {session ? (
          <>
            <span>{Math.round(connector.telemetry.voltageV)} V</span>
            <span className="sep">·</span>
            <span>
              {connector.telemetry.currentA.toFixed(1)} A
              {connector.telemetry.phases > 1 ? ` × ${connector.telemetry.phases}` : ''}
            </span>
            <span className="sep">·</span>
            <span title={session.startConfirmed ? 'Transaction id from the CSMS' : 'Waiting for StartTransaction.conf'}>
              {session.transactionId != null ? `Tx ${session.transactionId}` : 'Tx pending'}
            </span>
            <span className="sep">·</span>
            <span className="mono">{session.idTag}</span>
          </>
        ) : car ? (
          <>
            <span>
              {fmtEnergy(car.batteryWh)} of {fmtEnergy(car.batteryCapacityWh)}
            </span>
            {car.targetSoc < 100 && (
              <>
                <span className="sep">·</span>
                <span>charges to {Math.round(car.targetSoc)}%</span>
              </>
            )}
          </>
        ) : (
          <span>Meter {fmtEnergy(connector.meterWh)} delivered in total</span>
        )}
      </div>

      {notes.slice(0, 2).map((note, i) => (
        <div key={i} className={`bay-note tone-${note.tone}`}>
          {note.icon}
          <div className="grow">{note.body}</div>
          {note.action}
        </div>
      ))}

      <div className="bay-actions">
        {session ? (
          <>
            <Button
              className="grow"
              color="red"
              variant="light"
              leftSection={<IconPlayerStopFilled size={15} />}
              loading={busy === 'stop'}
              onClick={() => run('stop', async () => apply(await stopCharging(charger.id, id)))}
            >
              Stop charging
            </Button>
            <Button
              variant="default"
              leftSection={<IconPlugConnectedX size={16} />}
              loading={busy === 'unplug'}
              onClick={() => void doUnplug()}
            >
              Unplug
            </Button>
          </>
        ) : car ? (
          <>
            <Button.Group className="grow">
              <Tooltip label={startDisabledReason} disabled={!startDisabledReason}>
                <Button
                  className="grow"
                  style={{ flex: 1 }}
                  leftSection={<IconPlayerPlayFilled size={15} />}
                  loading={busy === 'tap' || !!connector.authorizing}
                  disabled={!!startDisabledReason || !!connector.pending}
                  onClick={() =>
                    charger.defaultIdTag ? void tap(charger.defaultIdTag) : setCustomTag('')
                  }
                >
                  Start charging
                </Button>
              </Tooltip>
              <Menu position="bottom-end" width={240}>
                <Menu.Target>
                  <Button
                    px={9}
                    disabled={!!startDisabledReason || !!connector.pending || !!connector.authorizing}
                    aria-label="Start with another card"
                    style={{ borderLeft: '1px solid rgba(0,0,0,0.18)' }}
                  >
                    <IconChevronDown size={16} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>Tap a card to start</Menu.Label>
                  {charger.defaultIdTag && (
                    <Menu.Item leftSection={<IconBolt size={15} />} onClick={() => void tap(charger.defaultIdTag)}>
                      Default idTag
                      <Text span size="xs" c="dimmed" ml={6} className="mono">
                        {charger.defaultIdTag}
                      </Text>
                    </Menu.Item>
                  )}
                  {tags.map((t) => (
                    <Menu.Item
                      key={t.id}
                      leftSection={<span className="dot-chip" style={{ padding: 0, width: 10, height: 10, borderRadius: 3, background: t.color }} />}
                      onClick={() => void tap(t.idTag)}
                    >
                      {t.label}
                      <Text span size="xs" c="dimmed" ml={6} className="mono">
                        {t.idTag}
                      </Text>
                    </Menu.Item>
                  ))}
                  <Menu.Divider />
                  <Menu.Item leftSection={<IconCreditCard size={15} />} onClick={() => setCustomTag('')}>
                    Another idTag…
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Button.Group>
            <Button
              variant="default"
              leftSection={<IconPlugConnectedX size={16} />}
              loading={busy === 'unplug'}
              onClick={() => void doUnplug()}
            >
              Unplug
            </Button>
          </>
        ) : (
          <Menu position="bottom-start" width={260}>
            <Menu.Target>
              <Button
                className="grow"
                variant="default"
                leftSection={<IconPlugConnected size={16} />}
                rightSection={<IconChevronDown size={15} />}
                loading={busy === 'plug'}
              >
                Plug in a car
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Cars in the garage</Menu.Label>
              {unplugged.length === 0 && <Menu.Item disabled>No free car. Create one below.</Menu.Item>}
              {unplugged.map((c) => {
                const ok = fits(c, connector.type);
                return (
                  <Menu.Item
                    key={c.id}
                    disabled={!ok}
                    leftSection={<span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, display: 'block' }} />}
                    rightSection={<Text size="xs" c="dimmed">{Math.round(c.soc)}%</Text>}
                    onClick={() => void doPlug(c)}
                  >
                    {c.name}
                    {!ok && (
                      <Text span size="xs" c="dimmed" ml={6}>
                        no {info.short} port
                      </Text>
                    )}
                  </Menu.Item>
                );
              })}
            </Menu.Dropdown>
          </Menu>
        )}
      </div>

      <FaultModal
        opened={faultOpen}
        onClose={() => setFaultOpen(false)}
        charger={charger}
        connectorId={id}
      />
      <Modal opened={customTag !== null} onClose={() => setCustomTag(null)} title="Tap a card" size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = (customTag ?? '').trim();
            if (!value) return;
            setCustomTag(null);
            void tap(value);
          }}
        >
          <Stack>
            <TextInput
              label="idTag"
              description="What the card would send, up to 20 characters"
              placeholder="04A2B91C"
              maxLength={20}
              data-autofocus
              value={customTag ?? ''}
              onChange={(e) => setCustomTag(e.currentTarget.value)}
            />
            <Button type="submit" leftSection={<IconCreditCard size={16} />}>
              Tap on connector {id}
            </Button>
          </Stack>
        </form>
      </Modal>
    </div>
  );
}

/** The car standing in a bay. Drag it out to unplug it. */
function ParkedCar({
  car,
  charger,
  connector,
  onUnplug,
}: {
  car: Car;
  charger: Charger;
  connector: Connector;
  onUnplug: () => void;
}) {
  const mirrored = connector.side === 'right';
  const charging = connector.status === 'Charging';
  const { onPointerDown, dragging } = useDraggable({
    item: { kind: 'car', car, from: { chargerId: charger.id, connectorId: connector.connectorId } },
    preview: () => <CarArt color={car.color} soc={car.soc} width={170} mirrored={mirrored} />,
    onDropOutside: onUnplug,
  });
  return (
    <div
      className={cls('bay-car', dragging && 'dragging')}
      onPointerDown={onPointerDown}
      title="Drag the car out of the bay to unplug it"
    >
      <div className="car-tag">
        {car.name}
        <span>{Math.round(car.soc)}%</span>
      </div>
      <div className="car-wrap">
        <CarArt
          color={car.color}
          soc={car.soc}
          charging={charging}
          plugged
          mirrored={mirrored}
          width={228}
        />
        <i
          className="car-anchor"
          data-anchor={`car:${connector.connectorId}`}
          style={{
            left: `${(mirrored ? 1 - CAR_PORT.x : CAR_PORT.x) * 100}%`,
            top: `${CAR_PORT.y * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

/** The connector's name plate. Click it to change the plug type, power or side. */
function ConnectorChip({ charger, connector }: { charger: Charger; connector: Connector }) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const [opened, setOpened] = useState(false);
  const [type, setType] = useState<ConnectorType>(connector.type);
  const [kw, setKw] = useState<number>(connector.maxPowerW / 1000);
  const [phases, setPhases] = useState(String(connector.phases));
  const [side, setSide] = useState<Side>(connector.side);
  const info = CONNECTOR_INFO[connector.type];
  const occupied = connector.carId != null || !!connector.session;

  const open = () => {
    setType(connector.type);
    setKw(connector.maxPowerW / 1000);
    setPhases(String(connector.phases));
    setSide(connector.side);
    setOpened(true);
  };

  const pickType = (next: ConnectorType) => {
    setType(next);
    // A different plug usually means a different power class.
    const power = CONNECTOR_INFO[next].defaultPowerW;
    setKw(power / 1000);
    setPhases(String(defaultPhases(next, power)));
  };

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" width={420} trapFocus>
      <Popover.Target>
        <button type="button" className="connector-chip" onClick={() => (opened ? setOpened(false) : open())}>
          <span className="num">{connector.connectorId}</span>
          <PlugIcon type={connector.type} size={18} />
          {info.short}
          <span className="kw">{fmtPower(connector.maxPowerW)}</span>
          <IconChevronDown size={14} className="caret" />
        </button>
      </Popover.Target>
      <Popover.Dropdown p="md">
        <Stack gap="sm">
          <div>
            <Text size="sm" fw={620}>
              Connector {connector.connectorId}
            </Text>
            <Text size="xs" c="dimmed">
              {occupied
                ? 'Unplug the car to change the plug type.'
                : 'Choose the plug on the end of this cable.'}
            </Text>
          </div>
          <div style={occupied ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
            <TypePicker value={type} onChange={pickType} />
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
                value={side}
                onChange={(v) => setSide(v as Side)}
                data={[
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </div>
            {!isDc(type) && CONNECTOR_INFO[type].maxPhases === 3 && (
              <div className="wide">
                <Text size="sm" fw={500} mb={3}>
                  Phases
                </Text>
                <SegmentedControl
                  fullWidth
                  value={phases}
                  onChange={setPhases}
                  data={[
                    { value: '1', label: 'Single phase' },
                    { value: '3', label: 'Three phase' },
                  ]}
                />
              </div>
            )}
          </div>
          <Button
            loading={busy === 'save'}
            onClick={async () => {
              const ok = await run('save', async () =>
                apply(
                  await updateConnector(charger.id, connector.connectorId, {
                    ...(occupied ? {} : { type }),
                    maxPowerW: Math.round(kw * 1000),
                    phases: isDc(type) || CONNECTOR_INFO[type].maxPhases === 1 ? undefined : Number(phases),
                    side,
                  }),
                ),
              );
              if (ok) setOpened(false);
            }}
          >
            Save connector
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function FaultModal({
  opened,
  onClose,
  charger,
  connectorId,
}: {
  opened: boolean;
  onClose: () => void;
  charger: Charger;
  connectorId: number;
}) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const [errorCode, setErrorCode] = useState<string>('GroundFailure');
  const [info, setInfo] = useState('');
  const [vendorErrorCode, setVendorErrorCode] = useState('');
  const [fatal, setFatal] = useState(true);

  return (
    <Modal opened={opened} onClose={onClose} title={`Report a fault on connector ${connectorId}`} size="md">
      <Stack>
        <Select
          label="Error code"
          description="ChargePointErrorCode sent in StatusNotification"
          data={[...ERROR_CODES]}
          value={errorCode}
          onChange={(v) => v && setErrorCode(v)}
          searchable
          allowDeselect={false}
        />
        <div className="form-grid">
          <TextInput
            label="Info"
            placeholder="optional"
            maxLength={50}
            value={info}
            onChange={(e) => setInfo(e.currentTarget.value)}
          />
          <TextInput
            label="Vendor error code"
            placeholder="optional"
            maxLength={50}
            value={vendorErrorCode}
            onChange={(e) => setVendorErrorCode(e.currentTarget.value)}
          />
        </div>
        <Switch
          checked={fatal}
          onChange={(e) => setFatal(e.currentTarget.checked)}
          label="The connector stops working"
          description={
            fatal
              ? 'Status becomes Faulted and a running transaction ends.'
              : 'Only a warning: the error code is reported once with the current status.'
          }
        />
        <Button
          color={fatal ? 'red' : 'yellow'}
          loading={busy === 'fault'}
          onClick={async () => {
            const ok = await run('fault', async () =>
              apply(
                await setFault(charger.id, connectorId, {
                  errorCode,
                  info: info || undefined,
                  vendorErrorCode: vendorErrorCode || undefined,
                  fatal,
                }),
              ),
            );
            if (ok) onClose();
          }}
        >
          {fatal ? 'Fault the connector' : 'Send the warning'}
        </Button>
      </Stack>
    </Modal>
  );
}
