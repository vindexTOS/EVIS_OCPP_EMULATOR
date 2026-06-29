import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { SimulationService } from '../../ocpp-ws/simulation/simulation.service';
import { ChargePointsService } from './charge-points.service';
import { CreateChargePointDto } from './dto/create-charge-point.dto';
import { StartChargingDto } from './dto/start-charging.dto';
import { UpdateChargePointDto } from './dto/update-charge-point.dto';

@Controller('charge-points')
export class ChargePointsController {
  constructor(
    private readonly chargePoints: ChargePointsService,
    private readonly simulation: SimulationService,
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

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.chargePoints.remove(id);
  }
}
