/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as listWaitlist } from '@/app/api/waitlist/route';
import { DELETE as deleteEntry } from '@/app/api/waitlist/[id]/route';
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
import { seedEntry, staffCancel, staffSession } from './helpers/waitlist';

// F65: the waitlist screen's list. OPEN entries only, oldest first (the order offers are sent), first name and
// masked phone only: the full phone and the email never leave the server.

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
  for (const t of ['WaitlistOffer', 'WaitlistEntry', 'ReminderJob', 'Appointment', 'Client'])
    await pg.query(`DELETE FROM "${t}"`);
  fakeEmailProvider.reset();
  vi.setSystemTime(NOW);
});

const list = (cookie: string | undefined, query: Record<string, string> = {}) =>
  call(listWaitlist, '/api/waitlist', { cookie, query });
const del = (cookie: string | undefined, id: string) =>
  call(deleteEntry, `/api/waitlist/${id}`, { method: 'DELETE', cookie, params: { id } });

describe('GET /api/waitlist (the waitlist screen)', () => {
  it('lists only OPEN entries of this business, oldest first, with exactly the screen fields', async () => {
    const newer = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      name: 'Newer Person',
      phone: '+96171000222',
      staffId: aScn.staffIds[0]!,
      fromDate: '2026-11-05',
      toDate: '2026-11-12',
      createdAt: new Date('2026-10-02T00:00:00Z'),
    });
    const older = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      name: 'Older Person',
      phone: '+96171000111',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const cancelled = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      createdAt: new Date('2026-09-30T00:00:00Z'),
    });
    const fulfilled = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      createdAt: new Date('2026-09-29T00:00:00Z'),
    });
    await seedEntry(prisma, b.businessId, bScn.serviceId, {
      name: 'Other Biz',
      createdAt: new Date('2026-09-28T00:00:00Z'),
    });
    await prisma.waitlistEntry.update({
      where: { id: cancelled.entryId },
      data: { status: 'CANCELLED' },
    });
    await prisma.waitlistEntry.update({
      where: { id: fulfilled.entryId },
      data: { status: 'FULFILLED' },
    });

    const res = await list(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body!.entries.map((e: any) => e.id)).toEqual([older.entryId, newer.entryId]);
    expect(res.body!.total).toBe(2);
    expect(res.body!.entries[1]).toEqual({
      id: newer.entryId,
      client: { firstName: 'Newer', phone: '•••• ••• 222' },
      service: { id: aScn.serviceId, name: expect.any(String) },
      staff: { id: aScn.staffIds[0], displayName: expect.any(String) },
      fromDate: '2026-11-05',
      toDate: '2026-11-12',
      createdAt: '2026-10-02T00:00:00.000Z',
    });
    expect(res.body!.entries[0].staff).toBeNull();
  });

  it('never returns an email or a full phone number', async () => {
    await seedEntry(prisma, a.businessId, aScn.serviceId, {
      name: 'Secret Keeper',
      phone: '+96171987654',
      email: 'secret.keeper@example.test',
      contactEmail: 'contact.address@example.test',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const res = await list(a.cookie);
    const raw = JSON.stringify(res.body);
    expect(res.status).toBe(200);
    expect(raw).not.toContain('@');
    expect(raw).not.toContain('example.test');
    expect(raw).not.toContain('96171987654');
    expect(raw).not.toContain('71987654');
    expect(raw).not.toContain('Keeper');
    expect(raw).toContain('654');
  });

  it('answers OWNER and STAFF, 401 when signed out, 400 for bad query', async () => {
    const e = await seedEntry(prisma, a.businessId, aScn.serviceId, { createdAt: NOW });
    const staff = await staffSession(a.cookie);
    expect((await list(staff)).body!.entries.map((x: any) => x.id)).toEqual([e.entryId]);
    expect((await list(a.cookie)).status).toBe(200);
    expect((await list(undefined)).status).toBe(401);
    const bad: Array<Record<string, string>> = [
      { status: 'all' },
      { status: 'bogus' },
      { limit: '0' },
      { limit: '101' },
      { limit: 'x' },
      { extra: '1' },
    ];
    for (const query of bad) {
      const res = await list(a.cookie, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('caps the rows at limit and still reports the real total', async () => {
    for (let i = 0; i < 3; i++)
      await seedEntry(prisma, a.businessId, aScn.serviceId, {
        createdAt: new Date(NOW.getTime() - 100_000 + i * 1000),
      });
    const res = await list(a.cookie, { limit: '2' });
    expect(res.body!.entries).toHaveLength(2);
    expect(res.body!.total).toBe(3);
  });

  it('never shows another business, and an empty list is not an error', async () => {
    await seedEntry(prisma, b.businessId, bScn.serviceId, { createdAt: NOW });
    const res = await list(a.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [], total: 0 });
    expect((await list(b.cookie)).body!.total).toBe(1);
  });
});

describe('DELETE /api/waitlist/{id} (Remove on the screen)', () => {
  it('removes the entry from the list and it no longer receives offers', async () => {
    const booked = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'), {
        name: 'Casey Canceller',
        phone: '+96171555000',
        email: 'casey@example.test',
      }),
    );
    expect(booked.status).toBe(201);
    const removed = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      name: 'Removed Person',
      email: 'removed@example.test',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const kept = await seedEntry(prisma, a.businessId, aScn.serviceId, {
      name: 'Kept Person',
      email: 'kept@example.test',
      createdAt: new Date('2026-10-02T00:00:00Z'),
    });
    expect((await del(a.cookie, removed.entryId)).status).toBe(204);
    expect((await list(a.cookie)).body!.entries.map((e: any) => e.id)).toEqual([kept.entryId]);

    expect((await staffCancel(a.cookie, booked.body!.appointment.id)).status).toBe(200);
    const sent = [...fakeEmailProvider.calls].map((c) => c.to);
    expect(sent).toContain('kept@example.test');
    expect(sent).not.toContain('removed@example.test');
    const offered = await pg.query('SELECT "entryId" FROM "WaitlistOffer"');
    expect(offered.rows.map((r) => r.entryId)).toEqual([kept.entryId]);
  });

  it('STAFF can remove; a second remove is a quiet 204', async () => {
    const e = await seedEntry(prisma, a.businessId, aScn.serviceId, { createdAt: NOW });
    const staff = await staffSession(a.cookie);
    expect((await del(staff, e.entryId)).status).toBe(204);
    expect((await del(staff, e.entryId)).status).toBe(204);
    expect((await list(staff)).body!.total).toBe(0);
  });

  it("another business's entry is 404 and stays OPEN; bad ids are 400; signed out is 401", async () => {
    const theirs = await seedEntry(prisma, b.businessId, bScn.serviceId, { createdAt: NOW });
    const staff = await staffSession(a.cookie);
    for (const cookie of [a.cookie, staff]) {
      const cross = await del(cookie, theirs.entryId);
      expect(cross.status).toBe(404);
      expect(cross.body!.error.code).toBe('NOT_FOUND');
    }
    expect(
      (await pg.query('SELECT status FROM "WaitlistEntry" WHERE id=$1', [theirs.entryId])).rows[0]
        .status,
    ).toBe('OPEN');
    expect((await list(b.cookie)).body!.total).toBe(1);
    expect((await del(a.cookie, 'not-a-cuid')).status).toBe(400);
    expect((await del(undefined, 'x'.repeat(24))).status).toBe(401);
  });
});
