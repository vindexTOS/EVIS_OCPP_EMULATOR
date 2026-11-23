import { ActionIcon, Button, Modal, Stack, TextInput, Tooltip } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { IconDice5, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { createIdTag, deleteIdTag, updateIdTag } from '../lib/api';
import { useBusy } from '../lib/hooks';
import type { IdTag } from '../lib/types';

const CARD_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#64748b'];

/** Eight hex characters, like the UID of a real RFID card. */
const randomTag = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

export function IdTagForm({ tag, onClose }: { tag: IdTag | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { busy, run } = useBusy();
  const [label, setLabel] = useState(tag?.label ?? '');
  const [idTag, setIdTag] = useState(tag?.idTag ?? randomTag());
  const [color, setColor] = useState(tag?.color ?? CARD_COLORS[0]);
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['id-tags'] });
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title={tag ? 'Edit card' : 'New RFID card'} size="sm">
      <Stack>
        <div
          className="rfid-card"
          style={{ ['--card' as string]: color, width: '100%', height: 96, cursor: 'default' }}
        >
          <div className="rfid-card-top">{label || 'Card name'}</div>
          <div className="rfid-card-id">{idTag || 'idTag'}</div>
        </div>
        <TextInput
          label="Name"
          placeholder="My card"
          maxLength={60}
          data-autofocus
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <TextInput
          label="idTag"
          description="What the card sends to the charger (max 20 characters)"
          maxLength={20}
          value={idTag}
          onChange={(e) => setIdTag(e.currentTarget.value)}
          styles={{ input: { fontFamily: 'var(--font-mono)' } }}
          rightSection={
            <Tooltip label="Random card number">
              <ActionIcon variant="subtle" color="gray" onClick={() => setIdTag(randomTag())}>
                <IconDice5 size={17} />
              </ActionIcon>
            </Tooltip>
          }
        />
        <div className="swatches">
          {CARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${color === c ? ' selected' : ''}`}
              style={{ ['--c' as string]: c }}
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="row between">
          {tag ? (
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={busy === 'delete'}
              onClick={() =>
                run('delete', async () => {
                  await deleteIdTag(tag.id);
                  await done();
                })
              }
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button
            disabled={!label.trim() || !idTag.trim()}
            loading={busy === 'save'}
            onClick={() =>
              run('save', async () => {
                const body = { label: label.trim(), idTag: idTag.trim(), color };
                if (tag) await updateIdTag(tag.id, body);
                else await createIdTag(body);
                await done();
              })
            }
          >
            {tag ? 'Save card' : 'Create card'}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
