import { SLOT_HOLDING_STATUSES } from '@/server/domain/slotStatuses';
import { Prisma } from '@/generated/prisma/client';
import { db } from './db';
import { clientRepo } from './client.repo';
import { expirePendingDeposits } from './payment.repo';
import { reminderJobRepo, type NewReminderJob } from './reminderJob.repo';
import { markClaimedIn, OFFER_KEY_PREFIX } from './waitlist.repo';

const detailSelect = {
  id: true,
  startAt: true,
  endAt: true,
  status: true,
  source: true,
  idempotencyKey: true,
  holdExpiresAt: true,
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
  /** Empty for a deposit hold: reminders (and the booking email) are created when the deposit is paid. */
  reminders: NewReminderJob[];
  /** Set for a booking that needs a deposit: inserted as PENDING_PAYMENT with its Payment row. */
  deposit?: NewDeposit | undefined;
}

export interface NewDeposit {
  holdExpiresAt: Date;
  /** The provider checkout id is attached after the insert (appointmentRepo.setCheckoutId). */
  payment: { provider: string; amount: number; currency: string };
}

export interface ExpiredHold {
  id: string;
  businessId: string;
  serviceId: string;
  staffId: string;
  startAt: Date;
  endAt: Date;
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
          status: data.deposit ? 'PENDING_PAYMENT' : 'BOOKED',
          holdExpiresAt: data.deposit?.holdExpiresAt ?? null,
          source: data.source,
          idempotencyKey: data.idempotencyKey ?? null,
        },
        select: { id: true },
      });
      if (data.deposit) {
        await tx.payment.create({
          data: {
            businessId,
            purpose: 'DEPOSIT',
            appointmentId: appointment.id,
            status: 'PENDING',
            externalId: `pending_${appointment.id}`,
            ...data.deposit.payment,
          },
        });
      }
      await reminderJobRepo.createForAppointment(businessId, tx, appointment.id, data.reminders);
      return tx.appointment.findFirstOrThrow({
        where: { id: appointment.id, businessId },
        select: detailSelect,
      });
    }),

  /** Signed-link resolution: the token carries only the appointment id, so this is the one unscoped lookup. */
  async businessIdOf(appointmentId: string): Promise<string | null> {
    const row = await db.appointment.findUnique({
      where: { id: appointmentId },
      select: { businessId: true },
    });
    return row?.businessId ?? null;
  },

  findForLink: (businessId: string, id: string) =>
    db.appointment.findFirst({
      where: { id, businessId },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        confirmedAt: true,
        clientId: true,
        service: { select: { id: true, name: true, durationMin: true, price: true } },
        staff: { select: { id: true, displayName: true } },
        business: {
          select: { name: true, slug: true, timezone: true, locale: true, cancelCutoffMin: true },
        },
      },
    }),

  /** BOOKED -> CONFIRMED. Stays in the exclusion constraint. False when the status was not BOOKED. */
  async confirmByLink(businessId: string, id: string, now: Date): Promise<boolean> {
    const res = await db.appointment.updateMany({
      where: { id, businessId, status: 'BOOKED' },
      data: { status: 'CONFIRMED', confirmedAt: now },
    });
    return res.count === 1;
  },

  /**
   * Client cancel via link, in ONE transaction: the status change (which frees the slot), the pending
   * reminders going SKIPPED and, for a late cancel, the client's lateCancels counter. False when the
   * appointment was not in a cancellable state (a concurrent cancel won).
   */
  cancelByLink: (businessId: string, id: string, now: Date, late: boolean) =>
    db.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: { id, businessId },
        select: { clientId: true },
      });
      if (!current) return false;
      const res = await tx.appointment.updateMany({
        where: { id, businessId, status: { in: ['BOOKED', 'CONFIRMED', 'PENDING_PAYMENT'] } },
        data: {
          status: late ? 'LATE_CANCEL' : 'CANCELLED',
          cancelledAt: now,
          cancelledVia: 'LINK',
        },
      });
      if (res.count !== 1) return false;
      await reminderJobRepo.skipPending(businessId, tx, id);
      await expirePendingDeposits(tx, businessId, [id]);
      if (late) {
        await tx.client.updateMany({
          where: { id: current.clientId, businessId },
          data: { lateCancels: { increment: 1 } },
        });
      }
      return true;
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
      await expirePendingDeposits(tx, businessId, [id]);
      return true;
    }),

  // ---- deposit holds (FR-26) ----------------------------------------------------------------------

  /** Everything the pay page needs: the hold, its service/staff/business and the deposit payment. */
  findForPay: (businessId: string, id: string) =>
    db.appointment.findFirst({
      where: { id, businessId },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        holdExpiresAt: true,
        cancelledVia: true,
        serviceId: true,
        staffId: true,
        service: { select: { id: true, name: true, durationMin: true, price: true } },
        staff: { select: { id: true, displayName: true } },
        business: { select: { name: true, slug: true, timezone: true, locale: true, address: true } },
        payments: {
          where: { businessId, purpose: 'DEPOSIT' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            provider: true,
            externalId: true,
            amount: true,
            currency: true,
            status: true,
          },
        },
      },
    }),

  /**
   * The provider said PAID: PENDING_PAYMENT -> CONFIRMED, Payment -> PAID and the booking's reminder jobs, in
   * ONE transaction. The conditional UPDATE is the only referee: of a double click, an expiry run and a staff
   * cancel exactly one wins (the others find the status changed and count 0). Returns false when this call
   * did not flip it. Reminder rows also carry the (appointmentId, kind, channel) unique key.
   */
  confirmPaid: (businessId: string, id: string, now: Date, jobs: NewReminderJob[]) =>
    db.$transaction(async (tx) => {
      // BOOKED, no confirmedAt: the deposit is not the client's "I'll be there" (the PAID Payment row is the
      // proof of deposit; the client can still confirm with the link, which counts in the confirm rate).
      const res = await tx.appointment.updateMany({
        where: { id, businessId, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        data: { status: 'BOOKED' },
      });
      if (res.count !== 1) return false;
      await tx.payment.updateMany({
        where: { businessId, appointmentId: id, purpose: 'DEPOSIT', status: 'PENDING' },
        data: { status: 'PAID' },
      });
      await reminderJobRepo.createForAppointment(businessId, tx, id, jobs);
      // A waitlist claim is only a claim once it is paid (until then the offer stays OPEN, the entry OPEN,
      // and no refill is counted). The offer id is the booking's idempotency key suffix.
      const appt = await tx.appointment.findFirst({
        where: { id, businessId },
        select: { source: true, idempotencyKey: true },
      });
      if (appt?.source === 'WAITLIST' && appt.idempotencyKey?.startsWith(OFFER_KEY_PREFIX)) {
        const offer = await tx.waitlistOffer.findFirst({
          where: { id: appt.idempotencyKey.slice(OFFER_KEY_PREFIX.length), businessId },
          select: { id: true, entryId: true, freedFromAppointmentId: true },
        });
        if (offer)
          await markClaimedIn(tx, businessId, {
            offerId: offer.id,
            entryId: offer.entryId,
            freedFromAppointmentId: offer.freedFromAppointmentId,
            appointmentId: id,
          });
      }
      return true;
    }),

  /**
   * Cron (all tenants): lapsed holds -> CANCELLED (cancelledVia SYSTEM), their PENDING deposit payment ->
   * EXPIRED, in one transaction. The inner SELECT ... FOR UPDATE SKIP LOCKED means two overlapping runs
   * never take the same row, and a pay that holds the row wins and is skipped. Returns the freed slots.
   */
  expireHolds: (now: Date, limit: number) => expireLapsed(now, limit),

  /**
   * The same conditional expiry, scoped to ONE business and a time window (optionally one staff member).
   * Called by the booking path so a lapsed hold the cron has not swept yet never blocks a slot. Only rows it
   * actually expired are returned, so the caller fires the side effects for exactly those.
   */
  expireHoldsFor: (
    businessId: string,
    scope: { staffId?: string | undefined; from: Date; to: Date },
    now: Date,
    limit = 50,
  ) => expireLapsed(now, limit, { businessId, ...scope }),

  /** Attach the provider's checkout id to the deposit Payment created with the hold (set after the insert). */
  async setCheckoutId(businessId: string, appointmentId: string, externalId: string) {
    const res = await db.payment.updateMany({
      where: { businessId, appointmentId, purpose: 'DEPOSIT', status: 'PENDING' },
      data: { externalId },
    });
    return res.count === 1;
  },

  /** The provider could not open a checkout: release the just-created hold (SYSTEM) and close its payment. */
  abandonHold: (businessId: string, id: string, now: Date) =>
    db.$transaction(async (tx) => {
      const res = await tx.appointment.updateMany({
        where: { id, businessId, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledVia: 'SYSTEM' },
      });
      await expirePendingDeposits(tx, businessId, [id]);
      return res.count === 1;
    }),
};

interface Scope {
  businessId: string;
  staffId?: string | undefined;
  from: Date;
  to: Date;
}

/** Lapsed holds -> CANCELLED/SYSTEM + their PENDING payment EXPIRED, one transaction, rows claimed with SKIP LOCKED. */
function expireLapsed(now: Date, limit: number, scope?: Scope) {
  return db.$transaction(async (tx) => {
    const ts = now.toISOString();
    const where = scope
      ? Prisma.sql`AND "businessId" = ${scope.businessId}
          AND "startAt" < ${scope.to.toISOString()}::timestamptz
          AND "blockedUntil" > ${scope.from.toISOString()}::timestamptz
          ${scope.staffId ? Prisma.sql`AND "staffId" = ${scope.staffId}` : Prisma.empty}`
      : Prisma.empty;
    const rows = await tx.$queryRaw<ExpiredHold[]>`
      UPDATE "Appointment"
      SET "status" = 'CANCELLED', "cancelledAt" = ${ts}::timestamptz, "cancelledVia" = 'SYSTEM',
          "updatedAt" = ${ts}::timestamptz
      WHERE "id" IN (
        SELECT "id" FROM "Appointment"
        WHERE "status" = 'PENDING_PAYMENT' AND "holdExpiresAt" <= ${ts}::timestamptz ${where}
        ORDER BY "holdExpiresAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING "id", "businessId", "serviceId", "staffId", "startAt", "endAt"`;
    const byBusiness = new Map<string, string[]>();
    for (const r of rows)
      byBusiness.set(r.businessId, [...(byBusiness.get(r.businessId) ?? []), r.id]);
    for (const [businessId, ids] of byBusiness) await expirePendingDeposits(tx, businessId, ids);
    return rows;
  });
}
