import {
  AuthEntry,
  Car,
  ChargePoint,
  ChargerEvent,
  ChargingProfile,
  ChargingSession,
  Connector,
  OcppLog,
  QueuedMessage,
  Reservation,
} from '../entities';
import type { ResponseOverride } from '../entities/charge-point.entity';
import type { EventSeverity } from '../entities/charger-event.entity';
import {
  Availability,
  AuthorizationStatus,
  CONNECTOR_TYPE_INFO,
  ConnectionState,
  ConnectorStatus,
  ConnectorType,
  ErrorCode,
  StartedBy,
  StopReason,
  isDc,
} from '../entities/enums';
import { CsmsRequests } from './csms-requests';
import { FirmwareManager } from './firmware';
import { defaultConfiguration } from './ocpp16/config-keys';
import { ChangeResult, ConfigStore } from './ocpp16/config-store';
import {
  MeterReading,
  ReadingContext,
  buildSampledValues,
} from './ocpp16/meter';
import type {
  AuthorizeConf,
  BootNotificationConf,
  ChargingProfileReq,
  HeartbeatConf,
  IdTagInfo,
  StartTransactionConf,
  StopTransactionConf,
} from './ocpp16/messages';
import { ActiveLimit, selectLimit } from './ocpp16/smart-charging';
import { validateRequest } from './ocpp16/validators';
import {
  FrameEvent,
  NotConnectedError,
  OcppError,
  OcppErrorCode,
} from './rpc/ocpp-message';
import { CloseInfo, NO_REPLY, RpcClient } from './rpc/rpc-client';
import {
  AC_VOLTAGE,
  MIN_AC_CURRENT,
  MIN_DC_POWER,
  chargeRequest,
  currentFor,
  efficiency,
  limitToWatts,
  outletVoltage,
  reachedTarget,
  socPercent,
  wattsToLimit,
} from './sim/physics';
import {
  ChargePointDto,
  ConnectorDto,
  ENGINE_EVENTS,
  EngineError,
  EngineHost,
  EventDto,
  OcppLogDto,
  ReservationDto,
  TapResult,
  TelemetryDto,
} from './types';

/** A tick never accounts for more than this, so a sleeping laptop does not "charge". */
const MAX_TICK_MS = 10_000;
const AUTH_STATUSES: AuthorizationStatus[] = [
  'Accepted',
  'Blocked',
  'Expired',
  'Invalid',
  'ConcurrentTx',
];

export interface AuthDecision {
  status: AuthorizationStatus;
  parentIdTag: string | null;
  source: 'csms' | 'list' | 'cache' | 'offline';
}

/** Everything known about who is allowed to start a transaction. */
export interface StartAuth {
  idTag: string;
  parentIdTag: string | null;
  startedBy: StartedBy;
  reservation: Reservation | null;
  /** The TxProfile that came with a RemoteStartTransaction. */
  profile: ChargingProfileReq | null;
}

export interface PendingAuth extends StartAuth {
  until: number;
}

/** A connector as it lives in memory: the stored row plus what is going on right now. */
export interface ConnectorRt {
  entity: Connector;
  session: ChargingSession | null;
  /** Authorized, waiting for the cable. */
  pending: PendingAuth | null;
  /** idTag being checked with the CSMS. */
  authorizing: string | null;
  /** The CSMS rejected the idTag of the running transaction, and it was not stopped. */
  deauthorized: boolean;
  deauthEnergyWh: number;
  evSuspended: boolean;
  evseSuspended: boolean;
  telemetry: TelemetryDto;
  nextSampleAt: number;
  lastSampleWh: number;
  /** The status changed while it could not be reported. */
  statusDirty: boolean;
  dirty: boolean;
}

interface Timer {
  at: number;
  fn: () => void | Promise<void>;
}

export type After = (fn: () => void | Promise<void>) => void;

/**
 * Handles one CSMS request. It is only called once validateRequest() has
 * checked the payload against the request's schema.
 */
export type RequestHandler = (
  req: Record<string, unknown>,
  after: After,
) => unknown;

const round1 = (n: number) => Math.round(n * 10) / 10;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The URL a charger really dials. Throws when the configured one is unusable. */
export function resolveCsmsUrl(
  cp: Pick<ChargePoint, 'csmsUrl' | 'appendIdToUrl' | 'chargePointId'>,
): string {
  let raw = (cp.csmsUrl ?? '').trim();
  if (!raw) throw new Error('No CSMS URL is configured');
  if (/^https?:\/\//i.test(raw)) raw = raw.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(raw)) raw = `ws://${raw}`;
  const url = new URL(raw);
  if (cp.appendIdToUrl) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(cp.chargePointId)}`;
  }
  return url.toString();
}

export function defaultPhases(type: ConnectorType, maxPowerW: number): number {
  const info = CONNECTOR_TYPE_INFO[type];
  if (info.current === 'DC') return 3;
  if (info.maxPhases === 1) return 1;
  return maxPowerW > 7400 ? 3 : 1;
}

/**
 * One emulated charge point.
 *
 * It is an actor: every state change runs through run(), one at a time, so a
 * tick, a CSMS request and a click in the UI never interleave. Network round
 * trips are never awaited inside run(); their answers come back as new jobs.
 */
export class VirtualChargePoint {
  readonly connectors: ConnectorRt[] = [];
  readonly config: ConfigStore;
  readonly requests: CsmsRequests;
  readonly firmware: FirmwareManager;

  state: ConnectionState = 'Off';
  rpc: RpcClient | null = null;
  profiles: ChargingProfile[] = [];
  reservations: Reservation[] = [];
  /** Connectors are out of service while firmware installs. */
  maintenance = false;
  /** Set by a configuration write that only takes effect on a fresh connection. */
  pendingReconnect: string | null = null;
  readonly authList = new Map<string, AuthEntry>();
  readonly authCache = new Map<string, AuthEntry>();

  private chain: Promise<unknown> = Promise.resolve();
  private logChain: Promise<unknown> = Promise.resolve();
  private logCount = 0;
  private readonly timers = new Map<string, Timer>();
  private queue: QueuedMessage[] = [];
  private queueSending = false;
  private queueRetryAt = 0;
  /** CSMS transactionId per session, once StartTransaction.conf has arrived. */
  private readonly txIds = new Map<number, number>();
  private pendingEvents: ChargerEvent[] = [];
  private everAccepted = false;
  /** The charger has powered up or restarted and not yet been accepted. */
  private startingUp = true;
  private clockOffsetMs = 0;
  private lastTickAt = 0;
  private nextHeartbeatAt = 0;
  private alignedSlot: number | null = null;
  private stateSince: number;
  /** Connectors that are drawing power, for sharing a ChargePointMaxProfile. */
  private drawing = 1;
  private conn = {
    lastError: null as string | null,
    attempt: 0,
    nextRetryAt: null as number | null,
    bootRetryAt: null as number | null,
    protocol: null as string | null,
  };
  private cpDirty = false;
  private dirty = false;
  private disposed = false;

  constructor(
    public cp: ChargePoint,
    readonly host: EngineHost,
  ) {
    if (!cp.configuration) cp.configuration = defaultConfiguration();
    this.stateSince = host.clock.now();
    this.config = new ConfigStore(
      cp.configuration,
      {
        read: (key) => this.readDynamicKey(key),
        write: (key, value) => this.writeDynamicKey(key, value),
      },
      (key) => this.onConfigChanged(key),
    );
    this.requests = new CsmsRequests(this);
    this.firmware = new FirmwareManager(this);
  }

  // ---------------------------------------------------------------- basics

  get id() {
    return this.cp.id;
  }

  now() {
    return this.host.clock.now();
  }

  /** A timestamp as this charger would write it (its clock follows the CSMS). */
  ts(at = this.now()): string {
    return new Date(at + this.clockOffsetMs).toISOString();
  }

  /** Online and accepted by the CSMS: free to send its own messages. */
  get registered() {
    return this.state === 'Accepted' && !!this.rpc?.connected;
  }

  get online() {
    return !!this.rpc?.connected;
  }

  /** True when nothing is in flight: used by tests to wait for quiet. */
  get idle() {
    return (!this.rpc || this.rpc.idle) && !this.queueSending;
  }

  /** Resolves once every job queued so far has run. */
  settled(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  /** Queue a job. Jobs run strictly one after the other. */
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.chain
      .then(() => {
        if (this.disposed)
          throw new EngineError('This charger no longer exists.', 'not-found');
        return fn();
      })
      .finally(() => this.flush());
    this.chain = result.catch((err) => {
      if (err instanceof EngineError || err instanceof OcppError) return;
      this.host.warn(
        `[${this.cp.chargePointId}] ${(err as Error)?.stack ?? err}`,
      );
    });
    return result;
  }

  markDirty() {
    this.dirty = true;
  }

  markCpDirty() {
    this.cpDirty = true;
    this.dirty = true;
  }

  /** Write what the last job changed, then tell the UI. */
  private async flush() {
    if (this.disposed) return;
    const { db } = this.host;
    try {
      if (this.cpDirty) {
        this.cpDirty = false;
        await db.chargePoints.save(this.cp);
      }
      for (const c of this.connectors) {
        if (!c.dirty) continue;
        c.dirty = false;
        await db.connectors.save(c.entity);
      }
      if (this.pendingEvents.length) {
        const events = this.pendingEvents;
        this.pendingEvents = [];
        await db.events.save(events);
        for (const event of events) {
          this.host.emit(
            ENGINE_EVENTS.event,
            VirtualChargePoint.eventDto(event),
          );
        }
      }
    } catch (err) {
      this.host.warn(
        `[${this.cp.chargePointId}] could not persist: ${(err as Error).message}`,
      );
    }
    if (this.dirty) {
      this.dirty = false;
      this.host.emit(ENGINE_EVENTS.chargePoint, this.toDto());
    }
  }

  setTimer(key: string, delayMs: number, fn: () => void | Promise<void>) {
    this.timers.set(key, { at: this.now() + Math.max(0, delayMs), fn });
  }

  clearTimer(key: string) {
    this.timers.delete(key);
  }

  hasTimer(key: string) {
    return this.timers.has(key);
  }

  private async runTimers(now: number) {
    for (const [key, timer] of [...this.timers]) {
      if (timer.at > now || this.timers.get(key) !== timer) continue;
      this.timers.delete(key);
      await timer.fn();
    }
  }

  /** Add a line to the charger's logbook. */
  event(
    type: string,
    message: string,
    severity: EventSeverity = 'info',
    c?: ConnectorRt | null,
    data?: unknown,
  ) {
    this.pendingEvents.push(
      this.host.db.events.create({
        chargePointId: this.cp.id,
        connectorId: c ? c.entity.connectorId : null,
        ts: new Date(this.now()),
        type,
        severity,
        message,
        data: data ?? null,
      }),
    );
  }

  static eventDto(e: ChargerEvent): EventDto {
    return {
      id: e.id,
      chargePointId: e.chargePointId,
      connectorId: e.connectorId,
      ts: e.ts.toISOString(),
      type: e.type,
      severity: e.severity,
      message: e.message,
      data: e.data ?? null,
    };
  }

  static logDto(l: OcppLog): OcppLogDto {
    return {
      id: l.id,
      chargePointId: l.chargePointId,
      ts: l.ts.toISOString(),
      direction: l.direction,
      messageType: l.messageType,
      action: l.action,
      messageId: l.messageId,
      payload: l.payload ?? null,
    };
  }

  connector(connectorId: number): ConnectorRt | undefined {
    return this.connectors.find((c) => c.entity.connectorId === connectorId);
  }

  private need(connectorId: number): ConnectorRt {
    const c = this.connector(connectorId);
    if (!c)
      throw new EngineError(
        `Connector ${connectorId} does not exist.`,
        'not-found',
      );
    return c;
  }

  private requirePower() {
    if (!this.cp.poweredOn) {
      throw new EngineError('The charger is powered off.', 'conflict');
    }
    if (this.state === 'Rebooting') {
      throw new EngineError('The charger is restarting.', 'conflict');
    }
  }

  // ------------------------------------------------------------- lifecycle

  /** Load everything this charger had stored and come back to life. */
  async init(): Promise<void> {
    const { db } = this.host;
    const where = { chargePointId: this.cp.id };
    const rows = await db.connectors.find({
      where,
      order: { connectorId: 'ASC' },
    });
    for (const row of rows) this.connectors.push(this.makeRt(row));
    this.queue = await db.queue.find({ where, order: { id: 'ASC' } });
    this.profiles = await db.profiles.find({ where });
    this.reservations = await db.reservations.find({
      where: { chargePointId: this.cp.id, state: 'Active' },
    });
    for (const entry of await db.auth.find({ where })) {
      (entry.source === 'list' ? this.authList : this.authCache).set(
        entry.idTag,
        entry,
      );
    }

    await this.pruneLogs();

    // The process stopped while these were running: to the charger that is a power cut.
    const open = await db.sessions.find({
      where: { chargePointId: this.cp.id, status: 'Active' },
    });
    for (const session of open) await this.closeInterrupted(session);

    const sessionIds = [
      ...new Set(this.queue.map((m) => m.sessionId).filter((v) => v != null)),
    ];
    for (const sessionId of sessionIds) {
      const session = await db.sessions.findOneBy({ id: sessionId });
      if (session?.transactionId != null)
        this.txIds.set(session.id, session.transactionId);
    }

    for (const c of this.connectors) {
      if (c.entity.carId != null && !this.host.car(c.entity.carId)) {
        c.entity.carId = null;
        c.entity.finishing = false;
      }
      c.entity.locked = false;
      c.entity.evPaused = false;
      c.entity.evsePaused = false;
      c.entity.status = this.computeStatus(c);
      c.dirty = true;
    }
    this.cp.firmwareStatus = this.cp.firmwareInstalledPending
      ? 'Installed'
      : 'Idle';
    this.cp.diagnosticsStatus = 'Idle';
    this.cpDirty = true;

    await this.run(() => {
      if (this.cp.poweredOn) {
        this.event('PowerOn', 'Charger powered on');
        this.startNetwork();
      } else {
        this.setState('Off');
      }
    });
  }

  private makeRt(entity: Connector): ConnectorRt {
    return {
      entity,
      session: null,
      pending: null,
      authorizing: null,
      deauthorized: false,
      deauthEnergyWh: 0,
      evSuspended: false,
      evseSuspended: false,
      telemetry: this.idleTelemetry(entity),
      nextSampleAt: 0,
      lastSampleWh: entity.meterWh,
      statusDirty: false,
      dirty: false,
    };
  }

  private idleTelemetry(e: Connector): TelemetryDto {
    const dc = isDc(e.type);
    return {
      powerW: 0,
      currentA: 0,
      voltageV: dc ? 0 : AC_VOLTAGE,
      offeredW: 0,
      offeredA: 0,
      limitW: null,
      limitSource: null,
      phases: dc ? 0 : e.phases,
      temperatureC: 25,
      soc: null,
    };
  }

  private async closeInterrupted(session: ChargingSession) {
    const { db } = this.host;
    const c = this.connector(session.connectorId);
    const meterStop = Math.max(
      session.meterStartWh,
      Math.round(
        c ? c.entity.meterWh : session.meterStartWh + session.energyWh,
      ),
    );
    const stoppedAt = session.updatedAt ?? new Date(this.now());
    Object.assign(session, {
      status: 'Stopped',
      stopReason: 'PowerLoss',
      stoppedAt,
      meterStopWh: meterStop,
      energyWh: meterStop - session.meterStartWh,
    });
    await db.sessions.save(session);
    const row = await db.queue.save(
      db.queue.create({
        chargePointId: this.cp.id,
        action: 'StopTransaction',
        payload: {
          transactionId: null,
          meterStop,
          timestamp: stoppedAt.toISOString(),
          reason: 'PowerLoss',
        },
        sessionId: session.id,
        attempts: 0,
      }),
    );
    this.queue.push(row);
    await db.profiles.delete({
      chargePointId: this.cp.id,
      sessionId: session.id,
    });
    this.profiles = this.profiles.filter((p) => p.sessionId !== session.id);
    if (c) {
      c.entity.meterWh = meterStop;
      c.entity.finishing = c.entity.carId != null;
      c.dirty = true;
    }
    this.event(
      'SessionStopped',
      `Transaction on connector ${session.connectorId} was cut off by a power loss`,
      'warning',
      c,
    );
  }

  /** Stop everything; the charger object is dead afterwards. */
  dispose() {
    this.disposed = true;
    this.timers.clear();
    this.teardownRpc(true);
  }

  powerOn(): Promise<void> {
    return this.run(() => {
      if (this.cp.poweredOn) return;
      this.cp.poweredOn = true;
      this.markCpDirty();
      this.everAccepted = false;
      this.startingUp = true;
      this.lastTickAt = this.now();
      this.event('PowerOn', 'Charger powered on');
      for (const c of this.connectors) this.refreshStatus(c);
      this.startNetwork();
    });
  }

  powerOff(): Promise<void> {
    return this.run(async () => {
      if (!this.cp.poweredOn) return;
      // Power is gone at once: nothing can be sent any more. What happened is
      // reported after the next boot.
      this.teardownRpc(true);
      this.timers.clear();
      this.firmware.abort();
      this.setState('Off');
      for (const c of this.connectors) {
        c.pending = null;
        c.authorizing = null;
        if (c.session) await this.stopSession(c, 'PowerLoss');
        c.telemetry = this.idleTelemetry(c.entity);
      }
      this.cp.poweredOn = false;
      this.maintenance = false;
      this.markCpDirty();
      this.event('PowerOff', 'Charger powered off', 'warning');
    });
  }

  /** Plug or pull the (simulated) network cable while the charger keeps running. */
  setNetwork(up: boolean): Promise<void> {
    return this.run(() => {
      if (this.cp.networkUp === up) return;
      this.cp.networkUp = up;
      this.markCpDirty();
      this.event(
        'Network',
        up ? 'Network link restored' : 'Network link lost',
        up ? 'info' : 'warning',
      );
      if (!this.cp.poweredOn || this.state === 'Rebooting') return;
      if (up) {
        this.startNetwork();
      } else {
        this.teardownRpc(true);
        this.setState('Offline');
      }
    });
  }

  /** Restart from the charger's own menu: transactions end with reason Reboot. */
  reboot(): Promise<void> {
    return this.run(async () => {
      this.requirePower();
      this.event('Reboot', 'Restart requested at the charger', 'warning');
      await this.softRestart('Reboot');
    });
  }

  /** Stop transactions, give their messages a moment to leave, then restart. */
  async softRestart(reason: StopReason) {
    this.firmware.abort();
    for (const c of this.connectors) {
      if (c.session) await this.stopSession(c, reason);
    }
    const deadline = this.now() + this.host.options.softResetGraceMs;
    const wait = () => {
      const flushed = this.queue.length === 0 && this.idle;
      if (flushed || !this.registered || this.now() >= deadline) {
        this.restart();
      } else {
        this.setTimer('soft-reset', 250, wait);
      }
    };
    wait();
  }

  /** Cut power to the electronics at once; open transactions are reported after the boot. */
  async hardRestart(reason: StopReason) {
    this.firmware.abort();
    this.teardownRpc(true);
    this.setState('Rebooting');
    for (const c of this.connectors) {
      if (c.session) await this.stopSession(c, reason);
    }
    this.restart();
  }

  /** Go dark for the configured boot time, then dial again. */
  restart() {
    this.teardownRpc();
    this.everAccepted = false;
    this.startingUp = true;
    for (const c of this.connectors) {
      c.pending = null;
      c.authorizing = null;
    }
    this.setState('Rebooting');
    this.clearTimer('soft-reset');
    this.clearTimer('boot-retry');
    this.setTimer('reboot', Math.max(0, this.cp.rebootSeconds) * 1000, () => {
      this.event('PowerOn', 'Charger restarted');
      this.startNetwork();
    });
  }

  // ---------------------------------------------------------------- network

  resolvedUrl(): string {
    try {
      return resolveCsmsUrl(this.cp);
    } catch {
      return '';
    }
  }

  securityProfile(): number {
    const wss = /^wss:/i.test(this.resolvedUrl());
    const password = !!this.cp.basicAuthPassword;
    const clientCert = !!this.cp.tlsClientCert && !!this.cp.tlsClientKey;
    if (wss && clientCert) return 3;
    if (wss && password) return 2;
    if (!wss && password) return 1;
    return 0;
  }

  private setState(state: ConnectionState) {
    if (this.state !== state) {
      this.state = state;
      this.stateSince = this.now();
    }
    this.dirty = true;
  }

  private teardownRpc(hard = false) {
    const rpc = this.rpc;
    if (!rpc) return;
    this.rpc = null;
    rpc.removeAllListeners();
    rpc.on('error', () => undefined);
    rpc.close(1000, '', hard);
    this.queueSending = false;
  }

  /** Dial the CSMS with the current settings. */
  startNetwork() {
    this.clearTimer('reboot');
    this.clearTimer('boot-retry');
    this.teardownRpc();
    if (!this.cp.poweredOn) return;
    this.conn = {
      lastError: null,
      attempt: 0,
      nextRetryAt: null,
      bootRetryAt: null,
      protocol: null,
    };
    if (!this.cp.networkUp) {
      this.setState('Offline');
      return;
    }
    let url: string;
    try {
      url = resolveCsmsUrl(this.cp);
    } catch (err) {
      this.conn.lastError = (err as Error).message;
      this.setState('Connecting');
      this.event(
        'ConnectFailed',
        `Cannot connect: ${(err as Error).message}`,
        'error',
      );
      return;
    }

    const headers: Record<string, string> = {};
    if (this.cp.basicAuthPassword) {
      const user = this.cp.basicAuthUser || this.cp.chargePointId;
      headers.Authorization = `Basic ${Buffer.from(`${user}:${this.cp.basicAuthPassword}`).toString('base64')}`;
    }
    const secure = /^wss:/i.test(url);
    const { options } = this.host;
    const rpc = new RpcClient({
      url,
      subProtocols: ['ocpp1.6'],
      headers,
      tls: secure
        ? {
            rejectUnauthorized: this.cp.tlsVerify,
            ca: this.cp.tlsCaCert || undefined,
            cert: this.cp.tlsClientCert || undefined,
            key: this.cp.tlsClientKey || undefined,
          }
        : undefined,
      callTimeoutMs: options.callTimeoutMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      pingIntervalMs: this.config.int('WebSocketPingInterval') * 1000,
      reconnectBaseMs: options.reconnectBaseMs,
      reconnectMaxMs: options.reconnectMaxMs,
    });
    this.rpc = rpc;

    rpc.on(
      'open',
      (info: { protocol: string }) =>
        void this.run(() => this.onOpen(rpc, info)),
    );
    rpc.on(
      'close',
      (info: CloseInfo) => void this.run(() => this.onClose(rpc, info)),
    );
    rpc.on('error', () => undefined); // reported through 'close'
    rpc.on('frame', (frame: FrameEvent) => this.onFrame(frame));
    rpc.on(
      'malformed',
      (raw: string) =>
        void this.run(() =>
          this.event(
            'Malformed',
            `Ignored a frame that is not OCPP-J: ${raw.slice(0, 120)}`,
            'warning',
          ),
        ),
    );
    rpc.on(
      'reconnectScheduled',
      (r: { delayMs: number; attempt: number }) =>
        void this.run(() => {
          if (this.rpc !== rpc) return;
          this.conn.attempt = r.attempt;
          this.conn.nextRetryAt = this.now() + r.delayMs;
          this.dirty = true;
        }),
    );
    for (const [action, handler] of this.requests.handlers) {
      rpc.handle(action, (payload, messageId) =>
        this.run(() => this.dispatch(rpc, action, handler, payload, messageId)),
      );
    }

    this.setState('Connecting');
    rpc.connect();
  }

  /** Redial, e.g. after connection settings or the AuthorizationKey changed. */
  reconnect(reason: string) {
    if (
      !this.cp.poweredOn ||
      this.state === 'Rebooting' ||
      this.state === 'Off'
    )
      return;
    this.event('Reconnect', `Reconnecting: ${reason}`);
    this.everAccepted = false;
    this.startNetwork();
  }

  private onOpen(rpc: RpcClient, info: { protocol: string }) {
    if (this.rpc !== rpc) return;
    this.conn = {
      lastError: null,
      attempt: 0,
      nextRetryAt: null,
      bootRetryAt: null,
      protocol: info.protocol || null,
    };
    this.cp.lastConnectedAt = new Date(this.now());
    this.markCpDirty();
    this.event(
      'Connected',
      info.protocol
        ? `Connected to ${rpc.url}`
        : `Connected to ${rpc.url}, but the server did not confirm the ocpp1.6 sub-protocol`,
      info.protocol ? 'success' : 'warning',
    );
    if (this.cp.bootOnReconnect || !this.everAccepted) {
      this.setState('Booting');
      this.sendBoot();
    } else {
      this.setState('Accepted');
      this.afterAccepted(false);
    }
  }

  private onClose(rpc: RpcClient, info: CloseInfo) {
    if (this.rpc !== rpc) return;
    this.cp.lastDisconnectedAt = new Date(this.now());
    this.markCpDirty();
    this.queueSending = false;
    this.clearTimer('boot-retry');
    let why: string;
    if (info.httpStatus === 401 || info.httpStatus === 403) {
      why = `The CSMS refused the connection (HTTP ${info.httpStatus}): check the password`;
    } else if (info.httpStatus) {
      why = `The CSMS refused the connection (HTTP ${info.httpStatus})`;
    } else if (!info.wasOpen) {
      why = `Could not reach the CSMS${info.error ? `: ${info.error}` : ''}`;
    } else {
      why = `Connection closed (code ${info.code}${info.reason ? `, ${info.reason}` : ''})`;
    }
    this.conn.lastError = why;
    this.conn.protocol = null;
    this.conn.bootRetryAt = null;
    if (info.wasOpen || this.conn.attempt === 0) {
      this.event(
        info.wasOpen ? 'Disconnected' : 'ConnectFailed',
        why,
        'warning',
      );
    }
    this.setState('Connecting');
  }

  private bootPayload(): Record<string, string> {
    const { cp } = this;
    const payload: Record<string, string> = {
      chargePointVendor: cp.vendor.slice(0, 20),
      chargePointModel: cp.model.slice(0, 20),
    };
    const optional: [string, string, number][] = [
      ['chargePointSerialNumber', cp.serialNumber, 25],
      ['chargeBoxSerialNumber', cp.chargeBoxSerialNumber, 25],
      ['firmwareVersion', cp.firmwareVersion, 50],
      ['iccid', cp.iccid, 20],
      ['imsi', cp.imsi, 20],
      ['meterType', cp.meterType, 25],
      ['meterSerialNumber', cp.meterSerialNumber, 25],
    ];
    for (const [key, value, max] of optional) {
      if (value) payload[key] = value.slice(0, max);
    }
    return payload;
  }

  sendBoot() {
    this.clearTimer('boot-retry');
    this.request<BootNotificationConf>(
      'BootNotification',
      this.bootPayload(),
      (conf) => this.onBootConf(conf),
      (err) => {
        if (err instanceof NotConnectedError) return;
        this.event(
          'Boot',
          `BootNotification got no usable answer: ${err.message}`,
          'warning',
        );
        this.scheduleBootRetry(this.host.options.bootRetrySec);
      },
    );
  }

  private scheduleBootRetry(seconds: number) {
    this.conn.bootRetryAt = this.now() + seconds * 1000;
    this.setTimer('boot-retry', seconds * 1000, () => {
      this.conn.bootRetryAt = null;
      if (this.online) this.sendBoot();
    });
    this.dirty = true;
  }

  private onBootConf(conf: BootNotificationConf) {
    const status = String(conf?.status ?? '');
    const interval = Number(conf?.interval) || 0;
    if (conf?.currentTime) this.syncClock(conf.currentTime);
    this.cp.lastBootAt = new Date(this.now());
    this.markCpDirty();

    if (status === 'Accepted') {
      this.everAccepted = true;
      if (interval > 0)
        this.config.setLocal('HeartbeatInterval', String(interval));
      this.setState('Accepted');
      this.event(
        'Boot',
        `BootNotification accepted (heartbeat every ${this.config.int('HeartbeatInterval')} s)`,
        'success',
      );
      this.afterAccepted(true);
      return;
    }
    if (status === 'Pending' || status === 'Rejected') {
      const wait = interval > 0 ? interval : this.host.options.bootRetrySec;
      this.setState(status);
      this.event(
        'Boot',
        `BootNotification ${status.toLowerCase()} by the CSMS; next attempt in ${wait} s`,
        status === 'Rejected' ? 'error' : 'warning',
      );
      this.scheduleBootRetry(wait);
      return;
    }
    this.event(
      'Boot',
      `BootNotification answer has no valid status: ${JSON.stringify(conf)}`,
      'error',
    );
    this.scheduleBootRetry(this.host.options.bootRetrySec);
  }

  /** The CSMS will listen now: say where every connector stands and empty the queue. */
  private afterAccepted(booted: boolean) {
    this.conn.bootRetryAt = null;
    this.nextHeartbeatAt =
      this.now() + this.config.int('HeartbeatInterval') * 1000;
    this.rpc?.setPingInterval(this.config.int('WebSocketPingInterval') * 1000);
    if (booted) {
      this.sendStatusZero();
      for (const c of this.connectors) {
        // A fresh boot reports where each connector stands now, not where it was left.
        const status = this.computeStatus(c);
        if (status !== c.entity.status) {
          c.entity.status = status;
          c.dirty = true;
        }
        this.sendStatus(c);
      }
      // Only a real start-up counts, not a BootNotification the CSMS asked for.
      if (this.startingUp) {
        this.startingUp = false;
        this.securityEvent('StartupOfTheDevice');
      }
      this.firmware.afterBoot();
    } else {
      for (const c of this.connectors) if (c.statusDirty) this.sendStatus(c);
    }
    this.kickQueue();
  }

  private syncClock(currentTime: string) {
    const theirs = Date.parse(currentTime);
    if (Number.isNaN(theirs)) return;
    const offset = theirs - this.now();
    // Network latency is not a clock error.
    this.clockOffsetMs = Math.abs(offset) < 2000 ? 0 : offset;
  }

  sendHeartbeat() {
    this.nextHeartbeatAt =
      this.now() + this.config.int('HeartbeatInterval') * 1000;
    this.request<HeartbeatConf>('Heartbeat', {}, async (conf) => {
      if (conf?.currentTime) this.syncClock(conf.currentTime);
      this.cp.lastHeartbeatAt = new Date(this.now());
      this.dirty = true;
      await this.host.db.chargePoints.update(this.cp.id, {
        lastHeartbeatAt: this.cp.lastHeartbeatAt,
      });
    });
  }

  /**
   * Send a CALL to the CSMS. The answer is handled as a new job, so the caller
   * never blocks on the network.
   */
  request<T = unknown>(
    action: string,
    payload: unknown,
    onResult?: (conf: T) => void | Promise<void>,
    onError?: (err: Error) => void | Promise<void>,
  ) {
    const rpc = this.rpc;
    if (!rpc || !rpc.connected) {
      if (onError)
        void this.run(() => onError(new NotConnectedError(action))).catch(
          () => undefined,
        );
      return;
    }
    rpc
      .call<T>(action, payload)
      .then(
        (conf) => (onResult ? this.run(() => onResult(conf)) : undefined),
        (err: Error) => (onError ? this.run(() => onError(err)) : undefined),
      )
      .catch(() => undefined);
  }

  /** A CALL sent by hand from the UI; resolves with the CSMS's answer. */
  async sendCall(action: string, payload: unknown): Promise<unknown> {
    const rpc = this.rpc;
    if (!rpc || !rpc.connected) {
      throw new EngineError(
        'The charger is not connected to a CSMS.',
        'conflict',
      );
    }
    return rpc.call(action, payload ?? {});
  }

  /** Runs one CSMS request: test overrides, shape check, handler, answer, follow-up. */
  private async dispatch(
    rpc: RpcClient,
    action: string,
    handler: RequestHandler,
    payload: Record<string, unknown>,
    messageId: string,
  ): Promise<typeof NO_REPLY> {
    try {
      const override = this.cp.responseOverrides?.[action];
      if (override) {
        if (override.once) {
          delete this.cp.responseOverrides![action];
          this.markCpDirty();
        }
        this.event(
          'Override',
          `${action} answered by a test override (${override.mode})`,
          'warning',
        );
        if (override.mode === 'silent') return NO_REPLY;
        if (override.mode === 'error') {
          throw new OcppError(
            (override.errorCode as OcppErrorCode) || 'InternalError',
            'Simulated by the emulator',
          );
        }
        rpc.respond(action, messageId, {
          status: override.status || 'Rejected',
        });
        return NO_REPLY;
      }

      validateRequest(action, payload);
      const followUps: Array<() => void | Promise<void>> = [];
      const result = await handler(payload, (fn) => followUps.push(fn));
      // The answer goes out first; what the request sets in motion comes after it.
      rpc.respond(action, messageId, result ?? {});
      for (const fn of followUps) await fn();
    } catch (err) {
      if (err instanceof OcppError) {
        rpc.respondError(action, messageId, err.code, err.message, err.details);
      } else {
        this.host.warn(
          `[${this.cp.chargePointId}] ${action} failed: ${(err as Error)?.stack ?? err}`,
        );
        rpc.respondError(
          action,
          messageId,
          'InternalError',
          (err as Error).message,
        );
      }
    }
    return NO_REPLY;
  }

  private onFrame(frame: FrameEvent) {
    const { db, options } = this.host;
    const row = db.logs.create({
      chargePointId: this.cp.id,
      ts: new Date(this.now()),
      direction: frame.direction,
      messageType: frame.messageType,
      action: frame.action,
      messageId: frame.messageId,
      payload: frame.payload,
    });
    this.logChain = this.logChain
      .then(async () => {
        if (this.disposed) return;
        await db.logs.insert(row);
        this.host.emit(ENGINE_EVENTS.log, VirtualChargePoint.logDto(row));
        if (++this.logCount % options.logPruneEvery === 0)
          await this.pruneLogs();
      })
      .catch((err) =>
        this.host.warn(`log write failed: ${(err as Error).message}`),
      );
  }

  /** Keep only this charger's newest frames, so the log cannot grow without end. */
  private async pruneLogs() {
    await this.host.db.logs.query(
      `DELETE FROM ocpp_logs
        WHERE chargePointId = ?
          AND id <= (SELECT id FROM ocpp_logs
                      WHERE chargePointId = ?
                      ORDER BY id DESC LIMIT 1 OFFSET ?)`,
      [this.cp.id, this.cp.id, this.host.options.logRetention],
    );
  }

  securityEvent(type: string, techInfo?: string) {
    if (!this.cp.securityEvents || !this.registered) return;
    this.request('SecurityEventNotification', {
      type,
      timestamp: this.ts(),
      ...(techInfo ? { techInfo: techInfo.slice(0, 255) } : {}),
    });
  }

  // ----------------------------------------------------------------- status

  activeReservation(c: ConnectorRt): Reservation | undefined {
    return this.reservations.find(
      (r) => r.state === 'Active' && r.connectorId === c.entity.connectorId,
    );
  }

  computeStatus(c: ConnectorRt): ConnectorStatus {
    const e = c.entity;
    if (e.errorCode !== 'NoError') return 'Faulted';
    if (c.session) {
      if (c.evseSuspended) return 'SuspendedEVSE';
      if (c.evSuspended || !e.carId) return 'SuspendedEV';
      return 'Charging';
    }
    if (this.maintenance || e.availability === 'Inoperative')
      return 'Unavailable';
    if (e.finishing && e.carId) return 'Finishing';
    if (e.carId || c.pending) return 'Preparing';
    if (this.activeReservation(c)) return 'Reserved';
    return 'Available';
  }

  get emergency() {
    return (
      this.connectors.length > 0 &&
      this.connectors.every((c) => c.entity.errorInfo === 'EmergencyStop')
    );
  }

  /** Status of connector 0: the charge point as a whole. */
  cpStatus(): ConnectorStatus {
    if (this.emergency) return 'Faulted';
    if (this.maintenance || this.cp.availability === 'Inoperative')
      return 'Unavailable';
    return 'Available';
  }

  /** Recompute a connector's status and report it when it changed. */
  refreshStatus(c: ConnectorRt, forceNotify = false) {
    const status = this.computeStatus(c);
    const changed = status !== c.entity.status;
    if (changed) {
      c.entity.status = status;
      c.dirty = true;
      this.dirty = true;
    }
    if (!changed && !forceNotify) return;
    const hold = this.config.int('MinimumStatusDuration');
    if (hold > 0 && !forceNotify) {
      // Only a status that lasts is worth reporting.
      this.setTimer(`status:${c.entity.connectorId}`, hold * 1000, () =>
        this.sendStatus(c),
      );
    } else {
      this.sendStatus(c);
    }
  }

  /** `always` sends as soon as the socket is open: a TriggerMessage may ask while the boot is Pending. */
  sendStatus(c: ConnectorRt, always = false) {
    this.clearTimer(`status:${c.entity.connectorId}`);
    if (always ? !this.online : !this.registered) {
      c.statusDirty = true;
      return;
    }
    c.statusDirty = false;
    const e = c.entity;
    const payload: Record<string, unknown> = {
      connectorId: e.connectorId,
      errorCode: e.errorCode,
      status: e.status,
      timestamp: this.ts(),
    };
    if (e.errorInfo) payload.info = e.errorInfo.slice(0, 50);
    if (e.vendorErrorCode) {
      payload.vendorId = this.cp.vendor.slice(0, 255);
      payload.vendorErrorCode = e.vendorErrorCode.slice(0, 50);
    }
    this.request('StatusNotification', payload);
  }

  sendStatusZero(always = false) {
    if (always ? !this.online : !this.registered) return;
    this.request('StatusNotification', {
      connectorId: 0,
      errorCode: this.emergency ? 'OtherError' : 'NoError',
      status: this.cpStatus(),
      timestamp: this.ts(),
      ...(this.emergency ? { info: 'EmergencyStop' } : {}),
    });
  }

  // ------------------------------------------------------------- the meter

  /** Limit the installed charging profiles put on a connector right now, in watts. */
  limitFor(
    c: ConnectorRt,
    at: number,
    car: Car | null,
    /** Split a ChargePointMaxProfile between the connectors that are drawing power. */
    share = true,
  ): { watts: number | null; source: string | null } {
    if (this.profiles.length === 0) return { watts: null, source: null };
    const id = c.entity.connectorId;
    const outlet = {
      type: c.entity.type,
      maxPowerW: c.entity.maxPowerW,
      phases: c.entity.phases,
    };
    const sessionStart = c.session ? c.session.startedAt.getTime() : null;
    const of = (purpose: string, connectorId: number) =>
      this.profiles.filter(
        (p) => p.purpose === purpose && p.connectorId === connectorId,
      );

    let watts: number | null = null;
    let source: string | null = null;

    let tx: ActiveLimit | null = null;
    if (c.session) {
      const sessionId = c.session.id;
      tx =
        selectLimit(
          of('TxProfile', id).filter(
            (p) => p.sessionId === null || p.sessionId === sessionId,
          ),
          at,
          sessionStart,
        ) ??
        selectLimit(of('TxDefaultProfile', id), at, sessionStart) ??
        selectLimit(of('TxDefaultProfile', 0), at, sessionStart);
    }
    if (tx) {
      watts = limitToWatts(tx.limit, tx.unit, tx.numberPhases, outlet, car);
      source = `${tx.purpose} #${tx.profileId}`;
    }

    const max = selectLimit(of('ChargePointMaxProfile', 0), at, null);
    if (max) {
      const total =
        max.unit === 'W'
          ? max.limit
          : max.limit * AC_VOLTAGE * (max.numberPhases ?? 3);
      const part = share ? total / Math.max(1, this.drawing) : total;
      if (watts === null || part < watts) {
        watts = part;
        source = `ChargePointMaxProfile #${max.profileId}`;
      }
    }
    return { watts, source };
  }

  private stopsWhenFull(type: ConnectorType): boolean {
    const mode = this.cp.fullBatteryBehavior;
    if (mode === 'stop') return true;
    if (mode === 'suspend') return false;
    return isDc(type); // a DC session ends when the car is done; an AC one idles
  }

  private reading(c: ConnectorRt): MeterReading {
    const t = c.telemetry;
    return {
      energyWh: c.entity.meterWh,
      intervalWh: Math.max(0, c.entity.meterWh - c.lastSampleWh),
      powerW: t.powerW,
      currentA: t.currentA,
      voltageV: t.voltageV,
      offeredW: t.offeredW,
      offeredA: t.offeredA,
      phases: t.phases,
      soc: t.soc,
      temperatureC: t.temperatureC,
      frequencyHz: 50,
    };
  }

  /** Advance one connector by `dtMs` of wall-clock time. */
  private async step(c: ConnectorRt, dtMs: number, at: number) {
    const e = c.entity;
    const s = c.session;
    const t = c.telemetry;
    const dc = isDc(e.type);
    const car = e.carId != null ? (this.host.car(e.carId) ?? null) : null;
    const outlet = { type: e.type, maxPowerW: e.maxPowerW, phases: e.phases };
    const noise = this.host.options.jitter
      ? 1 + (Math.random() - 0.5) * 0.008
      : 1;

    t.soc = car ? round1(socPercent(car)) : null;
    if (!s) {
      t.powerW = 0;
      t.currentA = 0;
      t.offeredW = 0;
      t.offeredA = 0;
      t.limitW = null;
      t.limitSource = null;
      t.phases = dc ? 0 : e.phases;
      t.voltageV = dc ? 0 : round1(AC_VOLTAGE * noise);
      t.temperatureC = round1(t.temperatureC + (25 - t.temperatureC) * 0.05);
      c.evSuspended = false;
      c.evseSuspended = false;
      return;
    }

    const limit = this.limitFor(c, at, car);
    let offeredW = Math.min(e.maxPowerW, limit.watts ?? Infinity);
    const request = car ? chargeRequest(car, outlet) : null;
    const phases = dc ? 0 : (request?.phases ?? e.phases);
    const maxOnInvalid = this.config.int('MaxEnergyOnInvalidId');
    const blocked = c.deauthorized && c.deauthEnergyWh >= maxOnInvalid;

    let evseSuspended = e.evsePaused || blocked;
    if (!evseSuspended) {
      evseSuspended = dc
        ? offeredW < MIN_DC_POWER
        : offeredW / (AC_VOLTAGE * Math.max(1, phases)) < MIN_AC_CURRENT - 1e-6;
    }
    const evSuspended = !car || e.evPaused || reachedTarget(car);

    let powerW = 0;
    if (!evseSuspended && !evSuspended && request) {
      powerW = Math.max(
        0,
        Math.min(offeredW, request.maxW) *
          (this.host.options.jitter ? 1 - Math.random() * 0.01 : 1),
      );
    }
    if (evseSuspended) offeredW = 0;

    if (powerW > 0 && dtMs > 0 && car) {
      const eff = efficiency(e.type);
      let dWh = (powerW * dtMs * Math.max(1, this.cp.speed)) / 3_600_000;
      const targetWh =
        (car.batteryCapacityWh * Math.min(100, car.targetSoc)) / 100;
      const room = Math.max(0, targetWh - car.batteryWh);
      if (dWh * eff > room) dWh = room / eff;
      if (c.deauthorized) {
        dWh = Math.min(dWh, Math.max(0, maxOnInvalid - c.deauthEnergyWh));
        c.deauthEnergyWh += dWh;
      }
      car.batteryWh = Math.min(
        car.batteryCapacityWh,
        car.batteryWh + dWh * eff,
      );
      e.meterWh += dWh;
      s.energyWh = e.meterWh - s.meterStartWh;
      s.chargingSec += dtMs / 1000;
      if (powerW > s.peakPowerW) s.peakPowerW = powerW;
      await this.host.db.connectors.update(e.id, { meterWh: e.meterWh });
      await this.host.db.sessions.update(s.id, {
        energyWh: s.energyWh,
        chargingSec: s.chargingSec,
        peakPowerW: s.peakPowerW,
      });
      this.host.carChanged(car);
    }

    const voltage = request ? request.voltage : outletVoltage(outlet, car);
    t.powerW = Math.round(powerW);
    t.phases = phases;
    t.voltageV = round1(voltage * noise);
    t.currentA = request ? round1(currentFor(powerW, request)) : 0;
    t.offeredW = Math.round(offeredW);
    t.offeredA = round1(wattsToLimit(offeredW, 'A', outlet, car));
    t.limitW = limit.watts === null ? null : Math.round(limit.watts);
    t.limitSource = limit.source;
    t.soc = car ? round1(socPercent(car)) : null;
    const targetTemp = 25 + 22 * (powerW / Math.max(1, e.maxPowerW));
    t.temperatureC = round1(
      t.temperatureC + (targetTemp - t.temperatureC) * 0.05,
    );

    c.evSuspended = evSuspended;
    c.evseSuspended = evseSuspended;
    this.refreshStatus(c);

    if (car && reachedTarget(car) && this.stopsWhenFull(e.type)) {
      this.event(
        'BatteryFull',
        `${car.name} reached its charge target`,
        'success',
        c,
      );
      await this.stopSession(c, 'Other');
      return;
    }

    if (at >= c.nextSampleAt && dtMs > 0) {
      const interval = this.config.int('MeterValueSampleInterval');
      await this.sample(c, 'Sample.Periodic', at, interval > 0);
      c.nextSampleAt =
        at +
        (interval > 0 ? interval : this.host.options.historySampleSec) * 1000;
    }
  }

  /** Take a reading for the session's history, and report it as MeterValues if asked. */
  private async sample(
    c: ConnectorRt,
    context: ReadingContext,
    at: number,
    report: boolean,
  ) {
    const s = c.session;
    if (!s) return;
    const reading = this.reading(c);
    await this.host.db.samples.insert({
      sessionId: s.id,
      ts: new Date(at),
      context,
      energyWh: reading.energyWh,
      powerW: reading.powerW,
      currentA: reading.currentA,
      voltageV: reading.voltageV,
      soc: reading.soc,
    });
    if (report) {
      const sampledValue = buildSampledValues(
        this.config.csl('MeterValuesSampledData'),
        reading,
        context,
        this.cp.perPhaseMeterValues,
      );
      if (sampledValue.length) {
        await this.enqueue(
          'MeterValues',
          {
            connectorId: c.entity.connectorId,
            transactionId: null,
            meterValue: [{ timestamp: this.ts(at), sampledValue }],
          },
          s.id,
        );
      }
    }
    c.lastSampleWh = c.entity.meterWh;
  }

  /** MeterValues on request (TriggerMessage) or on the clock, for one connector. */
  async reportMeter(
    c: ConnectorRt,
    context: ReadingContext,
    measurandKey: string,
  ) {
    const sampledValue = buildSampledValues(
      this.config.csl(measurandKey),
      this.reading(c),
      context,
      this.cp.perPhaseMeterValues,
    );
    if (!sampledValue.length) return;
    const meterValue = [{ timestamp: this.ts(), sampledValue }];
    const connectorId = c.entity.connectorId;
    if (c.session) {
      await this.enqueue(
        'MeterValues',
        { connectorId, transactionId: null, meterValue },
        c.session.id,
      );
    } else if (this.online) {
      this.request('MeterValues', { connectorId, meterValue });
    }
  }

  /** The grid meter of the whole charge point (connector 0). */
  reportMainMeter(context: ReadingContext, measurandKey: string) {
    if (!this.registered) return;
    const total = this.connectors.reduce((sum, c) => sum + c.entity.meterWh, 0);
    const power = this.connectors.reduce(
      (sum, c) => sum + c.telemetry.powerW,
      0,
    );
    const sampledValue = buildSampledValues(
      this.config
        .csl(measurandKey)
        .filter(
          (m) =>
            m.startsWith('Energy.Active.Import.Register') ||
            m.startsWith('Power.Active.Import'),
        ),
      {
        energyWh: total,
        intervalWh: 0,
        powerW: power,
        currentA: 0,
        voltageV: AC_VOLTAGE,
        offeredW: 0,
        offeredA: 0,
        phases: 3,
        soc: null,
        temperatureC: 25,
        frequencyHz: 50,
      },
      context,
      false,
    ).map((v) => ({ ...v, location: 'Inlet' }));
    if (sampledValue.length) {
      this.request('MeterValues', {
        connectorId: 0,
        meterValue: [{ timestamp: this.ts(), sampledValue }],
      });
    }
  }

  private async alignedMeterValues(at: number) {
    const interval = this.config.int('ClockAlignedDataInterval');
    if (interval <= 0) {
      this.alignedSlot = null;
      return;
    }
    const slot = Math.floor((at + this.clockOffsetMs) / (interval * 1000));
    if (this.alignedSlot === null) {
      this.alignedSlot = slot;
      return;
    }
    if (slot === this.alignedSlot) return;
    this.alignedSlot = slot;
    this.reportMainMeter('Sample.Clock', 'MeterValuesAlignedData');
    for (const c of this.connectors) {
      await this.reportMeter(c, 'Sample.Clock', 'MeterValuesAlignedData');
    }
  }

  /** One beat of the charger's clock. */
  tick(): Promise<void> {
    return this.run(async () => {
      const at = this.now();
      const dtMs = this.lastTickAt
        ? Math.min(MAX_TICK_MS, Math.max(0, at - this.lastTickAt))
        : 0;
      this.lastTickAt = at;
      if (!this.cp.poweredOn) return;
      await this.runTimers(at);
      if (this.state === 'Rebooting' || !this.cp.poweredOn) return;

      await this.expireReservations(at);
      for (const c of this.connectors) {
        if (c.pending && at >= c.pending.until) {
          this.event(
            'ConnectionTimeout',
            `No cable was plugged in within ${this.config.int('ConnectionTimeOut')} s; authorization of ${c.pending.idTag} dropped`,
            'warning',
            c,
          );
          c.pending = null;
          this.refreshStatus(c);
        }
      }

      this.drawing = Math.max(
        1,
        this.connectors.filter((c) => {
          const car =
            c.entity.carId != null ? this.host.car(c.entity.carId) : undefined;
          return (
            c.session &&
            car &&
            !c.entity.evPaused &&
            !c.entity.evsePaused &&
            !reachedTarget(car)
          );
        }).length,
      );

      let active = false;
      for (const c of this.connectors) {
        if (c.session) active = true;
        await this.step(c, dtMs, at);
      }
      await this.alignedMeterValues(at);
      if (this.registered && at >= this.nextHeartbeatAt) this.sendHeartbeat();
      this.kickQueue();
      if (active) this.dirty = true;
    });
  }

  // ---------------------------------------------------- transaction queue

  /** Park a transaction message for delivery, in order, however long it takes. */
  async enqueue(
    action: string,
    payload: Record<string, unknown>,
    sessionId: number | null,
  ) {
    const { db, options } = this.host;
    const row = await db.queue.save(
      db.queue.create({
        chargePointId: this.cp.id,
        action,
        payload,
        sessionId,
        attempts: 0,
      }),
    );
    this.queue.push(row);
    const meterValues = this.queue.filter((m) => m.action === 'MeterValues');
    if (meterValues.length > options.maxQueuedMeterValues) {
      // Flash is finite: the oldest readings go first, never a Start or a Stop.
      const drop =
        meterValues[0] === this.queue[0] && this.queueSending
          ? meterValues[1]
          : meterValues[0];
      this.queue = this.queue.filter((m) => m !== drop);
      await db.queue.delete(drop.id);
    }
    this.dirty = true;
    this.kickQueue();
  }

  kickQueue() {
    if (this.queueSending || !this.registered) return;
    if (this.now() < this.queueRetryAt) return;
    const head = this.queue[0];
    const rpc = this.rpc;
    if (!head || !rpc) return;

    let payload = head.payload;
    if (head.sessionId != null && head.action !== 'StartTransaction') {
      const transactionId = this.txIds.get(head.sessionId);
      if (transactionId === undefined) {
        // Its StartTransaction never got through, so the CSMS knows no such transaction.
        void this.run(() =>
          this.dropQueued(
            head,
            'the CSMS never confirmed its StartTransaction',
          ),
        );
        return;
      }
      payload = { ...head.payload, transactionId };
    }

    this.queueSending = true;
    rpc.call(head.action, payload).then(
      (conf) =>
        void this.run(() =>
          this.onQueueDelivered(
            head,
            (conf ?? {}) as StartTransactionConf & StopTransactionConf,
          ),
        ),
      (err: Error) => void this.run(() => this.onQueueFailed(head, err)),
    );
  }

  private async removeQueued(row: QueuedMessage) {
    this.queue = this.queue.filter((m) => m !== row);
    await this.host.db.queue.delete(row.id);
    this.dirty = true;
  }

  private async dropQueued(row: QueuedMessage, why: string) {
    if (!this.queue.includes(row)) return;
    await this.removeQueued(row);
    if (row.action !== 'MeterValues') {
      this.event('QueueDrop', `${row.action} was dropped: ${why}`, 'error');
    }
    this.kickQueue();
  }

  private async onQueueDelivered(
    row: QueuedMessage,
    conf: StartTransactionConf & StopTransactionConf,
  ) {
    this.queueSending = false;
    await this.removeQueued(row);
    if (row.action === 'StartTransaction' && row.sessionId != null) {
      await this.onStartConf(row.sessionId, conf);
    } else if (row.action === 'StopTransaction' && row.sessionId != null) {
      await this.onStopConf(row.sessionId, conf);
    }
    this.kickQueue();
  }

  private async onQueueFailed(row: QueuedMessage, err: Error) {
    this.queueSending = false;
    if (err instanceof NotConnectedError) return; // goes out when the link is back
    if (!this.queue.includes(row)) return;
    row.attempts += 1;
    const max = Math.max(1, this.config.int('TransactionMessageAttempts'));
    if (row.attempts >= max) {
      await this.dropQueued(
        row,
        `no usable answer after ${row.attempts} attempts (${err.message})`,
      );
      return;
    }
    await this.host.db.queue.update(row.id, { attempts: row.attempts });
    const wait =
      this.config.int('TransactionMessageRetryInterval') * row.attempts;
    this.queueRetryAt = this.now() + wait * 1000;
    this.event(
      'QueueRetry',
      `${row.action} was not processed (${err.message}); retry ${row.attempts}/${max - 1} in ${wait} s`,
      'warning',
    );
  }

  private idTagInfo(raw: IdTagInfo | null | undefined): {
    status: AuthorizationStatus;
    parentIdTag: string | null;
    expiryDate: Date | null;
  } {
    // Anything the CSMS sends that is not a known status counts as a refusal.
    const status = AUTH_STATUSES.find((s) => s === raw?.status) ?? 'Invalid';
    const expiry = raw?.expiryDate ? Date.parse(raw.expiryDate) : NaN;
    return {
      status,
      parentIdTag:
        typeof raw?.parentIdTag === 'string' ? raw.parentIdTag : null,
      expiryDate: Number.isNaN(expiry) ? null : new Date(expiry),
    };
  }

  private async onStartConf(sessionId: number, conf: StartTransactionConf) {
    const { db } = this.host;
    const transactionId = Number(conf?.transactionId);
    const info = this.idTagInfo(conf?.idTagInfo);
    const c = this.connectors.find((x) => x.session?.id === sessionId);
    const session =
      c?.session ?? (await db.sessions.findOneBy({ id: sessionId }));
    if (!session) return;
    if (Number.isInteger(transactionId))
      this.txIds.set(sessionId, transactionId);
    const patch = {
      transactionId: Number.isInteger(transactionId) ? transactionId : null,
      startConfirmed: true,
      idTagStatus: info.status,
      parentIdTag: info.parentIdTag ?? session.parentIdTag,
    };
    Object.assign(session, patch);
    await db.sessions.update(sessionId, patch);
    await this.cacheIdTag(session.idTag, info);
    this.dirty = true;
    this.host.emit(ENGINE_EVENTS.session, {
      chargePointId: this.cp.id,
      sessionId,
    });

    if (!c || info.status === 'Accepted') return;
    if (this.config.bool('StopTransactionOnInvalidId')) {
      this.event(
        'DeAuthorized',
        `The CSMS answered StartTransaction with ${info.status}: stopping the transaction`,
        'error',
        c,
      );
      await this.stopSession(c, 'DeAuthorized');
    } else {
      this.event(
        'DeAuthorized',
        `The CSMS answered StartTransaction with ${info.status}: energy is limited to ${this.config.int('MaxEnergyOnInvalidId')} Wh`,
        'warning',
        c,
      );
      c.deauthorized = true;
      c.deauthEnergyWh = 0;
    }
  }

  private async onStopConf(sessionId: number, conf: StopTransactionConf) {
    const { db } = this.host;
    await db.sessions.update(sessionId, { stopConfirmed: true });
    this.txIds.delete(sessionId);
    if (conf?.idTagInfo) {
      const session = await db.sessions.findOneBy({ id: sessionId });
      if (session)
        await this.cacheIdTag(session.idTag, this.idTagInfo(conf.idTagInfo));
    }
    this.host.emit(ENGINE_EVENTS.session, {
      chargePointId: this.cp.id,
      sessionId,
    });
  }

  // --------------------------------------------------------- authorization

  private lookupLocal(idTag: string, at: number): AuthDecision | null {
    const listed = this.config.bool('LocalAuthListEnabled')
      ? this.authList.get(idTag)
      : undefined;
    const entry =
      listed ??
      (this.config.bool('AuthorizationCacheEnabled')
        ? this.authCache.get(idTag)
        : undefined);
    if (!entry) return null;
    let status = entry.status;
    if (
      status === 'Accepted' &&
      entry.expiryDate &&
      entry.expiryDate.getTime() <= at
    ) {
      status = 'Expired';
    }
    return {
      status,
      parentIdTag: entry.parentIdTag,
      source: listed ? 'list' : 'cache',
    };
  }

  /** Remember what the CSMS said about an idTag (the Authorization Cache). */
  async cacheIdTag(
    idTag: string,
    info: {
      status: AuthorizationStatus;
      parentIdTag: string | null;
      expiryDate: Date | null;
    },
  ) {
    if (!this.config.bool('AuthorizationCacheEnabled')) return;
    if (this.authList.has(idTag)) return; // the local list is the authority for its own tags
    const { db } = this.host;
    const entry =
      this.authCache.get(idTag) ??
      db.auth.create({ chargePointId: this.cp.id, source: 'cache', idTag });
    entry.status = info.status;
    entry.parentIdTag = info.parentIdTag;
    entry.expiryDate = info.expiryDate;
    this.authCache.set(idTag, await db.auth.save(entry));
  }

  /**
   * Decide whether an idTag may charge. Asks the CSMS when online; otherwise,
   * and when LocalPreAuthorize allows it, the local list and the cache decide.
   */
  authorize(
    idTag: string,
    done: (decision: AuthDecision) => void | Promise<void>,
  ) {
    const local = this.lookupLocal(idTag, this.now());
    const offline = (): AuthDecision => {
      if (local && this.config.bool('LocalAuthorizeOffline')) return local;
      if (!local && this.config.bool('AllowOfflineTxForUnknownId')) {
        return { status: 'Accepted', parentIdTag: null, source: 'offline' };
      }
      return { status: 'Invalid', parentIdTag: null, source: 'offline' };
    };
    const finish = (decision: AuthDecision) =>
      void this.run(() => done(decision)).catch(() => undefined);

    if (!this.registered) {
      finish(offline());
      return;
    }
    if (local?.status === 'Accepted' && this.config.bool('LocalPreAuthorize')) {
      finish(local);
      return;
    }
    this.request<AuthorizeConf>(
      'Authorize',
      { idTag },
      async (conf) => {
        const info = this.idTagInfo(conf?.idTagInfo);
        await this.cacheIdTag(idTag, info);
        await done({
          status: info.status,
          parentIdTag: info.parentIdTag,
          source: 'csms',
        });
      },
      (err) => {
        this.event(
          'Authorize',
          `Authorize got no usable answer (${err.message}); deciding locally`,
          'warning',
        );
        return done(offline());
      },
    );
  }

  /** Is this connector held for somebody else, and which reservation does the tag consume? */
  reservationCheck(
    c: ConnectorRt,
    idTag: string,
    parentIdTag: string | null,
  ): { blocked: boolean; reservation: Reservation | null } {
    const matches = (r: Reservation) =>
      r.idTag === idTag ||
      (!!r.parentIdTag && !!parentIdTag && r.parentIdTag === parentIdTag);
    const own = this.activeReservation(c);
    if (own)
      return matches(own)
        ? { blocked: false, reservation: own }
        : { blocked: true, reservation: null };

    // Reservations on connector 0 keep "any one connector" free for their idTag.
    const floating = this.reservations.filter(
      (r) => r.state === 'Active' && r.connectorId === 0,
    );
    const mine = floating.find(matches);
    if (mine) return { blocked: false, reservation: mine };
    if (floating.length > 0) {
      const free = this.connectors.filter(
        (x) =>
          !x.session &&
          !x.pending &&
          x.entity.errorCode === 'NoError' &&
          x.entity.availability === 'Operative' &&
          !this.activeReservation(x) &&
          (x === c || !x.entity.carId),
      ).length;
      if (free <= floating.length) return { blocked: true, reservation: null };
    }
    return { blocked: false, reservation: null };
  }

  private async expireReservations(at: number) {
    for (const r of this.reservations) {
      if (r.state !== 'Active' || r.expiryDate.getTime() > at) continue;
      r.state = 'Expired';
      await this.host.db.reservations.update(r.id, { state: 'Expired' });
      this.event(
        'Reservation',
        `Reservation ${r.reservationId} for ${r.idTag} expired`,
        'warning',
      );
      const c = this.connector(r.connectorId);
      if (c) this.refreshStatus(c);
      this.dirty = true;
    }
    this.reservations = this.reservations.filter((r) => r.state === 'Active');
  }

  // ---------------------------------------------------------- transactions

  /** A transaction can begin here: nothing is in the way but the authorization. */
  canStart(c: ConnectorRt): boolean {
    const e = c.entity;
    return (
      // A card check can come back after the power was cut or a restart began.
      this.cp.poweredOn &&
      this.state !== 'Rebooting' &&
      !c.session &&
      !c.pending &&
      !c.authorizing &&
      e.errorCode === 'NoError' &&
      e.availability === 'Operative' &&
      !this.maintenance
    );
  }

  async startSession(c: ConnectorRt, auth: StartAuth) {
    const { db } = this.host;
    const e = c.entity;
    const car = e.carId != null ? this.host.car(e.carId) : undefined;
    if (!car || c.session) return;
    const at = this.now();
    e.meterWh = Math.round(e.meterWh);

    const session = await db.sessions.save(
      db.sessions.create({
        chargePointId: this.cp.id,
        connectorId: e.connectorId,
        connectorType: e.type,
        carId: car.id,
        carName: car.name,
        idTag: auth.idTag,
        parentIdTag: auth.parentIdTag,
        transactionId: null,
        reservationId: auth.reservation?.reservationId ?? null,
        startedBy: auth.startedBy,
        meterStartWh: e.meterWh,
        energyWh: 0,
        startedAt: new Date(at),
        status: 'Active',
        startSoc: round1(socPercent(car)),
      }),
    );
    c.session = session;
    c.pending = null;
    c.authorizing = null;
    c.deauthorized = false;
    c.deauthEnergyWh = 0;
    e.finishing = false;
    e.locked = true;
    e.evPaused = false;
    e.evsePaused = false;
    c.dirty = true;

    if (auth.reservation) {
      auth.reservation.state = 'Used';
      await db.reservations.update(auth.reservation.id, { state: 'Used' });
      this.reservations = this.reservations.filter(
        (r) => r !== auth.reservation,
      );
    }
    if (auth.profile) {
      await this.requests.installProfile(
        e.connectorId,
        auth.profile,
        session.id,
      );
    }

    const payload: Record<string, unknown> = {
      connectorId: e.connectorId,
      idTag: auth.idTag,
      meterStart: e.meterWh,
      timestamp: this.ts(at),
    };
    if (auth.reservation)
      payload.reservationId = auth.reservation.reservationId;
    await this.enqueue('StartTransaction', payload, session.id);

    const interval = this.config.int('MeterValueSampleInterval');
    c.nextSampleAt =
      at +
      (interval > 0 ? interval : this.host.options.historySampleSec) * 1000;
    c.lastSampleWh = e.meterWh;
    await this.step(c, 0, at);
    if (!c.session) return; // a full battery can end a DC session on the spot
    await this.sample(c, 'Transaction.Begin', at, false);

    this.event(
      'SessionStarted',
      `Transaction started for ${car.name} with idTag ${auth.idTag} (${auth.startedBy.toLowerCase()} start)`,
      'success',
      c,
    );
    this.host.emit(ENGINE_EVENTS.session, {
      chargePointId: this.cp.id,
      sessionId: session.id,
    });
  }

  /** Readings to attach to StopTransaction (StopTxnSampledData). */
  private async transactionData(
    session: ChargingSession,
    c: ConnectorRt,
  ): Promise<unknown[]> {
    const measurands = this.config.csl('StopTxnSampledData');
    if (!measurands.length) return [];
    let rows = await this.host.db.samples.find({
      where: { sessionId: session.id },
      order: { id: 'ASC' },
    });
    const limit = 60;
    if (rows.length > limit) {
      const stride = (rows.length - 1) / (limit - 1);
      rows = Array.from(
        { length: limit },
        (_, i) => rows[Math.round(i * stride)],
      );
    }
    const phases = isDc(c.entity.type) ? 0 : c.entity.phases;
    return rows
      .map((row) => ({
        timestamp: this.ts(row.ts.getTime()),
        sampledValue: buildSampledValues(
          measurands,
          {
            energyWh: row.energyWh,
            intervalWh: 0,
            powerW: row.powerW,
            currentA: row.currentA,
            voltageV: row.voltageV,
            offeredW: 0,
            offeredA: 0,
            phases,
            soc: row.soc,
            temperatureC: 25,
            frequencyHz: 50,
          },
          row.context as ReadingContext,
          false,
        ),
      }))
      .filter((value) => value.sampledValue.length > 0);
  }

  async stopSession(
    c: ConnectorRt,
    reason: StopReason,
    opts: { idTag?: string; unplugged?: boolean } = {},
  ) {
    const { db } = this.host;
    const session = c.session;
    if (!session) return;
    const e = c.entity;
    const at = this.now();
    const car = e.carId != null ? this.host.car(e.carId) : undefined;

    c.telemetry.powerW = 0;
    c.telemetry.currentA = 0;
    e.meterWh = Math.round(e.meterWh);
    await this.sample(c, 'Transaction.End', at, false);

    Object.assign(session, {
      status: 'Stopped',
      stopReason: reason,
      stoppedAt: new Date(at),
      meterStopWh: e.meterWh,
      energyWh: e.meterWh - session.meterStartWh,
      stopSoc: car ? round1(socPercent(car)) : null,
    });
    await db.sessions.save(session);

    const payload: Record<string, unknown> = {
      transactionId: null,
      meterStop: e.meterWh,
      timestamp: this.ts(at),
      reason,
    };
    if (opts.idTag) payload.idTag = opts.idTag;
    const transactionData = await this.transactionData(session, c);
    if (transactionData.length) payload.transactionData = transactionData;
    await this.enqueue('StopTransaction', payload, session.id);

    c.session = null;
    c.deauthorized = false;
    c.deauthEnergyWh = 0;
    c.evSuspended = false;
    c.evseSuspended = false;
    if (opts.unplugged) e.carId = null;
    e.locked = false;
    e.evPaused = false;
    e.evsePaused = false;
    e.finishing = e.carId != null;
    if (e.scheduledAvailability) {
      e.availability = e.scheduledAvailability;
      e.scheduledAvailability = null;
    }
    c.telemetry = {
      ...this.idleTelemetry(e),
      temperatureC: c.telemetry.temperatureC,
      soc: c.telemetry.soc,
    };
    c.dirty = true;

    if (this.profiles.some((p) => p.sessionId === session.id)) {
      this.profiles = this.profiles.filter((p) => p.sessionId !== session.id);
      await db.profiles.delete({
        chargePointId: this.cp.id,
        sessionId: session.id,
      });
    }

    this.refreshStatus(c);
    this.event(
      'SessionStopped',
      `Transaction stopped (${reason}): ${(session.energyWh / 1000).toFixed(2)} kWh delivered`,
      reason === 'Local' ||
        reason === 'Remote' ||
        reason === 'EVDisconnected' ||
        reason === 'Other'
        ? 'info'
        : 'warning',
      c,
    );
    this.host.emit(ENGINE_EVENTS.session, {
      chargePointId: this.cp.id,
      sessionId: session.id,
    });
  }

  // ------------------------------------------------- at the charger itself

  /** The cable of a connector is pushed into a car's inlet. */
  plug(connectorId: number, car: Car): Promise<void> {
    return this.run(async () => {
      const c = this.need(connectorId);
      const e = c.entity;
      if (e.carId != null) {
        throw new EngineError(
          'This cable is already plugged into a car.',
          'conflict',
        );
      }
      if (!car.connectorTypes.includes(e.type)) {
        throw new EngineError(
          `A ${CONNECTOR_TYPE_INFO[e.type].label} plug does not fit ${car.name}.`,
          'conflict',
        );
      }
      e.carId = car.id;
      e.finishing = false;
      c.dirty = true;
      this.dirty = true;
      this.event('PlugIn', `${car.name} plugged in`, 'info', c);
      if (!this.cp.poweredOn || this.state === 'Rebooting') return;

      if (c.session) {
        // The cable is back while the transaction was kept open.
        await this.step(c, 0, this.now());
        return;
      }
      if (c.pending) {
        const auth = c.pending;
        await this.startSession(c, auth);
        return;
      }
      this.refreshStatus(c);
      if (
        this.cp.autoStart === 'plug' &&
        this.canStart(c) &&
        this.cp.defaultIdTag
      ) {
        this.tapToStart(c, this.cp.defaultIdTag, 'AutoStart', () => undefined);
      }
    });
  }

  /** The cable is pulled out of the car. */
  unplug(connectorId: number): Promise<void> {
    return this.run(async () => {
      const c = this.need(connectorId);
      const e = c.entity;
      if (e.carId == null) return;
      const car = this.host.car(e.carId);
      this.event('PlugOut', `${car?.name ?? 'Car'} unplugged`, 'info', c);
      this.dirty = true;

      const live = this.cp.poweredOn && this.state !== 'Rebooting';
      if (c.session && live) {
        if (this.config.bool('StopTransactionOnEVSideDisconnect')) {
          await this.stopSession(c, 'EVDisconnected', { unplugged: true });
        } else {
          // The transaction stays open; the car may come back.
          e.carId = null;
          if (this.config.bool('UnlockConnectorOnEVSideDisconnect'))
            e.locked = false;
          c.dirty = true;
          await this.step(c, 0, this.now());
        }
        return;
      }
      e.carId = null;
      e.finishing = false;
      c.dirty = true;
      c.telemetry.soc = null;
      if (live) this.refreshStatus(c);
      else e.status = this.computeStatus(c);
    });
  }

  /** Which connector an RFID tap is meant for, when the user did not point at one. */
  private connectorForTag(idTag: string): ConnectorRt | undefined {
    return (
      this.connectors.find((c) => c.session?.idTag === idTag) ??
      this.connectors.find((c) => c.entity.carId != null && this.canStart(c)) ??
      this.connectors.find((c) => this.canStart(c))
    );
  }

  /** An RFID card is held to the reader. Resolves when the charger has decided. */
  presentIdTag(idTag: string, connectorId?: number): Promise<TapResult> {
    return new Promise<TapResult>((resolve, reject) => {
      this.run(async () => {
        this.requirePower();
        const tag = idTag.trim();
        if (!tag) throw new EngineError('The card has no idTag.');
        if (tag.length > 20)
          throw new EngineError('An idTag has at most 20 characters.');
        const c =
          connectorId != null
            ? this.need(connectorId)
            : this.connectorForTag(tag);
        if (!c) {
          resolve({
            outcome: 'rejected',
            connectorId: null,
            message: 'No connector can take a card right now.',
          });
          return;
        }
        this.event('Rfid', `Card ${tag} presented`, 'info', c);
        if (c.authorizing) {
          resolve({
            outcome: 'rejected',
            connectorId: c.entity.connectorId,
            message: 'Another card is being checked.',
          });
          return;
        }
        if (c.session) await this.tapToStop(c, tag, resolve);
        else this.tapToStart(c, tag, 'Local', resolve);
      }).catch(reject);
    });
  }

  private async tapToStop(
    c: ConnectorRt,
    idTag: string,
    resolve: (r: TapResult) => void,
  ) {
    const session = c.session!;
    const connectorId = c.entity.connectorId;
    if (idTag === session.idTag) {
      await this.stopSession(c, 'Local', { idTag });
      resolve({
        outcome: 'stopped',
        connectorId,
        message: 'Transaction stopped.',
      });
      return;
    }
    // A different card may stop it only when both belong to the same group.
    c.authorizing = idTag;
    this.dirty = true;
    this.authorize(idTag, async (decision) => {
      c.authorizing = null;
      this.dirty = true;
      const sameGroup =
        decision.status === 'Accepted' &&
        !!decision.parentIdTag &&
        decision.parentIdTag === session.parentIdTag;
      if (c.session === session && sameGroup) {
        await this.stopSession(c, 'Local', { idTag });
        resolve({
          outcome: 'stopped',
          connectorId,
          message: 'Transaction stopped.',
        });
        return;
      }
      this.event(
        'Rfid',
        `Card ${idTag} may not stop this transaction`,
        'warning',
        c,
      );
      resolve({
        outcome: 'rejected',
        connectorId,
        status: decision.status,
        message: 'This card did not start the transaction.',
      });
    });
  }

  private tapToStart(
    c: ConnectorRt,
    idTag: string,
    startedBy: StartedBy,
    resolve: (r: TapResult) => void,
  ) {
    const connectorId = c.entity.connectorId;
    const refuse = (message: string, status?: string) => {
      this.event('Rfid', `Card ${idTag} refused: ${message}`, 'warning', c);
      resolve({ outcome: 'rejected', connectorId, status, message });
    };
    if (c.entity.errorCode !== 'NoError')
      return refuse('The connector is faulted.');
    if (c.entity.availability !== 'Operative' || this.maintenance) {
      return refuse('The connector is out of service.');
    }
    if (c.pending)
      return refuse('A card is already authorized here: plug in the cable.');

    c.authorizing = idTag;
    this.dirty = true;
    this.authorize(idTag, async (decision) => {
      c.authorizing = null;
      this.dirty = true;
      if (decision.status !== 'Accepted') {
        return refuse(
          `Authorization ${decision.status.toLowerCase()}.`,
          decision.status,
        );
      }
      if (!this.canStart(c)) return refuse('The connector is no longer free.');
      const check = this.reservationCheck(c, idTag, decision.parentIdTag);
      if (check.blocked)
        return refuse('The connector is reserved for another card.');

      const auth: StartAuth = {
        idTag,
        parentIdTag: decision.parentIdTag,
        startedBy,
        reservation: check.reservation,
        profile: null,
      };
      if (c.entity.carId != null) {
        await this.startSession(c, auth);
        resolve({
          outcome: 'started',
          connectorId,
          status: 'Accepted',
          message:
            decision.source === 'csms'
              ? 'Charging started.'
              : `Charging started (authorized from the ${decision.source}).`,
        });
        return;
      }
      const timeout = this.config.int('ConnectionTimeOut');
      c.pending = { ...auth, until: this.now() + timeout * 1000 };
      this.refreshStatus(c);
      this.event(
        'Authorized',
        `Card ${idTag} accepted: waiting ${timeout} s for the cable`,
        'success',
        c,
      );
      resolve({
        outcome: 'authorized',
        connectorId,
        status: 'Accepted',
        message: `Card accepted. Plug in within ${timeout} s.`,
      });
    });
  }

  /** The stop button on the charger. */
  pressStop(connectorId: number): Promise<void> {
    return this.run(async () => {
      this.requirePower();
      const c = this.need(connectorId);
      if (c.pending) {
        c.pending = null;
        this.refreshStatus(c);
        return;
      }
      if (!c.session)
        throw new EngineError(
          'No transaction is running on this connector.',
          'conflict',
        );
      await this.stopSession(c, 'Local');
    });
  }

  /** Put a connector into an error state (fatal) or just report an error code (warning). */
  setFault(
    connectorId: number,
    fault: {
      errorCode: ErrorCode;
      info?: string;
      vendorErrorCode?: string;
      fatal?: boolean;
    },
  ): Promise<void> {
    return this.run(async () => {
      const c = this.need(connectorId);
      const e = c.entity;
      if (fault.errorCode === 'NoError')
        throw new EngineError('NoError is not a fault; use "clear fault".');
      if (fault.fatal === false) {
        // A warning: reported once with the current status, nothing stops.
        this.event(
          'Warning',
          `Connector reports ${fault.errorCode}${fault.info ? ` (${fault.info})` : ''}`,
          'warning',
          c,
        );
        if (this.registered) {
          this.request('StatusNotification', {
            connectorId: e.connectorId,
            errorCode: fault.errorCode,
            status: e.status,
            timestamp: this.ts(),
            ...(fault.info ? { info: fault.info.slice(0, 50) } : {}),
            ...(fault.vendorErrorCode
              ? {
                  vendorId: this.cp.vendor,
                  vendorErrorCode: fault.vendorErrorCode.slice(0, 50),
                }
              : {}),
          });
        }
        return;
      }
      e.errorCode = fault.errorCode;
      e.errorInfo = fault.info ?? '';
      e.vendorErrorCode = fault.vendorErrorCode ?? '';
      c.pending = null;
      c.dirty = true;
      this.event(
        'Fault',
        `Connector faulted: ${fault.errorCode}${fault.info ? ` (${fault.info})` : ''}`,
        'error',
        c,
      );
      if (!this.cp.poweredOn) {
        e.status = this.computeStatus(c);
        return;
      }
      if (c.session) await this.stopSession(c, 'Other');
      this.refreshStatus(c, true);
    });
  }

  clearFault(connectorId: number): Promise<void> {
    return this.run(() => {
      const c = this.need(connectorId);
      const e = c.entity;
      if (e.errorCode === 'NoError') return;
      e.errorCode = 'NoError';
      e.errorInfo = '';
      e.vendorErrorCode = '';
      c.dirty = true;
      this.event('FaultCleared', 'Fault cleared', 'success', c);
      if (this.cp.poweredOn) this.refreshStatus(c, true);
      else e.status = this.computeStatus(c);
    });
  }

  /** The red mushroom button: everything stops and stays faulted until it is released. */
  emergencyStop(pressed: boolean): Promise<void> {
    return this.run(async () => {
      this.requirePower();
      if (pressed) {
        this.event('EmergencyStop', 'Emergency stop pressed', 'error');
        for (const c of this.connectors) {
          if (c.session) await this.stopSession(c, 'EmergencyStop');
          c.pending = null;
          c.entity.errorCode = 'OtherError';
          c.entity.errorInfo = 'EmergencyStop';
          c.dirty = true;
          this.refreshStatus(c, true);
        }
      } else {
        this.event('EmergencyStop', 'Emergency stop released', 'success');
        for (const c of this.connectors) {
          if (c.entity.errorInfo !== 'EmergencyStop') continue;
          c.entity.errorCode = 'NoError';
          c.entity.errorInfo = '';
          c.dirty = true;
          this.refreshStatus(c, true);
        }
      }
      this.sendStatusZero();
    });
  }

  /** The car (ev) or the charger (evse) pauses and resumes a running transaction. */
  setPaused(
    connectorId: number,
    who: 'ev' | 'evse',
    paused: boolean,
  ): Promise<void> {
    return this.run(async () => {
      this.requirePower();
      const c = this.need(connectorId);
      if (!c.session)
        throw new EngineError(
          'No transaction is running on this connector.',
          'conflict',
        );
      if (who === 'ev') c.entity.evPaused = paused;
      else c.entity.evsePaused = paused;
      c.dirty = true;
      this.event(
        'Pause',
        `${who === 'ev' ? 'The car' : 'The charger'} ${paused ? 'paused' : 'resumed'} charging`,
        'info',
        c,
      );
      await this.step(c, 0, this.now());
    });
  }

  /**
   * Take connectors out of service or bring them back (connectorId 0 = all).
   * Used by ChangeAvailability and by the charger's own service menu.
   */
  applyAvailability(
    connectorId: number,
    type: Availability,
  ): 'Accepted' | 'Scheduled' | 'Rejected' {
    const targets =
      connectorId === 0 ? this.connectors : [this.connector(connectorId)];
    if (targets.some((c) => !c)) return 'Rejected';
    let scheduled = false;
    if (connectorId === 0) {
      this.cp.availability = type;
      this.markCpDirty();
    }
    for (const c of targets as ConnectorRt[]) {
      const e = c.entity;
      if (type === 'Inoperative' && c.session) {
        // Never interrupt a paying customer: the change waits for the transaction to end.
        e.scheduledAvailability = type;
        scheduled = true;
      } else {
        e.availability = type;
        e.scheduledAvailability = null;
        if (type === 'Inoperative') c.pending = null;
      }
      c.dirty = true;
      this.refreshStatus(c);
    }
    if (connectorId === 0) this.sendStatusZero();
    this.dirty = true;
    return scheduled ? 'Scheduled' : 'Accepted';
  }

  setAvailability(connectorId: number, type: Availability): Promise<string> {
    return this.run(() => {
      const result = this.applyAvailability(connectorId, type);
      if (result === 'Rejected')
        throw new EngineError(
          `Connector ${connectorId} does not exist.`,
          'not-found',
        );
      this.event(
        'Availability',
        `${connectorId === 0 ? 'Charge point' : `Connector ${connectorId}`} set ${type} at the charger${result === 'Scheduled' ? ' (after the running transaction)' : ''}`,
        'info',
        connectorId === 0 ? null : this.connector(connectorId),
      );
      return result;
    });
  }

  // ---------------------------------------------------------- configuration

  private readDynamicKey(key: string): string | undefined {
    switch (key) {
      case 'NumberOfConnectors':
        return String(this.connectors.length);
      case 'ConnectorPhaseRotationMaxLength':
        return String(this.connectors.length + 1);
      case 'ConnectorPhaseRotation':
        return (
          this.cp.configuration.ConnectorPhaseRotation ??
          [
            '0.RST',
            ...this.connectors.map((c) => `${c.entity.connectorId}.RST`),
          ].join(',')
        );
      case 'SecurityProfile':
        return String(this.securityProfile());
      default:
        return undefined;
    }
  }

  private writeDynamicKey(
    key: string,
    value: string,
  ): ChangeResult | undefined {
    switch (key) {
      case 'ConnectorPhaseRotation':
        this.cp.configuration.ConnectorPhaseRotation = value;
        return 'Accepted';
      case 'AuthorizationKey':
        if (!value) return 'Rejected';
        this.cp.basicAuthPassword = value;
        this.pendingReconnect = 'the AuthorizationKey changed';
        return 'Accepted';
      case 'SecurityProfile': {
        const wanted = Number(value);
        const current = this.securityProfile();
        if (wanted === current) return 'Accepted';
        // A charger never lowers its security profile.
        if (wanted < current) return 'Rejected';
        if (wanted === 1 && !this.cp.basicAuthPassword) return 'Rejected';
        if (wanted === 2 && !this.cp.basicAuthPassword) return 'Rejected';
        if (wanted === 3 && !(this.cp.tlsClientCert && this.cp.tlsClientKey))
          return 'Rejected';
        if (wanted >= 2)
          this.cp.csmsUrl = this.cp.csmsUrl.replace(/^ws:/i, 'wss:');
        this.pendingReconnect = `the security profile changed to ${wanted}`;
        return 'Accepted';
      }
      default:
        return undefined;
    }
  }

  private onConfigChanged(key: string) {
    this.markCpDirty();
    switch (key) {
      case 'HeartbeatInterval':
        this.nextHeartbeatAt =
          this.now() + this.config.int('HeartbeatInterval') * 1000;
        break;
      case 'WebSocketPingInterval':
        this.rpc?.setPingInterval(
          this.config.int('WebSocketPingInterval') * 1000,
        );
        break;
      case 'MeterValueSampleInterval': {
        const interval = this.config.int('MeterValueSampleInterval');
        for (const c of this.connectors) {
          if (c.session) {
            c.nextSampleAt =
              this.now() +
              (interval > 0 ? interval : this.host.options.historySampleSec) *
                1000;
          }
        }
        break;
      }
      case 'ClockAlignedDataInterval':
        this.alignedSlot = null;
        break;
      case 'LocalAuthListEnabled':
      case 'AuthorizationCacheEnabled':
        break;
      default:
        break;
    }
  }

  /** An edit in the charger's service menu (the UI's configuration table). */
  setConfig(key: string, value: string): Promise<ChangeResult> {
    return this.run(() => {
      const result = this.config.setLocal(key, value);
      if (result === 'Rejected') {
        throw new EngineError(`"${value}" is not a valid value for ${key}.`);
      }
      this.event(
        'Config',
        `${key} set to "${key === 'AuthorizationKey' ? '***' : value}" at the charger`,
      );
      const reason = this.pendingReconnect;
      this.pendingReconnect = null;
      if (reason) this.reconnect(reason);
      return result;
    });
  }

  removeConfigKey(key: string): Promise<void> {
    return this.run(() => {
      if (!this.config.removeVendorKey(key)) {
        throw new EngineError(
          `${key} is a standard key and cannot be removed.`,
          'conflict',
        );
      }
    });
  }

  // ---------------------------------------------------- settings & hardware

  private connectionFingerprint(): string {
    const { cp } = this;
    return [
      this.resolvedUrl(),
      cp.chargePointId,
      cp.basicAuthUser,
      cp.basicAuthPassword,
      cp.tlsVerify,
      cp.tlsCaCert,
      cp.tlsClientCert,
      cp.tlsClientKey,
    ].join('\u0000');
  }

  updateSettings(patch: Partial<ChargePoint>): Promise<void> {
    return this.run(() => {
      const before = this.connectionFingerprint();
      const nameplate = [
        this.cp.vendor,
        this.cp.model,
        this.cp.serialNumber,
        this.cp.firmwareVersion,
      ].join('|');
      Object.assign(this.cp, patch);
      this.markCpDirty();
      const after = this.connectionFingerprint();
      const nameplateAfter = [
        this.cp.vendor,
        this.cp.model,
        this.cp.serialNumber,
        this.cp.firmwareVersion,
      ].join('|');
      if (before !== after) this.reconnect('connection settings changed');
      else if (nameplate !== nameplateAfter && this.registered) {
        // New nameplate data reaches the CSMS with the next BootNotification.
        this.sendBoot();
      }
    });
  }

  addConnector(input: {
    type: ConnectorType;
    maxPowerW?: number;
    phases?: number;
    side?: 'left' | 'right';
  }): Promise<void> {
    return this.run(async () => {
      const { db } = this.host;
      const connectorId = this.connectors.length + 1;
      const maxPowerW =
        input.maxPowerW ?? CONNECTOR_TYPE_INFO[input.type].defaultPowerW;
      const entity = await db.connectors.save(
        db.connectors.create({
          chargePointId: this.cp.id,
          connectorId,
          type: input.type,
          maxPowerW,
          phases: input.phases ?? defaultPhases(input.type, maxPowerW),
          side: input.side ?? (connectorId % 2 === 1 ? 'left' : 'right'),
          status: 'Available',
          errorCode: 'NoError',
          availability: this.cp.availability,
          meterWh: 0,
        }),
      );
      const c = this.makeRt(entity);
      this.connectors.push(c);
      c.entity.status = this.computeStatus(c);
      c.dirty = true;
      this.dirty = true;
      this.event(
        'Hardware',
        `Connector ${connectorId} added (${CONNECTOR_TYPE_INFO[input.type].label})`,
        'info',
        c,
      );
      if (this.cp.poweredOn) this.sendStatus(c);
    });
  }

  updateConnector(
    connectorId: number,
    patch: {
      type?: ConnectorType;
      maxPowerW?: number;
      phases?: number;
      side?: 'left' | 'right';
    },
  ): Promise<void> {
    return this.run(() => {
      const c = this.need(connectorId);
      const e = c.entity;
      const typeChanges = patch.type !== undefined && patch.type !== e.type;
      if (typeChanges && (c.session || e.carId != null)) {
        throw new EngineError(
          'Unplug the car before changing the connector type.',
          'conflict',
        );
      }
      if (patch.type !== undefined) e.type = patch.type;
      if (patch.maxPowerW !== undefined) e.maxPowerW = patch.maxPowerW;
      if (patch.side !== undefined) e.side = patch.side;
      if (patch.phases !== undefined) e.phases = patch.phases;
      else if (typeChanges || patch.maxPowerW !== undefined)
        e.phases = defaultPhases(e.type, e.maxPowerW);
      if (typeChanges) {
        c.telemetry = this.idleTelemetry(e);
        this.event(
          'Hardware',
          `Connector ${connectorId} is now ${CONNECTOR_TYPE_INFO[e.type].label}`,
          'info',
          c,
        );
      }
      c.dirty = true;
      this.dirty = true;
    });
  }

  /** Connector ids must stay 1..n, so only the highest one can go. */
  removeLastConnector(): Promise<void> {
    return this.run(async () => {
      const c = this.connectors[this.connectors.length - 1];
      if (!c)
        throw new EngineError('This charger has no connector.', 'conflict');
      if (this.connectors.length === 1) {
        throw new EngineError(
          'A charger needs at least one connector.',
          'conflict',
        );
      }
      if (c.session || c.entity.carId != null) {
        throw new EngineError(
          'Unplug the car before removing the connector.',
          'conflict',
        );
      }
      this.connectors.pop();
      c.dirty = false;
      await this.host.db.connectors.delete(c.entity.id);
      this.reservations = this.reservations.filter(
        (r) => r.connectorId !== c.entity.connectorId,
      );
      this.profiles = this.profiles.filter(
        (p) => p.connectorId !== c.entity.connectorId,
      );
      await this.host.db.profiles.delete({
        chargePointId: this.cp.id,
        connectorId: c.entity.connectorId,
      });
      await this.host.db.reservations.delete({
        chargePointId: this.cp.id,
        connectorId: c.entity.connectorId,
      });
      this.event('Hardware', `Connector ${c.entity.connectorId} removed`);
      this.dirty = true;
    });
  }

  /** Which car, if any, each connector holds. */
  pluggedCarIds(): number[] {
    return this.connectors
      .map((c) => c.entity.carId)
      .filter((id): id is number => id != null);
  }

  /** A car's data changed outside the engine (battery slider, edit form). */
  carUpdated(carId: number): Promise<void> {
    return this.run(async () => {
      for (const c of this.connectors) {
        if (c.entity.carId !== carId) continue;
        this.dirty = true;
        if (c.session && this.cp.poweredOn) await this.step(c, 0, this.now());
      }
    });
  }

  // -------------------------------------------------------------------- DTO

  private reservationDto(r: Reservation): ReservationDto {
    return {
      reservationId: r.reservationId,
      connectorId: r.connectorId,
      idTag: r.idTag,
      parentIdTag: r.parentIdTag,
      expiryDate: r.expiryDate.toISOString(),
    };
  }

  private connectorDto(c: ConnectorRt): ConnectorDto {
    const e = c.entity;
    const s = c.session;
    const reservation = this.activeReservation(c);
    return {
      id: e.id,
      connectorId: e.connectorId,
      type: e.type,
      maxPowerW: e.maxPowerW,
      phases: e.phases,
      side: e.side,
      status: e.status,
      errorCode: e.errorCode,
      errorInfo: e.errorInfo,
      vendorErrorCode: e.vendorErrorCode,
      availability: e.availability,
      scheduledAvailability: e.scheduledAvailability,
      meterWh: e.meterWh,
      locked: e.locked,
      finishing: e.finishing,
      evPaused: e.evPaused,
      evsePaused: e.evsePaused,
      carId: e.carId,
      authorizing: c.authorizing,
      pending: c.pending
        ? {
            idTag: c.pending.idTag,
            until: new Date(c.pending.until).toISOString(),
            startedBy: c.pending.startedBy,
          }
        : null,
      reservation: reservation ? this.reservationDto(reservation) : null,
      session: s
        ? {
            id: s.id,
            transactionId: s.transactionId,
            idTag: s.idTag,
            startedAt: s.startedAt.toISOString(),
            startedBy: s.startedBy,
            meterStartWh: s.meterStartWh,
            energyWh: s.energyWh,
            startSoc: s.startSoc,
            chargingSec: s.chargingSec,
            startConfirmed: s.startConfirmed,
            idTagStatus: s.idTagStatus,
            deauthorized: c.deauthorized,
          }
        : null,
      telemetry: { ...c.telemetry },
    };
  }

  toDto(): ChargePointDto {
    const { cp } = this;
    return {
      id: cp.id,
      name: cp.name,
      chargePointId: cp.chargePointId,
      vendor: cp.vendor,
      model: cp.model,
      serialNumber: cp.serialNumber,
      chargeBoxSerialNumber: cp.chargeBoxSerialNumber,
      firmwareVersion: cp.firmwareVersion,
      iccid: cp.iccid,
      imsi: cp.imsi,
      meterType: cp.meterType,
      meterSerialNumber: cp.meterSerialNumber,
      csmsUrl: cp.csmsUrl,
      appendIdToUrl: cp.appendIdToUrl,
      basicAuthUser: cp.basicAuthUser,
      basicAuthPassword: cp.basicAuthPassword,
      tlsVerify: cp.tlsVerify,
      tlsCaCert: cp.tlsCaCert,
      tlsClientCert: cp.tlsClientCert,
      hasTlsClientKey: !!cp.tlsClientKey,
      defaultIdTag: cp.defaultIdTag,
      autoStart: cp.autoStart,
      fullBatteryBehavior: cp.fullBatteryBehavior,
      speed: cp.speed,
      bootOnReconnect: cp.bootOnReconnect,
      rebootSeconds: cp.rebootSeconds,
      perPhaseMeterValues: cp.perPhaseMeterValues,
      securityEvents: cp.securityEvents,
      dataTransferMode: cp.dataTransferMode,
      responseOverrides: cp.responseOverrides ?? {},
      firmwareFailure: cp.firmwareFailure,
      diagnosticsFailure: cp.diagnosticsFailure,
      unlockFailure: cp.unlockFailure,
      poweredOn: cp.poweredOn,
      networkUp: cp.networkUp,
      availability: cp.availability,
      localListVersion: cp.localListVersion,
      firmwareStatus: cp.firmwareStatus,
      diagnosticsStatus: cp.diagnosticsStatus,
      lastBootAt: iso(cp.lastBootAt),
      lastHeartbeatAt: iso(cp.lastHeartbeatAt),
      lastConnectedAt: iso(cp.lastConnectedAt),
      lastDisconnectedAt: iso(cp.lastDisconnectedAt),
      createdAt: iso(cp.createdAt) ?? new Date(this.now()).toISOString(),
      resolvedUrl: this.resolvedUrl(),
      securityProfile: this.securityProfile(),
      state: this.state,
      stateSince: new Date(this.stateSince).toISOString(),
      connection: {
        lastError: this.conn.lastError,
        attempt: this.conn.attempt,
        nextRetryAt: this.conn.nextRetryAt
          ? new Date(this.conn.nextRetryAt).toISOString()
          : null,
        bootRetryAt: this.conn.bootRetryAt
          ? new Date(this.conn.bootRetryAt).toISOString()
          : null,
        protocol: this.conn.protocol,
        heartbeatInterval: this.config.int('HeartbeatInterval'),
      },
      emergency: this.emergency,
      maintenance: this.maintenance,
      queueLength: this.queue.length,
      reservations: this.reservations
        .filter((r) => r.state === 'Active' && r.connectorId === 0)
        .map((r) => this.reservationDto(r)),
      connectors: this.connectors.map((c) => this.connectorDto(c)),
    };
  }

  /** Ready-to-edit payloads for every message a charge point can send. */
  commandTemplates(): Record<string, unknown> {
    const first = this.connectors[0];
    const busy = this.connectors.find((c) => c.session) ?? first;
    const connectorId = busy?.entity.connectorId ?? 1;
    const session = busy?.session ?? null;
    const sampledValue = busy
      ? buildSampledValues(
          this.config.csl('MeterValuesSampledData'),
          this.reading(busy),
          'Sample.Periodic',
          this.cp.perPhaseMeterValues,
        )
      : [];
    return {
      BootNotification: this.bootPayload(),
      Heartbeat: {},
      Authorize: { idTag: this.cp.defaultIdTag },
      StatusNotification: {
        connectorId,
        errorCode: busy?.entity.errorCode ?? 'NoError',
        status: busy?.entity.status ?? 'Available',
        timestamp: this.ts(),
      },
      MeterValues: {
        connectorId,
        ...(session?.transactionId != null
          ? { transactionId: session.transactionId }
          : {}),
        meterValue: [{ timestamp: this.ts(), sampledValue }],
      },
      StartTransaction: {
        connectorId,
        idTag: this.cp.defaultIdTag,
        meterStart: Math.round(busy?.entity.meterWh ?? 0),
        timestamp: this.ts(),
      },
      StopTransaction: {
        transactionId: session?.transactionId ?? 0,
        meterStop: Math.round(busy?.entity.meterWh ?? 0),
        timestamp: this.ts(),
        reason: 'Local',
      },
      DataTransfer: { vendorId: this.cp.vendor, messageId: 'ping', data: '' },
      DiagnosticsStatusNotification: { status: 'Idle' },
      FirmwareStatusNotification: { status: 'Idle' },
      SecurityEventNotification: {
        type: 'TamperDetectionActivated',
        timestamp: this.ts(),
      },
      LogStatusNotification: { status: 'Idle' },
      SignedFirmwareStatusNotification: { status: 'Idle' },
    };
  }

  /** What the charger keeps in its head: for the UI's "internals" view. */
  internals() {
    return {
      queue: this.queueSnapshot(),
      reservations: this.reservations.map((r) => this.reservationDto(r)),
      chargingProfiles: this.profiles.map((p) => ({
        id: p.id,
        connectorId: p.connectorId,
        chargingProfileId: p.chargingProfileId,
        transactionId: p.transactionId,
        stackLevel: p.stackLevel,
        purpose: p.purpose,
        kind: p.kind,
        recurrencyKind: p.recurrencyKind,
        validFrom: iso(p.validFrom),
        validTo: iso(p.validTo),
        schedule: p.schedule,
        installedAt: iso(p.installedAt),
      })),
      localList: {
        version: this.cp.localListVersion,
        enabled: this.config.bool('LocalAuthListEnabled'),
        entries: [...this.authList.values()].map((e) => ({
          idTag: e.idTag,
          status: e.status,
          parentIdTag: e.parentIdTag,
          expiryDate: iso(e.expiryDate),
        })),
      },
      authCache: [...this.authCache.values()].map((e) => ({
        idTag: e.idTag,
        status: e.status,
        parentIdTag: e.parentIdTag,
        expiryDate: iso(e.expiryDate),
      })),
      limits: this.connectors.map((c) => ({
        connectorId: c.entity.connectorId,
        limitW: c.telemetry.limitW,
        source: c.telemetry.limitSource,
      })),
    };
  }

  /** Forget locally stored authorization data (service menu). */
  clearAuthorization(source: 'list' | 'cache'): Promise<void> {
    return this.run(async () => {
      await this.host.db.auth.delete({ chargePointId: this.cp.id, source });
      if (source === 'cache') this.authCache.clear();
      else {
        this.authList.clear();
        this.cp.localListVersion = 0;
        this.markCpDirty();
      }
      this.event(
        'Auth',
        source === 'cache'
          ? 'Authorization cache cleared at the charger'
          : 'Local authorization list cleared at the charger',
      );
      this.dirty = true;
    });
  }

  /** Set, replace or remove (null) the test override for one CSMS request. */
  setOverride(
    action: string,
    override: ResponseOverride | null,
  ): Promise<void> {
    return this.run(() => {
      const map = { ...(this.cp.responseOverrides ?? {}) };
      if (override) map[action] = override;
      else delete map[action];
      this.cp.responseOverrides = map;
      this.markCpDirty();
    });
  }

  /** Send a SecurityEventNotification by hand (tamper switch, etc.). */
  raiseSecurityEvent(type: string, techInfo?: string): Promise<void> {
    return this.run(() => {
      if (!this.registered)
        throw new EngineError(
          'The charger is not connected to a CSMS.',
          'conflict',
        );
      this.event('Security', `Security event: ${type}`, 'warning');
      this.request('SecurityEventNotification', {
        type: type.slice(0, 50),
        timestamp: this.ts(),
        ...(techInfo ? { techInfo: techInfo.slice(0, 255) } : {}),
      });
    });
  }

  requestCertificate(): Promise<void> {
    return this.run(() => {
      if (!this.registered)
        throw new EngineError(
          'The charger is not connected to a CSMS.',
          'conflict',
        );
      this.requests.signCertificate();
    });
  }

  /** The offline queue, for the UI. */
  queueSnapshot() {
    return this.queue.map((m) => ({
      id: m.id,
      action: m.action,
      sessionId: m.sessionId,
      attempts: m.attempts,
      createdAt: iso(m.createdAt),
      payload: m.payload,
    }));
  }
}
