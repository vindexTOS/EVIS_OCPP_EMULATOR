import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ChargePoint } from './charge-point.entity';

export type CertificateUse =
  | 'CentralSystemRootCertificate'
  | 'ManufacturerRootCertificate'
  | 'ChargePointCertificate';

/** A certificate in the charger's store (OCPP 1.6 security extension). */
@Entity({ name: 'certificates' })
@Index(['chargePointId', 'certificateType'])
export class Certificate extends BaseEntity {
  @ManyToOne(() => ChargePoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chargePointId' })
  chargePoint?: ChargePoint;

  @Column()
  chargePointId: number;

  @Column({ type: 'varchar' })
  certificateType: CertificateUse;

  @Column({ type: 'text' })
  pem: string;

  @Column({ default: '' })
  subject: string;

  // CertificateHashData, all hex, SHA-256.
  @Column({ default: '' })
  issuerNameHash: string;

  @Column({ default: '' })
  issuerKeyHash: string;

  @Column({ default: '' })
  serialNumber: string;
}
