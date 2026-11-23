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
  Put,
  Query,
} from '@nestjs/common';
import { EngineService } from '../../engine/engine.service';
import { HistoryService } from '../../engine/history.service';
import { KNOWN_REQUESTS } from '../../engine/ocpp16/validators';
import {
  AvailabilityDto,
  ConfigValueDto,
  ConnectorInputDto,
  CreateChargePointDto,
  EmergencyDto,
  FaultDto,
  NetworkDto,
  OcppCallDto,
  OverrideDto,
  PauseDto,
  PlugDto,
  PowerDto,
  RfidDto,
  SecurityEventDto,
  UpdateChargePointDto,
  UpdateConnectorDto,
} from './dto/charge-point.dto';

const num = (value?: string) =>
  value === undefined || value === '' ? undefined : Number(value);

@Controller('charge-points')
export class ChargePointsController {
  constructor(
    private readonly engineService: EngineService,
    private readonly history: HistoryService,
  ) {}

  private get engine() {
    return this.engineService.engine;
  }

  // ------------------------------------------------------------ the charger

  @Get()
  list() {
    return this.engine.list();
  }

  @Post()
  create(@Body() dto: CreateChargePointDto) {
    return this.engine.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.engine.get(id).toDto();
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateChargePointDto,
  ) {
    return this.engine.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.engine.remove(id);
    return { deleted: true };
  }

  @Post(':id/power')
  @HttpCode(200)
  async power(@Param('id', ParseIntPipe) id: number, @Body() dto: PowerDto) {
    const v = this.engine.get(id);
    if (dto.on) await v.powerOn();
    else await v.powerOff();
    return v.toDto();
  }

  @Post(':id/network')
  @HttpCode(200)
  async network(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NetworkDto,
  ) {
    const v = this.engine.get(id);
    await v.setNetwork(dto.up);
    return v.toDto();
  }

  @Post(':id/reboot')
  @HttpCode(200)
  async reboot(@Param('id', ParseIntPipe) id: number) {
    const v = this.engine.get(id);
    await v.reboot();
    return v.toDto();
  }

  @Post(':id/emergency-stop')
  @HttpCode(200)
  async emergencyStop(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EmergencyDto,
  ) {
    const v = this.engine.get(id);
    await v.emergencyStop(dto.pressed);
    return v.toDto();
  }

  /** Hold an RFID card to the reader. Answers once the charger has decided. */
  @Post(':id/rfid')
  @HttpCode(200)
  rfid(@Param('id', ParseIntPipe) id: number, @Body() dto: RfidDto) {
    return this.engine.get(id).presentIdTag(dto.idTag, dto.connectorId);
  }

  @Post(':id/availability')
  @HttpCode(200)
  async availability(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AvailabilityDto,
  ) {
    const v = this.engine.get(id);
    const status = await v.setAvailability(dto.connectorId, dto.type);
    return { status, chargePoint: v.toDto() };
  }

  // -------------------------------------------------------------- connectors

  @Post(':id/connectors')
  async addConnector(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConnectorInputDto,
  ) {
    const v = this.engine.get(id);
    await v.addConnector(dto);
    return v.toDto();
  }

  @Delete(':id/connectors/last')
  async removeLastConnector(@Param('id', ParseIntPipe) id: number) {
    const v = this.engine.get(id);
    await v.removeLastConnector();
    return v.toDto();
  }

  @Patch(':id/connectors/:connectorId')
  async updateConnector(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectorId', ParseIntPipe) connectorId: number,
    @Body() dto: UpdateConnectorDto,
  ) {
    const v = this.engine.get(id);
    await v.updateConnector(connectorId, dto);
    return v.toDto();
  }

  @Post(':id/connectors/:connectorId/plug')
  @HttpCode(200)
  async plug(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectorId', ParseIntPipe) connectorId: number,
    @Body() dto: PlugDto,
  ) {
    await this.engine.plug(id, connectorId, dto.carId);
    return this.engine.get(id).toDto();
  }

  @Post(':id/connectors/:connectorId/unplug')
  @HttpCode(200)
  async unplug(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectorId', ParseIntPipe) connectorId: number,
  ) {
    await this.engine.unplug(id, connectorId);
    return this.engine.get(id).toDto();
  }

  /** The stop button of a connector. */
  @Post(':id/connectors/:connectorId/stop')
  @HttpCode(200)
  async stop(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectorId', ParseIntPipe) connectorId: number,
  ) {
    const v = this.engine.get(id);
    await v.pressStop(connectorId);
    return v.toDto();
  }

  @Post(':id/connectors/:connectorId/fault')
  @HttpCode(200)
  async fault(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectorId', ParseIntPipe) connectorId: number,
    @Body() dto: FaultDto,
  ) {
    const v = this.engine.get(id);
    await v.setFault(connectorId, dto);
    return v.toDto();
  }

  @Delete(':id/connectors/:connectorId/fault')
  async clearFault(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectorId', ParseIntPipe) connectorId: number,
  ) {
    const v = this.engine.get(id);
    await v.clearFault(connectorId);
    return v.toDto();
  }

  @Post(':id/connectors/:connectorId/pause')
  @HttpCode(200)
  async pause(
    @Param('id', ParseIntPipe) id: number,
    @Param('connectorId', ParseIntPipe) connectorId: number,
    @Body() dto: PauseDto,
  ) {
    const v = this.engine.get(id);
    await v.setPaused(connectorId, dto.who, dto.paused);
    return v.toDto();
  }

  // ----------------------------------------------------------- configuration

  @Get(':id/configuration')
  configuration(@Param('id', ParseIntPipe) id: number) {
    return this.engine.get(id).config.describe();
  }

  @Put(':id/configuration')
  async setConfiguration(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfigValueDto,
  ) {
    const v = this.engine.get(id);
    const status = await v.setConfig(dto.key, dto.value);
    return { status, configuration: v.config.describe() };
  }

  @Delete(':id/configuration/:key')
  async removeConfiguration(
    @Param('id', ParseIntPipe) id: number,
    @Param('key') key: string,
  ) {
    const v = this.engine.get(id);
    await v.removeConfigKey(key);
    return v.config.describe();
  }

  // ------------------------------------------------------------- OCPP by hand

  @Get(':id/ocpp/templates')
  templates(@Param('id', ParseIntPipe) id: number) {
    return this.engine.get(id).commandTemplates();
  }

  @Post(':id/ocpp/call')
  @HttpCode(200)
  async call(@Param('id', ParseIntPipe) id: number, @Body() dto: OcppCallDto) {
    const result = await this.engine
      .get(id)
      .sendCall(dto.action, dto.payload ?? {});
    return { action: dto.action, result };
  }

  // ------------------------------------------------------------ test switches

  /** CSMS requests whose answer can be overridden. */
  @Get(':id/overrides/actions')
  overridable() {
    return KNOWN_REQUESTS;
  }

  @Put(':id/overrides')
  async override(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: OverrideDto,
  ) {
    const v = this.engine.get(id);
    await v.setOverride(
      dto.action,
      dto.mode
        ? {
            mode: dto.mode,
            status: dto.status,
            errorCode: dto.errorCode,
            once: dto.once,
          }
        : null,
    );
    return v.toDto();
  }

  @Post(':id/security/event')
  @HttpCode(200)
  async securityEvent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SecurityEventDto,
  ) {
    await this.engine.get(id).raiseSecurityEvent(dto.type, dto.techInfo);
    return { sent: true };
  }

  @Post(':id/security/sign-certificate')
  @HttpCode(200)
  async signCertificate(@Param('id', ParseIntPipe) id: number) {
    await this.engine.get(id).requestCertificate();
    return { sent: true };
  }

  @Delete(':id/authorization/:source')
  async clearAuthorization(
    @Param('id', ParseIntPipe) id: number,
    @Param('source') source: string,
  ) {
    const v = this.engine.get(id);
    await v.clearAuthorization(source === 'list' ? 'list' : 'cache');
    return v.internals();
  }

  // ---------------------------------------------------------------- insights

  @Get(':id/internals')
  internals(@Param('id', ParseIntPipe) id: number) {
    return this.engine.get(id).internals();
  }

  @Get(':id/history')
  chargerHistory(
    @Param('id', ParseIntPipe) id: number,
    @Query('days') days?: string,
    @Query('tz') tz?: string,
  ) {
    return this.history.chargerHistory(id, num(days), num(tz));
  }

  @Get(':id/events')
  events(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.history.events(id, num(limit), num(before));
  }

  @Delete(':id/events')
  clearEvents(@Param('id', ParseIntPipe) id: number) {
    return this.history.clearEvents(id);
  }

  @Get(':id/logs')
  logs(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.history.logs(id, num(limit), num(before));
  }

  @Delete(':id/logs')
  clearLogs(@Param('id', ParseIntPipe) id: number) {
    return this.history.clearLogs(id);
  }
}
