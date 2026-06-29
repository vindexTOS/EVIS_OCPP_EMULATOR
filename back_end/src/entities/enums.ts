export enum ConnectorType {
  Type1 = 'Type1',
  Type2 = 'Type2',
  CCS1 = 'CCS1',
  CCS2 = 'CCS2',
  CHAdeMO = 'CHAdeMO',
  GBT = 'GBT',
  Domestic = 'Domestic',
}

export enum OcppConnectorStatus {
  Available = 'Available',
  Preparing = 'Preparing',
  Charging = 'Charging',
  SuspendedEVSE = 'SuspendedEVSE',
  SuspendedEV = 'SuspendedEV',
  Finishing = 'Finishing',
  Reserved = 'Reserved',
  Unavailable = 'Unavailable',
  Faulted = 'Faulted',
}

export enum ChargePointStatus {
  Offline = 'Offline',
  Connecting = 'Connecting',
  Online = 'Online',
  Faulted = 'Faulted',
}

export enum SessionStatus {
  Active = 'Active',
  Stopped = 'Stopped',
}
