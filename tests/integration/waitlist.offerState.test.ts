import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as leaveRoute } from '@/app/api/offers/[token]/leave/route';
import { leaveExpiryFor, signToken } from '@/server/domain/tokens';
import { fakeEmailProvider } from '@/server/providers/email';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
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
import { offerClaim, offerGet, offerToken, seedEntry } from './helpers/waitlist';

// F26-2: every state of an offer link has its own truthful status and claim error.

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;

const SLOT_1 = at('07:00');
const SLOT_2 = at('09:00');
const MIN = 60_000;

beforeAll(async () => {
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
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  vi.setSystemTime(NOW);
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  fakeEmailProvider.reset();
});

/** A cancelled appointment that "freed" `slot` (the FK of an offer). */
async function freed(t: Tenant, s: typeof scn, clientId: string, slot: string) {
  const startAt = new Date(slot);
  return prisma.appointment.create({
    data: {
      businessId: t.businessId,
      clientId,
      serviceId: s.serviceId,
      staffId: s.staffIds[0]!,
      startAt,
      endAt: new Date(startAt.getTime() + 60 * MIN),
      blockedUntil: new Date(startAt.getTime() + 60 * MIN),
      status: 'CANCELLED',
      source: 'PUBLIC',
    },
  });
}

/** One OPEN entry with an OPEN offer per slot given. */
async function entryWithOffers(t: Tenant, s: typeof scn, slots: string[] = [SLOT_1]) {
  const e = await seedEntry(prisma, t.businessId, s.serviceId, { createdAt: NOW });
  const offers: { id: string; token: string }[] = [];
  const expiresAt = new Date(NOW.getTime() + 30 * MIN);
  for (const slot of slots) {
    const appt = await freed(t, s, e.clientId, slot);
    const offer = await prisma.waitlistOffer.create({
      data: {
        businessId: t.businessId,
        entryId: e.entryId,
        staffId: s.staffIds[0]!,
        startAt: appt.startAt,
        endAt: appt.endAt,
        expiresAt,
        freedFromAppointmentId: appt.id,
        batch: 1,
      },
    });
    offers.push({ id: offer.id, token: offerToken(offer.id, expiresAt) });
  }
  return { ...e, offers, expiresAt };
}

const leave = (offerId: string, expiresAt: Date) => {
  const token = signToken(
    { o: offerId, act: 'leave', exp: leaveExpiryFor(expiresAt) },
    process.env.LINK_SECRET!,
  );
  return call(leaveRoute, `/api/offers/${token}/leave`, { params: { token }, body: {} });
};
const appointments = async () =>
  (await pg.query(`SELECT count(*)::int AS n FROM "Appointment" WHERE status <> 'CANCELLED'`))
    .rows[0].n as number;

describe('offer view: what the rejoin link pre-fills (F49)', () => {
  it('exposes the request service and staff preference (anyone = null) and nothing about the client', async () => {
    const any = await entryWithOffers(a, scn);
    const view = await offerGet(any.offers[0]!.token);
    expect(view.status).toBe(200);
    expect(view.body!.rejoin).toEqual({ serviceId: scn.serviceId, staffId: null });
    expect(view.body!.business.slug).toBe(a.slug);
    const raw = JSON.stringify(view.body);
    expect(raw).not.toMatch(/phone|email|@example\.test|Waiter/);

    const picky = await seedEntry(prisma, a.businessId, scn.serviceId, {
      createdAt: NOW,
      staffId: scn.staffIds[0]!,
    });
    const appt = await freed(a, scn, picky.clientId, SLOT_2);
    const expiresAt = new Date(NOW.getTime() + 30 * MIN);
    const offer = await prisma.waitlistOffer.create({
      data: {
        businessId: a.businessId,
        entryId: picky.entryId,
        staffId: scn.staffIds[0]!,
        startAt: appt.startAt,
        endAt: appt.endAt,
        expiresAt,
        freedFromAppointmentId: appt.id,
        batch: 1,
      },
    });
    const view2 = await offerGet(offerToken(offer.id, expiresAt));
    expect(view2.body!.rejoin).toEqual({ serviceId: scn.serviceId, staffId: scn.staffIds[0]! });
  });

  it("an offer link only ever shows its own business: tenant B's data never appears in A's view", async () => {
    const o = await entryWithOffers(a, scn);
    await entryWithOffers(b, bScn);
    const view = await offerGet(o.offers[0]!.token);
    expect(view.body!.business.slug).toBe(a.slug);
    expect(view.body!.rejoin.serviceId).toBe(scn.serviceId);
    expect(view.body!.rejoin.serviceId).not.toBe(bScn.serviceId);
    expect(JSON.stringify(view.body)).not.toContain(b.slug);
  });
});

describe('offer link states (F26-2)', () => {
  it('(d) the client left the waitlist, then opens the old link: UNAVAILABLE, claim is WAITLIST_INACTIVE (never TAKEN)', async () => {
    const o = await entryWithOffers(a, scn);
    expect((await leave(o.offers[0]!.id, o.expiresAt)).status).toBe(200);
    const view = await offerGet(o.offers[0]!.token);
    expect(view.status).toBe(200);
    expect(view.body!.offer.status).toBe('UNAVAILABLE');
    expect(view.body!.canClaim).toBe(false);
    const res = await offerClaim(o.offers[0]!.token);
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('WAITLIST_INACTIVE');
    expect(await appointments()).toBe(0);
  });

  it('(d) staff removed the entry: the same UNAVAILABLE state', async () => {
    const o = await entryWithOffers(a, scn);
    await pg.query(`UPDATE "WaitlistEntry" SET status='CANCELLED' WHERE id=$1`, [o.entryId]);
    await pg.query(`UPDATE "WaitlistOffer" SET status='SUPERSEDED' WHERE id=$1`, [o.offers[0]!.id]);
    expect((await offerGet(o.offers[0]!.token)).body!.offer.status).toBe('UNAVAILABLE');
    expect((await offerClaim(o.offers[0]!.token)).body!.error.code).toBe('WAITLIST_INACTIVE');
  });

  it('(c) two offers of one request, one claimed: the other link says ALREADY_BOOKED, claim is ALREADY_BOOKED', async () => {
    const o = await entryWithOffers(a, scn, [SLOT_1, SLOT_2]);
    expect((await offerClaim(o.offers[0]!.token)).status).toBe(201);
    const mine = await offerGet(o.offers[0]!.token);
    expect(mine.body!.offer.status).toBe('CLAIMED');
    const other = await offerGet(o.offers[1]!.token);
    expect(other.status).toBe(200);
    expect(other.body!.offer.status).toBe('ALREADY_BOOKED');
    expect(other.body!.canClaim).toBe(false);
    const res = await offerClaim(o.offers[1]!.token);
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('ALREADY_BOOKED');
    expect(await appointments()).toBe(1);
  });

  it('(a) the slot was booked by someone else: claim is SLOT_TAKEN and the link then says TAKEN', async () => {
    const o = await entryWithOffers(a, scn);
    const thief = await bookPublicly(
      a.slug,
      bookingBody(scn.serviceId, scn.staffIds[0]!, SLOT_1, { email: 'thief@example.test' }),
    );
    expect(thief.status).toBe(201);
    const res = await offerClaim(o.offers[0]!.token);
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('SLOT_TAKEN');
    expect((await offerGet(o.offers[0]!.token)).body!.offer.status).toBe('TAKEN');
    expect((await offerClaim(o.offers[0]!.token)).body!.error.code).toBe('SLOT_TAKEN');
  });

  it('(a) another waiting client claimed the slot first: the loser sees TAKEN while still waiting', async () => {
    const o = await entryWithOffers(a, scn);
    await pg.query(`UPDATE "WaitlistOffer" SET status='SUPERSEDED' WHERE id=$1`, [o.offers[0]!.id]);
    expect((await offerGet(o.offers[0]!.token)).body!.offer.status).toBe('TAKEN');
    expect((await offerClaim(o.offers[0]!.token)).body!.error.code).toBe('SLOT_TAKEN');
  });

  it('(b) an expired offer is EXPIRED and claim is 410 OFFER_EXPIRED', async () => {
    const o = await entryWithOffers(a, scn);
    await pg.query(`UPDATE "WaitlistOffer" SET status='EXPIRED' WHERE id=$1`, [o.offers[0]!.id]);
    expect((await offerGet(o.offers[0]!.token)).body!.offer.status).toBe('EXPIRED');
    const res = await offerClaim(o.offers[0]!.token);
    expect(res.status).toBe(410);
    expect(res.body!.error.code).toBe('OFFER_EXPIRED');
    // past the deadline the signed link itself has lapsed: 410 on read and on claim
    vi.setSystemTime(new Date(o.expiresAt.getTime() + MIN));
    expect((await offerGet(o.offers[0]!.token)).status).toBe(410);
    expect((await offerClaim(o.offers[0]!.token)).status).toBe(410);
  });

  it('the public view carries nothing about other clients', async () => {
    const o = await entryWithOffers(a, scn, [SLOT_1, SLOT_2]);
    await offerClaim(o.offers[0]!.token);
    const body = (await offerGet(o.offers[1]!.token)).body!;
    expect(Object.keys(body).sort()).toEqual(['business', 'canClaim', 'offer', 'rejoin']);
    expect(Object.keys(body.rejoin).sort()).toEqual(['serviceId', 'staffId']);
    expect(Object.keys(body.offer).sort()).toEqual(
      ['endAt', 'expiresAt', 'id', 'service', 'staff', 'startAt', 'status'].sort(),
    );
  });

  it('(e) forged, garbage, wrong-scope and unknown-offer tokens are 404', async () => {
    const o = await entryWithOffers(a, scn);
    const forged = signToken(
      { o: o.offers[0]!.id, act: 'claim', exp: o.expiresAt.getTime() },
      'another-secret-another-secret-another',
    );
    expect((await offerGet(forged)).status).toBe(404);
    expect((await offerClaim(forged)).status).toBe(404);
    expect((await offerGet('garbage')).status).toBe(404);
    const leaveTok = signToken(
      { o: o.offers[0]!.id, act: 'leave', exp: leaveExpiryFor(o.expiresAt) },
      process.env.LINK_SECRET!,
    );
    expect((await offerGet(leaveTok)).status).toBe(404);
    expect((await offerClaim(leaveTok)).status).toBe(404);
    expect((await offerGet(offerToken('no-such-offer', o.expiresAt))).status).toBe(404);
    // another business's offer is its own token: it never reveals or books anything of Alpha's
    const other = await entryWithOffers(b, bScn);
    expect((await offerGet(other.offers[0]!.token)).body!.business.name).toBe('Beta Clinic');
  });

  it('400 on an unknown claim body field', async () => {
    const o = await entryWithOffers(a, scn);
    const res = await offerClaim(o.offers[0]!.token, { businessId: 'x' });
    expect(res.status).toBe(400);
    expect(res.body!.error.fields).toBeDefined();
    expect(await appointments()).toBe(0);
  });
});
