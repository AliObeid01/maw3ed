import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as whatsappDue } from '@/app/api/reminders/whatsapp-due/route';
import { rootLogger } from '@/server/http/logger';
import { EmailSendError, fakeEmailProvider } from '@/server/providers/email';
import { getEmailMessages } from '@/server/i18n/messages';
import { runReminders, type ReminderDeps } from '@/server/services/reminders';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import { at, bookingBody, bookPublicly, newScenario, newTenant, NOW, type Tenant } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
const fake = fakeEmailProvider;
const MIN = 60_000;
const msgs = getEmailMessages('en');

const deps = (now: Date): ReminderDeps => ({
  now: () => now,
  provider: () => fake,
  linkSecret: () => process.env.LINK_SECRET!,
  appUrl: () => 'http://localhost:3000',
  logger: rootLogger,
});

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
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
  vi.setSystemTime(NOW);
});

/** Books 47 h after NOW (so H24 falls due at NOW + 23 h). */
async function book() {
  const res = await bookPublicly(
    a.slug,
    bookingBody(scn.serviceId, scn.staffIds[0]!, at('08:00'), { email: 'rana@example.test' }),
  );
  expect(res.status).toBe(201);
  const id = res.body!.appointment.id as string;
  const job = (
    await pg.query(`SELECT * FROM "ReminderJob" WHERE "appointmentId" = $1 AND kind = 'H24' AND channel = 'EMAIL'`, [id])
  ).rows[0];
  return { id, jobId: job.id as string, dueAt: new Date(job.dueAt as string) };
}
const confirmAt = (id: string, when: Date) =>
  pg.query(`UPDATE "Appointment" SET status = 'CONFIRMED', "confirmedAt" = $2 WHERE id = $1`, [id, when]);
const h24Calls = (jobId: string) => fake.calls.filter((c) => c.idempotencyKey === jobId);

describe('H24 reminder after the client confirmed', () => {
  it('confirmed before the job fell due: Cancel only and the confirmed note', async () => {
    const b = await book();
    await confirmAt(b.id, new Date(b.dueAt.getTime() - 60 * MIN));
    await runReminders(deps(new Date(b.dueAt.getTime() + MIN)));
    const sent = h24Calls(b.jobId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(msgs.confirmedNote);
    expect(sent[0]!.text).not.toContain(msgs.actions.confirm);
    expect(sent[0]!.html).not.toContain(msgs.actions.confirm);
    expect(sent[0]!.html).toContain(msgs.actions.cancel);
    expect(sent[0]!.text.match(/\/l\//g)).toHaveLength(1);
  });

  it('confirmed AFTER the job fell due stays the normal variant (both links)', async () => {
    const b = await book();
    await confirmAt(b.id, new Date(b.dueAt.getTime() + 5 * MIN));
    await runReminders(deps(new Date(b.dueAt.getTime() + 10 * MIN)));
    const sent = h24Calls(b.jobId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(msgs.actions.confirm);
    expect(sent[0]!.text).not.toContain(msgs.confirmedNote);
    expect(sent[0]!.text.match(/\/l\//g)).toHaveLength(2);
  });

  it('not confirmed: the normal variant', async () => {
    const b = await book();
    await runReminders(deps(new Date(b.dueAt.getTime() + MIN)));
    expect(h24Calls(b.jobId)[0]!.text).toContain(msgs.actions.confirm);
  });

  it('a retried send is byte-for-byte identical, even if the client confirms between the attempts', async () => {
    const b = await book();
    const t0 = new Date(b.dueAt.getTime() + MIN);
    await confirmAt(b.id, new Date(b.dueAt.getTime() - 5 * MIN));
    fake.failNext = new EmailSendError('resend_http_503', false);
    await runReminders(deps(t0));
    // A later (second) confirmation attempt cannot happen (BOOKED -> CONFIRMED only once), but even a rewritten
    // timestamp after dueAt must not change an already-decided variant for a row confirmed earlier; here we keep it.
    await runReminders(deps(new Date(t0.getTime() + 2 * MIN)));
    const sent = h24Calls(b.jobId);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe(sent[0]!.subject);
    expect(sent[1]!.text).toBe(sent[0]!.text);
    expect(sent[1]!.html).toBe(sent[0]!.html);
    expect(sent[1]!.idempotencyKey).toBe(sent[0]!.idempotencyKey);
  });

  it('a retry of the NORMAL variant stays normal when the client confirms after the first attempt', async () => {
    const b = await book();
    const t0 = new Date(b.dueAt.getTime() + MIN);
    fake.failNext = new EmailSendError('resend_http_503', false);
    await runReminders(deps(t0));
    await confirmAt(b.id, new Date(t0.getTime() + 30_000)); // after dueAt
    await runReminders(deps(new Date(t0.getTime() + 2 * MIN)));
    const sent = h24Calls(b.jobId);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toBe(sent[0]!.text);
    expect(sent[1]!.html).toBe(sent[0]!.html);
    expect(sent[1]!.text).toContain(msgs.actions.confirm);
  });
});

describe('receptionist WhatsApp list', () => {
  it('flags confirmed appointments and drops the Confirm line when confirmed before the job was due', async () => {
    const b = await book();
    const wa = (
      await pg.query(`SELECT * FROM "ReminderJob" WHERE "appointmentId" = $1 AND kind = 'H24' AND channel = 'WHATSAPP'`, [b.id])
    ).rows[0];
    expect(wa).toBeTruthy();
    const waDue = new Date(wa.dueAt as string);
    vi.setSystemTime(new Date(waDue.getTime() + 5 * MIN));

    const before = await call(whatsappDue, '/api/reminders/whatsapp-due', { cookie: a.cookie });
    expect(before.status).toBe(200);
    const item0 = before.body!.items.find((i: { id: string }) => i.id === wa.id);
    expect(item0.confirmed).toBe(false);
    expect(decodeURIComponent(item0.whatsappUrl)).toContain('Confirm:');

    await confirmAt(b.id, new Date(waDue.getTime() - 60 * MIN));
    const after = await call(whatsappDue, '/api/reminders/whatsapp-due', { cookie: a.cookie });
    const item1 = after.body!.items.find((i: { id: string }) => i.id === wa.id);
    expect(item1.confirmed).toBe(true);
    const text = decodeURIComponent(item1.whatsappUrl);
    expect(text).not.toContain('Confirm:');
    expect(text).toContain(msgs.confirmedNote);
    expect(text).toContain('Cancel:');

    // Confirmed only AFTER the job fell due: the chip shows (live state) but the text keeps the Confirm line.
    await confirmAt(b.id, new Date(waDue.getTime() + MIN));
    const late = await call(whatsappDue, '/api/reminders/whatsapp-due', { cookie: a.cookie });
    const item2 = late.body!.items.find((i: { id: string }) => i.id === wa.id);
    expect(item2.confirmed).toBe(true);
    expect(decodeURIComponent(item2.whatsappUrl)).toContain('Confirm:');
  });
});
