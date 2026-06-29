import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';
import {
  ChargePoint,
  Connector,
} from '../../entities/charge-point.entity';
import { ChargePointStatus, OcppConnectorStatus } from '../../entities/enums';
import { ConnectionManager } from '../../ocpp-ws/connection-manager.service';
import {
  ConnectorInputDto,
  CreateChargePointDto,
} from './dto/create-charge-point.dto';
import { UpdateChargePointDto } from './dto/update-charge-point.dto';

const DEFAULT_CONFIG: Record<string, string> = {
  HeartbeatInterval: '60',
  MeterValueSampleInterval: '10',
};

@Injectable()
export class ChargePointsService {
  constructor(
    @InjectRepository(ChargePoint)
    private readonly chargePoints: MongoRepository<ChargePoint>,
    private readonly connections: ConnectionManager,
  ) {}

  create(dto: CreateChargePointDto) {
    const cp = this.chargePoints.create({
      name: dto.name,
      chargePointId: dto.chargePointId,
      vendor: dto.vendor,
      model: dto.model,
      firmwareVersion: dto.firmwareVersion ?? '1.0.0',
      csmsUrl: dto.csmsUrl,
      ocppVersion: '1.6',
      idTag: dto.idTag ?? 'EMULATOR',
      connectors: dto.connectors.map((c) => this.buildConnector(c)),
      configuration: { ...DEFAULT_CONFIG },
      lastStatus: ChargePointStatus.Offline,
    });
    return this.chargePoints.save(cp);
  }

  async findAll() {
    const cps = await this.chargePoints.find();
    return cps.map((cp) => this.withOnline(cp));
  }

  async findOne(id: string) {
    return this.withOnline(await this.getOrThrow(id));
  }

  async update(id: string, dto: UpdateChargePointDto) {
    const cp = await this.getOrThrow(id);
    const { connectors, ...rest } = dto;
    Object.assign(cp, rest);
    if (connectors) {
      cp.connectors = connectors.map((c) => this.buildConnector(c));
    }
    return this.chargePoints.save(cp);
  }

  async remove(id: string) {
    const cp = await this.getOrThrow(id);
    await this.connections.stop(id);
    await this.chargePoints.deleteOne({ _id: cp.id });
    return { deleted: true };
  }

  connect(id: string) {
    return this.connections.start(id);
  }

  disconnect(id: string) {
    return this.connections.stop(id);
  }

  private async getOrThrow(id: string): Promise<ChargePoint> {
    const cp = await this.chargePoints.findOneBy({ _id: new ObjectId(id) });
    if (!cp) {
      throw new NotFoundException('Charge point not found.');
    }
    return cp;
  }

  private withOnline(cp: ChargePoint) {
    return { ...cp, online: this.connections.isOnline(cp.id.toString()) };
  }

  private buildConnector(input: ConnectorInputDto): Connector {
    return {
      connectorId: input.connectorId,
      type: input.type,
      maxPowerW: input.maxPowerW,
      status: OcppConnectorStatus.Available,
      totalEnergyWh: 0,
    };
  }
}
