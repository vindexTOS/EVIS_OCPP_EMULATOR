import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Menu,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconAdjustments,
  IconChevronDown,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlugConnectedX,
  IconPlus,
  IconSend,
  IconTerminal2,
  IconTrash,
} from '@tabler/icons-react';
import { useState } from 'react';
import { ChargePointForm } from '../components/ChargePointForm';
import { CommandModal } from '../components/CommandModal';
import { OcppLogPanel } from '../components/OcppLogPanel';
import {
  connectChargePoint,
  deleteChargePoint,
  disconnectChargePoint,
  forceConnectorStatus,
  getCommandTemplates,
  listCars,
  listChargePoints,
  ocppCall,
  simulateReject,
  startCharging,
  stopCharging,
} from '../lib/api';
import { fmtEnergy, fmtPower } from '../lib/format';
import { useTick } from '../lib/live';
import type { Car, ChargePoint, Connector, ConnectorStatus } from '../lib/types';

const STATUS_COLOR: Record<string, string> = {
  Online: 'green',
  Connecting: 'yellow',
  Offline: 'gray',
  Faulted: 'red',
};
const CONN_COLOR: Record<string, string> = {
  Available: 'gray',
  Preparing: 'blue',
  Charging: 'green',
  SuspendedEVSE: 'yellow',
  SuspendedEV: 'yellow',
  Finishing: 'cyan',
  Reserved: 'violet',
  Unavailable: 'dark',
  Faulted: 'red',
};

// Statuses a user can force from the connector menu.
const FORCEABLE_STATUSES: ConnectorStatus[] = [
  'Available',
  'Preparing',
  'SuspendedEVSE',
  'SuspendedEV',
  'Finishing',
  'Reserved',
  'Unavailable',
  'Faulted',
];

function ConnectorRow({
  cp,
  connector,
  cars,
}: {
  cp: ChargePoint;
  connector: Connector;
  cars: Car[];
}) {
  const qc = useQueryClient();
  const tick = useTick(cp.id, connector.connectorId);
  const [carId, setCarId] = useState<string | null>(null);
  const charging = connector.status === 'Charging';

  const start = useMutation({
    mutationFn: () => startCharging(cp.id, connector.connectorId, carId ?? undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charge-points'] }),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      notifications.show({
        color: 'red',
        message: e.response?.data?.message ?? 'Could not start charging',
      }),
  });
  const stop = useMutation({
    mutationFn: () => stopCharging(cp.id, connector.connectorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charge-points'] }),
  });
  const [statusOpen, statusHandlers] = useDisclosure(false);
  const [pendingStatus, setPendingStatus] = useState<ConnectorStatus>('Available');
  const [statusPayload, setStatusPayload] = useState('{}');

  const force = useMutation({
    mutationFn: (vars: { status: ConnectorStatus; payload: Record<string, unknown> }) =>
      forceConnectorStatus(cp.id, connector.connectorId, vars.status, vars.payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['charge-points'] });
      statusHandlers.close();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      notifications.show({
        color: 'red',
        message: e.response?.data?.message ?? 'Could not set status',
      }),
  });

  const openForce = (status: ConnectorStatus) => {
    setPendingStatus(status);
    setStatusPayload(
      JSON.stringify(
        {
          connectorId: connector.connectorId,
          errorCode: status === 'Faulted' ? 'OtherError' : 'NoError',
          status,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    statusHandlers.open();
  };

  const compatible = cars.filter((c) => c.connectorTypes.includes(connector.type));

  return (
    <Card withBorder radius="md" padding="sm">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={600}>#{connector.connectorId}</Text>
          <Badge variant="light">{connector.type}</Badge>
          <Badge color={CONN_COLOR[connector.status] ?? 'gray'} variant="dot">
            {connector.status}
          </Badge>
        </Group>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {fmtPower(connector.maxPowerW)} max · {fmtEnergy(connector.totalEnergyWh)} lifetime
          </Text>
          {cp.online && (
            <Menu shadow="md" position="bottom-end" withinPortal>
              <Menu.Target>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  rightSection={<IconChevronDown size={12} />}
                  loading={force.isPending}
                >
                  Force status
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Report connector status</Menu.Label>
                {FORCEABLE_STATUSES.map((s) => (
                  <Menu.Item key={s} onClick={() => openForce(s)}>
                    {s}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      {charging ? (
        <Stack gap={6}>
          <Progress value={tick?.soc ?? 0} color="green" animated />
          <Group justify="space-between">
            <Text size="sm">
              {Math.round(tick?.soc ?? 0)}% · {fmtPower(tick?.powerW ?? 0)} ·{' '}
              {fmtEnergy(tick?.energyDeliveredWh ?? 0)} delivered
            </Text>
            <Button
              size="compact-sm"
              color="red"
              variant="light"
              loading={stop.isPending}
              onClick={() => stop.mutate()}
            >
              Stop
            </Button>
          </Group>
        </Stack>
      ) : cp.online ? (
        <Group>
          <Select
            placeholder={compatible.length ? 'Select a car' : 'No compatible car'}
            data={compatible.map((c) => ({ value: c.id, label: c.name }))}
            value={carId}
            onChange={setCarId}
            size="sm"
            style={{ flex: 1 }}
            disabled={!compatible.length}
          />
          <Button
            size="sm"
            leftSection={<IconPlayerPlay size={16} />}
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            Start
          </Button>
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          Connect the charge point to start charging.
        </Text>
      )}

      <CommandModal
        opened={statusOpen}
        onClose={statusHandlers.close}
        title={`StatusNotification · connector #${connector.connectorId}`}
        action="StatusNotification"
        payload={statusPayload}
        onPayloadChange={setStatusPayload}
        loading={force.isPending}
        onSend={(_action, payload) =>
          force.mutate({ status: pendingStatus, payload })
        }
      />
    </Card>
  );
}

// CP→CSMS commands offered in the Send menu (payloads come from live templates).
const SEND_COMMANDS = [
  'Heartbeat',
  'BootNotification',
  'Authorize',
  'StatusNotification',
  'MeterValues',
  'StopTransaction',
  'DataTransfer',
  'FirmwareStatusNotification',
  'DiagnosticsStatusNotification',
];

function ChargePointCard({ cp, cars }: { cp: ChargePoint; cars: Car[] }) {
  const qc = useQueryClient();
  const [opened, handlers] = useDisclosure(false);
  const [logsOpen, logsHandlers] = useDisclosure(false);
  const [cmdOpen, cmdHandlers] = useDisclosure(false);
  const [cmdAction, setCmdAction] = useState('Heartbeat');
  const [cmdPayload, setCmdPayload] = useState('{}');
  const [cmdEditable, setCmdEditable] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['charge-points'] });

  const connect = useMutation({ mutationFn: () => connectChargePoint(cp.id), onSuccess: invalidate });
  const disconnect = useMutation({ mutationFn: () => disconnectChargePoint(cp.id), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => deleteChargePoint(cp.id), onSuccess: invalidate });

  const command = useMutation({
    mutationFn: (cmd: { action: string; payload: Record<string, unknown> }) =>
      ocppCall(cp.id, cmd.action, cmd.payload),
    onSuccess: (data: { action: string; result: unknown }) => {
      cmdHandlers.close();
      notifications.show({
        color: 'teal',
        message: `${data.action} → ${JSON.stringify(data.result)}`,
      });
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      notifications.show({
        color: 'red',
        message: e.response?.data?.message ?? 'Command failed',
      }),
  });
  const reject = useMutation({
    mutationFn: (body: { boot?: boolean; authorize?: boolean }) =>
      simulateReject(cp.id, body),
    onSuccess: () =>
      notifications.show({ color: 'orange', message: 'Next message will be rejected' }),
  });

  // Open the editor prefilled with the live default payload for `action`.
  // Templates are fetched fresh each time so MeterValues shows the current meter.
  const openCommand = async (action: string) => {
    try {
      const templates = await getCommandTemplates(cp.id);
      setCmdAction(action);
      setCmdEditable(false);
      setCmdPayload(JSON.stringify(templates[action] ?? {}, null, 2));
      cmdHandlers.open();
    } catch {
      notifications.show({ color: 'red', message: 'Could not load command template' });
    }
  };

  const openRaw = () => {
    setCmdAction('Heartbeat');
    setCmdEditable(true);
    setCmdPayload('{}');
    cmdHandlers.open();
  };

  return (
    <Card withBorder radius="md" shadow="sm">
      <Group justify="space-between" mb="sm">
        <Stack gap={2}>
          <Group gap="xs">
            <Title order={4}>{cp.name}</Title>
            <Badge color={STATUS_COLOR[cp.online ? 'Online' : cp.lastStatus] ?? 'gray'}>
              {cp.online ? 'Online' : cp.lastStatus}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            ID {cp.chargePointId} · {cp.vendor} {cp.model} · {cp.csmsUrl}
          </Text>
        </Stack>
        <Group gap="xs">
          {cp.online ? (
            <Button
              variant="light"
              color="gray"
              size="compact-sm"
              leftSection={<IconPlugConnectedX size={16} />}
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="light"
              size="compact-sm"
              leftSection={<IconPlugConnected size={16} />}
              loading={connect.isPending}
              onClick={() => connect.mutate()}
            >
              Connect
            </Button>
          )}
          {cp.online && (
            <Menu shadow="md" position="bottom-end" withinPortal>
              <Menu.Target>
                <Button
                  variant="light"
                  color="grape"
                  size="compact-sm"
                  leftSection={<IconSend size={14} />}
                  rightSection={<IconChevronDown size={12} />}
                  loading={command.isPending}
                >
                  Send
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>CP → CSMS commands</Menu.Label>
                {SEND_COMMANDS.map((action) => (
                  <Menu.Item key={action} onClick={() => void openCommand(action)}>
                    {action}
                  </Menu.Item>
                ))}
                <Menu.Item leftSection={<IconTerminal2 size={14} />} onClick={openRaw}>
                  Raw call…
                </Menu.Item>
                <Menu.Divider />
                <Menu.Label>Simulate rejection</Menu.Label>
                <Menu.Item
                  leftSection={<IconAdjustments size={14} />}
                  onClick={() => reject.mutate({ boot: true })}
                >
                  Reject next BootNotification
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconAdjustments size={14} />}
                  onClick={() => reject.mutate({ authorize: true })}
                >
                  Reject next Authorize
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
          <Button variant="subtle" size="compact-sm" onClick={handlers.open}>
            Edit
          </Button>
          <ActionIcon color="red" variant="subtle" onClick={() => remove.mutate()}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Group>

      <Stack gap="xs">
        {cp.connectors.map((c) => (
          <ConnectorRow key={c.connectorId} cp={cp} connector={c} cars={cars} />
        ))}
      </Stack>

      <Button
        variant="subtle"
        size="compact-xs"
        color="gray"
        mt="sm"
        leftSection={<IconTerminal2 size={14} />}
        rightSection={<IconChevronDown size={12} />}
        onClick={logsHandlers.toggle}
      >
        {logsOpen ? 'Hide' : 'Show'} OCPP log
      </Button>
      <Collapse in={logsOpen}>
        <Card withBorder radius="sm" mt="xs" p={0} bg="dark.8">
          <OcppLogPanel chargePointId={cp.id} />
        </Card>
      </Collapse>

      <CommandModal
        opened={cmdOpen}
        onClose={cmdHandlers.close}
        title={cmdEditable ? 'Send raw OCPP call' : `Send ${cmdAction}`}
        action={cmdAction}
        onActionChange={setCmdAction}
        actionEditable={cmdEditable}
        payload={cmdPayload}
        onPayloadChange={setCmdPayload}
        loading={command.isPending}
        onSend={(action, payload) => command.mutate({ action, payload })}
      />

      {opened && <ChargePointForm opened={opened} onClose={handlers.close} editing={cp} />}
    </Card>
  );
}

export function ChargePointsPage() {
  const cps = useQuery({ queryKey: ['charge-points'], queryFn: listChargePoints });
  const cars = useQuery({ queryKey: ['cars'], queryFn: listCars });
  const [opened, handlers] = useDisclosure(false);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Charge Points</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handlers.open}>
          New charge point
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {cps.data?.map((cp) => (
          <ChargePointCard key={cp.id} cp={cp} cars={cars.data ?? []} />
        ))}
      </SimpleGrid>

      {cps.data?.length === 0 && (
        <Text c="dimmed">No charge points yet. Create one to get started.</Text>
      )}

      {opened && <ChargePointForm opened={opened} onClose={handlers.close} editing={null} />}
    </Stack>
  );
}
