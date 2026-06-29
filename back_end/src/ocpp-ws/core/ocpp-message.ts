export enum MessageType {
  CALL = 2,
  CALLRESULT = 3,
  CALLERROR = 4,
}

export type OcppCall = [MessageType.CALL, string, string, unknown];
export type OcppResult = [MessageType.CALLRESULT, string, unknown];
export type OcppError = [
  MessageType.CALLERROR,
  string,
  string,
  string,
  unknown,
];
export type OcppMessage = OcppCall | OcppResult | OcppError;

export const OcppErrorCode = {
  NotImplemented: 'NotImplemented',
  NotSupported: 'NotSupported',
  InternalError: 'InternalError',
  ProtocolError: 'ProtocolError',
  FormationViolation: 'FormationViolation',
  GenericError: 'GenericError',
} as const;
