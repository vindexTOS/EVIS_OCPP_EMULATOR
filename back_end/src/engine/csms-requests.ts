import type { CertificateUse } from '../entities/certificate.entity';
import type { ChargingProfile } from '../entities/charging-profile.entity';
import type { AuthorizationStatus } from '../entities/enums';
import type {
  CancelReservationReq,
  CertificateSignedReq,
  ChangeAvailabilityReq,
  ChangeConfigurationReq,
  ChargingProfileReq,
  ClearChargingProfileReq,
  DataTransferReq,
  DeleteCertificateReq,
  GetCompositeScheduleReq,
  GetConfigurationReq,
  GetDiagnosticsReq,
  GetInstalledCertificateIdsReq,
  GetLogReq,
  InstallCertificateReq,
  RemoteStartTransactionReq,
  RemoteStopTransactionReq,
  ReserveNowReq,
  ResetReq,
  SendLocalListReq,
  SetChargingProfileReq,
  SignedUpdateFirmwareReq,
  StatusConf,
  TriggerMessageReq,
  UnlockConnectorReq,
  UpdateFirmwareReq,
} from './ocpp16/messages';
import { breakpoints } from './ocpp16/smart-charging';
import { EXTENDED_TRIGGERS, MESSAGE_TRIGGERS } from './ocpp16/validators';
import {
  certificateMatchesKey,
  describeCertificate,
  generateCsr,
  isCertificate,
  splitPemChain,
} from './ocpp16/x509';
import { OcppError } from './rpc/ocpp-message';
import { AC_VOLTAGE, wattsToLimit } from './sim/physics';
import type {
  After,
  ConnectorRt,
  RequestHandler,
  StartAuth,
  VirtualChargePoint,
} from './virtual-charge-point';

const AUTH_STATUSES: AuthorizationStatus[] = [
  'Accepted',
  'Blocked',
  'Expired',
  'Invalid',
  'ConcurrentTx',
];
const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
};

/**
 * Everything a CSMS can ask of an OCPP 1.6 charge point: the Core, Firmware
 * Management, Local Auth List, Reservation, Smart Charging and Remote Trigger
 * profiles, plus the requests of the 1.6 security extension.
 *
 * A handler returns the answer. Anything the request sets in motion (status
 * changes, new transactions, reboots) goes into `after`, which runs once the
 * answer is on the wire, the way a real charger orders its messages.
 */
export class CsmsRequests {
  readonly handlers = new Map<string, RequestHandler>();
  /** Private key of the certificate request that is waiting for CertificateSigned. */
  private pendingKey: string | null = null;

  constructor(private readonly v: VirtualChargePoint) {
    // The payload type is what the request's schema guarantees (see validators.ts).
    const on = <T>(
      action: string,
      handler: (req: T, after: After) => unknown,
    ) => this.handlers.set(action, handler as unknown as RequestHandler);

    // Core
    on<RemoteStartTransactionReq>('RemoteStartTransaction', (req, after) =>
      this.remoteStart(req, after),
    );
    on<RemoteStopTransactionReq>('RemoteStopTransaction', (req, after) =>
      this.remoteStop(req, after),
    );
    on<ResetReq>('Reset', (req, after) => this.reset(req, after));
    on<UnlockConnectorReq>('UnlockConnector', (req) => this.unlock(req));
    on<ChangeAvailabilityReq>('ChangeAvailability', (req, after) =>
      this.changeAvailability(req, after),
    );
    on<ChangeConfigurationReq>('ChangeConfiguration', (req, after) =>
      this.changeConfiguration(req, after),
    );
    on<GetConfigurationReq>('GetConfiguration', (req) =>
      this.getConfiguration(req),
    );
    on('ClearCache', () => this.clearCache());
    on<DataTransferReq>('DataTransfer', (req) => this.dataTransfer(req));
    // Firmware management
    on<GetDiagnosticsReq>('GetDiagnostics', (req, after) =>
      this.v.firmware.getDiagnostics(req, after),
    );
    on<UpdateFirmwareReq>('UpdateFirmware', (req, after) =>
      this.v.firmware.updateFirmware(req, after),
    );
    // Local auth list
    on('GetLocalListVersion', () => this.getLocalListVersion());
    on<SendLocalListReq>('SendLocalList', (req) => this.sendLocalList(req));
    // Reservation
    on<ReserveNowReq>('ReserveNow', (req, after) =>
      this.reserveNow(req, after),
    );
    on<CancelReservationReq>('CancelReservation', (req, after) =>
      this.cancelReservation(req, after),
    );
    // Smart charging
    on<SetChargingProfileReq>('SetChargingProfile', (req) =>
      this.setChargingProfile(req),
    );
    on<ClearChargingProfileReq>('ClearChargingProfile', (req) =>
      this.clearChargingProfile(req),
    );
    on<GetCompositeScheduleReq>('GetCompositeSchedule', (req) =>
      this.getCompositeSchedule(req),
    );
    // Remote trigger
    on<TriggerMessageReq>('TriggerMessage', (req, after) =>
      this.triggerMessage(req, after, MESSAGE_TRIGGERS),
    );
    // Security extension
    on<TriggerMessageReq>('ExtendedTriggerMessage', (req, after) =>
      this.triggerMessage(req, after, EXTENDED_TRIGGERS),
    );
    on<CertificateSignedReq>('CertificateSigned', (req) =>
      this.certificateSigned(req),
    );
    on<InstallCertificateReq>('InstallCertificate', (req) =>
      this.installCertificate(req),
    );
    on<GetInstalledCertificateIdsReq>('GetInstalledCertificateIds', (req) =>
      this.getInstalledCertificateIds(req),
    );
    on<DeleteCertificateReq>('DeleteCertificate', (req) =>
      this.deleteCertificate(req),
    );
    on<GetLogReq>('GetLog', (req, after) => this.v.firmware.getLog(req, after));
    on<SignedUpdateFirmwareReq>('SignedUpdateFirmware', (req, after) =>
      this.v.firmware.signedUpdateFirmware(req, after),
    );
  }

  // ------------------------------------------------------------------ Core

  private remoteStart(req: RemoteStartTransactionReq, after: After) {
    const v = this.v;
    const idTag: string = req.idTag;
    const c: ConnectorRt | undefined =
      req.connectorId != null
        ? v.connector(req.connectorId)
        : (v.connectors.find((x) => x.entity.carId != null && v.canStart(x)) ??
          v.connectors.find((x) => v.canStart(x)));
    const reject = (why: string) => {
      v.event(
        'RemoteStart',
        `RemoteStartTransaction for ${idTag} rejected: ${why}`,
        'warning',
        c,
      );
      return { status: 'Rejected' };
    };

    if (v.state !== 'Accepted')
      return reject('the charger has not been accepted by the CSMS');
    if (!c) {
      return reject(
        req.connectorId != null
          ? `connector ${req.connectorId} does not exist`
          : 'no connector is free',
      );
    }
    if (!v.canStart(c))
      return reject('the connector is busy or out of service');
    const authorizeFirst = v.config.bool('AuthorizeRemoteTxRequests');
    // Without an Authorize round trip the parent idTag is unknown, so only the
    // reserved idTag itself gets through a reservation.
    if (!authorizeFirst && v.reservationCheck(c, idTag, null).blocked) {
      return reject('the connector is reserved for another idTag');
    }
    if (req.chargingProfile) {
      const problem = this.profileProblem(
        c.entity.connectorId,
        req.chargingProfile,
        true,
      );
      if (problem) return reject(problem);
    }

    v.event(
      'RemoteStart',
      `RemoteStartTransaction accepted for ${idTag}`,
      'info',
      c,
    );
    after(() =>
      this.beginRemoteStart(
        c,
        idTag,
        req.chargingProfile ?? null,
        authorizeFirst,
      ),
    );
    return { status: 'Accepted' };
  }

  private async beginRemoteStart(
    c: ConnectorRt,
    idTag: string,
    profile: ChargingProfileReq | null,
    authorizeFirst: boolean,
  ) {
    const v = this.v;
    const proceed = async (parentIdTag: string | null) => {
      if (!v.canStart(c)) return;
      const check = v.reservationCheck(c, idTag, parentIdTag);
      if (check.blocked) {
        v.event(
          'RemoteStart',
          'Remote start abandoned: the connector is reserved for another idTag',
          'warning',
          c,
        );
        return;
      }
      const auth: StartAuth = {
        idTag,
        parentIdTag,
        startedBy: 'Remote',
        reservation: check.reservation,
        profile,
      };
      if (c.entity.carId != null) {
        await v.startSession(c, auth);
        return;
      }
      const timeout = v.config.int('ConnectionTimeOut');
      c.pending = { ...auth, until: v.now() + timeout * 1000 };
      v.refreshStatus(c);
      v.event(
        'Authorized',
        `Remote start: waiting ${timeout} s for the cable`,
        'info',
        c,
      );
    };

    if (!authorizeFirst) {
      await proceed(null);
      return;
    }
    c.authorizing = idTag;
    v.markDirty();
    v.authorize(idTag, async (decision) => {
      c.authorizing = null;
      v.markDirty();
      if (decision.status !== 'Accepted') {
        v.event(
          'RemoteStart',
          `Remote start abandoned: authorization of ${idTag} came back ${decision.status}`,
          'warning',
          c,
        );
        return;
      }
      await proceed(decision.parentIdTag);
    });
  }

  private remoteStop(req: RemoteStopTransactionReq, after: After) {
    const v = this.v;
    const c = v.connectors.find(
      (x) => x.session && x.session.transactionId === req.transactionId,
    );
    if (!c) {
      v.event(
        'RemoteStop',
        `RemoteStopTransaction rejected: no running transaction has id ${req.transactionId}`,
        'warning',
      );
      return { status: 'Rejected' };
    }
    v.event(
      'RemoteStop',
      `RemoteStopTransaction accepted for transaction ${req.transactionId}`,
      'info',
      c,
    );
    after(() => v.stopSession(c, 'Remote'));
    return { status: 'Accepted' };
  }

  private reset(req: ResetReq, after: After) {
    const v = this.v;
    const hard = req.type === 'Hard';
    v.event('Reset', `${req.type} reset requested by the CSMS`, 'warning');
    after(async () => {
      v.securityEvent('ResetOrReboot', `${req.type} reset`);
      if (hard) await v.hardRestart('HardReset');
      else await v.softRestart('SoftReset');
    });
    return { status: 'Accepted' };
  }

  private async unlock(req: UnlockConnectorReq) {
    const v = this.v;
    const c = v.connector(req.connectorId);
    if (!c) return { status: 'NotSupported' };
    if (v.cp.unlockFailure) {
      v.event(
        'Unlock',
        'UnlockConnector failed: the lock did not release',
        'error',
        c,
      );
      return { status: 'UnlockFailed' };
    }
    // A running transaction is finished first; only then does the lock open.
    if (c.session) await v.stopSession(c, 'UnlockCommand');
    c.entity.locked = false;
    c.dirty = true;
    v.markDirty();
    v.event('Unlock', 'Connector unlocked by the CSMS', 'info', c);
    return { status: 'Unlocked' };
  }

  private changeAvailability(req: ChangeAvailabilityReq, after: After) {
    const v = this.v;
    const { connectorId, type } = req;
    const targets =
      connectorId === 0 ? v.connectors : [v.connector(connectorId)];
    if (targets.some((c) => !c)) return { status: 'Rejected' };
    const scheduled = type === 'Inoperative' && targets.some((c) => c!.session);
    after(() => {
      v.applyAvailability(connectorId, type);
      v.event(
        'Availability',
        `${connectorId === 0 ? 'Charge point' : `Connector ${connectorId}`} set ${type} by the CSMS${scheduled ? ' (after the running transaction)' : ''}`,
        'info',
        connectorId === 0 ? null : v.connector(connectorId),
      );
    });
    return { status: scheduled ? 'Scheduled' : 'Accepted' };
  }

  private changeConfiguration(req: ChangeConfigurationReq, after: After) {
    const v = this.v;
    const key: string = req.key;
    const status = v.config.change(key, String(req.value));
    const reason = v.pendingReconnect;
    v.pendingReconnect = null;
    const secret = key.toLowerCase() === 'authorizationkey';
    v.event(
      'Config',
      `ChangeConfiguration ${key} = "${secret ? '***' : req.value}": ${status}`,
      status === 'Accepted' || status === 'RebootRequired' ? 'info' : 'warning',
    );
    if (status === 'Accepted' && reason) {
      after(() => {
        v.securityEvent('ReconfigurationOfSecurityParameters', key);
        v.reconnect(reason);
      });
    }
    return { status };
  }

  private getConfiguration(req: GetConfigurationReq) {
    const v = this.v;
    const keys: string[] | undefined = Array.isArray(req.key)
      ? req.key.map(String)
      : undefined;
    const max = v.config.int('GetConfigurationMaxKeys');
    if (keys && keys.length > max) {
      throw new OcppError(
        'PropertyConstraintViolation',
        `At most ${max} keys can be requested at once`,
      );
    }
    const { configurationKey, unknownKey } = v.config.list(keys);
    return {
      ...(configurationKey.length ? { configurationKey } : {}),
      ...(unknownKey.length ? { unknownKey } : {}),
    };
  }

  private async clearCache() {
    const v = this.v;
    v.authCache.clear();
    await v.host.db.auth.delete({ chargePointId: v.cp.id, source: 'cache' });
    v.event('Auth', 'Authorization cache cleared by the CSMS');
    return { status: 'Accepted' };
  }

  private dataTransfer(req: DataTransferReq) {
    const v = this.v;
    const mode = v.cp.dataTransferMode;
    const status =
      mode === 'vendor'
        ? req.vendorId === v.cp.vendor
          ? 'Accepted'
          : 'UnknownVendorId'
        : mode;
    v.event(
      'DataTransfer',
      `DataTransfer from the CSMS (vendor ${req.vendorId}${req.messageId ? `, message ${req.messageId}` : ''}): ${status}`,
      'info',
      null,
      req,
    );
    return { status };
  }

  // -------------------------------------------------------- Local auth list

  private getLocalListVersion() {
    const v = this.v;
    if (!v.config.bool('LocalAuthListEnabled')) return { listVersion: -1 };
    return { listVersion: v.authList.size === 0 ? 0 : v.cp.localListVersion };
  }

  private async sendLocalList(req: SendLocalListReq) {
    const v = this.v;
    const { db } = v.host;
    if (!v.config.bool('LocalAuthListEnabled'))
      return { status: 'NotSupported' };
    const entries = req.localAuthorizationList ?? [];
    if (entries.length > v.config.int('SendLocalListMaxLength'))
      return { status: 'Failed' };
    const full = req.updateType === 'Full';

    // Entries arrive unchecked: keep only what is well-formed, fail on anything else.
    const list: {
      idTag: string;
      info: {
        status: AuthorizationStatus;
        parentIdTag?: string;
        expiryDate?: string;
      } | null;
    }[] = [];
    for (const entry of entries) {
      const idTag = entry?.idTag;
      if (
        typeof idTag !== 'string' ||
        idTag.length === 0 ||
        idTag.length > 20
      ) {
        return { status: 'Failed' };
      }
      const raw = entry.idTagInfo;
      if (raw == null) {
        // A full list must say what each idTag is allowed to do.
        if (full) return { status: 'Failed' };
        list.push({ idTag, info: null });
        continue;
      }
      const status = AUTH_STATUSES.find((s) => s === raw.status);
      if (!status) return { status: 'Failed' };
      list.push({
        idTag,
        info: {
          status,
          parentIdTag: raw.parentIdTag,
          expiryDate: raw.expiryDate,
        },
      });
    }
    if (!full && req.listVersion <= v.cp.localListVersion)
      return { status: 'VersionMismatch' };

    const known = new Set(full ? [] : v.authList.keys());
    for (const entry of list) {
      if (entry.info) known.add(entry.idTag);
      else known.delete(entry.idTag);
    }
    if (known.size > v.config.int('LocalAuthListMaxLength'))
      return { status: 'Failed' };

    if (full) {
      await db.auth.delete({ chargePointId: v.cp.id, source: 'list' });
      v.authList.clear();
    }
    for (const { idTag, info } of list) {
      const existing = v.authList.get(idTag);
      if (!info) {
        // Differential update without idTagInfo: remove the idTag.
        if (existing) {
          await db.auth.delete(existing.id);
          v.authList.delete(idTag);
        }
        continue;
      }
      const row =
        existing ??
        db.auth.create({ chargePointId: v.cp.id, source: 'list', idTag });
      row.status = info.status;
      row.parentIdTag = info.parentIdTag ?? null;
      row.expiryDate = parseDate(info.expiryDate);
      v.authList.set(idTag, await db.auth.save(row));
      // The list is the authority for its tags: forget what the cache thought.
      const cached = v.authCache.get(idTag);
      if (cached) {
        await db.auth.delete(cached.id);
        v.authCache.delete(idTag);
      }
    }
    v.cp.localListVersion = req.listVersion;
    v.markCpDirty();
    v.event(
      'Auth',
      `Local authorization list updated to version ${req.listVersion} (${req.updateType}, ${v.authList.size} idTags)`,
    );
    return { status: 'Accepted' };
  }

  // ------------------------------------------------------------ Reservation

  private async reserveNow(req: ReserveNowReq, after: After) {
    const v = this.v;
    const { db } = v.host;
    const connectorId: number = req.connectorId;
    const expiry = parseDate(req.expiryDate)!;
    const answer = (status: string, why?: string) => {
      v.event(
        'Reservation',
        `ReserveNow ${req.reservationId} for ${req.idTag} on connector ${connectorId}: ${status}${why ? ` (${why})` : ''}`,
        status === 'Accepted' ? 'info' : 'warning',
        v.connector(connectorId),
      );
      return { status };
    };

    if (connectorId > v.connectors.length)
      return answer('Rejected', 'no such connector');
    if (connectorId === 0 && !v.config.bool('ReserveConnectorZeroSupported')) {
      return answer(
        'Rejected',
        'reservations on connector 0 are not supported',
      );
    }
    if (expiry.getTime() <= v.now())
      return answer('Rejected', 'the expiry date has passed');

    const others = v.reservations.filter(
      (r) => r.reservationId !== req.reservationId,
    );
    if (connectorId > 0) {
      const c = v.connector(connectorId)!;
      if (c.entity.errorCode !== 'NoError') return answer('Faulted');
      if (c.entity.availability !== 'Operative' || v.maintenance)
        return answer('Unavailable');
      if (c.session || c.pending || c.entity.carId != null)
        return answer('Occupied');
      if (others.some((r) => r.connectorId === connectorId))
        return answer('Occupied', 'already reserved');
    } else {
      const usable = v.connectors.filter(
        (c) =>
          c.entity.errorCode === 'NoError' &&
          c.entity.availability === 'Operative',
      );
      if (
        v.connectors.length > 0 &&
        v.connectors.every((c) => c.entity.errorCode !== 'NoError')
      ) {
        return answer('Faulted');
      }
      if (usable.length === 0 || v.maintenance) return answer('Unavailable');
      const free = usable.filter(
        (c) =>
          !c.session &&
          !c.pending &&
          c.entity.carId == null &&
          !others.some((r) => r.connectorId === c.entity.connectorId),
      );
      const floating = others.filter((r) => r.connectorId === 0).length;
      if (free.length <= floating) return answer('Occupied');
    }

    // The same reservationId again replaces the earlier reservation.
    const previous = v.reservations.find(
      (r) => r.reservationId === req.reservationId,
    );
    if (previous) {
      await db.reservations.update(previous.id, { state: 'Cancelled' });
      v.reservations = v.reservations.filter((r) => r !== previous);
    }
    const reservation = await db.reservations.save(
      db.reservations.create({
        chargePointId: v.cp.id,
        connectorId,
        reservationId: req.reservationId,
        idTag: req.idTag,
        parentIdTag: req.parentIdTag ?? null,
        expiryDate: expiry,
        state: 'Active',
      }),
    );
    v.reservations.push(reservation);
    v.markDirty();
    after(() => {
      for (const c of v.connectors) v.refreshStatus(c);
    });
    return answer('Accepted');
  }

  private async cancelReservation(req: CancelReservationReq, after: After) {
    const v = this.v;
    const reservation = v.reservations.find(
      (r) => r.reservationId === req.reservationId && r.state === 'Active',
    );
    if (!reservation) {
      v.event(
        'Reservation',
        `CancelReservation ${req.reservationId}: no such reservation`,
        'warning',
      );
      return { status: 'Rejected' };
    }
    reservation.state = 'Cancelled';
    await v.host.db.reservations.update(reservation.id, { state: 'Cancelled' });
    v.reservations = v.reservations.filter((r) => r !== reservation);
    v.markDirty();
    v.event(
      'Reservation',
      `Reservation ${req.reservationId} cancelled by the CSMS`,
    );
    after(() => {
      for (const c of v.connectors) v.refreshStatus(c);
    });
    return { status: 'Accepted' };
  }

  // --------------------------------------------------------- Smart charging

  /** Why a profile cannot be installed on a connector, or null when it can. */
  private profileProblem(
    connectorId: number,
    p: ChargingProfileReq,
    forRemoteStart: boolean,
  ): string | null {
    const v = this.v;
    const purpose = p.chargingProfilePurpose;
    if (connectorId < 0 || connectorId > v.connectors.length)
      return `connector ${connectorId} does not exist`;
    if (forRemoteStart && purpose !== 'TxProfile')
      return 'a remote start only takes a TxProfile';
    if (purpose === 'ChargePointMaxProfile' && connectorId !== 0) {
      return 'a ChargePointMaxProfile belongs on connector 0';
    }
    if (purpose === 'TxProfile' && connectorId === 0)
      return 'a TxProfile needs a connector';
    if (p.stackLevel > v.config.int('ChargeProfileMaxStackLevel'))
      return 'the stack level is too high';
    if (p.chargingProfileKind === 'Recurring' && !p.recurrencyKind) {
      return 'a Recurring profile needs a recurrencyKind';
    }
    const schedule = p.chargingSchedule;
    const unit = schedule.chargingRateUnit === 'A' ? 'Current' : 'Power';
    if (
      !v.config.csl('ChargingScheduleAllowedChargingRateUnit').includes(unit)
    ) {
      return `charging rate unit ${schedule.chargingRateUnit} is not supported`;
    }
    // The schema only says "an array": what is in it is checked here.
    const raw: unknown = schedule.chargingSchedulePeriod;
    if (!Array.isArray(raw) || raw.length === 0)
      return 'the schedule has no periods';
    const periods = raw as { startPeriod?: unknown; limit?: unknown }[];
    if (periods.length > v.config.int('ChargingScheduleMaxPeriods'))
      return 'the schedule has too many periods';
    let previous = -1;
    for (const period of periods) {
      const start = period?.startPeriod;
      const limit = period?.limit;
      if (
        typeof start !== 'number' ||
        !Number.isInteger(start) ||
        start < 0 ||
        typeof limit !== 'number' ||
        limit < 0
      ) {
        return 'a schedule period is malformed';
      }
      if (start <= previous)
        return 'schedule periods must be in ascending order';
      if (previous === -1 && start !== 0)
        return 'the first schedule period must start at 0';
      previous = start;
    }
    const replaces = v.profiles.some((x) => this.sameSlot(x, connectorId, p));
    if (
      !replaces &&
      v.profiles.length >= v.config.int('MaxChargingProfilesInstalled')
    ) {
      return 'the charger holds the maximum number of profiles';
    }
    return null;
  }

  private sameSlot(
    existing: ChargingProfile,
    connectorId: number,
    p: ChargingProfileReq,
  ): boolean {
    return (
      existing.chargingProfileId === p.chargingProfileId ||
      (existing.connectorId === connectorId &&
        existing.stackLevel === p.stackLevel &&
        existing.purpose === p.chargingProfilePurpose)
    );
  }

  /** Store a profile, replacing the one with the same id or the same stack level and purpose. */
  async installProfile(
    connectorId: number,
    p: ChargingProfileReq,
    sessionId: number | null,
  ) {
    const v = this.v;
    const { db } = v.host;
    const replaced = v.profiles.filter((x) => this.sameSlot(x, connectorId, p));
    for (const old of replaced) await db.profiles.delete(old.id);
    v.profiles = v.profiles.filter((x) => !replaced.includes(x));
    const row = await db.profiles.save(
      db.profiles.create({
        chargePointId: v.cp.id,
        connectorId,
        chargingProfileId: p.chargingProfileId,
        transactionId: p.transactionId ?? null,
        sessionId,
        stackLevel: p.stackLevel,
        purpose: p.chargingProfilePurpose,
        kind: p.chargingProfileKind,
        recurrencyKind: p.recurrencyKind ?? null,
        validFrom: parseDate(p.validFrom),
        validTo: parseDate(p.validTo),
        schedule: p.chargingSchedule,
        installedAt: new Date(v.now()),
      }),
    );
    v.profiles.push(row);
    v.markDirty();
    v.event(
      'SmartCharging',
      `${p.chargingProfilePurpose} #${p.chargingProfileId} installed on connector ${connectorId} (stack level ${p.stackLevel})`,
      'info',
      v.connector(connectorId),
    );
  }

  private async setChargingProfile(req: SetChargingProfileReq) {
    const v = this.v;
    const connectorId: number = req.connectorId;
    const p = req.csChargingProfiles;
    const reject = (why: string) => {
      v.event(
        'SmartCharging',
        `SetChargingProfile #${p.chargingProfileId} rejected: ${why}`,
        'warning',
      );
      return { status: 'Rejected' };
    };
    const problem = this.profileProblem(connectorId, p, false);
    if (problem) return reject(problem);

    let sessionId: number | null = null;
    if (p.chargingProfilePurpose === 'TxProfile') {
      const c = v.connector(connectorId);
      if (!c?.session)
        return reject(
          'a TxProfile needs a running transaction on the connector',
        );
      if (
        p.transactionId != null &&
        c.session.transactionId !== p.transactionId
      ) {
        return reject(
          `transaction ${p.transactionId} is not running on the connector`,
        );
      }
      sessionId = c.session.id;
    }
    await this.installProfile(connectorId, p, sessionId);
    return { status: 'Accepted' };
  }

  private async clearChargingProfile(req: ClearChargingProfileReq) {
    const v = this.v;
    const matches = (x: ChargingProfile) => {
      if (req.id != null) return x.chargingProfileId === req.id;
      if (req.connectorId != null && x.connectorId !== req.connectorId)
        return false;
      if (
        req.chargingProfilePurpose != null &&
        x.purpose !== req.chargingProfilePurpose
      )
        return false;
      if (req.stackLevel != null && x.stackLevel !== req.stackLevel)
        return false;
      return true;
    };
    const removed = v.profiles.filter(matches);
    if (removed.length === 0) return { status: 'Unknown' };
    for (const profile of removed) await v.host.db.profiles.delete(profile.id);
    v.profiles = v.profiles.filter((x) => !removed.includes(x));
    v.markDirty();
    v.event(
      'SmartCharging',
      `${removed.length} charging profile(s) cleared by the CSMS`,
    );
    return { status: 'Accepted' };
  }

  private getCompositeSchedule(req: GetCompositeScheduleReq) {
    const v = this.v;
    const connectorId: number = req.connectorId;
    const c = connectorId === 0 ? null : v.connector(connectorId);
    if (connectorId !== 0 && !c) return { status: 'Rejected' };
    const unit: 'A' | 'W' = req.chargingRateUnit ?? 'W';
    const from = v.now();
    const to = from + req.duration * 1000;
    const car =
      c && c.entity.carId != null ? (v.host.car(c.entity.carId) ?? null) : null;
    // A TxDefaultProfile only binds during a transaction. The schedule shows what
    // would apply, so an idle connector is treated as if one started right now.
    const probe: ConnectorRt | null = c
      ? c.session
        ? c
        : {
            ...c,
            session: {
              id: -1,
              startedAt: new Date(from),
            } as ConnectorRt['session'],
          }
      : null;
    const sessionStart = probe?.session
      ? probe.session.startedAt.getTime()
      : null;

    const relevant = v.profiles.filter((p) => {
      if (p.purpose === 'ChargePointMaxProfile') return true;
      if (!c) return false;
      if (p.connectorId !== 0 && p.connectorId !== connectorId) return false;
      if (p.purpose === 'TxProfile')
        return (
          !!c.session && (p.sessionId === null || p.sessionId === c.session.id)
        );
      return true;
    });
    const instants = new Set<number>([from]);
    for (const p of relevant) {
      for (const t of breakpoints(p, from, to, sessionStart)) instants.add(t);
    }

    const stationMax = v.connectors.reduce(
      (sum, x) => sum + x.entity.maxPowerW,
      0,
    );
    const wattsAt = (t: number): number => {
      if (probe) {
        return Math.min(
          probe.entity.maxPowerW,
          v.limitFor(probe, t, car, false).watts ?? Infinity,
        );
      }
      return Math.min(stationMax, this.stationLimitAt(t) ?? Infinity);
    };
    const convert = (watts: number): number => {
      if (unit === 'W') return Math.round(watts);
      const amps = c
        ? wattsToLimit(
            watts,
            'A',
            {
              type: c.entity.type,
              maxPowerW: c.entity.maxPowerW,
              phases: c.entity.phases,
            },
            car,
          )
        : watts / (AC_VOLTAGE * 3);
      return Math.round(amps * 10) / 10;
    };

    const chargingSchedulePeriod: { startPeriod: number; limit: number }[] = [];
    for (const t of [...instants].sort((a, b) => a - b)) {
      const limit = convert(wattsAt(t + 1));
      const last = chargingSchedulePeriod[chargingSchedulePeriod.length - 1];
      if (last && last.limit === limit) continue;
      chargingSchedulePeriod.push({
        startPeriod: Math.round((t - from) / 1000),
        limit,
      });
    }
    return {
      status: 'Accepted',
      connectorId,
      scheduleStart: v.ts(from),
      chargingSchedule: {
        duration: req.duration,
        startSchedule: v.ts(from),
        chargingRateUnit: unit,
        chargingSchedulePeriod,
      },
    };
  }

  /** Limit of the charge point as a whole (ChargePointMaxProfile), in watts. */
  private stationLimitAt(t: number): number | null {
    const v = this.v;
    const probe = v.connectors[0];
    if (!probe) return null;
    // limitFor() with a connector that has no session only sees the station profile.
    const idle: ConnectorRt = { ...probe, session: null };
    return v.limitFor(idle, t, null, false).watts;
  }

  // --------------------------------------------------------- Remote trigger

  private triggerMessage(
    req: TriggerMessageReq,
    after: After,
    known: readonly string[],
  ) {
    const v = this.v;
    const message: string = req.requestedMessage;
    if (!known.includes(message)) return { status: 'NotImplemented' };
    const c =
      req.connectorId != null ? v.connector(req.connectorId) : undefined;
    if (req.connectorId != null && !c) return { status: 'Rejected' };
    v.event(
      'Trigger',
      `The CSMS asked for ${message}${c ? ` on connector ${req.connectorId}` : ''}`,
      'info',
      c,
    );
    after(() => this.fire(message, c, known === EXTENDED_TRIGGERS));
    return { status: 'Accepted' };
  }

  private async fire(
    message: string,
    c: ConnectorRt | undefined,
    extended: boolean,
  ) {
    const v = this.v;
    switch (message) {
      case 'BootNotification':
        v.sendBoot();
        break;
      case 'Heartbeat':
        v.sendHeartbeat();
        break;
      case 'StatusNotification':
        if (c) {
          v.sendStatus(c, true);
        } else {
          v.sendStatusZero(true);
          for (const x of v.connectors) v.sendStatus(x, true);
        }
        break;
      case 'MeterValues':
        for (const x of c ? [c] : v.connectors) {
          await v.reportMeter(x, 'Trigger', 'MeterValuesSampledData');
        }
        break;
      case 'DiagnosticsStatusNotification':
        v.firmware.reportDiagnostics();
        break;
      case 'FirmwareStatusNotification':
        v.firmware.reportFirmware(extended);
        break;
      case 'LogStatusNotification':
        v.firmware.reportLog();
        break;
      case 'SignChargePointCertificate':
        this.signCertificate();
        break;
    }
  }

  // ----------------------------------------------------- Security extension

  /** Ask the CSMS to sign a certificate for a fresh key pair. */
  signCertificate() {
    const v = this.v;
    const { csrPem, privateKeyPem } = generateCsr(
      v.cp.serialNumber || v.cp.chargePointId,
      v.config.get('CpoName') || v.cp.vendor,
    );
    this.pendingKey = privateKeyPem;
    v.event('Security', 'Certificate signing request sent to the CSMS');
    v.request<StatusConf>(
      'SignCertificate',
      { csr: csrPem },
      (conf) => {
        if (conf?.status !== 'Accepted') {
          v.event(
            'Security',
            `The CSMS answered SignCertificate with ${conf?.status}`,
            'warning',
          );
        }
      },
      (err) =>
        v.event(
          'Security',
          `SignCertificate failed: ${err.message}`,
          'warning',
        ),
    );
  }

  private async certificateSigned(req: CertificateSignedReq) {
    const v = this.v;
    const { db } = v.host;
    const chain = splitPemChain(req.certificateChain);
    const leaf = chain[0];
    if (
      !leaf ||
      !isCertificate(leaf) ||
      !this.pendingKey ||
      !certificateMatchesKey(leaf, this.pendingKey)
    ) {
      v.event(
        'Security',
        'CertificateSigned rejected: the certificate does not belong to a key this charger asked to have signed',
        'error',
      );
      v.securityEvent('InvalidChargePointCertificate');
      return { status: 'Rejected' };
    }
    const info = describeCertificate(leaf, chain[1]);
    await db.certificates.delete({
      chargePointId: v.cp.id,
      certificateType: 'ChargePointCertificate',
    });
    await db.certificates.save(
      db.certificates.create({
        chargePointId: v.cp.id,
        certificateType: 'ChargePointCertificate',
        pem: chain.join('\n'),
        subject: info.subject,
        issuerNameHash: info.issuerNameHash,
        issuerKeyHash: info.issuerKeyHash,
        serialNumber: info.serialNumber,
      }),
    );
    // Used as the TLS client certificate from the next connection on.
    v.cp.tlsClientCert = chain.join('\n');
    v.cp.tlsClientKey = this.pendingKey;
    this.pendingKey = null;
    v.markCpDirty();
    v.event(
      'Security',
      `Charge point certificate installed (${info.subject})`,
      'success',
    );
    return { status: 'Accepted' };
  }

  private async installCertificate(req: InstallCertificateReq) {
    const v = this.v;
    const { db } = v.host;
    const type: CertificateUse = req.certificateType;
    if (!isCertificate(req.certificate)) {
      v.event(
        'Security',
        `InstallCertificate rejected: not a valid ${type}`,
        'error',
      );
      v.securityEvent('InvalidCentralSystemCertificate');
      return { status: 'Rejected' };
    }
    const count = await db.certificates.count({
      where: { chargePointId: v.cp.id },
    });
    if (count >= v.config.int('CertificateStoreMaxLength'))
      return { status: 'Failed' };
    const info = describeCertificate(req.certificate);
    const same = await db.certificates.findOne({
      where: {
        chargePointId: v.cp.id,
        certificateType: type,
        serialNumber: info.serialNumber,
        issuerNameHash: info.issuerNameHash,
      },
    });
    if (!same) {
      await db.certificates.save(
        db.certificates.create({
          chargePointId: v.cp.id,
          certificateType: type,
          pem: req.certificate,
          subject: info.subject,
          issuerNameHash: info.issuerNameHash,
          issuerKeyHash: info.issuerKeyHash,
          serialNumber: info.serialNumber,
        }),
      );
      if (
        type === 'CentralSystemRootCertificate' &&
        !v.cp.tlsCaCert.includes(req.certificate.trim())
      ) {
        // The CSMS's server certificate is checked against this root from the next connection on.
        v.cp.tlsCaCert = [v.cp.tlsCaCert.trim(), req.certificate.trim()]
          .filter(Boolean)
          .join('\n');
        v.markCpDirty();
      }
    }
    v.event('Security', `${type} installed (${info.subject})`, 'success');
    return { status: 'Accepted' };
  }

  private async getInstalledCertificateIds(req: GetInstalledCertificateIdsReq) {
    const v = this.v;
    const rows = await v.host.db.certificates.find({
      where: { chargePointId: v.cp.id, certificateType: req.certificateType },
    });
    if (rows.length === 0) return { status: 'NotFound' };
    return {
      status: 'Accepted',
      certificateHashData: rows.map((row) => ({
        hashAlgorithm: 'SHA256',
        issuerNameHash: row.issuerNameHash,
        issuerKeyHash: row.issuerKeyHash,
        serialNumber: row.serialNumber,
      })),
    };
  }

  private async deleteCertificate(req: DeleteCertificateReq) {
    const v = this.v;
    const { db } = v.host;
    const wanted = req.certificateHashData;
    const lower = (s: string | undefined) =>
      (s ?? '').toLowerCase().replace(/^0+(?=.)/, '');
    const rows = await db.certificates.find({
      where: { chargePointId: v.cp.id },
    });
    const row = rows.find(
      (r) =>
        lower(r.serialNumber) === lower(wanted.serialNumber) &&
        lower(r.issuerNameHash) === lower(wanted.issuerNameHash) &&
        lower(r.issuerKeyHash) === lower(wanted.issuerKeyHash),
    );
    if (!row) return { status: 'NotFound' };
    if (row.certificateType === 'ChargePointCertificate') {
      // The charger's own identity is not deleted on request.
      return { status: 'Failed' };
    }
    await db.certificates.delete(row.id);
    if (
      row.certificateType === 'CentralSystemRootCertificate' &&
      v.cp.tlsCaCert.includes(row.pem.trim())
    ) {
      v.cp.tlsCaCert = v.cp.tlsCaCert.replace(row.pem.trim(), '').trim();
      v.markCpDirty();
    }
    v.event(
      'Security',
      `${row.certificateType} deleted (${row.subject})`,
      'warning',
    );
    return { status: 'Accepted' };
  }
}
