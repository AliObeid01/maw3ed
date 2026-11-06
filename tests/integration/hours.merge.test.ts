import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { GET as getHours, PUT as putHours } from '@/app/api/staff/[id]/hours/route';
import { POST as copyHours } from '@/app/api/staff/[id]/hours/copy/route';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call, PASSWORD } from './helpers/api';
import { DAY, getSlots, newTenant, NOW, startsOf, type Tenant } from './helpers/booking';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  prisma = newPrisma();
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Business A', slug: 'business-a' });
  b = await newTenant({ businessName: 'Business B', slug: 'business-b' });
});

const iv = (weekday: number, startLocal: string, endLocal: string) => ({
  weekday,
  startLocal,
  endLocal,
});
const idp = (id: string) => ({ params: { id } });
const newStaff = async (t: Tenant, name: string, over: Record<string, unknown> = {}) =>
  (await prisma.staffMember.create({ data: { businessId: t.businessId, displayName: name, ...over } })).id;
const put = (cookie: string, id: string, intervals: unknown) =>
  call(putHours, `/api/staff/${id}/hours`, { method: 'PUT', cookie, ...idp(id), body: { intervals } });
const copy = (cookie: string, id: string, body: unknown) =>
  call(copyHours, `/api/staff/${id}/hours/copy`, { method: 'POST', cookie, ...idp(id), body });
const rows = async (staffId: string) =>
  (
    await pg.query(
      'SELECT weekday, "startLocal", "endLocal" FROM "WorkingHours" WHERE "staffId" = $1 ORDER BY weekday, "startLocal"',
      [staffId],
    )
  ).rows;

async function staffSession(t: Tenant) {
  const inv = await call(createInvite, '/api/invites', {
    body: { email: 'recep@example.test', role: 'STAFF' },
    cookie: t.cookie,
  });
  const token = inv.body!.acceptUrl.split('/invite/')[1];
  const res = await call(acceptInvite, `/api/invites/${token}/accept`, {
    body: { name: 'Reception', password: PASSWORD },
    params: { token },
  });
  return res.cookie as string;
}

describe('PUT /api/staff/{id}/hours merges touching blocks', () => {
  it('stores and returns touching blocks as one; a real break stays two; the midnight split is untouched', async () => {
    const m = await newStaff(a, 'Nour');
    const res = await put(a.cookie, m, [
      iv(3, '17:00', '22:00'),
      iv(3, '09:00', '17:00'),
      iv(1, '09:00', '12:00'),
      iv(1, '13:00', '17:00'),
      iv(5, '09:00', '24:00'),
      iv(6, '00:00', '02:00'),
    ]);
    expect(res.status).toBe(200);
    expect(res.body!.intervals).toEqual([
      iv(1, '09:00', '12:00'),
      iv(1, '13:00', '17:00'),
      iv(3, '09:00', '22:00'),
      iv(5, '09:00', '24:00'),
      iv(6, '00:00', '02:00'),
    ]);
    expect(await rows(m)).toHaveLength(5);
    const got = await call(getHours, `/api/staff/${m}/hours`, { cookie: a.cookie, ...idp(m) });
    expect(got.body).toEqual(res.body);
  });

  it('still rejects real overlaps with 400 (merging only joins touching blocks)', async () => {
    const m = await newStaff(a, 'Nour');
    expect((await put(a.cookie, m, [iv(1, '09:00', '12:00'), iv(1, '11:00', '13:00')])).status).toBe(400);
  });

  it('16:30 becomes bookable for a 60 min service once 09-17 and 17-22 are merged (slot engine unchanged)', async () => {
    const service = await prisma.service.create({
      data: { businessId: a.businessId, name: 'Cut', durationMin: 60, bufferMin: 0, price: '15.00' },
    });
    const m = await newStaff(a, 'Nour');
    await prisma.staffService.create({
      data: { businessId: a.businessId, staffId: m, serviceId: service.id },
    });
    // Stored the OLD way: two touching rows (what existing data looks like until its next save). Wednesday = 3.
    await prisma.workingHours.createMany({
      data: [
        { businessId: a.businessId, staffId: m, weekday: 3, startLocal: '09:00', endLocal: '17:00' },
        { businessId: a.businessId, staffId: m, weekday: 3, startLocal: '17:00', endLocal: '22:00' },
      ],
    });
    // Beirut is UTC+2 on this date: 16:30 local = 14:30Z.
    const before = startsOf((await getSlots(a.slug, { serviceId: service.id, staffId: m, from: DAY, to: DAY })).body!.slots);
    expect(before).toContain(`${DAY}T13:00:00.000Z`); // 15:00 local, ends at 16:00
    expect(before).not.toContain(`${DAY}T14:30:00.000Z`);
    expect(before).not.toContain(`${DAY}T14:15:00.000Z`);

    // The next save (same intervals) stores ONE block.
    const saved = await put(a.cookie, m, [iv(3, '09:00', '17:00'), iv(3, '17:00', '22:00')]);
    expect(saved.body!.intervals).toEqual([iv(3, '09:00', '22:00')]);
    const after = startsOf((await getSlots(a.slug, { serviceId: service.id, staffId: m, from: DAY, to: DAY })).body!.slots);
    for (const hhmm of ['14:15', '14:30', '14:45']) expect(after).toContain(`${DAY}T${hhmm}:00.000Z`);
  });
});

describe('POST /api/staff/{id}/hours/copy', () => {
  it('replaces the targets weekly hours with the source (merged), returns them, leaves time off and services alone', async () => {
    const src = await newStaff(a, 'Source');
    const t1 = await newStaff(a, 'T1');
    const t2 = await newStaff(a, 'T2');
    // Stored split on purpose (old data): the copy normalises it.
    await prisma.workingHours.createMany({
      data: [
        { businessId: a.businessId, staffId: src, weekday: 2, startLocal: '09:00', endLocal: '12:00' },
        { businessId: a.businessId, staffId: src, weekday: 2, startLocal: '12:00', endLocal: '17:00' },
        { businessId: a.businessId, staffId: src, weekday: 4, startLocal: '10:00', endLocal: '14:00' },
      ],
    });
    await put(a.cookie, t1, [iv(0, '08:00', '09:00')]);
    const service = await prisma.service.create({
      data: { businessId: a.businessId, name: 'Cut', durationMin: 30, price: '10.00' },
    });
    await prisma.staffService.create({ data: { businessId: a.businessId, staffId: t1, serviceId: service.id } });
    const off = await prisma.timeOff.create({
      data: {
        businessId: a.businessId,
        staffId: t1,
        startAt: new Date('2026-12-01T00:00:00Z'),
        endAt: new Date('2026-12-05T00:00:00Z'),
        reason: 'VACATION',
      },
    });
    const res = await copy(a.cookie, src, { targetStaffIds: [t1, t2] });
    expect(res.status).toBe(200);
    const expected = [iv(2, '09:00', '17:00'), iv(4, '10:00', '14:00')];
    expect(res.body).toEqual({
      staff: [
        { staffId: t1, intervals: expected },
        { staffId: t2, intervals: expected },
      ],
    });
    expect(await rows(t1)).toEqual(expected);
    expect(await rows(t2)).toEqual(expected);
    expect(await rows(src)).toHaveLength(3); // the source is not rewritten
    expect(await prisma.timeOff.findUnique({ where: { id: off.id } })).not.toBeNull();
    expect(await prisma.staffService.count({ where: { staffId: t1 } })).toBe(1);
  });

  it('skips legacy source rows whose end is not after the start instead of failing with a 500', async () => {
    const src = await newStaff(a, 'Source');
    const t1 = await newStaff(a, 'T1');
    await prisma.workingHours.createMany({
      data: [{ businessId: a.businessId, staffId: src, weekday: 2, startLocal: '09:00', endLocal: '12:00' }],
    });
    // Old data from before the CHECK existed: only possible while the constraint is off.
    await pg.query('ALTER TABLE "WorkingHours" DROP CONSTRAINT workinghours_end_after_start');
    try {
      await pg.query(
        `INSERT INTO "WorkingHours" (id, "businessId", "staffId", weekday, "startLocal", "endLocal")
         VALUES ('legacy1', $1, $2, 2, '15:00', '15:00'), ('legacy2', $1, $2, 3, '18:00', '09:00')`,
        [a.businessId, src],
      );
      const res = await copy(a.cookie, src, { targetStaffIds: [t1] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ staff: [{ staffId: t1, intervals: [iv(2, '09:00', '12:00')] }] });
      expect(await rows(t1)).toEqual([iv(2, '09:00', '12:00')]);
    } finally {
      await pg.query("DELETE FROM \"WorkingHours\" WHERE id IN ('legacy1', 'legacy2')");
      await pg.query(
        'ALTER TABLE "WorkingHours" ADD CONSTRAINT workinghours_end_after_start CHECK ("endLocal" > "startLocal")',
      );
    }
  });

  it('an empty source clears the targets', async () => {
    const src = await newStaff(a, 'Source');
    const t1 = await newStaff(a, 'T1');
    await put(a.cookie, t1, [iv(1, '09:00', '10:00')]);
    expect((await copy(a.cookie, src, { targetStaffIds: [t1] })).body).toEqual({
      staff: [{ staffId: t1, intervals: [] }],
    });
    expect(await rows(t1)).toEqual([]);
  });

  it('a staff id of another business -> 404 and nothing changes (also as the source)', async () => {
    const src = await newStaff(a, 'Source');
    const t1 = await newStaff(a, 'T1');
    const foreign = await newStaff(b, 'Foreign');
    await put(a.cookie, src, [iv(1, '09:00', '10:00')]);
    await put(a.cookie, t1, [iv(2, '09:00', '10:00')]);
    await put(b.cookie, foreign, [iv(3, '09:00', '10:00')]);
    const res = await copy(a.cookie, src, { targetStaffIds: [t1, foreign] });
    expect(res.status).toBe(404);
    expect(res.body!.error.code).toBe('NOT_FOUND');
    expect(await rows(t1)).toEqual([iv(2, '09:00', '10:00')]); // atomic: t1 was not replaced
    expect(await rows(foreign)).toEqual([iv(3, '09:00', '10:00')]);
    expect((await copy(a.cookie, foreign, { targetStaffIds: [t1] })).status).toBe(404);
    expect(await rows(t1)).toEqual([iv(2, '09:00', '10:00')]);
  });

  it('rolls back every target when the last one fails inside the transaction', async () => {
    const src = await newStaff(a, 'Source');
    const t1 = await newStaff(a, 'T1');
    const t2 = await newStaff(a, 'T2');
    await put(a.cookie, src, [iv(1, '09:00', '10:00')]);
    await put(a.cookie, t1, [iv(2, '09:00', '10:00')]);
    await put(a.cookie, t2, [iv(2, '11:00', '12:00')]);
    // A DB-level failure on the second target: drop the insert privilege path via a trigger.
    await pg.query(`CREATE OR REPLACE FUNCTION fail_hours() RETURNS trigger AS $$ BEGIN
      IF NEW."staffId" = '${t2}' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pg.query(`CREATE TRIGGER fail_hours_t BEFORE INSERT ON "WorkingHours" FOR EACH ROW EXECUTE FUNCTION fail_hours()`);
    try {
      const res = await copy(a.cookie, src, { targetStaffIds: [t1, t2] });
      expect(res.status).toBe(500);
    } finally {
      await pg.query('DROP TRIGGER fail_hours_t ON "WorkingHours"');
      await pg.query('DROP FUNCTION fail_hours()');
    }
    expect(await rows(t1)).toEqual([iv(2, '09:00', '10:00')]);
    expect(await rows(t2)).toEqual([iv(2, '11:00', '12:00')]);
  });

  it('STAFF role is refused with 403; unauthenticated 401', async () => {
    const src = await newStaff(a, 'Source');
    const t1 = await newStaff(a, 'T1');
    const cookie = await staffSession(a);
    expect((await copy(cookie, src, { targetStaffIds: [t1] })).status).toBe(403);
    expect((await copy('', src, { targetStaffIds: [t1] })).status).toBe(401);
    expect(await rows(t1)).toEqual([]);
  });

  it('400: self copy, duplicate ids, empty list, unknown field, malformed id, too many', async () => {
    const src = await newStaff(a, 'Source');
    const t1 = await newStaff(a, 'T1');
    const bad = [
      { targetStaffIds: [src] },
      { targetStaffIds: [t1, t1] },
      { targetStaffIds: [] },
      {},
      { targetStaffIds: [t1], extra: 1 },
      { targetStaffIds: ['not-an-id'] },
      { targetStaffIds: Array.from({ length: 51 }, () => t1) },
    ];
    for (const body of bad) {
      const res = await copy(a.cookie, src, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
      expect(res.body!.error).toHaveProperty('fields');
    }
    expect((await copy(a.cookie, 'not-an-id', { targetStaffIds: [t1] })).status).toBe(400);
  });
});
