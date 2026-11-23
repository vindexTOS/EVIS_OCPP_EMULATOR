import { ChargingSession, MeterSample } from '../src/entities';
import { Harness, createHarness } from './support/harness';

describe('transactions', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  const statuses = (connectorId = 1) =>
    h.csms
      .messages('StatusNotification')
      .filter((s) => s.connectorId === connectorId)
      .map((s) => s.status);

  it('runs the whole story: plug in, tap, charge, tap, unplug', async () => {
    const v = await h.online();
    const carId = await h.car();
    h.csms.clear();

    await h.engine.plug(v.id, 1, carId);
    await h.settle();
    expect(statuses()).toEqual(['Preparing']);

    const tap = await v.presentIdTag('CARD-1');
    expect(tap).toMatchObject({ outcome: 'started', connectorId: 1 });
    await h.settle();
    expect(h.csms.actions()).toEqual([
      'StatusNotification',
      'Authorize',
      'StartTransaction',
      'StatusNotification',
    ]);
    const start = h.csms.last('StartTransaction');
    expect(start).toMatchObject({
      connectorId: 1,
      idTag: 'CARD-1',
      meterStart: 0,
    });
    expect(statuses()).toEqual(['Preparing', 'Charging']);
    expect(v.toDto().connectors[0].session).toMatchObject({
      transactionId: 1,
      startConfirmed: true,
      idTagStatus: 'Accepted',
    });
    expect(v.toDto().connectors[0].locked).toBe(true);

    // 11 kW on-board charger on a 22 kW outlet: the car is the limit.
    await h.advance(60);
    const live = v.toDto().connectors[0];
    expect(live.telemetry.powerW).toBe(11000);
    expect(live.telemetry.phases).toBe(3);
    expect(live.telemetry.currentA).toBeCloseTo(15.9, 1);
    expect(live.session!.energyWh).toBeCloseTo((11000 * 60) / 3600, 0);

    const meterValues = h.csms.messages('MeterValues');
    expect(meterValues).toHaveLength(4); // every 15 s
    expect(meterValues[0]).toMatchObject({ connectorId: 1, transactionId: 1 });
    const sampled = meterValues[3].meterValue[0].sampledValue;
    expect(sampled.map((s: any) => s.measurand)).toEqual([
      'Energy.Active.Import.Register',
      'Power.Active.Import',
      'Current.Import',
      'Voltage',
      'SoC',
    ]);
    expect(sampled[0]).toMatchObject({
      unit: 'Wh',
      context: 'Sample.Periodic',
      location: 'Outlet',
    });
    expect(Number(sampled[0].value)).toBeCloseTo(183, 0);
    expect(sampled[1].value).toBe('11000');

    const stop = await v.presentIdTag('CARD-1');
    expect(stop.outcome).toBe('stopped');
    await h.settle();
    const stopTx = h.csms.last('StopTransaction');
    expect(stopTx).toMatchObject({
      transactionId: 1,
      reason: 'Local',
      idTag: 'CARD-1',
    });
    expect(stopTx.meterStop).toBe(183);
    expect(statuses()).toEqual(['Preparing', 'Charging', 'Finishing']);
    expect(v.toDto().connectors[0].locked).toBe(false);

    await h.engine.unplug(v.id, 1);
    await h.settle();
    expect(statuses()).toEqual([
      'Preparing',
      'Charging',
      'Finishing',
      'Available',
    ]);

    // The session is history now, with its readings.
    const session = await h.dataSource
      .getRepository(ChargingSession)
      .findOneByOrFail({ id: 1 });
    expect(session).toMatchObject({
      status: 'Stopped',
      stopReason: 'Local',
      meterStartWh: 0,
      meterStopWh: 183,
      energyWh: 183,
      startConfirmed: true,
      stopConfirmed: true,
      carName: 'Test car',
    });
    const samples = await h.dataSource
      .getRepository(MeterSample)
      .find({ where: { sessionId: 1 } });
    expect(samples.map((s) => s.context)).toEqual([
      'Transaction.Begin',
      'Sample.Periodic',
      'Sample.Periodic',
      'Sample.Periodic',
      'Sample.Periodic',
      'Transaction.End',
    ]);
    // The car really got the energy (minus conversion losses).
    expect(h.engine.car(carId)!.batteryWh).toBeCloseTo(12000 + 183.3 * 0.92, 0);
  });

  it('accepts the card first and then waits for the cable', async () => {
    const v = await h.online();
    const carId = await h.car();
    h.csms.clear();

    const tap = await v.presentIdTag('CARD-1');
    expect(tap.outcome).toBe('authorized');
    await h.settle();
    expect(statuses()).toEqual(['Preparing']);
    expect(h.csms.messages('StartTransaction')).toHaveLength(0);

    await h.engine.plug(v.id, 1, carId);
    await h.settle();
    expect(h.csms.messages('StartTransaction')).toHaveLength(1);
    expect(statuses()).toEqual(['Preparing', 'Charging']);
  });

  it('drops the authorization when nobody plugs in within ConnectionTimeOut', async () => {
    const v = await h.online();
    await v.setConfig('ConnectionTimeOut', '10');
    h.csms.clear();
    await v.presentIdTag('CARD-1');
    await h.advance(9);
    expect(v.toDto().connectors[0].status).toBe('Preparing');
    await h.advance(2);
    expect(v.toDto().connectors[0].status).toBe('Available');
    expect(statuses()).toEqual(['Preparing', 'Available']);
  });

  it('refuses a card the CSMS does not accept', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    h.csms.tagStatus.set('STOLEN', 'Blocked');
    const tap = await v.presentIdTag('STOLEN');
    expect(tap).toMatchObject({ outcome: 'rejected', status: 'Blocked' });
    await h.settle();
    expect(h.csms.messages('StartTransaction')).toHaveLength(0);
    expect(v.toDto().connectors[0].status).toBe('Preparing');
  });

  it('lets only the starting card, or one of its group, stop the transaction', async () => {
    const v = await h.online();
    const carId = await h.car();
    h.csms.parentOf.set('CARD-1', 'FLEET');
    h.csms.parentOf.set('CARD-2', 'FLEET');
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.settle();

    expect((await v.presentIdTag('STRANGER', 1)).outcome).toBe('rejected');
    expect(v.toDto().connectors[0].session).not.toBeNull();

    expect((await v.presentIdTag('CARD-2', 1)).outcome).toBe('stopped');
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      idTag: 'CARD-2',
      reason: 'Local',
    });
  });

  it('stops with DeAuthorized when StartTransaction.conf rejects the idTag', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    // Authorize says yes, StartTransaction says the card already has a transaction.
    h.csms.handlers.set('StartTransaction', () => ({
      transactionId: 77,
      idTagInfo: { status: 'ConcurrentTx' },
    }));
    await v.presentIdTag('CARD-1');
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      transactionId: 77,
      reason: 'DeAuthorized',
    });
    expect(v.toDto().connectors[0].status).toBe('Finishing');
  });

  it('keeps the transaction but stops the energy when StopTransactionOnInvalidId is off', async () => {
    const v = await h.online();
    const carId = await h.car();
    await v.setConfig('StopTransactionOnInvalidId', 'false');
    await v.setConfig('MaxEnergyOnInvalidId', '50');
    await h.engine.plug(v.id, 1, carId);
    h.csms.handlers.set('StartTransaction', () => ({
      transactionId: 5,
      idTagInfo: { status: 'Invalid' },
    }));
    await v.presentIdTag('CARD-1');
    await h.settle(); // the rejection has arrived; the allowance counts from here
    await h.advance(60);
    const c = v.toDto().connectors[0];
    expect(c.status).toBe('SuspendedEVSE');
    expect(c.session!.deauthorized).toBe(true);
    expect(c.session!.energyWh).toBeCloseTo(50, 0);
    expect(h.csms.messages('StopTransaction')).toHaveLength(0);
  });

  it('starts and stops on RemoteStartTransaction / RemoteStopTransaction', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await h.settle();
    h.csms.clear();

    await expect(
      h.csms.call('CP001', 'RemoteStartTransaction', {
        connectorId: 1,
        idTag: 'APP-USER',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    // AuthorizeRemoteTxRequests is false by default: no Authorize round trip.
    expect(h.csms.actions()).toEqual([
      'StartTransaction',
      'StatusNotification',
    ]);
    expect(h.csms.last('StartTransaction')).toMatchObject({
      connectorId: 1,
      idTag: 'APP-USER',
    });
    const transactionId = v.toDto().connectors[0].session!.transactionId;

    await expect(
      h.csms.call('CP001', 'RemoteStopTransaction', { transactionId: 9999 }),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(
      h.csms.call('CP001', 'RemoteStopTransaction', { transactionId }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      transactionId,
      reason: 'Remote',
    });
    expect(h.csms.last('StopTransaction').idTag).toBeUndefined();
  });

  it('picks the plugged connector when a remote start names none, and waits for a cable otherwise', async () => {
    const v = await h.online('CP001', [{ type: 'Type2' }, { type: 'Type2' }]);
    const carId = await h.car();
    await h.engine.plug(v.id, 2, carId);
    await h.csms.call('CP001', 'RemoteStartTransaction', { idTag: 'APP' });
    await h.settle();
    expect(h.csms.last('StartTransaction').connectorId).toBe(2);

    // Connector 1 has no car: the charger authorizes and waits.
    await expect(
      h.csms.call('CP001', 'RemoteStartTransaction', {
        connectorId: 1,
        idTag: 'APP2',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    expect(v.toDto().connectors[0]).toMatchObject({ status: 'Preparing' });
    expect(v.toDto().connectors[0].pending).toMatchObject({
      idTag: 'APP2',
      startedBy: 'Remote',
    });

    // A connector in use refuses a second remote start.
    await expect(
      h.csms.call('CP001', 'RemoteStartTransaction', {
        connectorId: 2,
        idTag: 'APP3',
      }),
    ).resolves.toEqual({ status: 'Rejected' });
    await expect(
      h.csms.call('CP001', 'RemoteStartTransaction', {
        connectorId: 7,
        idTag: 'APP3',
      }),
    ).resolves.toEqual({ status: 'Rejected' });
  });

  it('asks the CSMS first when AuthorizeRemoteTxRequests is on', async () => {
    const v = await h.online();
    const carId = await h.car();
    await v.setConfig('AuthorizeRemoteTxRequests', 'true');
    await h.engine.plug(v.id, 1, carId);
    await h.settle();
    h.csms.clear();
    h.csms.tagStatus.set('EXPIRED-USER', 'Expired');

    await expect(
      h.csms.call('CP001', 'RemoteStartTransaction', {
        connectorId: 1,
        idTag: 'EXPIRED-USER',
      }),
    ).resolves.toEqual({ status: 'Accepted' });
    await h.settle();
    expect(h.csms.actions()).toEqual(['Authorize']);

    await h.csms.call('CP001', 'RemoteStartTransaction', {
      connectorId: 1,
      idTag: 'GOOD-USER',
    });
    await h.settle();
    expect(h.csms.actions().slice(1)).toEqual([
      'Authorize',
      'StartTransaction',
      'StatusNotification',
    ]);
  });

  it('ends the transaction with EVDisconnected when the cable is pulled from the car', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(20);
    await h.engine.unplug(v.id, 1);
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      reason: 'EVDisconnected',
    });
    // No cable left in the car: straight back to Available, no Finishing.
    expect(statuses().slice(-2)).toEqual(['Charging', 'Available']);
    expect(h.engine.listCars()[0].pluggedInto).toBeNull();
  });

  it('keeps the transaction open across an unplug when StopTransactionOnEVSideDisconnect is off', async () => {
    const v = await h.online();
    const carId = await h.car();
    await v.setConfig('StopTransactionOnEVSideDisconnect', 'false');
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(10);
    await h.engine.unplug(v.id, 1);
    await h.settle();
    expect(v.toDto().connectors[0].status).toBe('SuspendedEV');
    expect(h.csms.messages('StopTransaction')).toHaveLength(0);

    await h.engine.plug(v.id, 1, carId);
    await h.advance(2);
    expect(v.toDto().connectors[0].status).toBe('Charging');
    expect(statuses().slice(-3)).toEqual([
      'Charging',
      'SuspendedEV',
      'Charging',
    ]);
  });

  it('idles in SuspendedEV on AC when the battery is full, and resumes when it is not', async () => {
    const v = await h.online();
    const carId = await h.car({ batteryCapacityWh: 10000, batteryWh: 9950 });
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(120);
    const c = v.toDto().connectors[0];
    expect(c.status).toBe('SuspendedEV');
    expect(c.session).not.toBeNull();
    expect(c.telemetry.powerW).toBe(0);
    expect(h.engine.car(carId)!.batteryWh).toBeCloseTo(10000, 3);
    expect(h.csms.messages('StopTransaction')).toHaveLength(0);

    await h.engine.setBattery(carId, 50);
    await h.advance(2);
    expect(v.toDto().connectors[0].status).toBe('Charging');
  });

  it('ends a DC session by itself when the car is done', async () => {
    const v = await h.online('CP001', [{ type: 'CCS2', maxPowerW: 150000 }]);
    const carId = await h.car({
      batteryCapacityWh: 60000,
      batteryWh: 47000,
      targetSoc: 80,
    });
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(3);
    const live = v.toDto().connectors[0];
    expect(live.status).toBe('Charging');
    expect(live.telemetry.phases).toBe(0);
    // DC: tapered power at 78 % and a pack-voltage reading instead of 230 V.
    expect(live.telemetry.powerW).toBeGreaterThan(50000);
    expect(live.telemetry.powerW).toBeLessThan(150000);
    expect(live.telemetry.voltageV).toBeGreaterThan(350);

    await h.advance(120);
    expect(h.csms.last('StopTransaction')).toMatchObject({ reason: 'Other' });
    expect(h.engine.listCars()[0].soc).toBeCloseTo(80, 1);
    expect(v.toDto().connectors[0].status).toBe('Finishing');
  });

  it('honours the stop button, auto-start and the simulation speed', async () => {
    const v = await h.online('CP001', undefined, {
      autoStart: 'plug',
      defaultIdTag: 'FREE',
      speed: 60,
    });
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await h.settle();
    expect(h.csms.last('StartTransaction')).toMatchObject({ idTag: 'FREE' });
    await h.advance(60);
    // One minute at 60x is an hour of charging at 11 kW.
    expect(v.toDto().connectors[0].session!.energyWh).toBeCloseTo(11000, -1);
    await v.pressStop(1);
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({ reason: 'Local' });
    expect(h.csms.last('StopTransaction').idTag).toBeUndefined();
  });

  it('charges a single-phase car on a three-phase outlet at one third of the power', async () => {
    const v = await h.online();
    const carId = await h.car({ maxAcPowerW: 7400, acPhases: 1 });
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(2);
    const t = v.toDto().connectors[0].telemetry;
    expect(t.phases).toBe(1);
    // A 22 kW outlet gives 31.9 A per phase; the car uses one of the three.
    expect(t.powerW).toBe(7333);
    expect(t.currentA).toBe(31.9);
  });

  it('will not take a plug that does not fit, or a car that is plugged in elsewhere', async () => {
    const v = await h.online('CP001', [{ type: 'CHAdeMO' }, { type: 'Type2' }]);
    const carId = await h.car({ connectorTypes: ['Type2'] });
    await expect(h.engine.plug(v.id, 1, carId)).rejects.toThrow(/does not fit/);
    await h.engine.plug(v.id, 2, carId);
    const other = await h.online('CP002');
    await expect(h.engine.plug(other.id, 1, carId)).rejects.toThrow(
      /already plugged/,
    );
    await expect(h.engine.deleteCar(carId)).rejects.toThrow(/Unplug it first/);
  });

  it('adds the readings to StopTransaction when StopTxnSampledData is set', async () => {
    const v = await h.online();
    const carId = await h.car();
    await v.setConfig(
      'StopTxnSampledData',
      'Energy.Active.Import.Register,SoC',
    );
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(31);
    await v.pressStop(1);
    await h.settle();
    const data = h.csms.last('StopTransaction').transactionData;
    expect(data.map((d: any) => d.sampledValue[0].context)).toEqual([
      'Transaction.Begin',
      'Sample.Periodic',
      'Sample.Periodic',
      'Transaction.End',
    ]);
    expect(data[0].sampledValue.map((s: any) => s.measurand)).toEqual([
      'Energy.Active.Import.Register',
      'SoC',
    ]);
  });
});

describe('offline behaviour', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('queues transaction messages while offline and delivers them in order afterwards', async () => {
    const v = await h.online();
    const carId = await h.car();
    // The card is known from an earlier visit, so it is in the authorization cache.
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.settle();
    await v.pressStop(1);
    await h.engine.unplug(v.id, 1);
    await h.settle();

    await v.setNetwork(false);
    h.csms.clear();
    await h.engine.plug(v.id, 1, carId);
    const tap = await v.presentIdTag('CARD-1');
    expect(tap).toMatchObject({ outcome: 'started' });
    expect(tap.message).toMatch(/cache/);
    await h.advance(31);
    await v.pressStop(1);
    await h.settle();
    expect(h.csms.received).toHaveLength(0);
    expect(v.toDto().queueLength).toBe(4); // Start, 2 x MeterValues, Stop

    await v.setNetwork(true);
    await h.until(() => v.state === 'Accepted');
    await h.settle();
    const delivered = h.csms
      .actions()
      .filter((a) => !['BootNotification', 'StatusNotification'].includes(a));
    expect(delivered).toEqual([
      'StartTransaction',
      'MeterValues',
      'MeterValues',
      'StopTransaction',
    ]);
    // The id the CSMS handed out late is used for everything queued behind the start.
    const txId = h.csms.last('StartTransaction') && 2;
    expect(h.csms.messages('MeterValues').map((m) => m.transactionId)).toEqual([
      txId,
      txId,
    ]);
    expect(h.csms.last('StopTransaction').transactionId).toBe(txId);
    expect(v.toDto().queueLength).toBe(0);
    // Timestamps are from when things happened, not from when they were delivered.
    const startedAt = Date.parse(h.csms.last('StartTransaction').timestamp);
    const stoppedAt = Date.parse(h.csms.last('StopTransaction').timestamp);
    expect(stoppedAt - startedAt).toBe(31000);
  });

  it('refuses an unknown card offline unless AllowOfflineTxForUnknownId is on', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await v.setNetwork(false);
    expect((await v.presentIdTag('NEVER-SEEN')).outcome).toBe('rejected');
    await v.setConfig('AllowOfflineTxForUnknownId', 'true');
    expect((await v.presentIdTag('NEVER-SEEN')).outcome).toBe('started');
  });

  it('retries a transaction message the CSMS fails to process, then gives up', async () => {
    const v = await h.online();
    const carId = await h.car();
    await v.setConfig('TransactionMessageAttempts', '3');
    await v.setConfig('TransactionMessageRetryInterval', '5');
    await v.setConfig('MeterValueSampleInterval', '0');
    await h.engine.plug(v.id, 1, carId);
    h.csms.failing.set('StartTransaction', 'InternalError');
    await v.presentIdTag('CARD-1');
    await h.settle();
    expect(h.csms.messages('StartTransaction')).toHaveLength(1);
    await h.advance(6); // first retry after 1 x 5 s
    expect(h.csms.messages('StartTransaction')).toHaveLength(2);
    await h.advance(11); // second retry after 2 x 5 s
    expect(h.csms.messages('StartTransaction')).toHaveLength(3);
    await h.advance(30);
    expect(h.csms.messages('StartTransaction')).toHaveLength(3);
    expect(v.toDto().queueLength).toBe(0);
    // Energy kept flowing: the charger does not hold the driver hostage to the backend.
    expect(v.toDto().connectors[0].session!.energyWh).toBeGreaterThan(100);
  });

  it('reports a transaction that was cut off by a power loss after the next boot', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(30);
    const txId = v.toDto().connectors[0].session!.transactionId;
    h.csms.clear();

    await v.powerOff();
    await h.settle();
    expect(h.csms.messages('StopTransaction')).toHaveLength(0);
    await v.powerOn();
    await h.until(() => v.state === 'Accepted');
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      transactionId: txId,
      reason: 'PowerLoss',
    });
    expect(v.toDto().connectors[0].status).toBe('Finishing');
  });

  it('treats a killed emulator process as a power cut', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(30);
    const txId = v.toDto().connectors[0].session!.transactionId;
    h.csms.clear();

    const engine = await h.restartEngine();
    const revived = engine.get(v.id);
    await h.until(() => revived.state === 'Accepted');
    await h.settle();
    expect(h.csms.last('StopTransaction')).toMatchObject({
      transactionId: txId,
      reason: 'PowerLoss',
    });
    expect(revived.toDto().connectors[0]).toMatchObject({
      status: 'Finishing',
      carId,
    });
    const session = await h.dataSource
      .getRepository(ChargingSession)
      .findOneByOrFail({ id: 1 });
    expect(session).toMatchObject({
      status: 'Stopped',
      stopReason: 'PowerLoss',
    });
    // The meter did not lose what it had counted.
    expect(revived.toDto().connectors[0].meterWh).toBe(session.meterStopWh);
  });
});

describe('edges', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('does not start a transaction when the power is cut while the card is being checked', async () => {
    const v = await h.online();
    const carId = await h.car();
    await h.engine.plug(v.id, 1, carId);
    // The CSMS takes its time with Authorize; meanwhile the power goes.
    h.csms.silent.add('Authorize');
    const tap = v.presentIdTag('CARD-1');
    await h.until(
      () => h.csms.messages('Authorize').length === 1,
      'the Authorize request',
    );
    await v.powerOff();
    await expect(tap).resolves.toMatchObject({ outcome: 'rejected' });
    expect(v.toDto().connectors[0].session).toBeNull();
    expect(await h.dataSource.getRepository(ChargingSession).count()).toBe(0);
  });

  it('recomputes the allowed power as soon as the car or the connector changes', async () => {
    const v = await h.online();
    const carId = await h.car({ maxAcPowerW: 11000 });
    await h.engine.plug(v.id, 1, carId);
    await v.presentIdTag('CARD-1');
    await h.advance(2);
    expect(v.toDto().connectors[0].telemetry.powerW).toBe(11000);

    // The car now has a single-phase 16 A on-board charger.
    await h.engine.updateCar(carId, { maxAcPowerW: 3700, acPhases: 1 });
    await h.advance(1);
    expect(v.toDto().connectors[0].telemetry).toMatchObject({
      powerW: 3700,
      phases: 1,
    });

    // A weaker outlet than the car (10 A, single phase): now the connector is the limit.
    await v.updateConnector(1, { maxPowerW: 2300 });
    await h.advance(1);
    expect(v.toDto().connectors[0]).toMatchObject({ phases: 1 });
    expect(v.toDto().connectors[0].telemetry).toMatchObject({
      powerW: 2300,
      currentA: 10,
    });
  });

  it('keeps connector ids contiguous and refuses to remove an occupied connector', async () => {
    const v = await h.online('CP001', [{ type: 'Type2' }, { type: 'CCS2' }]);
    const carId = await h.car();
    await h.engine.plug(v.id, 2, carId);
    await expect(v.removeLastConnector()).rejects.toThrow(/Unplug the car/);
    await expect(v.updateConnector(2, { type: 'CHAdeMO' })).rejects.toThrow(
      /Unplug the car/,
    );
    await h.engine.unplug(v.id, 2);
    await v.removeLastConnector();
    await expect(v.removeLastConnector()).rejects.toThrow(
      /at least one connector/,
    );
    await v.addConnector({ type: 'Schuko' });
    expect(v.toDto().connectors.map((c) => [c.connectorId, c.type])).toEqual([
      [1, 'Type2'],
      [2, 'Schuko'],
    ]);
    const conf = await h.csms.call('CP001', 'GetConfiguration', {
      key: ['NumberOfConnectors'],
    });
    expect(conf.configurationKey[0].value).toBe('2');
  });
});
