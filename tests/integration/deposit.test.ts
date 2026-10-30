/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { PATCH as patchOutcome } from '@/app/api/appointments/[id]/outcome/route';
import { GET as getBusiness, PATCH as patchBusiness } from '@/app/api/business/route';
import { POST as runReminders } from '@/app/api/jobs/reminders/route';
import { POST as expiryJob } from '@/app/api/jobs/waitlist-expiry/route';
import { GET as getLink, POST as postLink } from '@/app/api/links/[token]/route';
import { GET as dashToday } from '@/app/api/dashboard/today/route';
import { GET as getPay, POST as postPay } from '@/app/api/pay/[token]/route';
import { GET as whatsappDue } from '@/app/api/reminders/whatsapp-due/route';
import { GET as getQueue } from '@/app/api/outcomes/queue/route';
import { GET as pilotReport } from '@/app/api/pilot/report/route';
import { normalizePhone } from '@/server/domain/phone';
import { expiryFor, payExpiryFor, signToken } from '@/server/domain/tokens';
import { fakeEmailProvider } from '@/server/providers/email';
import { fakePaymentProvider } from '@/server/providers/payment';
import { rootLogger } from '@/server/http/logger';
import { appointmentRepo } from '@/server/repositories/appointment.repo';
import { pilotRepo } from '@/server/repositories/pilot.repo';
import { defaultBookDeps } from '@/server/services/booking';
import { publicBookingService } from '@/server/services/publicBooking';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  getSlots,
  newKey,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  startsOf,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { seedAppointment, seedClient } from './helpers/outcomes';
import {
  offerClaim,
  offerToken,
  runExpiry,
  seedEntry,
  staffCancel,
  staffSession,
  tokenFromEmail,
} from './helpers/waitlist';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let staffCookie: string;

const SLOT = at('07:00'); // Wed 4 Nov 09:00 Beirut
const SLOT2 = at('08:00');
const MIN = 60_000;
const SECRET = () => process.env.LINK_SECRET!;

const patch = (cookie: string | undefined, body: unknown) =>
  call(patchBusiness, '/api/business', { method: 'PATCH', cookie, body });
const payGet = (token: string) => call(getPay, `/api/pay/${token}`, { params: { token } });
const payPost = (token: string, body: unknown = {}) =>
  call(postPay, `/api/pay/${token}`, { params: { token }, body });
const tokenOf = (res: { body?: any }) => res.body!.payToken as string;

/** A client of business `a` that has `noShows` past no-shows; returns the national phone to book with. */
async function noShowClient(noShows = 1, businessId = a.businessId) {
  const national = newPhone();
  await seedClient(prisma, businessId, {
    name: 'Nadia NoShow',
    phone: normalizePhone(national)!,
    noShows,
  });
  return national;
}

async function holdSlot(over: { startAt?: string; phone?: string; staffIdx?: number } = {}) {
  const phone = over.phone ?? (await noShowClient());
  const res = await bookPublicly(
    a.slug,
    bookingBody(scn.serviceId, scn.staffIds[over.staffIdx ?? 0]!, over.startAt ?? SLOT, {
      phone,
      email: 'nadia@example.test',
    }),
  );
  expect(res.status).toBe(201);
  return res;
}

const row = async (id: string) =>
  (await pg.query('SELECT * FROM "Appointment" WHERE id=$1', [id])).rows[0];
const jobs = async (id: string) =>
  (await pg.query('SELECT kind, channel FROM "ReminderJob" WHERE "appointmentId"=$1', [id])).rows;
const payments = async (id: string) =>
  (await pg.query('SELECT * FROM "Payment" WHERE "appointmentId"=$1', [id])).rows;
const cron = (handler: any, path: string) =>
  call(handler, path, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET! } });

beforeAll(async () => {
  process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  b = await newTenant({ businessName: 'Beta Clinic' });
  scn = await newScenario(prisma, a, { staff: 2 });
  staffCookie = await staffSession(a.cookie);
  expect(
    (await patch(a.cookie, { depositEnabled: true, depositThreshold: 1, depositAmount: 5 })).status,
  ).toBe(200);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'ReminderJob', 'Payment', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  await patch(a.cookie, { depositEnabled: true, depositThreshold: 1, depositAmount: 5 });
  fakeEmailProvider.reset();
  fakePaymentProvider.reset();
  vi.setSystemTime(NOW);
});

describe('settings (owner only)', () => {
  it('defaults OFF for a new business, and GET exposes the deposit block', async () => {
    const res = await call(getBusiness, '/api/business', { cookie: b.cookie });
    expect(res.status).toBe(200);
    expect(res.body!.deposit).toEqual({ enabled: false, threshold: 1, amount: 5, currency: 'USD' });
  });

  it('owner can change them; staff gets 403; anonymous 401', async () => {
    const ok = await patch(a.cookie, { depositEnabled: true, depositThreshold: 2, depositAmount: 7.5 });
    expect(ok.status).toBe(200);
    expect(ok.body!.deposit).toMatchObject({ enabled: true, threshold: 2, amount: 7.5 });
    expect((await patch(staffCookie, { depositEnabled: false })).status).toBe(403);
    expect((await patch(undefined, { depositEnabled: false })).status).toBe(401);
    // staff can still read it
    expect((await call(getBusiness, '/api/business', { cookie: staffCookie })).status).toBe(200);
  });

  it.each([
    { depositThreshold: 0 },
    { depositThreshold: 1.5 },
    { depositAmount: 0 },
    { depositAmount: 5.123 },
    { depositAmount: '5' },
    { depositEnabled: 'yes' },
    { deposit: { enabled: true } },
  ])('rejects %j with 400', async (body) => {
    const res = await patch(a.cookie, body);
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
  });

  it("one business's settings never touch another's", async () => {
    await patch(a.cookie, { depositEnabled: true });
    const other = await call(getBusiness, '/api/business', { cookie: b.cookie });
    expect(other.body!.deposit.enabled).toBe(false);
  });
});

describe('who is asked for a deposit', () => {
  it('nobody when deposits are off, even a repeat no-show', async () => {
    await patch(a.cookie, { depositEnabled: false });
    const res = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: await noShowClient(5) }),
    );
    expect(res.status).toBe(201);
    expect(res.body!.appointment.status).toBe('BOOKED');
    expect(res.body!.payUrl).toBeUndefined();
  });

  it('a client with a clean record or below the threshold books normally', async () => {
    await patch(a.cookie, { depositThreshold: 2 });
    const fresh = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(fresh.body!.appointment.status).toBe('BOOKED');
    const below = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT2, { phone: await noShowClient(1) }),
    );
    expect(below.body!.appointment.status).toBe('BOOKED');
    expect(fakePaymentProvider.calls).toHaveLength(0);
  });

  it('a no-show client at the threshold gets PENDING_PAYMENT with a pay link and a 15 minute hold', async () => {
    const res = await holdSlot();
    expect(res.body!.status).toBe('PENDING_PAYMENT');
    expect(res.body!.appointment.status).toBe('PENDING_PAYMENT');
    expect(res.body!.holdExpiresAt).toBe(new Date(NOW.getTime() + 15 * MIN).toISOString());
    expect(res.body!.payUrl).toContain(`/pay/${res.body!.payToken}`);
    const id = res.body!.appointment.id;
    const r = await row(id);
    expect(r.status).toBe('PENDING_PAYMENT');
    expect(new Date(r.holdExpiresAt).getTime()).toBe(NOW.getTime() + 15 * MIN);
    // no reminders, no confirmation email
    expect(await jobs(id)).toHaveLength(0);
    await cron(runReminders, '/api/jobs/reminders');
    expect(fakeEmailProvider.calls).toHaveLength(0);
    const pay = await payments(id);
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ purpose: 'DEPOSIT', status: 'PENDING', currency: 'USD' });
    expect(Number(pay[0].amount)).toBe(5);
    expect(fakePaymentProvider.calls[0]).toMatchObject({ purpose: 'DEPOSIT', amount: 5 });
  });

  it('front-desk bookings bypass the deposit', async () => {
    const res = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: await noShowClient(4) }),
    );
    expect(res.status).toBe(201);
    expect(res.body!.appointment.status).toBe('BOOKED');
    expect(fakePaymentProvider.calls).toHaveLength(0);
  });

  it('a retried request with the same Idempotency-Key returns the same hold (200)', async () => {
    const phone = await noShowClient();
    const body = bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone });
    const key = newKey();
    const first = await bookPublicly(a.slug, body, key);
    const again = await bookPublicly(a.slug, body, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body!.appointment.id).toBe(first.body!.appointment.id);
    expect(again.body!.status).toBe('PENDING_PAYMENT');
    expect(await payments(first.body!.appointment.id)).toHaveLength(1);
  });
});

describe('a PENDING_PAYMENT hold blocks the slot (guarantee 1)', () => {
  it('a second booking of the same slot -> 409 SLOT_TAKEN, and the slot leaves the listing', async () => {
    await holdSlot();
    const second = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(second.status).toBe(409);
    expect(second.body!.error.code).toBe('SLOT_TAKEN');
    const slots = await getSlots(a.slug, {
      serviceId: scn.serviceId,
      staffId: scn.staffIds[0]!,
      from: '2026-11-04',
      to: '2026-11-04',
    });
    expect(startsOf(slots.body!.slots)).not.toContain(SLOT);
    // the front desk is refused too
    const desk = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(desk.status).toBe(409);
  });

  it('10 parallel bookings where the winner needs a deposit: one 201, nine 409', async () => {
    const phones = await Promise.all(Array.from({ length: 10 }, () => noShowClient()));
    const results = await Promise.all(
      phones.map((phone) =>
        bookPublicly(a.slug, bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone })),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(fakePaymentProvider.calls).toHaveLength(1); // only the winner opens a checkout (no orphans)
    const winner = results.find((r) => r.status === 201)!;
    expect(winner.body!.status).toBe('PENDING_PAYMENT');
    const live = await pg.query(
      `SELECT count(*)::int n FROM "Appointment" WHERE "staffId"=$1 AND "startAt"=$2 AND status IN ('BOOKED','CONFIRMED','PENDING_PAYMENT')`,
      [scn.staffIds[0], SLOT],
    );
    expect(live.rows[0].n).toBe(1);
  });

  it('the database constraint itself refuses an overlapping insert of a hold', async () => {
    await holdSlot();
    await expect(
      seedAppointment(prisma, {
        businessId: a.businessId,
        clientId: (await seedClient(prisma, a.businessId)).id,
        staffId: scn.staffIds[0]!,
        serviceId: scn.serviceId,
        startAt: SLOT,
        status: 'PENDING_PAYMENT',
      }),
    ).rejects.toThrow();
  });
});

describe('paying', () => {
  it('GET shows the deposit with no side effects; POST confirms once and creates the reminders once', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    const token = tokenOf(hold);

    const view = await payGet(token);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      state: 'PENDING',
      deposit: { amount: 5, currency: 'USD' },
      testMode: true,
      business: { name: 'Alpha Salon' },
    });
    expect(view.body!.now).toBe(NOW.toISOString());
    expect((await row(id)).status).toBe('PENDING_PAYMENT');

    const paid = await payPost(token);
    expect(paid.status).toBe(200);
    expect(paid.body!.state).toBe('PAID');
    const r = await row(id);
    expect(r.status).toBe('BOOKED');
    expect(r.confirmedAt).toBeNull(); // the Payment PAID row is the proof; the client may still confirm by link
    expect((await payments(id))[0].status).toBe('PAID');
    const j = await jobs(id);
    expect(j.filter((x: any) => x.kind === 'BOOKING')).toHaveLength(1);
    expect(j.length).toBeGreaterThanOrEqual(5); // BOOKING + H24/H2 for email and WhatsApp

    await cron(runReminders, '/api/jobs/reminders');
    expect(fakeEmailProvider.calls).toHaveLength(1); // the booking confirmation
    expect(fakePaymentProvider.statusChecks).toHaveLength(1);
  });

  it('double POST and parallel POSTs have exactly one effect', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    const token = tokenOf(hold);
    const spy = vi.spyOn(appointmentRepo, 'confirmPaid');
    const results = await Promise.all([payPost(token), payPost(token), payPost(token)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    // confirmPaid may be reached by several requests, but took effect exactly once
    const effects = await Promise.all(spy.mock.results.map((r) => r.value as Promise<boolean>));
    expect(effects.filter(Boolean)).toHaveLength(1);
    spy.mockRestore();
    const again = await payPost(token);
    expect(again.status).toBe(200);
    expect(again.body!.state).toBe('PAID');
    const j = await jobs(id);
    expect(new Set(j.map((x: any) => `${x.kind}/${x.channel}`)).size).toBe(j.length);
    expect(j.filter((x: any) => x.kind === 'BOOKING')).toHaveLength(1);
    expect((await payments(id)).filter((p: any) => p.status === 'PAID')).toHaveLength(1);
    await cron(runReminders, '/api/jobs/reminders');
    expect(fakeEmailProvider.calls).toHaveLength(1);
    // a GET after payment shows the paid state
    expect((await payGet(token)).body!.state).toBe('PAID');
  });

  it('only the provider result flips it: a pending/failed provider answer changes nothing', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    const externalId = (await payments(id))[0].externalId as string;
    fakePaymentProvider.outcomes.set(externalId, 'PENDING');
    const res = await payPost(tokenOf(hold));
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('PAYMENT_NOT_COMPLETED');
    expect((await row(id)).status).toBe('PENDING_PAYMENT');
    expect(await jobs(id)).toHaveLength(0);
    // a body that claims it was paid is rejected outright
    expect((await payPost(tokenOf(hold), { paid: true })).status).toBe(400);
    expect((await row(id)).status).toBe('PENDING_PAYMENT');
    // and once the provider says PAID, it goes through
    fakePaymentProvider.outcomes.delete(externalId);
    expect((await payPost(tokenOf(hold))).status).toBe(200);
  });

  it('pay after expiry is rejected with 410 HOLD_EXPIRED and fresh slots; the slot is released', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    vi.setSystemTime(new Date(NOW.getTime() + 16 * MIN));
    const get = await payGet(tokenOf(hold));
    expect(get.status).toBe(410);
    expect(get.body!.error.code).toBe('HOLD_EXPIRED');
    const res = await payPost(tokenOf(hold));
    expect(res.status).toBe(410);
    expect(res.body!.error.code).toBe('HOLD_EXPIRED');
    expect(res.body!.error.data.slug).toBe(a.slug);
    expect(startsOf(res.body!.error.data.slots)).toContain(SLOT);
    const r = await row(id);
    expect(r.status).toBe('CANCELLED');
    expect(r.cancelledVia).toBe('SYSTEM');
    expect((await payments(id))[0].status).toBe('EXPIRED');
    expect(await jobs(id)).toHaveLength(0);
    expect(fakePaymentProvider.statusChecks).toHaveLength(0);
  });

  it('a freed and rebooked slot is never double-assigned by a late payment', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    vi.setSystemTime(new Date(NOW.getTime() + 16 * MIN));
    await runExpiry();
    const rebook = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(rebook.status).toBe(201);
    expect(rebook.body!.appointment.status).toBe('BOOKED');
    expect((await payPost(tokenOf(hold))).status).toBe(410);
    expect((await row(id)).status).toBe('CANCELLED');
    const live = await pg.query(
      `SELECT count(*)::int n FROM "Appointment" WHERE "staffId"=$1 AND "startAt"=$2 AND status IN ('BOOKED','CONFIRMED','PENDING_PAYMENT')`,
      [scn.staffIds[0], SLOT],
    );
    expect(live.rows[0].n).toBe(1);
  });

  it('a hold cancelled by staff cannot be paid, and its payment is closed', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    expect((await staffCancel(a.cookie, id)).status).toBe(200);
    expect((await payments(id))[0].status).toBe('EXPIRED');
    const get = await payGet(tokenOf(hold));
    expect(get.status).toBe(410);
    // distinct from "not paid in time": nobody let this lapse
    expect(get.body!.error.code).toBe('BOOKING_CANCELLED');
    expect(get.body!.error.message).not.toMatch(/not paid in time/i);
    const post = await payPost(tokenOf(hold));
    expect(post.status).toBe(410);
    expect(post.body!.error.code).toBe('BOOKING_CANCELLED');
    expect((await row(id)).status).toBe('CANCELLED');
  });

  it('a hold that lapsed (swept by the job) still says HOLD_EXPIRED', async () => {
    const hold = await holdSlot();
    vi.setSystemTime(new Date(NOW.getTime() + 16 * MIN));
    await runExpiry();
    const get = await payGet(tokenOf(hold));
    expect(get.status).toBe(410);
    expect(get.body!.error.code).toBe('HOLD_EXPIRED');
  });

  it('pay racing the expiry job: exactly one wins, never a booking on a freed slot', async () => {
    for (let i = 0; i < 12; i++) {
      const hold = await holdSlot({ startAt: at(['07:00', '08:00', '09:00', '10:00'][i % 4]!, `2026-11-${String(4 + Math.floor(i / 4)).padStart(2, '0')}`) });
      const id = hold.body!.appointment.id;
      const expiresAt = new Date(hold.body!.holdExpiresAt);
      const [paid, freed] = await Promise.all([
        appointmentRepo.confirmPaid(a.businessId, id, new Date(expiresAt.getTime() - 1), []),
        appointmentRepo.expireHolds(expiresAt, 50),
      ]);
      const r = await row(id);
      const pay = (await payments(id))[0];
      if (paid) {
        expect(r.status).toBe('BOOKED');
        expect(pay.status).toBe('PAID');
        expect(freed.some((f) => f.id === id)).toBe(false);
      } else {
        expect(r.status).toBe('CANCELLED');
        expect(pay.status).toBe('EXPIRED');
        expect(freed.some((f) => f.id === id)).toBe(true);
      }
    }
    const bad = await pg.query(
      `SELECT count(*)::int n FROM "Appointment" a JOIN "Payment" p ON p."appointmentId"=a.id
       WHERE (a.status='CANCELLED' AND p.status='PAID') OR (a.status IN ('BOOKED','CONFIRMED') AND p.status='EXPIRED')`,
    );
    expect(bad.rows[0].n).toBe(0);
  });

  it('API level: payPost and the expiry job together never confirm a freed slot', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    vi.setSystemTime(new Date(NOW.getTime() + 15 * MIN - 1000));
    const [pay] = await Promise.all([payPost(tokenOf(hold)), runExpiry()]);
    const r = await row(id);
    const p = (await payments(id))[0];
    if (r.status === 'BOOKED') {
      expect(pay.status).toBe(200);
      expect(p.status).toBe('PAID');
    } else {
      expect(r.status).toBe('CANCELLED');
      expect(p.status).not.toBe('PAID');
    }
  });
});

describe('a lapsed hold that nobody swept yet (B1)', () => {
  const lapse = () => vi.setSystemTime(new Date(NOW.getTime() + 16 * MIN));

  it('shows the slot free and a public booking of it succeeds; the old hold is closed', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    lapse(); // the cron has NOT run
    const slots = await getSlots(a.slug, {
      serviceId: scn.serviceId,
      staffId: scn.staffIds[0]!,
      from: '2026-11-04',
      to: '2026-11-04',
    });
    expect(startsOf(slots.body!.slots)).toContain(SLOT);

    const book = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(book.status).toBe(201);
    expect(book.body!.appointment.status).toBe('BOOKED');
    const old = await row(id);
    expect(old.status).toBe('CANCELLED');
    expect(old.cancelledVia).toBe('SYSTEM');
    expect((await payments(id))[0].status).toBe('EXPIRED');
    expect((await payGet(tokenOf(hold))).status).toBe(410);
    expect((await payPost(tokenOf(hold))).status).toBe(410);
  });

  it('a hold that is still live keeps blocking (not swept, not shown free)', async () => {
    await holdSlot();
    vi.setSystemTime(new Date(NOW.getTime() + 14 * MIN));
    const second = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(second.status).toBe(409);
  });

  it('the sweep is scoped: a lapsed hold of another business is left to the cron', async () => {
    const bScn = await newScenario(prisma, b);
    const client = await seedClient(prisma, b.businessId);
    const other = await prisma.appointment.create({
      data: {
        businessId: b.businessId,
        clientId: client.id,
        staffId: bScn.staffIds[0]!,
        serviceId: bScn.serviceId,
        startAt: new Date(SLOT),
        endAt: new Date(new Date(SLOT).getTime() + 30 * MIN),
        blockedUntil: new Date(new Date(SLOT).getTime() + 30 * MIN),
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date(NOW.getTime() + 15 * MIN),
      },
    });
    await holdSlot();
    lapse();
    const book = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(book.status).toBe(201);
    expect((await row(other.id)).status).toBe('PENDING_PAYMENT');
  });

  it('retries the insert once after 23P01 by sweeping again (a hold that lapses mid-booking)', async () => {
    const client = await seedClient(prisma, a.businessId);
    const start = new Date(SLOT);
    const deps = {
      ...defaultBookDeps,
      afterAvailability: async () => {
        // a hold that was invisible to availability and the first sweep appears, already lapsed
        await prisma.appointment.create({
          data: {
            businessId: a.businessId,
            clientId: client.id,
            staffId: scn.staffIds[0]!,
            serviceId: scn.serviceId,
            startAt: start,
            endAt: new Date(start.getTime() + 30 * MIN),
            blockedUntil: new Date(start.getTime() + 30 * MIN),
            status: 'PENDING_PAYMENT',
            holdExpiresAt: new Date(NOW.getTime() - MIN),
          },
        });
      },
    };
    const res = await publicBookingService.book(
      { requestId: 'req-retry-0001', logger: rootLogger } as any,
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }) as any,
      newKey(),
      deps,
    );
    expect(res.appointment.status).toBe('BOOKED');
  });
});

describe('waitlist claim that needs a deposit (B2)', () => {
  async function pendingClaim() {
    const phone = await noShowClient();
    const clientId = (
      await pg.query('SELECT id FROM "Client" WHERE phone=$1', [normalizePhone(phone)!])
    ).rows[0].id;
    const entry = await seedEntry(prisma, a.businessId, scn.serviceId, {
      clientId,
      email: 'nadia@example.test',
      createdAt: new Date(NOW.getTime() - 1000),
    });
    const other = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    await staffCancel(a.cookie, other.body!.appointment.id);
    const mail = fakeEmailProvider.calls.find((c) => c.to === 'nadia@example.test')!;
    const claim = await offerClaim(tokenFromEmail(mail.text));
    expect(claim.body!.status).toBe('PENDING_PAYMENT');
    return { claim, entryId: entry.entryId };
  }
  const offerRow = async (entryId: string) =>
    (await pg.query('SELECT * FROM "WaitlistOffer" WHERE "entryId"=$1', [entryId])).rows[0];
  const entryRow = async (entryId: string) =>
    (await pg.query('SELECT * FROM "WaitlistEntry" WHERE id=$1', [entryId])).rows[0];

  it('does not claim the offer, fulfil the entry or count a refill while the hold is unpaid', async () => {
    const { entryId } = await pendingClaim();
    expect((await offerRow(entryId)).status).toBe('OPEN');
    expect((await offerRow(entryId)).claimedAppointmentId).toBeNull();
    expect((await entryRow(entryId)).status).toBe('OPEN');
    const sig = await pilotRepo.waitlistSignal(a.businessId, new Date(0), new Date(NOW.getTime() + 3600_000));
    expect(sig.refills).toBe(0);
  });

  it('a lapsed unpaid claim leaves the offer and the entry untouched (never refilled)', async () => {
    const { claim, entryId } = await pendingClaim();
    vi.setSystemTime(new Date(NOW.getTime() + 16 * MIN));
    const res = await runExpiry();
    expect(res.body).toMatchObject({ holdsExpired: 1 });
    expect((await row(claim.body!.appointment.id)).status).toBe('CANCELLED');
    expect((await offerRow(entryId)).status).not.toBe('CLAIMED');
    expect((await entryRow(entryId)).status).toBe('OPEN');
    const sig = await pilotRepo.waitlistSignal(a.businessId, new Date(0), new Date(NOW.getTime() + 3600_000));
    expect(sig.refills).toBe(0);
  });

  it('paying completes the claim: offer CLAIMED, entry FULFILLED, one refill', async () => {
    const { claim, entryId } = await pendingClaim();
    expect((await payPost(tokenOf(claim))).status).toBe(200);
    const o = await offerRow(entryId);
    expect(o.status).toBe('CLAIMED');
    expect(o.claimedAppointmentId).toBe(claim.body!.appointment.id);
    expect((await entryRow(entryId)).status).toBe('FULFILLED');
    const sig = await pilotRepo.waitlistSignal(a.businessId, new Date(0), new Date(NOW.getTime() + 3600_000));
    expect(sig.refills).toBe(1);
  });
});

describe('per-phone budget', () => {
  it('idempotent replays do not consume it, and the bucket key is not a bare hash of the phone', async () => {
    const saved = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;
    try {
      await pg.query('DELETE FROM "RateLimitBucket"');
      const phone = newPhone();
      const body = bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone });
      const key = newKey();
      const statuses: number[] = [];
      for (let i = 0; i < 10; i++) statuses.push((await bookPublicly(a.slug, body, key)).status);
      expect(statuses[0]).toBe(201);
      expect(statuses.slice(1).every((s) => s === 200)).toBe(true);
      const { createHash } = await import('node:crypto');
      const bare = createHash('sha256').update(normalizePhone(phone)!).digest('hex');
      const keys = (await pg.query('SELECT key FROM "RateLimitBucket"')).rows.map((r) => r.key);
      expect(keys.some((k: string) => k.includes(bare))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.RATE_LIMIT_DISABLED;
      else process.env.RATE_LIMIT_DISABLED = saved;
      await pg.query('DELETE FROM "RateLimitBucket"');
    }
  });
});

describe('one entry, two offers, deposit holds (F21 stays closed)', () => {
  async function twoOffers() {
    const phone = await noShowClient();
    const clientId = (
      await pg.query('SELECT id FROM "Client" WHERE phone=$1', [normalizePhone(phone)!])
    ).rows[0].id;
    const entry = await seedEntry(prisma, a.businessId, scn.serviceId, {
      clientId,
      email: 'nadia@example.test',
      createdAt: new Date(NOW.getTime() - 1000),
    });
    for (const start of [SLOT, SLOT2]) {
      const b1 = await bookAtFrontDesk(
        a.cookie,
        bookingBody(scn.serviceId, scn.staffIds[0]!, start, { phone: newPhone() }),
      );
      await staffCancel(a.cookie, b1.body!.appointment.id);
    }
    const mails = fakeEmailProvider.calls.filter((c) => c.to === 'nadia@example.test');
    expect(mails).toHaveLength(2);
    const tokens = mails.map((m) => tokenFromEmail(m.text));
    const paidFor = async () =>
      (
        await pg.query(
          `SELECT count(*)::int n FROM "Appointment" a JOIN "Payment" p ON p."appointmentId"=a.id
           WHERE a."clientId"=$1 AND p.status='PAID'`,
          [clientId],
        )
      ).rows[0].n as number;
    return { tokens, entryId: entry.entryId, paidFor };
  }

  it('a second claim is refused while the first deposit hold is live, even after the 60 s lease', async () => {
    const { tokens } = await twoOffers();
    const first = await offerClaim(tokens[0]!);
    expect(first.status).toBe(201);
    expect(first.body!.status).toBe('PENDING_PAYMENT');
    vi.setSystemTime(new Date(NOW.getTime() + 2 * MIN));
    const second = await offerClaim(tokens[1]!);
    expect(second.status).toBe(409);
    const live = await pg.query(
      `SELECT count(*)::int n FROM "Appointment" WHERE status='PENDING_PAYMENT' AND source='WAITLIST'`,
    );
    expect(live.rows[0].n).toBe(1);
  });

  it('after the first hold lapses and is swept, the other offer can be claimed and paid', async () => {
    const { tokens, paidFor } = await twoOffers();
    await offerClaim(tokens[0]!);
    vi.setSystemTime(new Date(NOW.getTime() + 16 * MIN));
    await runExpiry();
    const second = await offerClaim(tokens[1]!);
    expect(second.status).toBe(201);
    expect(second.body!.status).toBe('PENDING_PAYMENT');
    expect((await payPost(tokenOf(second))).status).toBe(200);
    expect(await paidFor()).toBe(1);
  });

  it('after paying the first, the other offer is refused and exactly one paid booking exists', async () => {
    const { tokens, paidFor } = await twoOffers();
    const first = await offerClaim(tokens[0]!);
    expect((await payPost(tokenOf(first))).status).toBe(200);
    vi.setSystemTime(new Date(NOW.getTime() + 2 * MIN));
    const second = await offerClaim(tokens[1]!);
    expect(second.status).toBe(409);
    expect(await paidFor()).toBe(1);
  });
});

describe('a failed checkout releases the hold and re-offers the slot', () => {
  it('answers 503, cancels the hold and offers the slot to the waitlist', async () => {
    const waiter = await seedEntry(prisma, a.businessId, scn.serviceId, {
      email: 'wendy@example.test',
      createdAt: new Date(NOW.getTime() - 1000),
    });
    fakePaymentProvider.failNext = new Error('provider down');
    const phone = await noShowClient();
    const res = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone }),
    );
    expect(res.status).toBe(503);
    const held = await pg.query(`SELECT status FROM "Appointment" WHERE "startAt"=$1`, [SLOT]);
    expect(held.rows.map((r) => r.status)).toEqual(['CANCELLED']);
    const offers = await pg.query('SELECT 1 FROM "WaitlistOffer" WHERE "entryId"=$1', [waiter.entryId]);
    expect(offers.rowCount).toBe(1);
    expect(fakeEmailProvider.calls.some((c) => c.to === 'wendy@example.test')).toBe(true);
  });

  it('still answers 503 when releasing the hold itself fails (the cron sweeps it)', async () => {
    const spy = vi.spyOn(appointmentRepo, 'abandonHold').mockRejectedValueOnce(new Error('db down'));
    fakePaymentProvider.failNext = new Error('provider down');
    const res = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: await noShowClient() }),
    );
    expect(res.status).toBe(503);
    spy.mockRestore();
    vi.setSystemTime(new Date(NOW.getTime() + 16 * MIN));
    expect((await runExpiry()).body).toMatchObject({ holdsExpired: 1 });
  });
});

describe('a hold with no expiry still blocks (availability)', () => {
  it('treats PENDING_PAYMENT with holdExpiresAt NULL as blocking', async () => {
    const client = await seedClient(prisma, a.businessId);
    const start = new Date(SLOT);
    await prisma.appointment.create({
      data: {
        businessId: a.businessId,
        clientId: client.id,
        staffId: scn.staffIds[0]!,
        serviceId: scn.serviceId,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * MIN),
        blockedUntil: new Date(start.getTime() + 30 * MIN),
        status: 'PENDING_PAYMENT',
        holdExpiresAt: null,
      },
    });
    const slots = await getSlots(a.slug, {
      serviceId: scn.serviceId,
      staffId: scn.staffIds[0]!,
      from: '2026-11-04',
      to: '2026-11-04',
    });
    expect(startsOf(slots.body!.slots)).not.toContain(SLOT);
  });
});

describe('a paid deposit is not a confirmation (B3)', () => {
  it('stays BOOKED with no confirmedAt: not in the confirm rate, not in the dashboard confirmed', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    expect((await payPost(tokenOf(hold))).status).toBe(200);
    const r = await row(id);
    expect(r.status).toBe('BOOKED');
    expect(r.confirmedAt).toBeNull();

    const today = await call(dashToday, '/api/dashboard/today', {
      cookie: a.cookie,
      query: { date: '2026-11-04' },
    });
    expect(today.status).toBe(200);
    expect(today.body!.stats.appointments).toBe(1);
    expect(today.body!.stats.confirmed).toBe(0);

    await pg.query(
      `UPDATE "ReminderJob" SET status='SENT', "sentAt"=now() WHERE "appointmentId"=$1 AND kind='H24' AND channel='EMAIL'`,
      [id],
    );
    const signal = await pilotRepo.reminderConfirmSignal(a.businessId, new Date('2026-11-05T00:00:00Z'));
    expect(signal).toEqual({ remindedAppointments: 1, confirmedAfterReminder: 0 });
  });

  it('the client can still confirm it with the link', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    await payPost(tokenOf(hold));
    const view = signToken({ a: id, act: 'confirm', exp: expiryFor(new Date(SLOT)) }, SECRET());
    const res = await call(postLink, `/api/links/${view}`, {
      params: { token: view },
      body: { action: 'confirm' },
    });
    expect(res.status).toBe(200);
    expect((await row(id)).status).toBe('CONFIRMED');
  });
});

describe('the booking response is not an oracle (B4)', () => {
  it('names no reason, count or history', async () => {
    const res = await holdSlot();
    const text = JSON.stringify(res.body).toLowerCase();
    expect(text).not.toMatch(/noshow|no-show|no_show|history|threshold/);
    expect(Object.keys(res.body!).sort()).toEqual(
      ['appointment', 'holdExpiresAt', 'links', 'payToken', 'payUrl', 'status'].sort(),
    );
  });

  it('is limited per phone number (429 in the standard error shape), not per IP', async () => {
    const saved = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;
    try {
      await pg.query('DELETE FROM "RateLimitBucket"');
      const phone = newPhone();
      const statuses: number[] = [];
      let last: any;
      for (let i = 0; i < 9; i++) {
        last = await bookPublicly(
          a.slug,
          bookingBody(scn.serviceId, scn.staffIds[0]!, at('07:00', '2026-11-04'), { phone }),
          newKey(),
          { 'x-forwarded-for': `10.0.0.${i + 1}` }, // a different IP each time
        );
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
      expect(statuses).toContain(429);
      expect(last.body.error.code).toBe('RATE_LIMITED');
      expect(last.headers.get('retry-after')).toBeTruthy();
      // another number is unaffected
      const other = await bookPublicly(
        a.slug,
        bookingBody(scn.serviceId, scn.staffIds[1]!, SLOT2, { phone: newPhone() }),
      );
      expect(other.status).toBe(201);
    } finally {
      if (saved === undefined) delete process.env.RATE_LIMIT_DISABLED;
      else process.env.RATE_LIMIT_DISABLED = saved;
      await pg.query('DELETE FROM "RateLimitBucket"');
    }
  });
});

describe('expiry job (inside /api/jobs/waitlist-expiry)', () => {
  it('cancels lapsed holds, expires the payment, frees the slot and offers it to the waitlist', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    const waiter = await seedEntry(prisma, a.businessId, scn.serviceId, {
      name: 'Wendy',
      email: 'wendy@example.test',
      createdAt: new Date(NOW.getTime() - 1000),
    });

    // before the hold lapses nothing happens
    vi.setSystemTime(new Date(NOW.getTime() + 14 * MIN));
    const early = await runExpiry();
    expect(early.body).toMatchObject({ holdsExpired: 0 });
    expect((await row(id)).status).toBe('PENDING_PAYMENT');

    vi.setSystemTime(new Date(NOW.getTime() + 15 * MIN));
    const res = await runExpiry();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ holdsExpired: 1 });
    const r = await row(id);
    expect(r.status).toBe('CANCELLED');
    expect(r.cancelledVia).toBe('SYSTEM');
    expect((await payments(id))[0].status).toBe('EXPIRED');
    // the waitlist cascade ran like a cancellation
    const offers = await pg.query('SELECT * FROM "WaitlistOffer" WHERE "entryId"=$1', [waiter.entryId]);
    expect(offers.rowCount).toBe(1);
    expect(offers.rows[0].freedFromAppointmentId).toBe(id);
    expect(fakeEmailProvider.calls.some((c) => c.to === 'wendy@example.test')).toBe(true);
    // and the slot is bookable
    const rebook = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(rebook.status).toBe(201);
  });

  it('overlapping runs do not double-cancel or double-offer, and a second run is a no-op', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const h = await holdSlot({ startAt: at(["07:00", "08:00", "09:00", "10:00"][i]!) });
      ids.push(h.body!.appointment.id);
    }
    vi.setSystemTime(new Date(NOW.getTime() + 20 * MIN));
    const runs = await Promise.all(
      Array.from({ length: 4 }, () => runExpiry()),
    );
    expect(runs.every((r) => r.status === 200)).toBe(true);
    expect(runs.reduce((n, r) => n + (r.body!.holdsExpired as number), 0)).toBe(4);
    const after = await pg.query(
      `SELECT count(*)::int n FROM "Appointment" WHERE id = ANY($1) AND status='CANCELLED' AND "cancelledVia"='SYSTEM'`,
      [ids],
    );
    expect(after.rows[0].n).toBe(4);
    const again = await runExpiry();
    expect(again.body).toMatchObject({ holdsExpired: 0 });
  });

  it('never touches a hold that was paid in time, even if the job runs after the deadline check', async () => {
    const hold = await holdSlot();
    expect((await payPost(tokenOf(hold))).status).toBe(200);
    vi.setSystemTime(new Date(NOW.getTime() + 60 * MIN));
    const res = await runExpiry();
    expect(res.body).toMatchObject({ holdsExpired: 0 });
    expect((await row(hold.body!.appointment.id)).status).toBe('BOOKED');
  });

  it('rejects a call without the cron secret', async () => {
    const res = await call(expiryJob, '/api/jobs/waitlist-expiry', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('waitlist claims', () => {
  it('a claimant who needs a deposit gets PENDING_PAYMENT and a pay link, then pays', async () => {
    const phone = await noShowClient();
    const e164 = normalizePhone(phone)!;
    const clientId = (await pg.query('SELECT id FROM "Client" WHERE phone=$1', [e164])).rows[0].id;
    const entry = await seedEntry(prisma, a.businessId, scn.serviceId, {
      clientId,
      email: 'nadia@example.test',
      createdAt: new Date(NOW.getTime() - 1000),
    });
    // a booked slot gets cancelled by staff -> offer
    const other = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect((await staffCancel(a.cookie, other.body!.appointment.id)).status).toBe(200);
    const mail = fakeEmailProvider.calls.find((c) => c.to === 'nadia@example.test');
    expect(mail).toBeDefined();
    const claimToken = tokenFromEmail(mail!.text);

    const claim = await offerClaim(claimToken);
    expect(claim.status).toBe(201);
    expect(claim.body!.status).toBe('PENDING_PAYMENT');
    expect(claim.body!.payUrl).toContain('/pay/');
    expect(entry.entryId).toBeDefined();
    const id = claim.body!.appointment.id;
    expect(await jobs(id)).toHaveLength(0);
    expect((await payPost(tokenOf(claim))).status).toBe(200);
    expect((await row(id)).status).toBe('BOOKED');
    expect(await jobs(id)).not.toHaveLength(0);
  });
});

describe('token scopes', () => {
  it('a pay token is accepted only by /api/pay, and other scopes are not accepted there', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    const pay = tokenOf(hold);
    const start = new Date(SLOT);
    const sign = (act: any) => signToken({ a: id, act, exp: expiryFor(start) }, SECRET());

    // pay token elsewhere
    expect((await call(getLink, `/api/links/${pay}`, { params: { token: pay } })).status).toBe(404);
    expect((await offerClaim(pay)).status).toBe(404);
    // other scopes on the pay routes
    for (const act of ['view', 'confirm', 'cancel']) {
      const t = sign(act);
      expect((await payGet(t)).status).toBe(404);
      expect((await payPost(t)).status).toBe(404);
    }
    const claim = offerToken('someoffer', new Date(NOW.getTime() + 60 * MIN));
    expect((await payGet(claim)).status).toBe(404);
    expect((await payPost(claim)).status).toBe(404);
    expect((await row(id)).status).toBe('PENDING_PAYMENT');
  });

  it('tampered, malformed and unknown-appointment pay tokens are 404', async () => {
    const hold = await holdSlot();
    const token = tokenOf(hold);
    const [body, sig] = token.split('.');
    expect((await payGet(`${body}.${sig!.slice(0, -2)}AA`)).status).toBe(404);
    expect((await payGet('not-a-token')).status).toBe(404);
    const ghost = signToken(
      { a: 'ckghostghostghostghost0000', act: 'pay', exp: payExpiryFor(new Date(NOW.getTime() + 600_000)) },
      SECRET(),
    );
    expect((await payGet(ghost)).status).toBe(404);
    expect((await payPost(ghost)).status).toBe(404);
  });

  it('400 on a bad token parameter and on any body', async () => {
    const long = 'x'.repeat(700);
    expect((await payGet(long)).status).toBe(400);
    expect((await payPost(long)).status).toBe(400);
    const hold = await holdSlot();
    expect((await payPost(tokenOf(hold), { amount: 0 })).status).toBe(400);
  });

  it('cross-tenant: another business cannot see or cancel the hold (404)', async () => {
    const hold = await holdSlot();
    const id = hold.body!.appointment.id;
    expect((await call(getAppointment, `/api/appointments/${id}`, { cookie: b.cookie, params: { id } })).status).toBe(404);
    expect((await staffCancel(b.cookie, id)).status).toBe(404);
    expect((await row(id)).status).toBe('PENDING_PAYMENT');
  });
});

describe('status audit: a hold is not a booking', () => {
  it('is not in the outcomes queue, cannot take an outcome, and does not move counters or reports', async () => {
    const client = await seedClient(prisma, a.businessId, { noShows: 0 });
    const past = await seedAppointment(prisma, {
      businessId: a.businessId,
      clientId: client.id,
      staffId: scn.staffIds[1]!,
      serviceId: scn.serviceId,
      startAt: '2026-11-01T07:00:00.000Z',
      status: 'PENDING_PAYMENT',
    });
    const queue = await call(getQueue, '/api/outcomes/queue', { cookie: a.cookie });
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).not.toContain(past.id);

    for (const outcome of ['ATTENDED', 'NO_SHOW']) {
      const res = await call(patchOutcome, `/api/appointments/${past.id}/outcome`, {
        method: 'PATCH',
        cookie: a.cookie,
        params: { id: past.id },
        body: { outcome },
      });
      expect(res.status).toBe(409);
    }
    const after = await pg.query('SELECT status FROM "Appointment" WHERE id=$1', [past.id]);
    expect(after.rows[0].status).toBe('PENDING_PAYMENT');
    const c = await pg.query('SELECT attended, "noShows" FROM "Client" WHERE id=$1', [client.id]);
    expect(c.rows[0]).toEqual({ attended: 0, noShows: 0 });

    const report = await call(pilotReport, '/api/pilot/report', { cookie: a.cookie });
    expect(report.status).toBe(200);
    expect(JSON.stringify(report.body)).not.toMatch(/"appointments":[1-9]/);
  });

  it('gets no WhatsApp reminder entries and no emails while pending', async () => {
    await holdSlot();
    const due = await call(whatsappDue, '/api/reminders/whatsapp-due', { cookie: a.cookie });
    expect(due.status).toBe(200);
    expect(due.body!.count).toBe(0);
    await cron(runReminders, '/api/jobs/reminders');
    expect(fakeEmailProvider.calls).toHaveLength(0);
  });
});
