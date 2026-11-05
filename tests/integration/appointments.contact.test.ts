import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { PATCH as patchContact } from '@/app/api/appointments/[id]/contact/route';
import { rootLogger } from '@/server/http/logger';
import { fakeEmailProvider } from '@/server/providers/email';
import { runReminders, type ReminderDeps } from '@/server/services/reminders';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  newScenario,
  newTenant,
  NOW,
  removeEmail,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { staffSession } from './helpers/waitlist';

/** F69-C: PATCH /api/appointments/{id}/contact changes THIS booking's contactEmail / contactName only. */
let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;

const SLOT = at('07:00'); // 47 h after NOW
const NEW = 'fixed.address@gmail.test';
const MIN = 60_000;
const HOUR = 60 * MIN;

const patch = (cookie: string | undefined, id: string, body: unknown) =>
  call(patchContact, `/api/appointments/${id}/contact`, {
    method: 'PATCH',
    cookie,
    params: { id },
    body,
  });
const one = (id: string) =>
  call(getAppointment, `/api/appointments/${id}`, { cookie: a.cookie, params: { id } });
const deps = (now: Date): ReminderDeps => ({
  now: () => now,
  provider: () => fakeEmailProvider,
  linkSecret: () => process.env.LINK_SECRET!,
  appUrl: () => 'http://localhost:3000',
  logger: rootLogger,
});
const jobs = async (id: string) =>
  (
    await pg.query(
      `SELECT kind, status, "lastError", attempts, id FROM "ReminderJob"
       WHERE "appointmentId" = $1 AND channel = 'EMAIL' ORDER BY kind`,
      [id],
    )
  ).rows as { kind: string; status: string; lastError: string | null; attempts: number; id: string }[];
const row = async (id: string) =>
  (
    await pg.query(
      `SELECT a."contactEmail", a."contactName", c.email AS "cEmail", c.name AS "cName", c.phone AS "cPhone"
       FROM "Appointment" a JOIN "Client" c ON c.id = a."clientId" WHERE a.id = $1`,
      [id],
    )
  ).rows[0];

async function frontDesk(over: Record<string, unknown> = {}, start = SLOT) {
  const r = await bookAtFrontDesk(
    a.cookie,
    bookingBody(scn.serviceId, scn.staffIds[0]!, start, over),
  );
  if (r.status !== 201) throw new Error(`book ${r.status} ${JSON.stringify(r.body)}`);
  return r.body!.appointment.id as string;
}
async function publicly(over: Record<string, unknown> = {}, start = SLOT) {
  const r = await bookPublicly(a.slug, bookingBody(scn.serviceId, scn.staffIds[0]!, start, over));
  if (r.status !== 201) throw new Error(`book ${r.status} ${JSON.stringify(r.body)}`);
  return r.body!.appointment.id as string;
}

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant();
  b = await newTenant();
  scn = await newScenario(prisma, a);
  bScn = await newScenario(prisma, b);
  staffCookie = await staffSession(a.cookie);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  for (const t of ['ReminderJob', 'Payment', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  fakeEmailProvider.reset();
  vi.setSystemTime(NOW);
});

describe('validation and access', () => {
  it('400: empty body, unknown field, bad email, bad name, null-only public email', async () => {
    const id = await frontDesk();
    const empty = await patch(a.cookie, id, {});
    expect(empty.status).toBe(400);
    expect(empty.body!.error.code).toBe('VALIDATION_FAILED');
    const unknown = await patch(a.cookie, id, { contactEmail: NEW, phone: '+96171000000' });
    expect(unknown.status).toBe(400);
    expect(unknown.body!.error.fields.phone).toBeTruthy();
    const bad = await patch(a.cookie, id, { contactEmail: 'not-an-email' });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.fields.contactEmail).toBeTruthy();
    const blank = await patch(a.cookie, id, { contactEmail: '   ' });
    expect(blank.status).toBe(400);
    const longName = await patch(a.cookie, id, { contactName: 'x'.repeat(81) });
    expect(longName.status).toBe(400);
    expect(longName.body!.error.fields.contactName).toBeTruthy();
    const emptyName = await patch(a.cookie, id, { contactName: '  ' });
    expect(emptyName.status).toBe(400);
    expect((await row(id)).contactEmail).not.toBe(NEW);
  });

  it('400 on fields.contactEmail when a PUBLIC appointment tries to clear its email', async () => {
    const id = await publicly({ email: 'pub@example.test' });
    const res = await patch(a.cookie, id, { contactEmail: null });
    expect(res.status).toBe(400);
    expect(res.body!.error.fields.contactEmail).toBeTruthy();
    expect((await row(id)).contactEmail).toBe('pub@example.test');
  });

  it('a front-desk appointment may clear its email', async () => {
    const id = await frontDesk({ email: 'fd@example.test' });
    const res = await patch(a.cookie, id, { contactEmail: null });
    expect(res.status).toBe(200);
    expect((await row(id)).contactEmail).toBeNull();
  });

  it('401 without a session', async () => {
    const id = await frontDesk();
    expect((await patch(undefined, id, { contactEmail: NEW })).status).toBe(401);
  });

  it('404 for another business appointment, with no leak and no change', async () => {
    const theirs = await bookPublicly(
      b.slug,
      bookingBody(bScn.serviceId, bScn.staffIds[0]!, SLOT, { email: 'b@x.test' }),
    );
    const id = theirs.body!.appointment.id as string;
    const res = await patch(a.cookie, id, { contactEmail: NEW });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('b@x.test');
    expect((await row(id)).contactEmail).toBe('b@x.test');
  });

  it('OWNER and STAFF may edit; the email is trimmed and lowercased', async () => {
    const id = await frontDesk();
    const o = await patch(a.cookie, id, { contactEmail: '  Owner.Fix@Gmail.Test ' });
    expect(o.status).toBe(200);
    expect(o.body!.appointment.reminderEmail).toBe('owner.fix@gmail.test');
    const s = await patch(staffCookie, id, { contactName: '  Rana  ' });
    expect(s.status).toBe(200);
    expect((await row(id)).contactName).toBe('Rana');
    expect((await row(id)).contactEmail).toBe('owner.fix@gmail.test');
  });
});

describe('409 APPOINTMENT_NOT_EDITABLE', () => {
  it('past, cancelled and attended appointments cannot be edited', async () => {
    const future = await frontDesk();
    vi.setSystemTime(new Date(SLOT.replace('07:00', '07:30')));
    const past = await patch(a.cookie, future, { contactEmail: NEW });
    expect(past.status).toBe(409);
    expect(past.body!.error.code).toBe('APPOINTMENT_NOT_EDITABLE');
    vi.setSystemTime(NOW);

    const cancelled = await frontDesk({}, at('08:00'));
    await pg.query(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = $1`, [cancelled]);
    expect((await patch(a.cookie, cancelled, { contactEmail: NEW })).status).toBe(409);

    const attended = await frontDesk({}, at('09:00'));
    await pg.query(`UPDATE "Appointment" SET status = 'ATTENDED' WHERE id = $1`, [attended]);
    const res = await patch(a.cookie, attended, { contactEmail: NEW });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('APPOINTMENT_NOT_EDITABLE');
    expect((await row(attended)).contactEmail).not.toBe(NEW);
  });

  it('a CONFIRMED appointment can be edited', async () => {
    const id = await frontDesk();
    await pg.query(`UPDATE "Appointment" SET status = 'CONFIRMED' WHERE id = $1`, [id]);
    expect((await patch(a.cookie, id, { contactEmail: NEW })).status).toBe(200);
  });
});

describe('what it changes', () => {
  it('touches only the appointment: the Client record (email, name, phone) is untouched', async () => {
    const phone = '71 555001';
    const id = await frontDesk({ name: 'Record Name', phone, email: 'record@example.test' });
    const before = await row(id);
    const res = await patch(a.cookie, id, { contactEmail: NEW, contactName: 'Typed Name' });
    expect(res.status).toBe(200);
    const after = await row(id);
    expect(after.contactEmail).toBe(NEW);
    expect(after.contactName).toBe('Typed Name');
    expect(after.cEmail).toBe(before.cEmail);
    expect(after.cName).toBe(before.cName);
    expect(after.cPhone).toBe(before.cPhone);
  });

  it('GET reminderEmail / reminderEmailDiffers reflect the change (staff-only line)', async () => {
    const id = await frontDesk({ email: 'record@example.test' });
    expect((await one(id)).body!.appointment.reminderEmailDiffers).toBe(false);
    const res = await patch(a.cookie, id, { contactEmail: NEW });
    expect(res.body!.appointment.reminderEmail).toBe(NEW);
    expect(res.body!.appointment.reminderEmailDiffers).toBe(true);
    const got = (await one(id)).body!.appointment;
    expect(got.reminderEmail).toBe(NEW);
    expect(got.reminderEmailDiffers).toBe(true);
  });
});

describe('reminders', () => {
  it('a pending H24 goes to the corrected address; same job row, no new rows', async () => {
    const id = await publicly({ email: 'typo@gmial.test' });
    const before = await jobs(id);
    await patch(a.cookie, id, { contactEmail: NEW });
    const after = await jobs(id);
    expect(after.map((j) => j.id)).toEqual(before.map((j) => j.id));
    // H24 is due at SLOT - 24 h
    const run = await runReminders(deps(new Date(new Date(SLOT).getTime() - 24 * HOUR + MIN)));
    expect(run.sent).toBeGreaterThanOrEqual(1);
    const h24 = fakeEmailProvider.calls.filter((c) => /\/l\//.test(c.text));
    expect(h24.length).toBeGreaterThan(0);
    expect(fakeEmailProvider.calls.every((c) => c.to === NEW)).toBe(true);
    expect(fakeEmailProvider.calls.some((c) => c.to === 'typo@gmial.test')).toBe(false);
  });

  async function skippedNoEmail() {
    const id = await frontDesk({ email: undefined });
    // The H24 job comes due while the appointment has no address: skipped as no_email.
    const t1 = new Date(new Date(SLOT).getTime() - 24 * HOUR + MIN);
    await runReminders(deps(t1));
    const j = await jobs(id);
    expect(j.find((x) => x.kind === 'H24')).toMatchObject({ status: 'SKIPPED', lastError: 'no_email' });
    return { id, t1 };
  }

  it('adding an email re-queues the no_email-skipped H24 exactly once, and it is then sent', async () => {
    const { id, t1 } = await skippedNoEmail();
    vi.setSystemTime(t1);
    const before = await jobs(id);
    const res = await patch(a.cookie, id, { contactEmail: NEW });
    expect(res.status).toBe(200);
    const after = await jobs(id);
    expect(after.length).toBe(before.length);
    expect(after.map((j) => j.id)).toEqual(before.map((j) => j.id));
    expect(after.find((x) => x.kind === 'H24')).toMatchObject({ status: 'PENDING', lastError: null });
    // BOOKING is never retroactive: still skipped.
    expect(after.find((x) => x.kind === 'BOOKING')?.status).toBe('SKIPPED');

    fakeEmailProvider.reset();
    const run = await runReminders(deps(new Date(t1.getTime() + MIN)));
    expect(run.sent).toBe(1);
    expect(fakeEmailProvider.calls).toHaveLength(1);
    expect(fakeEmailProvider.calls[0]!.to).toBe(NEW);
    // A second edit of the address does not re-queue the now SENT job.
    await patch(a.cookie, id, { contactEmail: 'again@gmail.test' });
    expect((await jobs(id)).find((x) => x.kind === 'H24')?.status).toBe('SENT');
    fakeEmailProvider.reset();
    expect((await runReminders(deps(new Date(t1.getTime() + 2 * MIN)))).sent).toBe(0);
  });

  it('does not re-queue an H24 that is no longer sendable, or skipped for another reason', async () => {
    const { id } = await skippedNoEmail();
    // Past the H24 window (start - 2 h): sendDecision says SKIP.
    vi.setSystemTime(new Date(new Date(SLOT).getTime() - 90 * MIN));
    await patch(a.cookie, id, { contactEmail: NEW });
    expect((await jobs(id)).find((x) => x.kind === 'H24')?.status).toBe('SKIPPED');
    // Another reason ('window') stays skipped even when sendable now.
    vi.setSystemTime(NOW);
    await pg.query(
      `UPDATE "ReminderJob" SET "lastError" = 'budget' WHERE "appointmentId" = $1 AND kind = 'H24' AND channel = 'EMAIL'`,
      [id],
    );
    await patch(a.cookie, id, { contactEmail: 'other@gmail.test' });
    expect((await jobs(id)).find((x) => x.kind === 'H24')?.status).toBe('SKIPPED');
  });

  it('changing an existing address (not adding one) re-queues nothing', async () => {
    const id = await publicly({ email: 'first@gmail.test' });
    await pg.query(
      `UPDATE "ReminderJob" SET status = 'SKIPPED', "lastError" = 'no_email' WHERE "appointmentId" = $1 AND kind = 'H24' AND channel = 'EMAIL'`,
      [id],
    );
    await patch(a.cookie, id, { contactEmail: NEW });
    expect((await jobs(id)).find((x) => x.kind === 'H24')?.status).toBe('SKIPPED');
  });

  it('concurrent identical PATCHes re-queue once and never duplicate jobs', async () => {
    const { id, t1 } = await skippedNoEmail();
    vi.setSystemTime(t1);
    const before = await jobs(id);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => patch(a.cookie, id, { contactEmail: NEW })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const after = await jobs(id);
    expect(after.length).toBe(before.length);
    expect(after.filter((j) => j.kind === 'H24' && j.status === 'PENDING')).toHaveLength(1);
    fakeEmailProvider.reset();
    const run = await runReminders(deps(new Date(t1.getTime() + MIN)));
    expect(run.sent).toBe(1);
  });

  it('removeEmail helper still leaves the no_email rule intact for a record-email fallback', async () => {
    const id = await frontDesk({ email: 'record@example.test' });
    await removeEmail(pg, id, false);
    expect((await one(id)).body!.appointment.reminderEmail).toBe('record@example.test');
  });
});
