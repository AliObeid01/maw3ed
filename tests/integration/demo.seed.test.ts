/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as categories } from '@/app/api/public/categories/route';
import { GET as directory } from '@/app/api/public/directory/route';
import { GET as slots } from '@/app/api/public/[slug]/slots/route';
import { GET as pilotReport } from '@/app/api/pilot/report/route';
import { CATEGORY_KEYS } from '@/lib/business/profile';
import { hashPassword } from '@/server/services/password';
import { generateLogo } from '../../scripts/demo/logos';
import { runChecks } from '../../scripts/demo/checks';
import { FLAGSHIP_SLUG, MANIFEST } from '../../scripts/demo/manifest';
import { buildPlan, type DemoPlan } from '../../scripts/demo/plan';
import { countRows, findConflicts, removeDemo, seedDemo } from '../../scripts/demo/runner';
import type { ProcessedLogo } from '../../src/server/services/logoImage';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { call } from './helpers/api';
import { newClient, newPrisma, setupSchema, truncateAll } from './helpers/db';

/** Tuesday 10 Nov 2026, 11:30 in Beirut (UTC+2). */
const NOW = new Date('2026-11-10T09:30:00Z');
const OWNER_EMAIL = 'demo-owner@demo.invalid';
const OWNER_PASSWORD = 'throwaway-pass-12345';

let pg: Client;
let prisma: PrismaClient;
let plan: DemoPlan;
let logos: Map<string, ProcessedLogo>;
let placeholderHash: string;
let ownerHash: string;
let otherBusinessId: string;
let otherUserId: string;

const makePlan = () =>
  buildPlan({
    now: NOW,
    owner: { email: OWNER_EMAIL, name: 'Demo Owner', passwordHash: ownerHash },
    placeholderHash,
  });

async function makeLogos(p: DemoPlan) {
  const m = new Map<string, ProcessedLogo>();
  let v = 0;
  for (const b of p.businesses) if (b.spec.logo) m.set(b.spec.slug, await generateLogo(b.spec.name, v++));
  return m;
}

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  placeholderHash = await hashPassword(randomBytes(32).toString('hex'));
  ownerHash = await hashPassword(OWNER_PASSWORD);

  // A pre-existing, unrelated business that the demo tooling must never touch.
  const user = await prisma.user.create({ data: { email: 'someone@example.test', name: 'Someone', passwordHash: placeholderHash } });
  const biz = await prisma.business.create({
    data: { slug: 'unrelated-salon', name: 'Unrelated Salon', category: 'hair-salons', area: 'beirut', listed: true },
  });
  await prisma.membership.create({ data: { businessId: biz.id, userId: user.id, role: 'OWNER' } });
  const staff = await prisma.staffMember.create({ data: { businessId: biz.id, displayName: 'Nour' } });
  await prisma.service.create({ data: { businessId: biz.id, name: 'Haircut', durationMin: 30, price: 10 } });
  const client = await prisma.client.create({ data: { businessId: biz.id, name: 'Real Person', phone: '+96170123456', email: 'real@example.test' } });
  const svc = await prisma.service.findFirstOrThrow({ where: { businessId: biz.id } });
  await prisma.appointment.create({
    data: {
      businessId: biz.id, clientId: client.id, staffId: staff.id, serviceId: svc.id,
      startAt: new Date('2026-11-11T07:00:00Z'), endAt: new Date('2026-11-11T07:30:00Z'), blockedUntil: new Date('2026-11-11T07:30:00Z'),
    },
  });
  otherBusinessId = biz.id;
  otherUserId = user.id;

  plan = makePlan();
  logos = await makeLogos(plan);
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma?.$disconnect();
  await pg?.end();
});

describe('demo seed, check, browse, remove, re-seed', () => {
  it('seeds every business inside the DB constraints (the exclusion constraint never fires)', async () => {
    expect(await findConflicts(prisma, plan)).toEqual({ slugs: [], emails: [] });
    await seedDemo(prisma, plan, logos);
    const ids = plan.businesses.map((b) => b.business.id);
    const counts = await countRows(prisma, ids);
    expect(counts.Business).toBe(18);
    expect(counts.BusinessLogo).toBe(15);
    expect(counts.PilotBaseline).toBe(1);
    expect(counts.Payment).toBe(0);
    expect(counts.Appointment).toBe(plan.businesses.reduce((n, b) => n + b.appointments.length, 0));
  });

  it('refuses to seed again while any demo row exists, and says which', async () => {
    const c = await findConflicts(prisma, plan);
    expect(c.slugs).toHaveLength(18);
    expect(c.emails).toContain(OWNER_EMAIL);
    expect(c.emails).toContain('owner+olive-branch-barbers@demo.invalid');
  });

  it('passes every invariant of demo:check and the real pilot report reads as targeted', async () => {
    const report = await runChecks(prisma, NOW);
    const failed = report.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
    const p = report.pilot!;
    expect(p.baselineRate).toBeGreaterThanOrEqual(17);
    expect(p.baselineRate).toBeLessThanOrEqual(19);
    expect(p.currentRate).toBeGreaterThanOrEqual(8.5);
    expect(p.currentRate).toBeLessThanOrEqual(10.5);
    expect(p.relativeChangePct).toBeLessThanOrEqual(-40);
    expect(p.confirmRate).toBeGreaterThanOrEqual(58);
    expect(p.confirmRate).toBeLessThanOrEqual(72);
    expect(p.waitlistRefillRate).toBeGreaterThanOrEqual(25);
    expect(p.waitlistRefillRate).toBeLessThanOrEqual(42);
    expect(p.cancellationsViaLink).toBeGreaterThan(20);
  });

  it('has no pending e-mail jobs, no client e-mail and no unusable data, straight from SQL', async () => {
    const ids = plan.businesses.map((b) => b.business.id);
    const { rows: pending } = await pg.query(
      `SELECT count(*)::int AS n FROM "ReminderJob" WHERE "businessId" = ANY($1) AND channel = 'EMAIL' AND status IN ('PENDING','SENDING')`,
      [ids],
    );
    expect(pending[0].n).toBe(0);
    const { rows: mail } = await pg.query(`SELECT count(*)::int AS n FROM "Client" WHERE "businessId" = ANY($1) AND email IS NOT NULL`, [ids]);
    expect(mail[0].n).toBe(0);
    const { rows: due } = await pg.query(
      `SELECT count(*)::int AS n FROM "ReminderJob" WHERE "businessId" = ANY($1) AND channel = 'WHATSAPP' AND status = 'PENDING' AND "dueAt" <= $2`,
      [ids, NOW],
    );
    expect(due[0].n).toBeGreaterThan(0);
  });

  it('lists the 18 businesses in the public directory, three per category', async () => {
    const all: any[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await call(directory, '/api/public/directory', { query: { limit: '24', ...(cursor ? { cursor } : {}) } });
      expect(r.status).toBe(200);
      all.push(...r.body!.businesses);
      cursor = r.body!.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(all.map((b) => b.slug).sort()).toEqual(MANIFEST.map((b) => b.slug).sort());
    expect(all.some((b) => b.slug === 'unrelated-salon')).toBe(false); // not listed: its profile is incomplete
    for (const c of CATEGORY_KEYS.filter((k) => k !== 'other')) expect(all.filter((b) => b.category === c)).toHaveLength(3);
    for (const b of all) {
      expect(b.address).toBeTruthy();
      expect(b.serviceCount).toBeGreaterThanOrEqual(3);
      expect(b.fromPrice).toBeGreaterThan(0);
    }
    const withLogo = all.filter((b) => b.logoUrl).length;
    expect(withLogo).toBe(15);
  });

  it('shows the marketplace aggregates: 3 places per category, live next-free times, popular services', async () => {
    const r = await call(categories, '/api/public/categories');
    expect(r.status).toBe(200);
    for (const c of r.body!.categories.filter((x: any) => x.category !== 'other')) {
      expect(c.places).toBe(3);
      expect(c.nextFree).not.toBeNull();
      expect(c.popularServices.length).toBeGreaterThan(0);
      expect(c.fromPrice).toBeGreaterThan(0);
    }
    const live = await call(directory, '/api/public/directory', { query: { include: 'nextFree', limit: '12' } });
    expect(live.status).toBe(200);
    for (const b of live.body!.businesses) {
      expect(b.nextFree).not.toBeNull();
      expect(b.freeTimes.length).toBeGreaterThan(0);
    }
  });

  it('returns free public slots today or tomorrow for every business, with the real slot service', async () => {
    const today = DateTime.fromJSDate(NOW, { zone: 'Asia/Beirut' });
    for (const b of plan.businesses) {
      const service = await prisma.service.findFirstOrThrow({ where: { businessId: b.business.id }, orderBy: { sortOrder: 'asc' } });
      const r = await call(slots, `/api/public/${b.spec.slug}/slots`, {
        params: { slug: b.spec.slug },
        query: { serviceId: service.id, from: today.toISODate()!, to: today.plus({ days: 2 }).toISODate()! },
      });
      expect(r.status).toBe(200);
      expect(r.body!.slots.length, b.spec.slug).toBeGreaterThan(0);
    }
  });

  it('lets the demo owner log in through the real login route and read the pilot report; placeholders cannot', async () => {
    const ok = await call(login, '/api/auth/login', { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
    expect(ok.status).toBe(200);
    expect(ok.body!.business?.slug ?? ok.body!.session?.business?.slug ?? JSON.stringify(ok.body)).toContain(FLAGSHIP_SLUG);
    const rep = await call(pilotReport, '/api/pilot/report', { cookie: ok.cookie, query: { weeks: '4' } });
    expect(rep.status).toBe(200);
    expect(rep.body!.baseline.noShows).toBe(20);
    expect(rep.body!.weekly).toHaveLength(4);
    const bad = await call(login, '/api/auth/login', {
      body: { email: 'owner+cedar-barber-lounge@demo.invalid', password: 'anything-at-all-12345' },
    });
    expect(bad.status).toBe(401);
  });

  it('removes only the demo rows: dry run deletes nothing, apply leaves the unrelated business untouched', async () => {
    // The demo owner also belongs to the unrelated business: that user must be KEPT.
    await prisma.membership.create({ data: { businessId: otherBusinessId, userId: (await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } })).id, role: 'STAFF' } });
    const dry = await removeDemo(prisma, { demoOwnerEmail: OWNER_EMAIL, apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.before.Business).toBe(18);
    expect(dry.users.kept.map((k) => k.email)).toEqual([OWNER_EMAIL]);
    expect(await prisma.business.count()).toBe(19);

    const done = await removeDemo(prisma, { demoOwnerEmail: OWNER_EMAIL, apply: true });
    expect(done.applied).toBe(true);
    expect(Object.values(done.after!).every((n) => n === 0)).toBe(true);
    // 17 placeholder owners and Rana are gone; the demo owner (still a member elsewhere) and the unrelated user stay.
    expect(done.users.deleted).toHaveLength(18);
    expect(await prisma.business.findMany({ select: { slug: true } })).toEqual([{ slug: 'unrelated-salon' }]);
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.user.count({ where: { email: { endsWith: '@demo.invalid' } } })).toBe(1);
    const other = await countRows(prisma, [otherBusinessId]);
    expect(other).toMatchObject({ Business: 1, Membership: 2, StaffMember: 1, Service: 1, Client: 1, Appointment: 1 });
    expect(await prisma.client.findFirstOrThrow({ where: { businessId: otherBusinessId } })).toMatchObject({ email: 'real@example.test' });
    expect(otherUserId).toBeTruthy();
    // clean up the extra membership and the leftover demo owner for the re-seed below
    await prisma.membership.deleteMany({ where: { businessId: otherBusinessId, role: 'STAFF' } });
    await prisma.user.deleteMany({ where: { email: OWNER_EMAIL } });
  });

  it('seeds again after a removal and the invariants hold again', async () => {
    plan = makePlan();
    expect(await findConflicts(prisma, plan)).toEqual({ slugs: [], emails: [] });
    await seedDemo(prisma, plan, await makeLogos(plan));
    const report = await runChecks(prisma, NOW);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(await prisma.business.count()).toBe(19);
  });
});
