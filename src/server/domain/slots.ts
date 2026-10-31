import { DateTime, IANAZone } from 'luxon';

/** Weekday numbering: 0 = Sunday, 1 = Monday ... 6 = Saturday (matches JS `getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WeeklyInterval {
  weekday: Weekday;
  /** Local wall time 'HH:mm'. '24:00' is allowed for an end and means the next local midnight. */
  startLocal: string;
  endLocal: string;
}

export interface UtcInterval {
  startAt: Date;
  endAt: Date;
}

export interface BusyInterval {
  startAt: Date;
  /** End of the appointment plus its buffer. */
  blockedUntil: Date;
}

export interface StaffAvailability {
  id: string;
  weeklyHours: WeeklyInterval[];
  timeOff: UtcInterval[];
  busy: BusyInterval[];
}

export interface GenerateSlotsInput {
  service: { durationMin: number; bufferMin: number };
  staff: StaffAvailability[];
  slotStepMin: number;
  minNoticeMin: number;
  bookingWindowDays: number;
  /** IANA zone, e.g. Asia/Beirut. */
  timezone: string;
  now: Date;
  /** Inclusive local dates 'yyyy-MM-dd'. */
  range: { from: string; to: string };
}

export interface Slot {
  startAt: Date;
  endAt: Date;
  blockedUntil: Date;
  staffId: string;
}

export interface AnyoneSlot {
  startAt: Date;
  endAt: Date;
  blockedUntil: Date;
  candidateStaffIds: string[];
}

const MIN_MS = 60_000;

type Range = [number, number];

/** Locale-independent ordering so output is deterministic everywhere. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const hmCache = new Map<string, { hour: number; minute: number }>();

function parseHm(value: string): { hour: number; minute: number } {
  const hit = hmCache.get(value);
  if (hit) return hit;
  const parsed = parseHmUncached(value);
  if (hmCache.size > 2000) hmCache.clear();
  hmCache.set(value, parsed);
  return parsed;
}

function parseHmUncached(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid local time: ${value}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0))
    throw new Error(`Invalid local time: ${value}`);
  return { hour, minute };
}

const zoneCache = new Map<string, IANAZone>();

const HOUR_MS = 3_600_000;
/** zone -> (hour bucket -> offset in ms). Pure memo of an immutable tz database; bounded. */
const offsetBuckets = new Map<string, Map<number, number>>();
const MAX_BUCKETS_PER_ZONE = 60_000;

function zoneFor(zone: string): IANAZone {
  let z = zoneCache.get(zone);
  if (!z) {
    z = IANAZone.create(zone);
    zoneCache.set(zone, z);
  }
  return z;
}

/**
 * Zone offset at an instant, in ms. IANAZone.offset formats through Intl on every call (tens of
 * microseconds) and slot generation asks thousands of times per request. Offsets only change at a
 * transition and no zone has two transitions inside one hour, so an hour bucket whose first and last
 * millisecond agree has one constant offset and is memoised. A bucket that contains a transition is never
 * cached: those answers come straight from Luxon, exactly as before.
 */
function offsetMs(zone: string, ms: number): number {
  const z = zoneFor(zone);
  const bucket = Math.floor(ms / HOUR_MS);
  let buckets = offsetBuckets.get(zone);
  if (!buckets) {
    buckets = new Map();
    offsetBuckets.set(zone, buckets);
  }
  const hit = buckets.get(bucket);
  if (hit !== undefined) return hit;
  const first = z.offset(bucket * HOUR_MS) * MIN_MS;
  const last = z.offset((bucket + 1) * HOUR_MS - 1) * MIN_MS;
  if (first !== last) return z.offset(ms) * MIN_MS;
  if (buckets.size >= MAX_BUCKETS_PER_ZONE) buckets.clear();
  buckets.set(bucket, first);
  return first;
}

/**
 * Local wall time -> UTC epoch ms.
 * - A wall time that does not exist (spring forward) moves forward (Luxon default).
 * - A repeated wall time (fall back) resolves to the EARLIER instant (first occurrence).
 * Luxon alone picks the later occurrence for repeated times, so we resolve explicitly.
 */
export function localToUtcMs(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  zone: string,
): number {
  // Roll the calendar date first ('24:00' = next local midnight); plus({days}) after resolving a
  // nonexistent midnight would carry the forward shift into the next day.
  let { year, month, day } = date;
  if (hour >= 24) {
    const next = DateTime.utc(year, month, day).plus({ days: 1 });
    ({ year, month, day } = next);
    hour -= 24;
  }
  const base = DateTime.fromObject({ year, month, day, hour, minute }, { zone });
  const luxonMs = base.toMillis();
  const localAsUtc = Date.UTC(base.year, base.month - 1, base.day, base.hour, base.minute);
  const offsets = new Set([
    offsetMs(zone, luxonMs - 86_400_000),
    offsetMs(zone, luxonMs + 86_400_000),
  ]);
  let best: number | null = null;
  for (const o of offsets) {
    const t = localAsUtc - o;
    if (offsetMs(zone, t) === o && (best === null || t < best)) best = t;
  }
  return best ?? luxonMs;
}

const localUtcCache = new Map<string, number>();
const MAX_LOCAL_UTC_ENTRIES = 20_000;

function subtract(free: Range[], cut: Range): Range[] {
  if (cut[1] <= cut[0]) return free; // empty or inverted ranges block nothing
  const out: Range[] = [];
  for (const [s, e] of free) {
    if (cut[1] <= s || cut[0] >= e) {
      out.push([s, e]);
      continue;
    }
    if (cut[0] > s) out.push([s, cut[0]]);
    if (cut[1] < e) out.push([cut[1], e]);
  }
  return out;
}

function alignToLocalGrid(ms: number, stepMin: number, zone: string): number {
  const step = stepMin * MIN_MS;
  const local = ms + offsetMs(zone, ms);
  const rem = ((local % step) + step) % step;
  return rem === 0 ? ms : ms + (step - rem);
}

/** Generates bookable slots for each staff member (pure; `now` is injected). */
export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const { service, slotStepMin, minNoticeMin, timezone, now } = input;
  // The step grid is anchored at local midnight; a step that does not divide the day would drift between days.
  if (!Number.isInteger(slotStepMin) || slotStepMin <= 0 || 1440 % slotStepMin !== 0) {
    throw new Error('slotStepMin must be a positive integer that divides 1440');
  }
  if (slotStepMin <= 0) throw new Error('slotStepMin must be positive');
  const needMs = (service.durationMin + service.bufferMin) * MIN_MS;
  const earliest = now.getTime() + minNoticeMin * MIN_MS;
  const windowEnd = DateTime.fromMillis(now.getTime(), { zone: timezone })
    .plus({ days: input.bookingWindowDays })
    .toMillis();

  const first = DateTime.fromISO(input.range.from, { zone: 'utc' });
  const last = DateTime.fromISO(input.range.to, { zone: 'utc' });
  if (!first.isValid || !last.isValid) throw new Error('Invalid range dates');

  // Staff share dates and hours, so local->UTC conversions are memoised (module level, bounded).
  const toUtc = (d: { year: number; month: number; day: number }, hour: number, minute: number) => {
    const key = `${timezone}|${d.year}-${d.month}-${d.day}-${hour}-${minute}`;
    let ms = localUtcCache.get(key);
    if (ms === undefined) {
      ms = localToUtcMs(d, hour, minute, timezone);
      if (localUtcCache.size >= MAX_LOCAL_UTC_ENTRIES) localUtcCache.clear();
      localUtcCache.set(key, ms);
    }
    return ms;
  };
  const stepMs = slotStepMin * MIN_MS;

  // Calendar dates are walked once for the whole call (UTC-as-calendar, so a skipped local midnight
  // cannot shift or drop a day), not once per staff member.
  const days: { weekday: Weekday; dateParts: { year: number; month: number; day: number } }[] = [];
  for (let day = first; day <= last; day = day.plus({ days: 1 }))
    days.push({
      weekday: (day.weekday % 7) as Weekday,
      dateParts: { year: day.year, month: day.month, day: day.day },
    });

  const result: Slot[] = [];
  for (const member of input.staff) {
    const seen = new Set<number>();
    // Sorted by start so each interval below scans only the cuts that can touch it.
    const unavailable: Range[] = [
      ...member.timeOff.map((t): Range => [t.startAt.getTime(), t.endAt.getTime()]),
      ...member.busy.map((b): Range => [b.startAt.getTime(), b.blockedUntil.getTime()]),
    ].sort((a, b) => a[0] - b[0]);
    for (const { weekday, dateParts } of days) {
      for (const wh of member.weeklyHours) {
        if (wh.weekday !== weekday) continue;
        const s = parseHm(wh.startLocal);
        const e = parseHm(wh.endLocal);
        const startMs = toUtc(dateParts, s.hour, s.minute);
        const endMs = toUtc(dateParts, e.hour, e.minute);
        if (endMs <= startMs) continue;
        let free: Range[] = [[startMs, endMs]];
        // A cut that does not overlap [startMs, endMs) changes nothing, and cutting is order-independent.
        for (const cut of unavailable) {
          if (cut[0] >= endMs) break;
          if (cut[1] > startMs) free = subtract(free, cut);
        }
        for (const [fs, fe] of free) {
          const emit = (t: number) => {
            if (t < windowEnd && !seen.has(t)) {
              seen.add(t);
              result.push({
                startAt: new Date(t),
                endAt: new Date(t + service.durationMin * MIN_MS),
                blockedUntil: new Date(t + needMs),
                staffId: member.id,
              });
            }
          };
          let t = alignToLocalGrid(Math.max(fs, earliest), slotStepMin, timezone);
          if (t + needMs > fe) continue;
          // Fast path: when the zone offset is the same at the first start, the middle and the end of the
          // free interval, no DST transition lies inside it, so every step stays on the local grid and
          // aligning again would be the identity. Step arithmetically with no Intl calls.
          // A transition inside the interval falls back to aligning every slot (the original algorithm).
          const o = offsetMs(timezone, t);
          if (offsetMs(timezone, fe) === o && offsetMs(timezone, Math.floor((t + fe) / 2)) === o) {
            for (; t + needMs <= fe; t += stepMs) emit(t);
          } else {
            while (t + needMs <= fe) {
              emit(t);
              t = alignToLocalGrid(t + stepMs, slotStepMin, timezone);
            }
          }
        }
      }
    }
  }
  return result.sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || compareIds(a.staffId, b.staffId),
  );
}

/** "Anyone": each distinct start time once, with every staff member who can take it. */
export function mergeAnyone(slotsByStaff: Slot[]): AnyoneSlot[] {
  const byStart = new Map<number, AnyoneSlot>();
  for (const slot of slotsByStaff) {
    const key = slot.startAt.getTime();
    const existing = byStart.get(key);
    if (existing) {
      if (!existing.candidateStaffIds.includes(slot.staffId))
        existing.candidateStaffIds.push(slot.staffId);
    } else {
      byStart.set(key, {
        startAt: slot.startAt,
        endAt: slot.endAt,
        blockedUntil: slot.blockedUntil,
        candidateStaffIds: [slot.staffId],
      });
    }
  }
  const merged = [...byStart.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (const m of merged) m.candidateStaffIds.sort(compareIds);
  return merged;
}

/**
 * Fairness pick: the candidate with the fewest bookings that local day; ties -> lowest staff id.
 * `bookingsThatLocalDay` maps staffId -> count (missing = 0).
 */
export function pickStaff(
  candidates: string[],
  bookingsThatLocalDay: Record<string, number>,
): string | null {
  let best: string | null = null;
  let bestCount = Infinity;
  for (const id of [...candidates].sort(compareIds)) {
    const count = bookingsThatLocalDay[id] ?? 0;
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
