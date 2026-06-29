import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  MessageType,
  OcppCall,
  OcppErrorCode,
  OcppMessage,
} from './ocpp-message';

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export type IncomingCallHandler = (
  payload: unknown,
) => Promise<unknown> | unknown;

export interface RpcClientOptions {
  subProtocol?: string;
  callTimeoutMs?: number;
  reconnect?: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

/**
 * OCPP-J transport: speaks the [2]CALL / [3]CALLRESULT / [4]CALLERROR framing
 * over a `ws` client socket, correlating responses by message id, with
 * auto-reconnect. Protocol-version agnostic.
 */
export class RpcClient extends EventEmitter {
  private ws?: WebSocket;
  private readonly pending = new Map<string, PendingCall>();
  private readonly handlers = new Map<string, IncomingCallHandler>();
  private closedByUser = false;
  private reconnectAttempts = 0;
  private readonly opts: Required<RpcClientOptions>;

  constructor(
    private readonly url: string,
    options: RpcClientOptions = {},
  ) {
    super();
    this.opts = {
      subProtocol: options.subProtocol ?? 'ocpp1.6',
      callTimeoutMs: options.callTimeoutMs ?? 30000,
      reconnect: options.reconnect ?? true,
      reconnectBaseMs: options.reconnectBaseMs ?? 1000,
      reconnectMaxMs: options.reconnectMaxMs ?? 30000,
    };
  }

  handle(action: string, handler: IncomingCallHandler) {
    this.handlers.set(action, handler);
  }

  connect() {
    this.closedByUser = false;
    this.open();
  }

  close() {
    this.closedByUser = true;
    this.failAllPending(new Error('Connection closed'));
    this.ws?.close();
    this.ws = undefined;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  call<T = unknown>(action: string, payload: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Socket not open'));
    }
    const messageId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`OCPP call ${action} timed out`));
      }, this.opts.callTimeoutMs);
      this.pending.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      ws.send(JSON.stringify([MessageType.CALL, messageId, action, payload]));
    });
  }

  private open() {
    const ws = new WebSocket(this.url, [this.opts.subProtocol]);
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.emit('open');
    });
    ws.on('message', (data: WebSocket.RawData) =>
      this.onMessage(data.toString()),
    );
    ws.on('error', (err) => this.emit('error', err));
    ws.on('close', () => {
      this.ws = undefined;
      this.failAllPending(new Error('Connection closed'));
      this.emit('close');
      if (!this.closedByUser && this.opts.reconnect) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect() {
    const base = Math.min(
      this.opts.reconnectMaxMs,
      this.opts.reconnectBaseMs * 2 ** this.reconnectAttempts,
    );
    const delay = base + base * 0.2 * Math.random();
    this.reconnectAttempts++;
    setTimeout(() => {
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private onMessage(raw: string) {
    let msg: OcppMessage;
    try {
      msg = JSON.parse(raw) as OcppMessage;
    } catch {
      return;
    }
    switch (msg[0]) {
      case MessageType.CALL:
        void this.onCall(msg);
        break;
      case MessageType.CALLRESULT: {
        const [, messageId, payload] = msg;
        this.settle(messageId, (p) => p.resolve(payload));
        break;
      }
      case MessageType.CALLERROR: {
        const [, messageId, code, description] = msg;
        this.settle(messageId, (p) =>
          p.reject(new Error(`${code}: ${description}`)),
        );
        break;
      }
    }
  }

  private settle(messageId: string, fn: (p: PendingCall) => void) {
    const pending = this.pending.get(messageId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(messageId);
    fn(pending);
  }

  private async onCall([, messageId, action, payload]: OcppCall) {
    const handler = this.handlers.get(action);
    if (!handler) {
      this.send([
        MessageType.CALLERROR,
        messageId,
        OcppErrorCode.NotImplemented,
        `Unsupported action: ${action}`,
        {},
      ]);
      return;
    }
    try {
      const result = await handler(payload);
      this.send([MessageType.CALLRESULT, messageId, result ?? {}]);
    } catch (err) {
      this.send([
        MessageType.CALLERROR,
        messageId,
        OcppErrorCode.InternalError,
        (err as Error).message,
        {},
      ]);
    }
  }

  private send(frame: unknown[]) {
    this.ws?.send(JSON.stringify(frame));
  }

  private failAllPending(error: Error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
}
