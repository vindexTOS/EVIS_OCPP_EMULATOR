import { OnEvent } from '@nestjs/event-emitter';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { ENGINE_EVENTS } from '../ocpp-ws/events';

@WebSocketGateway({ cors: true })
export class RealtimeGateway {
  @WebSocketServer()
  private server: Server;

  @OnEvent(ENGINE_EVENTS.chargePointStatus)
  onChargePointStatus(payload: unknown) {
    this.server?.emit(ENGINE_EVENTS.chargePointStatus, payload);
  }

  @OnEvent(ENGINE_EVENTS.connectorUpdate)
  onConnectorUpdate(payload: unknown) {
    this.server?.emit(ENGINE_EVENTS.connectorUpdate, payload);
  }

  @OnEvent(ENGINE_EVENTS.sessionStarted)
  onSessionStarted(payload: unknown) {
    this.server?.emit(ENGINE_EVENTS.sessionStarted, payload);
  }

  @OnEvent(ENGINE_EVENTS.sessionTick)
  onSessionTick(payload: unknown) {
    this.server?.emit(ENGINE_EVENTS.sessionTick, payload);
  }

  @OnEvent(ENGINE_EVENTS.sessionEnded)
  onSessionEnded(payload: unknown) {
    this.server?.emit(ENGINE_EVENTS.sessionEnded, payload);
  }
}
