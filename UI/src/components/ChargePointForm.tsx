import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { createChargePoint, updateChargePoint } from '../lib/api';
import { CONNECTOR_TYPES, type ChargePoint } from '../lib/types';

interface ConnectorValue {
  connectorId: number;
  type: string;
  maxPowerW: number;
}
interface FormValues {
  name: string;
  vendor: string;
  model: string;
  csmsUrl: string;
  connectors: ConnectorValue[];
}

const empty: FormValues = {
  name: '',
  vendor: 'Evis',
  model: 'Emulator',
  csmsUrl: 'ws://localhost:9000',
  connectors: [{ connectorId: 1, type: 'Type2', maxPowerW: 22000 }],
};

export function ChargePointForm({
  opened,
  onClose,
  editing,
}: {
  opened: boolean;
  onClose: () => void;
  editing: ChargePoint | null;
}) {
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    initialValues: editing
      ? {
          name: editing.name,
          vendor: editing.vendor,
          model: editing.model,
          csmsUrl: editing.csmsUrl,
          connectors: editing.connectors.map((c) => ({
            connectorId: c.connectorId,
            type: c.type,
            maxPowerW: c.maxPowerW,
          })),
        }
      : empty,
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      editing ? updateChargePoint(editing.id, values) : createChargePoint(values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['charge-points'] });
      onClose();
    },
    onError: () => notifications.show({ color: 'red', message: 'Save failed' }),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? 'Edit charge point' : 'New charge point'}
      size="lg"
    >
      <form onSubmit={form.onSubmit((v) => mutation.mutate(v))}>
        <Stack>
          <TextInput label="Name" required {...form.getInputProps('name')} />
          <Group grow>
            <TextInput label="Vendor" {...form.getInputProps('vendor')} />
            <TextInput label="Model" {...form.getInputProps('model')} />
          </Group>
          <TextInput
            label="CSMS WebSocket URL"
            placeholder="ws://your-backend:port/path"
            required
            {...form.getInputProps('csmsUrl')}
          />

          <Divider
            label={
              <Group justify="space-between" w="100%">
                <Text size="sm" fw={500}>
                  Connectors
                </Text>
              </Group>
            }
          />
          {form.values.connectors.map((_, i) => (
            <Group key={i} align="flex-end" wrap="nowrap">
              <NumberInput
                label="ID"
                w={70}
                min={1}
                {...form.getInputProps(`connectors.${i}.connectorId`)}
              />
              <Select
                label="Type"
                data={CONNECTOR_TYPES as unknown as string[]}
                {...form.getInputProps(`connectors.${i}.type`)}
              />
              <NumberInput
                label="Max power (W)"
                min={0}
                style={{ flex: 1 }}
                {...form.getInputProps(`connectors.${i}.maxPowerW`)}
              />
              <ActionIcon
                color="red"
                variant="subtle"
                mb={4}
                disabled={form.values.connectors.length === 1}
                onClick={() => form.removeListItem('connectors', i)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            onClick={() =>
              form.insertListItem('connectors', {
                connectorId: form.values.connectors.length + 1,
                type: 'Type2',
                maxPowerW: 22000,
              })
            }
          >
            Add connector
          </Button>

          <Button type="submit" loading={mutation.isPending}>
            Save
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
