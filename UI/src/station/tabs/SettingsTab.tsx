import { Button, NumberInput, SegmentedControl, Select, Switch, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { useState } from 'react';
import { ConnectionFields, type ConnectionValue } from '../../components/ConnectionFields';
import { updateCharger, type ChargerPatch } from '../../lib/api';
import { useApplyCharger, useBusy } from '../../lib/hooks';
import type { Charger } from '../../lib/types';
import { resolveUrl } from '../../lib/url';

type Draft = ChargerPatch & ConnectionValue;

const draftOf = (c: Charger): Draft => ({
  name: c.name,
  chargePointId: c.chargePointId,
  vendor: c.vendor,
  model: c.model,
  serialNumber: c.serialNumber,
  chargeBoxSerialNumber: c.chargeBoxSerialNumber,
  firmwareVersion: c.firmwareVersion,
  iccid: c.iccid,
  imsi: c.imsi,
  meterType: c.meterType,
  meterSerialNumber: c.meterSerialNumber,
  csmsUrl: c.csmsUrl,
  appendIdToUrl: c.appendIdToUrl,
  basicAuthUser: c.basicAuthUser,
  basicAuthPassword: c.basicAuthPassword,
  tlsVerify: c.tlsVerify,
  tlsCaCert: c.tlsCaCert,
  tlsClientCert: c.tlsClientCert,
  tlsClientKey: '',
  defaultIdTag: c.defaultIdTag,
  autoStart: c.autoStart,
  fullBatteryBehavior: c.fullBatteryBehavior,
  speed: c.speed,
  bootOnReconnect: c.bootOnReconnect,
  rebootSeconds: c.rebootSeconds,
  perPhaseMeterValues: c.perPhaseMeterValues,
  dataTransferMode: c.dataTransferMode,
});

const SPEEDS = ['1', '5', '20', '60'];

/** Everything a charger is set up with: nameplate, connection and behaviour. */
export function SettingsTab({ charger }: { charger: Charger }) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const [d, setD] = useState<Draft>(() => draftOf(charger));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const text = (key: keyof Draft) => ({
    value: (d[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.currentTarget.value as Draft[typeof key]),
  });

  const base = draftOf(charger);
  const changed = (Object.keys(d) as (keyof Draft)[]).filter((k) => d[k] !== base[k]);
  const idOk = /^[^\s/?#]+$/.test(d.chargePointId ?? '');
  const urlOk = !d.csmsUrl.trim() || !!resolveUrl(d.csmsUrl, d.appendIdToUrl, d.chargePointId ?? '');
  const reconnects = changed.some((k) =>
    ['chargePointId', 'csmsUrl', 'appendIdToUrl', 'basicAuthUser', 'basicAuthPassword', 'tlsVerify', 'tlsCaCert', 'tlsClientCert', 'tlsClientKey'].includes(k),
  );

  const save = () =>
    run('save', async () => {
      const patch: Record<string, unknown> = {};
      for (const key of changed) patch[key] = d[key];
      const next = await updateCharger(charger.id, patch as ChargerPatch);
      apply(next);
      setD(draftOf(next));
      notifications.show({
        color: 'evis',
        message: reconnects && next.poweredOn ? 'Saved. The charger is reconnecting.' : 'Saved',
      });
    });

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="card card-pad">
        <div className="form-section">
          <header>
            <h3>Nameplate</h3>
            <p>Who the charger says it is. These fields go out in BootNotification.</p>
          </header>
          <div className="form-grid">
            <TextInput label="Name" description="Only shown in this emulator" maxLength={100} {...text('name')} />
            <TextInput
              label="Charge point ID"
              description="The identity your CSMS knows it by"
              maxLength={48}
              error={idOk ? undefined : 'No spaces, "/", "?" or "#"'}
              styles={{ input: { fontFamily: 'var(--font-mono)' } }}
              {...text('chargePointId')}
            />
            <TextInput label="Vendor" maxLength={20} {...text('vendor')} />
            <TextInput label="Model" maxLength={20} {...text('model')} />
            <TextInput label="Serial number" maxLength={25} {...text('serialNumber')} />
            <TextInput label="Charge box serial number" maxLength={25} {...text('chargeBoxSerialNumber')} />
            <TextInput label="Firmware version" maxLength={50} {...text('firmwareVersion')} />
            <TextInput label="Meter type" maxLength={25} {...text('meterType')} />
            <TextInput label="Meter serial number" maxLength={25} {...text('meterSerialNumber')} />
            <TextInput label="ICCID (SIM card)" maxLength={20} {...text('iccid')} />
            <TextInput label="IMSI" maxLength={20} {...text('imsi')} />
          </div>
        </div>

        <div className="form-section">
          <header>
            <h3>Connection</h3>
            <p>Where the charger dials, and how it proves who it is.</p>
          </header>
          <ConnectionFields
            value={d}
            onChange={(p) => setD((prev) => ({ ...prev, ...p }))}
            chargePointId={d.chargePointId ?? ''}
            hasClientKey={charger.hasTlsClientKey}
          />
          <Switch
            checked={d.bootOnReconnect}
            onChange={(e) => set('bootOnReconnect', e.currentTarget.checked)}
            label="Send BootNotification after every reconnect"
            description="Off: only after power-on and restarts, as the specification asks. Many chargers send it every time."
          />
        </div>

        <div className="form-section">
          <header>
            <h3>Behaviour</h3>
            <p>How this charger acts at the kerb.</p>
          </header>
          <div className="form-grid">
            <TextInput
              label="Default idTag"
              description="Used by the Start button and by auto-start"
              maxLength={20}
              styles={{ input: { fontFamily: 'var(--font-mono)' } }}
              {...text('defaultIdTag')}
            />
            <NumberInput
              label="Restart time"
              description="How long the charger is dark when it reboots"
              suffix=" s"
              min={0}
              max={600}
              value={d.rebootSeconds}
              onChange={(v) => set('rebootSeconds', Number(v) || 0)}
            />
            <div className="wide">
              <Switch
                checked={d.autoStart === 'plug'}
                onChange={(e) => set('autoStart', e.currentTarget.checked ? 'plug' : 'off')}
                label="Start by itself when a car is plugged in"
                description="Free vend / Plug & Charge: the default idTag is authorized as soon as the cable is in."
              />
            </div>
            <div className="wide">
              <Text size="sm" fw={500} mb={3}>
                When the battery is full
              </Text>
              <SegmentedControl
                fullWidth
                value={d.fullBatteryBehavior}
                onChange={(v) => set('fullBatteryBehavior', v as Draft['fullBatteryBehavior'])}
                data={[
                  { value: 'auto', label: 'Like real chargers' },
                  { value: 'suspend', label: 'Keep the transaction (SuspendedEV)' },
                  { value: 'stop', label: 'End the transaction' },
                ]}
              />
              <Text size="xs" c="dimmed" mt={5}>
                Like real chargers: an AC connector idles in SuspendedEV until the driver comes back,
                a DC connector ends the transaction.
              </Text>
            </div>
            <div className="wide">
              <Text size="sm" fw={500} mb={3}>
                Simulation speed
              </Text>
              <SegmentedControl
                fullWidth
                value={SPEEDS.includes(String(d.speed)) ? String(d.speed) : '1'}
                onChange={(v) => set('speed', Number(v))}
                data={[
                  { value: '1', label: 'Real time' },
                  { value: '5', label: '5× faster' },
                  { value: '20', label: '20× faster' },
                  { value: '60', label: '60× faster' },
                ]}
              />
              <Text size="xs" c="dimmed" mt={5}>
                Energy flows faster than the clock, so a battery fills in minutes. Power readings and
                timestamps stay real.
              </Text>
            </div>
            <Switch
              checked={d.perPhaseMeterValues}
              onChange={(e) => set('perPhaseMeterValues', e.currentTarget.checked)}
              label="Meter values per phase"
              description="Report L1, L2 and L3 separately on AC"
            />
            <Select
              label="Answer to DataTransfer from the CSMS"
              allowDeselect={false}
              value={d.dataTransferMode}
              onChange={(v) => v && set('dataTransferMode', v as Draft['dataTransferMode'])}
              data={[
                { value: 'vendor', label: 'Accepted for my own vendor id' },
                { value: 'Accepted', label: 'Always Accepted' },
                { value: 'Rejected', label: 'Always Rejected' },
                { value: 'UnknownVendorId', label: 'Always UnknownVendorId' },
                { value: 'UnknownMessageId', label: 'Always UnknownMessageId' },
              ]}
            />
          </div>
        </div>

        <div className="row between save-bar">
          <Text size="sm" c="dimmed">
            {changed.length === 0
              ? 'No changes'
              : reconnects && charger.poweredOn
                ? 'Saving reconnects the charger with the new connection settings.'
                : `${changed.length} ${changed.length === 1 ? 'change' : 'changes'} to save`}
          </Text>
          <div className="row">
            <Button variant="default" disabled={changed.length === 0} onClick={() => setD(draftOf(charger))}>
              Discard
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              disabled={changed.length === 0 || !idOk || !urlOk}
              loading={busy === 'save'}
              onClick={() => void save()}
            >
              Save settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
