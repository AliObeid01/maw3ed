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
}

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
            status: { in: [...BLOCKING_STATUSES] },
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
};
