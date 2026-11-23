import {
  X509Certificate,
  createHash,
  createPublicKey,
  createVerify,
} from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describeCertificate, generateCsr } from '../src/engine/ocpp16/x509';
import { Harness, createHarness } from './support/harness';

const CP = 'CP001';

const profile = (
  over: Record<string, unknown> = {},
  schedule: Record<string, unknown> = {},
) => ({
  chargingProfileId: 1,
  stackLevel: 0,
  chargingProfilePurpose: 'TxDefaultProfile',
  chargingProfileKind: 'Absolute',
  chargingSchedule: {
    chargingRateUnit: 'A',
    chargingSchedulePeriod: [{ startPeriod: 0, limit: 10 }],
    ...schedule,
  },
  ...over,
});

describe('Smart Charging', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  const charging = async (
    v: Awaited<ReturnType<Harness['online']>>,
    connectorId = 1,
  ) => {
    const carId = await h.car({ name: `car-${connectorId}` });
    await h.engine.plug(v.id, connectorId, carId);
    await v.presentIdTag(`CARD-${connectorId}`, connectorId);
    await h.settle();
    return carId;
  };
  const power = (v: Awaited<ReturnType<Harness['online']>>, connectorId = 1) =>
    v.toDto().connectors[connectorId - 1].telemetry.powerW;

  it('a TxDefaultProfile caps the power, and clearing it lifts the cap', async () => {
    const v = await h.online();
    await charging(v);
    await h.advance(2);
    expect(power(v)).toBe(11000);

    await expect(
      h.csms.call(CP, 'SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: profile(),
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.advance(2);
    // 10 A on three phases.
    expect(power(v)).toBe(6900);
    expect(v.toDto().connectors[0].telemetry).toMatchObject({
      limitW: 6900,
      limitSource: 'TxDefaultProfile #1',
      currentA: 10,
    });

    await expect(
      h.csms.call(CP, 'ClearChargingProfile', { id: 1 }),
    ).resolves.toEqual({ status: 'Accepted' });
    await expect(
      h.csms.call(CP, 'ClearChargingProfile', { id: 1 }),
    ).resolves.toEqual({ status: 'Unknown' });
    await h.advance(2);
    expect(power(v)).toBe(11000);
  });

  it('a limit of zero, or below 6 A, suspends the charger side', async () => {
    const v = await h.online();
    await charging(v);
    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: profile(
        {},
        { chargingSchedulePeriod: [{ startPeriod: 0, limit: 0 }] },
      ),
    });
    await h.advance(2);
    expect(v.toDto().connectors[0].status).toBe('SuspendedEVSE');
    expect(power(v)).toBe(0);

    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: profile(
        {},
        { chargingSchedulePeriod: [{ startPeriod: 0, limit: 5 }] },
      ),
    });
    await h.advance(2);
    expect(v.toDto().connectors[0].status).toBe('SuspendedEVSE');

    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: profile(
        {},
        { chargingSchedulePeriod: [{ startPeriod: 0, limit: 6 }] },
      ),
    });
    await h.advance(2);
    expect(v.toDto().connectors[0].status).toBe('Charging');
    expect(power(v)).toBe(4140);
  });

  it('follows the periods of a schedule, and the highest stack level wins', async () => {
    const v = await h.online();
    await charging(v);
    const start = new Date(h.clock.now()).toISOString();
    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: profile(
        { chargingProfileId: 1, stackLevel: 1 },
        {
          startSchedule: start,
          duration: 40,
          chargingRateUnit: 'W',
          chargingSchedulePeriod: [
            { startPeriod: 0, limit: 5000 },
            { startPeriod: 20, limit: 8000 },
          ],
        },
      ),
    });
    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 0,
      csChargingProfiles: profile(
        { chargingProfileId: 2, stackLevel: 0 },
        {
          chargingRateUnit: 'W',
          chargingSchedulePeriod: [{ startPeriod: 0, limit: 4600 }],
        },
      ),
    });
    await h.advance(5);
    expect(power(v)).toBe(5000);
    await h.advance(20);
    expect(power(v)).toBe(8000);
    // After its 40 s the stack-level-1 profile falls silent and the level-0 one takes over.
    await h.advance(20);
    expect(power(v)).toBe(4600);
    expect(v.toDto().connectors[0].telemetry.limitSource).toBe(
      'TxDefaultProfile #2',
    );
  });

  it('a TxProfile needs a transaction, beats the default and goes away with the transaction', async () => {
    const v = await h.online();
    const tx = profile({
      chargingProfileId: 5,
      chargingProfilePurpose: 'TxProfile',
    });
    await expect(
      h.csms.call(CP, 'SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: tx,
      }),
    ).resolves.toEqual({ status: 'Rejected' });

    await charging(v);
    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: profile(
        { chargingProfileId: 4 },
        { chargingSchedulePeriod: [{ startPeriod: 0, limit: 14 }] },
      ),
    });
    await expect(
      h.csms.call(CP, 'SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: { ...tx, transactionId: 999 },
      }),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(
      h.csms.call(CP, 'SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: tx,
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.advance(2);
    expect(power(v)).toBe(6900);

    await v.pressStop(1);
    await h.settle();
    expect(
      v.internals().chargingProfiles.map((p) => p.chargingProfileId),
    ).toEqual([4]);
  });

  it('a ChargePointMaxProfile is shared between the connectors that draw power', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'Type2' }]);
    await charging(v, 1);
    await charging(v, 2);
    await h.advance(2);
    expect(power(v, 1) + power(v, 2)).toBe(22000);

    await expect(
      h.csms.call(CP, 'SetChargingProfile', {
        connectorId: 1,
        csChargingProfiles: profile({
          chargingProfilePurpose: 'ChargePointMaxProfile',
        }),
      }),
    ).resolves.toEqual({ status: 'Rejected' }); // only connector 0 may carry it
    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 0,
      csChargingProfiles: profile(
        { chargingProfilePurpose: 'ChargePointMaxProfile' },
        {
          chargingRateUnit: 'W',
          chargingSchedulePeriod: [{ startPeriod: 0, limit: 12000 }],
        },
      ),
    });
    await h.advance(2);
    expect([power(v, 1), power(v, 2)]).toEqual([6000, 6000]);

    await v.pressStop(2);
    await h.advance(2);
    expect(power(v, 1)).toBe(11000); // the whole budget, but the car takes no more
  });

  it('rejects malformed profiles', async () => {
    await h.online();
    const set = (connectorId: number, p: unknown) =>
      h.csms.call(CP, 'SetChargingProfile', {
        connectorId,
        csChargingProfiles: p,
      });
    await expect(set(4, profile())).resolves.toEqual({ status: 'Rejected' });
    await expect(set(1, profile({ stackLevel: 99 }))).resolves.toEqual({
      status: 'Rejected',
    });
    await expect(
      set(1, profile({ chargingProfileKind: 'Recurring' })),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(
      set(
        1,
        profile(
          {},
          { chargingSchedulePeriod: [{ startPeriod: 5, limit: 10 }] },
        ),
      ),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(
      set(1, profile({}, { chargingSchedulePeriod: [] })),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(set(1, { chargingProfileId: 1 })).rejects.toMatchObject({
      code: 'OccurenceConstraintViolation',
    });
  });

  it('GetCompositeSchedule merges what is installed', async () => {
    const v = await h.online();
    const start = new Date(h.clock.now()).toISOString();
    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: profile(
        {},
        {
          startSchedule: start,
          chargingRateUnit: 'W',
          chargingSchedulePeriod: [
            { startPeriod: 0, limit: 7000 },
            { startPeriod: 600, limit: 3000 },
            { startPeriod: 1200, limit: 30000 },
          ],
        },
      ),
    });
    const conf = await h.csms.call(CP, 'GetCompositeSchedule', {
      connectorId: 1,
      duration: 1800,
    });
    expect(conf).toMatchObject({ status: 'Accepted', connectorId: 1 });
    expect(conf.chargingSchedule).toMatchObject({
      duration: 1800,
      chargingRateUnit: 'W',
    });
    expect(conf.chargingSchedule.chargingSchedulePeriod).toEqual([
      { startPeriod: 0, limit: 7000 },
      { startPeriod: 600, limit: 3000 },
      { startPeriod: 1200, limit: 22000 }, // the outlet itself is the limit
    ]);

    const amps = await h.csms.call(CP, 'GetCompositeSchedule', {
      connectorId: 1,
      duration: 300,
      chargingRateUnit: 'A',
    });
    expect(amps.chargingSchedule.chargingSchedulePeriod).toEqual([
      { startPeriod: 0, limit: 10.1 },
    ]);

    await expect(
      h.csms.call(CP, 'GetCompositeSchedule', { connectorId: 6, duration: 60 }),
    ).resolves.toEqual({
      status: 'Rejected',
    });
    expect(v.internals().chargingProfiles).toHaveLength(1);
  });

  it('a recurring daily profile applies at the same hour every day', async () => {
    const v = await h.online();
    await charging(v);
    // Limit between 12:00:30 and 12:01:00, starting yesterday.
    const yesterday = new Date(
      h.clock.now() - 86_400_000 + 30_000,
    ).toISOString();
    await h.csms.call(CP, 'SetChargingProfile', {
      connectorId: 1,
      csChargingProfiles: profile(
        { chargingProfileKind: 'Recurring', recurrencyKind: 'Daily' },
        {
          startSchedule: yesterday,
          duration: 30,
          chargingRateUnit: 'W',
          chargingSchedulePeriod: [{ startPeriod: 0, limit: 4200 }],
        },
      ),
    });
    await h.advance(10);
    expect(power(v)).toBe(11000);
    await h.advance(30);
    expect(power(v)).toBe(4200);
    await h.advance(30);
    expect(power(v)).toBe(11000);
  });

  it('a remote start can bring its own TxProfile', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await expect(
      h.csms.call(CP, 'RemoteStartTransaction', {
        connectorId: 1,
        idTag: 'APP',
        chargingProfile: profile(
          {
            chargingProfilePurpose: 'TxProfile',
            chargingProfileKind: 'Relative',
          },
          {
            chargingRateUnit: 'W',
            chargingSchedulePeriod: [
              { startPeriod: 0, limit: 5000 },
              { startPeriod: 30, limit: 9000 },
            ],
          },
        ),
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.advance(5);
    expect(power(v)).toBe(5000);
    await h.advance(30);
    expect(power(v)).toBe(9000);
    await expect(
      h.csms.call(CP, 'RemoteStartTransaction', {
        connectorId: 1,
        idTag: 'APP',
        chargingProfile: profile(),
      }),
    ).resolves.toEqual({ status: 'Rejected' });
  });
});

describe('Remote Trigger', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('TriggerMessage makes the charger send the message it was asked for', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'Type2' }]);
    const carId = await h.car();
    await h.engine.plug(v.id, 2, carId);
    await v.presentIdTag('CARD-1', 2);
    await h.advance(5);
    const trigger = async (requestedMessage: string, connectorId?: number) => {
      h.csms.clear();
      const conf = await h.csms.call(CP, 'TriggerMessage', {
        requestedMessage,
        ...(connectorId ? { connectorId } : {}),
      });
      await h.settle();
      return conf;
    };

    expect(await trigger('Heartbeat')).toEqual({ status: 'Accepted' });
    expect(h.csms.actions()).toEqual(['Heartbeat']);

    expect(await trigger('StatusNotification', 2)).toEqual({
      status: 'Accepted',
    });
    expect(h.csms.messages('StatusNotification')).toEqual([
      expect.objectContaining({ connectorId: 2, status: 'Charging' }),
    ]);
    expect(await trigger('StatusNotification')).toEqual({ status: 'Accepted' });
    expect(
      h.csms.messages('StatusNotification').map((s) => s.connectorId),
    ).toEqual([0, 1, 2]);

    expect(await trigger('MeterValues', 2)).toEqual({ status: 'Accepted' });
    const meter = h.csms.last('MeterValues');
    expect(meter).toMatchObject({ connectorId: 2, transactionId: 1 });
    expect(meter.meterValue[0].sampledValue[0]).toMatchObject({
      context: 'Trigger',
    });

    expect(await trigger('MeterValues', 1)).toEqual({ status: 'Accepted' });
    expect(h.csms.last('MeterValues').transactionId).toBeUndefined();

    expect(await trigger('FirmwareStatusNotification')).toEqual({
      status: 'Accepted',
    });
    expect(h.csms.last('FirmwareStatusNotification')).toEqual({
      status: 'Idle',
    });
    expect(await trigger('DiagnosticsStatusNotification')).toEqual({
      status: 'Accepted',
    });
    expect(h.csms.last('DiagnosticsStatusNotification')).toEqual({
      status: 'Idle',
    });

    expect(await trigger('BootNotification')).toEqual({ status: 'Accepted' });
    expect(h.csms.messages('BootNotification')).toHaveLength(1);

    expect(await trigger('StatusNotification', 9)).toEqual({
      status: 'Rejected',
    });
    expect(await trigger('SomethingElse')).toEqual({
      status: 'NotImplemented',
    });
  });

  it('sends clock-aligned MeterValues when ClockAlignedDataInterval is set', async () => {
    const v = await h.online();
    await v.setConfig('ClockAlignedDataInterval', '60');
    await v.setConfig(
      'MeterValuesAlignedData',
      'Energy.Active.Import.Register,Power.Active.Import',
    );
    h.csms.clear();
    await h.advance(125);
    const aligned = h.csms.messages('MeterValues');
    // Two minute boundaries passed: each reports the main meter (0) and the connector.
    expect(aligned.map((m) => m.connectorId)).toEqual([0, 1, 0, 1]);
    expect(aligned[1].meterValue[0].sampledValue[0]).toMatchObject({
      context: 'Sample.Clock',
      measurand: 'Energy.Active.Import.Register',
    });
    const stamp = new Date(aligned[0].meterValue[0].timestamp);
    expect(stamp.getUTCSeconds()).toBeLessThanOrEqual(1);
  });
});

describe('Firmware Management', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  const firmwareStatuses = () =>
    h.csms.messages('FirmwareStatusNotification').map((m) => m.status);

  it('UpdateFirmware downloads, installs, reboots into the new version and reports Installed', async () => {
    const v = await h.online(CP, undefined, { firmwareVersion: '1.0.0' });
    h.csms.clear();
    await expect(
      h.csms.call(CP, 'UpdateFirmware', {
        location: 'https://files.example.test/evis/fw-1.4.2.bin',
        retrieveDate: new Date(h.clock.now()).toISOString(),
      }),
    ).resolves.toEqual({});
    await h.advance(1);
    expect(firmwareStatuses()).toEqual(['Downloading']);
    await h.advance(2);
    expect(firmwareStatuses()).toEqual([
      'Downloading',
      'Downloaded',
      'Installing',
    ]);
    // Out of service while the firmware is written.
    expect(v.toDto().connectors[0].status).toBe('Unavailable');
    expect(v.toDto().maintenance).toBe(true);

    await h.advance(2);
    expect(v.state).toBe('Rebooting');
    await h.advance(3);
    await h.until(() => v.state === 'Accepted');
    await h.settle();
    expect(h.csms.last('BootNotification').firmwareVersion).toBe('1.4.2');
    expect(firmwareStatuses()).toEqual([
      'Downloading',
      'Downloaded',
      'Installing',
      'Installed',
    ]);
    expect(v.toDto()).toMatchObject({
      firmwareVersion: '1.4.2',
      firmwareStatus: 'Idle',
      maintenance: false,
    });
    expect(v.toDto().connectors[0].status).toBe('Available');
  });

  it('waits for the retrieve date and for running transactions', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    h.csms.clear();
    await h.csms.call(CP, 'UpdateFirmware', {
      location: 'ftp://files.example.test/firmware.bin',
      retrieveDate: new Date(h.clock.now() + 10_000).toISOString(),
    });
    await h.advance(8);
    expect(firmwareStatuses()).toEqual([]);
    await h.advance(6);
    expect(firmwareStatuses()).toEqual(['Downloading', 'Downloaded']);
    // Still charging: the install has to wait.
    await h.advance(10);
    expect(firmwareStatuses()).toEqual(['Downloading', 'Downloaded']);
    expect(v.toDto().connectors[0].status).toBe('Charging');

    await v.pressStop(1);
    await h.advance(3);
    expect(firmwareStatuses()).toEqual([
      'Downloading',
      'Downloaded',
      'Installing',
    ]);
  });

  it('reports a failed download (with retries) and a failed installation', async () => {
    const v = await h.online(CP, undefined, {
      firmwareFailure: 'download',
      firmwareVersion: '1.0.0',
    });
    h.csms.clear();
    await h.csms.call(CP, 'UpdateFirmware', {
      location: 'https://files.example.test/fw.bin',
      retrieveDate: new Date(h.clock.now()).toISOString(),
      retries: 1,
      retryInterval: 5,
    });
    await h.advance(15);
    expect(firmwareStatuses()).toEqual([
      'Downloading',
      'DownloadFailed',
      'Downloading',
      'DownloadFailed',
    ]);
    expect(v.toDto().firmwareVersion).toBe('1.0.0');

    await h.engine.update(v.id, { firmwareFailure: 'install' });
    h.csms.clear();
    await h.csms.call(CP, 'UpdateFirmware', {
      location: 'https://files.example.test/fw.bin',
      retrieveDate: new Date(h.clock.now()).toISOString(),
    });
    await h.advance(8);
    expect(firmwareStatuses()).toEqual([
      'Downloading',
      'Downloaded',
      'Installing',
      'InstallationFailed',
    ]);
    expect(v.state).toBe('Accepted');
    expect(v.toDto().connectors[0].status).toBe('Available');
  });

  it('GetDiagnostics names a file and reports the upload', async () => {
    const v = await h.online();
    h.csms.clear();
    const conf = await h.csms.call(CP, 'GetDiagnostics', {
      location: 'ftp://files.example.test/in/',
    });
    expect(conf.fileName).toMatch(/^diagnostics-CP001-\d{8}T\d{6}\.log$/);
    await h.settle();
    expect(h.csms.messages('DiagnosticsStatusNotification')).toEqual([
      { status: 'Uploading' },
    ]);
    await h.csms.call(CP, 'TriggerMessage', {
      requestedMessage: 'DiagnosticsStatusNotification',
    });
    await h.advance(3);
    expect(
      h.csms.messages('DiagnosticsStatusNotification').map((m) => m.status),
    ).toEqual(['Uploading', 'Uploading', 'Uploaded']);

    await h.engine.update(v.id, { diagnosticsFailure: true });
    h.csms.clear();
    await h.csms.call(CP, 'GetDiagnostics', {
      location: 'ftp://files.example.test/in/',
    });
    await h.advance(3);
    expect(h.csms.last('DiagnosticsStatusNotification')).toEqual({
      status: 'UploadFailed',
    });
  });
});

describe('Security extension', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  /** A throw-away CA and a certificate it signs for a CSR, made with the openssl CLI. */
  function ca() {
    const dir = mkdtempSync(join(tmpdir(), 'evis-ca-'));
    const run = (...args: string[]) =>
      execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
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
      '/O=EVIS Test/CN=Test Root',
    );
    return {
      root: readFileSync(join(dir, 'ca.pem'), 'utf8'),
      sign(csr: string) {
        writeFileSync(join(dir, 'req.csr'), csr);
        run(
          'x509',
          '-req',
          '-in',
          'req.csr',
          '-CA',
          'ca.pem',
          '-CAkey',
          'ca.key',
          '-CAcreateserial',
          '-out',
          'leaf.pem',
          '-days',
          '2',
        );
        return readFileSync(join(dir, 'leaf.pem'), 'utf8');
      },
      verifyCsr(csr: string) {
        writeFileSync(join(dir, 'check.csr'), csr);
        return (
          run(
            'req',
            '-in',
            'check.csr',
            '-noout',
            '-verify',
            '-subject',
          ).toString() +
          execFileSync(
            'openssl',
            ['req', '-in', 'check.csr', '-noout', '-verify'],
            { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' },
          )
        );
      },
    };
  }

  it('builds a certificate request that openssl accepts', () => {
    const { csrPem, privateKeyPem } = generateCsr('CP001', 'EVIS Energy');
    expect(csrPem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----/);
    const authority = ca();
    const leaf = authority.sign(csrPem); // openssl refuses a CSR whose signature is wrong
    const cert = new X509Certificate(leaf);
    expect(cert.subject).toContain('CN=CP001');
    expect(cert.subject).toContain('O=EVIS Energy');
    // The certificate carries the key the request was made for.
    const ours = createPublicKey(privateKeyPem).export({
      type: 'spki',
      format: 'der',
    });
    expect(
      Buffer.compare(
        ours,
        cert.publicKey.export({ type: 'spki', format: 'der' }),
      ),
    ).toBe(0);
    expect(createVerify('sha256')).toBeDefined();
  });

  it('computes CertificateHashData the way OCPP defines it', () => {
    const authority = ca();
    const info = describeCertificate(authority.root);
    const cert = new X509Certificate(authority.root);
    expect(info.selfSigned).toBe(true);
    expect(info.serialNumber).toBe(
      cert.serialNumber.toLowerCase().replace(/^0+(?=.)/, ''),
    );
    // issuerKeyHash: SHA-256 over the public key bits, without the SubjectPublicKeyInfo wrapper.
    const jwk = cert.publicKey.export({ format: 'jwk' }) as {
      n: string;
      e: string;
    };
    const n = Buffer.from(jwk.n, 'base64url');
    const e = Buffer.from(jwk.e, 'base64url');
    const int = (b: Buffer) => {
      const body = b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b;
      const len =
        body.length < 128
          ? Buffer.from([body.length])
          : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
      return Buffer.concat([Buffer.from([0x02]), len, body]);
    };
    const inner = Buffer.concat([int(n), int(e)]);
    const rsaPublicKey = Buffer.concat([
      Buffer.from([0x30, 0x82, inner.length >> 8, inner.length & 0xff]),
      inner,
    ]);
    expect(info.issuerKeyHash).toBe(
      createHash('sha256').update(rsaPublicKey).digest('hex'),
    );
    expect(info.issuerNameHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gets a charge point certificate signed and keeps root certificates', async () => {
    const v = await h.online(CP, undefined, { securityEvents: true });
    const authority = ca();
    h.csms.clear();

    await expect(
      h.csms.call(CP, 'ExtendedTriggerMessage', {
        requestedMessage: 'SignChargePointCertificate',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    const csr = h.csms.last('SignCertificate').csr as string;
    expect(csr).toMatch(/BEGIN CERTIFICATE REQUEST/);

    // A certificate for somebody else's key is refused.
    const other = authority.sign(generateCsr('INTRUDER', 'X').csrPem);
    await expect(
      h.csms.call(CP, 'CertificateSigned', { certificateChain: other }),
    ).resolves.toEqual({
      status: 'Rejected',
    });
    await h.settle();
    expect(h.csms.last('SecurityEventNotification')).toMatchObject({
      type: 'InvalidChargePointCertificate',
    });

    const leaf = authority.sign(csr);
    await expect(
      h.csms.call(CP, 'CertificateSigned', {
        certificateChain: `${leaf}\n${authority.root}`,
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    expect(v.toDto().hasTlsClientKey).toBe(true);
    expect(v.toDto().tlsClientCert).toContain('BEGIN CERTIFICATE');

    await expect(
      h.csms.call(CP, 'GetInstalledCertificateIds', {
        certificateType: 'CentralSystemRootCertificate',
      }),
    ).resolves.toEqual({ status: 'NotFound' });
    await expect(
      h.csms.call(CP, 'InstallCertificate', {
        certificateType: 'CentralSystemRootCertificate',
        certificate: 'nonsense',
      }),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(
      h.csms.call(CP, 'InstallCertificate', {
        certificateType: 'CentralSystemRootCertificate',
        certificate: authority.root,
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    const ids = await h.csms.call(CP, 'GetInstalledCertificateIds', {
      certificateType: 'CentralSystemRootCertificate',
    });
    expect(ids.status).toBe('Accepted');
    expect(ids.certificateHashData).toHaveLength(1);
    expect(ids.certificateHashData[0]).toMatchObject({
      hashAlgorithm: 'SHA256',
    });
    expect(v.toDto().tlsCaCert).toContain('BEGIN CERTIFICATE');

    await expect(
      h.csms.call(CP, 'DeleteCertificate', {
        certificateHashData: ids.certificateHashData[0],
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await expect(
      h.csms.call(CP, 'DeleteCertificate', {
        certificateHashData: ids.certificateHashData[0],
      }),
    ).resolves.toEqual({ status: 'NotFound' });
    expect(v.toDto().tlsCaCert).toBe('');
  });

  it('GetLog and SignedUpdateFirmware report through their own notifications', async () => {
    const v = await h.online(CP, undefined, { firmwareVersion: '3.0.0' });
    h.csms.clear();
    const log = await h.csms.call(CP, 'GetLog', {
      logType: 'SecurityLog',
      requestId: 7,
      log: { remoteLocation: 'https://files.example.test/logs' },
    });
    expect(log.status).toBe('Accepted');
    expect(log.filename).toMatch(/^security-CP001-/);
    await h.advance(3);
    expect(h.csms.messages('LogStatusNotification')).toEqual([
      { status: 'Uploading', requestId: 7 },
      { status: 'Uploaded', requestId: 7 },
    ]);

    await expect(
      h.csms.call(CP, 'SignedUpdateFirmware', {
        requestId: 21,
        firmware: {
          location: 'https://files.example.test/fw-3.1.0.bin',
          retrieveDateTime: new Date(h.clock.now()).toISOString(),
          signingCertificate: 'not a certificate',
          signature: 'AAAA',
        },
      }),
    ).resolves.toEqual({ status: 'InvalidCertificate' });

    await expect(
      h.csms.call(CP, 'SignedUpdateFirmware', {
        requestId: 22,
        firmware: {
          location: 'https://files.example.test/fw-3.1.0.bin',
          retrieveDateTime: new Date(h.clock.now()).toISOString(),
          signingCertificate:
            '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
          signature: 'AAAA',
        },
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.advance(6);
    await h.advance(3);
    await h.until(() => v.state === 'Accepted');
    await h.settle();
    expect(h.csms.messages('SignedFirmwareStatusNotification')).toEqual([
      { status: 'Downloading', requestId: 22 },
      { status: 'Downloaded', requestId: 22 },
      { status: 'SignatureVerified', requestId: 22 },
      { status: 'Installing', requestId: 22 },
      { status: 'InstallRebooting', requestId: 22 },
      { status: 'Installed', requestId: 22 },
    ]);
    expect(h.csms.messages('FirmwareStatusNotification')).toHaveLength(0);
    expect(v.toDto().firmwareVersion).toBe('3.1.0');
  });

  it('sends SecurityEventNotification only when the tester switched it on', async () => {
    const quiet = await h.online('CP-QUIET');
    expect(
      h.csms.messages('SecurityEventNotification', 'CP-QUIET'),
    ).toHaveLength(0);
    const loud = await h.online('CP-LOUD', undefined, { securityEvents: true });
    expect(
      h.csms
        .messages('SecurityEventNotification', 'CP-LOUD')
        .map((m) => m.type),
    ).toEqual(['StartupOfTheDevice']);
    await loud.raiseSecurityEvent('TamperDetectionActivated', 'cover opened');
    await h.settle();
    expect(h.csms.last('SecurityEventNotification', 'CP-LOUD')).toMatchObject({
      type: 'TamperDetectionActivated',
      techInfo: 'cover opened',
    });
    expect(quiet.state).toBe('Accepted');
  });
});
