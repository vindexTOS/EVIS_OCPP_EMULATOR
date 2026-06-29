import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CarsService } from './cars.service';
import { CreateCarDto } from './dto/create-car.dto';
import { SetBatteryDto } from './dto/set-battery.dto';
import { UpdateCarDto } from './dto/update-car.dto';

@Controller('cars')
export class CarsController {
  constructor(private readonly cars: CarsService) {}

  @Post()
  create(@Body() dto: CreateCarDto) {
    return this.cars.create(dto);
  }

  @Get()
  findAll() {
    return this.cars.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cars.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCarDto) {
    return this.cars.update(id, dto);
  }

  @Post(':id/battery')
  setBattery(@Param('id') id: string, @Body() dto: SetBatteryDto) {
    return this.cars.setBattery(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cars.remove(id);
  }
}
