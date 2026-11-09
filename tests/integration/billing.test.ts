import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { GET as getBilling } from '@/app/api/billing/route';
import { POST as postCheckout } from '@/app/api/billing/checkout/route';
import { POST as postDowngrade } from '@/app/api/billing/downgrade/route';
import { POST as createInvite } from '@/app/api/invites/route';
import { POST as acceptInvite } from '@/app/api/invites/[token]/accept/route';
import { POST as postStaff } from '@/app/api/staff/route';
import { PATCH as patchStaff } from '@/app/api/staff/[id]/route';
import { fakePaymentProvider } from '@/server/providers/payment';
import { call, PASSWORD, signup } from './helpers/api';
import { newClient, setupSchema, truncateAll } from './helpers/db';

let pg: Client;
type Tenant = Awaited<ReturnType<typeof signup>>;
let free: Tenant;
let other: Tenant;

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
  fakePaymentProvider.reset();
  free = await signup({ plan: 'FREE', slug: 'free-biz' });
  other = await signup({ plan: 'FREE', slug: 'other-biz' });
});

const staff = (cookie: string, over: Record<string, unknown> = {}) =>
  call(postStaff, '/api/staff', {
    cookie,
    body: { displayName: 'Nour', bookable: true, serviceIds: [], ...over },
  });
const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(patchStaff, `/api/staff/${id}`, { method: 'PATCH', cookie, body, params: { id } });
const checkout = (cookie: string, key?: string, body: unknown = { plan: 'PRO' }) =>
  call(postCheckout, '/api/billing/checkout', {
    cookie,
    body,
    headers: key ? { 'idempotency-key': key } : {},
  });
const downgrade = (cookie: string, body: unknown = { plan: 'FREE' }) =>
  call(postDowngrade, '/api/billing/downgrade', { cookie, body });
const paymentCount = async (slug: string) =>
  Number(
    (
      await pg.query(
        `SELECT count(*)::int AS n FROM "Payment" p JOIN "Business" b ON b.id = p."businessId" WHERE b.slug = $1`,
        [slug],
      )
    ).rows[0].n,
  );
const planOf = async (slug: string) =>
  (await pg.query(`SELECT plan FROM "Business" WHERE slug = $1`, [slug])).rows[0].plan;

describe('GET /api/billing', () => {
  it('reports plan, limits and usage (owner signup counts as one bookable member)', async () => {
    const res = await call(getBilling, '/api/billing', { cookie: free.cookie });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: 'FREE',
      limits: { bookableStaff: 1 },
      usage: { bookableStaff: 1 },
      price: { amount: 20, currency: 'USD' }, // PR-13: Pro is $20 a month (PLAN_PRICE, single source)
      testMode: true,
    });
  });

  it('400 on unknown query keys, 401 without a session', async () => {
    const bad = await call(getBilling, '/api/billing', { cookie: free.cookie, query: { x: '1' } });
    expect(bad.status).toBe(400);
    expect(bad.body!.error.code).toBe('VALIDATION_FAILED');
    expect((await call(getBilling, '/api/billing')).status).toBe(401);
  });

  it('is owner only (staff role gets 403)', async () => {
    const inv = await call(createInvite, '/api/invites', {
      body: { email: 'recep@example.test', role: 'STAFF' },
      cookie: free.cookie,
    });
    const token = inv.body!.acceptUrl.split('/invite/')[1];
    const accepted = await call(acceptInvite, `/api/invites/${token}/accept`, {
      body: { name: 'Reception', password: PASSWORD },
      params: { token },
    });
    const cookie = accepted.cookie as string;
    expect((await call(getBilling, '/api/billing', { cookie })).status).toBe(403);
    expect((await checkout(cookie)).status).toBe(403);
    expect((await downgrade(cookie)).status).toBe(403);
    expect(await planOf('free-biz')).toBe('FREE');
  });
});

describe('POST /api/billing/checkout', () => {
  it('sets PRO and records one PAID Payment, even when called twice', async () => {
    const first = await checkout(free.cookie);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ plan: 'PRO', limits: { bookableStaff: null } });
    const second = await checkout(free.cookie);
    expect(second.status).toBe(200);
    expect(second.body!.plan).toBe('PRO');
    expect(await paymentCount('free-biz')).toBe(1);
    const row = (await pg.query(`SELECT * FROM "Payment"`)).rows[0];
    expect(row).toMatchObject({ purpose: 'PLAN', status: 'PAID', provider: 'fake', currency: 'USD' });
    expect(Number(row.amount)).toBe(20);
    expect(fakePaymentProvider.calls).toHaveLength(1);
    expect(fakePaymentProvider.calls[0]).toMatchObject({ purpose: 'PLAN', amount: 20, currency: 'USD' });
  });

  it('scenario "success" is the same as no scenario; "declined" is a 409 that changes nothing', async () => {
    const declined = await checkout(free.cookie, undefined, { plan: 'PRO', scenario: 'declined' });
    expect(declined.status).toBe(409);
    expect(declined.body!.error.code).toBe('PAYMENT_DECLINED');
    expect(JSON.stringify(declined.body)).not.toMatch(/\d{12,}/);
    expect(await planOf('free-biz')).toBe('FREE');
    expect(await paymentCount('free-biz')).toBe(0);
    expect(fakePaymentProvider.calls).toHaveLength(0);

    const ok = await checkout(free.cookie, undefined, { plan: 'PRO', scenario: 'success' });
    expect(ok.status).toBe(200);
    expect(ok.body!.plan).toBe('PRO');
    expect(await paymentCount('free-biz')).toBe(1);
    // A second success while already Pro is a no-op: never a second charge.
    const again = await checkout(free.cookie, undefined, { plan: 'PRO', scenario: 'success' });
    expect(again.status).toBe(200);
    expect(await paymentCount('free-biz')).toBe(1);
    expect(fakePaymentProvider.calls).toHaveLength(1);
  });

  it('400 for an unknown scenario or card-like fields; nothing is stored', async () => {
    for (const body of [
      { plan: 'PRO', scenario: 'maybe' },
      { plan: 'PRO', scenario: 'success', card: '4242424242424242' },
      { plan: 'PRO', scenario: 'success', cvc: '123', expiry: '12/30' },
    ]) {
      const res = await checkout(free.cookie, undefined, body);
      expect(res.status).toBe(400);
    }
    expect(await paymentCount('free-biz')).toBe(0);
  });

  it('concurrent calls with the same Idempotency-Key still record one Payment', async () => {
    const results = await Promise.all([
      checkout(free.cookie, 'key-12345678'),
      checkout(free.cookie, 'key-12345678'),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await paymentCount('free-biz')).toBe(1);
    expect(await planOf('free-biz')).toBe('PRO');
  });

  it('a replayed key while still Pro returns the original result without a new Payment', async () => {
    await checkout(free.cookie, 'key-abcdefgh');
    const replay = await checkout(free.cookie, 'key-abcdefgh');
    expect(replay.body!.plan).toBe('PRO');
    expect(await paymentCount('free-biz')).toBe(1);
  });

  it('a key reused after a downgrade is a fresh checkout (new Payment, back on Pro)', async () => {
    await checkout(free.cookie, 'key-abcdefgh');
    expect((await downgrade(free.cookie)).status).toBe(200);
    const again = await checkout(free.cookie, 'key-abcdefgh');
    expect(again.status).toBe(200);
    expect(again.body!.plan).toBe('PRO');
    expect(await paymentCount('free-biz')).toBe(2);
    expect(await planOf('free-biz')).toBe('PRO');
  });

  it('checkout racing downgrade ends consistent with the Payments recorded', async () => {
    await checkout(free.cookie, 'key-first-0001');
    const [, down] = await Promise.all([
      checkout(free.cookie, 'key-second-002'),
      downgrade(free.cookie),
    ]);
    expect(down.status).toBe(200);
    const plan = await planOf('free-biz');
    const payments = await paymentCount('free-biz');
    // Downgrade last: Pro bought once. Checkout last: Pro bought a second time. Never more.
    if (plan === 'FREE') expect(payments).toBe(1);
    else expect(payments).toBe(2);
  });

  it('does not touch another business (tenant scope)', async () => {
    await checkout(free.cookie);
    expect(await planOf('other-biz')).toBe('FREE');
    expect(await paymentCount('other-biz')).toBe(0);
  });

  it('400 for a wrong plan, an unknown field, or a bad key; 401 without a session', async () => {
    for (const body of [{ plan: 'FREE' }, { plan: 'PRO', cardNumber: '4242' }, {}]) {
      const res = await checkout(free.cookie, undefined, body);
      expect(res.status).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
    expect((await checkout(free.cookie, 'bad key!')).status).toBe(400);
    expect(
      (await call(postCheckout, '/api/billing/checkout', { body: { plan: 'PRO' } })).status,
    ).toBe(401);
    expect(await paymentCount('free-biz')).toBe(0);
  });
});

describe('POST /api/billing/downgrade', () => {
  it('is blocked with the numbers while more bookable staff are active than Free allows', async () => {
    await checkout(free.cookie);
    expect((await staff(free.cookie, { displayName: 'Second' })).status).toBe(201);
    const res = await downgrade(free.cookie);
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('PLAN_LIMIT');
    expect(res.body!.error.data).toEqual({ limit: 1, current: 2 });
    expect(await planOf('free-biz')).toBe('PRO');
  });

  it('is allowed once usage fits, and never hides staff', async () => {
    await checkout(free.cookie);
    const second = await staff(free.cookie, { displayName: 'Second' });
    expect((await patch(free.cookie, second.body!.id, { bookable: false })).status).toBe(200);
    const res = await downgrade(free.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: 'FREE', usage: { bookableStaff: 1 } });
    const n = (await pg.query(`SELECT count(*)::int AS n FROM "StaffMember"`)).rows[0].n;
    expect(n).toBe(3); // both tenants' owners + the second member: nothing deleted
  });

  it('is a no-op on a business that is already Free', async () => {
    expect((await downgrade(free.cookie)).status).toBe(200);
  });

  it('400 for a wrong plan or unknown field', async () => {
    for (const body of [{ plan: 'PRO' }, { plan: 'FREE', x: 1 }, {}]) {
      const res = await downgrade(free.cookie, body);
      expect(res.status).toBe(400);
      expect(res.body!.error.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('Free plan limit on staff', () => {
  it('blocks a second bookable member on create with PLAN_LIMIT and the numbers', async () => {
    const res = await staff(free.cookie, { displayName: 'Second' });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('PLAN_LIMIT');
    expect(res.body!.error.data).toEqual({ limit: 1, current: 1 });
  });

  it('two concurrent bookable creates on Free: exactly one 201 and one 409 PLAN_LIMIT', async () => {
    const solo = await signup({ plan: 'FREE', slug: 'solo-biz' });
    await pg.query(
      `UPDATE "StaffMember" SET bookable = false WHERE "businessId" = (SELECT id FROM "Business" WHERE slug = 'solo-biz')`,
    );
    const results = await Promise.all([
      staff(solo.cookie, { displayName: 'A' }),
      staff(solo.cookie, { displayName: 'B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body!.error.code).toBe('PLAN_LIMIT');
  });

  it('still allows non-bookable staff on Free', async () => {
    expect((await staff(free.cookie, { displayName: 'Desk', bookable: false })).status).toBe(201);
  });

  it('blocks enabling bookable on an existing non-bookable member', async () => {
    const desk = await staff(free.cookie, { displayName: 'Desk', bookable: false });
    const res = await patch(free.cookie, desk.body!.id, { bookable: true });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('PLAN_LIMIT');
  });

  it('blocks reactivating a bookable member when another is active', async () => {
    await checkout(free.cookie);
    const second = await staff(free.cookie, { displayName: 'Second' });
    expect((await patch(free.cookie, second.body!.id, { active: false })).status).toBe(200);
    // Back to Free with one bookable left, then try to reactivate the second.
    expect((await downgrade(free.cookie)).status).toBe(200);
    const res = await patch(free.cookie, second.body!.id, { active: true });
    expect(res.status).toBe(409);
    expect(res.body!.error.code).toBe('PLAN_LIMIT');
  });

  it('grandfathers existing data: editing an already-bookable member is never blocked', async () => {
    await pg.query(
      `INSERT INTO "StaffMember" (id, "businessId", "displayName", bookable, active, "updatedAt")
       SELECT 'legacystaffextra001', id, 'Legacy', true, true, now() FROM "Business" WHERE slug = 'free-biz'`,
    );
    const res = await patch(free.cookie, 'legacystaffextra001', { displayName: 'Legacy renamed' });
    expect(res.status).toBe(200);
    // Deactivating is always allowed; so is renaming the owner.
    expect((await patch(free.cookie, 'legacystaffextra001', { active: false })).status).toBe(200);
  });

  it('PRO has no limit', async () => {
    await checkout(free.cookie);
    expect((await staff(free.cookie, { displayName: 'B' })).status).toBe(201);
    expect((await staff(free.cookie, { displayName: 'C' })).status).toBe(201);
  });

  it('cross-tenant staff id is 404', async () => {
    const theirs = await staff(other.cookie, { displayName: 'Desk', bookable: false });
    const res = await patch(free.cookie, theirs.body!.id, { bookable: true });
    expect(res.status).toBe(404);
  });
});
