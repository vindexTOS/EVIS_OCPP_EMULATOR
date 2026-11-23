import {
  ActionIcon,
  Button,
  SegmentedControl,
  Select,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCertificate, IconSend, IconShieldLock, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import {
  clearAuthorization,
  errorMessage,
  getInternals,
  getOverridableActions,
  getTemplates,
  ocppCall,
  sendSecurityEvent,
  setAvailability,
  setOverride,
  signCertificate,
  updateCharger,
} from '../../lib/api';
import { fmtDateTime, fmtPower, fmtTime } from '../../lib/format';
import { useApplyCharger, useBusy } from '../../lib/hooks';
import { toastError } from '../../lib/queries';
import type { AuthInfo, Charger, ResponseOverride } from '../../lib/types';

const SECURITY_EVENTS = [
  'TamperDetectionActivated',
  'FailedToAuthenticateAtCentralSystem',
  'CentralSystemFailedToAuthenticate',
  'SettingSystemTime',
  'MemoryExhaustion',
  'InvalidMessages',
  'AttemptedReplayAttacks',
  'InvalidFirmwareSignature',
  'InvalidCentralSystemCertificate',
  'InvalidTLSVersion',
];

const ERROR_CODES = [
  'InternalError',
  'NotImplemented',
  'NotSupported',
  'ProtocolError',
  'SecurityError',
  'FormationViolation',
  'PropertyConstraintViolation',
  'OccurenceConstraintViolation',
  'TypeConstraintViolation',
  'GenericError',
];

/** Statuses a real charger could answer with, per request. */
const STATUS_CHOICES: Record<string, string[]> = {
  RemoteStartTransaction: ['Rejected', 'Accepted'],
  RemoteStopTransaction: ['Rejected', 'Accepted'],
  Reset: ['Rejected', 'Accepted'],
  UnlockConnector: ['UnlockFailed', 'NotSupported', 'Unlocked'],
  ChangeAvailability: ['Rejected', 'Scheduled', 'Accepted'],
  ChangeConfiguration: ['Rejected', 'NotSupported', 'RebootRequired', 'Accepted'],
  ClearCache: ['Rejected', 'Accepted'],
  DataTransfer: ['Rejected', 'UnknownMessageId', 'UnknownVendorId', 'Accepted'],
  SendLocalList: ['Failed', 'NotSupported', 'VersionMismatch', 'Accepted'],
  ReserveNow: ['Rejected', 'Occupied', 'Faulted', 'Unavailable', 'Accepted'],
  CancelReservation: ['Rejected', 'Accepted'],
  SetChargingProfile: ['Rejected', 'NotSupported', 'Accepted'],
  ClearChargingProfile: ['Unknown', 'Accepted'],
  GetCompositeSchedule: ['Rejected'],
  TriggerMessage: ['Rejected', 'NotImplemented', 'Accepted'],
};

/** Send any charger-to-CSMS message by hand and see what comes back. */
function SendMessage({ charger }: { charger: Charger }) {
  const templates = useQuery({
    queryKey: ['templates', charger.id],
    queryFn: () => getTemplates(charger.id),
  });
  const [action, setAction] = useState('Heartbeat');
  const [payload, setPayload] = useState('{}');
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const pick = async (next: string) => {
    setAction(next);
    setAnswer(null);
    // Fetch again: the template carries live values (meter, transaction id, time).
    const fresh = await templates.refetch();
    const template = fresh.data?.[next];
    if (template !== undefined) setPayload(JSON.stringify(template, null, 2));
  };

  const send = async () => {
    let parsed: unknown;
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch {
      setAnswer({ ok: false, text: 'The payload is not valid JSON.' });
      return;
    }
    setSending(true);
    try {
      const result = await ocppCall(charger.id, action.trim(), parsed);
      setAnswer({ ok: true, text: JSON.stringify(result.result, null, 2) });
    } catch (error) {
      setAnswer({ ok: false, text: errorMessage(error, 'The CSMS did not answer') });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card card-pad wide">
      <div className="card-title">
        <span>
          Send a message to the CSMS <small>· any request a charge point can make</small>
        </span>
      </div>
      <div className="panel-grid">
        <div className="stack" style={{ gap: 10 }}>
          <Select
            label="Message"
            searchable
            allowDeselect={false}
            data={Object.keys(templates.data ?? { Heartbeat: {} })}
            value={templates.data && action in templates.data ? action : null}
            placeholder={action}
            onChange={(v) => v && void pick(v)}
          />
          <TextInput
            label="Action name"
            description="Change it to send something outside the list"
            value={action}
            onChange={(e) => setAction(e.currentTarget.value)}
          />
          <Textarea
            label="Payload (JSON)"
            autosize
            minRows={7}
            maxRows={18}
            value={payload}
            onChange={(e) => setPayload(e.currentTarget.value)}
            styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 12.5 } }}
          />
          <div>
            <Button
              leftSection={<IconSend size={16} />}
              loading={sending}
              disabled={charger.state === 'Off' || !action.trim()}
              onClick={() => void send()}
            >
              Send {action}
            </Button>
          </div>
        </div>
        <div>
          <Text size="sm" fw={500} mb={4}>
            Answer
          </Text>
          <pre className="json" style={{ minHeight: 120, color: answer && !answer.ok ? 'var(--tone-crit)' : undefined }}>
            {answer ? answer.text : 'The answer of the CSMS appears here.'}
          </pre>
        </div>
      </div>
    </div>
  );
}

/** Make the charger answer a CSMS request wrongly, to see how the CSMS copes. */
function Overrides({ charger }: { charger: Charger }) {
  const apply = useApplyCharger();
  const actions = useQuery({
    queryKey: ['override-actions', charger.id],
    queryFn: () => getOverridableActions(charger.id),
    staleTime: Infinity,
  });
  const [action, setAction] = useState('RemoteStartTransaction');
  const [mode, setMode] = useState<ResponseOverride['mode']>('status');
  const [status, setStatus] = useState('Rejected');
  const [errorCode, setErrorCode] = useState('InternalError');
  const [once, setOnce] = useState(false);
  const entries = Object.entries(charger.responseOverrides);
  const choices = STATUS_CHOICES[action];

  const describe = (o: ResponseOverride) =>
    o.mode === 'silent'
      ? 'no answer (the CSMS times out)'
      : o.mode === 'error'
        ? `CALLERROR ${o.errorCode}`
        : `status ${o.status}`;

  return (
    <div className="card card-pad">
      <div className="card-title">
        <span>
          Wrong answers <small>· how the charger answers a CSMS request</small>
        </span>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {entries.length === 0 ? (
          <span className="muted" style={{ fontSize: 13 }}>
            The charger answers every request the way a healthy charger does.
          </span>
        ) : (
          entries.map(([name, o]) => (
            <div key={name} className="row between" style={{ fontSize: 13 }}>
              <span>
                <b>{name}</b> answers with {describe(o)}
                {o.once ? ', once' : ''}
              </span>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove the override for ${name}`}
                onClick={() => {
                  setOverride(charger.id, name, null).then(apply).catch(toastError);
                }}
              >
                <IconTrash size={15} />
              </ActionIcon>
            </div>
          ))
        )}
        <div className="form-grid">
          <Select
            label="When the CSMS sends"
            searchable
            allowDeselect={false}
            data={actions.data ?? [action]}
            value={action}
            onChange={(v) => {
              if (!v) return;
              setAction(v);
              // Each request has its own set of statuses: start from the first.
              setStatus(STATUS_CHOICES[v]?.[0] ?? 'Rejected');
            }}
          />
          <div>
            <Text size="sm" fw={500} mb={3}>
              The charger answers with
            </Text>
            <SegmentedControl
              fullWidth
              value={mode}
              onChange={(v) => setMode(v as ResponseOverride['mode'])}
              data={[
                { value: 'status', label: 'A status' },
                { value: 'error', label: 'An error' },
                { value: 'silent', label: 'Nothing' },
              ]}
            />
          </div>
          {mode === 'status' &&
            (choices ? (
              <Select label="Status" allowDeselect={false} data={choices} value={status} onChange={(v) => v && setStatus(v)} />
            ) : (
              <TextInput label="Status" value={status} onChange={(e) => setStatus(e.currentTarget.value)} />
            ))}
          {mode === 'error' && (
            <Select
              label="Error code"
              allowDeselect={false}
              data={ERROR_CODES}
              value={errorCode}
              onChange={(v) => v && setErrorCode(v)}
            />
          )}
          <Switch
            checked={once}
            onChange={(e) => setOnce(e.currentTarget.checked)}
            label="Only the next time"
            style={{ alignSelf: 'end', paddingBottom: 8 }}
          />
        </div>
        <div>
          <Button
            variant="default"
            onClick={() => {
              setOverride(charger.id, action, {
                mode,
                status: mode === 'status' ? status : undefined,
                errorCode: mode === 'error' ? errorCode : undefined,
                once,
              })
                .then(apply)
                .catch(toastError);
            }}
          >
            Add this answer
          </Button>
        </div>
      </div>
    </div>
  );
}

function Failures({ charger }: { charger: Charger }) {
  const apply = useApplyCharger();
  const patch = (body: Parameters<typeof updateCharger>[1]) =>
    updateCharger(charger.id, body).then(apply).catch(toastError);

  return (
    <div className="card card-pad">
      <div className="card-title">
        <span>
          Things that go wrong <small>· and service controls</small>
        </span>
      </div>
      <div className="stack" style={{ gap: 14 }}>
        <div>
          <Text size="sm" fw={500} mb={3}>
            Firmware update (UpdateFirmware)
          </Text>
          <SegmentedControl
            fullWidth
            value={charger.firmwareFailure}
            onChange={(v) => void patch({ firmwareFailure: v as Charger['firmwareFailure'] })}
            data={[
              { value: 'none', label: 'Succeeds' },
              { value: 'download', label: 'Download fails' },
              { value: 'install', label: 'Installation fails' },
            ]}
          />
        </div>
        <Switch
          checked={charger.diagnosticsFailure}
          onChange={(e) => void patch({ diagnosticsFailure: e.currentTarget.checked })}
          label="Diagnostics and log uploads fail"
          description="GetDiagnostics ends with UploadFailed, GetLog with UploadFailure"
        />
        <Switch
          checked={charger.unlockFailure}
          onChange={(e) => void patch({ unlockFailure: e.currentTarget.checked })}
          label="The connector lock is jammed"
          description="UnlockConnector is answered with UnlockFailed"
        />
        <Switch
          checked={charger.availability === 'Operative'}
          onChange={(e) => {
            setAvailability(charger.id, 0, e.currentTarget.checked ? 'Operative' : 'Inoperative').catch(
              toastError,
            );
          }}
          label="Charge point in service"
          description="Off takes every connector out of service, like ChangeAvailability on connector 0"
        />
      </div>
    </div>
  );
}

function Security({ charger }: { charger: Charger }) {
  const apply = useApplyCharger();
  const { busy, run } = useBusy();
  const [type, setType] = useState(SECURITY_EVENTS[0]);
  const online = charger.state === 'Accepted';

  return (
    <div className="card card-pad">
      <div className="card-title">
        <span>
          Security extension <small>· OCPP 1.6 security whitepaper</small>
        </span>
      </div>
      <div className="stack" style={{ gap: 14 }}>
        <Switch
          checked={charger.securityEvents}
          onChange={(e) => {
            updateCharger(charger.id, { securityEvents: e.currentTarget.checked }).then(apply).catch(toastError);
          }}
          label="Send SecurityEventNotification"
          description="On boot, reset, firmware update and rejected certificates. Leave off for a CSMS without the extension."
        />
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Select
            label="Report a security event now"
            allowDeselect={false}
            searchable
            data={SECURITY_EVENTS}
            value={type}
            onChange={(v) => v && setType(v)}
            style={{ flex: 1 }}
          />
          <Tooltip label="The charger has to be online" disabled={online}>
            <Button
              variant="default"
              leftSection={<IconShieldLock size={16} />}
              disabled={!online}
              loading={busy === 'event'}
              onClick={() =>
                run('event', async () => {
                  await sendSecurityEvent(charger.id, type);
                  notifications.show({ message: `${type} sent` });
                })
              }
            >
              Send
            </Button>
          </Tooltip>
        </div>
        <div>
          <Tooltip label="The charger has to be online" disabled={online}>
            <Button
              variant="default"
              leftSection={<IconCertificate size={16} />}
              disabled={!online}
              loading={busy === 'csr'}
              onClick={() =>
                run('csr', async () => {
                  await signCertificate(charger.id);
                  notifications.show({ message: 'SignCertificate sent with a fresh certificate request' });
                })
              }
            >
              Request a signed certificate
            </Button>
          </Tooltip>
          <Text size="xs" c="dimmed" mt={6}>
            Sends SignCertificate. When the CSMS answers with CertificateSigned, the certificate
            becomes this charger's TLS client certificate
            {charger.hasTlsClientKey ? ' (one is installed).' : '.'}
          </Text>
        </div>
      </div>
    </div>
  );
}

function AuthTable({ rows }: { rows: AuthInfo[] }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
      <table className="data">
        <thead>
          <tr>
            <th>idTag</th>
            <th>Status</th>
            <th>Parent</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.idTag}>
              <td className="mono">{r.idTag}</td>
              <td>{r.status}</td>
              <td className="mono">{r.parentIdTag ?? '–'}</td>
              <td className="dim">{r.expiryDate ? fmtDateTime(r.expiryDate) : 'never'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the charger keeps in its head: queue, reservations, profiles, authorization. */
function Internals({ charger }: { charger: Charger }) {
  const qc = useQueryClient();
  const key = ['internals', charger.id];
  const query = useQuery({ queryKey: key, queryFn: () => getInternals(charger.id), refetchInterval: 3000 });
  const data = query.data;
  if (!data) return null;
  const none = (text: string) => (
    <span className="muted" style={{ fontSize: 13 }}>
      {text}
    </span>
  );
  const clear = (source: 'list' | 'cache') =>
    clearAuthorization(charger.id, source)
      .then((next) => qc.setQueryData(key, next))
      .catch(toastError);

  return (
    <>
      <div className="card card-pad">
        <div className="card-title">
          <span>
            Offline queue <small>· {data.queue.length} transaction messages waiting</small>
          </span>
        </div>
        {data.queue.length === 0 ? (
          none('Nothing is waiting. Messages queue up here while the CSMS cannot be reached.')
        ) : (
          <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Queued</th>
                  <th>Message</th>
                  <th className="num">Session</th>
                  <th className="num">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {data.queue.map((m) => (
                  <tr key={m.id}>
                    <td>{m.createdAt ? fmtTime(m.createdAt) : '–'}</td>
                    <td>{m.action}</td>
                    <td className="num">{m.sessionId ?? '–'}</td>
                    <td className="num">{m.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="card-title">
          <span>
            Reservations <small>· ReserveNow</small>
          </span>
        </div>
        {data.reservations.length === 0 ? (
          none('No reservation is active.')
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Id</th>
                  <th>Connector</th>
                  <th>idTag</th>
                  <th>Until</th>
                </tr>
              </thead>
              <tbody>
                {data.reservations.map((r) => (
                  <tr key={r.reservationId}>
                    <td className="num">{r.reservationId}</td>
                    <td>{r.connectorId === 0 ? 'Any' : r.connectorId}</td>
                    <td className="mono">{r.idTag}</td>
                    <td>{fmtDateTime(r.expiryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-pad wide">
        <div className="card-title">
          <span>
            Charging profiles <small>· Smart Charging</small>
          </span>
          <small>
            {data.limits
              .map((l) => `connector ${l.connectorId}: ${l.limitW == null ? 'no limit' : fmtPower(l.limitW)}`)
              .join(' · ')}
          </small>
        </div>
        {data.chargingProfiles.length === 0 ? (
          none('No profile is installed. The CSMS installs them with SetChargingProfile.')
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Id</th>
                  <th>Connector</th>
                  <th>Purpose</th>
                  <th className="num">Stack</th>
                  <th>Kind</th>
                  <th>Schedule</th>
                </tr>
              </thead>
              <tbody>
                {data.chargingProfiles.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{p.chargingProfileId}</td>
                    <td>{p.connectorId === 0 ? 'All' : p.connectorId}</td>
                    <td>{p.purpose}</td>
                    <td className="num">{p.stackLevel}</td>
                    <td>
                      {p.kind}
                      {p.recurrencyKind ? ` · ${p.recurrencyKind}` : ''}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {p.schedule.chargingSchedulePeriod
                        .map((s) => `${s.startPeriod}s: ${s.limit} ${p.schedule.chargingRateUnit}`)
                        .join('  →  ')}
                      {p.schedule.duration ? `  (for ${p.schedule.duration}s)` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="card-title">
          <span>
            Local authorization list{' '}
            <small>
              · version {data.localList.version}
              {data.localList.enabled ? '' : ' · switched off'}
            </small>
          </span>
          <Button size="compact-xs" variant="subtle" color="gray" disabled={data.localList.entries.length === 0} onClick={() => void clear('list')}>
            Clear
          </Button>
        </div>
        {data.localList.entries.length === 0 ? none('Empty. The CSMS fills it with SendLocalList.') : <AuthTable rows={data.localList.entries} />}
      </div>

      <div className="card card-pad">
        <div className="card-title">
          <span>
            Authorization cache <small>· what the CSMS said before</small>
          </span>
          <Button size="compact-xs" variant="subtle" color="gray" disabled={data.authCache.length === 0} onClick={() => void clear('cache')}>
            Clear
          </Button>
        </div>
        {data.authCache.length === 0 ? none('Empty. It fills as cards are authorized online.') : <AuthTable rows={data.authCache} />}
      </div>
    </>
  );
}

/** Tools for testing a CSMS: hand-sent messages, wrong answers, failures, internals. */
export function AdvancedTab({ charger }: { charger: Charger }) {
  return (
    <div className="panel-grid">
      <SendMessage charger={charger} />
      <Overrides charger={charger} />
      <Failures charger={charger} />
      <Internals charger={charger} />
      <Security charger={charger} />
    </div>
  );
}
