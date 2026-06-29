import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Popover,
  Progress,
  Slider,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import {
  createCar,
  deleteCar,
  listCars,
  setCarBattery,
  updateCar,
} from '../lib/api';
import { fmtEnergy, fmtPower, soc } from '../lib/format';
import { CONNECTOR_TYPES, type Car } from '../lib/types';

interface FormValues {
  name: string;
  connectorTypes: string[];
  batteryCapacityWh: number;
  batterySoCWh: number;
  maxChargePowerW: number;
}

const empty: FormValues = {
  name: '',
  connectorTypes: ['Type2'],
  batteryCapacityWh: 50000,
  batterySoCWh: 10000,
  maxChargePowerW: 50000,
};

function CarForm({
  opened,
  onClose,
  editing,
}: {
  opened: boolean;
  onClose: () => void;
  editing: Car | null;
}) {
  const qc = useQueryClient();
  const form = useForm<FormValues>({ initialValues: editing ?? empty });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      editing ? updateCar(editing.id, values) : createCar(values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cars'] });
      onClose();
    },
    onError: () => notifications.show({ color: 'red', message: 'Save failed' }),
  });

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? 'Edit car' : 'New car'}>
      <form onSubmit={form.onSubmit((v) => mutation.mutate(v))}>
        <Stack>
          <TextInput label="Name" required {...form.getInputProps('name')} />
          <MultiSelect
            label="Supported connectors"
            data={CONNECTOR_TYPES as unknown as string[]}
            required
            {...form.getInputProps('connectorTypes')}
          />
          <NumberInput
            label="Battery capacity (Wh)"
            min={0}
            {...form.getInputProps('batteryCapacityWh')}
          />
          <NumberInput
            label="Current charge (Wh)"
            min={0}
            {...form.getInputProps('batterySoCWh')}
          />
          <NumberInput
            label="Max intake power (W)"
            min={0}
            {...form.getInputProps('maxChargePowerW')}
          />
          <Button type="submit" loading={mutation.isPending}>
            Save
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function BatteryControl({ car }: { car: Car }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState(soc(car.batterySoCWh, car.batteryCapacityWh));
  const mutation = useMutation({
    mutationFn: (value: number) => setCarBattery(car.id, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
  return (
    <Popover width={240} position="bottom" withArrow>
      <Popover.Target>
        <Button variant="subtle" size="compact-sm">
          Set battery
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="sm">Battery level: {pct}%</Text>
          <Slider value={pct} onChange={setPct} min={0} max={100} />
          <Button size="xs" loading={mutation.isPending} onClick={() => mutation.mutate(pct)}>
            Apply
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function CarsPage() {
  const cars = useQuery({ queryKey: ['cars'], queryFn: listCars });
  const qc = useQueryClient();
  const [opened, handlers] = useDisclosure(false);
  const [editing, setEditing] = useState<Car | null>(null);
  const remove = useMutation({
    mutationFn: deleteCar,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });

  const openNew = () => {
    setEditing(null);
    handlers.open();
  };
  const openEdit = (car: Car) => {
    setEditing(car);
    handlers.open();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Cars</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>
          New car
        </Button>
      </Group>

      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Connectors</Table.Th>
            <Table.Th>Battery</Table.Th>
            <Table.Th>Max intake</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {cars.data?.map((car) => {
            const pct = soc(car.batterySoCWh, car.batteryCapacityWh);
            return (
              <Table.Tr key={car.id}>
                <Table.Td fw={500}>{car.name}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {car.connectorTypes.map((t) => (
                      <Badge key={t} variant="light" size="sm">
                        {t}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2} w={160}>
                    <Progress value={pct} color={pct >= 100 ? 'green' : 'blue'} />
                    <Text size="xs" c="dimmed">
                      {pct}% · {fmtEnergy(car.batterySoCWh)} / {fmtEnergy(car.batteryCapacityWh)}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>{fmtPower(car.maxChargePowerW)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <BatteryControl car={car} />
                    <Button variant="subtle" size="compact-sm" onClick={() => openEdit(car)}>
                      Edit
                    </Button>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => remove.mutate(car.id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>

      {opened && <CarForm opened={opened} onClose={handlers.close} editing={editing} />}
    </Stack>
  );
}
