import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';
import { Car } from '../../entities/car.entity';
import { CreateCarDto } from './dto/create-car.dto';
import { SetBatteryDto } from './dto/set-battery.dto';
import { UpdateCarDto } from './dto/update-car.dto';

@Injectable()
export class CarsService {
  constructor(
    @InjectRepository(Car)
    private readonly cars: MongoRepository<Car>,
  ) {}

  create(dto: CreateCarDto) {
    return this.cars.save(this.cars.create(dto));
  }

  findAll() {
    return this.cars.find();
  }

  async findOne(id: string) {
    const car = await this.cars.findOneBy({ _id: new ObjectId(id) });
    if (!car) {
      throw new NotFoundException('Car not found.');
    }
    return car;
  }

  async update(id: string, dto: UpdateCarDto) {
    const car = await this.findOne(id);
    Object.assign(car, dto);
    return this.cars.save(car);
  }

  async setBattery(id: string, dto: SetBatteryDto) {
    const car = await this.findOne(id);
    car.batterySoCWh = (car.batteryCapacityWh * dto.socPercent) / 100;
    return this.cars.save(car);
  }

  async remove(id: string) {
    const car = await this.findOne(id);
    await this.cars.deleteOne({ _id: car.id });
    return { deleted: true };
  }
}
