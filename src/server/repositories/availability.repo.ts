import { db } from './db';

import { SLOT_HOLDING_STATUSES } from '@/server/domain/slotStatuses';

/** Statuses that block a slot: the same set as the appointment_no_overlap constraint (see slotStatuses.ts). */
export const BLOCKING_STATUSES = SLOT_HOLDING_STATUSES;

export interface AvailabilityQuery {
  serviceId: string;
  /** Restrict to one staff member; omitted = everyone who can do the service. */
  staffId?: string;
  /** UTC half-open range [rangeStart, rangeEnd). */
  rangeStart: Date;
  rangeEnd: Date;
  /** Instant used to ignore lapsed deposit holds (a PENDING_PAYMENT whose holdExpiresAt has passed). */
  now?: Date;
}

/** A lapsed deposit hold no longer blocks (see load()); a hold with no expiry keeps blocking. */
const busyStatusWhere = (now: Date | undefined) => ({
  OR: [
    { status: { in: BLOCKING_STATUSES.filter((s) => s !== 'PENDING_PAYMENT') } },
    {
      status: 'PENDING_PAYMENT' as const,
      ...(now ? { OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] } : {}),
    },
  ],
});

export const availabilityRepo = {
  /**
   * Everything slot generation needs for a range, in a fixed number of queries (service, staff, then one
   * query each for hours, time off and busy appointments), never one per staff member.
   * Returns null when the service is missing, inactive or belongs to another business.
   */
  async load(businessId: string, q: AvailabilityQuery) {
    const service = await db.service.findFirst({
      where: { id: q.serviceId, businessId, active: true },
      select: { id: true, name: true, durationMin: true, bufferMin: true, price: true },
    });
    if (!service) return null;
    const staff = await db.staffMember.findMany({
      where: {
        businessId,
        active: true,
        bookable: true,
        services: { some: { serviceId: q.serviceId, businessId } },
        ...(q.staffId ? { id: q.staffId } : {}),
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        displayName: true,
        workingHours: {
          where: { businessId },
          select: { weekday: true, startLocal: true, endLocal: true },
        },
        timeOff: {
          where: { businessId, startAt: { lt: q.rangeEnd }, endAt: { gt: q.rangeStart } },
          select: { startAt: true, endAt: true },
        },
        appointments: {
          where: {
            businessId,
            // A lapsed deposit hold no longer blocks: the booking path sweeps it (expireHoldsFor) before
            // inserting, so showing the slot free is safe. The constraint still referees any race.
            OR: [
              { status: { in: BLOCKING_STATUSES.filter((s) => s !== 'PENDING_PAYMENT') } },
              {
                status: 'PENDING_PAYMENT',
                // A hold with no expiry (should not exist) keeps blocking: never show a slot free by accident.
                ...(q.now
                  ? { OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: q.now } }] }
                  : {}),
              },
            ],
            startAt: { lt: q.rangeEnd },
            blockedUntil: { gt: q.rangeStart },
          },
          select: { startAt: true, blockedUntil: true },
        },
      },
    });
    return { service, staff };
  },

  /** Does this staff member exist in this business? (Used only to pick 400 vs 404 on a failed booking.) */
  async staffExists(businessId: string, staffId: string) {
    return (await db.staffMember.count({ where: { id: staffId, businessId } })) > 0;
  },

  /**
   * Public directory: everything slot generation needs for MANY listed businesses at once, in a fixed seven
   * statements (businesses, active services, bookable staff with their services, working hours, time off, busy
   * appointments), never one set per business. Cross-tenant on purpose and read-only: it returns only what
   * the engine needs (no names of staff, no client or appointment details beyond start / blocked-until).
   * Businesses that are not `listed` are dropped here as a second guard.
   */
  async loadMany(businessIds: string[], range: { start: Date; end: Date }, now: Date) {
    if (businessIds.length === 0) return [];
    const inIds = { in: businessIds };
    const [businesses, services, staff, hours, timeOff, busy] = await Promise.all([
      db.business.findMany({
        where: { id: inIds, listed: true },
        select: {
          id: true,
          slug: true,
          name: true,
          timezone: true,
          slotStepMin: true,
          bookingWindowDays: true,
          minNoticeMin: true,
        },
      }),
      db.service.findMany({
        where: { businessId: inIds, active: true },
        select: {
          id: true,
          businessId: true,
          name: true,
          durationMin: true,
          bufferMin: true,
          price: true,
        },
      }),
      db.staffMember.findMany({
        where: { businessId: inIds, active: true, bookable: true },
        select: { id: true, businessId: true, services: { select: { serviceId: true } } },
      }),
      db.workingHours.findMany({
        where: { businessId: inIds },
        select: {
          businessId: true,
          staffId: true,
          weekday: true,
          startLocal: true,
          endLocal: true,
        },
      }),
      db.timeOff.findMany({
        where: { businessId: inIds, startAt: { lt: range.end }, endAt: { gt: range.start } },
        select: { businessId: true, staffId: true, startAt: true, endAt: true },
      }),
      db.appointment.findMany({
        where: {
          businessId: inIds,
          ...busyStatusWhere(now),
          startAt: { lt: range.end },
          blockedUntil: { gt: range.start },
        },
        select: { businessId: true, staffId: true, startAt: true, blockedUntil: true },
      }),
    ]);
    return businesses.map((b) => ({
      business: b,
      services: services
        .filter((x) => x.businessId === b.id)
        .map((x) => ({ ...x, price: Number(x.price.toString()) })),
      staff: staff
        .filter((x) => x.businessId === b.id)
        .map((x) => ({
          id: x.id,
          serviceIds: x.services.map((l) => l.serviceId),
          hours: hours.filter((h) => h.staffId === x.id),
          timeOff: timeOff.filter((t) => t.staffId === x.id),
          busy: busy.filter((a) => a.staffId === x.id),
        })),
    }));
  },
};
