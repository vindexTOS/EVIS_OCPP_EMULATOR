import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectIdColumn,
} from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity({ name: 'users' })
export class User {
  @ObjectIdColumn()
  id: ObjectId;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column()
  password: string;

  @CreateDateColumn()
  createdAt: Date;
}
