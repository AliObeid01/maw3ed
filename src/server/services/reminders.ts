import { ACTIVE_APPOINTMENT_STATUSES } from '@/server/domain/appointmentStatus';
import { buildIcs } from '@/server/domain/ics';
import { sendDecision } from '@/server/domain/reminderWindows';
import { expiryFor, signToken } from '@/server/domain/tokens';
import { getServerEnv, misconfiguredError, requireLinkSecret } from '@/server/env';
import { rootLogger, type Logger } from '@/server/http/logger';
import { renderReminderEmail } from '@/server/i18n/emailRender';
import { EmailSendError, getEmailProvider, type EmailProvider } from '@/server/providers/email';
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
  (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(status);

type Plan = { send: true } | { send: false; reason: string };

function planFor(job: ClaimedJob, c: SendContext, now: Date, sentToday: number): Plan {
  const a = c.appointment;
  if (a.businessId !== c.businessId) return { send: false, reason: 'mismatch' };
  if (!isActive(a.status)) return { send: false, reason: 'inactive' };
  if (job.kind === 'BOOKING') {
    if (now.getTime() >= a.startAt.getTime()) return { send: false, reason: 'started' };
    if (sentToday >= EMAIL_BUDGET_SKIP_BOOKING) return { send: false, reason: 'budget' };
  } else if (sendDecision(job.kind, a.startAt, now, true) === 'SKIP') {
    return { send: false, reason: 'window' };
  }
  if (!a.client.email) return { send: false, reason: 'no_email' };
  return { send: true };
}

/**
 * The reminder runner. Safe to call late or twice at once: it only works on rows it wins the claim for.
 *   requeue stuck SENDING -> claim (FOR UPDATE SKIP LOCKED) -> re-check -> send (job id = idempotency key)
 *   -> record. The clock is injected so tests control it.
 */
export async function runReminders(
  deps: ReminderDeps = defaultReminderDeps(),
): Promise<RunSummary> {
  const now = deps.now();
  const log = deps.logger;
  const summary: RunSummary = { claimed: 0, sent: 0, skipped: 0, failed: 0, requeued: 0 };

  // Resolve configuration before touching any row: a misconfiguration must not strand claimed jobs.
  const secret = deps.linkSecret();
  const appUrl = deps.appUrl().replace(/\/+$/, '');
  if (secret.length < 32 || !/^https?:\/\//.test(appUrl)) throw misconfiguredError();
  const provider = deps.provider();

  summary.requeued = await reminderJobRepo.requeueStuck(new Date(now.getTime() - STUCK_AFTER_MS));
  if (summary.requeued > 0)
    log.warn({ requeued: summary.requeued }, 'reminder jobs stuck in SENDING were requeued');

  const claimed = await reminderJobRepo.claimDue(now, BATCH_SIZE);
  summary.claimed = claimed.length;
  if (claimed.length === 0) return summary;

  let sentToday = await reminderJobRepo.countSentEmailsSince(startOfUtcDay(now));
  if (sentToday >= EMAIL_BUDGET_WARN)
    log.warn(
      { sentToday, warnAt: EMAIL_BUDGET_WARN, bookingSkippedAt: EMAIL_BUDGET_SKIP_BOOKING },
      'daily email budget is nearly used',
    );

  const contexts = new Map(
    (await reminderJobRepo.loadSendContexts(claimed.map((j) => j.id))).map((c) => [c.id, c]),
  );

  // Reminders before booking confirmations, so the budget cut-off drops confirmations first (NFR-10).
  const ordered = [...claimed].sort(
    (x, y) => Number(x.kind === 'BOOKING') - Number(y.kind === 'BOOKING'),
  );

  const skip = async (job: ClaimedJob, reason: string, businessId?: string) => {
    await reminderJobRepo.markSkipped(job.id, reason);
    summary.skipped++;
    log.info(
      { jobId: job.id, businessId: businessId ?? job.businessId, kind: job.kind, reason },
      'reminder skipped',
    );
  };

  const process = async (job: ClaimedJob) => {
    const c = contexts.get(job.id);
    if (!c) return skip(job, 'missing');
    const plan = planFor(job, c, now, sentToday);
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
                stamp: now,
                summary: `${a.service.name} - ${c.business.name}`,
                location: c.business.address ?? undefined,
              }),
            },
          ]
        : undefined;

    try {
      const result = await provider.send({
        to: a.client.email!,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotencyKey: job.id,
        attachments,
      });
      await reminderJobRepo.markSent(job.id, result.providerMessageId, deps.now());
      sentToday++;
      summary.sent++;
      log.info(
        {
          jobId: job.id,
          businessId: c.businessId,
          kind: job.kind,
          attempt: job.attempts,
          providerMessageId: result.providerMessageId,
        },
        'reminder sent',
      );
    } catch (error) {
      summary.failed++;
      const code = error instanceof EmailSendError ? error.code : 'send_error';
      const permanent = error instanceof EmailSendError && error.permanent;
      if (permanent || job.attempts >= MAX_ATTEMPTS) {
        await reminderJobRepo.markFailed(job.id, code);
        log.error(
          { jobId: job.id, businessId: c.businessId, kind: job.kind, attempt: job.attempts, code },
          'reminder failed permanently',
        );
      } else {
        const delayMin = BACKOFF_MIN[Math.min(job.attempts, BACKOFF_MIN.length) - 1] ?? 15;
        await reminderJobRepo.markRetry(
          job.id,
          new Date(deps.now().getTime() + delayMin * 60_000),
          code,
        );
        log.warn(
          {
            jobId: job.id,
            businessId: c.businessId,
            kind: job.kind,
            attempt: job.attempts,
            code,
            retryInMin: delayMin,
          },
          'reminder attempt failed, will retry',
        );
      }
    }
  };

  for (let i = 0; i < ordered.length; i += CONCURRENCY) {
    await Promise.all(ordered.slice(i, i + CONCURRENCY).map(process));
  }

  log.info({ ...summary }, 'reminder run finished');
  return summary;
}
