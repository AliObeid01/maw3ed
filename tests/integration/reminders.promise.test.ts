import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { PATCH as patchBusiness } from '@/app/api/business/route';
import { GET as getPay, POST as postPay } from '@/app/api/pay/[token]/route';
import { normalizePhone } from '@/server/domain/phone';
import { fakeEmailProvider } from '@/server/providers/email';
import { fakePaymentProvider } from '@/server/providers/payment';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookingBody,
  bookPublicly,
  newKey,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { seedClient } from './helpers/outcomes';
import { offerClaim, offerToken, seedEntry } from './helpers/waitlist';

// F44: the `reminders` field of the booking, claim and pay responses must equal the ReminderJob rows that
// really exist. Every expectation about the rows below reads the database, never the planning function.

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;

const HOUR = 3_600_000;
const MIN = 60_000;
const SLOT = at('07:00'); // Wed 4 Nov 2026, 09:00 Beirut
const SLOT_MS = Date.parse(SLOT);

const payGet = (token: string) => call(getPay, `/api/pay/${token}`, { params: { token } });
const payPost = (token: string) => call(postPay, `/api/pay/${token}`, { params: { token }, body: {} });

/** What the database says this appointment's client will be emailed. */
async function stored(appointmentId: string) {
  const { rows } = await pg.query(
    `SELECT kind FROM "ReminderJob" WHERE "appointmentId"=$1 AND channel='EMAIL' AND kind IN ('H24','H2')`,
    [appointmentId],
  );
  const kinds = rows.map((r: { kind: string }) => r.kind);
  return { h24: kinds.includes('H24'), h2: kinds.includes('H2') };
}

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  scn = await newScenario(prisma, a);
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
  fakePaymentProvider.reset();
  vi.setSystemTime(NOW);
});

const LEADS = [
  ['30 h ahead', 30 * HOUR, { h24: true, h2: true }],
  ['exactly 24 h ahead', 24 * HOUR, { h24: true, h2: true }],
  ['10 h ahead', 10 * HOUR, { h24: false, h2: true }],
  ['1 h ahead', 1 * HOUR, { h24: false, h2: false }],
] as const;

describe('public booking: reminders equals the ReminderJob rows', () => {
  it.each(LEADS)('%s', async (_label, lead, expected) => {
    vi.setSystemTime(SLOT_MS - lead);
    const res = await bookPublicly(a.slug, bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT));
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual(expected);
    expect(await stored(res.body!.appointment.id)).toEqual(res.body!.reminders);
  });

  it('a replay of the same Idempotency-Key reports the stored rows', async () => {
    vi.setSystemTime(SLOT_MS - 10 * HOUR);
    const key = newKey();
    const body = bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT);
    const first = await bookPublicly(a.slug, body, key);
    expect(first.status).toBe(201);
    const again = await bookPublicly(a.slug, body, key);
    expect(again.status).toBe(200);
    expect(again.body!.reminders).toEqual({ h24: false, h2: true });
    expect(await stored(again.body!.appointment.id)).toEqual(again.body!.reminders);
  });
});

describe('waitlist claim: reminders equals the ReminderJob rows', () => {
  async function openOffer() {
    const e = await seedEntry(prisma, a.businessId, scn.serviceId, { createdAt: new Date(SLOT_MS - 90 * HOUR) });
    const freed = await prisma.appointment.create({
      data: {
        businessId: a.businessId,
        clientId: e.clientId,
        serviceId: scn.serviceId,
        staffId: scn.staffIds[0]!,
        startAt: new Date(SLOT_MS),
        endAt: new Date(SLOT_MS + 30 * MIN),
        blockedUntil: new Date(SLOT_MS + 30 * MIN),
        status: 'CANCELLED',
        source: 'PUBLIC',
      },
    });
    const expiresAt = new Date(Date.now() + 30 * MIN);
    const offer = await prisma.waitlistOffer.create({
      data: {
        businessId: a.businessId,
        entryId: e.entryId,
        staffId: scn.staffIds[0]!,
        startAt: new Date(SLOT_MS),
        endAt: new Date(SLOT_MS + 30 * MIN),
        expiresAt,
        freedFromAppointmentId: freed.id,
      },
    });
    return offerToken(offer.id, expiresAt);
  }

  it.each(LEADS)('%s', async (_label, lead, expected) => {
    vi.setSystemTime(SLOT_MS - lead - 5 * MIN);
    const token = await openOffer();
    vi.setSystemTime(SLOT_MS - lead);
    const res = await offerClaim(token);
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual(expected);
    expect(await stored(res.body!.appointment.id)).toEqual(res.body!.reminders);
    // A repeat claim answers with the same truth.
    const again = await offerClaim(token);
    expect(again.status).toBe(200);
    expect(again.body!.reminders).toEqual(expected);
  });
});

describe('DST in Asia/Beirut: the windows are absolute hours, not wall-clock days', () => {
  // Spring forward: Sunday 28 Mar 2027, 00:00 -> 01:00 (UTC+2 -> UTC+3). 09:00 that day is 06:00Z.
  const SPRING = '2027-03-28T06:00:00.000Z';

  it('booked at the same wall-clock time the day before (spring): only 23 h away, no H24', async () => {
    vi.setSystemTime(Date.parse('2027-03-27T07:00:00.000Z')); // Saturday 09:00 local (UTC+2)
    const res = await bookPublicly(a.slug, bookingBody(scn.serviceId, scn.staffIds[0]!, SPRING));
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual({ h24: false, h2: true });
    expect(await stored(res.body!.appointment.id)).toEqual({ h24: false, h2: true });
  });

  it('booked 24 h before the slot across the same change: H24 and H2', async () => {
    vi.setSystemTime(Date.parse('2027-03-27T06:00:00.000Z')); // Saturday 08:00 local
    const res = await bookPublicly(a.slug, bookingBody(scn.serviceId, scn.staffIds[0]!, SPRING));
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual({ h24: true, h2: true });
    expect(await stored(res.body!.appointment.id)).toEqual({ h24: true, h2: true });
  });

  it('fall back: Sunday 25 Oct 2026 is 25 h long, booked at the same wall-clock time the day before, H24 exists', async () => {
    // Sunday 25 Oct 2026, 09:00 local (UTC+2 again) = 07:00Z; Saturday 09:00 local (UTC+3) = 06:00Z.
    vi.setSystemTime(Date.parse('2026-10-24T06:00:00.000Z'));
    const res = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, '2026-10-25T07:00:00.000Z'),
    );
    expect(res.status).toBe(201);
    expect(res.body!.reminders).toEqual({ h24: true, h2: true });
    expect(await stored(res.body!.appointment.id)).toEqual({ h24: true, h2: true });
  });
});

describe('deposit: the confirmed screen uses the post-payment truth', () => {
  async function holdFor(bookedAtMs: number) {
    const national = newPhone();
    await seedClient(prisma, a.businessId, {
      name: 'Nadia NoShow',
      phone: normalizePhone(national)!,
      noShows: 1,
    });
    await call(patchBusiness, '/api/business', {
      method: 'PATCH',
      cookie: a.cookie,
      body: { depositEnabled: true, depositThreshold: 1, depositAmount: 5 },
    });
    vi.setSystemTime(bookedAtMs);
    const res = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: national, email: 'nadia@example.test' }),
    );
    expect(res.status).toBe(201);
    expect(res.body!.status).toBe('PENDING_PAYMENT');
    return res;
  }

  it('a hold has no reminders until it is paid', async () => {
    const hold = await holdFor(SLOT_MS - 30 * HOUR);
    expect(hold.body!.reminders).toEqual({ h24: false, h2: false });
    expect(await stored(hold.body!.appointment.id)).toEqual({ h24: false, h2: false });
    const pending = await payGet(hold.body!.payToken);
    expect(pending.body!.state).toBe('PENDING');
    expect(pending.body!.reminders).toEqual({ h24: false, h2: false });
  });

  it('held 5 min before the 24 h line and paid 5 min after it: no H24, only H2', async () => {
    const hold = await holdFor(SLOT_MS - 24 * HOUR - 5 * MIN);
    vi.setSystemTime(SLOT_MS - 24 * HOUR + 5 * MIN); // paid with 23 h 55 min to go
    const paid = await payPost(hold.body!.payToken);
    expect(paid.status).toBe(200);
    expect(paid.body!.state).toBe('PAID');
    expect(paid.body!.reminders).toEqual({ h24: false, h2: true });
    expect(await stored(hold.body!.appointment.id)).toEqual({ h24: false, h2: true });
    // Opening the page again later reports the same stored truth.
    const again = await payGet(hold.body!.payToken);
    expect(again.body!.reminders).toEqual({ h24: false, h2: true });
  });

  it('held and paid 24 h 20 min ahead: both', async () => {
    const hold = await holdFor(SLOT_MS - 24 * HOUR - 30 * MIN);
    vi.setSystemTime(SLOT_MS - 24 * HOUR - 20 * MIN);
    const paid = await payPost(hold.body!.payToken);
    expect(paid.body!.reminders).toEqual({ h24: true, h2: true });
    expect(await stored(hold.body!.appointment.id)).toEqual({ h24: true, h2: true });
  });
});
