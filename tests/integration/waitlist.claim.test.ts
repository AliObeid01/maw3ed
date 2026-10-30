/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as postLink } from '@/app/api/links/[token]/route';
import { DELETE as deleteEntry } from '@/app/api/waitlist/[id]/route';
import { GET as waitlistActivity } from '@/app/api/waitlist/activity/route';
import { expiryFor, signToken } from '@/server/domain/tokens';
import { rootLogger } from '@/server/http/logger';
import { fakeEmailProvider } from '@/server/providers/email';
import { waitlistRepo } from '@/server/repositories/waitlist.repo';
import { defaultWaitlistDeps, deliverOffers, offersService } from '@/server/services/waitlist';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import {
  at,
  bookAtFrontDesk,
  bookingBody,
  bookPublicly,
  newPhone,
  newScenario,
  newTenant,
  NOW,
  type Tenant,
} from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import {
  offerClaim,
  offerGet,
  offerToken,
  runExpiry,
  seedEntry,
  staffCancel,
  tokenFromEmail,
} from './helpers/waitlist';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let otherServiceScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;

const SLOT = at('07:00'); // Wed 4 Nov 09:00 Beirut
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
  b = await newTenant({ businessName: 'Beta Clinic' });
  scn = await newScenario(prisma, a, { staff: 2 });
  otherServiceScn = await newScenario(prisma, a);
  bScn = await newScenario(prisma, b);
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

/** A booked slot (staff 0, 09:00 local on 4 Nov) that is about to be cancelled. */
async function bookedSlot(time = '07:00', staffIdx = 0) {
  const phone = newPhone();
  const res = await bookPublicly(
    a.slug,
    bookingBody(scn.serviceId, scn.staffIds[staffIdx]!, at(time), {
      name: 'Casey Canceller',
      phone,
      email: 'casey@example.test',
    }),
  );
  expect(res.status).toBe(201);
  const id = res.body!.appointment.id as string;
  const clientId = (await pg.query('SELECT "clientId" FROM "Appointment" WHERE id=$1', [id]))
    .rows[0].clientId as string;
  return { id, clientId };
}

const entries = async (n: number, over: Record<string, unknown> = {}) => {
  const out: Array<{ entryId: string; clientId: string; email: string }> = [];
  for (let i = 0; i < n; i++) {
    const email = `w${i}-${Math.random().toString(36).slice(2, 8)}@example.test`;
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
  (
    await pg.query(
      'SELECT o.* FROM "WaitlistOffer" o JOIN "WaitlistEntry" e ON e.id = o."entryId" ORDER BY o.batch, e."createdAt", o.id',
    )
  ).rows;
const entryStatus = async (id: string) =>
  (await pg.query('SELECT status FROM "WaitlistEntry" WHERE id=$1', [id])).rows[0].status as string;
const tokenFor = (email: string) =>
  tokenFromEmail(fakeEmailProvider.calls.find((c) => c.to === email)!.text);
const offerIdOf = async (entryId: string) =>
  (await pg.query('SELECT id FROM "WaitlistOffer" WHERE "entryId"=$1', [entryId])).rows[0]
    .id as string;
const activeAt = async (startAt: string) =>
  (
    await pg.query(
      `SELECT count(*)::int AS n FROM "Appointment" WHERE "startAt"=$1 AND "staffId"=$2 AND status IN ('BOOKED','CONFIRMED')`,
      [startAt, scn.staffIds[0]],
    )
  ).rows[0].n as number;

describe('cancel -> offers (FR-19)', () => {
  it('offers the first 3 matching entries in createdAt order and emails each exactly once', async () => {
    const appt = await bookedSlot();
    // exclusions, all created BEFORE the eligible ones so they would win if they were not excluded
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      clientId: appt.clientId,
      createdAt: at0(1),
    });
    const busy = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[1]!, SLOT, {
        name: 'Busy Bob',
        phone: '+96171000123',
        email: 'bob@example.test',
      }),
    );
    expect(busy.status).toBe(201);
    const busyClient = (
      await pg.query('SELECT id FROM "Client" WHERE phone = $1', ['+96171000123'])
    ).rows[0].id;
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      clientId: busyClient,
      createdAt: at0(2),
    });
    await seedEntry(prisma, a.businessId, otherServiceScn.serviceId, { createdAt: at0(3) });
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      createdAt: at0(4),
      toDate: '2026-11-03',
    });
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      createdAt: at0(5),
      staffId: scn.staffIds[1]!,
    });
    await seedEntry(prisma, b.businessId, bScn.serviceId, { createdAt: at0(6) });
    const eligible = await entries(5);
    // a staff-0 preference is eligible too and sorts by createdAt like the rest
    const pref = await seedEntry(prisma, a.businessId, scn.serviceId, {
      createdAt: at0(12.5),
      staffId: scn.staffIds[0]!,
      email: 'pref@example.test',
    });

    const res = await staffCancel(a.cookie, appt.id);
    expect(res.status).toBe(200);

    const rows = await offers();
    expect(rows.map((r) => r.entryId)).toEqual([
      eligible[0]!.entryId,
      eligible[1]!.entryId,
      eligible[2]!.entryId,
    ]);
    expect(pref.entryId).not.toBe(rows[2].entryId);
    for (const r of rows) {
      expect(r).toMatchObject({
        businessId: a.businessId,
        status: 'OPEN',
        batch: 1,
        staffId: scn.staffIds[0],
        freedFromAppointmentId: appt.id,
      });
      expect(r.startAt.toISOString()).toBe(SLOT);
      expect(r.expiresAt.toISOString()).toBe(later(30).toISOString());
      expect(r.claimedAppointmentId).toBeNull();
    }
    // entries are NOT changed by an offer
    expect(await entryStatus(eligible[0]!.entryId)).toBe('OPEN');

    const sent = fakeEmailProvider.calls;
    expect(sent).toHaveLength(3);
    expect(fakeEmailProvider.delivered.size).toBe(3);
    for (const [i, r] of rows.entries()) {
      // sends run in parallel, so find each mail by recipient
      const m = sent.find((x) => x.to === eligible[i]!.email)!;
      expect(m).toBeDefined();
      expect(m.idempotencyKey).toBe(`waitlist-offer-${r.id}`);
      expect(m.text).toContain('Alpha Salon');
      expect(m.text).toContain('09:00');
      expect(m.text).toContain('10:30'); // the offer is held until 10:30 local
      expect(m.text).toMatch(/http:\/\/localhost:3000\/o\//);
      expect(m.subject).toContain('09:00');
    }
  });

  it('re-sending the same offer sends nothing new (stable key, deterministic payload)', async () => {
    const appt = await bookedSlot();
    const [e] = await entries(1);
    await staffCancel(a.cookie, appt.id);
    const rows = await waitlistRepo.findOffers(a.businessId, [await offerIdOf(e!.entryId)]);
    expect(fakeEmailProvider.delivered.size).toBe(1);
    const before = fakeEmailProvider.calls[0]!;
    vi.setSystemTime(later(5)); // time passing must not change the bytes
    const sentAgain = await deliverOffers(rows, defaultWaitlistDeps, rootLogger);
    expect(sentAgain).toBe(1);
    expect(fakeEmailProvider.delivered.size).toBe(1);
    const after = fakeEmailProvider.calls.at(-1)!;
    expect(after.idempotencyKey).toBe(before.idempotencyKey);
    expect(after.html).toBe(before.html);
    expect(after.text).toBe(before.text);
  });

  it('offers nothing when the slot is closer than the minimum notice', async () => {
    await entries(3);
    // 10:30 local is 30 min away (< 60 min notice); only the front desk can book it
    const booked = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, '2026-11-02T08:30:00.000Z', {
        phone: newPhone(),
        email: 'late@example.test',
      }),
    );
    expect(booked.status).toBe(201);
    expect((await staffCancel(a.cookie, booked.body!.appointment.id)).status).toBe(200);
    expect(await offers()).toHaveLength(0);
    expect(fakeEmailProvider.calls).toHaveLength(0);
  });

  it('caps expiry at slotStart - minNotice when that is sooner than 30 minutes', async () => {
    await entries(1);
    vi.setSystemTime(new Date('2026-11-04T05:50:00Z')); // slot at 07:00Z, notice 60: cutoff 06:00Z
    const booked = await bookAtFrontDesk(
      a.cookie,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { phone: newPhone() }),
    );
    expect(booked.status).toBe(201);
    await staffCancel(a.cookie, booked.body!.appointment.id);
    const rows = await offers();
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.toISOString()).toBe('2026-11-04T06:00:00.000Z');
  });

  it('a late cancel through the client link triggers the offering too', async () => {
    const appt = await bookedSlot();
    const [e] = await entries(1);
    vi.setSystemTime(new Date('2026-11-03T08:00:00Z')); // 23 h before: inside the 24 h cutoff
    const token = signToken(
      { a: appt.id, act: 'cancel', exp: expiryFor(new Date(SLOT)) },
      process.env.LINK_SECRET!,
    );
    const res = await call(postLink, `/api/links/${token}`, {
      params: { token },
      body: { action: 'cancel' },
    });
    expect(res.status).toBe(200);
    expect(res.body!.result).toBe('late_cancelled');
    const rows = await offers();
    expect(rows.map((r) => r.entryId)).toEqual([e!.entryId]);
    expect(fakeEmailProvider.calls).toHaveLength(1);
  });

  it('an on-time link cancel offers the slot as well', async () => {
    const appt = await bookedSlot();
    await entries(2);
    const token = signToken(
      { a: appt.id, act: 'cancel', exp: expiryFor(new Date(SLOT)) },
      process.env.LINK_SECRET!,
    );
    const res = await call(postLink, `/api/links/${token}`, {
      params: { token },
      body: { action: 'cancel' },
    });
    expect(res.body!.result).toBe('cancelled');
    expect(await offers()).toHaveLength(2);
  });

  it('a failure while offering never fails the cancel (staff path and link path)', async () => {
    const spy = vi
      .spyOn(waitlistRepo, 'findFreedAppointment')
      .mockRejectedValue(new Error('database exploded'));
    const one = await bookedSlot();
    const staff = await staffCancel(a.cookie, one.id);
    expect(staff.status).toBe(200);
    expect(staff.body!.appointment.status).toBe('CANCELLED');

    const two = await bookedSlot('07:30');
    const token = signToken(
      { a: two.id, act: 'cancel', exp: expiryFor(new Date(at('07:30'))) },
      process.env.LINK_SECRET!,
    );
    const link = await call(postLink, `/api/links/${token}`, {
      params: { token },
      body: { action: 'cancel' },
    });
    expect(link.status).toBe(200);
    expect(link.body!.result).toBe('cancelled');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a provider failure leaves the offer created and the cancel successful', async () => {
    const appt = await bookedSlot();
    await entries(1);
    fakeEmailProvider.failNext = new Error('provider down');
    const res = await staffCancel(a.cookie, appt.id);
    expect(res.status).toBe(200);
    expect(await offers()).toHaveLength(1);
  });
});

describe('offer page and claim (FR-19)', () => {
  async function offered(n = 3) {
    const appt = await bookedSlot();
    const es = await entries(n);
    await staffCancel(a.cookie, appt.id);
    return { appt, es };
  }

  it('GET shows the offer with no side effects', async () => {
    const { es } = await offered();
    const token = tokenFor(es[0]!.email);
    const snapshot = async () => ({
      offers: await offers(),
      entries: (await pg.query('SELECT id, status FROM "WaitlistEntry" ORDER BY id')).rows,
      appts: (await pg.query('SELECT count(*)::int AS n FROM "Appointment"')).rows[0].n,
      jobs: (await pg.query('SELECT count(*)::int AS n FROM "ReminderJob"')).rows[0].n,
      mail: fakeEmailProvider.calls.length,
    });
    const before = await snapshot();
    for (let i = 0; i < 2; i++) {
      const res = await offerGet(token);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.body).toMatchObject({
        offer: {
          status: 'OPEN',
          startAt: SLOT,
          expiresAt: later(30).toISOString(),
          service: { id: scn.serviceId, durationMin: 30, price: 15 },
          staff: { id: scn.staffIds[0] },
        },
        business: { name: 'Alpha Salon', slug: a.slug, timezone: 'Asia/Beirut', locale: 'en' },
        canClaim: true,
      });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('claim books through the one insert path, fulfils the entry and supersedes the siblings', async () => {
    const { es } = await offered();
    const winner = tokenFor(es[1]!.email);
    const res = await offerClaim(winner);
    expect(res.status).toBe(201);
    expect(res.body!.appointment).toMatchObject({
      startAt: SLOT,
      status: 'BOOKED',
      service: { id: scn.serviceId },
      staff: { id: scn.staffIds[0] },
    });
    expect(res.body!.links.manage).toMatch(/\/l\//);
    const apptId = res.body!.appointment.id as string;
    const row = (await pg.query('SELECT * FROM "Appointment" WHERE id=$1', [apptId])).rows[0];
    expect(row.source).toBe('WAITLIST');
    expect(row.clientId).toBe(es[1]!.clientId);
    // normal reminder jobs come with the booking
    const kinds = (
      await pg.query('SELECT kind, channel FROM "ReminderJob" WHERE "appointmentId"=$1', [apptId])
    ).rows;
    expect(kinds).toContainEqual({ kind: 'BOOKING', channel: 'EMAIL' });
    expect(kinds).toContainEqual({ kind: 'H24', channel: 'EMAIL' });

    expect(await entryStatus(es[1]!.entryId)).toBe('FULFILLED');
    const byEntry = Object.fromEntries((await offers()).map((o) => [o.entryId, o]));
    expect(byEntry[es[1]!.entryId].status).toBe('CLAIMED');
    expect(byEntry[es[1]!.entryId].claimedAppointmentId).toBe(apptId);
    expect(byEntry[es[0]!.entryId].status).toBe('SUPERSEDED');
    expect(byEntry[es[2]!.entryId].status).toBe('SUPERSEDED');
    expect(await entryStatus(es[0]!.entryId)).toBe('OPEN');

    // the others now see TAKEN and cannot claim
    const loser = tokenFor(es[0]!.email);
    const view = await offerGet(loser);
    expect(view.status).toBe(200);
    expect(view.body!.offer.status).toBe('TAKEN');
    expect(view.body!.canClaim).toBe(false);
    const late = await offerClaim(loser);
    expect(late.status).toBe(409);
    expect(late.body!.error.code).toBe('SLOT_TAKEN');
    expect(await activeAt(SLOT)).toBe(1);
  });

  it('a double click returns the first booking (200) and creates nothing new', async () => {
    const { es } = await offered();
    const token = tokenFor(es[0]!.email);
    const first = await offerClaim(token);
    const second = await offerClaim(token);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body!.appointment.id).toBe(first.body!.appointment.id);
    expect(await activeAt(SLOT)).toBe(1);
    expect(
      (
        await pg.query('SELECT count(*)::int AS n FROM "Appointment" WHERE source = $1', [
          'WAITLIST',
        ])
      ).rows[0].n,
    ).toBe(1);
    expect((await offerGet(token)).body!.offer.status).toBe('CLAIMED');
  });

  it('two people claiming at once: exactly one 201, one 409, one appointment', async () => {
    const { es } = await offered(2);
    const [r1, r2] = await Promise.all([
      offerClaim(tokenFor(es[0]!.email)),
      offerClaim(tokenFor(es[1]!.email)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body!.error.code).toBe('SLOT_TAKEN');
    expect(await activeAt(SLOT)).toBe(1);
    const statuses = (await offers()).map((o) => o.status).sort();
    expect(statuses).toEqual(['CLAIMED', 'SUPERSEDED']);
    expect(
      (await pg.query(`SELECT count(*)::int AS n FROM "WaitlistEntry" WHERE status='FULFILLED'`))
        .rows[0].n,
    ).toBe(1);
  });

  it('a slot taken by someone else in the meantime: 409 and the offer becomes TAKEN', async () => {
    const { es } = await offered(1);
    const token = tokenFor(es[0]!.email);
    const stolen = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { email: 'thief@example.test' }),
    );
    expect(stolen.status).toBe(201);
    const res = await offerClaim(token);
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('SLOT_TAKEN');
    expect((await offers())[0].status).toBe('SUPERSEDED');
    expect((await offerGet(token)).body!.offer.status).toBe('TAKEN');
    expect(await entryStatus(es[0]!.entryId)).toBe('OPEN');
  });

  it('after the offer expires: 410 OFFER_EXPIRED (GET and claim)', async () => {
    const { es } = await offered(1);
    const token = tokenFor(es[0]!.email);
    vi.setSystemTime(later(31));
    const claim = await offerClaim(token);
    expect(claim.status).toBe(410);
    expect(claim.body!.error.code).toBe('OFFER_EXPIRED');
    expect((await offerGet(token)).status).toBe(410);
    expect(await activeAt(SLOT)).toBe(0);
  });

  it('410 even when the token outlives the row (expiresAt in the database wins)', async () => {
    const { es } = await offered(1);
    const id = await offerIdOf(es[0]!.entryId);
    const generous = offerToken(id, later(600)); // a token valid for 10 h
    vi.setSystemTime(later(31));
    const res = await offerClaim(generous);
    expect(res.status).toBe(410);
    expect(res.body!.error.code).toBe('OFFER_EXPIRED');
    await runExpiry();
    expect((await offers())[0].status).toBe('EXPIRED');
    const again = await offerClaim(generous);
    expect(again.status).toBe(410);
    expect((await offerGet(generous)).body!.offer.status).toBe('EXPIRED');
  });

  it('bad tokens are 404; a body with fields is 400; a cancelled entry cannot claim', async () => {
    const { es } = await offered(2);
    const token = tokenFor(es[0]!.email);
    expect((await offerGet('garbage')).status).toBe(404);
    expect((await offerClaim('garbage')).status).toBe(404);
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await offerGet(tampered)).status).toBe(404);
    const apptToken = signToken(
      { a: 'x'.repeat(24), act: 'view', exp: expiryFor(new Date(SLOT)) },
      process.env.LINK_SECRET!,
    );
    expect((await offerGet(apptToken)).status).toBe(404);
    const unknown = offerToken('y'.repeat(24), later(10));
    expect((await offerGet(unknown)).status).toBe(404);
    const strict = await offerClaim(token, { force: true });
    expect(strict.status).toBe(400);
    expect(Object.keys(strict.body!.error.fields)).toContain('force');

    const del = await call(deleteEntry, `/api/waitlist/${es[0]!.entryId}`, {
      method: 'DELETE',
      cookie: a.cookie,
      params: { id: es[0]!.entryId },
    });
    expect(del.status).toBe(204);
    const claim = await offerClaim(token);
    expect(claim.status).toBe(409);
    expect(await activeAt(SLOT)).toBe(0);
  });
});

describe('expiry cascade (FR-20)', () => {
  it('expires a batch and offers the next 3, until the entries run out', async () => {
    const appt = await bookedSlot();
    const es = await entries(7);
    await staffCancel(a.cookie, appt.id);
    expect((await offers()).map((o) => o.entryId)).toEqual(es.slice(0, 3).map((e) => e.entryId));

    vi.setSystemTime(later(31));
    const r1 = await runExpiry();
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ expired: 3, offered: 3 });
    let rows = await offers();
    expect(rows.filter((o) => o.batch === 2).map((o) => o.entryId)).toEqual(
      es.slice(3, 6).map((e) => e.entryId),
    );
    expect(rows.filter((o) => o.batch === 2).every((o) => o.status === 'OPEN')).toBe(true);
    expect(rows.filter((o) => o.batch === 1).every((o) => o.status === 'EXPIRED')).toBe(true);
    expect(rows.find((o) => o.batch === 2).expiresAt.toISOString()).toBe(later(61).toISOString());
    expect(fakeEmailProvider.calls).toHaveLength(6);
    expect(fakeEmailProvider.delivered.size).toBe(6);

    // nothing is due yet: a second run is a no-op
    expect((await runExpiry()).body).toEqual({ expired: 0, offered: 0 });

    vi.setSystemTime(later(62));
    expect((await runExpiry()).body).toEqual({ expired: 3, offered: 1 });
    rows = await offers();
    expect(rows.filter((o) => o.batch === 3).map((o) => o.entryId)).toEqual([es[6]!.entryId]);
    vi.setSystemTime(later(93));
    expect((await runExpiry()).body).toEqual({ expired: 1, offered: 0 });
    expect((await runExpiry()).body).toEqual({ expired: 0, offered: 0 });
    expect(await offers()).toHaveLength(7);
    expect(fakeEmailProvider.delivered.size).toBe(7);
  });

  it('does not cascade once the slot is too close to offer', async () => {
    const appt = await bookedSlot();
    await entries(6);
    await staffCancel(a.cookie, appt.id);
    expect(await offers()).toHaveLength(3);
    vi.setSystemTime(new Date('2026-11-04T06:15:00Z')); // 45 min before the slot, notice is 60
    const res = await runExpiry();
    expect(res.body).toEqual({ expired: 3, offered: 0 });
    expect(await offers()).toHaveLength(3);
    expect(fakeEmailProvider.calls).toHaveLength(3);
  });

  it('does not cascade when the slot was taken, or when someone claimed', async () => {
    const appt = await bookedSlot();
    await entries(6);
    await staffCancel(a.cookie, appt.id);
    vi.setSystemTime(later(31));
    const taken = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT, { email: 'x@example.test' }),
    );
    expect(taken.status).toBe(201);
    expect((await runExpiry()).body).toEqual({ expired: 3, offered: 0 });
    expect(await offers()).toHaveLength(3);
  });

  it('a claimed slot is not offered again by the cascade', async () => {
    const appt = await bookedSlot();
    const es = await entries(6);
    await staffCancel(a.cookie, appt.id);
    expect((await offerClaim(tokenFor(es[0]!.email))).status).toBe(201);
    vi.setSystemTime(later(120));
    expect((await runExpiry()).body).toEqual({ expired: 0, offered: 0 });
    expect(await offers()).toHaveLength(3);
  });

  it('overlapping runs never double-offer or double-email', async () => {
    const appt = await bookedSlot();
    await entries(6);
    await staffCancel(a.cookie, appt.id);
    vi.setSystemTime(later(31));
    const runs = await Promise.all([runExpiry(), runExpiry(), runExpiry()]);
    expect(runs.every((r) => r.status === 200)).toBe(true);
    const sum = (k: 'expired' | 'offered') => runs.reduce((n, r) => n + r.body![k], 0);
    expect(sum('expired')).toBe(3);
    expect(sum('offered')).toBe(3);
    const rows = await offers();
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((o) => o.entryId)).size).toBe(6);
    expect(fakeEmailProvider.delivered.size).toBe(6);
    expect(fakeEmailProvider.calls).toHaveLength(6);
  });

  it('is cron-guarded and rejects query parameters', async () => {
    const route = await import('@/app/api/jobs/waitlist-expiry/route');
    expect((await call(route.POST, '/api/jobs/waitlist-expiry', { method: 'POST' })).status).toBe(
      401,
    );
    const bad = await call(route.POST, '/api/jobs/waitlist-expiry', {
      method: 'POST',
      query: { x: '1' },
      headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('activity feed', () => {
  it('groups offers per freed slot with privacy-safe names and isolates tenants', async () => {
    const appt = await bookedSlot();
    const es = await entries(3);
    await staffCancel(a.cookie, appt.id);
    const feed = (cookie: string) =>
      call(waitlistActivity, '/api/waitlist/activity', { cookie, query: { limit: '10' } });
    let res = await feed(a.cookie);
    expect(res.body!.items).toHaveLength(1);
    expect(res.body!.items[0]).toMatchObject({
      type: 'OFFERED',
      offeredTo: 3,
      claimedBy: null,
      slot: { startAt: SLOT, service: { id: scn.serviceId }, staff: { id: scn.staffIds[0] } },
    });
    expect((await feed(b.cookie)).body).toEqual({ items: [] });

    await prisma.client.update({
      where: { id: es[1]!.clientId },
      data: { name: 'Rami Haddad' },
    });
    expect((await offerClaim(tokenFor(es[1]!.email))).status).toBe(201);
    res = await feed(a.cookie);
    expect(res.body!.items).toHaveLength(1);
    expect(res.body!.items[0]).toMatchObject({
      type: 'CLAIMED',
      offeredTo: 3,
      claimedBy: { name: 'Rami' },
    });
    expect(JSON.stringify(res.body)).not.toContain('Haddad');

    // an unclaimed slot shows as EXPIRED once nobody is left
    const appt2 = await bookedSlot('08:00');
    await seedEntry(prisma, a.businessId, scn.serviceId, {
      createdAt: at0(900),
      fromDate: '2026-11-04',
      toDate: '2026-11-04',
    });
    await staffCancel(a.cookie, appt2.id);
    vi.setSystemTime(later(31));
    await runExpiry();
    res = await feed(a.cookie);
    expect(res.body!.items.map((i: any) => i.type).sort()).toEqual(['CLAIMED', 'EXPIRED']);
  });
});

describe('one entry, two different slots claimed at the same instant (F21)', () => {
  it('books exactly one of them', async () => {
    const [w] = await entries(1);
    const first = await bookedSlot('07:00', 0);
    const second = await bookedSlot('07:00', 1);
    expect((await staffCancel(a.cookie, first.id)).status).toBe(200);
    expect((await staffCancel(a.cookie, second.id)).status).toBe(200);
    const rows = (
      await pg.query('SELECT id FROM "WaitlistOffer" WHERE "entryId"=$1 ORDER BY id', [w!.entryId])
    ).rows as Array<{ id: string }>;
    expect(rows).toHaveLength(2);

    // Both claims pass every pre-check before either inserts (bounded wait: the fix rejects one early).
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const timer = setTimeout(() => release(), 400);
    const deps = {
      ...defaultWaitlistDeps,
      afterAvailability: async () => {
        if (++arrived === 2) release();
        await gate;
      },
    };
    const ctx = { businessId: a.businessId, requestId: 'r', logger: rootLogger };
    const results = await Promise.allSettled(rows.map((r) => offersService.claim(ctx, r.id, deps)));
    clearTimeout(timer);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const booked = await pg.query(
      `SELECT count(*)::int AS n FROM "Appointment" WHERE "clientId"=$1 AND source='WAITLIST' AND status IN ('BOOKED','CONFIRMED')`,
      [w!.clientId],
    );
    expect(booked.rows[0].n).toBe(1);
    expect(await entryStatus(w!.entryId)).toBe('FULFILLED');
  });
});
