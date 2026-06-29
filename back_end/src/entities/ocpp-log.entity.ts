import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A single OCPP-J frame (CALL / CALLRESULT / CALLERROR) observed on a charge
 * point's CSMS connection. Rows self-expire via a TTL index on `ts`
 * (see OcppLogService.onModuleInit).
 */
@Entity({ name: 'ocpp_logs' })
export class OcppLog extends BaseEntity {
  @Column()
  chargePointId: string;

  @Column()
  direction: 'in' | 'out';

  @Column()
  messageType: number;

  @Column()
  action: string;

  @Column()
  messageId: string;

  @Column()
  payload: unknown;

  @Column()
  ts: Date;
}
