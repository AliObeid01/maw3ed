import { SLOT_HOLDING_STATUSES } from '@/server/domain/slotStatuses';
import { db } from './db';
import { clientRepo } from './client.repo';
import { reminderJobRepo, type NewReminderJob } from './reminderJob.repo';

const detailSelect = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  source: true,
  idempotencyKey: true,
  client: { select: { id: true, name: true, phone: true, noShows: true, lateCancels: true } },
  service: { select: { id: true, name: true, durationMin: true, price: true } },
  staff: { select: { id: true, displayName: true } },
} as const;

export interface NewBooking {
  serviceId: string;
  staffId: string;
  startAt: Date;
  endAt: Date;
  blockedUntil: Date;
  source: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST';
  idempotencyKey?: string | undefined;
  client: { name: string; phone: string; email?: string | undefined };
  /** True only for a session-authenticated front-desk booking: see clientRepo.upsertByPhone. */
  overwriteContact: boolean;
  reminders: NewReminderJob[];
}

/** Statuses that count towards a staff member's day for the "anyone" fairness pick. */
const COUNTED_STATUSES = [...SLOT_HOLDING_STATUSES, 'ATTENDED', 'NO_SHOW'] as const;

export const appointmentRepo = {
  findById: (businessId: string, id: string) =>
    db.appointment.findFirst({ where: { id, businessId }, select: detailSelect }),

  findByIdempotencyKey: (businessId: string, key: string) =>
    db.appointment.findFirst({ where: { businessId, idempotencyKey: key }, select: detailSelect }),

  list: (businessId: string, q: { startUtc: Date; endUtc: Date; staffId?: string | undefined }) =>
    db.appointment.findMany({
      where: {
        businessId,
        startAt: { gte: q.startUtc, lt: q.endUtc },
        ...(q.staffId ? { staffId: q.staffId } : {}),
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      select: detailSelect,
    }),

  /** staffId -> number of the staff's bookings starting in [startUtc, endUtc). One grouped query. */
  async countByStaff(businessId: string, staffIds: string[], startUtc: Date, endUtc: Date) {
    const rows = await db.appointment.groupBy({
      by: ['staffId'],
      where: {
        businessId,
        staffId: { in: staffIds },
        status: { in: [...COUNTED_STATUSES] },
        startAt: { gte: startUtc, lt: endUtc },
      },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.staffId, r._count._all])) as Record<
      string,
      number
    >;
  },

  /**
   * THE booking insert (public, front desk, later waitlist claims and deposits). One transaction: client
   * find-or-create, the appointment, and its reminder jobs. A 23P01 from appointment_no_overlap or a 23505
   * from the idempotency key aborts the whole transaction and propagates to the service.
   */
  create: (businessId: string, data: NewBooking) =>
    db.$transaction(async (tx) => {
      const client = await clientRepo.upsertByPhone(
        businessId,
        tx,
        data.client,
        data.overwriteContact,
      );
      const appointment = await tx.appointment.create({
        data: {
          businessId,
          clientId: client.id,
          staffId: data.staffId,
          serviceId: data.serviceId,
          startAt: data.startAt,
          endAt: data.endAt,
          blockedUntil: data.blockedUntil,
          status: 'BOOKED',
          source: data.source,
          idempotencyKey: data.idempotencyKey ?? null,
        },
        select: { id: true },
      });
      await reminderJobRepo.createForAppointment(businessId, tx, appointment.id, data.reminders);
      return tx.appointment.findFirstOrThrow({
        where: { id: appointment.id, businessId },
        select: detailSelect,
      });
    }),

  /**
   * Cancel by staff: CANCELLED frees the slot (drops out of the exclusion constraint) and pending reminder
   * jobs become SKIPPED, in one transaction. Returns false when the appointment is not in a cancellable
   * state (the service then decides between idempotent success and a conflict).
   */
  cancelByStaff: (businessId: string, id: string, now: Date) =>
    db.$transaction(async (tx) => {
      const res = await tx.appointment.updateMany({
        where: { id, businessId, status: { in: ['BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'] } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledVia: 'STAFF' },
      });
      if (res.count !== 1) return false;
      await reminderJobRepo.skipPending(businessId, tx, id);
      return true;
    }),
};
