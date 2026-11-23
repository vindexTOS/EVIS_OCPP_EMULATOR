import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { HistoryService } from '../../engine/history.service';

const num = (value?: string) =>
  value === undefined || value === '' ? undefined : Number(value);

/** Every transaction the emulator has run, newest first. */
@Controller('sessions')
export class SessionsController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  list(
    @Query('chargePointId') chargePointId?: string,
    @Query('connectorId') connectorId?: string,
    @Query('carId') carId?: string,
    @Query('status') status?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.history.sessions({
      chargePointId: num(chargePointId),
      connectorId: num(connectorId),
      carId: num(carId),
      status: status === 'Active' || status === 'Stopped' ? status : undefined,
      since:
        since && !Number.isNaN(Date.parse(since)) ? new Date(since) : undefined,
      limit: num(limit),
      offset: num(offset),
    });
  }

  @Get('overview')
  overview() {
    return this.history.overview();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.history.session(id);
  }
}
