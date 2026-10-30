import { MAX_SLOT_RANGE_DAYS, resolveLocalRange } from '@/server/domain/dateRange';
import {
  generateSlots,
  mergeAnyone,
  type AnyoneSlot,
  type Slot,
  type StaffAvailability,
  type Weekday,
} from '@/server/domain/slots';
import { AppError } from '@/server/http/errors';
import { availabilityRepo } from '@/server/repositories/availability.repo';
import type { publicBusinessRepo } from '@/server/repositories/publicBusiness.repo';

export type BusinessConfig = NonNullable<Awaited<ReturnType<typeof publicBusinessRepo.findById>>>;

/** What the API returns for a slot. "Anyone" slots carry no staff id. */
export interface PublicSlot {
  startAt: string;
  endAt: string;
  staffId?: string;
}

export interface AvailabilityQuery {
  serviceId: string;
  staffId?: string | undefined;
  /** Inclusive local dates 'yyyy-MM-dd'. */
  from: string;
  to: string;
  startUtc: Date;
  endUtc: Date;
}

export interface Availability {
  service: { id: string; name: string; durationMin: number; bufferMin: number; price: unknown };
  staff: { id: string; displayName: string }[];
  /** Per-staff slots, sorted. */
  slots: Slot[];
  /** Distinct start times with every candidate staff id. */
  anyone: AnyoneSlot[];
}

/**
 * Loads the inputs for a range in a fixed number of queries and runs the pure generator with `now`
 * injected. Returns null when the service is missing or inactive. No range validation here: callers
 * decide (the public endpoint validates; the booking re-check only asks for one local day).
 */
export async function computeAvailability(
  business: BusinessConfig,
  q: AvailabilityQuery,
  now: Date,
): Promise<Availability | null> {
  const loaded = await availabilityRepo.load(business.id, {
    serviceId: q.serviceId,
    staffId: q.staffId,
    rangeStart: q.startUtc,
    rangeEnd: q.endUtc,
    now,
  });
  if (!loaded) return null;
  const staff: StaffAvailability[] = loaded.staff.map((s) => ({
    id: s.id,
    weeklyHours: s.workingHours.map((w) => ({
      weekday: w.weekday as Weekday,
      startLocal: w.startLocal,
      endLocal: w.endLocal,
    })),
    timeOff: s.timeOff,
    busy: s.appointments,
  }));
  const slots = generateSlots({
    service: loaded.service,
    staff,
    slotStepMin: business.slotStepMin,
    minNoticeMin: business.minNoticeMin,
    bookingWindowDays: business.bookingWindowDays,
    timezone: business.timezone,
    now,
    range: { from: q.from, to: q.to },
  });
  return {
    service: loaded.service,
    staff: loaded.staff.map((s) => ({ id: s.id, displayName: s.displayName })),
    slots,
    anyone: mergeAnyone(slots),
  };
}

/** API shape: a named staff member's slots, or the merged "anyone" list without staff ids. */
export function toPublicSlots(avail: Availability, staffId: string | undefined): PublicSlot[] {
  if (staffId)
    return avail.slots
      .filter((s) => s.staffId === staffId)
      .map((s) => ({
        startAt: s.startAt.toISOString(),
        endAt: s.endAt.toISOString(),
        staffId: s.staffId,
      }));
  return avail.anyone.map((s) => ({
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
  }));
}

export const availabilityService = {
  /** Public slots endpoint: validates the range (<= 31 days, within bookingWindowDays), then computes. */
  async slots(
    business: BusinessConfig,
    q: { serviceId: string; staffId?: string | undefined; from: string; to: string },
    now: Date,
  ): Promise<PublicSlot[]> {
    const range = resolveLocalRange({
      from: q.from,
      to: q.to,
      timezone: business.timezone,
      maxDays: MAX_SLOT_RANGE_DAYS,
      now,
      bookingWindowDays: business.bookingWindowDays,
    });
    if (!range.ok) throw AppError.validation(range.fields);
    const avail = await computeAvailability(
      business,
      { ...q, startUtc: range.startUtc, endUtc: range.endUtc },
      now,
    );
    if (!avail) throw AppError.notFound();
    if (q.staffId && avail.staff.length === 0) throw AppError.notFound();
    return toPublicSlots(avail, q.staffId);
  },
};
