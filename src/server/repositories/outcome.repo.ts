import {
  planExcuse,
  planOutcome,
  type CounterField,
  type OutcomeTarget,
} from '@/server/domain/outcomes';
import { scopeWhere, type Scope } from '@/server/domain/scope';
import { db } from './db';
import { reminderJobRepo } from './reminderJob.repo';

const outcomeSelect = {
  id: true,
  status: true,
  startAt: true,
  endAt: true,
  client: {
    select: { id: true, name: true, phone: true, attended: true, noShows: true, lateCancels: true },
  },
} as const;

export type OutcomeRow = NonNullable<Awaited<ReturnType<typeof outcomeRepo.findOutcomeRow>>>;

export type MarkOutcomeResult =
  | { kind: 'not_found' }
  /** The status changed between the read and the conditional update: the caller re-evaluates. */
  | { kind: 'raced' }
  | { kind: 'not_started' | 'not_ended' | 'conflict' | 'noop'; row: OutcomeRow }
  /** Inside the no-show grace period; `availableAt` is when NO_SHOW opens. */
  | { kind: 'grace_period'; availableAt: Date; row: OutcomeRow }
  | { kind: 'applied'; drift: boolean; row: OutcomeRow };

export type ExcuseResult =
  | { kind: 'not_found' }
  | { kind: 'conflict' | 'noop'; row: OutcomeRow }
  | { kind: 'applied'; drift: boolean; row: OutcomeRow };

/** Past appointments with no outcome yet: ended, still BOOKED or CONFIRMED. */
const queueWhere = (businessId: string, scope: Scope, now: Date) => ({
  businessId,
  ...scopeWhere(scope),
  startAt: { lte: now },
  endAt: { lte: now },
  status: { in: ['BOOKED', 'CONFIRMED'] as ('BOOKED' | 'CONFIRMED')[] },
});

export const outcomeRepo = {
  findOutcomeRow: (businessId: string, id: string) =>
    db.appointment.findFirst({ where: { id, businessId }, select: outcomeSelect }),

  /**
   * Record an outcome in ONE transaction: a conditional update on the status we read (a concurrent
   * double-mark cannot both win) and the client's counters. The decision itself is the pure `planOutcome`.
   * Counters never go below zero: the decrement only matches a row whose counter is above zero.
   */
  markOutcome: (
    businessId: string,
    id: string,
    userId: string,
    target: OutcomeTarget,
    now: Date,
    scope: Scope,
  ): Promise<MarkOutcomeResult> =>
    db.$transaction(async (tx) => {
      // A row outside the scope is "not found", exactly like another business's id.
      const own = { id, businessId, ...scopeWhere(scope) };
      const current = await tx.appointment.findFirst({
        where: own,
        select: { status: true, cancelledVia: true, startAt: true, endAt: true, clientId: true },
      });
      if (!current) return { kind: 'not_found' } as const;
      const load = () => tx.appointment.findFirstOrThrow({ where: own, select: outcomeSelect });

      const plan = planOutcome({
        status: current.status,
        cancelledVia: current.cancelledVia,
        startAt: current.startAt,
        endAt: current.endAt,
        now,
        target,
      });
      if (plan.kind === 'grace_period')
        return { kind: 'grace_period', availableAt: plan.availableAt, row: await load() } as const;
      if (plan.kind !== 'apply') return { kind: plan.kind, row: await load() } as const;

      const res = await tx.appointment.updateMany({
        where: { ...own, status: current.status },
        data: { status: target, outcomeMarkedById: userId, outcomeMarkedAt: now },
      });
      if (res.count !== 1) return { kind: 'raced' } as const;

      let drift = false;
      if (plan.decrement) {
        const field: CounterField = plan.decrement;
        const dec = await tx.client.updateMany({
          where: { id: current.clientId, businessId, [field]: { gt: 0 } },
          data: { [field]: { decrement: 1 } },
        });
        drift = dec.count === 0; // the counter was already 0: it had drifted from the appointments
      }
      await tx.client.updateMany({
        where: { id: current.clientId, businessId },
        data: { [plan.increment]: { increment: 1 } },
      });
      // A client who called too late will not receive the reminders that were still pending.
      if (target === 'LATE_CANCEL') await reminderJobRepo.skipPending(businessId, tx, id);
      return { kind: 'applied', drift, row: await load() } as const;
    }),

  /**
   * Excuse a NO_SHOW / LATE_CANCEL in ONE transaction. The appointment row is locked FOR UPDATE first, so two
   * concurrent excuses (or an excuse racing a correction) queue and the loser re-reads the new status: the
   * counter goes down once. cancelledAt / cancelledVia written by the cancel link are kept; a staff-marked
   * outcome gets cancelledVia STAFF. outcomeMarkedById / At stay as the audit trail of the original mark.
   */
  excuse: (businessId: string, id: string, now: Date): Promise<ExcuseResult> =>
    db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Appointment" WHERE "id" = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
      if (locked.length === 0) return { kind: 'not_found' } as const;
      const current = await tx.appointment.findFirstOrThrow({
        where: { id, businessId },
        select: { status: true, cancelledAt: true, cancelledVia: true, clientId: true },
      });
      const load = () =>
        tx.appointment.findFirstOrThrow({ where: { id, businessId }, select: outcomeSelect });
      const plan = planExcuse({ status: current.status });
      if (plan.kind !== 'apply') return { kind: plan.kind, row: await load() } as const;

      const moved = await tx.appointment.updateMany({
        where: { id, businessId, status: current.status },
        data: {
          status: 'CANCELLED',
          cancelledAt: current.cancelledAt ?? now,
          cancelledVia: current.cancelledVia ?? 'STAFF',
        },
      });
      // The row is locked, so this cannot fail; the guard keeps the counter honest if that ever changes.
      if (moved.count !== 1) return { kind: 'noop', row: await load() } as const;
      const field: CounterField = plan.decrement;
      const dec = await tx.client.updateMany({
        where: { id: current.clientId, businessId, [field]: { gt: 0 } },
        data: { [field]: { decrement: 1 } },
      });
      return { kind: 'applied', drift: dec.count === 0, row: await load() } as const;
    }),

  listQueue: (businessId: string, scope: Scope, now: Date, limit: number) =>
    db.appointment.findMany({
      where: queueWhere(businessId, scope, now),
      orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        service: { select: { id: true, name: true } },
        staff: { select: { id: true, displayName: true } },
        client: { select: { id: true, name: true, phone: true, noShows: true } },
      },
    }),

  countQueue: (businessId: string, scope: Scope, now: Date) =>
    db.appointment.count({ where: queueWhere(businessId, scope, now) }),

  /**
   * Waitlist refills CLAIMED in [startUtc, endUtc): replacement bookings (source WAITLIST) created in the
   * window, whatever day the appointment is on. `createdAt` is the claim time (the same instant the waitlist
   * activity card shows). A deposit hold (PENDING_PAYMENT) is no refill until paid, and cancelled ones are not.
   */
  countRefilledBetween: (businessId: string, startUtc: Date, endUtc: Date) =>
    db.appointment.count({
      where: {
        businessId,
        source: 'WAITLIST',
        createdAt: { gte: startUtc, lt: endUtc },
        status: { notIn: ['CANCELLED', 'LATE_CANCEL', 'PENDING_PAYMENT'] },
      },
    }),

  /** Every appointment of the local day (any status) with what the dashboard timeline needs. */
  listForDay: (businessId: string, scope: Scope, startUtc: Date, endUtc: Date, now: Date) =>
    db.appointment.findMany({
      where: { businessId, ...scopeWhere(scope), startAt: { gte: startUtc, lt: endUtc } },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        source: true,
        confirmedAt: true,
        createdAt: true,
        service: { select: { id: true, name: true, durationMin: true } },
        staff: { select: { id: true, displayName: true } },
        client: { select: { id: true, name: true, phone: true, noShows: true } },
        reminderJobs: {
          where: { channel: 'WHATSAPP', status: 'PENDING', dueAt: { lte: now } },
          select: { id: true },
          take: 1,
        },
      },
    }),

  /** Active, bookable staff for the day columns (a scoped session: only its own column). */
  listColumns: (businessId: string, scope: Scope) =>
    db.staffMember.findMany({
      // A barber's own column shows whether or not they take public bookings.
      where:
        scope.kind === 'own'
          ? { businessId, active: true, id: scope.staffId }
          : { businessId, active: true, bookable: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true },
    }),

  /** Minimal rows for the pilot report: everything that started before `before`. */
  listForReport: (businessId: string, before: Date) =>
    db.appointment.findMany({
      where: { businessId, startAt: { lt: before } },
      orderBy: { startAt: 'asc' },
      select: { startAt: true, status: true, cancelledVia: true, source: true },
    }),

  firstStart: async (businessId: string): Promise<Date | null> => {
    const row = await db.appointment.findFirst({
      where: { businessId },
      orderBy: { startAt: 'asc' },
      select: { startAt: true },
    });
    return row?.startAt ?? null;
  },

  listForExport: (businessId: string, startUtc: Date, endUtc: Date) =>
    db.appointment.findMany({
      where: { businessId, startAt: { gte: startUtc, lt: endUtc } },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      select: {
        startAt: true,
        endAt: true,
        status: true,
        source: true,
        confirmedAt: true,
        outcomeMarkedAt: true,
        service: { select: { name: true } },
        staff: { select: { displayName: true } },
        client: { select: { name: true, phone: true } },
      },
    }),
};
