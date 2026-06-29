import { Button, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSend } from '@tabler/icons-react';

/**
 * A small editor for an OCPP command: an action name and a JSON payload that
 * the user can tweak before sending. State is owned by the parent so it can
 * prefill live default payloads each time the modal opens.
 */
export function CommandModal({
  opened,
  onClose,
  title,
  action,
  onActionChange,
  actionEditable = false,
  payload,
  onPayloadChange,
  onSend,
  loading,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  action: string;
  onActionChange?: (value: string) => void;
  actionEditable?: boolean;
  payload: string;
  onPayloadChange: (value: string) => void;
  onSend: (action: string, payload: Record<string, unknown>) => void;
  loading?: boolean;
}) {
  const send = () => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch {
      notifications.show({ color: 'red', message: 'Payload is not valid JSON' });
      return;
    }
    onSend(action, parsed);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="lg">
      <Stack>
        <TextInput
          label="Action"
          value={action}
          onChange={(e) => onActionChange?.(e.currentTarget.value)}
          disabled={!actionEditable}
        />
        <Textarea
          label="Payload (JSON)"
          value={payload}
          onChange={(e) => onPayloadChange(e.currentTarget.value)}
          autosize
          minRows={6}
          maxRows={18}
          styles={{ input: { fontFamily: 'monospace', fontSize: 13 } }}
        />
        <Button leftSection={<IconSend size={16} />} onClick={send} loading={loading}>
          Send
        </Button>
      </Stack>
    </Modal>
  );
}
