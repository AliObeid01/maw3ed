/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { fakeEmailProvider } from '@/server/providers/email';
import { rootLogger } from '@/server/http/logger';
import { waitlistRepo } from '@/server/repositories/waitlist.repo';
import { defaultWaitlistDeps, offersService, runWaitlistExpiry } from '@/server/services/waitlist';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  at,
  bookingBody,
  bookPublicly,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { offerClaim, runExpiry, seedEntry, staffCancel, tokenFromEmail } from './helpers/waitlist';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;

const SLOT = at('07:00');
const MIN = 60_000;
const at0 = (n: number) => new Date(NOW.getTime() - 1_000_000 + n * 1000);
const later = (min: number) => new Date(NOW.getTime() + min * MIN);

beforeAll(async () => {
  process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  scn = await newScenario(prisma, a, { staff: 2 });
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
afterEach(() => {
  vi.restoreAllMocks();
});

async function bookedSlot(time = '07:00') {
  const res = await bookPublicly(
    a.slug,
    bookingBody(scn.serviceId, scn.staffIds[0]!, at(time), {
      name: 'Casey Canceller',
      phone: newPhone(),
      email: 'casey@example.test',
    }),
  );
  expect(res.status).toBe(201);
  return res.body!.appointment.id as string;
}

const entries = async (n: number, over: Record<string, unknown> = {}) => {
  const out: Array<{ entryId: string; clientId: string; email: string }> = [];
  for (let i = 0; i < n; i++) {
    const email = `h${i}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const e = await seedEntry(prisma, a.businessId, scn.serviceId, {
      name: `Waiter ${i}`,
      email,
      createdAt: at0(10 + i),
      ...over,
    });
    out.push({ ...e, email });
  }
  return out;
};

const offers = async () =>
  (await pg.query('SELECT * FROM "WaitlistOffer" ORDER BY batch, id')).rows;
const entryStatus = async (id: string) =>
  (await pg.query('SELECT status FROM "WaitlistEntry" WHERE id=$1', [id])).rows[0].status as string;
const tokenFor = (email: string) =>
  tokenFromEmail(fakeEmailProvider.calls.find((c) => c.to === email)!.text);
const claimCtx = () => ({
  businessId: a.businessId,
  requestId: 'req-test-0001',
  logger: rootLogger,
});
const activeAppts = async () =>
  (
    await pg.query(
      `SELECT count(*)::int AS n FROM "Appointment" WHERE "startAt"=$1 AND status IN ('BOOKED','CONFIRMED')`,
      [SLOT],
    )
  ).rows[0].n as number;

describe('serialised batches', () => {
  it('overlapping runs never leave more than 3 OPEN offers on a slot', async () => {
    const appt = await bookedSlot();
    await entries(9);
    await staffCancel(a.cookie, appt);
    vi.setSystemTime(later(31));
    // sample the invariant while the runs race
    let max = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const n = (
          await pg.query(
            `SELECT count(*)::int AS n FROM "WaitlistOffer" WHERE status = 'OPEN' AND "freedFromAppointmentId" = $1`,
            [appt],
          )
        ).rows[0].n as number;
        max = Math.max(max, n);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    const runs = await Promise.all([runExpiry(), runExpiry(), runExpiry(), runExpiry()]);
    sampling = false;
    await sampler;
    expect(runs.every((r) => r.status === 200)).toBe(true);
    expect(max).toBeLessThanOrEqual(3);
    const open = (await offers()).filter((o) => o.status === 'OPEN');
    expect(open).toHaveLength(3);
    expect(open.every((o) => o.batch === 2)).toBe(true);
    expect((await offers()).filter((o) => o.batch === 2)).toHaveLength(3);
    expect(runs.reduce((n, r) => n + r.body!.offered, 0)).toBe(3);
  });

  it('a client with two entries is offered the slot once (across batches too)', async () => {
    const appt = await bookedSlot();
    const [one] = await entries(1);
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      clientId: one!.clientId,
      contactEmail: 'second@example.test',
      createdAt: at0(500),
    });
    await entries(1, { createdAt: at0(600) });
    await staffCancel(a.cookie, appt);
    expect(await offers()).toHaveLength(2); // client one (earliest entry) + the other client
    vi.setSystemTime(later(31));
    await runExpiry();
    expect(await offers()).toHaveLength(2); // the second entry of client one is never offered
  });
});

describe('offer email delivery', () => {
  it('records emailedAt, and retries after a provider outage without duplicating', async () => {
    const appt = await bookedSlot();
    const [e] = await entries(1);
    fakeEmailProvider.failNext = new Error('provider down');
    await staffCancel(a.cookie, appt);
    expect((await offers())[0].emailedAt).toBeNull();
    expect(fakeEmailProvider.delivered.size).toBe(0);

    // too soon: the original attempt may still be in flight
    await runExpiry();
    expect(fakeEmailProvider.delivered.size).toBe(0);

    vi.setSystemTime(later(2));
    const run = await runExpiry();
    expect(run.status).toBe(200);
    expect(fakeEmailProvider.delivered.size).toBe(1);
    expect(fakeEmailProvider.calls.at(-1)!.to).toBe(e!.email);
    const row = (await offers())[0];
    expect(row.emailedAt).not.toBeNull();
    expect(row.status).toBe('OPEN');

    // already emailed: later runs send nothing more
    const calls = fakeEmailProvider.calls.length;
    vi.setSystemTime(later(5));
    await runExpiry();
    expect(fakeEmailProvider.calls).toHaveLength(calls);
  });

  it('a normal send sets emailedAt; an expired unsent offer is not resent', async () => {
    const appt = await bookedSlot();
    await entries(2);
    fakeEmailProvider.failNext = new Error('down'); // first of the two sends fails
    await staffCancel(a.cookie, appt);
    const rows = await offers();
    expect(rows.filter((o) => o.emailedAt !== null)).toHaveLength(1);
    vi.setSystemTime(later(40)); // past expiry: the sweep expires it instead of mailing it
    const before = fakeEmailProvider.delivered.size;
    await runExpiry();
    expect(fakeEmailProvider.delivered.size).toBe(before);
  });
});

describe('claim bookkeeping', () => {
  it('a claim that races the expiry job still ends CLAIMED and FULFILLED', async () => {
    const appt = await bookedSlot();
    const [e] = await entries(2);
    await staffCancel(a.cookie, appt);
    const id = (await offers()).find((o) => o.entryId === e!.entryId).id as string;
    const result = await offersService.claim(claimCtx(), id, {
      ...defaultWaitlistDeps,
      // the cron expires the offer after the claim passed its checks but before the booking is recorded
      afterAvailability: async () => {
        await waitlistRepo.expireDue(later(31));
      },
    });
    expect(result.appointment.status).toBe('BOOKED');
    const row = (await offers()).find((o) => o.id === id);
    expect(row.status).toBe('CLAIMED');
    expect(row.claimedAppointmentId).toBe(result.appointment.id);
    expect(await entryStatus(e!.entryId)).toBe('FULFILLED');
    expect((await offers()).filter((o) => o.status === 'OPEN')).toHaveLength(0);
  });

  it('a claim that races the entry being deleted still ends CLAIMED and FULFILLED', async () => {
    const appt = await bookedSlot();
    const [e] = await entries(2);
    await staffCancel(a.cookie, appt);
    const id = (await offers()).find((o) => o.entryId === e!.entryId).id as string;
    const result = await offersService.claim(claimCtx(), id, {
      ...defaultWaitlistDeps,
      afterAvailability: async () => {
        expect(await waitlistRepo.cancelEntry(a.businessId, e!.entryId)).toBe('cancelled');
      },
    });
    const row = (await offers()).find((o) => o.id === id);
    expect(row.status).toBe('CLAIMED');
    expect(row.claimedAppointmentId).toBe(result.appointment.id);
    expect(await entryStatus(e!.entryId)).toBe('FULFILLED');
    expect(await activeAppts()).toBe(1);
  });

  it('a fulfilled or cancelled entry cannot claim another slot (409 before booking)', async () => {
    const first = await bookedSlot('07:00');
    const [e] = await entries(1);
    await staffCancel(a.cookie, first);
    const token = tokenFor(e!.email);
    expect((await offerClaim(token)).status).toBe(201);

    // a second freed slot is offered to the same entry by force, as if it were still OPEN
    const second = await bookedSlot('07:30');
    await prisma.waitlistEntry.update({ where: { id: e!.entryId }, data: { status: 'OPEN' } });
    await staffCancel(a.cookie, second);
    const offer2 = (await offers()).find((o) => o.freedFromAppointmentId === second);
    expect(offer2).toBeDefined();
    const t2 = tokenFromEmail(fakeEmailProvider.calls.filter((c) => c.to === e!.email).at(-1)!.text);
    expect(t2).not.toBe(token);
    await prisma.waitlistEntry.update({ where: { id: e!.entryId }, data: { status: 'FULFILLED' } });
    const before = (await pg.query('SELECT count(*)::int AS n FROM "Appointment"')).rows[0].n;
    const res = await offerClaim(t2);
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('CONFLICT');
    expect((await pg.query('SELECT count(*)::int AS n FROM "Appointment"')).rows[0].n).toBe(before);

    await prisma.waitlistEntry.update({ where: { id: e!.entryId }, data: { status: 'CANCELLED' } });
    expect((await offerClaim(t2)).status).toBe(409);
  });

  it('repeating a claim whose booking was later cancelled is 409, not the old booking', async () => {
    const appt = await bookedSlot();
    const [e] = await entries(1);
    await staffCancel(a.cookie, appt);
    const token = tokenFor(e!.email);
    const first = await offerClaim(token);
    expect(first.status).toBe(201);
    expect((await staffCancel(a.cookie, first.body!.appointment.id)).status).toBe(200);
    const again = await offerClaim(token);
    expect(again.status).toBe(409);
    expect(again.body!.appointment).toBeUndefined();
  });
});

describe('cascade scan', () => {
  it('only returns slots that still have an unoffered, eligible entry', async () => {
    const appt = await bookedSlot();
    await entries(3);
    await staffCancel(a.cookie, appt);
    vi.setSystemTime(later(31));
    await waitlistRepo.expireDue(new Date());
    // every entry has been offered: nothing to scan
    expect(await waitlistRepo.cascadeCandidates(new Date(), 50)).toEqual([]);
    await entries(1, { createdAt: at0(900) });
    expect(await waitlistRepo.cascadeCandidates(new Date(), 50)).toEqual([
      { businessId: a.businessId, freedFromAppointmentId: appt },
    ]);
  });

  it('stops early when the run budget is used up', async () => {
    const a1 = await bookedSlot('07:00');
    const a2 = await bookedSlot('07:30');
    await entries(8);
    await staffCancel(a.cookie, a1);
    await staffCancel(a.cookie, a2);
    vi.setSystemTime(later(31));
    let tick = 0;
    const res = await runWaitlistExpiry(rootLogger, {
      ...defaultWaitlistDeps,
      monotonic: () => (tick += 100_000), // every check looks like 100 s passed
    });
    expect(res.offered).toBe(0);
    // a normal run picks the work up
    expect((await runWaitlistExpiry(rootLogger)).offered).toBeGreaterThan(0);
  });
});

describe('the query plan uses the partial OPEN index', () => {
  it('exists in the schema', async () => {
    const r = await pg.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'WaitlistOffer_open_expiresAt_idx'`,
    );
    expect(r.rows[0].indexdef).toContain("WHERE (status = 'OPEN'");
  });
});
