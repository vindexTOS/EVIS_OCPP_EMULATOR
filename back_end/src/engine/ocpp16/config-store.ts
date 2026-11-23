import { CONFIG_KEYS, ConfigKeyDef } from './config-keys';

export type ChangeResult =
  | 'Accepted'
  | 'Rejected'
  | 'RebootRequired'
  | 'NotSupported';

/** Keys whose value lives in the charger's hardware or settings, not in the key table. */
export interface DynamicKeys {
  read(key: string): string | undefined;
  /** Return a result to handle the write, or undefined to refuse it. */
  write(key: string, value: string): ChangeResult | undefined;
}

export interface ConfigEntry extends ConfigKeyDef {
  value: string;
  /** A vendor key the tester added by hand. */
  custom: boolean;
}

const DEFS = new Map(CONFIG_KEYS.map((def) => [def.key.toLowerCase(), def]));
const PHASE_SUFFIX = /\.(L[123](-N|-L[123])?|N)$/;

/**
 * Typed access to a charger's OCPP configuration.
 *
 * Key names are case-insensitive (CiString50). Keys outside the catalogue that
 * exist in the value table are vendor keys: readable and writable strings.
 */
export class ConfigStore {
  constructor(
    private readonly values: Record<string, string>,
    private readonly dynamic: DynamicKeys,
    private readonly onChange: (key: string, value: string) => void,
  ) {}

  def(key: string): ConfigKeyDef | undefined {
    return DEFS.get(key.toLowerCase());
  }

  /** The stored spelling of a vendor key, matched case-insensitively. */
  private vendorKey(key: string): string | undefined {
    const wanted = key.toLowerCase();
    return Object.keys(this.values).find(
      (k) => k.toLowerCase() === wanted && !DEFS.has(wanted),
    );
  }

  has(key: string): boolean {
    return !!this.def(key) || this.vendorKey(key) !== undefined;
  }

  get(key: string): string {
    const def = this.def(key);
    if (!def) {
      const vendor = this.vendorKey(key);
      return vendor ? this.values[vendor] : '';
    }
    if (def.dynamic) return this.dynamic.read(def.key) ?? def.default;
    return this.values[def.key] ?? def.default;
  }

  int(key: string): number {
    const n = Number(this.get(key));
    return Number.isFinite(n) ? n : 0;
  }

  bool(key: string): boolean {
    return this.get(key).toLowerCase() === 'true';
  }

  csl(key: string): string[] {
    return this.get(key)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /** ChangeConfiguration from the CSMS. */
  change(key: string, value: string): ChangeResult {
    const def = this.def(key);
    if (!def) {
      const vendor = this.vendorKey(key);
      if (!vendor) return 'NotSupported';
      this.values[vendor] = value;
      this.onChange(vendor, value);
      return 'Accepted';
    }
    if (def.readonly) return 'Rejected';
    return this.write(def, value);
  }

  /** An edit from the charger's own service menu; read-only keys can be set too. */
  setLocal(key: string, value: string): ChangeResult {
    const def = this.def(key);
    if (!def) {
      const name = this.vendorKey(key) ?? key;
      this.values[name] = value;
      this.onChange(name, value);
      return 'Accepted';
    }
    return this.write(def, value);
  }

  removeVendorKey(key: string): boolean {
    const vendor = this.vendorKey(key);
    if (!vendor) return false;
    delete this.values[vendor];
    this.onChange(vendor, '');
    return true;
  }

  private write(def: ConfigKeyDef, raw: string): ChangeResult {
    const value = this.normalise(def, raw);
    if (value === null) return 'Rejected';
    if (def.dynamic) {
      const result = this.dynamic.write(def.key, value);
      if (result === undefined) return 'Rejected';
      if (result === 'Accepted' || result === 'RebootRequired') {
        this.onChange(def.key, value);
      }
      return result;
    }
    this.values[def.key] = value;
    this.onChange(def.key, value);
    return 'Accepted';
  }

  /** The value in canonical form, or null when it is not valid for the key. */
  private normalise(def: ConfigKeyDef, raw: string): string | null {
    const value = String(raw ?? '').trim();
    switch (def.type) {
      case 'boolean': {
        const lower = value.toLowerCase();
        return lower === 'true' || lower === 'false' ? lower : null;
      }
      case 'integer': {
        if (!/^-?\d+$/.test(value)) return null;
        const n = Number(value);
        if (def.min !== undefined && n < def.min) return null;
        if (def.max !== undefined && n > def.max) return null;
        return String(n);
      }
      case 'csl': {
        const items = value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (def.allowed) {
          const ok = items.every((item) =>
            def.allowed!.includes(item.replace(PHASE_SUFFIX, '')),
          );
          if (!ok) return null;
        }
        const maxDef = this.def(`${def.key}MaxLength`);
        if (maxDef && items.length > Number(this.get(maxDef.key))) return null;
        return items.join(',');
      }
      default:
        if (def.allowed && !def.allowed.includes(value)) return null;
        return value;
    }
  }

  /** GetConfiguration. An empty or missing key list means: everything. */
  list(keys?: string[]): {
    configurationKey: { key: string; readonly: boolean; value?: string }[];
    unknownKey: string[];
  } {
    const configurationKey: {
      key: string;
      readonly: boolean;
      value?: string;
    }[] = [];
    const unknownKey: string[] = [];
    const push = (def: ConfigKeyDef) =>
      configurationKey.push(
        def.writeOnly
          ? { key: def.key, readonly: def.readonly }
          : { key: def.key, readonly: def.readonly, value: this.get(def.key) },
      );

    if (!keys || keys.length === 0) {
      for (const def of CONFIG_KEYS) push(def);
      for (const key of Object.keys(this.values)) {
        if (!DEFS.has(key.toLowerCase())) {
          configurationKey.push({
            key,
            readonly: false,
            value: this.values[key],
          });
        }
      }
      return { configurationKey, unknownKey };
    }

    for (const key of keys) {
      const def = this.def(key);
      if (def) {
        push(def);
        continue;
      }
      const vendor = this.vendorKey(key);
      if (vendor) {
        configurationKey.push({
          key: vendor,
          readonly: false,
          value: this.values[vendor],
        });
      } else {
        unknownKey.push(key);
      }
    }
    return { configurationKey, unknownKey };
  }

  /** Everything the UI needs to render the configuration table. */
  describe(): ConfigEntry[] {
    const entries: ConfigEntry[] = CONFIG_KEYS.map((def) => ({
      ...def,
      value: this.get(def.key),
      custom: false,
    }));
    for (const key of Object.keys(this.values)) {
      if (DEFS.has(key.toLowerCase())) continue;
      entries.push({
        key,
        profile: 'Vendor',
        type: 'string',
        readonly: false,
        default: '',
        description: 'Vendor-specific key',
        value: this.values[key],
        custom: true,
      });
    }
    return entries;
  }
}
