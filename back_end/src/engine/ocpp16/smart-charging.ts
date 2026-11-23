import type {
  ChargingProfile,
  ProfilePurpose,
} from '../../entities/charging-profile.entity';

// Pure smart-charging maths: which profile applies at an instant, and where a
// profile's limit can change inside a time window.

const DAY_MS = 86_400_000;

export interface ActiveLimit {
  limit: number;
  unit: 'A' | 'W';
  numberPhases?: number;
  minChargingRate?: number;
  profileId: number;
  stackLevel: number;
  purpose: ProfilePurpose;
}

type Profile = Pick<
  ChargingProfile,
  | 'chargingProfileId'
  | 'stackLevel'
  | 'purpose'
  | 'kind'
  | 'recurrencyKind'
  | 'validFrom'
  | 'validTo'
  | 'schedule'
  | 'installedAt'
>;

const ms = (d: Date | string | null | undefined): number | null => {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(t) ? null : t;
};

function recurrenceMs(profile: Profile): number {
  return (profile.recurrencyKind === 'Weekly' ? 7 : 1) * DAY_MS;
}

/**
 * Start of the schedule occurrence that is running at `t`, or null when none is.
 * Absolute  – startSchedule (the moment the profile arrived when it is absent)
 * Relative  – the start of the transaction (the moment the profile arrived when
 *             there is no transaction)
 * Recurring – startSchedule shifted by whole days or weeks
 */
export function occurrenceStart(
  profile: Profile,
  t: number,
  sessionStart: number | null,
): number | null {
  const installed = profile.installedAt.getTime();
  switch (profile.kind) {
    case 'Relative':
      return sessionStart ?? installed;
    case 'Recurring': {
      const first = ms(profile.schedule.startSchedule) ?? installed;
      if (t < first) return null;
      const period = recurrenceMs(profile);
      return first + Math.floor((t - first) / period) * period;
    }
    default:
      return ms(profile.schedule.startSchedule) ?? installed;
  }
}

function isValidAt(profile: Profile, t: number): boolean {
  const from = ms(profile.validFrom);
  const to = ms(profile.validTo);
  if (from !== null && t < from) return false;
  if (to !== null && t >= to) return false;
  return true;
}

/** The limit this profile imposes at `t`, or null when it is silent then. */
export function profileLimitAt(
  profile: Profile,
  t: number,
  sessionStart: number | null,
): ActiveLimit | null {
  if (!isValidAt(profile, t)) return null;
  const start = occurrenceStart(profile, t, sessionStart);
  if (start === null || t < start) return null;
  const elapsed = (t - start) / 1000;
  const {
    duration,
    chargingSchedulePeriod,
    chargingRateUnit,
    minChargingRate,
  } = profile.schedule;
  if (duration != null && duration > 0 && elapsed >= duration) return null;

  let current: (typeof chargingSchedulePeriod)[number] | undefined;
  for (const period of chargingSchedulePeriod) {
    if (period.startPeriod <= elapsed) {
      if (!current || period.startPeriod >= current.startPeriod)
        current = period;
    }
  }
  if (!current) return null;
  return {
    limit: current.limit,
    unit: chargingRateUnit,
    numberPhases: current.numberPhases,
    minChargingRate,
    profileId: profile.chargingProfileId,
    stackLevel: profile.stackLevel,
    purpose: profile.purpose,
  };
}

/** Of several profiles with the same purpose, the highest stack level that speaks at `t` wins. */
export function selectLimit(
  profiles: Profile[],
  t: number,
  sessionStart: number | null,
): ActiveLimit | null {
  let best: ActiveLimit | null = null;
  for (const profile of profiles) {
    const limit = profileLimitAt(profile, t, sessionStart);
    if (limit && (!best || limit.stackLevel > best.stackLevel)) best = limit;
  }
  return best;
}

/** Instants inside (from, to) at which this profile's limit may change. */
export function breakpoints(
  profile: Profile,
  from: number,
  to: number,
  sessionStart: number | null,
): number[] {
  const points: number[] = [];
  const add = (t: number | null) => {
    if (t !== null && t > from && t < to) points.push(t);
  };
  add(ms(profile.validFrom));
  add(ms(profile.validTo));

  const addOccurrence = (start: number) => {
    for (const period of profile.schedule.chargingSchedulePeriod) {
      add(start + period.startPeriod * 1000);
    }
    if (profile.schedule.duration)
      add(start + profile.schedule.duration * 1000);
  };

  if (profile.kind === 'Recurring') {
    const first =
      ms(profile.schedule.startSchedule) ?? profile.installedAt.getTime();
    const period = recurrenceMs(profile);
    let start =
      first + Math.max(0, Math.floor((from - first) / period)) * period;
    // Bounded: a composite schedule never spans more than a few occurrences.
    for (let i = 0; i < 400 && start < to; i++, start += period)
      addOccurrence(start);
  } else {
    const start = occurrenceStart(profile, from, sessionStart);
    if (start !== null) addOccurrence(start);
  }
  return points;
}
