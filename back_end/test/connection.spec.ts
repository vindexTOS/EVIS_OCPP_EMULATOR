import { OcppLog } from '../src/entities';
import { Harness, createHarness } from './support/harness';

describe('connection and boot', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('dials <url>/<chargePointId> with the ocpp1.6 sub-protocol and boots', async () => {
    h = await createHarness();
    const v = await h.online('CP001', [{ type: 'Type2' }, { type: 'CCS2' }], {
      vendor: 'EVIS',
      model: 'Twin',
      firmwareVersion: '2.1.0',
    });

    expect(h.csms.upgrades[0]).toMatchObject({
      path: '/CP001',
      protocols: 'ocpp1.6',
    });
    expect(h.csms.upgrades[0].authorization).toBeUndefined();
    expect(h.csms.messages('BootNotification')[0]).toEqual({
      chargePointVendor: 'EVIS',
      chargePointModel: 'Twin',
      chargePointSerialNumber: 'CP001',
      firmwareVersion: '2.1.0',
    });
    // Connector 0 (the charge point) and both connectors report in after the boot.
    const statuses = h.csms.messages('StatusNotification');
    expect(statuses.map((s) => [s.connectorId, s.status, s.errorCode])).toEqual(
      [
        [0, 'Available', 'NoError'],
        [1, 'Available', 'NoError'],
        [2, 'Available', 'NoError'],
      ],
    );
    expect(v.toDto().state).toBe('Accepted');
    expect(v.toDto().securityProfile).toBe(0);
  });

  it('uses the URL exactly as given when the id is not appended', async () => {
    h = await createHarness();
    const v = await h.charger('CP9', undefined, {
      csmsUrl: `${h.csms.url()}/ocpp/SOME-OTHER-ID`,
      appendIdToUrl: false,
    });
    await v.powerOn();
    await h.until(() => v.state === 'Accepted');
    expect(h.csms.upgrades[0].path).toBe('/ocpp/SOME-OTHER-ID');
    expect(h.csms.connected('SOME-OTHER-ID')).toBe(true);
  });

  it('sends heartbeats at the interval the CSMS asked for', async () => {
    h = await createHarness();
    h.csms.bootInterval = 20;
    const v = await h.online();
    expect(v.config.int('HeartbeatInterval')).toBe(20);
    await h.advance(19);
    expect(h.csms.messages('Heartbeat')).toHaveLength(0);
    await h.advance(2);
    expect(h.csms.messages('Heartbeat')).toHaveLength(1);
    await h.advance(20);
    expect(h.csms.messages('Heartbeat')).toHaveLength(2);
    expect(v.toDto().lastHeartbeatAt).not.toBeNull();
  });

  it('authenticates with HTTP Basic when a password is set (security profile 1)', async () => {
    h = await createHarness({ password: 's3cret-key' });
    const v = await h.charger('CP001', undefined, {
      basicAuthPassword: 'wrong',
    });
    await v.powerOn();
    await h.until(
      () => /HTTP 401/.test(v.toDto().connection.lastError ?? ''),
      'the 401 to show',
    );
    expect(v.state).toBe('Connecting');
    expect(h.csms.messages('BootNotification')).toHaveLength(0);

    await h.engine.update(v.id, { basicAuthPassword: 's3cret-key' });
    await h.until(() => v.state === 'Accepted');
    const sent = h.csms.upgrades[h.csms.upgrades.length - 1].authorization;
    expect(sent).toBe(
      `Basic ${Buffer.from('CP001:s3cret-key').toString('base64')}`,
    );
    expect(v.toDto().securityProfile).toBe(1);
  });

  it('keeps retrying while the boot is Pending, and stays quiet meanwhile', async () => {
    h = await createHarness();
    h.csms.bootStatus = 'Pending';
    h.csms.bootInterval = 5;
    const v = await h.charger();
    await v.powerOn();
    await h.until(() => v.state === 'Pending');
    await h.settle();
    expect(h.csms.messages('StatusNotification')).toHaveLength(0);

    // The CSMS may still configure a pending charger, and ask it for messages.
    await expect(
      h.csms.call('CP001', 'ChangeConfiguration', {
        key: 'MeterValueSampleInterval',
        value: '30',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await expect(
      h.csms.call('CP001', 'TriggerMessage', {
        requestedMessage: 'StatusNotification',
        connectorId: 1,
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    expect(h.csms.messages('StatusNotification')).toHaveLength(1);

    h.csms.bootStatus = 'Accepted';
    await h.advance(6);
    expect(h.csms.messages('BootNotification')).toHaveLength(2);
    expect(v.state).toBe('Accepted');
  });

  it('retries a rejected boot after the interval', async () => {
    h = await createHarness();
    h.csms.bootStatus = 'Rejected';
    h.csms.bootInterval = 4;
    const v = await h.charger();
    await v.powerOn();
    await h.until(() => v.state === 'Rejected');
    await h.advance(3);
    expect(h.csms.messages('BootNotification')).toHaveLength(1);
    h.csms.bootStatus = 'Accepted';
    await h.advance(2);
    expect(v.state).toBe('Accepted');
  });

  it('reconnects by itself and boots again after the link drops', async () => {
    h = await createHarness();
    const v = await h.online();
    h.csms.clear();
    h.csms.drop('CP001');
    await h.until(() => v.state !== 'Accepted', 'the drop to be noticed');
    await h.until(() => v.state === 'Accepted', 'the reconnect');
    await h.settle();
    expect(h.csms.actions()).toEqual([
      'BootNotification',
      'StatusNotification',
      'StatusNotification',
    ]);
  });

  it('can reconnect without a new BootNotification', async () => {
    h = await createHarness();
    const v = await h.online('CP001', undefined, { bootOnReconnect: false });
    h.csms.clear();
    h.csms.drop('CP001');
    await h.until(() => v.state !== 'Accepted');
    await h.until(() => v.state === 'Accepted');
    await h.settle();
    expect(h.csms.messages('BootNotification')).toHaveLength(0);
  });

  it('stays dark while powered off and reports a network outage as Offline', async () => {
    h = await createHarness();
    const v = await h.online();
    await v.setNetwork(false);
    expect(v.state).toBe('Offline');
    await h.until(() => !h.csms.connected('CP001'));
    await v.setNetwork(true);
    await h.until(() => v.state === 'Accepted');

    await v.powerOff();
    expect(v.state).toBe('Off');
    await h.until(() => !h.csms.connected('CP001'));
    await h.advance(5);
    expect(h.csms.connected('CP001')).toBe(false);
  });

  it('keeps only the newest OCPP frames of each charger', async () => {
    h = await createHarness({ engine: { logRetention: 10, logPruneEvery: 4 } });
    const a = await h.online('CP-A');
    const b = await h.online('CP-B');
    for (let i = 0; i < 20; i++) {
      await a.sendCall('Heartbeat', {});
      await b.sendCall('Heartbeat', {});
    }
    await h.settle();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const logs = h.dataSource.getRepository(OcppLog);
    for (const v of [a, b]) {
      const rows = await logs.find({
        where: { chargePointId: v.id },
        order: { id: 'ASC' },
      });
      // Trimmed to 10 each time, then at most 3 more before the next trim.
      expect(rows.length).toBeGreaterThanOrEqual(10);
      expect(rows.length).toBeLessThanOrEqual(13);
      // The newest frame is always kept.
      expect(rows[rows.length - 1].action).toBe('Heartbeat');
    }
  });

  it('answers a request it does not know with NotImplemented and a broken one with a CALLERROR', async () => {
    h = await createHarness();
    await h.online();
    await expect(h.csms.call('CP001', 'MakeCoffee', {})).rejects.toMatchObject({
      code: 'NotImplemented',
    });
    await expect(h.csms.call('CP001', 'Reset', {})).rejects.toMatchObject({
      code: 'OccurenceConstraintViolation',
    });
    await expect(
      h.csms.call('CP001', 'Reset', { type: 'Medium' }),
    ).rejects.toMatchObject({
      code: 'PropertyConstraintViolation',
    });
    await expect(
      h.csms.call('CP001', 'RemoteStopTransaction', { transactionId: 'abc' }),
    ).rejects.toMatchObject({ code: 'TypeConstraintViolation' });
  });
});
