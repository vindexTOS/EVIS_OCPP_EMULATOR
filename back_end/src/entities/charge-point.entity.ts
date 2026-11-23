import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { Availability, DiagnosticsStatus, FirmwareStatus } from './enums';

/** How the charger answers one CSMS request, when the tester wants it to misbehave. */
export interface ResponseOverride {
  /**
   * status – answer with this `status` value and do nothing
   * error  – answer with a CALLERROR
   * silent – never answer (the CSMS runs into its timeout)
   */
  mode: 'status' | 'error' | 'silent';
  status?: string;
  errorCode?: string;
  /** Apply once, then go back to normal behaviour. */
  once?: boolean;
}

export type FullBatteryBehavior = 'auto' | 'suspend' | 'stop';
export type AutoStartMode = 'off' | 'plug';
export type DataTransferMode =
  | 'vendor'
  | 'Accepted'
  | 'Rejected'
  | 'UnknownMessageId'
  | 'UnknownVendorId';

@Entity({ name: 'charge_points' })
export class ChargePoint extends BaseEntity {
  @Column()
  name: string;

  /** OCPP charge point identity: the last segment of the WebSocket URL. */
  @Index({ unique: true })
  @Column()
  chargePointId: string;

  // --- Nameplate (BootNotification) ---
  @Column({ default: 'EVIS' })
  vendor: string;

  @Column({ default: 'Emulator' })
  model: string;

  @Column({ default: '' })
  serialNumber: string;

  @Column({ default: '' })
  chargeBoxSerialNumber: string;

  @Column({ default: '1.0.0' })
  firmwareVersion: string;

  @Column({ default: '' })
  iccid: string;

  @Column({ default: '' })
  imsi: string;

  @Column({ default: '' })
  meterType: string;

  @Column({ default: '' })
  meterSerialNumber: string;

  // --- Connection ---
  @Column({ default: '' })
  csmsUrl: string;

  /** Append `/<chargePointId>` to the URL, as OCPP-J chargers do. */
  @Column({ default: true })
  appendIdToUrl: boolean;

  /** Basic Auth user name. Empty means: the charge point identity. */
  @Column({ default: '' })
  basicAuthUser: string;

  /** Basic Auth password, i.e. the OCPP AuthorizationKey. Empty means: no auth header. */
  @Column({ default: '' })
  basicAuthPassword: string;

  /** Verify the server certificate on wss:// links. */
  @Column({ default: true })
  tlsVerify: boolean;

  @Column({ type: 'text', default: '' })
  tlsCaCert: string;

  @Column({ type: 'text', default: '' })
  tlsClientCert: string;

  @Column({ type: 'text', default: '' })
  tlsClientKey: string;

  @Column({ default: '1.6' })
  ocppVersion: string;

  // --- Behaviour ---
  /** idTag used by the Start button, auto-start and when no card is chosen. */
  @Column({ default: 'EMULATOR' })
  defaultIdTag: string;

  @Column({ type: 'varchar', default: 'off' })
  autoStart: AutoStartMode;

  @Column({ type: 'varchar', default: 'auto' })
  fullBatteryBehavior: FullBatteryBehavior;

  /** Energy flows this many times faster than wall-clock time. */
  @Column({ default: 1 })
  speed: number;

  @Column({ default: true })
  bootOnReconnect: boolean;

  /** Seconds the charger stays dark while it restarts. */
  @Column({ default: 5 })
  rebootSeconds: number;

  /** Report per-phase currents and voltages in MeterValues (AC connectors). */
  @Column({ default: false })
  perPhaseMeterValues: boolean;

  @Column({ default: false })
  securityEvents: boolean;

  @Column({ type: 'varchar', default: 'vendor' })
  dataTransferMode: DataTransferMode;

  // --- Test switches ---
  @Column({ type: 'simple-json', nullable: true })
  responseOverrides: Record<string, ResponseOverride> | null;

  @Column({ type: 'varchar', default: 'none' })
  firmwareFailure: 'none' | 'download' | 'install';

  @Column({ default: false })
  diagnosticsFailure: boolean;

  @Column({ default: false })
  unlockFailure: boolean;

  // --- State that survives a restart ---
  @Column({ default: false })
  poweredOn: boolean;

  @Column({ default: true })
  networkUp: boolean;

  @Column({ type: 'varchar', default: 'Operative' })
  availability: Availability;

  /** OCPP configuration keys (values only; the catalogue lives in code). */
  @Column({ type: 'simple-json' })
  configuration: Record<string, string>;

  @Column({ default: 0 })
  localListVersion: number;

  @Column({ type: 'varchar', default: 'Idle' })
  firmwareStatus: FirmwareStatus;

  @Column({ type: 'varchar', default: 'Idle' })
  diagnosticsStatus: DiagnosticsStatus;

  /** Set while a firmware install waits for the reboot to report "Installed". */
  @Column({ default: false })
  firmwareInstalledPending: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastBootAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastHeartbeatAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastConnectedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastDisconnectedAt: Date | null;
}
