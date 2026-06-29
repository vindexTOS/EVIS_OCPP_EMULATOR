import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column()
  email: string;

  @Column()
  password: string;
}
