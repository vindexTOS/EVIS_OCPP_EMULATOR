import { EventEmitter } from 'events';
import { RpcClient } from '../core/rpc-client';
import {
  AuthorizeConf,
  BootNotificationConf,
  ChangeAvailabilityReq,
  ChangeConfigurationReq,
  GetConfigurationReq,
  MeterValue,
  RemoteStartTransactionReq,
  RemoteStopTransactionReq,
  ResetReq,
  SampledValue,
  SetChargingProfileReq,
  StartTransactionConf,
  TriggerMessageReq,
  UnlockConnectorReq,
} from './messages';

export interface ChargePoint16Params {
  csmsUrl: string;
  vendor: string;
  model: string;
  firmwareVersion: string;
  idTag: string;
  connectorIds: number[];
  configuration: Record<string, string>;
}

const ASSUMED_VOLTAGE = 230;

export class ChargePoint16Connection extends EventEmitter {
  private readonly rpc: RpcClient;
  private heartbeatTimer?: NodeJS.Timeout;
  private readonly profileLimitsW = new Map<number, number>();

  constructor(private readonly params: ChargePoint16Params) {
    super();
    this.rpc = new RpcClient(params.csmsUrl, { subProtocol: 'ocpp1.6' });
    this.rpc.on('open', () => void this.onOpen());
    this.rpc.on('close', () => this.onClose());
    this.rpc.on('error', (err) => this.emit('error', err));
    this.registerHandlers();
  }

  start() {
    this.rpc.connect();
  }

  stop() {
    this.clearHeartbeat();
    this.rpc.close();
  }

  get connected() {
    return this.rpc.connected;
  }

  getProfileLimitW(connectorId: number): number | null {
    return (
      this.profileLimitsW.get(connectorId) ??
      this.profileLimitsW.get(0) ??
      null
    );
  }

  // --- Outgoing (CP -> CSMS) ---

  async bootNotification(): Promise<BootNotificationConf> {
    return this.rpc.call<BootNotificationConf>('BootNotification', {
      chargePointVendor: this.params.vendor,
      chargePointModel: this.params.model,
      firmwareVersion: this.params.firmwareVersion,
    });
  }

  heartbeat() {
    return this.rpc.call('Heartbeat', {});
  }

  statusNotification(connectorId: number, status: string, errorCode = 'NoError') {
    return this.rpc.call('StatusNotification', {
      connectorId,
      errorCode,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  async authorize(idTag: string): Promise<string> {
    const conf = await this.rpc.call<AuthorizeConf>('Authorize', { idTag });
    return conf.idTagInfo.status;
  }

  async startTransaction(
    connectorId: number,
    idTag: string,
    meterStart: number,
  ): Promise<number> {
    const conf = await this.rpc.call<StartTransactionConf>(
      'StartTransaction',
      {
        connectorId,
        idTag,
        meterStart: Math.round(meterStart),
        timestamp: new Date().toISOString(),
      },
    );
    return conf.transactionId;
  }

  stopTransaction(transactionId: number, meterStop: number, reason: string) {
    return this.rpc.call('StopTransaction', {
      transactionId,
      meterStop: Math.round(meterStop),
      timestamp: new Date().toISOString(),
      reason,
    });
  }

  meterValues(
    connectorId: number,
    transactionId: number,
    sampledValue: SampledValue[],
  ) {
    const meterValue: MeterValue[] = [
      { timestamp: new Date().toISOString(), sampledValue },
    ];
    return this.rpc.call('MeterValues', {
      connectorId,
      transactionId,
      meterValue,
    });
  }

  // --- Lifecycle ---

  private async onOpen() {
    try {
      const conf = await this.bootNotification();
      if (conf.status !== 'Accepted') {
        this.emit('bootRejected', conf.status);
        return;
      }
      const interval =
        conf.interval > 0
          ? conf.interval
          : Number(this.params.configuration.HeartbeatInterval ?? 60);
      this.startHeartbeat(interval);
      for (const connectorId of this.params.connectorIds) {
        await this.statusNotification(connectorId, 'Available');
      }
      this.emit('boot');
    } catch (err) {
      this.emit('error', err);
    }
  }

  private onClose() {
    this.clearHeartbeat();
    this.emit('close');
  }

  private startHeartbeat(intervalSec: number) {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(
      () => void this.heartbeat().catch(() => undefined),
      intervalSec * 1000,
    );
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  // --- Incoming (CSMS -> CP) ---

  private registerHandlers() {
    this.rpc.handle('RemoteStartTransaction', (p) => {
      const req = p as RemoteStartTransactionReq;
      this.emit('remoteStart', {
        connectorId: req.connectorId ?? 1,
        idTag: req.idTag,
      });
      return { status: 'Accepted' };
    });

    this.rpc.handle('RemoteStopTransaction', (p) => {
      const req = p as RemoteStopTransactionReq;
      this.emit('remoteStop', { transactionId: req.transactionId });
      return { status: 'Accepted' };
    });

    this.rpc.handle('Reset', (p) => {
      this.emit('reset', { type: (p as ResetReq).type });
      return { status: 'Accepted' };
    });

    this.rpc.handle('UnlockConnector', (p) => {
      this.emit('unlock', { connectorId: (p as UnlockConnectorReq).connectorId });
      return { status: 'Unlocked' };
    });

    this.rpc.handle('ChangeAvailability', (p) => {
      const req = p as ChangeAvailabilityReq;
      this.emit('changeAvailability', req);
      return { status: 'Accepted' };
    });

    this.rpc.handle('ChangeConfiguration', (p) => {
      const req = p as ChangeConfigurationReq;
      this.params.configuration[req.key] = req.value;
      this.emit('configChanged', req);
      return { status: 'Accepted' };
    });

    this.rpc.handle('GetConfiguration', (p) => {
      const keys = (p as GetConfigurationReq).key;
      const all = Object.entries(this.params.configuration).map(
        ([key, value]) => ({ key, value, readonly: false }),
      );
      const configurationKey = keys
        ? all.filter((c) => keys.includes(c.key))
        : all;
      return { configurationKey, unknownKey: [] };
    });

    this.rpc.handle('SetChargingProfile', (p) => {
      const req = p as SetChargingProfileReq;
      const schedule = req.csChargingProfiles?.chargingSchedule;
      const period = schedule?.chargingSchedulePeriod?.[0];
      if (period) {
        const limitW =
          schedule.chargingRateUnit === 'A'
            ? period.limit * ASSUMED_VOLTAGE
            : period.limit;
        this.profileLimitsW.set(req.connectorId, limitW);
        this.emit('profileChanged', { connectorId: req.connectorId, limitW });
      }
      return { status: 'Accepted' };
    });

    this.rpc.handle('ClearChargingProfile', () => {
      this.profileLimitsW.clear();
      return { status: 'Accepted' };
    });

    this.rpc.handle('TriggerMessage', (p) => {
      const req = p as TriggerMessageReq;
      const supported = [
        'Heartbeat',
        'StatusNotification',
        'BootNotification',
      ];
      if (!supported.includes(req.requestedMessage)) {
        return { status: 'NotImplemented' };
      }
      this.emit('trigger', req);
      return { status: 'Accepted' };
    });
  }
}
