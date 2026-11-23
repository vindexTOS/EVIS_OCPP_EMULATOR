import { ActionIcon, Button, Loader, NumberInput, Switch, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconLock, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { getConfiguration, removeConfiguration, setConfiguration } from '../../lib/api';
import { toastError } from '../../lib/queries';
import type { Charger, ConfigEntry } from '../../lib/types';

const PROFILE_LABEL: Record<string, string> = {
  Core: 'Core',
  LocalAuthListManagement: 'Local Auth List Management',
  Reservation: 'Reservation',
  SmartCharging: 'Smart Charging',
  Security: 'Security extension',
  Vendor: 'Vendor keys',
};
const PROFILE_ORDER = Object.keys(PROFILE_LABEL);

/** One key's editor: a switch, a number or a text field, saved when it loses focus. */
function ValueEditor({
  entry,
  onSave,
}: {
  entry: ConfigEntry;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(entry.value);
  const [saving, setSaving] = useState(false);

  const commit = async (value: string) => {
    if (value === entry.value) return;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  if (entry.type === 'boolean') {
    return (
      <Switch
        checked={draft === 'true'}
        disabled={saving}
        aria-label={entry.key}
        onChange={(e) => {
          const value = String(e.currentTarget.checked);
          setDraft(value);
          void commit(value);
        }}
      />
    );
  }
  if (entry.type === 'integer') {
    return (
      <NumberInput
        size="xs"
        w={150}
        hideControls
        allowDecimal={false}
        disabled={saving}
        aria-label={entry.key}
        suffix={entry.unit ? ` ${entry.unit}` : undefined}
        value={draft === '' ? '' : Number(draft)}
        onChange={(v) => setDraft(String(v))}
        onBlur={() => void commit(draft)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    );
  }
  return (
    <TextInput
      size="xs"
      w="100%"
      disabled={saving}
      aria-label={entry.key}
      placeholder={entry.writeOnly ? 'Write-only: type a new value' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => void commit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 12 } }}
    />
  );
}

/** The charger's OCPP configuration keys, as GetConfiguration reports them. */
export function ConfigTab({ charger }: { charger: Charger }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const key = ['configuration', charger.id];
  const config = useQuery({
    queryKey: key,
    queryFn: () => getConfiguration(charger.id),
    // The CSMS may change keys at any time.
    refetchInterval: 5000,
  });

  const save = async (name: string, value: string) => {
    try {
      const result = await setConfiguration(charger.id, name, value);
      qc.setQueryData(key, result.configuration);
      notifications.show({ color: 'evis', message: `${name} saved` });
    } catch (error) {
      toastError(error);
      await qc.invalidateQueries({ queryKey: key });
    }
  };

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const entries = (config.data ?? []).filter(
      (e) =>
        !needle ||
        e.key.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle),
    );
    return PROFILE_ORDER.map((profile) => ({
      profile,
      entries: entries.filter((e) => e.profile === profile),
    })).filter((g) => g.entries.length > 0);
  }, [config.data, search]);

  if (!config.data) {
    return (
      <div className="empty">
        <Loader />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <TextInput
          placeholder="Find a key"
          leftSection={<IconSearch size={15} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ width: 300 }}
        />
        <span className="muted" style={{ fontSize: 12.5, maxWidth: 520 }}>
          What the CSMS reads with GetConfiguration and writes with ChangeConfiguration. Edits here
          are made at the charger itself, so read-only keys can be changed too.
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.profile} className="card card-pad">
          <div className="card-title">
            <span>
              {PROFILE_LABEL[group.profile]} <small>· {group.entries.length} keys</small>
            </span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {group.entries.map((entry) => (
                  <tr key={entry.key}>
                    <td style={{ width: '52%' }}>
                      <div className="cfg-key">
                        {entry.key}
                        {entry.readonly && (
                          <Tooltip label="Read-only for the CSMS: ChangeConfiguration is rejected">
                            <IconLock size={12} style={{ marginLeft: 6, opacity: 0.55 }} />
                          </Tooltip>
                        )}
                      </div>
                      <div className="cfg-desc">{entry.description}</div>
                    </td>
                    <td>
                      <ValueEditor
                        key={`${entry.key}=${entry.value}`}
                        entry={entry}
                        onSave={(value) => save(entry.key, value)}
                      />
                    </td>
                    <td style={{ width: 40 }}>
                      {entry.custom && (
                        <Tooltip label="Remove this vendor key">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Remove ${entry.key}`}
                            onClick={() => {
                              removeConfiguration(charger.id, entry.key)
                                .then((next) => qc.setQueryData(key, next))
                                .catch(toastError);
                            }}
                          >
                            <IconTrash size={15} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card card-pad">
        <div className="card-title">
          <span>
            Add a vendor key <small>· a key outside the OCPP standard, as real chargers have</small>
          </span>
        </div>
        <form
          className="row wrap"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!newKey.trim()) return;
            void save(newKey.trim(), newValue).then(() => {
              setNewKey('');
              setNewValue('');
            });
          }}
        >
          <TextInput
            label="Key"
            placeholder="VendorSpecificKey"
            maxLength={50}
            value={newKey}
            onChange={(e) => setNewKey(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <TextInput
            label="Value"
            maxLength={500}
            value={newValue}
            onChange={(e) => setNewValue(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Button type="submit" variant="default" leftSection={<IconPlus size={16} />} disabled={!newKey.trim()}>
            Add key
          </Button>
        </form>
      </div>
    </div>
  );
}
