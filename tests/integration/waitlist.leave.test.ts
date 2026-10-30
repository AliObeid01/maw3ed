import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as leaveRoute } from '@/app/api/offers/[token]/leave/route';
import { leaveExpiryFor, signToken } from '@/server/domain/tokens';
import { fakeEmailProvider } from '@/server/providers/email';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import { newScenario, newTenant, NOW, type Tenant } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { offerToken, seedEntry } from './helpers/waitlist';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let scn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;

const leave = (token: string, body: unknown = {}) =>
  call(leaveRoute, `/api/offers/${token}/leave`, { params: { token }, body });
const leaveToken = (offerId: string, expiresAt: Date) =>
  signToken({ o: offerId, act: 'leave', exp: leaveExpiryFor(expiresAt) }, process.env.LINK_SECRET!);

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
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  fakeEmailProvider.reset();
});

/** An OPEN entry with one OPEN offer (a freed appointment is needed for the FK). */
async function entryWithOffer(t: Tenant, s: typeof scn) {
  const e = await seedEntry(prisma, t.businessId, s.serviceId, { createdAt: NOW });
  const appt = await prisma.appointment.create({
    data: {
      businessId: t.businessId,
      clientId: e.clientId,
      serviceId: s.serviceId,
      staffId: s.staffIds[0]!,
      startAt: new Date(NOW.getTime() + 2 * 86_400_000),
      endAt: new Date(NOW.getTime() + 2 * 86_400_000 + 3_600_000),
      blockedUntil: new Date(NOW.getTime() + 2 * 86_400_000 + 3_600_000),
      status: 'CANCELLED',
      source: 'PUBLIC',
    },
  });
  const expiresAt = new Date(NOW.getTime() + 3_600_000);
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
  return { ...e, offerId: offer.id, expiresAt };
}
const entryStatus = async (id: string) =>
  (await pg.query('SELECT status FROM "WaitlistEntry" WHERE id=$1', [id])).rows[0].status as string;

describe('POST /api/offers/{token}/leave (F23)', () => {
  it('removes the entry, supersedes its offer, and is idempotent without leaking data', async () => {
    const o = await entryWithOffer(a, scn);
    const token = leaveToken(o.offerId, o.expiresAt);
    const first = await leave(token);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ removed: true });
    expect(await entryStatus(o.entryId)).toBe('CANCELLED');
    const offer = await pg.query('SELECT status FROM "WaitlistOffer" WHERE id=$1', [o.offerId]);
    expect(offer.rows[0].status).toBe('SUPERSEDED');
    const again = await leave(token);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ removed: true });
  });

  it('works after the offer itself has expired (the link outlives the offer)', async () => {
    const o = await entryWithOffer(a, scn);
    const token = leaveToken(o.offerId, o.expiresAt);
    vi.setSystemTime(new Date(o.expiresAt.getTime() + 86_400_000));
    expect((await leave(token)).status).toBe(200);
    vi.setSystemTime(NOW);
  });

  it('400 on an unknown body field', async () => {
    const o = await entryWithOffer(a, scn);
    const res = await leave(leaveToken(o.offerId, o.expiresAt), { email: 'x@example.test' });
    expect(res.status).toBe(400);
    expect(res.body!.error.fields).toBeDefined();
    expect(await entryStatus(o.entryId)).toBe('OPEN');
  });

  it('404 for a claim token (wrong scope) and nothing is removed', async () => {
    const o = await entryWithOffer(a, scn);
    const res = await leave(offerToken(o.offerId, o.expiresAt));
    expect(res.status).toBe(404);
    expect(await entryStatus(o.entryId)).toBe('OPEN');
  });

  it('404 for garbage and for a token signed with another secret', async () => {
    const o = await entryWithOffer(a, scn);
    expect((await leave('not-a-token')).status).toBe(404);
    const forged = signToken(
      { o: o.offerId, act: 'leave', exp: leaveExpiryFor(o.expiresAt) },
      'another-secret-another-secret-0123456789',
    );
    expect((await leave(forged)).status).toBe(404);
    expect(await entryStatus(o.entryId)).toBe('OPEN');
  });

  it('a token only ever affects its own business (cross-tenant offers are untouched)', async () => {
    const mine = await entryWithOffer(a, scn);
    const theirs = await entryWithOffer(b, bScn);
    expect((await leave(leaveToken(mine.offerId, mine.expiresAt))).status).toBe(200);
    expect(await entryStatus(theirs.entryId)).toBe('OPEN');
    // an offer id that exists nowhere
    expect((await leave(leaveToken('nope-nope-nope', mine.expiresAt))).status).toBe(404);
  });

  it('a fulfilled entry is kept', async () => {
    const o = await entryWithOffer(a, scn);
    await pg.query(`UPDATE "WaitlistEntry" SET status='FULFILLED' WHERE id=$1`, [o.entryId]);
    const res = await leave(leaveToken(o.offerId, o.expiresAt));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: false });
    expect(await entryStatus(o.entryId)).toBe('FULFILLED');
  });
});
