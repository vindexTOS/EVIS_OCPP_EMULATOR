import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ChargePoint } from './charge-point.entity';
import type { AuthorizationStatus } from './enums';

/**
 * What a charger knows about an idTag without asking the CSMS.
 * list  – the Local Authorization List, pushed by SendLocalList
 * cache – the Authorization Cache, learned from the CSMS's own answers
 */
@Entity({ name: 'auth_entries' })
@Index(['chargePointId', 'source', 'idTag'], { unique: true })
export class AuthEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  @Column({ type: 'varchar' })
  source: 'list' | 'cache';

  @Column()
  idTag: string;

  @Column({ type: 'varchar' })
  status: AuthorizationStatus;

  @Column({ type: 'datetime', nullable: true })
  expiryDate: Date | null;

  @Column({ type: 'varchar', nullable: true })
  parentIdTag: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
