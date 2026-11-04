/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as listAppointments } from '@/app/api/appointments/route';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { POST as cancelAppointment } from '@/app/api/appointments/[id]/cancel/route';
import { GET as getLink } from '@/app/api/links/[token]/route';
import { GET as getPay, POST as postPay } from '@/app/api/pay/[token]/route';
import { PATCH as patchBusiness } from '@/app/api/business/route';
import { GET as exportCsv } from '@/app/api/pilot/export.csv/route';
import { GET as getOffer } from '@/app/api/offers/[token]/route';
import { normalizePhone } from '@/server/domain/phone';
import { fakeEmailProvider } from '@/server/providers/email';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  DAY,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { seedClient } from './helpers/outcomes';
import { seedEntry, staffCancel, staffSession, tokenFromEmail } from './helpers/waitlist';

/**
 * "Reminders go to ..." on the staff appointment screen: `reminderEmail` is computed by the SAME
 * `effectiveEmail` the reminder runner uses, is staff-only and never appears in any public shape (NFR-04).
 */
let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;

const BOOKING = 'booking.address@gmail.test';
const RECORD = 'record.address@gmail.test';
const SLOT = at('07:00');

const one = (cookie: string | undefined, id: string) =>
  call(getAppointment, `/api/appointments/${id}`, { cookie, params: { id } });
const body = (start: string, client: Record<string, unknown>) =>
  bookingBody(scn.serviceId, scn.staffIds[0]!, start, client);

beforeAll(async () => {
  process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
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
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'ReminderJob', 'Payment', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  fakeEmailProvider.reset();
});

describe('GET /api/appointments/{id}: reminderEmail', () => {
  it('is the booking address when one was typed for this booking (record email differs)', async () => {
    const phone = newPhone();
    await seedClient(prisma, a.businessId, { name: 'Rana', phone: normalizePhone(phone)!, email: RECORD });
    const booked = await bookPublicly(a.slug, body(SLOT, { phone, email: BOOKING }));
    const res = await one(a.cookie, booked.body!.appointment.id);
    expect(res.status).toBe(200);
    expect(res.body!.appointment.reminderEmail).toBe(BOOKING);
    expect(res.body!.appointment.reminderEmailDiffers).toBe(true);
  });

  it('is the record email as the fallback, and does not differ', async () => {
    const phone = newPhone();
    await seedClient(prisma, a.businessId, { name: 'Rana', phone: normalizePhone(phone)!, email: RECORD });
    // F68: the public page always sends an address, so the fallback is a front-desk booking without one.
    const booked = await bookAtFrontDesk(a.cookie, body(SLOT, { phone, email: undefined }));
    const res = await one(a.cookie, booked.body!.appointment.id);
    expect(res.body!.appointment.reminderEmail).toBe(RECORD);
    expect(res.body!.appointment.reminderEmailDiffers).toBe(false);
  });

  it('is null when there is no email anywhere', async () => {
    const booked = await bookAtFrontDesk(a.cookie, body(SLOT, { email: undefined }));
    const res = await one(a.cookie, booked.body!.appointment.id);
    expect(res.body!.appointment.reminderEmail).toBeNull();
    expect(res.body!.appointment.reminderEmailDiffers).toBe(false);
  });

  it('is null when the stored value fails the shape check (the runner would skip it too)', async () => {
    const booked = await bookPublicly(a.slug, body(SLOT, { email: BOOKING }));
    const id = booked.body!.appointment.id as string;
    await pg.query(`UPDATE "Appointment" SET "contactEmail" = 'not an address' WHERE id = $1`, [id]);
    await pg.query(`UPDATE "Client" SET email = NULL WHERE id = (SELECT "clientId" FROM "Appointment" WHERE id = $1)`, [id]);
    expect((await one(a.cookie, id)).body!.appointment.reminderEmail).toBeNull();
  });

  it('works for a STAFF-role session, and the cancel response carries it too', async () => {
    const booked = await bookAtFrontDesk(a.cookie, body(SLOT, { email: BOOKING }));
    const id = booked.body!.appointment.id as string;
    expect((await one(staffCookie, id)).body!.appointment.reminderEmail).toBe(BOOKING);
    const cancelled = await call(cancelAppointment, `/api/appointments/${id}/cancel`, {
      method: 'POST',
      cookie: staffCookie,
      params: { id },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body!.appointment.reminderEmail).toBe(BOOKING);
  });

  it('needs a session, and another business appointment id is 404', async () => {
    const mine = await bookPublicly(a.slug, body(SLOT, { email: BOOKING }));
    const theirs = await bookPublicly(b.slug, bookingBody(bScn.serviceId, bScn.staffIds[0]!, SLOT, { email: 'b@x.test' }));
    expect((await one(undefined, mine.body!.appointment.id)).status).toBe(401);
    const cross = await one(a.cookie, theirs.body!.appointment.id);
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain('b@x.test');
  });

  it('the list does not carry it', async () => {
    await bookPublicly(a.slug, body(SLOT, { email: BOOKING }));
    const res = await call(listAppointments, '/api/appointments', {
      cookie: a.cookie,
      query: { from: DAY, to: DAY },
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(BOOKING);
    expect(JSON.stringify(res.body)).not.toContain('reminderEmail');
  });
});

describe('NFR-04: never in a public response, link, CSV or log', () => {
  it('booking, manage link, pay, offer and CSV never carry the address', async () => {
    const phone = newPhone();
    await seedClient(prisma, a.businessId, {
      name: 'Nadia',
      phone: normalizePhone(phone)!,
      noShows: 1,
      email: RECORD,
    });
    await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: { depositEnabled: true, depositThreshold: 1, depositAmount: 5 },
    });
    const hold = await bookPublicly(a.slug, body(SLOT, { phone, email: BOOKING }));
    expect(hold.body!.status).toBe('PENDING_PAYMENT');
    const token = hold.body!.payToken as string;
    const seen: unknown[] = [hold.body];
    seen.push((await call(getPay, `/api/pay/${token}`, { params: { token } })).body);
    const paid = await call(postPay, `/api/pay/${token}`, { params: { token }, body: {} });
    seen.push(paid.body);
    const manage = hold.body!.links.manage as string;
    const linkToken = manage.split('/l/')[1]!;
    seen.push((await call(getLink, `/api/links/${linkToken}`, { params: { token: linkToken } })).body);

    // An offer page for a waitlist entry whose contact address is the booking address.
    const holder = await bookPublicly(a.slug, body(at('08:00'), { name: 'Casey', email: 'casey@x.test' }));
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      email: RECORD,
      contactEmail: BOOKING,
      createdAt: new Date(NOW.getTime() - 1_000_000),
    });
    fakeEmailProvider.reset();
    expect((await staffCancel(a.cookie, holder.body!.appointment.id)).status).toBe(200);
    const offerMail = fakeEmailProvider.calls.find((c) => c.to === BOOKING);
    if (offerMail) {
      const ot = tokenFromEmail(offerMail.text);
      seen.push((await call(getOffer, `/api/offers/${ot}`, { params: { token: ot } })).body);
    }

    const url = new URL('http://localhost/api/pilot/export.csv');
    url.searchParams.set('from', DAY);
    url.searchParams.set('to', DAY);
    const csv = await (await exportCsv(new Request(url, { headers: { cookie: a.cookie } }))).text();

    for (const s of seen) {
      expect(JSON.stringify(s)).not.toContain(BOOKING);
      expect(JSON.stringify(s)).not.toContain('reminderEmail');
    }
    expect(csv).not.toContain(BOOKING);
    expect(csv).not.toContain(RECORD);
  });

  it('the staff read logs no address', async () => {
    const booked = await bookPublicly(a.slug, body(SLOT, { email: BOOKING }));
    const lines: string[] = [];
    const logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      await one(a.cookie, booked.body!.appointment.id);
    } finally {
      logSpy.mockRestore();
    }
    expect(lines.join('')).not.toContain(BOOKING);
  });
});
