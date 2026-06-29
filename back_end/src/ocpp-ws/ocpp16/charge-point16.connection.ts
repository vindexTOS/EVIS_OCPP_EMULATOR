import { EventEmitter } from 'events';
import { RpcClient } from '../core/rpc-client';
import {
  AuthorizeConf,
  BootNotificationConf,
  CancelReservationReq,
  ChangeAvailabilityReq,
  ChangeConfigurationReq,
  DataTransferConf,
  DataTransferReq,
  GetCompositeScheduleReq,
  GetConfigurationReq,
  GetDiagnosticsReq,
  MeterValue,
  RemoteStartTransactionReq,
  RemoteStopTransactionReq,
  ReserveNowReq,
  ResetReq,
  SampledValue,
  SendLocalListReq,
  SetChargingProfileReq,
  StartTransactionConf,
  TriggerMessageReq,
  UnlockConnectorReq,
  UpdateFirmwareReq,
} from './messages';

export interface ChargePoint16Params {
  csmsUrl: string;
  chargePointId: string;
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
  // One-shot rejection overrides for testing CSMS-side handling.
  private rejectBoot = false;
  private rejectAuthorize = false;
  private localListVersion = 0;

  constructor(private readonly params: ChargePoint16Params) {
    super();
    this.rpc = new RpcClient(params.csmsUrl, { subProtocol: 'ocpp1.6' });
    this.rpc.on('open', () => void this.onOpen());
    this.rpc.on('close', () => this.onClose());
    this.rpc.on('error', (err) => this.emit('error', err));
    this.rpc.on('frame', (f) => this.emit('frame', f));
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
      // Stable identity so the CSMS recognises this exact charge point.
      chargePointSerialNumber: this.params.chargePointId,
      chargeBoxSerialNumber: this.params.chargePointId,
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
    if (this.rejectAuthorize) {
      this.rejectAuthorize = false;
      this.emit('authorizeRejected', idTag);
      return 'Blocked';
    }
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

  dataTransfer(req: DataTransferReq) {
    return this.rpc.call<DataTransferConf>('DataTransfer', req);
  }

  diagnosticsStatusNotification(status: string) {
    return this.rpc.call('DiagnosticsStatusNotification', { status });
  }

  firmwareStatusNotification(status: string) {
    return this.rpc.call('FirmwareStatusNotification', { status });
  }

  /** Invoke any CP -> CSMS action by name (used by the manual command API). */
  sendCall<T = unknown>(action: string, payload: unknown): Promise<T> {
    return this.rpc.call<T>(action, payload);
  }

  /** Arm one-shot rejection of the next BootNotification / Authorize. */
  simulateReject({ boot, authorize }: { boot?: boolean; authorize?: boolean }) {
    if (boot != null) this.rejectBoot = boot;
    if (authorize != null) this.rejectAuthorize = authorize;
    return { rejectBoot: this.rejectBoot, rejectAuthorize: this.rejectAuthorize };
  }

  // --- Lifecycle ---

  private async onOpen() {
    try {
      const conf = await this.bootNotification();
      if (this.rejectBoot) {
        this.rejectBoot = false;
        this.emit('bootRejected', 'Rejected');
        return;
      }
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
        'MeterValues',
        'DiagnosticsStatusNotification',
        'FirmwareStatusNotification',
      ];
      if (!supported.includes(req.requestedMessage)) {
        return { status: 'NotImplemented' };
      }
      this.emit('trigger', req);
      return { status: 'Accepted' };
    });

    this.rpc.handle('DataTransfer', (p) => {
      this.emit('dataTransfer', p as DataTransferReq);
      return { status: 'Accepted' } satisfies DataTransferConf;
    });

    this.rpc.handle('ReserveNow', (p) => {
      this.emit('reserveNow', p as ReserveNowReq);
      return { status: 'Accepted' };
    });

    this.rpc.handle('CancelReservation', (p) => {
      this.emit('cancelReservation', p as CancelReservationReq);
      return { status: 'Accepted' };
    });

    this.rpc.handle('GetDiagnostics', (p) => {
      const req = p as GetDiagnosticsReq;
      this.emit('getDiagnostics', req);
      // Asynchronously report upload progress to the CSMS.
      setTimeout(() => {
        void this.diagnosticsStatusNotification('Uploading').catch(() => undefined);
        setTimeout(
          () => void this.diagnosticsStatusNotification('Uploaded').catch(() => undefined),
          1000,
        );
      }, 200);
      return { fileName: `diagnostics-${Date.now()}.txt` };
    });

    this.rpc.handle('UpdateFirmware', (p) => {
      this.emit('updateFirmware', p as UpdateFirmwareReq);
      setTimeout(() => {
        void this.firmwareStatusNotification('Downloading').catch(() => undefined);
        setTimeout(
          () => void this.firmwareStatusNotification('Installed').catch(() => undefined),
          1000,
        );
      }, 200);
      return {};
    });

    this.rpc.handle('GetLocalListVersion', () => ({
      listVersion: this.localListVersion,
    }));

    this.rpc.handle('SendLocalList', (p) => {
      const req = p as SendLocalListReq;
      this.localListVersion = req.listVersion;
      this.emit('sendLocalList', req);
      return { status: 'Accepted' };
    });

    this.rpc.handle('GetCompositeSchedule', (p) => {
      const req = p as GetCompositeScheduleReq;
      this.emit('getCompositeSchedule', req);
      return { status: 'Rejected' };
    });
  }
}
