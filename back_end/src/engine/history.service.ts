import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  LessThan,
  MoreThanOrEqual,
} from 'typeorm';
import {
  ChargerEvent,
  ChargingSession,
  MeterSample,
  OcppLog,
} from '../entities';
import type { SessionStatus } from '../entities/enums';
import { EngineService } from './engine.service';
import { EngineError, EventDto, OcppLogDto } from './types';
import { VirtualChargePoint } from './virtual-charge-point';

export interface SessionRow {
  id: number;
  chargePointId: number;
  connectorId: number;
  connectorType: string;
  carId: number | null;
  carName: string;
  idTag: string;
  transactionId: number | null;
  reservationId: number | null;
  startedBy: string;
  meterStartWh: number;
  meterStopWh: number | null;
  energyWh: number;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number;
  chargingSec: number;
  status: SessionStatus;
  stopReason: string | null;
  startSoc: number | null;
  stopSoc: number | null;
  peakPowerW: number;
  startConfirmed: boolean;
  stopConfirmed: boolean;
  idTagStatus: string | null;
}

export interface SessionFilter {
  chargePointId?: number;
  connectorId?: number;
  carId?: number;
  status?: SessionStatus;
  /** Only sessions that started at or after this instant. */
  since?: Date;
  limit?: number;
  offset?: number;
}

/** SQLite hands raw datetimes back as "YYYY-MM-DD HH:MM:SS.sss" in UTC. */
const sqlToIso = (value: unknown): string | null =>
  typeof value === 'string' && value ? `${value.replace(' ', 'T')}Z` : null;
const toSql = (date: Date) =>
  date.toISOString().replace('T', ' ').replace('Z', '');
const clamp = (
  n: number | undefined,
  min: number,
  max: number,
  fallback: number,
) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n as number)) : fallback;

/** Read side of the emulator: what each charger and connector has done so far. */
@Injectable()
export class HistoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly engineService: EngineService,
  ) {}

  private sessionRow(s: ChargingSession, now = Date.now()): SessionRow {
    const end = s.stoppedAt ? s.stoppedAt.getTime() : now;
    return {
      id: s.id,
      chargePointId: s.chargePointId,
      connectorId: s.connectorId,
      connectorType: s.connectorType,
      carId: s.carId,
      carName: s.carName,
      idTag: s.idTag,
      transactionId: s.transactionId,
      reservationId: s.reservationId,
      startedBy: s.startedBy,
      meterStartWh: s.meterStartWh,
      meterStopWh: s.meterStopWh,
      energyWh: s.energyWh,
      startedAt: s.startedAt.toISOString(),
      stoppedAt: s.stoppedAt ? s.stoppedAt.toISOString() : null,
      durationSec: Math.max(
        0,
        Math.round((end - s.startedAt.getTime()) / 1000),
      ),
      chargingSec: Math.round(s.chargingSec),
      status: s.status,
      stopReason: s.stopReason,
      startSoc: s.startSoc,
      stopSoc: s.stopSoc,
      peakPowerW: s.peakPowerW,
      startConfirmed: s.startConfirmed,
      stopConfirmed: s.stopConfirmed,
      idTagStatus: s.idTagStatus,
    };
  }

  async sessions(
    filter: SessionFilter,
  ): Promise<{ items: SessionRow[]; total: number }> {
    const where: FindOptionsWhere<ChargingSession> = {};
    if (filter.chargePointId != null)
      where.chargePointId = filter.chargePointId;
    if (filter.connectorId != null) where.connectorId = filter.connectorId;
    if (filter.carId != null) where.carId = filter.carId;
    if (filter.status) where.status = filter.status;
    if (filter.since) where.startedAt = MoreThanOrEqual(filter.since);
    const [rows, total] = await this.dataSource
      .getRepository(ChargingSession)
      .findAndCount({
        where,
        order: { id: 'DESC' },
        take: clamp(filter.limit, 1, 500, 50),
        skip: clamp(filter.offset, 0, Number.MAX_SAFE_INTEGER, 0),
      });
    return { items: rows.map((row) => this.sessionRow(row)), total };
  }

  async session(id: number) {
    const session = await this.dataSource
      .getRepository(ChargingSession)
      .findOneBy({ id });
    if (!session) throw new EngineError('Session not found.', 'not-found');
    const samples = await this.dataSource
      .getRepository(MeterSample)
      .find({ where: { sessionId: id }, order: { id: 'ASC' } });
    return {
      session: this.sessionRow(session),
      samples: samples.map((s) => ({
        ts: s.ts.toISOString(),
        context: s.context,
        energyWh: s.energyWh,
        powerW: s.powerW,
        currentA: s.currentA,
        voltageV: s.voltageV,
        soc: s.soc,
      })),
    };
  }

  /**
   * What one charger has delivered in the last `days` days: per connector, per
   * day and in total. `tzOffsetMin` is the viewer's offset east of UTC, so
   * days break at their midnight.
   */
  async chargerHistory(chargePointId: number, days = 30, tzOffsetMin = 0) {
    const charger = this.engineService.engine.get(chargePointId).toDto();
    const span = clamp(days, 1, 366, 30);
    const offset = clamp(tzOffsetMin, -840, 840, 0);
    const now = new Date();

    // First local midnight of the window, expressed in UTC.
    const localNow = new Date(now.getTime() + offset * 60_000);
    const localMidnight = Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate(),
    );
    const since = new Date(
      localMidnight - (span - 1) * 86_400_000 - offset * 60_000,
    );

    const perConnector: Array<Record<string, unknown>> =
      await this.dataSource.query(
        `SELECT connectorId,
              COUNT(*) AS sessions,
              COALESCE(SUM(energyWh), 0) AS energyWh,
              COALESCE(SUM(chargingSec), 0) AS chargingSec,
              COALESCE(SUM((julianday(COALESCE(stoppedAt, ?)) - julianday(startedAt)) * 86400.0), 0) AS durationSec,
              MAX(startedAt) AS lastSessionAt,
              COALESCE(MAX(peakPowerW), 0) AS peakPowerW
         FROM charging_sessions
        WHERE chargePointId = ? AND startedAt >= ?
        GROUP BY connectorId`,
        [toSql(now), chargePointId, toSql(since)],
      );

    const shift = `${offset >= 0 ? '+' : '-'}${Math.abs(offset)} minutes`;
    const perDay: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT strftime('%Y-%m-%d', startedAt, ?) AS day,
              connectorId,
              COALESCE(SUM(energyWh), 0) AS energyWh,
              COUNT(*) AS sessions
         FROM charging_sessions
        WHERE chargePointId = ? AND startedAt >= ?
        GROUP BY day, connectorId
        ORDER BY day`,
      [shift, chargePointId, toSql(since)],
    );

    const reasons: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT COALESCE(stopReason, 'Running') AS reason, COUNT(*) AS count
         FROM charging_sessions
        WHERE chargePointId = ? AND startedAt >= ?
        GROUP BY reason
        ORDER BY count DESC`,
      [chargePointId, toSql(since)],
    );

    const connectors = charger.connectors.map((c) => {
      const row = perConnector.find(
        (r) => Number(r.connectorId) === c.connectorId,
      );
      const sessions = Number(row?.sessions ?? 0);
      const energyWh = Number(row?.energyWh ?? 0);
      return {
        connectorId: c.connectorId,
        type: c.type,
        maxPowerW: c.maxPowerW,
        status: c.status,
        /** Lifetime register of the outlet's meter. */
        meterWh: c.meterWh,
        sessions,
        energyWh,
        chargingSec: Math.round(Number(row?.chargingSec ?? 0)),
        durationSec: Math.round(Number(row?.durationSec ?? 0)),
        peakPowerW: Math.round(Number(row?.peakPowerW ?? 0)),
        averageEnergyWh: sessions > 0 ? energyWh / sessions : 0,
        lastSessionAt: sqlToIso(row?.lastSessionAt),
      };
    });

    const daily = Array.from({ length: span }, (_, i) => {
      const day = new Date(localMidnight - (span - 1 - i) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const rows = perDay.filter((r) => r.day === day);
      return {
        day,
        energyWh: rows.reduce((sum, r) => sum + Number(r.energyWh), 0),
        sessions: rows.reduce((sum, r) => sum + Number(r.sessions), 0),
        byConnector: charger.connectors.map((c) => ({
          connectorId: c.connectorId,
          energyWh: Number(
            rows.find((r) => Number(r.connectorId) === c.connectorId)
              ?.energyWh ?? 0,
          ),
        })),
      };
    });

    return {
      chargePointId,
      days: span,
      since: since.toISOString(),
      totals: {
        sessions: connectors.reduce((sum, c) => sum + c.sessions, 0),
        energyWh: connectors.reduce((sum, c) => sum + c.energyWh, 0),
        meterWh: connectors.reduce((sum, c) => sum + c.meterWh, 0),
        chargingSec: connectors.reduce((sum, c) => sum + c.chargingSec, 0),
        durationSec: connectors.reduce((sum, c) => sum + c.durationSec, 0),
      },
      connectors,
      daily,
      stopReasons: reasons.map((r) => ({
        reason: String(r.reason),
        count: Number(r.count),
      })),
    };
  }

  /** Totals across every charger, for the history page. */
  async overview() {
    const [row]: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(energyWh), 0) AS energyWh,
              COALESCE(SUM(chargingSec), 0) AS chargingSec,
              COALESCE(SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END), 0) AS active
         FROM charging_sessions`,
    );
    return {
      sessions: Number(row?.sessions ?? 0),
      energyWh: Number(row?.energyWh ?? 0),
      chargingSec: Math.round(Number(row?.chargingSec ?? 0)),
      active: Number(row?.active ?? 0),
    };
  }

  async events(
    chargePointId: number,
    limit?: number,
    before?: number,
  ): Promise<EventDto[]> {
    this.engineService.engine.get(chargePointId);
    const rows = await this.dataSource.getRepository(ChargerEvent).find({
      where: { chargePointId, ...(before ? { id: LessThan(before) } : {}) },
      order: { id: 'DESC' },
      take: clamp(limit, 1, 500, 100),
    });
    return rows.map((row) => VirtualChargePoint.eventDto(row));
  }

  /** Newest `limit` frames, oldest first. */
  async logs(
    chargePointId: number,
    limit?: number,
    before?: number,
  ): Promise<OcppLogDto[]> {
    this.engineService.engine.get(chargePointId);
    const rows = await this.dataSource.getRepository(OcppLog).find({
      where: { chargePointId, ...(before ? { id: LessThan(before) } : {}) },
      order: { id: 'DESC' },
      take: clamp(limit, 1, 1000, 300),
    });
    return rows.reverse().map((row) => VirtualChargePoint.logDto(row));
  }

  async clearLogs(chargePointId: number) {
    this.engineService.engine.get(chargePointId);
    await this.dataSource.getRepository(OcppLog).delete({ chargePointId });
    return { cleared: true };
  }

  async clearEvents(chargePointId: number) {
    this.engineService.engine.get(chargePointId);
    await this.dataSource.getRepository(ChargerEvent).delete({ chargePointId });
    return { cleared: true };
  }
}
