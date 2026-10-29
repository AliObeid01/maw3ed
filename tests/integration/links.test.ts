/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getLink, POST as postLink } from '@/app/api/links/[token]/route';
import { expiryFor, signToken, type TokenAction } from '@/server/domain/tokens';
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

let pg: Client;
let prisma: PrismaClient;
let a: Tenant;
let b: Tenant;
let aScn: Awaited<ReturnType<typeof newScenario>>;
let bScn: Awaited<ReturnType<typeof newScenario>>;

const secret = () => process.env.LINK_SECRET!;
const START = new Date(at('07:00'));
/** Default cancel cutoff is 24 h: 3 Nov 07:00Z. */
const BEFORE_CUTOFF = NOW;
const AFTER_CUTOFF = new Date('2026-11-03T08:00:00Z');

const tok = (id: string, act: TokenAction, exp = expiryFor(START)) =>
  signToken({ a: id, act, exp }, secret());
const get = (token: string) => call(getLink, `/api/links/${token}`, { params: { token } });
const act = (token: string, action: string) =>
  call(postLink, `/api/links/${token}`, { params: { token }, body: { action } });

async function book(tenant = a, scn = aScn, time = '07:00') {
  const res = await bookPublicly(
    tenant.slug,
    bookingBody(scn.serviceId, scn.staffIds[0]!, at(time), { email: 'c@example.test' }),
  );
  expect(res.status).toBe(201);
  return res.body!.appointment.id as string;
}
const row = async (id: string) =>
  (await pg.query('SELECT * FROM "Appointment" WHERE id = $1', [id])).rows[0];
const lateCancels = async (id: string) =>
  (
    await pg.query(
      'SELECT c."lateCancels" FROM "Client" c JOIN "Appointment" a ON a."clientId" = c.id WHERE a.id = $1',
      [id],
    )
  ).rows[0].lateCancels as number;

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
  await truncateAll(pg);
  prisma = newPrisma();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  a = await newTenant({ businessName: 'Alpha Salon' });
  b = await newTenant({ businessName: 'Beta Clinic' });
  aScn = await newScenario(prisma, a);
  bScn = await newScenario(prisma, b);
});
afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await pg.end();
});
beforeEach(async () => {
  await pg.query('DELETE FROM "ReminderJob"');
  await pg.query('DELETE FROM "Appointment"');
  await pg.query('DELETE FROM "Client"');
  vi.setSystemTime(NOW);
});

describe('GET /api/links/{token}', () => {
  it('returns the appointment, business and flags, with no side effects', async () => {
    const id = await book();
    const jobsBefore = (await pg.query('SELECT id, status FROM "ReminderJob" ORDER BY id')).rows;
    for (const act of ['view', 'confirm', 'cancel'] as const) {
      const res = await get(tok(id, act));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.body).toMatchObject({
        act,
        appointment: {
          id,
          startAt: START.toISOString(),
          status: 'BOOKED',
          service: { id: aScn.serviceId, name: expect.any(String), durationMin: 30, price: 15 },
          staff: { id: aScn.staffIds[0] },
        },
        business: { name: 'Alpha Salon', slug: a.slug, timezone: 'Asia/Beirut', locale: 'en' },
        canConfirm: true,
        canCancel: true,
        cancelCutoffAt: '2026-11-03T07:00:00.000Z',
        pastCutoff: false,
        confirmedAt: null,
      });
    }
    const after = await row(id);
    expect(after.status).toBe('BOOKED');
    expect(after.confirmedAt).toBeNull();
    expect(after.cancelledAt).toBeNull();
    expect((await pg.query('SELECT id, status FROM "ReminderJob" ORDER BY id')).rows).toEqual(
      jobsBefore,
    );
  });

  it('reports pastCutoff once the free-cancel window has closed', async () => {
    const id = await book();
    vi.setSystemTime(AFTER_CUTOFF);
    expect((await get(tok(id, 'view'))).body).toMatchObject({ pastCutoff: true, canCancel: true });
  });

  it('a token only ever resolves its own appointment, in its own business', async () => {
    const aId = await book(a, aScn);
    const bId = await book(b, bScn);
    const rb = await get(tok(bId, 'view'));
    expect(rb.body!.business.name).toBe('Beta Clinic');
    expect(rb.body!.appointment.id).toBe(bId);
    expect(JSON.stringify(rb.body)).not.toContain(aId);
  });
});

describe('invalid tokens answer 404 and reveal nothing', () => {
  it.each([
    ['garbage', () => 'not-a-token'],
    ['empty-ish', () => 'a.b'],
    ['oversized', () => 'x'.repeat(590)],
  ])('malformed (%s)', async (_n, make) => {
    for (const res of [await get(make()), await act(make(), 'confirm')]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Not found.', fields: {} },
      });
    }
  });

  it('tampered signature, tampered payload, wrong secret', async () => {
    const id = await book();
    const good = tok(id, 'view');
    const [body, sig] = good.split('.') as [string, string];
    const flipped = `${body}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await get(flipped)).status).toBe(404);
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.act = 'view';
    payload.a = 'someoneelse';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    expect((await get(forged)).status).toBe(404);
    const other = signToken({ a: id, act: 'view', exp: expiryFor(START) }, 'x'.repeat(40));
    expect((await get(other)).status).toBe(404);
  });

  it('a validly signed token for an unknown appointment, or a claim token, is 404', async () => {
    expect((await get(tok('doesnotexist', 'view'))).status).toBe(404);
    const offer = signToken({ o: 'offer1', act: 'claim', exp: expiryFor(START) }, secret());
    expect((await get(offer)).status).toBe(404);
  });
});

describe('expiry', () => {
  it('links stop working at the appointment start (410 LINK_EXPIRED)', async () => {
    const id = await book();
    vi.setSystemTime(new Date(START.getTime() - 1000));
    expect((await get(tok(id, 'view'))).status).toBe(200);
    vi.setSystemTime(START);
    for (const res of [await get(tok(id, 'view')), await act(tok(id, 'cancel'), 'cancel')]) {
      expect(res.status).toBe(410);
      expect(res.body!.error.code).toBe('LINK_EXPIRED');
    }
    expect((await row(id)).status).toBe('BOOKED');
  });
});

describe('POST confirm', () => {
  it('confirms BOOKED -> CONFIRMED, stays slot-holding, and repeats are idempotent', async () => {
    const id = await book();
    const res = await act(tok(id, 'confirm'), 'confirm');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      result: 'confirmed',
      appointment: { status: 'CONFIRMED' },
      canConfirm: false,
      confirmedAt: NOW.toISOString(),
    });
    expect((await row(id)).status).toBe('CONFIRMED');

    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const again = await act(tok(id, 'confirm'), 'confirm');
    expect(again.status).toBe(200);
    expect(again.body!.result).toBe('already_confirmed');
    expect(again.body!.confirmedAt).toBe(NOW.toISOString());

    // CONFIRMED still holds the slot (exclusion constraint).
    const dup = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00')),
    );
    expect(dup.status).toBe(409);
    expect(dup.body!.error.code).toBe('SLOT_TAKEN');
  });

  it('a view token may confirm', async () => {
    const id = await book();
    expect((await act(tok(id, 'view'), 'confirm')).body!.result).toBe('confirmed');
  });

  it('cannot confirm a cancelled or outcome-marked appointment (409)', async () => {
    const id = await book();
    await act(tok(id, 'cancel'), 'cancel');
    expect((await act(tok(id, 'confirm'), 'confirm')).status).toBe(409);
    const id2 = await book(a, aScn, '08:00');
    await pg.query(`UPDATE "Appointment" SET status = 'ATTENDED' WHERE id = $1`, [id2]);
    expect((await act(tok(id2, 'confirm'), 'confirm')).status).toBe(409);
    expect((await row(id2)).status).toBe('ATTENDED');
  });
});

describe('POST cancel', () => {
  it('before the cutoff: CANCELLED via LINK, slot bookable again, pending reminders skipped', async () => {
    const id = await book();
    vi.setSystemTime(BEFORE_CUTOFF);
    const res = await act(tok(id, 'cancel'), 'cancel');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      result: 'cancelled',
      appointment: { status: 'CANCELLED' },
      canCancel: false,
    });
    const r = await row(id);
    expect(r.status).toBe('CANCELLED');
    expect(r.cancelledVia).toBe('LINK');
    expect(r.cancelledAt).not.toBeNull();
    expect(await lateCancels(id)).toBe(0);
    const jobs = (await pg.query('SELECT DISTINCT status FROM "ReminderJob"')).rows;
    expect(jobs).toEqual([{ status: 'SKIPPED' }]);

    const rebook = await bookPublicly(
      a.slug,
      bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00')),
    );
    expect(rebook.status).toBe(201);
  });

  it('after the cutoff: LATE_CANCEL and the client’s lateCancels is incremented', async () => {
    const id = await book();
    vi.setSystemTime(AFTER_CUTOFF);
    const res = await act(tok(id, 'cancel'), 'cancel');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      result: 'late_cancelled',
      appointment: { status: 'LATE_CANCEL' },
    });
    expect((await row(id)).status).toBe('LATE_CANCEL');
    expect(await lateCancels(id)).toBe(1);
    expect((await pg.query(`SELECT DISTINCT status FROM "ReminderJob"`)).rows).toEqual([
      { status: 'SKIPPED' },
    ]);
    // The slot is free again.
    expect(
      (await bookPublicly(a.slug, bookingBody(aScn.serviceId, aScn.staffIds[0]!, at('07:00'))))
        .status,
    ).toBe(201);
  });

  it('repeats and concurrent double cancels count once', async () => {
    const id = await book();
    vi.setSystemTime(AFTER_CUTOFF);
    const t = tok(id, 'cancel');
    const results = await Promise.all([act(t, 'cancel'), act(t, 'cancel'), act(t, 'cancel')]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.map((r) => r.body!.result).filter((x) => x === 'late_cancelled')).toHaveLength(
      1,
    );
    expect(
      results.map((r) => r.body!.result).filter((x) => x === 'already_cancelled'),
    ).toHaveLength(2);
    expect(await lateCancels(id)).toBe(1);
    const again = await act(t, 'cancel');
    expect(again.body!.result).toBe('already_cancelled');
    expect(await lateCancels(id)).toBe(1);
  });

  it('a CONFIRMED appointment can still be cancelled; an attended one cannot', async () => {
    const id = await book();
    await act(tok(id, 'confirm'), 'confirm');
    expect((await act(tok(id, 'view'), 'cancel')).body!.result).toBe('cancelled');
    const id2 = await book(a, aScn, '08:00');
    await pg.query(`UPDATE "Appointment" SET status = 'NO_SHOW' WHERE id = $1`, [id2]);
    expect((await act(tok(id2, 'cancel'), 'cancel')).status).toBe(409);
  });

  it('works for a confirmed appointment cancelled by the staff first (idempotent as already_cancelled)', async () => {
    const id = await book();
    await pg.query(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = $1`, [id]);
    expect((await act(tok(id, 'cancel'), 'cancel')).body!.result).toBe('already_cancelled');
  });
});

describe('link action policy', () => {
  it('a confirm token cannot cancel and a cancel token cannot confirm (403)', async () => {
    const id = await book();
    const c1 = await act(tok(id, 'confirm'), 'cancel');
    expect(c1.status).toBe(403);
    expect(c1.body!.error.code).toBe('WRONG_LINK_ACTION');
    const c2 = await act(tok(id, 'cancel'), 'confirm');
    expect(c2.status).toBe(403);
    expect(c2.body!.error.code).toBe('WRONG_LINK_ACTION');
    const r = await row(id);
    expect(r.status).toBe('BOOKED');
  });
});

describe('validation', () => {
  it('bad action, missing body and unknown fields -> 400; non-JSON -> 415', async () => {
    const id = await book();
    const t = tok(id, 'view');
    const bad = await act(t, 'delete');
    expect(bad.status).toBe(400);
    expect(bad.body!.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body!.error.fields).toHaveProperty('action');
    const unknown = await call(postLink, `/api/links/${t}`, {
      params: { token: t },
      body: { action: 'confirm', businessId: b.businessId },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body!.error.fields).toHaveProperty('businessId');
    const missing = await call(postLink, `/api/links/${t}`, {
      params: { token: t },
      body: {},
    });
    expect(missing.status).toBe(400);
    const form = await call(postLink, `/api/links/${t}`, {
      params: { token: t },
      body: { action: 'confirm' },
      headers: { 'content-type': 'text/plain' },
    });
    expect(form.status).toBe(415);
    expect((await row(id)).status).toBe('BOOKED');
  });
});
