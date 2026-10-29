/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { POST as markSent } from '@/app/api/reminders/[id]/mark-sent/route';
import { GET as whatsappDue } from '@/app/api/reminders/whatsapp-due/route';
import { verifyToken } from '@/server/domain/tokens';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call, PASSWORD } from './helpers/api';
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
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;
let staffUserId: string;

const secret = () => process.env.LINK_SECRET!;
const H24_DUE = new Date('2026-11-03T07:00:00Z'); // start 4 Nov 07:00Z minus 24 h
const list = (cookie?: string) => call(whatsappDue, '/api/reminders/whatsapp-due', { cookie });
const mark = (cookie: string | undefined, id: string) =>
  call(markSent, `/api/reminders/${id}/mark-sent`, { method: 'POST', cookie, params: { id } });

async function book(tenant = a, scn = aScn, time = '07:00', phone?: string) {
  const res = await bookPublicly(
    tenant.slug,
    bookingBody(scn.serviceId, scn.staffIds[0]!, at(time), {
      name: 'Layla',
      ...(phone ? { phone } : {}),
    }),
  );
  expect(res.status).toBe(201);
  return res.body!.appointment.id as string;
}
const waJob = async (appointmentId: string, kind = 'H24') =>
  (
    await pg.query(
      `SELECT * FROM "ReminderJob" WHERE "appointmentId" = $1 AND kind = $2 AND channel = 'WHATSAPP'`,
      [appointmentId, kind],
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
  b = await newTenant({ businessName: 'Beta Clinic' });
  aScn = await newScenario(prisma, a);
  bScn = await newScenario(prisma, b);
  const inv = await call(createInvite, '/api/invites', {
    cookie: a.cookie,
    body: { email: 'rana@example.test', role: 'STAFF' },
  });
  const token = inv.body!.acceptUrl.split('/invite/')[1] as string;
  const acc = await call(acceptInvite, `/api/invites/${token}/accept`, {
    params: { token },
    body: { name: 'Rana', password: PASSWORD },
  });
  staffCookie = acc.cookie as string;
  staffUserId = acc.body!.user.id;
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
  vi.setSystemTime(NOW);
});

describe('GET /api/reminders/whatsapp-due', () => {
  it('lists nothing before a reminder is due', async () => {
    await book();
    const res = await list(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, items: [] });
  });

  it('lists the due reminder with client, appointment and a wa.me link carrying both signed links', async () => {
    const id = await book(a, aScn, '07:00', '71 123 456');
    vi.setSystemTime(new Date(H24_DUE.getTime() + 60_000));
    const res = await list(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.count).toBe(1);
    const item = res.body!.items[0];
    expect(item).toMatchObject({
      kind: 'H24',
      dueAt: H24_DUE.toISOString(),
      appointment: {
        id,
        startAt: '2026-11-04T07:00:00.000Z',
        service: { id: aScn.serviceId },
        staff: { id: aScn.staffIds[0] },
      },
      client: { name: 'Layla', phone: '+96171123456', noShows: 0 },
      status: 'PENDING',
      sentBy: null,
      sentAt: null,
    });
    expect(item.id).toBe((await waJob(id)).id);
    expect(item.whatsappUrl.startsWith('https://wa.me/96171123456?text=')).toBe(true);
    const text = new URL(item.whatsappUrl).searchParams.get('text')!;
    expect(text).toContain('Alpha Salon');
    expect(text).toContain('09:00');
    expect(text).toContain('Layla');
    const urls = [...text.matchAll(/http:\/\/localhost:3000\/l\/(\S+)/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(2);
    const now = new Date();
    expect(verifyToken(urls[0]!, secret(), now, 'confirm').ok).toBe(true);
    expect(verifyToken(urls[1]!, secret(), now, 'cancel').ok).toBe(true);
  });

  it('uses the business locale for the message', async () => {
    const t = await newTenant({ businessName: 'Gamma' });
    const scn = await newScenario(prisma, t);
    await pg.query(`UPDATE "Business" SET locale = 'ar' WHERE id = $1`, [t.businessId]);
    await book(t, scn);
    vi.setSystemTime(new Date(H24_DUE.getTime() + 60_000));
    const item = (await list(t.cookie)).body!.items[0];
    const text = new URL(item.whatsappUrl).searchParams.get('text')!;
    expect(text).toContain('تذكير');
    expect(text).toContain('Gamma');
  });

  it('hides H24 inside the last 2 h but shows H2, and drops cancelled appointments', async () => {
    const id = await book();
    const start = new Date('2026-11-04T07:00:00Z');
    vi.setSystemTime(new Date(start.getTime() - 2 * 3_600_000 + 60_000));
    const res = await list(a.cookie);
    expect(res.body!.items.map((i: any) => i.kind)).toEqual(['H2']);
    expect(res.body!.count).toBe(1);

    await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie: a.cookie,
      params: { id },
    });
    expect((await list(a.cookie)).body).toEqual({ count: 0, items: [] });
  });

  it('a stored phone that is not E.164 is flagged, not a 500 for the whole list', async () => {
    const bad = await book(a, aScn, '07:00');
    const good = await book(a, aScn, '08:00', '71 765 432');
    await pg.query(
      `UPDATE "Client" SET phone = 'not-a-phone' WHERE id = (SELECT "clientId" FROM "Appointment" WHERE id = $1)`,
      [bad],
    );
    vi.setSystemTime(new Date(H24_DUE.getTime() + 3_600_000));
    const res = await list(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.count).toBe(2);
    const byAppt = (id: string) => res.body!.items.find((i: any) => i.appointment.id === id);
    expect(byAppt(bad)).toMatchObject({ whatsappUrl: null, phoneInvalid: true });
    expect(byAppt(good).phoneInvalid).toBe(false);
    expect(byAppt(good).whatsappUrl).toMatch(/^https:\/\/wa\.me\/96171765432\?text=/);
  });

  it('only shows the session business’s reminders, to OWNER and STAFF; 401 without a session', async () => {
    const aId = await book();
    const bId = await book(b, bScn);
    vi.setSystemTime(new Date(H24_DUE.getTime() + 60_000));
    for (const cookie of [a.cookie, staffCookie]) {
      const res = await list(cookie);
      expect(res.status).toBe(200);
      expect(res.body!.items.map((i: any) => i.appointment.id)).toEqual([aId]);
      expect(JSON.stringify(res.body)).not.toContain(bId);
    }
    expect((await list(b.cookie)).body!.items.map((i: any) => i.appointment.id)).toEqual([bId]);
    expect((await list(undefined)).status).toBe(401);
  });
});

describe('POST /api/reminders/{id}/mark-sent', () => {
  it('records who sent it; the list then shows sent-by for 12 hours', async () => {
    const id = await book();
    vi.setSystemTime(new Date(H24_DUE.getTime() + 60_000));
    const jobId = (await waJob(id)).id;
    const res = await mark(staffCookie, jobId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: jobId,
      status: 'SENT',
      sentBy: { id: staffUserId, name: 'Rana' },
      sentAt: new Date().toISOString(),
    });
    const row = await waJob(id);
    expect(row.status).toBe('SENT');
    expect(row.sentById).toBe(staffUserId);

    // The owner sees "sent by Rana".
    const owner = await list(a.cookie);
    expect(owner.body!.count).toBe(0);
    expect(owner.body!.items[0]).toMatchObject({
      status: 'SENT',
      sentBy: { id: staffUserId, name: 'Rana' },
      sentAt: new Date().toISOString(),
    });

    vi.setSystemTime(new Date(Date.now() + 11 * 3_600_000));
    expect((await list(a.cookie)).body!.items).toHaveLength(1);
    vi.setSystemTime(new Date(Date.now() + 2 * 3_600_000));
    expect((await list(a.cookie)).body!.items.map((i: any) => i.id)).not.toContain(jobId);
  });

  it('two simultaneous marks: exactly one 200 and one 409 ALREADY_SENT with sentBy', async () => {
    const id = await book();
    vi.setSystemTime(new Date(H24_DUE.getTime() + 60_000));
    const jobId = (await waJob(id)).id;
    const results = await Promise.all([mark(a.cookie, jobId), mark(staffCookie, jobId)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!;
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body!.error.code).toBe('ALREADY_SENT');
    expect(loser.body!.error.data.sentBy).toEqual(winner.body!.sentBy);
    expect(loser.body!.error.data.sentAt).toBe(winner.body!.sentAt);
    // A third, later call is also 409.
    expect((await mark(a.cookie, jobId)).status).toBe(409);
  });

  it('another business’s reminder id -> 404 and the row is untouched', async () => {
    const bId = await book(b, bScn);
    const bJob = await waJob(bId);
    const res = await mark(a.cookie, bJob.id);
    expect(res.status).toBe(404);
    expect((await waJob(bId)).status).toBe('PENDING');
    expect((await mark(a.cookie, 'ckx7k2n0a0000qzrmn831i7rn')).status).toBe(404);
  });

  it('an EMAIL reminder id is not markable (404); bad id -> 400; no session -> 401', async () => {
    const id = await book();
    const emailJob = (
      await pg.query(
        `SELECT id FROM "ReminderJob" WHERE "appointmentId" = $1 AND channel = 'EMAIL' LIMIT 1`,
        [id],
      )
    ).rows[0];
    expect((await mark(a.cookie, emailJob.id)).status).toBe(404);
    const bad = await mark(a.cookie, 'not-a-cuid');
    expect(bad.status).toBe(400);
    expect(bad.body!.error.code).toBe('VALIDATION_FAILED');
    expect((await mark(undefined, emailJob.id)).status).toBe(401);
  });
});
