import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import { createServer as createTlsServer, Server as TlsServer } from 'https';
import { WebSocket, WebSocketServer } from 'ws';
import { rawToText } from '../../src/engine/rpc/rpc-client';

export interface ReceivedCall {
  cpId: string;
  action: string;
  payload: any;
  at: number;
}

export interface MockCsmsOptions {
  port?: number;
  /** Require HTTP Basic auth with this password (user name = charge point id). */
  password?: string;
  /** Clock used for currentTime; defaults to the wall clock. */
  now?: () => number;
  /** Serve wss:// with this certificate. With `ca`, a client certificate is required. */
  tls?: { key: string; cert: string; ca?: string };
}

type Handler = (payload: any, cpId: string) => unknown;

/**
 * A small Central System for tests and manual trials.
 *
 * It accepts OCPP 1.6-J charge points on ws://host:port/<chargePointId>,
 * answers their requests with sensible defaults, remembers everything they
 * send, and can send any request back with call().
 */
export class MockCsms {
  readonly received: ReceivedCall[] = [];
  /** Upgrade requests the server saw, accepted or not. */
  readonly upgrades: {
    path: string;
    authorization?: string;
    protocols?: string;
  }[] = [];
  /** Answer to BootNotification. */
  bootStatus: 'Accepted' | 'Pending' | 'Rejected' = 'Accepted';
  bootInterval = 300;
  /** idTags that are refused; the value is the status to answer with. */
  readonly tagStatus = new Map<string, string>();
  readonly parentOf = new Map<string, string>();
  /** Actions that get no answer at all (the charger runs into its timeout). */
  readonly silent = new Set<string>();
  /** Actions answered with a CALLERROR of this code. */
  readonly failing = new Map<string, string>();
  /** Overrides for the default answers. */
  readonly handlers = new Map<string, Handler>();
  password?: string;

  private server?: WebSocketServer;
  private tlsServer?: TlsServer;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly waiting = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextTransactionId = 1;
  private readonly now: () => number;
  private port = 0;

  constructor(private readonly options: MockCsmsOptions = {}) {
    this.password = options.password;
    this.now = options.now ?? (() => Date.now());
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tls = this.options.tls;
      if (tls) {
        this.tlsServer = createTlsServer({
          key: tls.key,
          cert: tls.cert,
          ...(tls.ca
            ? { ca: tls.ca, requestCert: true, rejectUnauthorized: true }
            : {}),
        });
        this.tlsServer.on('error', reject);
        this.tlsServer.listen(this.options.port ?? 0, () => {
          this.port = (this.tlsServer!.address() as { port: number }).port;
          resolve(this.port);
        });
      }
      const server = new WebSocketServer({
        ...(this.tlsServer
          ? { server: this.tlsServer }
          : { port: this.options.port ?? 0 }),
        handleProtocols: (protocols) =>
          protocols.has('ocpp1.6') ? 'ocpp1.6' : false,
        verifyClient: (info, done) => {
          const req = info.req;
          this.upgrades.push({
            path: req.url ?? '',
            authorization: req.headers.authorization,
            protocols: req.headers['sec-websocket-protocol'],
          });
          const cpId = this.identity(req);
          if (!cpId) return done(false, 400, 'Missing charge point identity');
          if (this.password !== undefined) {
            const expected = `Basic ${Buffer.from(`${cpId}:${this.password}`).toString('base64')}`;
            if (req.headers.authorization !== expected)
              return done(false, 401, 'Unauthorized');
          }
          done(true);
        },
      });
      if (!this.tlsServer) {
        server.on('listening', () => {
          this.port = (server.address() as { port: number }).port;
          resolve(this.port);
        });
      }
      server.on('error', reject);
      server.on('connection', (socket, req) => this.onConnection(socket, req));
      this.server = server;
    });
  }

  async stop() {
    for (const socket of this.sockets.values()) socket.terminate();
    this.sockets.clear();
    for (const { reject, timer } of this.waiting.values()) {
      clearTimeout(timer);
      reject(new Error('CSMS stopped'));
    }
    this.waiting.clear();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = undefined;
    if (this.tlsServer) {
      await new Promise<void>((resolve) =>
        this.tlsServer!.close(() => resolve()),
      );
      this.tlsServer = undefined;
    }
  }

  /** Base URL (no identity), or the full URL of one charge point. */
  url(cpId?: string) {
    const base = this.options.tls
      ? `wss://localhost:${this.port}`
      : `ws://127.0.0.1:${this.port}`;
    return `${base}${cpId ? `/${cpId}` : ''}`;
  }

  connected(cpId: string) {
    return this.sockets.get(cpId)?.readyState === WebSocket.OPEN;
  }

  /** Cut a charge point's socket without a close frame. */
  drop(cpId: string) {
    this.sockets.get(cpId)?.terminate();
  }

  /** Close a charge point's socket politely. */
  close(cpId: string, code = 1012) {
    this.sockets.get(cpId)?.close(code);
  }

  /** Payloads of everything received, optionally only one action. */
  messages(action?: string, cpId?: string): any[] {
    return this.received
      .filter(
        (m) => (!action || m.action === action) && (!cpId || m.cpId === cpId),
      )
      .map((m) => m.payload);
  }

  actions(cpId?: string): string[] {
    return this.received
      .filter((m) => !cpId || m.cpId === cpId)
      .map((m) => m.action);
  }

  last(action: string, cpId?: string): any {
    const all = this.messages(action, cpId);
    return all[all.length - 1];
  }

  clear() {
    this.received.length = 0;
  }

  /** Send a request to a charge point and wait for its answer. */
  call(
    cpId: string,
    action: string,
    payload: unknown = {},
    timeoutMs = 5000,
  ): Promise<any> {
    const socket = this.sockets.get(cpId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`${cpId} is not connected`));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${action} to ${cpId} timed out`));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify([2, id, action, payload]));
    });
  }

  /** Send a raw text frame, for malformed-message tests. */
  sendRaw(cpId: string, text: string) {
    this.sockets.get(cpId)?.send(text);
  }

  private identity(req: IncomingMessage): string {
    const path = (req.url ?? '').split('?')[0];
    const segments = path.split('/').filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] ?? '');
  }

  private onConnection(socket: WebSocket, req: IncomingMessage) {
    const cpId = this.identity(req);
    this.sockets.get(cpId)?.terminate();
    this.sockets.set(cpId, socket);
    socket.on('close', () => {
      if (this.sockets.get(cpId) === socket) this.sockets.delete(cpId);
    });
    socket.on('error', () => undefined);
    socket.on('message', (data) =>
      this.onMessage(cpId, socket, rawToText(data)),
    );
  }

  private onMessage(cpId: string, socket: WebSocket, raw: string) {
    let frame: any[];
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    const [type, id] = frame;
    if (type === 3 || type === 4) {
      const waiter = this.waiting.get(id);
      if (!waiter) return;
      this.waiting.delete(id);
      clearTimeout(waiter.timer);
      if (type === 3) waiter.resolve(frame[2]);
      else {
        const error = new Error(`${frame[2]}: ${frame[3]}`) as Error & {
          code?: string;
        };
        error.code = frame[2];
        waiter.reject(error);
      }
      return;
    }
    if (type !== 2) return;
    const action: string = frame[2];
    const payload = frame[3] ?? {};
    this.received.push({ cpId, action, payload, at: this.now() });
    if (this.silent.has(action)) return;
    const failure = this.failing.get(action);
    if (failure) {
      socket.send(JSON.stringify([4, id, failure, 'Simulated failure', {}]));
      return;
    }
    const handler = this.handlers.get(action);
    const result = handler
      ? handler(payload, cpId)
      : this.defaultAnswer(action, payload);
    if (result === undefined) {
      socket.send(
        JSON.stringify([
          4,
          id,
          'NotImplemented',
          `Unknown action ${action}`,
          {},
        ]),
      );
      return;
    }
    socket.send(JSON.stringify([3, id, result]));
  }

  private idTagInfo(idTag: string) {
    const parentIdTag = this.parentOf.get(idTag);
    return {
      status: this.tagStatus.get(idTag) ?? 'Accepted',
      ...(parentIdTag ? { parentIdTag } : {}),
    };
  }

  private defaultAnswer(action: string, payload: any): unknown {
    const currentTime = new Date(this.now()).toISOString();
    switch (action) {
      case 'BootNotification':
        return {
          status: this.bootStatus,
          currentTime,
          interval: this.bootInterval,
        };
      case 'Heartbeat':
        return { currentTime };
      case 'Authorize':
        return { idTagInfo: this.idTagInfo(payload.idTag) };
      case 'StartTransaction':
        return {
          transactionId: this.nextTransactionId++,
          idTagInfo: this.idTagInfo(payload.idTag),
        };
      case 'StopTransaction':
        return payload.idTag
          ? { idTagInfo: this.idTagInfo(payload.idTag) }
          : {};
      case 'DataTransfer':
        return { status: 'Accepted' };
      case 'SignCertificate':
        return { status: 'Accepted' };
      case 'StatusNotification':
      case 'MeterValues':
      case 'DiagnosticsStatusNotification':
      case 'FirmwareStatusNotification':
      case 'SecurityEventNotification':
      case 'LogStatusNotification':
      case 'SignedFirmwareStatusNotification':
        return {};
      default:
        return undefined;
    }
  }
}
