import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Harness, createHarness } from './support/harness';

/** A private CA, a server certificate for localhost and a client certificate, made with openssl. */
function makeCertificates() {
  const dir = mkdtempSync(join(tmpdir(), 'evis-tls-'));
  const run = (...args: string[]) =>
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  writeFileSync(
    join(dir, 'san.ext'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );

  run(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-days',
    '2',
    '-subj',
    '/CN=EVIS Test CA',
  );
  run(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'server.key',
    '-out',
    'server.csr',
    '-subj',
    '/CN=localhost',
  );
  run(
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'server.pem',
    '-days',
    '2',
    '-extfile',
    'san.ext',
  );
  run(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'client.key',
    '-out',
    'client.csr',
    '-subj',
    '/CN=CP001',
  );
  run(
    'x509',
    '-req',
    '-in',
    'client.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'client.pem',
    '-days',
    '2',
  );

  return {
    ca: read('ca.pem'),
    serverKey: read('server.key'),
    serverCert: read('server.pem'),
    clientKey: read('client.key'),
    clientCert: read('client.pem'),
  };
}

describe('wss:// links (security profiles 2 and 3)', () => {
  const certs = makeCertificates();
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('profile 2: TLS with a password, trusting the CA that is configured', async () => {
    h = await createHarness({
      password: 'pw-123',
      tls: { key: certs.serverKey, cert: certs.serverCert },
    });
    expect(h.csms.url()).toMatch(/^wss:\/\/localhost:/);

    // The server's certificate comes from a private CA the charger does not know yet.
    const v = await h.charger('CP001', undefined, {
      basicAuthPassword: 'pw-123',
    });
    await v.powerOn();
    await h.until(() => !!v.toDto().connection.lastError, 'the TLS failure');
    expect(v.state).toBe('Connecting');
    expect(v.toDto().connection.lastError).toMatch(/certificate|issuer/i);
    expect(h.csms.messages('BootNotification')).toHaveLength(0);

    await h.engine.update(v.id, { tlsCaCert: certs.ca });
    await h.until(
      () => v.state === 'Accepted',
      'the charger to be accepted over TLS',
    );
    expect(v.toDto().securityProfile).toBe(2);
    expect(v.toDto().resolvedUrl).toMatch(/^wss:\/\/localhost:\d+\/CP001$/);
    expect(h.csms.upgrades[h.csms.upgrades.length - 1].authorization).toBe(
      `Basic ${Buffer.from('CP001:pw-123').toString('base64')}`,
    );
  });

  it('accepts a certificate it cannot verify when checking is switched off', async () => {
    h = await createHarness({
      tls: { key: certs.serverKey, cert: certs.serverCert },
    });
    const v = await h.charger('CP001', undefined, { tlsVerify: false });
    await v.powerOn();
    await h.until(() => v.state === 'Accepted');
    // Encrypted, but no password: not one of the numbered profiles.
    expect(v.toDto().securityProfile).toBe(0);
  });

  it('profile 3: the charger proves who it is with a client certificate', async () => {
    h = await createHarness({
      tls: { key: certs.serverKey, cert: certs.serverCert, ca: certs.ca },
    });
    const v = await h.charger('CP001', undefined, { tlsCaCert: certs.ca });
    await v.powerOn();
    // No client certificate: the server ends the TLS handshake.
    await h.until(
      () => !!v.toDto().connection.lastError,
      'the refused handshake',
    );
    expect(v.state).toBe('Connecting');
    expect(h.csms.messages('BootNotification')).toHaveLength(0);

    await h.engine.update(v.id, {
      tlsClientCert: certs.clientCert,
      tlsClientKey: certs.clientKey,
    });
    await h.until(() => v.state === 'Accepted', 'the mutual-TLS connection');
    expect(v.toDto().securityProfile).toBe(3);
    // The private key stays in the backend.
    expect(v.toDto().hasTlsClientKey).toBe(true);
    expect(JSON.stringify(v.toDto())).not.toContain('PRIVATE KEY');
  });

  it('a CSMS can raise the security profile, never lower it', async () => {
    h = await createHarness({ password: 'pw-123' });
    const v = await h.online('CP001', undefined, {
      basicAuthPassword: 'pw-123',
    });
    expect(v.toDto().securityProfile).toBe(1);
    await expect(
      h.csms.call('CP001', 'ChangeConfiguration', {
        key: 'SecurityProfile',
        value: '0',
      }),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(
      h.csms.call('CP001', 'ChangeConfiguration', {
        key: 'SecurityProfile',
        value: '3',
      }),
    ).resolves.toEqual({ status: 'Rejected' }); // no client certificate installed
    const conf = await h.csms.call('CP001', 'GetConfiguration', {
      key: ['SecurityProfile'],
    });
    expect(conf.configurationKey[0]).toMatchObject({
      key: 'SecurityProfile',
      value: '1',
    });
  });
});
