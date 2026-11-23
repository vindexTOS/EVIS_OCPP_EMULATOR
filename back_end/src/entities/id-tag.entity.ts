import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** An RFID card the tester can tap on a charger. */
@Entity({ name: 'id_tags' })
export class IdTag extends BaseEntity {
  @Column()
  label: string;

  /** OCPP idTag (CiString20). */
  @Index({ unique: true })
  @Column()
  idTag: string;

  @Column({ default: '#22c55e' })
  color: string;
}
