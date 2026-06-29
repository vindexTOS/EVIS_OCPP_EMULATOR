import { Controller, Get, Param } from '@nestjs/common';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  findAll() {
    return this.sessions.findAll();
  }

  @Get('active')
  findActive() {
    return this.sessions.findActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sessions.findOne(id);
  }
}
