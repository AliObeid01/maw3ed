import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as postLink } from '@/app/api/links/[token]/route';
import { expiryFor, signToken } from '@/server/domain/tokens';
import { rootLogger, type Logger } from '@/server/http/logger';
import {
  EmailSendError,
  fakeEmailProvider,
  IDEMPOTENT_MISMATCH,
  type EmailProvider,
} from '@/server/providers/email';
import { reminderJobRepo } from '@/server/repositories/reminderJob.repo';
import { runReminders, type ReminderDeps } from '@/server/services/reminders';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookingBody,
  bookPublicly,
  newScenario,
  newTenant,
  NOW,
  removeEmail,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let wide: Awaited<ReturnType<typeof newScenario>>;

const MIN = 60_000;
const HOUR = 60 * MIN;
const fake = fakeEmailProvider;
const secret = () => process.env.LINK_SECRET!;

const deps = (
  now: Date,
  provider: EmailProvider = fake,
  extra: Partial<ReminderDeps> = {},
  logger: Logger = rootLogger,
): ReminderDeps => ({
  now: () => now,
  provider: () => provider,
  linkSecret: secret,
  appUrl: () => 'http://localhost:3000',
  logger,
  ...extra,
});

let seq = 0;
/** One booking on 4 Nov (47 h after NOW) with its own email, spread over 3 staff and 8 slots. */
async function book(email: string | null = `h${seq}@example.test`, time?: string) {
  const i = seq++ % 24;
  const slot = Math.floor(i / 3);
  const t =
    time ?? `${String(7 + Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
  const res = await bookPublicly(
    a.slug,
    bookingBody(wide.serviceId, wide.staffIds[i % 3]!, at(t), email ? { email } : {}),
  );
  if (res.status !== 201) throw new Error(`book failed ${res.status} ${JSON.stringify(res.body)}`);
  // F68: a public booking always has an address; "no email" means it was removed afterwards.
  if (!email) await removeEmail(pg, res.body!.appointment.id);
  return { id: res.body!.appointment.id as string, startAt: new Date(at(t)) };
}
const job = async (appointmentId: string, kind: string, channel = 'EMAIL') =>
  (
    await pg.query(
      'SELECT * FROM "ReminderJob" WHERE "appointmentId" = $1 AND kind = $2 AND channel = $3',
      [appointmentId, kind, channel],
    )
  ).rows[0];

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  wide = await newScenario(prisma, a, { staff: 3 });
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  await pg.query('DELETE FROM "ReminderJob"');
  await pg.query('DELETE FROM "Appointment"');
  await pg.query('DELETE FROM "Client"');
  fake.reset();
  seq = 0;
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.setSystemTime(NOW);
});

describe('retried sends are the same request (blocking 1)', () => {
  it('a requeued BOOKING retry with the .ics is byte-identical and dedupes at a strict provider', async () => {
    const appt = await book('crash@example.test', '07:00');
    const booking = await job(appt.id, 'BOOKING');
    const hanging: EmailProvider = {
      send: async (m) => {
        await fake.send(m);
        return new Promise(() => {});
      },
    };
    void runReminders(deps(NOW, hanging));
    for (let i = 0; i < 200 && fake.calls.length === 0; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(fake.calls).toHaveLength(1);

    const later = await runReminders(deps(new Date(NOW.getTime() + 11 * MIN)));
    expect(later).toMatchObject({ requeued: 1, sent: 1, failed: 0 });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.attachments![0]!.content).toBe(fake.calls[1]!.attachments![0]!.content);
    expect(fake.calls[0]!.text).toBe(fake.calls[1]!.text);
    expect(fake.calls[0]!.html).toBe(fake.calls[1]!.html);
    expect(fake.delivered.size).toBe(1);
    const row = await job(appt.id, 'BOOKING');
    expect(row.status).toBe('SENT');
    expect(row.providerMessageId).toBe(fake.delivered.get(booking.id)!.providerMessageId);
    expect(row.providerMessageId).not.toBeNull();
  });

  it('a provider invalid_idempotent_request means "already accepted": SENT with a null message id', async () => {
    const appt = await book('dup@example.test', '07:00');
    const booking = await job(appt.id, 'BOOKING');
    // The provider already holds this key with a different payload.
    await fake.send({
      to: 'dup@example.test',
      subject: 'older',
      text: 'older',
      html: 'older',
      idempotencyKey: booking.id,
    });
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn() } as unknown as Logger;
    const run = await runReminders(deps(NOW, fake, {}, logger));
    expect(run).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    const row = await job(appt.id, 'BOOKING');
    expect(row).toMatchObject({ status: 'SENT', providerMessageId: null, attempts: 1 });
    expect(warn).toHaveBeenCalled();
    expect(fake.delivered.size).toBe(1);
  });

  it('a BOOKING job older than 23 h is skipped as stale, never resent', async () => {
    const appt = await book('old@example.test', '07:00');
    const run = await runReminders(deps(new Date(NOW.getTime() + 24 * HOUR)));
    const booking = await job(appt.id, 'BOOKING');
    expect(booking).toMatchObject({ status: 'SKIPPED', lastError: 'stale' });
    expect(fake.calls.some((c) => c.idempotencyKey === booking.id)).toBe(false);
    expect(run.skipped).toBeGreaterThanOrEqual(1);
  });

  it('H24 and H2 never reach the stale age: their windows cap them (sanity)', async () => {
    const appt = await book('w@example.test', '07:00');
    // H24 due 24 h before start; at start - 2 h it is skipped by its window long before 23 h of age.
    await runReminders(deps(new Date(appt.startAt.getTime() - 2 * HOUR)));
    expect((await job(appt.id, 'H24')).lastError).toBe('window');
  });
});

describe('cancel racing a claimed job (2, 11)', () => {
  it('an appointment cancelled between claim and send is skipped and nothing is sent', async () => {
    const appt = await book('race@example.test', '07:00');
    const run = await runReminders(
      deps(NOW, fake, {
        afterClaim: async () => {
          await pg.query(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = $1`, [appt.id]);
        },
      }),
    );
    expect(run).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(fake.calls).toHaveLength(0);
    expect((await job(appt.id, 'BOOKING')).lastError).toBe('inactive');
  });

  it('a client cancelling through the link between claim and send wins over the runner', async () => {
    const appt = await book('link@example.test', '07:00');
    const token = signToken({ a: appt.id, act: 'cancel', exp: expiryFor(appt.startAt) }, secret());
    const run = await runReminders(
      deps(NOW, fake, {
        afterClaim: async () => {
          const res = await call(postLink, `/api/links/${token}`, {
            params: { token },
            body: { action: 'cancel' },
          });
          expect(res.status).toBe(200);
        },
      }),
    );
    expect(run).toMatchObject({ sent: 0, skipped: 1 });
    expect(fake.calls).toHaveLength(0);
    const states = (
      await pg.query('SELECT DISTINCT status FROM "ReminderJob" WHERE "appointmentId" = $1', [
        appt.id,
      ])
    ).rows.map((r) => r.status);
    expect(states).toEqual(['SKIPPED']);
  });

  it('a link cancel racing a live runner never leaves a live job behind', async () => {
    const appt = await book('live@example.test', '07:00');
    const token = signToken({ a: appt.id, act: 'cancel', exp: expiryFor(appt.startAt) }, secret());
    const [, res] = await Promise.all([
      runReminders(deps(NOW)),
      call(postLink, `/api/links/${token}`, { params: { token }, body: { action: 'cancel' } }),
    ]);
    expect(res.status).toBe(200);
    const states = (
      await pg.query('SELECT status FROM "ReminderJob" WHERE "appointmentId" = $1', [appt.id])
    ).rows.map((r) => r.status);
    expect(states.every((s) => s === 'SKIPPED' || s === 'SENT')).toBe(true);
    expect(fake.calls.length).toBeLessThanOrEqual(1);
    const again = await runReminders(deps(new Date(NOW.getTime() + 11 * MIN)));
    expect(again.sent).toBe(0);
  });
});

describe('one bad job cannot sink the batch (3)', () => {
  it('a provider that always throws for one client: that job is FAILED after 3 attempts, others are sent', async () => {
    const poison = await book('poison@example.test', '07:00');
    const okA = await book('ok1@example.test', '07:30');
    const okB = await book('ok2@example.test', '08:00');
    const picky: EmailProvider = {
      send: (m) =>
        m.to === 'poison@example.test' ? Promise.reject(new Error('nope')) : fake.send(m),
    };
    const r1 = await runReminders(deps(NOW, picky));
    expect(r1).toMatchObject({ claimed: 3, sent: 2, failed: 1 });
    const r2 = await runReminders(deps(new Date(NOW.getTime() + 1 * MIN), picky));
    expect(r2.failed).toBe(1);
    const r3 = await runReminders(deps(new Date(NOW.getTime() + 6 * MIN), picky));
    expect(r3.failed).toBe(1);
    expect(await job(poison.id, 'BOOKING')).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect((await job(okA.id, 'BOOKING')).status).toBe('SENT');
    expect((await job(okB.id, 'BOOKING')).status).toBe('SENT');
  });

  it('a job whose bookkeeping write keeps throwing is isolated, then FAILED by the attempts cap', async () => {
    const poison = await book(null, '07:00'); // no email -> skip() runs
    const okA = await book('ok1@example.test', '07:30');
    const okB = await book('ok2@example.test', '08:00');
    vi.spyOn(reminderJobRepo, 'markSkipped').mockRejectedValue(new Error('db down'));

    const r1 = await runReminders(deps(NOW));
    expect(r1).toMatchObject({ claimed: 3, sent: 2 });
    expect((await job(okA.id, 'BOOKING')).status).toBe('SENT');
    expect((await job(okB.id, 'BOOKING')).status).toBe('SENT');
    expect(await job(poison.id, 'BOOKING')).toMatchObject({ status: 'SENDING', attempts: 1 });

    await runReminders(deps(new Date(NOW.getTime() + 11 * MIN)));
    await runReminders(deps(new Date(NOW.getTime() + 22 * MIN)));
    expect(await job(poison.id, 'BOOKING')).toMatchObject({ status: 'SENDING', attempts: 3 });

    const last = await runReminders(deps(new Date(NOW.getTime() + 33 * MIN)));
    expect(last).toMatchObject({ claimed: 0, requeued: 0 });
    expect(await job(poison.id, 'BOOKING')).toMatchObject({
      status: 'FAILED',
      lastError: 'attempts',
    });
  });

  it('the BOOKING phase still runs when a reminder job errors', async () => {
    const appt = await book('both@example.test', '07:00');
    vi.spyOn(reminderJobRepo, 'markRetry').mockRejectedValue(new Error('db down'));
    const t = new Date(NOW.getTime() + 23 * HOUR);
    const flaky: EmailProvider = {
      send: (m) => {
        // H24 fails (and its bookkeeping throws); BOOKING goes through.
        if (m.subject.startsWith('Reminder')) return Promise.reject(new Error('x'));
        return fake.send(m);
      },
    };
    const run = await runReminders(deps(t, flaky));
    expect(run.sent).toBeGreaterThanOrEqual(1);
    expect((await job(appt.id, 'BOOKING')).status).toBe('SENT');
  });
});

describe('delivered but not recorded (4)', () => {
  it('leaves the row SENDING, burns no attempt, counts no failure, and the requeue dedupes', async () => {
    const appt = await book('rec@example.test', '07:00');
    const booking = await job(appt.id, 'BOOKING');
    const error = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error } as unknown as Logger;
    const spy = vi.spyOn(reminderJobRepo, 'markSent').mockRejectedValueOnce(new Error('db blip'));
    const run = await runReminders(deps(NOW, fake, {}, logger));
    expect(run).toMatchObject({ claimed: 1, sent: 0, failed: 0 });
    expect(fake.calls).toHaveLength(1);
    expect(error.mock.calls.some((c) => c[1] === 'sent_not_recorded')).toBe(true);
    expect(await job(appt.id, 'BOOKING')).toMatchObject({ status: 'SENDING', attempts: 0 });
    spy.mockRestore();

    const retry = await runReminders(deps(new Date(NOW.getTime() + 11 * MIN)));
    expect(retry).toMatchObject({ requeued: 1, sent: 1, failed: 0 });
    expect(fake.calls.map((c) => c.idempotencyKey)).toEqual([booking.id, booking.id]);
    expect(fake.delivered.size).toBe(1);
    expect(await job(appt.id, 'BOOKING')).toMatchObject({ status: 'SENT', attempts: 1 });
  });
});

describe('run budget (5)', () => {
  it('stops starting chunks after the wall-clock budget and releases the rest without burning attempts', async () => {
    const total = 12;
    for (let i = 0; i < total; i++) await book();
    let elapsed = 0;
    const slow: EmailProvider = {
      send: async (m) => {
        elapsed += 20_000;
        return fake.send(m);
      },
    };
    const run = await runReminders(deps(NOW, slow, { monotonic: () => elapsed }));
    expect(run).toMatchObject({ claimed: total, sent: 5, failed: 0 });
    const rows = (
      await pg.query(`SELECT status, attempts FROM "ReminderJob" WHERE kind = 'BOOKING'`)
    ).rows;
    expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(5);
    const released = rows.filter((r) => r.status === 'PENDING');
    expect(released).toHaveLength(total - 5);
    expect(released.every((r) => r.attempts === 0)).toBe(true);

    elapsed = 0;
    const rest = await runReminders(deps(NOW, fake, { monotonic: () => elapsed }));
    expect(rest.sent).toBe(total - 5);
  });
});

describe('provider rate limit (6)', () => {
  it('a 429 parks the job without an attempt, never FAILs it, and stops the run early', async () => {
    const total = 7;
    for (let i = 0; i < total; i++) await book();
    fake.failNext = new EmailSendError('resend_http_429', false, {
      rateLimited: true,
      retryAfterMs: 2 * MIN,
    });
    const run = await runReminders(deps(NOW));
    expect(run.failed).toBe(0);
    expect(run.sent).toBe(4); // the other four of the first chunk
    const rows = (
      await pg.query(
        `SELECT status, attempts, "nextAttemptAt", "lastError" FROM "ReminderJob" WHERE kind = 'BOOKING'`,
      )
    ).rows;
    expect(rows.filter((r) => r.status === 'FAILED')).toHaveLength(0);
    const parked = rows.filter((r) => r.lastError === 'resend_http_429');
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(new Date(parked[0].nextAttemptAt).getTime()).toBe(NOW.getTime() + 2 * MIN);
    // The two jobs of the unprocessed second chunk were released untouched.
    expect(rows.filter((r) => r.status === 'PENDING' && r.attempts === 0)).toHaveLength(3);
    expect(fake.calls).toHaveLength(5);
  });

  it('without Retry-After the job is parked for 15 minutes', async () => {
    const appt = await book('rl@example.test', '07:00');
    fake.failNext = new EmailSendError('resend_http_429', false, { rateLimited: true });
    await runReminders(deps(NOW));
    const row = await job(appt.id, 'BOOKING');
    expect(row).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(new Date(row.nextAttemptAt).getTime()).toBe(NOW.getTime() + 15 * MIN);
    const early = await runReminders(deps(new Date(NOW.getTime() + 14 * MIN)));
    expect(early.claimed).toBe(0);
    const later = await runReminders(deps(new Date(NOW.getTime() + 15 * MIN)));
    expect(later.sent).toBe(1);
  });

  it('IDEMPOTENT_MISMATCH is exported for providers', () => {
    expect(IDEMPOTENT_MISMATCH).toBe('invalid_idempotent_request');
  });
});
