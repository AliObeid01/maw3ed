import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { GET as dashboardSummary } from '@/app/api/dashboard/summary/route';
import { POST as markSent } from '@/app/api/reminders/[id]/mark-sent/route';
import { GET as whatsappDue } from '@/app/api/reminders/whatsapp-due/route';
import { verifyToken } from '@/server/domain/tokens';
import { rootLogger } from '@/server/http/logger';
import { fakeEmailProvider } from '@/server/providers/email';
import { reminderJobRepo } from '@/server/repositories/reminderJob.repo';
import { book, defaultBookDeps } from '@/server/services/booking';
import { runReminders, type ReminderDeps } from '@/server/services/reminders';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  newKey,
  newScenario,
  newTenant,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;

const MIN = 60_000;
const secret = () => process.env.LINK_SECRET!;
/** The slot used throughout: Wed 4 Nov 2026, 07:00Z = 09:00 Beirut. */
const START = new Date('2026-11-04T07:00:00Z');
const startMinus = (ms: number) => new Date(START.getTime() - ms);
const list = (cookie?: string) => call(whatsappDue, '/api/reminders/whatsapp-due', { cookie });
const badge = async (cookie: string) =>
  (await call(dashboardSummary, '/api/dashboard/summary', { cookie })).body!.whatsappDue as number;
const mark = (cookie: string | undefined, id: string) =>
  call(markSent, `/api/reminders/${id}/mark-sent`, { method: 'POST', cookie, params: { id } });

const emailDeps = (now: Date): ReminderDeps => ({
  now: () => now,
  provider: () => fakeEmailProvider,
  linkSecret: secret,
  appUrl: () => 'http://localhost:3000',
  logger: rootLogger,
});

/** A public booking of the 07:00Z slot made `leadMs` before it. */
async function bookPublic(leadMs: number, tenant = a, scn = aScn, extra: Record<string, unknown> = {}) {
  vi.setSystemTime(startMinus(leadMs));
  const res = await bookPublicly(
    tenant.slug,
    bookingBody(scn.serviceId, scn.staffIds[0]!, START.toISOString(), { name: 'Layla', ...extra }),
  );
  expect(res.status).toBe(201);
  return res;
}
const jobs = async (appointmentId: string) =>
  (
    await pg.query(
      `SELECT kind, channel, status, "dueAt" FROM "ReminderJob" WHERE "appointmentId" = $1 ORDER BY kind, channel`,
      [appointmentId],
    )
  ).rows as { kind: string; channel: string; status: string; dueAt: Date }[];
const lateJobs = async (appointmentId: string) =>
  (await jobs(appointmentId)).filter((j) => j.kind === 'LATE');

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: startMinus(75 * MIN) });
  a = await newTenant({ businessName: 'Alpha Salon' });
  b = await newTenant({ businessName: 'Beta Clinic' });
  aScn = await newScenario(prisma, a);
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
  fakeEmailProvider.reset();
  vi.setSystemTime(startMinus(75 * MIN));
});

describe('F68 LATE job creation', () => {
  it('a PUBLIC booking 75 min ahead creates exactly one WHATSAPP LATE job, due at the booking time, and no H24/H2', async () => {
    const res = await bookPublic(75 * MIN);
    const id = res.body!.appointment.id as string;
    expect(await jobs(id)).toEqual([
      { kind: 'BOOKING', channel: 'EMAIL', status: 'PENDING', dueAt: startMinus(75 * MIN) },
      { kind: 'LATE', channel: 'WHATSAPP', status: 'PENDING', dueAt: startMinus(75 * MIN) },
    ]);
    // The F44 promise ignores it: nothing is promised to the client.
    expect(res.body!.reminders).toEqual({ h24: false, h2: false, email: true });
  });

  it('2 h and 24 h ahead create none (the H24/H2 reminders cover those)', async () => {
    const two = await bookPublic(120 * MIN);
    expect(await lateJobs(two.body!.appointment.id)).toEqual([]);
    expect((await jobs(two.body!.appointment.id)).map((j) => `${j.kind}/${j.channel}`)).toContain(
      'H2/WHATSAPP',
    );
    await pg.query('DELETE FROM "ReminderJob"');
    await pg.query('DELETE FROM "Appointment"');
    const day = await bookPublic(24 * 60 * MIN);
    expect(await lateJobs(day.body!.appointment.id)).toEqual([]);
  });

  it('a front-desk booking 75 min ahead creates none', async () => {
    const res = await bookAtFrontDesk(
      a.cookie,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, START.toISOString(), { email: undefined }),
    );
    expect(res.status).toBe(201);
    expect(await lateJobs(res.body!.appointment.id)).toEqual([]);
    expect((await list(a.cookie)).body).toEqual({ count: 0, items: [] });
  });

  it('a waitlist-claim booking (source WAITLIST) 75 min ahead creates none', async () => {
    const res = await book(
      { businessId: a.businessId, requestId: 'test', logger: rootLogger },
      {
        serviceId: aScn.serviceId,
        staffId: aScn.staffIds[0]!,
        startAt: START,
        client: { name: 'Wendy', phone: '+96171555123', email: 'wendy@example.test' },
        source: 'WAITLIST',
      },
      defaultBookDeps,
    );
    expect(res.appointment.id).toBeTruthy();
    expect(await lateJobs(res.appointment.id)).toEqual([]);
  });

  it('two concurrent identical requests (same Idempotency-Key) still produce one booking and one LATE job', async () => {
    const body = bookingBody(aScn.serviceId, aScn.staffIds[0]!, START.toISOString(), { name: 'Layla' });
    const key = newKey();
    const [r1, r2] = await Promise.all([
      bookPublicly(a.slug, body, key),
      bookPublicly(a.slug, body, key),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body!.appointment.id).toBe(r2.body!.appointment.id);
    const all = await pg.query(`SELECT 1 FROM "ReminderJob" WHERE kind = 'LATE'`);
    expect(all.rowCount).toBe(1);
  });

  it('the unique key (appointmentId, kind, channel) stops a repeated insert of the same LATE row', async () => {
    const res = await bookPublic(75 * MIN);
    const id = res.body!.appointment.id as string;
    const late = { kind: 'LATE', channel: 'WHATSAPP', dueAt: new Date() } as const;
    await Promise.all(
      [1, 2, 3].map(() =>
        prisma.$transaction((tx) => reminderJobRepo.createForAppointment(a.businessId, tx, id, [late])),
      ),
    );
    expect(await lateJobs(id)).toHaveLength(1);
  });
});

describe('F68 LATE on the receptionist list', () => {
  it('appears immediately with a confirmation-style text, both signed links and the badge count', async () => {
    const res = await bookPublic(75 * MIN, a, aScn, { phone: '71 123 456' });
    const id = res.body!.appointment.id as string;
    const out = await list(a.cookie);
    expect(out.status).toBe(200);
    expect(out.body!.count).toBe(1);
    const item = out.body!.items[0];
    expect(item).toMatchObject({
      kind: 'LATE',
      dueAt: startMinus(75 * MIN).toISOString(),
      appointment: { id, startAt: START.toISOString() },
      client: { name: 'Layla', phone: '+96171123456' },
      status: 'PENDING',
      phoneInvalid: false,
    });
    expect(await badge(a.cookie)).toBe(1);

    const text = new URL(item.whatsappUrl).searchParams.get('text')!;
    expect(text).toContain('Hi Layla, your ');
    expect(text).toContain('is booked for Wednesday 4 November 2026, 09:00');
    expect(text).toContain('at Alpha Salon');
    expect(text).not.toMatch(/reminder/i);
    const urls = [...text.matchAll(/http:\/\/localhost:3000\/l\/(\S+)/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(2);
    const now = new Date();
    expect(verifyToken(urls[0]!, secret(), now, 'confirm').ok).toBe(true);
    expect(verifyToken(urls[1]!, secret(), now, 'cancel').ok).toBe(true);
  });

  it('uses the Arabic text for an Arabic business', async () => {
    const t = await newTenant({ businessName: 'Gamma' });
    const scn = await newScenario(prisma, t);
    await pg.query(`UPDATE "Business" SET locale = 'ar' WHERE id = $1`, [t.businessId]);
    await bookPublic(75 * MIN, t, scn);
    const item = (await list(t.cookie)).body!.items[0];
    const text = new URL(item.whatsappUrl).searchParams.get('text')!;
    expect(item.kind).toBe('LATE');
    expect(text).toContain('تم حجز موعد');
    expect(text).not.toContain('تذكير');
  });

  it('stays listed until the appointment starts (still there at start - 5 min), gone at the start', async () => {
    await bookPublic(75 * MIN);
    vi.setSystemTime(startMinus(20 * MIN));
    expect((await list(a.cookie)).body!.count).toBe(1);
    vi.setSystemTime(startMinus(5 * MIN));
    expect((await list(a.cookie)).body!.count).toBe(1);
    expect(await badge(a.cookie)).toBe(1);
    vi.setSystemTime(startMinus(1000));
    expect((await list(a.cookie)).body!.count).toBe(1);
    vi.setSystemTime(START);
    expect((await list(a.cookie)).body).toEqual({ count: 0, items: [] });
    expect(await badge(a.cookie)).toBe(0);
    vi.setSystemTime(new Date(START.getTime() + 10 * MIN));
    expect((await list(a.cookie)).body!.items).toEqual([]);
  });

  it('disappears when the appointment is cancelled', async () => {
    const res = await bookPublic(75 * MIN);
    const id = res.body!.appointment.id as string;
    expect((await list(a.cookie)).body!.count).toBe(1);
    const cancelled = await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie: a.cookie,
      params: { id },
    });
    expect(cancelled.status).toBe(200);
    expect((await list(a.cookie)).body).toEqual({ count: 0, items: [] });
    expect(await badge(a.cookie)).toBe(0);
  });

  it('once marked sent it is SENT (visible 12 h like the others) and cannot be marked twice', async () => {
    await bookPublic(75 * MIN);
    const item = (await list(a.cookie)).body!.items[0];
    const first = await mark(a.cookie, item.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: item.id, status: 'SENT' });
    const after = (await list(a.cookie)).body!;
    expect(after.count).toBe(0);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ kind: 'LATE', status: 'SENT' });
    expect((await mark(a.cookie, item.id)).status).toBe(409);
    // Still visible 11 h later (the appointment has started, but a SENT row follows the 12 h rule)...
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * MIN));
    expect((await list(a.cookie)).body!.items).toHaveLength(1);
    // ...and gone after 12 h.
    vi.setSystemTime(new Date(Date.now() + 2 * 60 * MIN));
    expect((await list(a.cookie)).body!.items).toHaveLength(0);
  });

  it('tenant isolation: another business gets 404 on mark-sent, and a malformed id is a 400', async () => {
    await bookPublic(75 * MIN);
    const item = (await list(a.cookie)).body!.items[0];
    const other = await mark(b.cookie, item.id);
    expect(other.status).toBe(404);
    expect(other.body!.error.code).toBe('NOT_FOUND');
    // The other business's list never shows it; the row is untouched.
    expect((await list(b.cookie)).body).toEqual({ count: 0, items: [] });
    expect((await list(a.cookie)).body!.items[0].status).toBe('PENDING');
    const bad = await mark(a.cookie, 'not-a-cuid');
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields.id).toBeTruthy();
  });

  it('401 without a session', async () => {
    expect((await list(undefined)).status).toBe(401);
  });
});

describe('F68 the email runner never sends a LATE job', () => {
  it('the booking email goes out once; the LATE row stays PENDING for the receptionist', async () => {
    const res = await bookPublic(75 * MIN);
    const id = res.body!.appointment.id as string;
    const run = await runReminders(emailDeps(new Date()));
    expect(run).toMatchObject({ claimed: 1, sent: 1 });
    expect(fakeEmailProvider.calls).toHaveLength(1);
    expect(fakeEmailProvider.calls[0]!.subject).toMatch(/^Your slot is booked: /);
    expect((await lateJobs(id))[0]).toMatchObject({ channel: 'WHATSAPP', status: 'PENDING' });
  });

  it('a (never created) EMAIL LATE row is skipped with a reason and sends nothing', async () => {
    const res = await bookPublic(75 * MIN);
    const id = res.body!.appointment.id as string;
    await runReminders(emailDeps(new Date()));
    fakeEmailProvider.reset();
    const rogue = await prisma.reminderJob.create({
      data: {
        businessId: a.businessId,
        appointmentId: id,
        kind: 'LATE',
        channel: 'EMAIL',
        dueAt: new Date(),
      },
    });
    const run = await runReminders(emailDeps(new Date()));
    expect(run).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(fakeEmailProvider.calls).toHaveLength(0);
    const row = await prisma.reminderJob.findUniqueOrThrow({ where: { id: rogue.id } });
    expect(row).toMatchObject({ status: 'SKIPPED', lastError: 'whatsapp_only' });
  });
});
