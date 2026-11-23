// The OCPP 1.6 configuration keys this charger knows (spec §9, plus the keys of
// the 1.6 security extension), with the same read-only / read-write split a real
// charger has.

export type ConfigValueType = 'boolean' | 'integer' | 'string' | 'csl';
export type ConfigProfile =
  | 'Core'
  | 'LocalAuthListManagement'
  | 'Reservation'
  | 'SmartCharging'
  | 'Security'
  | 'Vendor';

export interface ConfigKeyDef {
  key: string;
  profile: ConfigProfile;
  type: ConfigValueType;
  readonly: boolean;
  default: string;
  description: string;
  unit?: string;
  min?: number;
  max?: number;
  /** Allowed members of a CSL, or allowed values of a string. */
  allowed?: readonly string[];
  /** Never returned by GetConfiguration (AuthorizationKey). */
  writeOnly?: boolean;
  /** The value is computed from the hardware, not stored. */
  dynamic?: boolean;
}

/** Measurands this charger can actually measure. */
export const SUPPORTED_MEASURANDS = [
  'Energy.Active.Import.Register',
  'Energy.Active.Import.Interval',
  'Power.Active.Import',
  'Power.Offered',
  'Power.Factor',
  'Current.Import',
  'Current.Offered',
  'Voltage',
  'Frequency',
  'SoC',
  'Temperature',
] as const;

export const FEATURE_PROFILES = [
  'Core',
  'FirmwareManagement',
  'LocalAuthListManagement',
  'Reservation',
  'SmartCharging',
  'RemoteTrigger',
] as const;

const bool = (
  key: string,
  profile: ConfigProfile,
  readonly: boolean,
  def: boolean,
  description: string,
): ConfigKeyDef => ({
  key,
  profile,
  type: 'boolean',
  readonly,
  default: String(def),
  description,
});

const int = (
  key: string,
  profile: ConfigProfile,
  readonly: boolean,
  def: number,
  description: string,
  extra: Partial<ConfigKeyDef> = {},
): ConfigKeyDef => ({
  key,
  profile,
  type: 'integer',
  readonly,
  default: String(def),
  description,
  min: 0,
  ...extra,
});

const measurands = (
  key: string,
  def: string,
  description: string,
): ConfigKeyDef => ({
  key,
  profile: 'Core',
  type: 'csl',
  readonly: false,
  default: def,
  description,
  allowed: SUPPORTED_MEASURANDS,
});

export const CONFIG_KEYS: ConfigKeyDef[] = [
  // --- Core ---
  bool(
    'AllowOfflineTxForUnknownId',
    'Core',
    false,
    false,
    'Start a transaction for an unknown idTag while offline',
  ),
  bool(
    'AuthorizationCacheEnabled',
    'Core',
    false,
    true,
    'Remember idTags the CSMS has answered for',
  ),
  bool(
    'AuthorizeRemoteTxRequests',
    'Core',
    false,
    false,
    'Send Authorize before starting a RemoteStartTransaction',
  ),
  int(
    'BlinkRepeat',
    'Core',
    false,
    0,
    'Number of times the lights blink when signalling',
  ),
  int(
    'ClockAlignedDataInterval',
    'Core',
    false,
    0,
    'Clock-aligned MeterValues period; 0 turns them off',
    { unit: 's' },
  ),
  int(
    'ConnectionTimeOut',
    'Core',
    false,
    60,
    'How long an authorized user may take to plug in',
    { unit: 's' },
  ),
  {
    key: 'ConnectorPhaseRotation',
    profile: 'Core',
    type: 'csl',
    readonly: false,
    default: '',
    description: 'Phase rotation per connector',
    dynamic: true,
  },
  int(
    'ConnectorPhaseRotationMaxLength',
    'Core',
    true,
    0,
    'Maximum number of items in ConnectorPhaseRotation',
    { dynamic: true },
  ),
  int(
    'GetConfigurationMaxKeys',
    'Core',
    true,
    100,
    'Maximum number of keys in one GetConfiguration request',
  ),
  int('HeartbeatInterval', 'Core', false, 60, 'Period of Heartbeat messages', {
    unit: 's',
    min: 1,
  }),
  int('LightIntensity', 'Core', false, 100, 'Brightness of the lights', {
    unit: '%',
    max: 100,
  }),
  bool(
    'LocalAuthorizeOffline',
    'Core',
    false,
    true,
    'Use the local list and cache while offline',
  ),
  bool(
    'LocalPreAuthorize',
    'Core',
    false,
    false,
    'Start on a local list or cache hit without waiting for Authorize',
  ),
  int(
    'MaxEnergyOnInvalidId',
    'Core',
    false,
    0,
    'Energy delivered after the CSMS rejects the idTag of a running transaction',
    { unit: 'Wh' },
  ),
  measurands(
    'MeterValuesAlignedData',
    'Energy.Active.Import.Register',
    'Measurands in clock-aligned MeterValues',
  ),
  int(
    'MeterValuesAlignedDataMaxLength',
    'Core',
    true,
    SUPPORTED_MEASURANDS.length,
    'Maximum number of items in MeterValuesAlignedData',
  ),
  measurands(
    'MeterValuesSampledData',
    'Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage,SoC',
    'Measurands in the periodic MeterValues of a transaction',
  ),
  int(
    'MeterValuesSampledDataMaxLength',
    'Core',
    true,
    SUPPORTED_MEASURANDS.length,
    'Maximum number of items in MeterValuesSampledData',
  ),
  int(
    'MeterValueSampleInterval',
    'Core',
    false,
    15,
    'Period of MeterValues during a transaction; 0 turns them off',
    { unit: 's' },
  ),
  int(
    'MinimumStatusDuration',
    'Core',
    false,
    0,
    'A status must last this long before it is reported',
    { unit: 's' },
  ),
  int('NumberOfConnectors', 'Core', true, 0, 'Number of physical connectors', {
    dynamic: true,
  }),
  int(
    'ResetRetries',
    'Core',
    false,
    3,
    'Number of times to retry an unsuccessful reset',
  ),
  bool(
    'StopTransactionOnEVSideDisconnect',
    'Core',
    false,
    true,
    'Stop the transaction when the cable is pulled from the car',
  ),
  bool(
    'StopTransactionOnInvalidId',
    'Core',
    false,
    true,
    'Stop the transaction when StartTransaction.conf rejects the idTag',
  ),
  measurands(
    'StopTxnAlignedData',
    '',
    'Clock-aligned measurands added to StopTransaction',
  ),
  int(
    'StopTxnAlignedDataMaxLength',
    'Core',
    true,
    SUPPORTED_MEASURANDS.length,
    'Maximum number of items in StopTxnAlignedData',
  ),
  measurands(
    'StopTxnSampledData',
    '',
    'Sampled measurands added to StopTransaction',
  ),
  int(
    'StopTxnSampledDataMaxLength',
    'Core',
    true,
    SUPPORTED_MEASURANDS.length,
    'Maximum number of items in StopTxnSampledData',
  ),
  {
    key: 'SupportedFeatureProfiles',
    profile: 'Core',
    type: 'csl',
    readonly: true,
    default: FEATURE_PROFILES.join(','),
    description: 'Feature profiles this charger implements',
  },
  int(
    'SupportedFeatureProfilesMaxLength',
    'Core',
    true,
    FEATURE_PROFILES.length,
    'Maximum number of items in SupportedFeatureProfiles',
  ),
  int(
    'TransactionMessageAttempts',
    'Core',
    false,
    3,
    'How often a transaction message is retried when the CSMS fails to process it',
    { min: 1 },
  ),
  int(
    'TransactionMessageRetryInterval',
    'Core',
    false,
    60,
    'Wait between those retries',
    { unit: 's' },
  ),
  bool(
    'UnlockConnectorOnEVSideDisconnect',
    'Core',
    false,
    true,
    'Release the cable lock when the cable is pulled from the car',
  ),
  int(
    'WebSocketPingInterval',
    'Core',
    false,
    60,
    'Period of WebSocket pings; 0 turns them off',
    { unit: 's' },
  ),

  // --- Local Auth List Management ---
  bool(
    'LocalAuthListEnabled',
    'LocalAuthListManagement',
    false,
    true,
    'Use the Local Authorization List',
  ),
  int(
    'LocalAuthListMaxLength',
    'LocalAuthListManagement',
    true,
    1000,
    'Maximum number of idTags in the local list',
  ),
  int(
    'SendLocalListMaxLength',
    'LocalAuthListManagement',
    true,
    500,
    'Maximum number of idTags in one SendLocalList',
  ),

  // --- Reservation ---
  bool(
    'ReserveConnectorZeroSupported',
    'Reservation',
    true,
    true,
    'Reservations on connector 0 are accepted',
  ),

  // --- Smart Charging ---
  int(
    'ChargeProfileMaxStackLevel',
    'SmartCharging',
    true,
    10,
    'Highest stackLevel of a charging profile',
  ),
  {
    key: 'ChargingScheduleAllowedChargingRateUnit',
    profile: 'SmartCharging',
    type: 'csl',
    readonly: true,
    default: 'Current,Power',
    description: 'Units a charging schedule may use',
  },
  int(
    'ChargingScheduleMaxPeriods',
    'SmartCharging',
    true,
    24,
    'Maximum number of periods in one charging schedule',
  ),
  bool(
    'ConnectorSwitch3to1PhaseSupported',
    'SmartCharging',
    true,
    false,
    'The charger can switch between 3 and 1 phase during a transaction',
  ),
  int(
    'MaxChargingProfilesInstalled',
    'SmartCharging',
    true,
    20,
    'Maximum number of installed charging profiles',
  ),

  // --- Security extension ---
  {
    key: 'AuthorizationKey',
    profile: 'Security',
    type: 'string',
    readonly: false,
    default: '',
    description: 'Password for HTTP Basic authentication',
    writeOnly: true,
    dynamic: true,
  },
  {
    key: 'SecurityProfile',
    profile: 'Security',
    type: 'integer',
    readonly: false,
    default: '0',
    description: 'Security profile of the CSMS connection (0-3)',
    min: 0,
    max: 3,
    dynamic: true,
  },
  {
    key: 'CpoName',
    profile: 'Security',
    type: 'string',
    readonly: false,
    default: '',
    description: 'Operator name used in the charge point certificate',
  },
  bool(
    'AdditionalRootCertificateCheck',
    'Security',
    true,
    false,
    'Extra checks when a new CSMS root certificate is installed',
  ),
  int(
    'CertificateSignedMaxChainSize',
    'Security',
    true,
    10000,
    'Maximum size of the chain in CertificateSigned',
    { unit: 'bytes' },
  ),
  int(
    'CertificateStoreMaxLength',
    'Security',
    true,
    20,
    'Maximum number of certificates in the store',
  ),
];

export const CONFIG_KEY_INDEX = new Map(
  CONFIG_KEYS.map((def) => [def.key, def]),
);

/** Values a new charger starts with. */
export function defaultConfiguration(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const def of CONFIG_KEYS) {
    if (!def.dynamic) values[def.key] = def.default;
  }
  return values;
}
