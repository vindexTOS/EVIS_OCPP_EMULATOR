import { Badge, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { listCars, listChargePoints, listSessions } from '../lib/api';
import { fmtEnergy } from '../lib/format';

function duration(start: string, end?: string) {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function SessionsPage() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const cps = useQuery({ queryKey: ['charge-points'], queryFn: listChargePoints });
  const cars = useQuery({ queryKey: ['cars'], queryFn: listCars });

  const cpName = (id: string) => cps.data?.find((c) => c.id === id)?.name ?? id.slice(-6);
  const carName = (id?: string) =>
    id ? (cars.data?.find((c) => c.id === id)?.name ?? '—') : '—';

  return (
    <Stack>
      <Title order={2}>Sessions</Title>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Started</Table.Th>
            <Table.Th>Charge point</Table.Th>
            <Table.Th>Conn</Table.Th>
            <Table.Th>Car</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Energy</Table.Th>
            <Table.Th>Duration</Table.Th>
            <Table.Th>Txn</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sessions.data?.map((s) => (
            <Table.Tr key={s.id}>
              <Table.Td>{new Date(s.startedAt).toLocaleString()}</Table.Td>
              <Table.Td>{cpName(s.chargePointId)}</Table.Td>
              <Table.Td>{s.connectorId}</Table.Td>
              <Table.Td>{carName(s.carId)}</Table.Td>
              <Table.Td>
                <Badge color={s.status === 'Active' ? 'green' : 'gray'} variant="light">
                  {s.status}
                </Badge>
              </Table.Td>
              <Table.Td>{fmtEnergy(s.energyDeliveredWh)}</Table.Td>
              <Table.Td>{duration(s.startedAt, s.stoppedAt)}</Table.Td>
              <Table.Td>{s.ocppTransactionId ?? '—'}</Table.Td>
            </Table.Tr>
          ))}
          {sessions.data?.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={8}>
                <Text c="dimmed" ta="center" py="md">
                  No sessions yet.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
