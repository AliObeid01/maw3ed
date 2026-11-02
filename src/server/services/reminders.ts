import { effectiveEmail } from '@/server/domain/contactEmail';
import { REMINDABLE_STATUSES } from '@/server/domain/appointmentStatus';
import { buildIcs } from '@/server/domain/ics';
import { sendDecision } from '@/server/domain/reminderWindows';
import { expiryFor, signToken } from '@/server/domain/tokens';
import { getServerEnv, misconfiguredError, requireLinkSecret } from '@/server/env';
import { safeError } from '@/server/http/errors';
import { rootLogger, type Logger } from '@/server/http/logger';
import { renderReminderEmail } from '@/server/i18n/emailRender';
import {
  EmailSendError,
  getEmailProvider,
  IDEMPOTENT_MISMATCH,
  type EmailProvider,
} from '@/server/providers/email';
import { waitlistRepo } from '@/server/repositories/waitlist.repo';
import {
  reminderJobRepo,
  type ClaimedJob,
  type SendContext,
} from '@/server/repositories/reminderJob.repo';

export const BATCH_SIZE = 50;
export const STUCK_AFTER_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
/** Minutes to wait after failed attempt 1, 2, 3. Attempt 3 is terminal, so 15 is only a ceiling. */
export const BACKOFF_MIN = [1, 5, 15] as const;
export const EMAIL_BUDGET_WARN = 80;
export const EMAIL_BUDGET_SKIP_BOOKING = 95;
const CONCURRENCY = 5;
/** Stop starting new chunks after this much wall-clock time (the route's maxDuration is 60 s). */
export const RUN_BUDGET_MS = 45_000;
/** Resend de-duplicates a key for 24 h; never resend a booking confirmation later than this. */
export const BOOKING_STALE_MS = 23 * 3_600_000;
export const RATE_LIMIT_PARK_MS = 15 * 60_000;

export interface RunSummary {
  claimed: number;
  sent: number;
  skipped: number;
  /** Failed send attempts (retried with backoff, or terminal after the third). */
  failed: number;
  /** Rows found stuck in SENDING and put back to PENDING. */
  requeued: number;
}

export interface ReminderDeps {
  now: () => Date;
  provider: () => EmailProvider;
  linkSecret: () => string;
  appUrl: () => string;
  logger: Logger;
  /** Monotonic millisecond clock for the run budget. Default: performance.now. */
  monotonic?: () => number;
  budgetMs?: number;
  /** Test seam: runs right after the claim and before any job is loaded (to provoke a race). */
  afterClaim?: (jobs: ClaimedJob[]) => Promise<void>;
}

export const defaultReminderDeps = (logger: Logger = rootLogger): ReminderDeps => ({
  now: () => new Date(),
  provider: () => getEmailProvider(),
  linkSecret: () => requireLinkSecret(),
  appUrl: () => getServerEnv().APP_URL,
  logger,
});

const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const isActive = (status: string) =>
  (REMINDABLE_STATUSES as readonly string[]).includes(status);

type Plan = { send: true } | { send: false; reason: string };

function planFor(job: ClaimedJob, c: SendContext, now: Date, sentToday: number): Plan {
  const a = c.appointment;
  if (a.businessId !== c.businessId) return { send: false, reason: 'mismatch' };
  if (!isActive(a.status)) return { send: false, reason: 'inactive' };
  if (job.kind === 'BOOKING') {
    // Outside Resend's 24 h dedupe window a resend could duplicate. H24/H2 never get that old: their
    // send windows (H24 only before start - 2 h, H2 until start - 15 min) already cap them below 23 h.
    if (now.getTime() - job.dueAt.getTime() > BOOKING_STALE_MS)
      return { send: false, reason: 'stale' };
    if (now.getTime() >= a.startAt.getTime()) return { send: false, reason: 'started' };
    if (sentToday >= EMAIL_BUDGET_SKIP_BOOKING) return { send: false, reason: 'budget' };
  } else if (sendDecision(job.kind, a.startAt, now, true) === 'SKIP') {
    return { send: false, reason: 'window' };
  }
  if (!effectiveEmail(a.contactEmail, a.client.email)) return { send: false, reason: 'no_email' };
  return { send: true };
}

/**
 * The reminder runner. Safe to call late or twice at once: it only works on rows it wins the claim for.
 *   requeue stuck SENDING -> claim (FOR UPDATE SKIP LOCKED) -> re-check -> send (job id = idempotency key)
 *   -> record. The clock is injected so tests control it.
 *
 * Every retried send is byte-for-byte the same request (the .ics DTSTAMP is the job's dueAt, tokens expire
 * at the appointment start), because Resend rejects a reused key with a different payload.
 */
export async function runReminders(
  deps: ReminderDeps = defaultReminderDeps(),
): Promise<RunSummary> {
  const now = deps.now();
  const log = deps.logger;
  const clock = deps.monotonic ?? (() => performance.now());
  const startedAt = clock();
  const budgetMs = deps.budgetMs ?? RUN_BUDGET_MS;
  const summary: RunSummary = { claimed: 0, sent: 0, skipped: 0, failed: 0, requeued: 0 };

  // Resolve configuration before touching any row: a misconfiguration must not strand claimed jobs.
  const secret = deps.linkSecret();
  const appUrl = deps.appUrl().replace(/\/+$/, '');
  if (secret.length < 32 || !/^https?:\/\//.test(appUrl)) throw misconfiguredError();
  const provider = deps.provider();

  const stuck = await reminderJobRepo.requeueStuck(
    new Date(now.getTime() - STUCK_AFTER_MS),
    MAX_ATTEMPTS,
  );
  summary.requeued = stuck.requeued;
  if (stuck.requeued > 0)
    log.warn({ requeued: stuck.requeued }, 'reminder jobs stuck in SENDING were requeued');
  if (stuck.failed > 0)
    log.error({ failed: stuck.failed }, 'stuck reminder jobs out of attempts were marked FAILED');

  const claimed = await reminderJobRepo.claimDue(now, BATCH_SIZE);
  summary.claimed = claimed.length;
  if (claimed.length === 0) return summary;
  await deps.afterClaim?.(claimed);

  // Waitlist offer emails share the daily budget (NFR-10); they are never skipped, only counted.
  const dayStart = startOfUtcDay(now);
  let sentToday =
    (await reminderJobRepo.countSentEmailsSince(dayStart)) +
    (await waitlistRepo.countOffersSince(dayStart));
  if (sentToday >= EMAIL_BUDGET_WARN)
    log.warn(
      { sentToday, warnAt: EMAIL_BUDGET_WARN, bookingSkippedAt: EMAIL_BUDGET_SKIP_BOOKING },
      'daily email budget is nearly used',
    );

  const skip = async (job: ClaimedJob, reason: string) => {
    await reminderJobRepo.markSkipped(job.id, reason);
    summary.skipped++;
    log.info(
      { jobId: job.id, businessId: job.businessId, kind: job.kind, reason },
      'reminder skipped',
    );
  };

  let stopRun: string | undefined;

  /** Record an accepted mail. A DB failure here leaves the row SENDING for the requeue (no attempt burned). */
  const record = async (job: ClaimedJob, providerMessageId: string | null) => {
    try {
      await reminderJobRepo.markSent(job.id, providerMessageId, deps.now());
    } catch {
      log.error(
        { jobId: job.id, businessId: job.businessId, kind: job.kind, providerMessageId },
        'sent_not_recorded',
      );
      await reminderJobRepo.refundAttempt(job.id).catch(() => undefined);
      return;
    }
    sentToday++;
    summary.sent++;
    log.info(
      {
        jobId: job.id,
        businessId: job.businessId,
        kind: job.kind,
        attempt: job.attempts,
        providerMessageId,
      },
      'reminder sent',
    );
  };

  const process = async (job: ClaimedJob) => {
    // Loaded just before sending, so a cancel that landed after the claim is seen.
    const [c] = await reminderJobRepo.loadSendContexts([job.id]);
    if (!c) return skip(job, 'missing');
    const plan = planFor(job, c, deps.now(), sentToday);
    if (!plan.send) return skip(job, plan.reason);

    const a = c.appointment;
    const mk = (act: 'confirm' | 'cancel') =>
      `${appUrl}/l/${signToken({ a: a.id, act, exp: expiryFor(a.startAt) }, secret)}`;
    const rendered = renderReminderEmail({
      kind: job.kind,
      locale: c.business.locale,
      timezone: c.business.timezone,
      businessName: c.business.name,
      clientName: a.client.name,
      serviceName: a.service.name,
      staffName: a.staff.displayName,
      startAt: a.startAt,
      confirmUrl: mk('confirm'),
      cancelUrl: mk('cancel'),
    });
    const attachments =
      job.kind === 'BOOKING'
        ? [
            {
              filename: 'appointment.ics',
              contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
              content: buildIcs({
                uid: `${a.id}@maw3ed`,
                startAt: a.startAt,
                endAt: a.endAt,
                // Deterministic per job: a retry must send exactly the same bytes.
                stamp: job.dueAt,
                summary: `${a.service.name} - ${c.business.name}`,
                location: c.business.address ?? undefined,
              }),
            },
          ]
        : undefined;

    let providerMessageId: string | null;
    try {
      const result = await provider.send({
        to: effectiveEmail(a.contactEmail, a.client.email)!,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotencyKey: job.id,
        attachments,
      });
      providerMessageId = result.providerMessageId;
    } catch (error) {
      const sendError = error instanceof EmailSendError ? error : undefined;
      const code = sendError?.code ?? 'send_error';
      const ctxLog = {
        jobId: job.id,
        businessId: c.businessId,
        kind: job.kind,
        attempt: job.attempts,
      };

      if (code === IDEMPOTENT_MISMATCH) {
        // The provider already accepted this key earlier (a crash after send): the mail exists.
        log.warn({ ...ctxLog, code }, 'provider already accepted this idempotency key');
        return record(job, null);
      }
      if (sendError?.rateLimited) {
        const wait = sendError.retryAfterMs ?? RATE_LIMIT_PARK_MS;
        await reminderJobRepo.release([job.id], {
          nextAttemptAt: new Date(deps.now().getTime() + wait),
          lastError: code,
        });
        stopRun = 'rate_limited';
        log.warn(
          { ...ctxLog, code, waitMs: wait },
          'provider rate limit: job parked, run stopping',
        );
        return;
      }
      summary.failed++;
      if (sendError?.permanent || job.attempts >= MAX_ATTEMPTS) {
        await reminderJobRepo.markFailed(job.id, code);
        log.error({ ...ctxLog, code }, 'reminder failed permanently');
      } else {
        const delayMin = BACKOFF_MIN[Math.min(job.attempts, BACKOFF_MIN.length) - 1] ?? 15;
        await reminderJobRepo.markRetry(
          job.id,
          new Date(deps.now().getTime() + delayMin * 60_000),
          code,
        );
        log.warn({ ...ctxLog, code, retryInMin: delayMin }, 'reminder attempt failed, will retry');
      }
      return;
    }
    await record(job, providerMessageId);
  };

  // Reminders finish before any booking confirmation starts, so the budget cut-off drops confirmations
  // first (NFR-10).
  const reminders = claimed.filter((j) => j.kind !== 'BOOKING');
  const queue = [...reminders, ...claimed.filter((j) => j.kind === 'BOOKING')];
  let next = 0;
  while (next < queue.length) {
    if (!stopRun && clock() - startedAt > budgetMs) stopRun = 'budget';
    if (stopRun) break;
    // A chunk never mixes the two phases, so every reminder is recorded before a confirmation starts.
    const phaseEnd = next < reminders.length ? reminders.length : queue.length;
    const chunk = queue.slice(next, Math.min(next + CONCURRENCY, phaseEnd));
    next += chunk.length;
    const settled = await Promise.allSettled(chunk.map(process));
    settled.forEach((r, i) => {
      if (r.status === 'rejected') {
        // Left SENDING: the requeue picks it up (FAILED after MAX_ATTEMPTS) and the batch carries on.
        log.error(
          { jobId: chunk[i]!.id, businessId: chunk[i]!.businessId, err: safeError(r.reason) },
          'reminder job errored',
        );
      }
    });
  }
  if (next < queue.length) {
    const rest = queue.slice(next).map((j) => j.id);
    const released = await reminderJobRepo.release(rest);
    log.warn(
      { reason: stopRun, released },
      'reminder run stopped early; unprocessed jobs released',
    );
  }

  log.info({ ...summary }, 'reminder run finished');
  return summary;
}
