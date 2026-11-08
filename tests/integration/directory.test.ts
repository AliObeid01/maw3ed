import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { GET as getBusiness, PATCH as patchBusiness } from '@/app/api/business/route';
import { GET as directory } from '@/app/api/public/directory/route';
import { GET as publicPage } from '@/app/api/public/[slug]/route';
import { POST as invite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { fakeEmailProvider } from '@/server/providers/email';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';
import { privateKeysIn } from './helpers/directory';

let pg: Client;
beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});
beforeEach(async () => {
  await truncateAll(pg);
  fakeEmailProvider.reset();
});

interface Tenant {
  cookie: string;
  businessId: string;
  slug: string;
  staffId: string;
}

/** A signed-up business, optionally with services, hours and the listed flag. */
async function tenant(
  name: string,
  opts: {
    prices?: number[];
    hours?: boolean;
    listed?: boolean;
    category?: string | null;
    area?: string | null;
    address?: string | null;
  } = {},
): Promise<Tenant> {
  const { cookie, info, body } = await signup({ businessName: name });
  const businessId = info.business.id as string;
  const staff = await pg.query(`SELECT id FROM "StaffMember" WHERE "businessId" = $1`, [
    businessId,
  ]);
  const staffId = staff.rows[0].id as string;
  let n = 0;
  for (const price of opts.prices ?? [10]) {
    await pg.query(
      `INSERT INTO "Service" (id, "businessId", name, "durationMin", price, "updatedAt")
       VALUES ($1, $2, $3, 30, $4, now())`,
      [`svc-${businessId}-${n}`, businessId, `Service ${n++}`, price],
    );
  }
  if (opts.hours !== false)
    await pg.query(
      `INSERT INTO "WorkingHours" (id, "businessId", "staffId", weekday, "startLocal", "endLocal")
       VALUES ($1, $2, $3, 1, '09:00', '17:00')`,
      [`wh-${businessId}`, businessId, staffId],
    );
  await pg.query(
    `UPDATE "Business" SET listed = $2, category = $3, address = $4, area = $5 WHERE id = $1`,
    [businessId, opts.listed ?? true, opts.category ?? null, opts.address ?? null, opts.area ?? null],
  );
  return { cookie, businessId, slug: body.slug as string, staffId };
}

const list = (query: Record<string, string> = {}) =>
  call(directory, '/api/public/directory', { query });
const names = (r: Awaited<ReturnType<typeof list>>) =>
  (r.body!.businesses as { name: string }[]).map((b) => b.name);

describe('GET /api/public/directory', () => {
  it('lists listed + ready businesses with count and cheapest price, with public caching', async () => {
    await tenant('Studio Nour', {
      prices: [25, 12.5, 40],
      category: 'Salon',
      area: 'beirut',
      address: 'Hamra, Beirut',
    });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    expect(res.body).toEqual({
      businesses: [
        {
          slug: expect.any(String),
          name: 'Studio Nour',
          category: 'Salon',
          area: 'beirut',
          address: 'Hamra, Beirut',
          serviceCount: 3,
          fromPrice: 12.5,
        },
      ],
      nextCursor: null,
    });
  });

  it('excludes unlisted businesses and businesses that are not ready (and inactive services/staff do not count)', async () => {
    await tenant('Listed Ok');
    await tenant('Unlisted', { listed: false });
    await tenant('No Hours', { hours: false });
    const noServices = await tenant('No Services', { prices: [] });
    const inactive = await tenant('Inactive Only');
    await pg.query(`UPDATE "Service" SET active = false WHERE "businessId" = $1`, [
      inactive.businessId,
    ]);
    const nonBookable = await tenant('Not Bookable');
    await pg.query(`UPDATE "StaffMember" SET bookable = false WHERE "businessId" = $1`, [
      nonBookable.businessId,
    ]);
    expect(noServices.businessId).toBeTruthy();
    expect(names(await list())).toEqual(['Listed Ok']);
  });

  it('a listed business that later loses its services drops out; unlisted pages still work by link', async () => {
    const t = await tenant('Going Away');
    expect(names(await list())).toEqual(['Going Away']);
    await pg.query(`DELETE FROM "Service" WHERE "businessId" = $1`, [t.businessId]);
    expect(names(await list())).toEqual([]);
    await pg.query(`UPDATE "Business" SET listed = false WHERE id = $1`, [t.businessId]);
    const page = await call(publicPage, `/api/public/${t.slug}`, { params: { slug: t.slug } });
    expect(page.status).toBe(200);
  });

  it('searches name, category and address case-insensitively, with LIKE wildcards matched literally', async () => {
    await tenant('Alpha Barber', { category: 'Barber', address: 'Achrafieh' });
    await tenant('Beta Clinic', { category: 'Clinic', address: 'Hamra' });
    await tenant('100% Hair', { category: 'Salon', address: 'a_b street' });
    expect(names(await list({ search: 'ALPHA' }))).toEqual(['Alpha Barber']);
    expect(names(await list({ search: 'clin' }))).toEqual(['Beta Clinic']);
    expect(names(await list({ search: 'hamr' }))).toEqual(['Beta Clinic']);
    expect(names(await list({ search: '%' }))).toEqual(['100% Hair']);
    expect(names(await list({ search: '_' }))).toEqual(['100% Hair']);
    expect(names(await list({ search: 'a_b' }))).toEqual(['100% Hair']);
    expect(names(await list({ search: 'a\\b' }))).toEqual([]);
    expect(names(await list({ search: "x' OR '1'='1" }))).toEqual([]);
    // A LITERAL backslash (the LIKE escape character) in the data is found as a backslash, not as an escape.
    await tenant('Back Slash', { category: 'Salon', address: 'C:\\temp' });
    expect(names(await list({ search: '\\' }))).toEqual(['Back Slash']);
    expect(names(await list({ search: 'C:\\te' }))).toEqual(['Back Slash']);
    expect(names(await list({ search: '\\%' }))).toEqual([]);
    expect(names(await list({ search: '\\_' }))).toEqual([]);
    expect(names(await list({ search: 'C:\\\\te' }))).toEqual([]); // two backslashes are two literal characters
    expect(names(await list({ category: 'barber' }))).toEqual(['Alpha Barber']);
    expect(names(await list({ category: 'bar' }))).toEqual([]);
    expect(names(await list({ search: 'beta', category: 'salon' }))).toEqual([]);
  });

  it('paginates by name then id with an opaque cursor and a limit cap', async () => {
    for (const n of ['D', 'B', 'E', 'A', 'C']) await tenant(`Biz ${n}`);
    const p1 = await list({ limit: '2' });
    expect(names(p1)).toEqual(['Biz A', 'Biz B']);
    expect(typeof p1.body!.nextCursor).toBe('string');
    const p2 = await list({ limit: '2', cursor: p1.body!.nextCursor });
    expect(names(p2)).toEqual(['Biz C', 'Biz D']);
    const p3 = await list({ limit: '2', cursor: p2.body!.nextCursor });
    expect(names(p3)).toEqual(['Biz E']);
    expect(p3.body!.nextCursor).toBeNull();

    // Same name: the id breaks the tie and nothing repeats or is skipped.
    await tenant('Biz A');
    const all: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: '1', ...(cursor ? { cursor } : {}) });
      all.push(...names(page));
      cursor = page.body!.nextCursor ?? undefined;
    } while (cursor);
    expect(all).toEqual(['Biz A', 'Biz A', 'Biz B', 'Biz C', 'Biz D', 'Biz E']);
  });

  it('400 on unknown fields, a bad limit and a malformed cursor', async () => {
    for (const query of <Record<string, string>[]>[
      { owner: '1' },
      { limit: '0' },
      { limit: '51' },
      { limit: 'abc' },
      { cursor: '%%%not-a-cursor' },
      { search: 'a\u0000b' },
      { category: '\u0000' },
      { area: 'atlantis' },
      { area: 'Sidon' },
      { area: 'sidon\u0000' },
      { cursor: Buffer.from(JSON.stringify(['a\u0000', 'id'])).toString('base64url') },
      { cursor: Buffer.from('{"a":1}').toString('base64url') },
    ]) {
      const res = await list(query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
    expect((await list({ limit: '50' })).status).toBe(200);
  });

  it('exposes no owner, staff or client data', async () => {
    const t = await tenant('Privacy Check', { category: 'Salon' });
    const res = await list();
    const text = JSON.stringify(res.body);
    expect(Object.keys(res.body!.businesses[0]).sort()).toEqual([
      'address',
      'area',
      'category',
      'fromPrice',
      'name',
      'serviceCount',
      'slug',
    ]);
    expect(privateKeysIn(res.body)).toEqual([]); // exact keys: a business named "Owner's Staff" must not trip this
    expect(Object.keys(res.body!.businesses[0])).not.toContain('timezone');
    expect(text).not.toContain('@example.test');
    expect(text).not.toContain(t.businessId);
    expect(text).not.toContain(t.staffId);
  });

  it('is open to tenants of every business: two listed businesses see the same directory', async () => {
    const a = await tenant('Tenant A');
    await tenant('Tenant B');
    const anonymous = await list();
    const asA = await call(directory, '/api/public/directory', { cookie: a.cookie });
    expect(names(asA)).toEqual(names(anonymous));
    expect(names(anonymous)).toEqual(['Tenant A', 'Tenant B']);
  });
});

describe('GET /api/public/directory: category and area filters (PR-1)', () => {
  async function seedFilters() {
    await tenant('Sidon Barber', { category: 'barbers', area: 'sidon', address: 'Riad El Solh St' });
    await tenant('Sidon Salon', { category: 'hair-salons', area: 'sidon' });
    await tenant('Beirut Barber', { category: 'barbers', area: 'beirut' });
    await tenant('Legacy Salon', { category: 'Salon', area: 'sidon' });
    await tenant('No Area Barber', { category: 'barbers', area: null });
    await tenant('Hidden Barber', { category: 'barbers', area: 'sidon', listed: false });
  }

  it('filters by area, by category, by both, and with search (AND semantics)', async () => {
    await seedFilters();
    expect(names(await list({ area: 'sidon' }))).toEqual([
      'Legacy Salon',
      'Sidon Barber',
      'Sidon Salon',
    ]);
    expect(names(await list({ area: 'beirut' }))).toEqual(['Beirut Barber']);
    expect(names(await list({ category: 'barbers' }))).toEqual([
      'Beirut Barber',
      'No Area Barber',
      'Sidon Barber',
    ]);
    expect(names(await list({ category: 'barbers', area: 'sidon' }))).toEqual(['Sidon Barber']);
    expect(names(await list({ category: 'barbers', area: 'sidon', search: 'salon' }))).toEqual([]);
    expect(names(await list({ area: 'sidon', search: 'sal' }))).toEqual([
      'Legacy Salon',
      'Sidon Salon',
    ]);
    expect(names(await list({ area: 'tyre' }))).toEqual([]);
  });

  it('an empty area or category means unset', async () => {
    await seedFilters();
    expect(names(await list({ area: '', category: '' }))).toHaveLength(5);
  });

  it('a business without an area shows in the unfiltered list only, never under an area', async () => {
    await seedFilters();
    expect(names(await list())).toContain('No Area Barber');
    for (const area of ['sidon', 'beirut', 'tripoli', 'jounieh', 'tyre', 'zahle', 'other'])
      expect(names(await list({ area }))).not.toContain('No Area Barber');
  });

  it('a legacy free-text category stays listed and filterable by the old value', async () => {
    await seedFilters();
    expect(names(await list({ category: 'Salon' }))).toEqual(['Legacy Salon']);
    expect(names(await list({ category: 'salon' }))).toEqual(['Legacy Salon']);
    expect(names(await list({ category: 'salon', area: 'sidon' }))).toEqual(['Legacy Salon']);
    const all = await list();
    expect(
      (all.body!.businesses as { name: string; category: string }[]).find(
        (b) => b.name === 'Legacy Salon',
      )!.category,
    ).toBe('Salon');
  });

  it('returns area and address on each item and nothing private', async () => {
    await seedFilters();
    const res = await list({ area: 'sidon', category: 'barbers' });
    expect(res.body!.businesses).toEqual([
      {
        slug: expect.any(String),
        name: 'Sidon Barber',
        category: 'barbers',
        area: 'sidon',
        address: 'Riad El Solh St',
        serviceCount: 1,
        fromPrice: 10,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('@');
    expect(privateKeysIn(res.body)).toEqual([]);
  });

  it('keeps cursor pagination under a filter', async () => {
    for (const n of ['D', 'B', 'E', 'A', 'C']) await tenant(`Sidon ${n}`, { area: 'sidon' });
    await tenant('Elsewhere', { area: 'beirut' });
    const p1 = await list({ area: 'sidon', limit: '2' });
    expect(names(p1)).toEqual(['Sidon A', 'Sidon B']);
    const p2 = await list({ area: 'sidon', limit: '2', cursor: p1.body!.nextCursor });
    expect(names(p2)).toEqual(['Sidon C', 'Sidon D']);
    const p3 = await list({ area: 'sidon', limit: '2', cursor: p2.body!.nextCursor });
    expect(names(p3)).toEqual(['Sidon E']);
    expect(p3.body!.nextCursor).toBeNull();
  });

  it('only listed and ready businesses are filtered', async () => {
    await seedFilters();
    await tenant('Sidon No Hours', { area: 'sidon', hours: false });
    expect(names(await list({ area: 'sidon', category: 'barbers' }))).toEqual(['Sidon Barber']);
  });
});

describe('PATCH /api/business { listed } needs category and area (PR-1)', () => {
  const patch = (cookie: string, body: unknown) =>
    call(patchBusiness, '/api/business', { method: 'PATCH', cookie, body });

  it('400 with fields.category and fields.area when both are missing; nothing is written', async () => {
    const t = await tenant('No Profile', { listed: false });
    const res = await patch(t.cookie, { listed: true, name: 'Renamed' });
    expect(res.status).toBe(400);
    expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body!.error.fields).sort()).toEqual(['area', 'category']);
    const row = await pg.query(`SELECT listed, name FROM "Business" WHERE id = $1`, [t.businessId]);
    expect(row.rows[0]).toEqual({ listed: false, name: 'No Profile' });
  });

  it('only the missing field is reported', async () => {
    const t = await tenant('Half Profile', { listed: false, category: 'barbers' });
    const res = await patch(t.cookie, { listed: true });
    expect(Object.keys(res.body!.error.fields)).toEqual(['area']);
  });

  it('the same request may set them and list at once', async () => {
    const t = await tenant('One Shot', { listed: false });
    const res = await patch(t.cookie, { listed: true, category: 'spa-massage', area: 'tyre' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ listed: true, category: 'spa-massage', area: 'tyre' });
    expect(names(await list({ area: 'tyre' }))).toEqual(['One Shot']);
  });

  it('a legacy free-text category counts as a category', async () => {
    const t = await tenant('Legacy Cat', { listed: false, category: 'Salon', area: 'zahle' });
    expect((await patch(t.cookie, { listed: true })).status).toBe(200);
  });

  it('a business already listed without an area stays listed and can still change other fields', async () => {
    const t = await tenant('Grandfathered', { listed: true, category: 'Salon' });
    expect((await patch(t.cookie, { name: 'Grandfathered 2' })).status).toBe(200);
    expect((await patch(t.cookie, { listed: true })).status).toBe(200);
    expect(names(await list())).toEqual(['Grandfathered 2']);
    expect(names(await list({ area: 'sidon' }))).toEqual([]);
  });

  it('changing or clearing category and area never unlists', async () => {
    const t = await tenant('Stays Listed', { category: 'barbers', area: 'sidon' });
    const res = await patch(t.cookie, { category: null, area: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ listed: true, category: null, area: null });
    expect((await patch(t.cookie, { area: 'beirut' })).body).toMatchObject({ listed: true });
  });

  it('is atomic: a concurrent write that clears the area before the listing commits makes the listing fail (no listed business without an area)', async () => {
    const t = await tenant('Racing', { listed: false, category: 'barbers', area: 'sidon' });
    // A second connection clears the area and holds the business row lock (not yet committed).
    const other = newClient();
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query(`UPDATE "Business" SET area = NULL WHERE id = $1`, [t.businessId]);
      const listing = patch(t.cookie, { listed: true });
      await new Promise((r) => setTimeout(r, 400)); // the listing request now waits on the row
      await other.query('COMMIT');
      const res = await listing;
      expect(res.status).toBe(400);
      expect(Object.keys(res.body!.error.fields)).toEqual(['area']);
    } finally {
      await other.end();
    }
    const row = await pg.query(`SELECT listed, area FROM "Business" WHERE id = $1`, [t.businessId]);
    expect(row.rows[0]).toEqual({ listed: false, area: null });
  });

  it('two truly concurrent requests (list + clear area) never fail with a 5xx and keep grandfathering', async () => {
    for (let i = 0; i < 5; i++) {
      const t = await tenant(`Both ${i}`, { listed: false, category: 'barbers', area: 'sidon' });
      const [a, b] = await Promise.all([
        patch(t.cookie, { listed: true }),
        patch(t.cookie, { area: null }),
      ]);
      expect(b.status).toBe(200);
      expect([200, 400]).toContain(a.status);
      const row = (
        await pg.query(`SELECT listed, area FROM "Business" WHERE id = $1`, [t.businessId])
      ).rows[0];
      // 200 listed: the listing won the lock first (area is cleared afterwards, grandfathered).
      // 400: the clear won, so the business is not listed.
      expect(row.listed).toBe(a.status === 200);
    }
  });

  it('turning listing off needs no profile', async () => {
    const t = await tenant('Off', { category: null, area: null });
    expect((await patch(t.cookie, { listed: false })).status).toBe(200);
  });
});

describe('PATCH /api/business { listed }', () => {
  const patch = (cookie: string, body: unknown) =>
    call(patchBusiness, '/api/business', { method: 'PATCH', cookie, body });

  it('turning ON needs services, a bookable staff member and hours: 409 NOT_READY lists what is missing', async () => {
    const t = await tenant('Fresh', { prices: [], hours: false, listed: false });
    const res = await patch(t.cookie, { listed: true });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('NOT_READY');
    expect(res.body!.error.data.missing).toEqual(['services', 'hours']);
    const row = await pg.query(`SELECT listed FROM "Business" WHERE id = $1`, [t.businessId]);
    expect(row.rows[0].listed).toBe(false);

    await pg.query(`UPDATE "StaffMember" SET bookable = false WHERE "businessId" = $1`, [
      t.businessId,
    ]);
    const noStaff = await patch(t.cookie, { listed: true });
    expect(noStaff.body!.error.data.missing).toEqual(['services', 'staff', 'hours']);
  });

  it('a rejected listing does not apply other fields from the same request', async () => {
    const t = await tenant('Atomic', { hours: false, listed: false });
    const res = await patch(t.cookie, { listed: true, name: 'Renamed' });
    expect(res.status).toBe(409);
    const row = await pg.query(`SELECT name FROM "Business" WHERE id = $1`, [t.businessId]);
    expect(row.rows[0].name).toBe('Atomic');
  });

  it('turning ON when ready works, appears in the directory, and shows in GET /api/business', async () => {
    const t = await tenant('Ready Biz', { listed: false, category: 'barbers', area: 'sidon' });
    const got = await call(getBusiness, '/api/business', { cookie: t.cookie });
    expect(got.body).toMatchObject({
      listed: false,
      readiness: { services: true, staff: true, hours: true },
    });
    const res = await patch(t.cookie, { listed: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ listed: true });
    expect(names(await list())).toEqual(['Ready Biz']);
  });

  it('turning OFF is always allowed, even when the business is no longer ready', async () => {
    const t = await tenant('Was Ready');
    await pg.query(`DELETE FROM "Service" WHERE "businessId" = $1`, [t.businessId]);
    const res = await patch(t.cookie, { listed: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ listed: false, readiness: { services: false } });
  });

  it('400 on a non-boolean listed value', async () => {
    const t = await tenant('Bad Body');
    expect((await patch(t.cookie, { listed: 'yes' })).status).toBe(400);
  });

  it('STAFF cannot change listed (403) and the value is unchanged', async () => {
    const t = await tenant('Team Biz', { listed: false });
    const inv = await call(invite, '/api/invites', {
      cookie: t.cookie,
      body: { email: 'staff@example.test', role: 'STAFF' },
    });
    expect(inv.status).toBe(201);
    const token = (inv.body!.acceptUrl as string).split('/').pop()!;
    const accepted = await call(acceptInvite, `/api/invites/${token}/accept`, {
      params: { token },
      body: { name: 'Staffer', password: PASSWORD },
    });
    expect(accepted.status).toBe(200);
    const res = await patch(accepted.cookie!, { listed: true });
    expect(res.status).toBe(403);
    const row = await pg.query(`SELECT listed FROM "Business" WHERE id = $1`, [t.businessId]);
    expect(row.rows[0].listed).toBe(false);
  });

  it('tenant isolation: owner A toggling listed never touches business B', async () => {
    const a = await tenant('Iso A', { listed: false, category: 'barbers', area: 'sidon' });
    const b = await tenant('Iso B', { listed: false });
    expect((await patch(a.cookie, { listed: true })).status).toBe(200);
    const rows = await pg.query(`SELECT name, listed FROM "Business" ORDER BY name`);
    expect(rows.rows).toEqual([
      { name: 'Iso A', listed: true },
      { name: 'Iso B', listed: false },
    ]);
    expect(b.cookie).not.toBe(a.cookie);
  });
});
