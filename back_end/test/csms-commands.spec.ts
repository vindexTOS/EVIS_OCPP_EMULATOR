import { Harness, createHarness } from './support/harness';

const CP = 'CP001';

describe('Core profile commands', () => {
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

  it('Reset Soft: stops transactions, reboots and boots again', async () => {
    const v = await h.online();
    await charging(v);
    const txId = v.toDto().connectors[0].session!.transactionId;
    h.csms.clear();

    await expect(h.csms.call(CP, 'Reset', { type: 'Soft' })).resolves.toEqual({
      status: 'Accepted',
    });
    // The charger waits for its StopTransaction to be answered, then goes down.
    await h.advance(1);
    expect(v.state).toBe('Rebooting');
    // The stop was reported before the charger went down.
    expect(h.csms.last('StopTransaction')).toMatchObject({
      transactionId: txId,
      reason: 'SoftReset',
    });
    expect(h.csms.connected(CP)).toBe(false);

    await h.advance(3);
    await h.until(() => v.state === 'Accepted');
    await h.settle();
    expect(h.csms.messages('BootNotification')).toHaveLength(1);
    expect(v.toDto().connectors[0].status).toBe('Finishing');
  });

  it('Reset Hard: goes down at once and reports the stop after the boot', async () => {
    const v = await h.online();
    await charging(v);
    const txId = v.toDto().connectors[0].session!.transactionId;
    h.csms.clear();

    await h.csms.call(CP, 'Reset', { type: 'Hard' });
    await h.until(() => v.state === 'Rebooting');
    await h.settle();
    expect(h.csms.messages('StopTransaction')).toHaveLength(0);

    await h.advance(3);
    await h.until(() => v.state === 'Accepted');
    await h.settle();
    const order = h.csms.actions();
    expect(order.indexOf('BootNotification')).toBeLessThan(
      order.indexOf('StopTransaction'),
    );
    expect(h.csms.last('StopTransaction')).toMatchObject({
      transactionId: txId,
      reason: 'HardReset',
    });
  });

  it('ChangeAvailability: takes connectors out of service, and schedules it during a transaction', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'Type2' }]);
    await charging(v, 1);
    h.csms.clear();

    await expect(
      h.csms.call(CP, 'ChangeAvailability', {
        connectorId: 2,
        type: 'Inoperative',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    expect(h.csms.last('StatusNotification')).toMatchObject({
      connectorId: 2,
      status: 'Unavailable',
    });

    await expect(
      h.csms.call(CP, 'ChangeAvailability', {
        connectorId: 1,
        type: 'Inoperative',
      }),
    ).resolves.toEqual({ status: 'Scheduled' });
    await h.settle();
    expect(v.toDto().connectors[0].status).toBe('Charging');

    await v.pressStop(1);
    await h.settle();
    // No Finishing: the scheduled change takes over as the transaction ends.
    expect(v.toDto().connectors[0]).toMatchObject({
      status: 'Unavailable',
      availability: 'Inoperative',
    });

    // An out-of-service connector takes no card.
    expect((await v.presentIdTag('CARD-9', 2)).outcome).toBe('rejected');
    await expect(
      h.csms.call(CP, 'RemoteStartTransaction', { connectorId: 2, idTag: 'X' }),
    ).resolves.toEqual({ status: 'Rejected' });

    await expect(
      h.csms.call(CP, 'ChangeAvailability', {
        connectorId: 0,
        type: 'Operative',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    expect(v.toDto().connectors.map((c) => c.status)).toEqual([
      'Finishing',
      'Available',
    ]);
    await expect(
      h.csms.call(CP, 'ChangeAvailability', {
        connectorId: 5,
        type: 'Operative',
      }),
    ).resolves.toEqual({ status: 'Rejected' });
  });

  it('survives a restart with its availability intact', async () => {
    const v = await h.online();
    await h.csms.call(CP, 'ChangeAvailability', {
      connectorId: 0,
      type: 'Inoperative',
    });
    await h.settle();
    const engine = await h.restartEngine();
    const revived = engine.get(v.id);
    await h.until(() => revived.state === 'Accepted');
    await h.settle();
    expect(revived.toDto().connectors[0].status).toBe('Unavailable');
    const zero = h.csms
      .messages('StatusNotification')
      .filter((s) => s.connectorId === 0);
    expect(zero[zero.length - 1].status).toBe('Unavailable');
  });

  it('GetConfiguration and ChangeConfiguration follow the key table', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'CCS2' }]);

    const all = await h.csms.call(CP, 'GetConfiguration', {});
    const byKey = new Map<string, any>(
      all.configurationKey.map((k: any) => [k.key, k]),
    );
    expect(byKey.get('NumberOfConnectors')).toEqual({
      key: 'NumberOfConnectors',
      readonly: true,
      value: '2',
    });
    expect(byKey.get('SupportedFeatureProfiles').value).toBe(
      'Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger',
    );
    expect(byKey.get('HeartbeatInterval')).toMatchObject({
      readonly: false,
      value: '300',
    });
    // The AuthorizationKey can be written but never read back.
    expect(byKey.get('AuthorizationKey')).toEqual({
      key: 'AuthorizationKey',
      readonly: false,
    });
    expect(all.unknownKey).toBeUndefined();

    const some = await h.csms.call(CP, 'GetConfiguration', {
      key: ['meterValueSampleInterval', 'NoSuchKey'],
    });
    expect(some).toEqual({
      configurationKey: [
        { key: 'MeterValueSampleInterval', readonly: false, value: '15' },
      ],
      unknownKey: ['NoSuchKey'],
    });

    const change = (key: string, value: string) =>
      h.csms.call(CP, 'ChangeConfiguration', { key, value });
    await expect(change('MeterValueSampleInterval', '5')).resolves.toEqual({
      status: 'Accepted',
    });
    await expect(change('MeterValueSampleInterval', 'soon')).resolves.toEqual({
      status: 'Rejected',
    });
    await expect(change('NumberOfConnectors', '4')).resolves.toEqual({
      status: 'Rejected',
    });
    await expect(change('NoSuchKey', '1')).resolves.toEqual({
      status: 'NotSupported',
    });
    await expect(change('AuthorizeRemoteTxRequests', 'TRUE')).resolves.toEqual({
      status: 'Accepted',
    });
    await expect(
      change('MeterValuesSampledData', 'Energy.Active.Import.Register,Bananas'),
    ).resolves.toEqual({
      status: 'Rejected',
    });
    await expect(
      change(
        'MeterValuesSampledData',
        'Voltage, SoC,Power.Active.Import , Current.Offered,Current.Import,Energy.Active.Import.Register',
      ),
    ).resolves.toEqual({ status: 'Accepted' });
    expect(v.config.get('AuthorizeRemoteTxRequests')).toBe('true');
    expect(v.config.csl('MeterValuesSampledData')).toHaveLength(6);

    // The new sample interval and measurand list are used right away.
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    h.csms.clear();
    await h.advance(11);
    expect(h.csms.messages('MeterValues')).toHaveLength(2);
    expect(
      h.csms
        .last('MeterValues')
        .meterValue[0].sampledValue.map((s: any) => s.measurand),
    ).toEqual([
      'Voltage',
      'SoC',
      'Power.Active.Import',
      'Current.Offered',
      'Current.Import',
      'Energy.Active.Import.Register',
    ]);
  });

  it('a changed AuthorizationKey is used for the reconnect that follows', async () => {
    const v = await h.online();
    h.csms.password = 'new-key-0123456789';
    await expect(
      h.csms.call(CP, 'ChangeConfiguration', {
        key: 'AuthorizationKey',
        value: 'new-key-0123456789',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.until(() => h.csms.upgrades.length === 2, 'the reconnect');
    await h.until(() => v.state === 'Accepted');
    expect(h.csms.upgrades[1].authorization).toBe(
      `Basic ${Buffer.from(`${CP}:new-key-0123456789`).toString('base64')}`,
    );
    expect(v.toDto().securityProfile).toBe(1);
  });

  it('UnlockConnector ends a running transaction first', async () => {
    const v = await h.online();
    await charging(v);
    h.csms.clear();
    await expect(
      h.csms.call(CP, 'UnlockConnector', { connectorId: 1 }),
    ).resolves.toEqual({
      status: 'Unlocked',
    });
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      reason: 'UnlockCommand',
    });
    expect(v.toDto().connectors[0].locked).toBe(false);

    await expect(
      h.csms.call(CP, 'UnlockConnector', { connectorId: 4 }),
    ).resolves.toEqual({
      status: 'NotSupported',
    });
    await h.engine.update(v.id, { unlockFailure: true });
    await expect(
      h.csms.call(CP, 'UnlockConnector', { connectorId: 1 }),
    ).resolves.toEqual({
      status: 'UnlockFailed',
    });
  });

  it('DataTransfer answers by vendor, or however the tester sets it', async () => {
    const v = await h.online(CP, undefined, { vendor: 'EVIS' });
    await expect(
      h.csms.call(CP, 'DataTransfer', { vendorId: 'EVIS', messageId: 'hello' }),
    ).resolves.toEqual({
      status: 'Accepted',
    });
    await expect(
      h.csms.call(CP, 'DataTransfer', { vendorId: 'Someone' }),
    ).resolves.toEqual({
      status: 'UnknownVendorId',
    });
    await h.engine.update(v.id, { dataTransferMode: 'UnknownMessageId' });
    await expect(
      h.csms.call(CP, 'DataTransfer', { vendorId: 'EVIS' }),
    ).resolves.toEqual({
      status: 'UnknownMessageId',
    });
    // And the charger can send one of its own.
    await expect(
      v.sendCall('DataTransfer', { vendorId: 'EVIS', data: 'x' }),
    ).resolves.toEqual({
      status: 'Accepted',
    });
  });

  it('faults are reported with their error code and end the transaction', async () => {
    const v = await h.online();
    await charging(v);
    h.csms.clear();
    await v.setFault(1, {
      errorCode: 'GroundFailure',
      info: 'RCD tripped',
      vendorErrorCode: 'E42',
    });
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({ reason: 'Other' });
    expect(h.csms.last('StatusNotification')).toMatchObject({
      connectorId: 1,
      status: 'Faulted',
      errorCode: 'GroundFailure',
      info: 'RCD tripped',
      vendorErrorCode: 'E42',
    });
    expect((await v.presentIdTag('CARD-1', 1)).outcome).toBe('rejected');

    await v.clearFault(1);
    await h.settle();
    expect(h.csms.last('StatusNotification')).toMatchObject({
      status: 'Finishing',
      errorCode: 'NoError',
    });

    // A warning is reported without taking the connector down.
    await v.setFault(1, { errorCode: 'WeakSignal', fatal: false });
    await h.settle();
    expect(h.csms.last('StatusNotification')).toMatchObject({
      status: 'Finishing',
      errorCode: 'WeakSignal',
    });
    expect(v.toDto().connectors[0].errorCode).toBe('NoError');
  });

  it('the emergency stop takes everything down until it is released', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'Type2' }]);
    await charging(v, 1);
    h.csms.clear();
    await v.emergencyStop(true);
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      reason: 'EmergencyStop',
    });
    expect(v.toDto().connectors.map((c) => c.status)).toEqual([
      'Faulted',
      'Faulted',
    ]);
    const zero = h.csms
      .messages('StatusNotification')
      .filter((s) => s.connectorId === 0);
    expect(zero[zero.length - 1]).toMatchObject({ status: 'Faulted' });
    await v.emergencyStop(false);
    await h.settle();
    expect(v.toDto().connectors.map((c) => c.status)).toEqual([
      'Finishing',
      'Available',
    ]);
  });

  it('test overrides make the charger refuse, fail or ignore a request', async () => {
    const v = await h.online();
    await v.setOverride('Reset', {
      mode: 'status',
      status: 'Rejected',
      once: true,
    });
    await expect(h.csms.call(CP, 'Reset', { type: 'Soft' })).resolves.toEqual({
      status: 'Rejected',
    });
    expect(v.state).toBe('Accepted');
    expect(v.toDto().responseOverrides).toEqual({});

    await v.setOverride('GetConfiguration', {
      mode: 'error',
      errorCode: 'GenericError',
    });
    await expect(h.csms.call(CP, 'GetConfiguration', {})).rejects.toMatchObject(
      { code: 'GenericError' },
    );

    await v.setOverride('ClearCache', { mode: 'silent' });
    await expect(h.csms.call(CP, 'ClearCache', {}, 300)).rejects.toThrow(
      /timed out/,
    );
    await v.setOverride('ClearCache', null);
    await expect(h.csms.call(CP, 'ClearCache', {})).resolves.toEqual({
      status: 'Accepted',
    });
  });

  it('holds back a status that does not last MinimumStatusDuration', async () => {
    const v = await h.online();
    const carId = await h.car();
    await v.setConfig('MinimumStatusDuration', '5');
    h.csms.clear();
    await h.engine.plug(v.id, 1, carId);
    await h.advance(2);
    await h.engine.unplug(v.id, 1);
    await h.advance(6);
    // Preparing came and went inside the window: only the lasting state is reported.
    expect(h.csms.messages('StatusNotification').map((s) => s.status)).toEqual([
      'Available',
    ]);
  });
});

describe('Local Auth List, cache and reservations', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('SendLocalList / GetLocalListVersion keep the list and its version', async () => {
    const v = await h.online();
    await expect(h.csms.call(CP, 'GetLocalListVersion', {})).resolves.toEqual({
      listVersion: 0,
    });

    await expect(
      h.csms.call(CP, 'SendLocalList', {
        listVersion: 3,
        updateType: 'Full',
        localAuthorizationList: [
          {
            idTag: 'VIP',
            idTagInfo: { status: 'Accepted', parentIdTag: 'FLEET' },
          },
          { idTag: 'BANNED', idTagInfo: { status: 'Blocked' } },
        ],
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await expect(h.csms.call(CP, 'GetLocalListVersion', {})).resolves.toEqual({
      listVersion: 3,
    });

    // A differential update must move the version forward.
    await expect(
      h.csms.call(CP, 'SendLocalList', {
        listVersion: 3,
        updateType: 'Differential',
        localAuthorizationList: [],
      }),
    ).resolves.toEqual({ status: 'VersionMismatch' });
    await expect(
      h.csms.call(CP, 'SendLocalList', {
        listVersion: 4,
        updateType: 'Differential',
        localAuthorizationList: [
          { idTag: 'BANNED' },
          { idTag: 'NEW', idTagInfo: { status: 'Accepted' } },
        ],
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    expect(v.internals().localList).toMatchObject({ version: 4 });
    expect(
      v
        .internals()
        .localList.entries.map((e) => e.idTag)
        .sort(),
    ).toEqual(['NEW', 'VIP']);

    // A full list has to say what every idTag may do.
    await expect(
      h.csms.call(CP, 'SendLocalList', {
        listVersion: 9,
        updateType: 'Full',
        localAuthorizationList: [{ idTag: 'X' }],
      }),
    ).resolves.toEqual({ status: 'Failed' });

    await v.setConfig('LocalAuthListEnabled', 'false');
    await expect(h.csms.call(CP, 'GetLocalListVersion', {})).resolves.toEqual({
      listVersion: -1,
    });
    await expect(
      h.csms.call(CP, 'SendLocalList', {
        listVersion: 10,
        updateType: 'Full',
        localAuthorizationList: [],
      }),
    ).resolves.toEqual({ status: 'NotSupported' });
  });

  it('LocalPreAuthorize starts from the list without asking the CSMS', async () => {
    const v = await h.online();
    const carId = await h.car();
    await v.setConfig('LocalPreAuthorize', 'true');
    await h.csms.call(CP, 'SendLocalList', {
      listVersion: 1,
      updateType: 'Full',
      localAuthorizationList: [
        { idTag: 'VIP', idTagInfo: { status: 'Accepted' } },
        {
          idTag: 'OLD',
          idTagInfo: { status: 'Accepted', expiryDate: '2020-01-01T00:00:00Z' },
        },
      ],
    });
    await h.engine.plug(v.id, 1, carId);
    await h.settle();
    h.csms.clear();
    const tap = await v.presentIdTag('VIP');
    expect(tap.message).toMatch(/list/);
    await h.settle();
    expect(h.csms.actions()).toEqual([
      'StartTransaction',
      'StatusNotification',
    ]);
    await v.pressStop(1);

    // An expired entry is not a local "yes": the CSMS gets the last word.
    h.csms.tagStatus.set('OLD', 'Expired');
    h.csms.clear();
    expect((await v.presentIdTag('OLD')).outcome).toBe('rejected');
    await h.settle();
    expect(h.csms.actions()).toContain('Authorize');
  });

  it('the authorization cache remembers the CSMS and ClearCache empties it', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.settle();
    expect(v.internals().authCache).toEqual([
      {
        idTag: 'CARD-1',
        status: 'Accepted',
        parentIdTag: null,
        expiryDate: null,
      },
    ]);
    await expect(h.csms.call(CP, 'ClearCache', {})).resolves.toEqual({
      status: 'Accepted',
    });
    expect(v.internals().authCache).toEqual([]);
  });

  it('ReserveNow holds a connector for one idTag', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'Type2' }]);
    const carId = await h.car();
    const expiryDate = new Date(h.clock.now() + 600_000).toISOString();
    h.csms.clear();

    await expect(
      h.csms.call(CP, 'ReserveNow', {
        connectorId: 1,
        expiryDate,
        idTag: 'BOOKED',
        reservationId: 11,
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    expect(h.csms.last('StatusNotification')).toMatchObject({
      connectorId: 1,
      status: 'Reserved',
    });
    await expect(
      h.csms.call(CP, 'ReserveNow', {
        connectorId: 1,
        expiryDate,
        idTag: 'OTHER',
        reservationId: 12,
      }),
    ).resolves.toEqual({ status: 'Occupied' });
    await expect(
      h.csms.call(CP, 'ReserveNow', {
        connectorId: 9,
        expiryDate,
        idTag: 'OTHER',
        reservationId: 13,
      }),
    ).resolves.toEqual({ status: 'Rejected' });

    // Somebody else plugs in: the reservation stands.
    await h.engine.plug(v.id, 1, carId);
    expect((await v.presentIdTag('STRANGER', 1)).outcome).toBe('rejected');
    await expect(
      h.csms.call(CP, 'RemoteStartTransaction', {
        connectorId: 1,
        idTag: 'STRANGER',
      }),
    ).resolves.toEqual({ status: 'Rejected' });

    expect((await v.presentIdTag('BOOKED', 1)).outcome).toBe('started');
    await h.settle();
    expect(h.csms.last('StartTransaction')).toMatchObject({
      idTag: 'BOOKED',
      reservationId: 11,
    });
    expect(v.toDto().connectors[0].reservation).toBeNull();
  });

  it('a reservation can be cancelled, expires, and blocks faulted or busy connectors', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'Type2' }]);
    const expiryDate = new Date(h.clock.now() + 30_000).toISOString();

    await h.csms.call(CP, 'ReserveNow', {
      connectorId: 1,
      expiryDate,
      idTag: 'A',
      reservationId: 1,
    });
    await expect(
      h.csms.call(CP, 'CancelReservation', { reservationId: 1 }),
    ).resolves.toEqual({
      status: 'Accepted',
    });
    await expect(
      h.csms.call(CP, 'CancelReservation', { reservationId: 1 }),
    ).resolves.toEqual({
      status: 'Rejected',
    });
    await h.settle();
    expect(v.toDto().connectors[0].status).toBe('Available');

    await h.csms.call(CP, 'ReserveNow', {
      connectorId: 1,
      expiryDate,
      idTag: 'A',
      reservationId: 2,
    });
    await h.settle();
    expect(v.toDto().connectors[0].status).toBe('Reserved');
    await h.advance(31);
    expect(v.toDto().connectors[0].status).toBe('Available');

    await v.setFault(2, { errorCode: 'InternalError' });
    const later = new Date(h.clock.now() + 600_000).toISOString();
    await expect(
      h.csms.call(CP, 'ReserveNow', {
        connectorId: 2,
        expiryDate: later,
        idTag: 'A',
        reservationId: 3,
      }),
    ).resolves.toEqual({ status: 'Faulted' });
    await h.csms.call(CP, 'ChangeAvailability', {
      connectorId: 1,
      type: 'Inoperative',
    });
    await expect(
      h.csms.call(CP, 'ReserveNow', {
        connectorId: 1,
        expiryDate: later,
        idTag: 'A',
        reservationId: 4,
      }),
    ).resolves.toEqual({ status: 'Unavailable' });
  });

  it('a reservation on connector 0 keeps one connector free for its idTag', async () => {
    const v = await h.online(CP, [{ type: 'Type2' }, { type: 'Type2' }]);
    const car1 = await h.car({ name: 'one' });
    const car2 = await h.car({ name: 'two' });
    const expiryDate = new Date(h.clock.now() + 600_000).toISOString();
    await expect(
      h.csms.call(CP, 'ReserveNow', {
        connectorId: 0,
        expiryDate,
        idTag: 'BOOKED',
        reservationId: 5,
      }),
    ).resolves.toEqual({ status: 'Accepted' });

    await h.engine.plug(v.id, 1, car1);
    expect((await v.presentIdTag('WALK-IN', 1)).outcome).toBe('started');
    // One connector is left, and it is spoken for.
    await h.engine.plug(v.id, 2, car2);
    expect((await v.presentIdTag('WALK-IN-2', 2)).outcome).toBe('rejected');
    expect((await v.presentIdTag('BOOKED', 2)).outcome).toBe('started');
    await h.settle();
    expect(h.csms.last('StartTransaction')).toMatchObject({
      connectorId: 2,
      reservationId: 5,
    });
  });
});
