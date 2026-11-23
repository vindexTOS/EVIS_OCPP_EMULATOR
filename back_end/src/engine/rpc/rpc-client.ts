import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  FrameEvent,
  MessageType,
  NotConnectedError,
  OcppCallError,
  OcppError,
  OcppTimeoutError,
} from './ocpp-message';

export interface RpcTlsOptions {
  rejectUnauthorized?: boolean;
  ca?: string;
  cert?: string;
  key?: string;
}

export interface RpcClientOptions {
  url: string;
  subProtocols?: string[];
  headers?: Record<string, string>;
  tls?: RpcTlsOptions;
  callTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  /** WebSocket ping period; 0 turns pings off. */
  pingIntervalMs?: number;
  reconnect?: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

/**
 * Returned by a handler that has answered already (through respond()), or that
 * deliberately does not answer at all.
 */
export const NO_REPLY = Symbol('no-reply');

export type IncomingCallHandler = (
  payload: Record<string, unknown>,
  messageId: string,
) => unknown;

export interface CloseInfo {
  code: number;
  reason: string;
  /** False when the socket never got as far as an open connection. */
  wasOpen: boolean;
  /** HTTP status of a refused upgrade (401, 404, ...), when there was one. */
  httpStatus?: number;
  error?: string;
}

/** A WebSocket text frame as a string, however `ws` chose to deliver it. */
export function rawToText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

interface OutgoingCall {
  messageId: string;
  action: string;
  payload: unknown;
  timeoutMs: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * OCPP-J client transport.
 *
 * Speaks [2]CALL / [3]CALLRESULT / [4]CALLERROR over a `ws` socket and keeps to
 * the rule of OCPP-J 1.6 §4.1.1: a new CALL is only sent once the previous one
 * was answered or timed out, so outgoing calls wait in a queue.
 * Redials on its own with exponential backoff.
 */
export class RpcClient extends EventEmitter {
  private ws?: WebSocket;
  private readonly handlers = new Map<string, IncomingCallHandler>();
  private readonly outbox: OutgoingCall[] = [];
  private inFlight?: OutgoingCall;
  private activeHandlers = 0;
  private closedByUser = true;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private pongSeen = true;
  private opened = false;
  private lastError?: string;
  private opts: Required<Omit<RpcClientOptions, 'tls' | 'headers'>> &
    Pick<RpcClientOptions, 'tls' | 'headers'>;

  constructor(options: RpcClientOptions) {
    super();
    this.opts = {
      url: options.url,
      subProtocols: options.subProtocols ?? ['ocpp1.6'],
      headers: options.headers,
      tls: options.tls,
      callTimeoutMs: options.callTimeoutMs ?? 30000,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 15000,
      pingIntervalMs: options.pingIntervalMs ?? 0,
      reconnect: options.reconnect ?? true,
      reconnectBaseMs: options.reconnectBaseMs ?? 1000,
      reconnectMaxMs: options.reconnectMaxMs ?? 30000,
    };
  }

  get url() {
    return this.opts.url;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Sub-protocol the server agreed to ('' when it agreed to none). */
  get protocol() {
    return this.ws?.protocol ?? '';
  }

  /** True when nothing is queued, in flight or being handled. */
  get idle() {
    return (
      !this.inFlight && this.outbox.length === 0 && this.activeHandlers === 0
    );
  }

  handle(action: string, handler: IncomingCallHandler) {
    this.handlers.set(action, handler);
  }

  connect() {
    this.closedByUser = false;
    this.reconnectAttempts = 0;
    this.open();
  }

  /**
   * Close for good: no redial until connect() is called again.
   * `hard` cuts the socket without a close frame, as losing power would.
   */
  close(code = 1000, reason = '', hard = false) {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.failAll();
    const ws = this.ws;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN && !hard) ws.close(code, reason);
    else ws.terminate();
  }

  /** Kill the socket without a close frame, as a lost network link would. */
  drop() {
    this.ws?.terminate();
  }

  setPingInterval(ms: number) {
    this.opts.pingIntervalMs = ms;
    if (this.connected) this.startPing();
  }

  call<T = unknown>(
    action: string,
    payload: unknown,
    timeoutMs = this.opts.callTimeoutMs,
  ): Promise<T> {
    if (!this.connected) {
      return Promise.reject(new NotConnectedError(action));
    }
    return new Promise<T>((resolve, reject) => {
      this.outbox.push({
        messageId: randomUUID(),
        action,
        payload,
        timeoutMs,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  // --- Connection ---

  private open() {
    this.opened = false;
    this.lastError = undefined;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url, this.opts.subProtocols, {
        headers: this.opts.headers,
        handshakeTimeout: this.opts.handshakeTimeoutMs,
        perMessageDeflate: false,
        ...(this.opts.tls ?? {}),
      });
    } catch (err) {
      // A malformed URL throws synchronously instead of emitting 'error'.
      this.lastError = (err as Error).message;
      this.emit('error', err);
      this.emit('close', {
        code: 1006,
        reason: '',
        wasOpen: false,
        error: this.lastError,
      } satisfies CloseInfo);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.opened = true;
      this.reconnectAttempts = 0;
      this.pongSeen = true;
      this.startPing();
      this.emit('open', { protocol: ws.protocol });
    });
    ws.on('message', (data: WebSocket.RawData) => {
      if (this.ws !== ws) return;
      this.onMessage(rawToText(data));
    });
    ws.on('pong', () => {
      this.pongSeen = true;
    });
    ws.on('error', (err: Error) => {
      if (this.ws !== ws) return;
      this.lastError = err.message;
      this.emit('error', err);
    });
    ws.on('close', (code: number, reason: Buffer) => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.stopPing();
      this.failAll();
      const status = /Unexpected server response: (\d+)/.exec(
        this.lastError ?? '',
      );
      this.emit('close', {
        code,
        reason: reason?.toString() ?? '',
        wasOpen: this.opened,
        httpStatus: status ? Number(status[1]) : undefined,
        error: this.lastError,
      } satisfies CloseInfo);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.closedByUser || !this.opts.reconnect) return;
    const base = Math.min(
      this.opts.reconnectMaxMs,
      this.opts.reconnectBaseMs * 2 ** this.reconnectAttempts,
    );
    const delay = Math.round(base + base * 0.2 * Math.random());
    this.reconnectAttempts++;
    this.emit('reconnectScheduled', {
      delayMs: delay,
      attempt: this.reconnectAttempts,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closedByUser) this.open();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startPing() {
    this.stopPing();
    if (this.opts.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!this.pongSeen) {
        // The previous ping went unanswered: the link is dead.
        ws.terminate();
        return;
      }
      this.pongSeen = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }, this.opts.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  // --- Outgoing calls ---

  private pump() {
    if (this.inFlight || this.outbox.length === 0) return;
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const call = this.outbox.shift()!;
    this.inFlight = call;
    call.timer = setTimeout(() => {
      if (this.inFlight !== call) return;
      this.inFlight = undefined;
      call.reject(new OcppTimeoutError(call.action));
      this.pump();
    }, call.timeoutMs);
    this.frame(
      'out',
      MessageType.CALL,
      call.action,
      call.messageId,
      call.payload,
    );
    ws.send(
      JSON.stringify([
        MessageType.CALL,
        call.messageId,
        call.action,
        call.payload,
      ]),
    );
  }

  private settle(messageId: string, fn: (call: OutgoingCall) => void) {
    const call = this.inFlight;
    if (!call || call.messageId !== messageId) return;
    this.inFlight = undefined;
    if (call.timer) clearTimeout(call.timer);
    fn(call);
    this.pump();
  }

  private failAll() {
    const calls = [...(this.inFlight ? [this.inFlight] : []), ...this.outbox];
    this.inFlight = undefined;
    this.outbox.length = 0;
    for (const call of calls) {
      if (call.timer) clearTimeout(call.timer);
      call.reject(new NotConnectedError(call.action));
    }
  }

  // --- Incoming frames ---

  private onMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.emit('malformed', raw);
      return;
    }
    if (!Array.isArray(parsed) || typeof parsed[1] !== 'string') {
      this.emit('malformed', raw);
      return;
    }
    const msg = parsed as unknown[];
    const messageId = msg[1] as string;
    const text = (value: unknown, fallback: string) =>
      typeof value === 'string' ? value : fallback;
    const action =
      this.inFlight?.messageId === messageId ? this.inFlight.action : '';

    switch (msg[0]) {
      case MessageType.CALL:
        void this.onCall(messageId, msg[2], msg[3]);
        break;
      case MessageType.CALLRESULT: {
        const payload = msg[2] ?? {};
        this.frame('in', MessageType.CALLRESULT, action, messageId, payload);
        this.settle(messageId, (call) => call.resolve(payload));
        break;
      }
      case MessageType.CALLERROR: {
        const code = text(msg[2], 'GenericError');
        const description = text(msg[3], '');
        const details = msg[4] ?? {};
        this.frame('in', MessageType.CALLERROR, action, messageId, {
          errorCode: code,
          errorDescription: description,
          errorDetails: details,
        });
        this.settle(messageId, (call) =>
          call.reject(
            new OcppCallError(call.action, code, description, details),
          ),
        );
        break;
      }
      default:
        this.emit('malformed', raw);
    }
  }

  private async onCall(messageId: string, action: unknown, payload: unknown) {
    const name = typeof action === 'string' ? action : '';
    this.frame('in', MessageType.CALL, name, messageId, payload ?? {});
    if (!name) {
      this.respondError(
        name,
        messageId,
        'FormationViolation',
        'CALL without an action',
      );
      return;
    }
    if (
      payload != null &&
      (typeof payload !== 'object' || Array.isArray(payload))
    ) {
      this.respondError(
        name,
        messageId,
        'FormationViolation',
        'Payload must be a JSON object',
      );
      return;
    }
    const handler = this.handlers.get(name);
    if (!handler) {
      this.respondError(
        name,
        messageId,
        'NotImplemented',
        `Action ${name} is not implemented`,
      );
      return;
    }
    this.activeHandlers++;
    try {
      const result = await handler(
        (payload ?? {}) as Record<string, unknown>,
        messageId,
      );
      if (result !== NO_REPLY) this.respond(name, messageId, result);
    } catch (err) {
      if (err instanceof OcppError) {
        this.respondError(name, messageId, err.code, err.message, err.details);
      } else {
        this.respondError(
          name,
          messageId,
          'InternalError',
          (err as Error).message,
        );
      }
    } finally {
      this.activeHandlers--;
    }
  }

  /** Answer an incoming CALL with a CALLRESULT. */
  respond(action: string, messageId: string, payload: unknown) {
    this.frame('out', MessageType.CALLRESULT, action, messageId, payload ?? {});
    this.sendRaw([MessageType.CALLRESULT, messageId, payload ?? {}]);
  }

  /** Answer an incoming CALL with a CALLERROR. */
  respondError(
    action: string,
    messageId: string,
    code: string,
    description: string,
    details: Record<string, unknown> = {},
  ) {
    this.frame('out', MessageType.CALLERROR, action, messageId, {
      errorCode: code,
      errorDescription: description,
      errorDetails: details,
    });
    this.sendRaw([
      MessageType.CALLERROR,
      messageId,
      code,
      description,
      details,
    ]);
  }

  private sendRaw(frame: unknown[]) {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  private frame(
    direction: 'in' | 'out',
    messageType: MessageType,
    action: string,
    messageId: string,
    payload: unknown,
  ) {
    const event: FrameEvent = {
      direction,
      messageType,
      action,
      messageId,
      payload,
    };
    this.emit('frame', event);
  }
}
