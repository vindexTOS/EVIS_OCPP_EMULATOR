import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';
import { ChargingSession } from '../../entities/charging-session.entity';
import { SessionStatus } from '../../entities/enums';

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(ChargingSession)
    private readonly sessions: MongoRepository<ChargingSession>,
  ) {}

  findAll() {
    return this.sessions.find({ order: { startedAt: 'DESC' } });
  }

  findActive() {
    return this.sessions.find({ where: { status: SessionStatus.Active } });
  }

  async findOne(id: string) {
    const session = await this.sessions.findOneBy({ _id: new ObjectId(id) });
    if (!session) {
      throw new NotFoundException('Session not found.');
    }
    return session;
  }
}
