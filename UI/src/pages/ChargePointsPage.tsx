import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
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
  IconPlayerPlay,
  IconPlugConnected,
  IconPlugConnectedX,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useState } from 'react';
import { ChargePointForm } from '../components/ChargePointForm';
import {
  connectChargePoint,
  deleteChargePoint,
  disconnectChargePoint,
  listCars,
  listChargePoints,
  startCharging,
  stopCharging,
} from '../lib/api';
import { fmtEnergy, fmtPower } from '../lib/format';
import { useTick } from '../lib/live';
import type { Car, ChargePoint, Connector } from '../lib/types';

const STATUS_COLOR: Record<string, string> = {
  Online: 'green',
  Connecting: 'yellow',
  Offline: 'gray',
  Faulted: 'red',
};
const CONN_COLOR: Record<string, string> = {
  Available: 'gray',
  Charging: 'green',
  Preparing: 'blue',
  SuspendedEV: 'yellow',
  Finishing: 'blue',
  Faulted: 'red',
};

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
        <Text size="xs" c="dimmed">
          {fmtPower(connector.maxPowerW)} max · {fmtEnergy(connector.totalEnergyWh)} lifetime
        </Text>
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
    </Card>
  );
}

function ChargePointCard({ cp, cars }: { cp: ChargePoint; cars: Car[] }) {
  const qc = useQueryClient();
  const [opened, handlers] = useDisclosure(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['charge-points'] });

  const connect = useMutation({ mutationFn: () => connectChargePoint(cp.id), onSuccess: invalidate });
  const disconnect = useMutation({ mutationFn: () => disconnectChargePoint(cp.id), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => deleteChargePoint(cp.id), onSuccess: invalidate });

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
            {cp.vendor} {cp.model} · {cp.csmsUrl}
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
