import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../api/auth/auth.service';
import { ENGINE_BUS } from '../engine/engine.service';
import type { EngineBusMessage } from '../engine/engine.service';

/** Pushes everything the engine reports to the browsers, as it happens. */
@WebSocketGateway({ cors: true })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server: Server;

  constructor(private readonly auth: AuthService) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!(await this.auth.verify(token))) client.disconnect(true);
  }

  @OnEvent(ENGINE_BUS)
  onEngine(message: EngineBusMessage) {
    this.server?.emit(message.event, message.payload);
  }
}
