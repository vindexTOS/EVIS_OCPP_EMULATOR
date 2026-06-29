import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { OcppLog } from '../entities/ocpp-log.entity';
import type { FrameEvent } from './core/rpc-client';
import { ENGINE_EVENTS } from './events';

const LOG_TTL_SECONDS = 86400; // 24h
const DEFAULT_LIMIT = 200;

@Injectable()
export class OcppLogService implements OnModuleInit {
  private readonly logger = new Logger(OcppLogService.name);

  constructor(
    @InjectRepository(OcppLog)
    private readonly logs: MongoRepository<OcppLog>,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    try {
      await this.logs.createCollectionIndex(
        { ts: 1 },
        { expireAfterSeconds: LOG_TTL_SECONDS },
      );
    } catch (err) {
      this.logger.warn(`Could not create TTL index on ocpp_logs: ${(err as Error).message}`);
    }
  }

  async record(chargePointId: string, frame: FrameEvent) {
    const entry = this.logs.create({
      chargePointId,
      direction: frame.direction,
      messageType: frame.messageType,
      action: frame.action,
      messageId: frame.messageId,
      payload: frame.payload,
      ts: new Date(),
    });
    await this.logs.save(entry);
    this.events.emit(ENGINE_EVENTS.ocppLog, this.toDto(entry));
  }

  async recent(chargePointId: string, limit = DEFAULT_LIMIT) {
    const rows = await this.logs.find({
      where: { chargePointId },
      order: { ts: 'DESC' },
      take: limit,
    });
    return rows.reverse().map((r) => this.toDto(r));
  }

  private toDto(entry: OcppLog) {
    return {
      id: entry.id.toString(),
      chargePointId: entry.chargePointId,
      direction: entry.direction,
      messageType: entry.messageType,
      action: entry.action,
      messageId: entry.messageId,
      payload: entry.payload,
      ts: entry.ts.toISOString(),
    };
  }
}
