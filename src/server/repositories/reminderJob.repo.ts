import type { Prisma } from '@/generated/prisma/client';
import { db } from './db';

export interface NewReminderJob {
  kind: 'BOOKING' | 'H24' | 'H2';
  channel: 'EMAIL' | 'WHATSAPP';
  dueAt: Date;
}

/** A row returned by the claim statement. */
export interface ClaimedJob {
  id: string;
  businessId: string;
  appointmentId: string;
  kind: 'BOOKING' | 'H24' | 'H2';
  dueAt: Date;
  attempts: number;
}

interface RawClaimed {
  id: string;
  businessId: string;
  appointmentId: string;
  kind: ClaimedJob['kind'];
  dueAt: Date | string;
  attempts: number;
}

const sendContextSelect = {
  id: true,
  businessId: true,
  appointmentId: true,
  kind: true,
  attempts: true,
  business: { select: { id: true, name: true, timezone: true, locale: true, address: true } },
  appointment: {
    select: {
      id: true,
      businessId: true,
      status: true,
      startAt: true,
      endAt: true,
      client: { select: { name: true, email: true } },
      service: { select: { name: true } },
      staff: { select: { displayName: true } },
    },
  },
} satisfies Prisma.ReminderJobSelect;

export type SendContext = Prisma.ReminderJobGetPayload<{ select: typeof sendContextSelect }>;

const whatsappSelect = {
  id: true,
  kind: true,
  dueAt: true,
  status: true,
  sentAt: true,
  sentBy: { select: { id: true, name: true } },
  appointment: {
    select: {
      id: true,
      status: true,
      startAt: true,
      client: { select: { name: true, phone: true, noShows: true } },
      service: { select: { id: true, name: true } },
      staff: { select: { id: true, displayName: true } },
    },
  },
} satisfies Prisma.ReminderJobSelect;

export type WhatsappJobRow = Prisma.ReminderJobGetPayload<{ select: typeof whatsappSelect }>;

export const reminderJobRepo = {
  /**
   * Insert a booking's reminder rows on the booking transaction. The unique key
   * (appointmentId, kind, channel) is the duplicate guard; skipDuplicates makes a repeat harmless.
   */
  async createForAppointment(
    businessId: string,
    tx: Prisma.TransactionClient,
    appointmentId: string,
    jobs: NewReminderJob[],
  ) {
    if (jobs.length === 0) return;
    await tx.reminderJob.createMany({
      data: jobs.map((j) => ({ businessId, appointmentId, ...j })),
      skipDuplicates: true,
    });
  },

  /**
   * What an appointment's client may be promised: its EMAIL H24 / H2 rows (any job status: a reminder that
   * was already SENT stays promised, one SKIPPED by a cancel does not), whether the client has an email
   * address, and whether the appointment was cancelled. Null when it is not this business's.
   */
  async reminderFacts(businessId: string, appointmentId: string) {
    const a = await db.appointment.findFirst({
      where: { id: appointmentId, businessId },
      select: {
        status: true,
        client: { select: { email: true } },
        reminderJobs: {
          where: { channel: 'EMAIL', kind: { in: ['H24', 'H2'] } },
          select: { kind: true, channel: true },
        },
      },
    });
    if (!a) return null;
    return {
      jobs: a.reminderJobs,
      hasEmail: !!a.client.email?.trim(),
      cancelled: a.status === 'CANCELLED' || a.status === 'LATE_CANCEL',
    };
  },

  /** Cancel path: pending jobs for the appointment will never be sent. */
  async skipPending(businessId: string, tx: Prisma.TransactionClient, appointmentId: string) {
    const res = await tx.reminderJob.updateMany({
      where: { businessId, appointmentId, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    return res.count;
  },

  // ---- job runner: these queries span all tenants on purpose (jobs only) ---------------------------

  /**
   * Crash recovery: SENDING rows locked before `lockedBefore` go back to PENDING. A row that already used
   * all its attempts (it keeps dying outside the send/record handlers) is FAILED instead, so a poison
   * job can never be re-claimed forever.
   */
  async requeueStuck(lockedBefore: Date, maxAttempts: number) {
    const stuck = { status: 'SENDING' as const, lockedAt: { lt: lockedBefore } };
    const failed = await db.reminderJob.updateMany({
      where: { ...stuck, attempts: { gte: maxAttempts } },
      data: { status: 'FAILED', lockedAt: null, lastError: 'attempts' },
    });
    const requeued = await db.reminderJob.updateMany({
      where: { ...stuck, attempts: { lt: maxAttempts } },
      data: { status: 'PENDING', lockedAt: null },
    });
    return { requeued: requeued.count, failed: failed.count };
  },

  /**
   * THE claim: one statement, `FOR UPDATE SKIP LOCKED`, so two overlapping runs can never claim the same
   * row. Only due PENDING EMAIL rows; WhatsApp rows are never sent by the server.
   */
  async claimDue(now: Date, limit: number): Promise<ClaimedJob[]> {
    const ts = now.toISOString();
    const rows = await db.$queryRaw<RawClaimed[]>`
      UPDATE "ReminderJob"
      SET "status" = 'SENDING', "lockedAt" = ${ts}::timestamptz, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "ReminderJob"
        WHERE "status" = 'PENDING'
          AND "channel" = 'EMAIL'
          AND "dueAt" <= ${ts}::timestamptz
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${ts}::timestamptz)
        ORDER BY "dueAt" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    return rows.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      appointmentId: r.appointmentId,
      kind: r.kind,
      dueAt: new Date(r.dueAt),
      attempts: Number(r.attempts),
    }));
  },

  /** Each claimed job with its own business and appointment, for building its email. */
  loadSendContexts: (ids: string[]) =>
    db.reminderJob.findMany({ where: { id: { in: ids } }, select: sendContextSelect }),

  async markSent(id: string, providerMessageId: string | null, sentAt: Date): Promise<boolean> {
    const res = await db.reminderJob.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'SENT', providerMessageId, sentAt, lockedAt: null, lastError: null },
    });
    return res.count === 1;
  },

  async markSkipped(id: string, reason: string): Promise<boolean> {
    const res = await db.reminderJob.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'SKIPPED', lockedAt: null, lastError: reason },
    });
    return res.count === 1;
  },

  async markRetry(id: string, nextAttemptAt: Date, lastError: string): Promise<boolean> {
    const res = await db.reminderJob.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'PENDING', lockedAt: null, nextAttemptAt, lastError },
    });
    return res.count === 1;
  },

  /**
   * Give claimed rows back without using an attempt (run budget exhausted, provider rate limit). With
   * `nextAttemptAt` they wait until then.
   */
  async release(
    ids: string[],
    opts: { nextAttemptAt?: Date; lastError?: string } = {},
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await db.reminderJob.updateMany({
      where: { id: { in: ids }, status: 'SENDING' },
      data: {
        status: 'PENDING',
        lockedAt: null,
        attempts: { decrement: 1 },
        ...(opts.nextAttemptAt ? { nextAttemptAt: opts.nextAttemptAt } : {}),
        ...(opts.lastError ? { lastError: opts.lastError } : {}),
      },
    });
    return res.count;
  },

  /** Mail delivered but not recorded: the row stays SENDING for the requeue, without burning an attempt. */
  async refundAttempt(id: string): Promise<void> {
    await db.reminderJob.updateMany({
      where: { id, status: 'SENDING', attempts: { gt: 0 } },
      data: { attempts: { decrement: 1 } },
    });
  },

  async markFailed(id: string, lastError: string): Promise<boolean> {
    const res = await db.reminderJob.updateMany({
      where: { id, status: 'SENDING' },
      data: { status: 'FAILED', lockedAt: null, lastError },
    });
    return res.count === 1;
  },

  /** Daily email budget input: emails recorded as SENT since `since` (all tenants share one Resend quota). */
  countSentEmailsSince: (since: Date) =>
    db.reminderJob.count({ where: { channel: 'EMAIL', status: 'SENT', sentAt: { gte: since } } }),

  // ---- WhatsApp (tenant-scoped, session routes) -----------------------------------------------------

  /** Due PENDING WhatsApp jobs plus those sent since `sentSince`. The service applies the send window. */
  listWhatsapp: (businessId: string, now: Date, sentSince: Date) =>
    db.reminderJob.findMany({
      where: {
        businessId,
        channel: 'WHATSAPP',
        kind: { in: ['H24', 'H2'] },
        OR: [
          { status: 'PENDING', dueAt: { lte: now } },
          { status: 'SENT', sentAt: { gte: sentSince } },
        ],
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: whatsappSelect,
    }),

  /** Lean variant of the pending half of listWhatsapp (same WHERE): only what the send decision needs. */
  listPendingWhatsappLean: (businessId: string, now: Date) =>
    db.reminderJob.findMany({
      where: {
        businessId,
        channel: 'WHATSAPP',
        kind: { in: ['H24', 'H2'] },
        status: 'PENDING',
        dueAt: { lte: now },
      },
      select: { kind: true, appointment: { select: { status: true, startAt: true } } },
    }),

  findWhatsapp: (businessId: string, id: string) =>
    db.reminderJob.findFirst({
      where: { id, businessId, channel: 'WHATSAPP' },
      select: whatsappSelect,
    }),

  /** `UPDATE ... WHERE id AND businessId AND status = 'PENDING'`: exactly one caller can win. */
  async markWhatsappSent(
    businessId: string,
    id: string,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const res = await db.reminderJob.updateMany({
      where: { id, businessId, channel: 'WHATSAPP', status: 'PENDING' },
      data: { status: 'SENT', sentAt: now, sentById: userId },
    });
    return res.count === 1;
  },
};
