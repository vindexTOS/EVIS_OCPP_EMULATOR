import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { EngineService } from '../../engine/engine.service';
import { CreateCarDto, SetBatteryDto, UpdateCarDto } from './dto/car.dto';

@Controller('cars')
export class CarsController {
  constructor(private readonly engineService: EngineService) {}

  private get engine() {
    return this.engineService.engine;
  }

  @Get()
  list() {
    return this.engine.listCars();
  }

  @Post()
  create(@Body() dto: CreateCarDto) {
    return this.engine.createCar(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCarDto) {
    return this.engine.updateCar(id, dto);
  }

  @Post(':id/battery')
  @HttpCode(200)
  setBattery(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetBatteryDto,
  ) {
    return this.engine.setBattery(id, dto.socPercent);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.engine.deleteCar(id);
    return { deleted: true };
  }
}
