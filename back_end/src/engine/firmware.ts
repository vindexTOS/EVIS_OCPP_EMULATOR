import type { DiagnosticsStatus, FirmwareStatus } from '../entities/enums';
import type {
  GetDiagnosticsReq,
  GetLogReq,
  SignedUpdateFirmwareReq,
  UpdateFirmwareReq,
} from './ocpp16/messages';
import type { After, VirtualChargePoint } from './virtual-charge-point';

interface FirmwareJob {
  location: string;
  retries: number;
  retryInterval: number;
  attempt: number;
  /** SignedUpdateFirmware (security extension) instead of UpdateFirmware. */
  signed: boolean;
  requestId: number | null;
}

/**
 * Firmware Management profile: UpdateFirmware and GetDiagnostics, and their
 * security-extension siblings SignedUpdateFirmware and GetLog.
 *
 * Nothing is really downloaded or uploaded. What the CSMS sees is the same
 * sequence of status notifications a real charger sends, including the reboot
 * into the new firmware version, and the failures a tester can switch on.
 */
export class FirmwareManager {
  private job: FirmwareJob | null = null;
  /** What the last signed update reported, for ExtendedTriggerMessage. */
  private signedStatus = 'Idle';
  private logStatus = 'Idle';
  private logRequestId: number | null = null;

  constructor(private readonly v: VirtualChargePoint) {}

  /** Power loss or reset: whatever was in progress is gone. */
  abort() {
    this.v.clearTimer('firmware');
    this.v.clearTimer('diagnostics');
    this.v.clearTimer('log-upload');
    if (this.job) {
      this.job = null;
      this.v.cp.firmwareStatus = 'Idle';
    }
    if (this.v.maintenance) this.v.maintenance = false;
    this.v.cp.diagnosticsStatus = 'Idle';
    this.logStatus = 'Idle';
  }

  // ---------------------------------------------------------------- firmware

  updateFirmware(req: UpdateFirmwareReq, after: After) {
    this.schedule(
      {
        location: req.location,
        retries: req.retries ?? 0,
        retryInterval: req.retryInterval ?? 30,
        attempt: 0,
        signed: false,
        requestId: null,
      },
      Date.parse(req.retrieveDate),
      after,
    );
    return {};
  }

  signedUpdateFirmware(req: SignedUpdateFirmwareReq, after: After) {
    const firmware = req.firmware;
    if (!/BEGIN CERTIFICATE/.test(firmware.signingCertificate ?? '')) {
      this.v.event(
        'Firmware',
        'SignedUpdateFirmware rejected: the signing certificate is not valid',
        'error',
      );
      this.v.securityEvent('InvalidFirmwareSigningCertificate');
      return { status: 'InvalidCertificate' };
    }
    const replacing = !!this.job;
    this.schedule(
      {
        location: firmware.location,
        retries: req.retries ?? 0,
        retryInterval: req.retryInterval ?? 30,
        attempt: 0,
        signed: true,
        requestId: req.requestId,
      },
      Date.parse(firmware.retrieveDateTime),
      after,
    );
    return { status: replacing ? 'AcceptedCanceled' : 'Accepted' };
  }

  private schedule(job: FirmwareJob, retrieveAt: number, after: After) {
    const v = this.v;
    this.job = job;
    const wait = Math.max(
      0,
      (Number.isNaN(retrieveAt) ? v.now() : retrieveAt) - v.now(),
    );
    v.event(
      'Firmware',
      `Firmware update requested from ${job.location}${wait > 1000 ? `, starting in ${Math.round(wait / 1000)} s` : ''}`,
    );
    after(() => {
      if (job.signed && wait > 1000) this.set('DownloadScheduled');
      v.setTimer('firmware', wait, () => this.download());
    });
  }

  private download() {
    if (!this.job) return;
    this.set('Downloading');
    this.v.setTimer('firmware', this.v.host.options.firmwareDownloadMs, () =>
      this.downloaded(),
    );
  }

  private downloaded() {
    const v = this.v;
    const job = this.job;
    if (!job) return;
    if (v.cp.firmwareFailure === 'download') {
      this.set('DownloadFailed');
      if (job.attempt < job.retries) {
        job.attempt += 1;
        v.setTimer('firmware', job.retryInterval * 1000, () => this.download());
      } else {
        this.finish();
      }
      return;
    }
    this.set('Downloaded');
    if (job.signed) this.set('SignatureVerified');
    this.installWhenIdle();
  }

  private installWhenIdle() {
    const v = this.v;
    if (!this.job) return;
    if (v.connectors.some((c) => c.session)) {
      // A charger does not pull the rug from under a running transaction.
      v.setTimer('firmware', 2000, () => this.installWhenIdle());
      return;
    }
    v.maintenance = true;
    for (const c of v.connectors) {
      c.pending = null;
      v.refreshStatus(c);
    }
    v.sendStatusZero();
    this.set('Installing');
    v.setTimer('firmware', v.host.options.firmwareInstallMs, () =>
      this.installed(),
    );
  }

  private installed() {
    const v = this.v;
    const job = this.job;
    if (!job) return;
    if (v.cp.firmwareFailure === 'install') {
      this.set('InstallationFailed');
      v.maintenance = false;
      for (const c of v.connectors) v.refreshStatus(c);
      v.sendStatusZero();
      this.finish();
      return;
    }
    const version = this.nextVersion(job.location);
    v.cp.firmwareVersion = version;
    v.cp.firmwareInstalledPending = true;
    v.markCpDirty();
    if (job.signed) this.set('InstallRebooting');
    v.event('Firmware', `Firmware ${version} installed; restarting`, 'success');
    v.maintenance = false;
    v.restart();
  }

  /** After the reboot into the new firmware: tell the CSMS it worked. */
  afterBoot() {
    const v = this.v;
    if (!v.cp.firmwareInstalledPending) return;
    v.cp.firmwareInstalledPending = false;
    v.markCpDirty();
    this.set('Installed');
    v.securityEvent('FirmwareUpdated', v.cp.firmwareVersion);
    this.finish();
  }

  private finish() {
    this.job = null;
    // The last status has been reported; from here on the charger is idle again.
    this.v.cp.firmwareStatus = 'Idle';
    this.v.markCpDirty();
  }

  /** "fw-2.4.1.bin" → 2.4.1; otherwise the current version with its last number raised. */
  private nextVersion(location: string): string {
    const file = location.split(/[/?#]/).filter(Boolean).pop() ?? '';
    const found = /(\d+\.\d+(?:\.\d+)*)/.exec(file);
    const current = this.v.cp.firmwareVersion || '1.0.0';
    if (found && found[1] !== current) return found[1];
    const parts = current.split('.');
    const last = Number(parts[parts.length - 1]);
    if (Number.isInteger(last)) {
      parts[parts.length - 1] = String(last + 1);
      return parts.join('.');
    }
    return `${current}.1`;
  }

  private set(status: string) {
    const v = this.v;
    const job = this.job;
    const signed = !!job?.signed;
    if (signed) {
      this.signedStatus = status;
    } else {
      v.cp.firmwareStatus = status as FirmwareStatus;
      v.markCpDirty();
    }
    const failed = /Failed|Invalid/.test(status);
    v.event(
      'Firmware',
      `Firmware: ${status}`,
      failed ? 'error' : status === 'Installed' ? 'success' : 'info',
    );
    v.markDirty();
    if (!v.registered) return;
    if (signed) {
      v.request('SignedFirmwareStatusNotification', {
        status,
        ...(job?.requestId != null ? { requestId: job.requestId } : {}),
      });
    } else {
      v.request('FirmwareStatusNotification', { status });
    }
  }

  /** TriggerMessage(FirmwareStatusNotification): what is going on right now. */
  reportFirmware(signed = false) {
    const v = this.v;
    if (!v.online) return;
    if (signed) {
      v.request('SignedFirmwareStatusNotification', {
        status: this.job?.signed ? this.signedStatus : 'Idle',
        ...(this.job?.requestId != null
          ? { requestId: this.job.requestId }
          : {}),
      });
      return;
    }
    const busy: FirmwareStatus[] = ['Downloading', 'Downloaded', 'Installing'];
    v.request('FirmwareStatusNotification', {
      status:
        this.job && !this.job.signed && busy.includes(v.cp.firmwareStatus)
          ? v.cp.firmwareStatus
          : 'Idle',
    });
  }

  // ------------------------------------------------------------- diagnostics

  getDiagnostics(req: GetDiagnosticsReq, after: After) {
    const v = this.v;
    const stamp = v.ts().replace(/[-:]/g, '').replace(/\..*/, '');
    const fileName = `diagnostics-${v.cp.chargePointId}-${stamp}.log`;
    v.event('Diagnostics', `Diagnostics upload requested to ${req.location}`);
    after(() => {
      this.setDiagnostics('Uploading');
      v.setTimer('diagnostics', v.host.options.uploadMs, () => {
        this.setDiagnostics(
          v.cp.diagnosticsFailure ? 'UploadFailed' : 'Uploaded',
        );
        v.cp.diagnosticsStatus = 'Idle';
        v.markCpDirty();
      });
    });
    return { fileName };
  }

  private setDiagnostics(status: DiagnosticsStatus) {
    const v = this.v;
    v.cp.diagnosticsStatus = status;
    v.markCpDirty();
    v.event(
      'Diagnostics',
      `Diagnostics: ${status}`,
      status === 'UploadFailed' ? 'error' : 'info',
    );
    if (v.registered) v.request('DiagnosticsStatusNotification', { status });
  }

  reportDiagnostics() {
    const v = this.v;
    if (!v.online) return;
    v.request('DiagnosticsStatusNotification', {
      status: v.cp.diagnosticsStatus === 'Uploading' ? 'Uploading' : 'Idle',
    });
  }

  // ------------------------------------------------- security extension log

  getLog(req: GetLogReq, after: After) {
    const v = this.v;
    const replacing = this.logStatus === 'Uploading';
    const stamp = v.ts().replace(/[-:]/g, '').replace(/\..*/, '');
    const filename = `${req.logType === 'SecurityLog' ? 'security' : 'diagnostics'}-${v.cp.chargePointId}-${stamp}.log`;
    this.logRequestId = req.requestId;
    v.event(
      'Diagnostics',
      `${req.logType} upload requested to ${req.log.remoteLocation}`,
    );
    after(() => {
      this.setLog('Uploading');
      v.setTimer('log-upload', v.host.options.uploadMs, () => {
        this.setLog(v.cp.diagnosticsFailure ? 'UploadFailure' : 'Uploaded');
        this.logStatus = 'Idle';
      });
    });
    return { status: replacing ? 'AcceptedCanceled' : 'Accepted', filename };
  }

  private setLog(status: string) {
    const v = this.v;
    this.logStatus = status;
    v.event(
      'Diagnostics',
      `Log upload: ${status}`,
      status === 'UploadFailure' ? 'error' : 'info',
    );
    if (v.registered) {
      v.request('LogStatusNotification', {
        status,
        ...(this.logRequestId != null ? { requestId: this.logRequestId } : {}),
      });
    }
  }

  reportLog() {
    const v = this.v;
    if (!v.online) return;
    const uploading = this.logStatus === 'Uploading';
    v.request('LogStatusNotification', {
      status: uploading ? 'Uploading' : 'Idle',
      ...(uploading && this.logRequestId != null
        ? { requestId: this.logRequestId }
        : {}),
    });
  }
}
