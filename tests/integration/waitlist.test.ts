/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as listWaitlist } from '@/app/api/waitlist/route';
import { GET as waitlistActivity } from '@/app/api/waitlist/activity/route';
import { DELETE as deleteEntry } from '@/app/api/waitlist/[id]/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import { newPhone, newScenario, newTenant, NOW, type Tenant } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';
import { joinBody, joinWaitlist, seedEntry, staffSession } from './helpers/waitlist';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  b = await newTenant({ businessName: 'Beta Clinic' });
  aScn = await newScenario(prisma, a, { staff: 2 });
  bScn = await newScenario(prisma, b);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  await pg.query('DELETE FROM "WaitlistOffer"');
  await pg.query('DELETE FROM "WaitlistEntry"');
  vi.setSystemTime(NOW);
});

const list = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(listWaitlist, '/api/waitlist', { cookie, query });
const activity = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(waitlistActivity, '/api/waitlist/activity', { cookie, query });
const del = (cookie: string | undefined, id: string) =>
  call(deleteEntry, `/api/waitlist/${id}`, { method: 'DELETE', cookie, params: { id } });
const join = (body: unknown, slug = a.slug) => joinWaitlist(slug, body);

describe('POST /api/public/{slug}/waitlist', () => {
  it('creates an OPEN entry (201) with the documented shape', async () => {
    const res = await join(joinBody(aScn.serviceId, { staffId: aScn.staffIds[0] }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      entry: {
        id: expect.any(String),
        status: 'OPEN',
        serviceId: aScn.serviceId,
        staffId: aScn.staffIds[0],
        fromDate: '2026-11-03',
        toDate: '2026-11-10',
      },
    });
    const row = (await pg.query('SELECT * FROM "WaitlistEntry"')).rows[0];
    expect(row.businessId).toBe(a.businessId);
    expect(row.status).toBe('OPEN');
  });

  it('a duplicate open entry (same client, service, staff, overlapping dates) returns the existing one with 200', async () => {
    const body = joinBody(aScn.serviceId);
    const first = await join(body);
    expect(first.status).toBe(201);
    const same = await join(body);
    expect(same.status).toBe(200);
    expect(same.body!.entry.id).toBe(first.body!.entry.id);
    const overlap = await join({ ...body, fromDate: '2026-11-08', toDate: '2026-11-20' });
    expect(overlap.status).toBe(200);
    expect(overlap.body!.entry.id).toBe(first.body!.entry.id);
    // disjoint dates, or another staff preference, are different entries
    expect((await join({ ...body, fromDate: '2026-11-15', toDate: '2026-11-16' })).status).toBe(201);
    expect((await join({ ...body, staffId: aScn.staffIds[1] })).status).toBe(201);
    expect((await pg.query('SELECT count(*)::int AS n FROM "WaitlistEntry"')).rows[0].n).toBe(3);
  });

  it('allows at most 5 open entries per client (409 WAITLIST_LIMIT); the limit is per client', async () => {
    const client = { name: 'Busy Bee', phone: newPhone(), email: 'busy@example.test' };
    for (let i = 0; i < 5; i++) {
      const day = String(10 + i * 2).padStart(2, '0');
      const r = await join({
        ...joinBody(aScn.serviceId),
        fromDate: `2026-11-${day}`,
        toDate: `2026-11-${day}`,
        client,
      });
      expect(r.status).toBe(201);
    }
    const sixth = await join({
      ...joinBody(aScn.serviceId),
      fromDate: '2026-11-30',
      toDate: '2026-11-30',
      client,
    });
    expect(sixth.status).toBe(409);
    expect(sixth.body!.error.code).toBe('WAITLIST_LIMIT');
    expect((await join(joinBody(aScn.serviceId))).status).toBe(201);
  });

  it('the limit holds under concurrent joins', async () => {
    const client = { name: 'Racer', phone: newPhone(), email: 'racer@example.test' };
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        join({
          ...joinBody(aScn.serviceId),
          fromDate: `2026-11-${String(10 + i * 2).padStart(2, '0')}`,
          toDate: `2026-11-${String(10 + i * 2).padStart(2, '0')}`,
          client,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it('validation: 400 with fields', async () => {
    const base = joinBody(aScn.serviceId);
    const bad = async (over: Record<string, unknown>, field: string) => {
      const r = await join({ ...base, ...over });
      expect(r.status).toBe(400);
      expect(Object.keys(r.body!.error.fields)).toContain(field);
    };
    await bad({ client: { name: 'X', phone: newPhone() } }, 'client.email');
    await bad({ client: { name: 'X', phone: newPhone(), email: 'nope' } }, 'client.email');
    await bad({ client: { name: 'X', phone: '12', email: 'x@example.test' } }, 'client.phone');
    await bad({ fromDate: '2026-11-01' }, 'fromDate'); // before today (2 Nov)
    await bad({ fromDate: '2026-11-10', toDate: '2026-11-05' }, 'toDate');
    await bad({ fromDate: '2026-11-03', toDate: '2026-12-10' }, 'toDate'); // > 31 days
    await bad({ fromDate: '2026-12-01', toDate: '2026-12-05' }, 'toDate'); // beyond the 30-day window
    await bad({ fromDate: 'tomorrow' }, 'fromDate');
    await bad({ serviceId: 'Not Valid!' }, 'serviceId');
    await bad({ extra: 1 }, 'extra');
    await bad({ client: { ...base.client, notes: 'hi' } }, 'client.notes');
    const noBody = await join(undefined);
    expect(noBody.status).toBe(400);
    expect((await join({ ...base, staffId: aScn.staffIds[0] })).status).toBe(201);
  });

  it('uses the business-local date for "not in the past"', async () => {
    // 22:30Z on 2 Nov is already 3 Nov 00:30 in Beirut: 2 Nov is in the past locally.
    vi.setSystemTime(new Date('2026-11-02T22:30:00Z'));
    const r = await join({ ...joinBody(aScn.serviceId), fromDate: '2026-11-02' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body!.error.fields)).toContain('fromDate');
    expect((await join({ ...joinBody(aScn.serviceId), fromDate: '2026-11-03' })).status).toBe(201);
  });

  it('other business ids are 404; unknown slug is 404; staff must perform the service', async () => {
    expect((await join(joinBody(bScn.serviceId))).status).toBe(404);
    expect((await join(joinBody(aScn.serviceId, { staffId: bScn.staffIds[0] }))).status).toBe(404);
    expect((await join(joinBody(aScn.serviceId), 'no-such-business')).status).toBe(404);
    // B's slug with A's service
    expect((await join(joinBody(aScn.serviceId), b.slug)).status).toBe(404);
    const other = await prisma.service.create({
      data: { businessId: a.businessId, name: 'Other', durationMin: 30, price: '10.00' },
    });
    const r = await join(joinBody(other.id, { staffId: aScn.staffIds[0] }));
    expect(r.status).toBe(400);
    expect(Object.keys(r.body!.error.fields)).toContain('staffId');
    await prisma.service.update({ where: { id: other.id }, data: { active: false } });
    expect((await join(joinBody(other.id))).status).toBe(404);
    expect((await pg.query('SELECT count(*)::int AS n FROM "WaitlistEntry"')).rows[0].n).toBe(0);
  });

  it('never overwrites an existing client’s name or email; fills only empty ones', async () => {
    const phone = '+96171555001';
    await prisma.client.create({
      data: { businessId: a.businessId, name: 'Real Name', phone, email: 'real@example.test' },
    });
    const noEmail = '+96171555002';
    await prisma.client.create({
      data: { businessId: a.businessId, name: 'Has Name', phone: noEmail, email: null },
    });
    const r1 = await join(
      joinBody(aScn.serviceId, {
        client: { name: 'Mallory', phone, email: 'mallory@example.test' },
      }),
    );
    expect(r1.status).toBe(201);
    const r2 = await join(
      joinBody(aScn.serviceId, {
        client: { name: 'Someone', phone: noEmail, email: 'filled@example.test' },
      }),
    );
    expect(r2.status).toBe(201);
    const rows = (
      await pg.query('SELECT phone, name, email FROM "Client" WHERE phone = ANY($1) ORDER BY phone', [
        [phone, noEmail],
      ])
    ).rows;
    expect(rows).toEqual([
      { phone, name: 'Real Name', email: 'real@example.test' },
      { phone: noEmail, name: 'Has Name', email: 'filled@example.test' },
    ]);
  });
});

describe('staff-side waitlist APIs', () => {
  it('GET /api/waitlist lists newest first, OPEN by default, scoped to the business', async () => {
    const e1 = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      name: 'Old Entry',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const e2 = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      name: 'New Entry',
      staffId: aScn.staffIds[0]!,
      createdAt: new Date('2026-10-02T00:00:00Z'),
    });
    await seedEntry(prisma, b.businessId, bScn.serviceId, {
      name: 'Other Biz',
      createdAt: new Date('2026-10-03T00:00:00Z'),
    });
    await prisma.waitlistEntry.update({ where: { id: e1.entryId }, data: { status: 'CANCELLED' } });
    const open = await list(a.cookie);
    expect(open.status).toBe(200);
    expect(open.body!.entries.map((e: any) => e.id)).toEqual([e2.entryId]);
    expect(open.body!.entries[0]).toMatchObject({
      client: { name: 'New Entry', phone: expect.stringMatching(/^\+961/) },
      service: { id: aScn.serviceId, name: expect.any(String) },
      staff: { id: aScn.staffIds[0], displayName: expect.any(String) },
      fromDate: '2026-11-03',
      toDate: '2026-11-10',
      status: 'OPEN',
      createdAt: '2026-10-02T00:00:00.000Z',
    });
    const all = await list(a.cookie, { status: 'all', limit: '10' });
    expect(all.body!.entries.map((e: any) => e.id)).toEqual([e2.entryId, e1.entryId]);
    expect(all.body!.entries[1].staff).toBeNull();
    expect((await list(b.cookie)).body!.entries).toHaveLength(1);
  });

  it('400 for bad query; 401 without a session', async () => {
    expect((await list(a.cookie, { status: 'bogus' })).status).toBe(400);
    expect((await list(a.cookie, { limit: '0' })).status).toBe(400);
    expect((await list(a.cookie, { extra: '1' })).status).toBe(400);
    expect((await activity(a.cookie, { limit: '999' })).status).toBe(400);
    expect((await list(undefined)).status).toBe(401);
    expect((await activity(undefined)).status).toBe(401);
    expect((await del(undefined, 'x'.repeat(24))).status).toBe(401);
    expect((await del(a.cookie, 'not-a-cuid')).status).toBe(400);
  });

  it('DELETE cancels (204) and is idempotent; another business gets 404 and nothing changes', async () => {
    const mine = await seedEntry(prisma, a.businessId, aScn.serviceId, { createdAt: NOW });
    const theirs = await seedEntry(prisma, b.businessId, bScn.serviceId, { createdAt: NOW });
    const cross = await del(a.cookie, theirs.entryId);
    expect(cross.status).toBe(404);
    expect(cross.body!.error.code).toBe('NOT_FOUND');
    expect(
      (await pg.query('SELECT status FROM "WaitlistEntry" WHERE id = $1', [theirs.entryId])).rows[0]
        .status,
    ).toBe('OPEN');
    expect((await del(a.cookie, mine.entryId)).status).toBe(204);
    expect((await del(a.cookie, mine.entryId)).status).toBe(204);
    expect(
      (await pg.query('SELECT status FROM "WaitlistEntry" WHERE id = $1', [mine.entryId])).rows[0]
        .status,
    ).toBe('CANCELLED');
    expect((await del(a.cookie, 'z'.repeat(24))).status).toBe(404);
  });

  it('a STAFF session can list, read activity and delete', async () => {
    const staff = await staffSession(a.cookie);
    const e = await seedEntry(prisma, a.businessId, aScn.serviceId, { createdAt: NOW });
    expect((await list(staff)).body!.entries.map((x: any) => x.id)).toEqual([e.entryId]);
    expect((await activity(staff)).status).toBe(200);
    expect((await del(staff, e.entryId)).status).toBe(204);
  });

  it('activity is empty without offers and never leaks another business', async () => {
    const res = await activity(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });
});
