import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { POST as remindersJob } from '@/app/api/jobs/reminders/route';
import { POST as expiryJob } from '@/app/api/jobs/waitlist-expiry/route';
import { verifyToken } from '@/server/domain/tokens';
import { rootLogger, type Logger } from '@/server/http/logger';
import { EmailSendError, fakeEmailProvider, type EmailProvider } from '@/server/providers/email';
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
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let slotSeq = 0;

const MIN = 60_000;
const fake = fakeEmailProvider;
const secret = () => process.env.LINK_SECRET!;

const deps = (
  now: Date,
  provider: EmailProvider = fake,
  logger: Logger = rootLogger,
): ReminderDeps => ({
  now: () => now,
  provider: () => provider,
  linkSecret: secret,
  appUrl: () => 'http://localhost:3000',
  logger,
});

/** Books on 4 Nov (Beirut), 47 h after NOW, at a fresh half-hour slot. Returns the appointment id. */
async function book(
  tenant: Tenant = a,
  scenario = scn,
  email: string | null = `c${slotSeq}@example.test`,
  time?: string,
) {
  const hh = 7 + Math.floor(slotSeq / 2);
  const mm = slotSeq % 2 ? '30' : '00';
  slotSeq = (slotSeq + 1) % 14;
  const startAt = at(time ?? `${String(hh).padStart(2, '0')}:${mm}`);
  const res = await bookPublicly(
    tenant.slug,
    bookingBody(scenario.serviceId, scenario.staffIds[0]!, startAt, email ? { email } : {}),
  );
  if (res.status !== 201) throw new Error(`book failed ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body!.appointment.id as string, startAt: new Date(startAt) };
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
  process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
  a = await newTenant({ businessName: 'Alpha Salon' });
  scn = await newScenario(prisma, a, { staff: 1 });
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
  slotSeq = 0;
  vi.setSystemTime(NOW);
});
afterEach(() => vi.setSystemTime(NOW));

describe('no duplicate send', () => {
  it('overlapping runs (Promise.all) send each due job exactly once', async () => {
    const wide = await newScenario(prisma, a, { staff: 3 });
    const total = 24;
    for (let i = 0; i < total; i++) {
      const staffId = wide.staffIds[i % 3]!;
      const slot = Math.floor(i / 3); // 8 half-hour slots from 07:00Z
      const time = `${String(7 + Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
      const res = await bookPublicly(
        a.slug,
        bookingBody(wide.serviceId, staffId, at(time), { email: `o${i}@example.test` }),
      );
      expect(res.status).toBe(201);
    }
    const runs = await Promise.all([1, 2, 3, 4].map(() => runReminders(deps(NOW))));

    expect(runs.reduce((n, r) => n + r.claimed, 0)).toBe(total);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(total);
    const keys = fake.calls.map((c) => c.idempotencyKey);
    expect(keys).toHaveLength(total);
    expect(new Set(keys).size).toBe(total);
    const rows = (
      await pg.query(`SELECT status, attempts FROM "ReminderJob" WHERE kind = 'BOOKING'`)
    ).rows;
    expect(rows).toHaveLength(total);
    expect(rows.every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
  }, 180_000);

  it('a row locked by another transaction is skipped (SKIP LOCKED), not waited on, and sent later exactly once', async () => {
    const [x, y] = [(await book()).id, (await book()).id];
    const lockedJob = await job(x, 'BOOKING');
    const holder = newClient();
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM "ReminderJob" WHERE id = $1 FOR UPDATE', [lockedJob.id]);
      const timeout = new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 15_000));
      const outcome = await Promise.race([runReminders(deps(NOW)), timeout]);
      expect(outcome).not.toBe('blocked');
      expect(outcome).toMatchObject({ claimed: 1, sent: 1 });
      expect((await job(y, 'BOOKING')).status).toBe('SENT');
      expect(fake.calls).toHaveLength(1);
    } finally {
      await holder.query('COMMIT');
      await holder.end();
    }
    const later = await runReminders(deps(NOW));
    expect(later).toMatchObject({ claimed: 1, sent: 1 });
    expect(fake.calls.map((c) => c.idempotencyKey).sort()).toEqual(
      [lockedJob.id, (await job(y, 'BOOKING')).id].sort(),
    );
  });

  it('a repeated run later sends nothing more', async () => {
    await book();
    await runReminders(deps(NOW));
    const again = await runReminders(deps(new Date(NOW.getTime() + 5 * MIN)));
    expect(again).toMatchObject({ claimed: 0, sent: 0 });
    expect(fake.calls).toHaveLength(1);
  });

  it('a crash after the provider accepted the mail retries with the SAME idempotency key and delivers once', async () => {
    const appt = await book();
    const booking = await job(appt.id, 'BOOKING');
    // First run: the provider records the call, then the process "dies" (the promise never settles).
    const crashing: EmailProvider = {
      send: async (m) => {
        await fake.send(m);
        return new Promise(() => {});
      },
    };
    void runReminders(deps(NOW, crashing));
    for (let i = 0; i < 200 && fake.calls.length === 0; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(fake.calls).toHaveLength(1);
    expect((await job(appt.id, 'BOOKING')).status).toBe('SENDING');

    // Not stuck yet at 5 minutes: nothing is requeued, nothing resent.
    const early = await runReminders(deps(new Date(NOW.getTime() + 5 * MIN)));
    expect(early).toMatchObject({ requeued: 0, claimed: 0 });

    const later = await runReminders(deps(new Date(NOW.getTime() + 11 * MIN)));
    expect(later).toMatchObject({ requeued: 1, claimed: 1, sent: 1 });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.map((c) => c.idempotencyKey)).toEqual([booking.id, booking.id]);
    expect(fake.delivered.size).toBe(1); // the provider delivered once for that key
    const row = await job(appt.id, 'BOOKING');
    expect(row.status).toBe('SENT');
    expect(row.providerMessageId).toBe(fake.delivered.get(booking.id)!.providerMessageId);
    expect(row.attempts).toBe(2);
  });
});

describe('cancel', () => {
  it('cancelling skips the pending reminders and nothing is sent', async () => {
    const appt = await book();
    const res = await call(cancelAppointment, `/api/appointments/${appt.id}/cancel`, {
      method: 'POST',
      cookie: a.cookie,
      params: { id: appt.id },
    });
    expect(res.status).toBe(200);
    const statuses = (
      await pg.query('SELECT status FROM "ReminderJob" WHERE "appointmentId" = $1', [appt.id])
    ).rows.map((r) => r.status);
    expect(statuses.length).toBe(5);
    expect(new Set(statuses)).toEqual(new Set(['SKIPPED']));
    const run = await runReminders(deps(new Date(NOW.getTime() + 60 * 60 * MIN)));
    expect(run.claimed).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  it('the runner re-checks the appointment itself (defence in depth)', async () => {
    const appt = await book();
    await pg.query(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = $1`, [appt.id]);
    const run = await runReminders(deps(NOW));
    expect(run).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(fake.calls).toHaveLength(0);
    expect((await job(appt.id, 'BOOKING')).lastError).toBe('inactive');
  });

  it('a client without an email is skipped, not failed', async () => {
    const appt = await book(a, scn, null);
    const run = await runReminders(deps(NOW));
    expect(run).toMatchObject({ skipped: 1, sent: 0, failed: 0 });
    expect((await job(appt.id, 'BOOKING')).lastError).toBe('no_email');
  });
});

describe('send windows', () => {
  it('H24 is skipped once now >= start - 2 h, H2 is still sent', async () => {
    const appt = await book(a, scn, 'w@example.test', '07:00');
    const t = new Date(appt.startAt.getTime() - 2 * 60 * MIN);
    const run = await runReminders(deps(t));
    expect(run.skipped).toBeGreaterThanOrEqual(1);
    const h24 = await job(appt.id, 'H24');
    expect(h24.status).toBe('SKIPPED');
    expect(h24.lastError).toBe('window');
    expect(fake.calls.some((c) => c.idempotencyKey === h24.id)).toBe(false);
    expect((await job(appt.id, 'H2')).status).toBe('SENT');
  });

  it('H24 is sent just before the 2 h mark', async () => {
    const appt = await book(a, scn, 'w@example.test', '07:00');
    const t = new Date(appt.startAt.getTime() - 2 * 60 * MIN - 1000);
    await runReminders(deps(t));
    expect((await job(appt.id, 'H24')).status).toBe('SENT');
  });

  it('H2 is skipped within 15 minutes of the start', async () => {
    const appt = await book(a, scn, 'w@example.test', '07:00');
    const t = new Date(appt.startAt.getTime() - 14 * MIN);
    await runReminders(deps(t));
    const h2 = await job(appt.id, 'H2');
    expect(h2.status).toBe('SKIPPED');
    expect(fake.calls.some((c) => c.idempotencyKey === h2.id)).toBe(false);
  });
});

describe('booking confirmation email', () => {
  it('is sent immediately with the .ics and signed confirm/cancel links', async () => {
    const appt = await book(a, scn, 'rana@example.test', '07:00');
    const run = await runReminders(deps(NOW));
    expect(run).toMatchObject({ claimed: 1, sent: 1 });
    const mail = fake.calls[0]!;
    expect(mail.to).toBe('rana@example.test');
    expect(mail.attachments).toHaveLength(1);
    const ics = mail.attachments![0]!;
    expect(ics.filename).toBe('appointment.ics');
    expect(ics.contentType).toContain('text/calendar');
    expect(ics.content).toContain(`UID:${appt.id}@maw3ed`);
    expect(ics.content).toContain('DTSTART:20261104T070000Z');
    expect(ics.content).toContain('\r\n');
    expect(mail.text).toContain('Alpha Salon');
    expect(mail.text).toContain('Wednesday 4 November 2026, 09:00');

    const links = [...mail.text.matchAll(/http:\/\/localhost:3000\/l\/(\S+)/g)].map((m) => m[1]!);
    expect(links).toHaveLength(2);
    const [confirm, cancel] = links;
    const ok = verifyToken(confirm!, secret(), NOW, 'confirm');
    expect(ok.ok && ok.payload.a).toBe(appt.id);
    expect(ok.ok && ok.payload.exp).toBe(Math.floor(appt.startAt.getTime() / 1000));
    expect(verifyToken(cancel!, secret(), NOW, 'cancel').ok).toBe(true);
    expect(verifyToken(cancel!, secret(), NOW, 'confirm').ok).toBe(false);
  });

  it('reminder emails carry no calendar attachment', async () => {
    const appt = await book(a, scn, 'r@example.test', '07:00');
    await runReminders(deps(new Date(appt.startAt.getTime() - 3 * 60 * MIN)));
    const h24 = await job(appt.id, 'H24');
    const mail = fake.calls.find((c) => c.idempotencyKey === h24.id)!;
    expect(mail.attachments).toBeUndefined();
  });
});

describe('failure handling', () => {
  it('backs off 1 then 5 minutes and is FAILED after the third attempt', async () => {
    const appt = await book();
    const t0 = NOW;
    fake.failNext = new Error('provider said: secret internals');
    const r1 = await runReminders(deps(t0));
    expect(r1).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    let row = await job(appt.id, 'BOOKING');
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(new Date(row.nextAttemptAt).getTime()).toBe(t0.getTime() + 1 * MIN);
    expect(row.lastError).toBe('send_error');
    expect(row.lastError).not.toContain('secret');

    // Inside the backoff window nothing is claimed.
    expect((await runReminders(deps(new Date(t0.getTime() + 30_000)))).claimed).toBe(0);

    const t1 = new Date(t0.getTime() + 1 * MIN);
    fake.failNext = new EmailSendError('resend_http_503', false);
    await runReminders(deps(t1));
    row = await job(appt.id, 'BOOKING');
    expect(row.attempts).toBe(2);
    expect(new Date(row.nextAttemptAt).getTime()).toBe(t1.getTime() + 5 * MIN);
    expect(row.lastError).toBe('resend_http_503');

    const t2 = new Date(t1.getTime() + 5 * MIN);
    fake.failNext = new EmailSendError('resend_http_503', false);
    const r3 = await runReminders(deps(t2));
    expect(r3.failed).toBe(1);
    row = await job(appt.id, 'BOOKING');
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(3);

    const later = await runReminders(deps(new Date(t2.getTime() + 60 * MIN)));
    expect(later.claimed).toBe(0);
    expect(fake.calls).toHaveLength(3);
  });

  it('a permanent provider error is FAILED at once', async () => {
    const appt = await book();
    fake.failNext = new EmailSendError('resend_http_422', true);
    await runReminders(deps(NOW));
    const row = await job(appt.id, 'BOOKING');
    expect(row).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'resend_http_422' });
  });

  it('a later success after a transient failure ends SENT', async () => {
    const appt = await book();
    fake.failNext = new Error('x');
    await runReminders(deps(NOW));
    await runReminders(deps(new Date(NOW.getTime() + 2 * MIN)));
    const row = await job(appt.id, 'BOOKING');
    expect(row.status).toBe('SENT');
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBeNull();
  });
});

describe('daily email budget (NFR-10)', () => {
  /** n SENT email rows today (UTC) on filler ATTENDED appointments, so they never touch the slot constraint. */
  async function fillBudget(n: number, sentAt: Date) {
    const client = await prisma.client.create({
      data: { businessId: a.businessId, name: 'Filler', phone: '+96170000000' },
    });
    const appts = Math.ceil(n / 3);
    const ids = Array.from({ length: appts }, (_, i) => `filler${String(i).padStart(3, '0')}`);
    await prisma.appointment.createMany({
      data: ids.map((id, i) => ({
        id,
        businessId: a.businessId,
        clientId: client.id,
        staffId: scn.staffIds[0]!,
        serviceId: scn.serviceId,
        startAt: new Date(Date.UTC(2026, 0, 1, 8, i)),
        endAt: new Date(Date.UTC(2026, 0, 1, 8, i + 1)),
        blockedUntil: new Date(Date.UTC(2026, 0, 1, 8, i + 1)),
        status: 'ATTENDED' as const,
      })),
    });
    const kinds = ['BOOKING', 'H24', 'H2'] as const;
    await prisma.reminderJob.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        businessId: a.businessId,
        appointmentId: ids[Math.floor(i / 3)]!,
        kind: kinds[i % 3]!,
        channel: 'EMAIL' as const,
        dueAt: sentAt,
        status: 'SENT' as const,
        sentAt,
      })),
    });
  }
  const warnLogger = () => {
    const warn = vi.fn();
    return { logger: { info: vi.fn(), warn, error: vi.fn() } as unknown as Logger, warn };
  };

  it('warns at 80 sent today but still sends everything', async () => {
    const appt = await book();
    const t = new Date('2026-11-02T20:00:00Z');
    await fillBudget(80, new Date('2026-11-02T09:00:00Z'));
    const { logger, warn } = warnLogger();
    const run = await runReminders(deps(t, fake, logger));
    expect(run.sent).toBe(1);
    expect(warn).toHaveBeenCalled();
    expect((await job(appt.id, 'BOOKING')).status).toBe('SENT');
  });

  it('yesterday’s emails do not count', async () => {
    const appt = await book();
    await fillBudget(99, new Date('2026-11-01T22:00:00Z'));
    await runReminders(deps(new Date('2026-11-02T08:00:00Z')));
    expect((await job(appt.id, 'BOOKING')).status).toBe('SENT');
  });

  it('at 95 the booking confirmation is skipped before any reminder', async () => {
    const appt = await book(a, scn, 'b@example.test', '07:00');
    // 94 sent today; H24 (a reminder) and BOOKING are both due. The reminder sends first -> 95 -> BOOKING skipped.
    const t = new Date('2026-11-03T08:00:00Z');
    await fillBudget(94, new Date('2026-11-03T06:00:00Z'));
    const run = await runReminders(deps(t));
    expect(run).toMatchObject({ claimed: 2, sent: 1, skipped: 1 });
    expect((await job(appt.id, 'H24')).status).toBe('SENT');
    const booking = await job(appt.id, 'BOOKING');
    expect(booking.status).toBe('SKIPPED');
    expect(booking.lastError).toBe('budget');
    expect(fake.calls).toHaveLength(1);
  });
});

describe('cron auth', () => {
  const secretValue = () => process.env.CRON_SECRET!;
  const run = (headers: Record<string, string>) =>
    call(remindersJob, '/api/jobs/reminders', { method: 'POST', headers });

  it('requires the cron secret', async () => {
    await book();
    expect((await run({})).status).toBe(401);
    expect((await run({ 'x-cron-secret': 'wrong' })).status).toBe(401);
    expect((await run({ 'x-cron-secret': `${secretValue()}x` })).status).toBe(401);
    expect(fake.calls).toHaveLength(0);
    const okRes = await run({ 'x-cron-secret': secretValue() });
    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({ claimed: 1, sent: 1, skipped: 0, failed: 0, requeued: 0 });
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects unknown query parameters and a missing CRON_SECRET', async () => {
    const bad = await call(remindersJob, '/api/jobs/reminders', {
      method: 'POST',
      query: { force: '1' },
      headers: { 'x-cron-secret': secretValue() },
    });
    expect(bad.status).toBe(400);
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect((await run({ 'x-cron-secret': 'anything' })).status).toBe(401);
      expect((await run({ 'x-cron-secret': '' })).status).toBe(401);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it('waitlist-expiry is a cron-guarded stub', async () => {
    const r = (headers: Record<string, string>) =>
      call(expiryJob, '/api/jobs/waitlist-expiry', { method: 'POST', headers });
    expect((await r({})).status).toBe(401);
    const okRes = await r({ 'x-cron-secret': secretValue() });
    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({ expired: 0 });
  });
});

describe('tenant', () => {
  it('each email is built from its own job’s business (name, locale, direction)', async () => {
    const b = await newTenant({ businessName: 'Beta Clinic' });
    const bScn = await newScenario(prisma, b);
    await pg.query(`UPDATE "Business" SET locale = 'ar' WHERE id = $1`, [b.businessId]);
    const aAppt = await book(a, scn, 'a@example.test', '07:00');
    const bAppt = await book(b, bScn, 'b@example.test', '07:00');
    await runReminders(deps(NOW));

    const aMail = fake.calls.find((c) => c.to === 'a@example.test')!;
    const bMail = fake.calls.find((c) => c.to === 'b@example.test')!;
    expect(aMail.html).toContain('Alpha Salon');
    expect(aMail.html + aMail.text).not.toContain('Beta Clinic');
    expect(aMail.html).toContain('dir="ltr"');
    expect(bMail.html).toContain('Beta Clinic');
    expect(bMail.html + bMail.text).not.toContain('Alpha Salon');
    expect(bMail.html).toContain('dir="rtl"');
    const tokenOf = (m: { text: string }) => /\/l\/(\S+)/.exec(m.text)![1]!;
    const pa = verifyToken(tokenOf(aMail), secret(), NOW, 'confirm');
    const pb = verifyToken(tokenOf(bMail), secret(), NOW, 'confirm');
    expect(pa.ok && pa.payload.a).toBe(aAppt.id);
    expect(pb.ok && pb.payload.a).toBe(bAppt.id);
  });

  it('only due rows are touched', async () => {
    const appt = await book();
    await runReminders(deps(NOW));
    expect((await job(appt.id, 'H24')).status).toBe('PENDING');
    expect((await job(appt.id, 'H2')).status).toBe('PENDING');
    expect((await job(appt.id, 'H24', 'WHATSAPP')).status).toBe('PENDING');
    expect((await job(appt.id, 'BOOKING')).status).toBe('SENT');
  });
});
