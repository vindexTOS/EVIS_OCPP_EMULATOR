import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EngineService } from '../src/engine/engine.service';
import { EngineErrorFilter } from '../src/libs/engine-error.filter';
import { MockCsms } from './support/mock-csms';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The REST API on a real Nest application, with SQLite in memory and a mock CSMS. */
describe('REST API', () => {
  let app: INestApplication;
  let csms: MockCsms;
  let http: ReturnType<typeof request>;
  const engine = () => app.get(EngineService).engine;

  const until = async (
    condition: () => Promise<boolean> | boolean,
    what: string,
  ) => {
    const deadline = Date.now() + 4000;
    while (!(await condition())) {
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${what}`);
      await sleep(10);
    }
  };

  beforeAll(async () => {
    process.env.SQLITE_PATH = ':memory:';
    process.env.ENGINE_AUTOTICK = 'false';
    csms = new MockCsms();
    await csms.start();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new EngineErrorFilter());
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
    await csms.stop();
  });

  it('starts open, with nothing in it', async () => {
    await http.get('/api/auth/status').expect(200, { locked: false });
    await http.get('/api/charge-points').expect(200, []);
    await http.get('/api/cars').expect(200, []);
    const meta = await http.get('/api/meta').expect(200);
    expect(
      meta.body.connectorTypes.map((t: { type: string }) => t.type),
    ).toContain('CCS2');
  });

  it('validates what it is given', async () => {
    await http.post('/api/charge-points').send({ name: 'x' }).expect(400);
    await http
      .post('/api/charge-points')
      .send({ chargePointId: 'has space' })
      .expect(400);
    await http
      .post('/api/charge-points')
      .send({ chargePointId: 'CP9', connectors: [{ type: 'Garden hose' }] })
      .expect(400);
    await http
      .post('/api/cars')
      .send({ name: 'No port', connectorTypes: [], batteryCapacityWh: 50000 })
      .expect(400);
    await http.get('/api/charge-points/999').expect(404);
    await http.get('/api/sessions/999').expect(404);
  });

  it('runs a whole session and keeps its history', async () => {
    const charger = await http
      .post('/api/charge-points')
      .send({
        name: 'Test twin',
        chargePointId: 'API-1',
        csmsUrl: csms.url(),
        connectors: [{ type: 'Type2', maxPowerW: 22000 }, { type: 'CCS2' }],
      })
      .expect(201);
    const id: number = charger.body.id;
    expect(charger.body).toMatchObject({
      state: 'Off',
      serialNumber: 'API-1',
      resolvedUrl: `${csms.url()}/API-1`,
    });
    expect(
      charger.body.connectors.map((c: any) => [
        c.connectorId,
        c.type,
        c.side,
        c.maxPowerW,
      ]),
    ).toEqual([
      [1, 'Type2', 'left', 22000],
      [2, 'CCS2', 'right', 150000],
    ]);
    await http
      .post('/api/charge-points')
      .send({ chargePointId: 'api-1' })
      .expect(409);

    const car = await http
      .post('/api/cars')
      .send({
        name: 'Hatch',
        connectorTypes: ['Type2'],
        batteryCapacityWh: 50000,
        batteryWh: 10000,
      })
      .expect(201);
    expect(car.body).toMatchObject({ soc: 20, pluggedInto: null });
    const card = await http
      .post('/api/id-tags')
      .send({ label: 'Mine', idTag: 'AB12CD34' })
      .expect(201);
    await http
      .post('/api/id-tags')
      .send({ label: 'Again', idTag: 'AB12CD34' })
      .expect(409);

    await http
      .post(`/api/charge-points/${id}/power`)
      .send({ on: true })
      .expect(200);
    await until(
      async () =>
        (await http.get(`/api/charge-points/${id}`)).body.state === 'Accepted',
      'the boot',
    );

    // The CCS2 cable does not fit this car; the Type 2 one does.
    const wrong = await http
      .post(`/api/charge-points/${id}/connectors/2/plug`)
      .send({ carId: car.body.id })
      .expect(409);
    expect(wrong.body.message).toMatch(/does not fit/);
    const plugged = await http
      .post(`/api/charge-points/${id}/connectors/1/plug`)
      .send({ carId: car.body.id })
      .expect(200);
    expect(plugged.body.connectors[0]).toMatchObject({
      status: 'Preparing',
      carId: car.body.id,
    });
    await http.delete(`/api/cars/${car.body.id}`).expect(409);

    const tap = await http
      .post(`/api/charge-points/${id}/rfid`)
      .send({ idTag: card.body.idTag })
      .expect(200);
    expect(tap.body).toMatchObject({ outcome: 'started', connectorId: 1 });

    await sleep(1100);
    await engine().tick();
    await engine().tick();
    const live = (await http.get(`/api/charge-points/${id}`).expect(200)).body
      .connectors[0];
    expect(live.status).toBe('Charging');
    expect(live.session.energyWh).toBeGreaterThan(0);
    expect(live.telemetry.powerW).toBeGreaterThan(10000);

    const stopped = await http
      .post(`/api/charge-points/${id}/connectors/1/stop`)
      .expect(200);
    expect(stopped.body.connectors[0].status).toBe('Finishing');
    await http.post(`/api/charge-points/${id}/connectors/1/unplug`).expect(200);
    await engine().quiet();

    const sessions = await http
      .get('/api/sessions')
      .query({ chargePointId: id })
      .expect(200);
    expect(sessions.body.total).toBe(1);
    expect(sessions.body.items[0]).toMatchObject({
      connectorId: 1,
      carName: 'Hatch',
      idTag: 'AB12CD34',
      status: 'Stopped',
      stopReason: 'Local',
      startConfirmed: true,
      stopConfirmed: true,
    });
    const detail = await http
      .get(`/api/sessions/${sessions.body.items[0].id}`)
      .expect(200);
    expect(detail.body.samples.map((s: any) => s.context)).toEqual([
      'Transaction.Begin',
      'Transaction.End',
    ]);

    // What each connector delivered.
    const history = await http
      .get(`/api/charge-points/${id}/history`)
      .query({ days: 7, tz: 240 })
      .expect(200);
    expect(history.body.totals.sessions).toBe(1);
    expect(history.body.connectors[0]).toMatchObject({
      connectorId: 1,
      sessions: 1,
    });
    expect(history.body.connectors[0].energyWh).toBe(
      sessions.body.items[0].energyWh,
    );
    expect(history.body.connectors[0].meterWh).toBe(
      sessions.body.items[0].meterStopWh,
    );
    expect(history.body.connectors[1]).toMatchObject({
      connectorId: 2,
      sessions: 0,
      energyWh: 0,
    });
    expect(history.body.daily).toHaveLength(7);
    expect(history.body.daily[6].energyWh).toBe(
      sessions.body.items[0].energyWh,
    );
    expect(history.body.stopReasons).toEqual([{ reason: 'Local', count: 1 }]);

    const events = await http
      .get(`/api/charge-points/${id}/events`)
      .expect(200);
    expect(events.body.map((e: any) => e.type)).toEqual(
      expect.arrayContaining([
        'PowerOn',
        'Connected',
        'Boot',
        'PlugIn',
        'SessionStarted',
        'SessionStopped',
        'PlugOut',
      ]),
    );
    const logs = await http.get(`/api/charge-points/${id}/logs`).expect(200);
    expect(
      logs.body
        .filter((l: any) => l.messageType === 2 && l.direction === 'out')
        .map((l: any) => l.action),
    ).toEqual(
      expect.arrayContaining([
        'BootNotification',
        'Authorize',
        'StartTransaction',
        'StopTransaction',
      ]),
    );
  });

  it('changes a connector type, and only removes the last connector', async () => {
    const id = (await http.get('/api/charge-points').expect(200)).body[0].id;
    const changed = await http
      .patch(`/api/charge-points/${id}/connectors/2`)
      .send({ type: 'CHAdeMO', maxPowerW: 50000, side: 'left' })
      .expect(200);
    expect(changed.body.connectors[1]).toMatchObject({
      type: 'CHAdeMO',
      maxPowerW: 50000,
      side: 'left',
    });

    const added = await http
      .post(`/api/charge-points/${id}/connectors`)
      .send({ type: 'Schuko' })
      .expect(201);
    expect(added.body.connectors[2]).toMatchObject({
      connectorId: 3,
      type: 'Schuko',
      phases: 1,
      maxPowerW: 2300,
    });
    const removed = await http
      .delete(`/api/charge-points/${id}/connectors/last`)
      .expect(200);
    expect(removed.body.connectors).toHaveLength(2);
  });

  it('edits configuration and settings', async () => {
    const id = (await http.get('/api/charge-points').expect(200)).body[0].id;
    const config = await http
      .get(`/api/charge-points/${id}/configuration`)
      .expect(200);
    expect(
      config.body.find((k: any) => k.key === 'NumberOfConnectors'),
    ).toMatchObject({ value: '2', readonly: true });
    await http
      .put(`/api/charge-points/${id}/configuration`)
      .send({ key: 'HeartbeatInterval', value: 'soon' })
      .expect(400);
    const set = await http
      .put(`/api/charge-points/${id}/configuration`)
      .send({ key: 'VendorThing', value: 'on' })
      .expect(200);
    expect(
      set.body.configuration.find((k: any) => k.key === 'VendorThing'),
    ).toMatchObject({ custom: true, value: 'on' });
    await http
      .delete(`/api/charge-points/${id}/configuration/VendorThing`)
      .expect(200);
    await http
      .delete(`/api/charge-points/${id}/configuration/HeartbeatInterval`)
      .expect(409);

    const updated = await http
      .patch(`/api/charge-points/${id}`)
      .send({ name: 'Renamed', speed: 20 })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Renamed', speed: 20 });
    await http.patch(`/api/charge-points/${id}`).send({ speed: 0 }).expect(400);

    const call = await http
      .post(`/api/charge-points/${id}/ocpp/call`)
      .send({ action: 'Heartbeat' })
      .expect(200);
    expect(call.body.result.currentTime).toBeDefined();
  });

  it('deletes a charger together with its history', async () => {
    const id = (await http.get('/api/charge-points').expect(200)).body[0].id;
    await http
      .delete(`/api/charge-points/${id}`)
      .expect(200, { deleted: true });
    await http.get('/api/charge-points').expect(200, []);
    expect((await http.get('/api/sessions').expect(200)).body.total).toBe(0);
    await until(() => !csms.connected('API-1'), 'the charger to hang up');
  });
});
