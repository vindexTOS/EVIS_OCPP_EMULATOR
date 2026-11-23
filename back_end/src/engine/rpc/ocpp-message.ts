export enum MessageType {
  CALL = 2,
  CALLRESULT = 3,
  CALLERROR = 4,
}

/** OCPP-J 1.6 §4.2.3, Table 7. "OccurenceConstraintViolation" is the spec's own spelling. */
export type OcppErrorCode =
  | 'NotImplemented'
  | 'NotSupported'
  | 'InternalError'
  | 'ProtocolError'
  | 'SecurityError'
  | 'FormationViolation'
  | 'PropertyConstraintViolation'
  | 'OccurenceConstraintViolation'
  | 'TypeConstraintViolation'
  | 'GenericError';

/** Thrown by a request handler to answer with a CALLERROR. */
export class OcppError extends Error {
  constructor(
    public readonly code: OcppErrorCode,
    description = '',
    public readonly details: Record<string, unknown> = {},
  ) {
    super(description || code);
  }
}

/** Raised on the caller's side when the other party answered with a CALLERROR. */
export class OcppCallError extends Error {
  constructor(
    public readonly action: string,
    public readonly code: string,
    public readonly description: string,
    public readonly details: unknown,
  ) {
    super(`${action} failed: ${code}${description ? ` – ${description}` : ''}`);
  }
}

export class OcppTimeoutError extends Error {
  constructor(public readonly action: string) {
    super(`${action} timed out`);
  }
}

export class NotConnectedError extends Error {
  constructor(public readonly action: string) {
    super(`${action} not sent: the charger is not connected`);
  }
}

export interface FrameEvent {
  direction: 'in' | 'out';
  messageType: MessageType;
  action: string;
  messageId: string;
  payload: unknown;
}
