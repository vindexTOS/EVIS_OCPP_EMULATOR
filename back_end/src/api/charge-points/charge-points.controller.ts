import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConnectionManager } from '../../ocpp-ws/connection-manager.service';
import { OcppLogService } from '../../ocpp-ws/ocpp-log.service';
import { SimulationService } from '../../ocpp-ws/simulation/simulation.service';
import { ChargePointsService } from './charge-points.service';
import { CreateChargePointDto } from './dto/create-charge-point.dto';
import {
  ForceStatusDto,
  OcppCallDto,
  SimulateRejectDto,
} from './dto/ocpp-command.dto';
import { StartChargingDto } from './dto/start-charging.dto';
import { UpdateChargePointDto } from './dto/update-charge-point.dto';

@Controller('charge-points')
export class ChargePointsController {
  constructor(
    private readonly chargePoints: ChargePointsService,
    private readonly simulation: SimulationService,
    private readonly connections: ConnectionManager,
    private readonly logs: OcppLogService,
  ) {}

  @Post()
  create(@Body() dto: CreateChargePointDto) {
    return this.chargePoints.create(dto);
  }

  @Get()
  findAll() {
    return this.chargePoints.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chargePoints.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChargePointDto) {
    return this.chargePoints.update(id, dto);
  }

  @Post(':id/connect')
  connect(@Param('id') id: string) {
    return this.chargePoints.connect(id);
  }

  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.chargePoints.disconnect(id);
  }

  @Post(':id/connectors/:connectorId/start')
  startCharging(
    @Param('id') id: string,
    @Param('connectorId', ParseIntPipe) connectorId: number,
    @Body() dto: StartChargingDto,
  ) {
    return this.simulation.startCharging(id, connectorId, dto.carId);
  }

  @Post(':id/connectors/:connectorId/stop')
  stopCharging(
    @Param('id') id: string,
    @Param('connectorId', ParseIntPipe) connectorId: number,
  ) {
    return this.simulation.stopCharging(id, connectorId);
  }

  @Post(':id/connectors/:connectorId/status')
  forceStatus(
    @Param('id') id: string,
    @Param('connectorId', ParseIntPipe) connectorId: number,
    @Body() dto: ForceStatusDto,
  ) {
    return this.simulation.forceConnectorStatus(
      id,
      connectorId,
      dto.status,
      dto.payload,
    );
  }

  @Get(':id/ocpp/templates')
  ocppTemplates(@Param('id') id: string) {
    return this.simulation.commandTemplates(id);
  }

  @Post(':id/ocpp/call')
  async ocppCall(@Param('id') id: string, @Body() dto: OcppCallDto) {
    const conn = this.connections.get(id);
    if (!conn?.connected) {
      throw new BadRequestException('Charge point is not connected to a CSMS.');
    }
    const result = await conn.sendCall(dto.action, dto.payload ?? {});
    return { action: dto.action, result };
  }

  @Post(':id/simulate/reject')
  simulateReject(@Param('id') id: string, @Body() dto: SimulateRejectDto) {
    const conn = this.connections.get(id);
    if (!conn) {
      throw new BadRequestException('Charge point is not connected.');
    }
    return conn.simulateReject(dto);
  }

  @Get(':id/logs')
  logsForChargePoint(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.recent(id, limit ? Number(limit) : undefined);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.chargePoints.remove(id);
  }
}
