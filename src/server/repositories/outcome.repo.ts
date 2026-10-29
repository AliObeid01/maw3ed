import { planOutcome, type CounterField, type OutcomeTarget } from '@/server/domain/outcomes';
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
  | { kind: 'not_started' | 'conflict' | 'noop' | 'applied'; row: OutcomeRow };

/** Past appointments with no outcome yet: ended, still BOOKED or CONFIRMED. */
const queueWhere = (businessId: string, now: Date) => ({
  businessId,
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
  ): Promise<MarkOutcomeResult> =>
    db.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: { id, businessId },
        select: { status: true, cancelledVia: true, startAt: true, clientId: true },
      });
      if (!current) return { kind: 'not_found' } as const;
      const load = () =>
        tx.appointment.findFirstOrThrow({ where: { id, businessId }, select: outcomeSelect });

      const plan = planOutcome({
        status: current.status,
        cancelledVia: current.cancelledVia,
        startAt: current.startAt,
        now,
        target,
      });
      if (plan.kind !== 'apply') return { kind: plan.kind, row: await load() } as const;

      const res = await tx.appointment.updateMany({
        where: { id, businessId, status: current.status },
        data: { status: target, outcomeMarkedById: userId, outcomeMarkedAt: now },
      });
      if (res.count !== 1) return { kind: 'raced' } as const;

      if (plan.decrement) {
        const field: CounterField = plan.decrement;
        await tx.client.updateMany({
          where: { id: current.clientId, businessId, [field]: { gt: 0 } },
          data: { [field]: { decrement: 1 } },
        });
      }
      await tx.client.updateMany({
        where: { id: current.clientId, businessId },
        data: { [plan.increment]: { increment: 1 } },
      });
      // A client who called too late will not receive the reminders that were still pending.
      if (target === 'LATE_CANCEL') await reminderJobRepo.skipPending(businessId, tx, id);
      return { kind: 'applied', row: await load() } as const;
    }),

  listQueue: (businessId: string, now: Date, limit: number) =>
    db.appointment.findMany({
      where: queueWhere(businessId, now),
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

  countQueue: (businessId: string, now: Date) =>
    db.appointment.count({ where: queueWhere(businessId, now) }),

  /** Every appointment of the local day (any status) with what the dashboard timeline needs. */
  listForDay: (businessId: string, startUtc: Date, endUtc: Date, now: Date) =>
    db.appointment.findMany({
      where: { businessId, startAt: { gte: startUtc, lt: endUtc } },
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

  /** Active, bookable staff for the day columns. */
  listColumns: (businessId: string) =>
    db.staffMember.findMany({
      where: { businessId, active: true, bookable: true },
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
