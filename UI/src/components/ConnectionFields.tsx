import { Collapse, PasswordInput, Switch, Text, TextInput, Textarea, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconLink, IconLock, IconLockOpen, IconShieldLock } from '@tabler/icons-react';
import { useState } from 'react';
import { resolveUrl } from '../lib/url';

export interface ConnectionValue {
  csmsUrl: string;
  appendIdToUrl: boolean;
  basicAuthUser: string;
  basicAuthPassword: string;
  tlsVerify: boolean;
  tlsCaCert: string;
  tlsClientCert: string;
  /** Empty means: keep the key the charger already has. */
  tlsClientKey: string;
}

function security(url: string | null, password: boolean, clientCert: boolean) {
  const tls = !!url && /^wss:/i.test(url);
  if (tls && clientCert) {
    return {
      tone: 'ok',
      icon: <IconShieldLock size={16} />,
      title: 'Security profile 3',
      text: 'TLS with a client certificate: the charger proves who it is with its certificate.',
    };
  }
  if (tls && password) {
    return {
      tone: 'ok',
      icon: <IconLock size={16} />,
      title: 'Security profile 2',
      text: 'TLS with Basic authentication: the link is encrypted and the charger sends its password.',
    };
  }
  if (tls) {
    return {
      tone: 'info',
      icon: <IconLock size={16} />,
      title: 'Encrypted, not authenticated',
      text: 'The link uses TLS, but the charger sends no password. Add one for security profile 2.',
    };
  }
  if (password) {
    return {
      tone: 'warn',
      icon: <IconLockOpen size={16} />,
      title: 'Security profile 1',
      text: 'Basic authentication over plain ws://. The password is sent, but the link is not encrypted.',
    };
  }
  return {
    tone: 'off',
    icon: <IconLockOpen size={16} />,
    title: 'No security (profile 0)',
    text: 'Plain ws:// without a password. Fine for a local backend.',
  };
}

/**
 * How a charger reaches its CSMS: the link, the password and, for wss://, the
 * certificates. Shared by the "new charger" dialog and the settings tab.
 */
export function ConnectionFields({
  value,
  onChange,
  chargePointId,
  hasClientKey = false,
}: {
  value: ConnectionValue;
  onChange: (patch: Partial<ConnectionValue>) => void;
  chargePointId: string;
  /** The charger already holds a private key for its client certificate. */
  hasClientKey?: boolean;
}) {
  const [tlsOpen, setTlsOpen] = useState(
    !!value.tlsCaCert || !!value.tlsClientCert || !value.tlsVerify,
  );
  const url = resolveUrl(value.csmsUrl, value.appendIdToUrl, chargePointId);
  const secure = !!url && /^wss:/i.test(url);
  const note = security(
    url,
    !!value.basicAuthPassword,
    !!value.tlsClientCert && (!!value.tlsClientKey || hasClientKey),
  );

  return (
    <>
      <TextInput
        label="CSMS link"
        description="The WebSocket address of your backend: ws:// or wss://"
        placeholder="ws://localhost:9220"
        leftSection={<IconLink size={16} />}
        value={value.csmsUrl}
        onChange={(e) => onChange({ csmsUrl: e.currentTarget.value })}
        styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 13 } }}
      />
      <Switch
        checked={value.appendIdToUrl}
        onChange={(e) => onChange({ appendIdToUrl: e.currentTarget.checked })}
        label="Add the charge point ID to the link"
        description="What real chargers do. Turn it off when the link you pasted is already complete."
      />
      <div className="url-preview">
        <span>Connects to</span>
        <code>{url ?? (value.csmsUrl.trim() ? 'This link is not valid' : 'Enter a link')}</code>
      </div>
      <div className="form-grid">
        <PasswordInput
          label="Password"
          description="Optional. Sent as HTTP Basic auth (the OCPP AuthorizationKey)"
          placeholder="No password"
          autoComplete="new-password"
          value={value.basicAuthPassword}
          onChange={(e) => onChange({ basicAuthPassword: e.currentTarget.value })}
        />
        <TextInput
          label="User name"
          description="Leave empty to use the charge point ID"
          placeholder={chargePointId || 'charge point ID'}
          autoComplete="off"
          disabled={!value.basicAuthPassword}
          value={value.basicAuthUser}
          onChange={(e) => onChange({ basicAuthUser: e.currentTarget.value })}
        />
      </div>
      <div className={`security-note tone-${note.tone}`}>
        {note.icon}
        <div>
          <b>{note.title}.</b> {note.text}
        </div>
      </div>

      <UnstyledButton onClick={() => setTlsOpen((o) => !o)} className="row" style={{ gap: 6 }}>
        <IconChevronDown
          size={15}
          style={{ transform: tlsOpen ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
        />
        <Text size="sm" fw={560}>
          TLS options
        </Text>
        <Text size="xs" c="dimmed">
          {secure ? 'for this wss:// link' : 'used with wss:// links'}
        </Text>
      </UnstyledButton>
      <Collapse in={tlsOpen}>
        <div className="stack" style={{ gap: 12 }}>
          <Switch
            checked={value.tlsVerify}
            onChange={(e) => onChange({ tlsVerify: e.currentTarget.checked })}
            label="Check the server's certificate"
            description="Turn off to accept a self-signed certificate on a test backend."
          />
          <Textarea
            label="CA certificate (PEM)"
            description="Trust this authority for the server's certificate, in addition to the system's"
            placeholder="-----BEGIN CERTIFICATE-----"
            autosize
            minRows={2}
            maxRows={6}
            value={value.tlsCaCert}
            onChange={(e) => onChange({ tlsCaCert: e.currentTarget.value })}
            styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 12 } }}
          />
          <Textarea
            label="Client certificate (PEM)"
            description="For security profile 3"
            placeholder="-----BEGIN CERTIFICATE-----"
            autosize
            minRows={2}
            maxRows={6}
            value={value.tlsClientCert}
            onChange={(e) => onChange({ tlsClientCert: e.currentTarget.value })}
            styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 12 } }}
          />
          <Textarea
            label="Client private key (PEM)"
            description={
              hasClientKey
                ? 'A key is stored. Paste a new one only to replace it; it is never shown again.'
                : 'Stored by the emulator and never shown again'
            }
            placeholder={hasClientKey ? 'A key is stored' : '-----BEGIN PRIVATE KEY-----'}
            autosize
            minRows={2}
            maxRows={6}
            value={value.tlsClientKey}
            onChange={(e) => onChange({ tlsClientKey: e.currentTarget.value })}
            styles={{ input: { fontFamily: 'var(--font-mono)', fontSize: 12 } }}
          />
        </div>
      </Collapse>
    </>
  );
}
