import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getReport } from '@/app/api/pilot/report/route';
import { fakeEmailProvider } from '@/server/providers/email';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  bookingBody,
  bookPublicly,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { seedAppointment, seedClient } from './helpers/outcomes';
import { offerClaim, offerToken, seedEntry, staffCancel, tokenFromEmail } from './helpers/waitlist';

// F26-1: the pilot report's waitlist signal must count offers created before the day of the first appointment.

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;

const DAY3 = '2026-11-05'; // 3 days after NOW (Mon 2 Nov)
const slotAt = (time: string, day = DAY3) => `${day}T${time}:00.000Z`;

const report = (cookie: string) => call(getReport, '/api/pilot/report', { cookie });
const signals = async () => (await report(a.cookie)).body!.signals;

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
  scn = await newScenario(prisma, a);
  bScn = await newScenario(prisma, b);
  // The business was created a while before NOW (independent of the real clock).
  await pg.query(`UPDATE "Business" SET "createdAt" = $1`, [new Date('2026-10-20T08:00:00Z')]);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'ReminderJob', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  fakeEmailProvider.reset();
  vi.setSystemTime(NOW);
});

async function bookSlot(time: string) {
  const res = await bookPublicly(
    a.slug,
    bookingBody(scn.serviceId, scn.staffIds[0]!, slotAt(time), {
      name: 'Casey Canceller',
      phone: newPhone(),
      email: 'casey@example.test',
    }),
  );
  expect(res.status).toBe(201);
  return res.body!.appointment.id as string;
}

async function waiters(n: number) {
  const out: { entryId: string; email: string }[] = [];
  for (let i = 0; i < n; i++) {
    const email = `w${i}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const e = await seedEntry(prisma, a.businessId, scn.serviceId, {
      name: `Waiter ${i}`,
      email,
      fromDate: '2026-11-03',
      toDate: '2026-11-10',
      createdAt: new Date(NOW.getTime() - 1_000_000 + i * 1000),
    });
    out.push({ entryId: e.entryId, email });
  }
  return out;
}

/** A cancelled appointment plus a direct offer row, for the cases the real flow cannot date. */
async function seededOffer(
  startAt: string,
  status: 'CLAIMED' | 'EXPIRED' | 'OPEN',
  createdAt: Date,
  opts: { freedFrom?: string; tenant?: Tenant; scenario?: typeof scn } = {},
) {
  const tenant = opts.tenant ?? a;
  const scenario = opts.scenario ?? scn;
  let freedFrom = opts.freedFrom;
  if (!freedFrom) {
    const c = await seedClient(prisma, tenant.businessId);
    freedFrom = (
      await seedAppointment(prisma, {
        businessId: tenant.businessId,
        clientId: c.id,
        staffId: scenario.staffIds[0]!,
        serviceId: scenario.serviceId,
        startAt,
        status: 'CANCELLED',
        cancelledVia: 'LINK',
      })
    ).id;
  }
  const entry = await seedEntry(prisma, tenant.businessId, scenario.serviceId, {
    createdAt: new Date(NOW.getTime() - 5000),
  });
  await prisma.waitlistOffer.create({
    data: {
      businessId: tenant.businessId,
      entryId: entry.entryId,
      staffId: scenario.staffIds[0]!,
      startAt: new Date(startAt),
      endAt: new Date(new Date(startAt).getTime() + 30 * 60_000),
      expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
      status,
      freedFromAppointmentId: freedFrom,
      createdAt,
    },
  });
  return freedFrom;
}

describe('pilot report: waitlist refills before the first appointment day (F26-1)', () => {
  it('first appointment 3 days ahead, cancelled, 3 offers, 1 claim: 1 slot offered, 1 refill, 100 %', async () => {
    const id = await bookSlot('07:00');
    const ws = await waiters(3);
    expect((await staffCancel(a.cookie, id)).status).toBe(200);
    const mail = fakeEmailProvider.calls.find((c) => c.to === ws[1]!.email)!;
    expect((await offerClaim(tokenFromEmail(mail.text))).status).toBe(201);
    expect(await signals()).toMatchObject({
      waitlistSlotsOffered: 1,
      waitlistRefills: 1,
      waitlistRefillRate: 100,
    });
  });

  it('a second freed slot offered but not claimed: 2 offered, 1 refilled, 50 %', async () => {
    const id1 = await bookSlot('07:00');
    const id2 = await bookSlot('09:00');
    await waiters(3);
    expect((await staffCancel(a.cookie, id1)).status).toBe(200);
    expect((await staffCancel(a.cookie, id2)).status).toBe(200);
    const offer = (
      await pg.query(`SELECT id, "expiresAt" FROM "WaitlistOffer" WHERE "startAt" = $1 LIMIT 1`, [
        slotAt('07:00'),
      ])
    ).rows[0];
    expect((await offerClaim(offerToken(offer.id, offer.expiresAt))).status).toBe(201);
    expect(await signals()).toMatchObject({
      waitlistSlotsOffered: 2,
      waitlistRefills: 1,
      waitlistRefillRate: 50,
    });
  });

  it('offers from a prior local week and around the DST change (Beirut, 25 Oct) are counted once', async () => {
    await seedAppointment(prisma, {
      businessId: a.businessId,
      clientId: (await seedClient(prisma, a.businessId)).id,
      staffId: scn.staffIds[0]!,
      serviceId: scn.serviceId,
      startAt: slotAt('07:00'),
      status: 'BOOKED',
    });
    await seededOffer(slotAt('08:00', '2026-10-26'), 'CLAIMED', new Date('2026-10-22T10:00:00Z'));
    await seededOffer(slotAt('08:00', '2026-10-27'), 'EXPIRED', new Date('2026-10-24T21:30:00Z')); // DST night, local 25 Oct 00:30
    await seededOffer(slotAt('08:00', '2026-10-28'), 'EXPIRED', new Date('2026-10-25T21:30:00Z')); // Sun 23:30 local
    expect(await signals()).toMatchObject({
      waitlistSlotsOffered: 3,
      waitlistRefills: 1,
      waitlistRefillRate: 33.3,
    });
  });

  it('the same freed slot offered in two batches counts once', async () => {
    const freed = await seededOffer(slotAt('08:00'), 'EXPIRED', new Date('2026-11-01T10:00:00Z'));
    await seededOffer(slotAt('08:00'), 'CLAIMED', new Date('2026-11-01T11:00:00Z'), {
      freedFrom: freed,
    });
    expect(await signals()).toMatchObject({
      waitlistSlotsOffered: 1,
      waitlistRefills: 1,
      waitlistRefillRate: 100,
    });
  });

  it("another business's offers are never counted", async () => {
    await seededOffer(slotAt('08:00'), 'CLAIMED', new Date('2026-11-01T10:00:00Z'), {
      tenant: b,
      scenario: bScn,
    });
    expect(await signals()).toMatchObject({
      waitlistSlotsOffered: 0,
      waitlistRefills: 0,
      waitlistRefillRate: null,
    });
  });

  it('an unpaid deposit claim (offer still OPEN) is not a refill', async () => {
    await seededOffer(slotAt('08:00'), 'OPEN', new Date('2026-11-01T10:00:00Z'));
    expect(await signals()).toMatchObject({
      waitlistSlotsOffered: 1,
      waitlistRefills: 0,
      waitlistRefillRate: 0,
    });
  });

  it('no offers: zero offered and a null rate', async () => {
    expect(await signals()).toMatchObject({
      waitlistSlotsOffered: 0,
      waitlistRefills: 0,
      waitlistRefillRate: null,
    });
  });
});
