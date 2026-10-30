/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getAppointment } from '@/app/api/appointments/[id]/route';
import { PATCH as patchOutcome } from '@/app/api/appointments/[id]/outcome/route';
import { GET as getBusiness, PATCH as patchBusiness } from '@/app/api/business/route';
import { POST as runReminders } from '@/app/api/jobs/reminders/route';
import { POST as expiryJob } from '@/app/api/jobs/waitlist-expiry/route';
import { GET as getLink } from '@/app/api/links/[token]/route';
import { GET as getPay, POST as postPay } from '@/app/api/pay/[token]/route';
import { GET as whatsappDue } from '@/app/api/reminders/whatsapp-due/route';
import { GET as getQueue } from '@/app/api/outcomes/queue/route';
import { GET as pilotReport } from '@/app/api/pilot/report/route';
import { normalizePhone } from '@/server/domain/phone';
import { expiryFor, payExpiryFor, signToken } from '@/server/domain/tokens';
import { fakeEmailProvider } from '@/server/providers/email';
import { fakePaymentProvider } from '@/server/providers/payment';
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
    expect(r.status).toBe('CONFIRMED');
    expect(r.confirmedAt).not.toBeNull();
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
    const results = await Promise.all([payPost(token), payPost(token), payPost(token)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
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
    expect((await payPost(tokenOf(hold))).status).toBe(410);
    expect((await row(id)).status).toBe('CANCELLED');
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
    expect((await row(hold.body!.appointment.id)).status).toBe('CONFIRMED');
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
    expect((await row(id)).status).toBe('CONFIRMED');
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
