/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON bodies */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { GET as getLink, POST as postLink } from '@/app/api/links/[token]/route';
import { GET as getOutcome } from '@/app/api/links/[token]/outcome/route';
import { expiryFor, OUTCOME_GRACE_SEC, signToken, type TokenAction } from '@/server/domain/tokens';
import { makeBusiness } from './helpers/directory';
import { newClient, setupSchema, truncateAll } from './helpers/db';
import { countStatements } from './helpers/queryCount';

// PR-10 part I: GET /api/links/{token}/outcome tells a device whether a visit was ATTENDED, and nothing else.
const DAY_MS = 86_400_000;
const START = new Date('2026-10-20T09:00:00Z');
const STATUSES = [
  'ATTENDED',
  'BOOKED',
  'CONFIRMED',
  'CANCELLED',
  'LATE_CANCEL',
  'NO_SHOW',
  'PENDING_PAYMENT',
] as const;
const REQUEST_ID = 'fixed-request-id-1';

let pg: Client;
let ids: Record<(typeof STATUSES)[number], string>;
const secret = () => process.env.LINK_SECRET!;
const tok = (id: string, act: TokenAction = 'view', start = START) =>
  signToken({ a: id, act, exp: expiryFor(start) }, secret());

const outcome = (token: string) =>
  getOutcome(
    new Request(`http://localhost/api/links/${token}/outcome`, {
      headers: { 'x-request-id': REQUEST_ID },
    }),
    { params: Promise.resolve({ token }) },
  );
/** Status, every header, and the raw body text. */
async function raw(token: string) {
  const res = await outcome(token);
  const body = await res.text();
  return { status: res.status, headers: [...res.headers.entries()].sort(), body };
}
const rawLink = async (handler: typeof getLink, token: string, method = 'GET', body?: unknown) => {
  const res = await handler(
    new Request(`http://localhost/api/links/${token}`, {
      method,
      headers: { 'x-request-id': REQUEST_ID, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
  return { status: res.status, headers: [...res.headers.entries()].sort(), body: await res.text() };
};

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
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-25T10:00:00Z') });
  // One business, one appointment per status (distinct hours, so the no-overlap constraint is satisfied).
  const b = await makeBusiness(pg, {
    name: 'Outcome Studio',
    staff: [
      {
        bookings: STATUSES.map((status, i) => ({
          startAt: new Date(START.getTime() + i * 3600_000).toISOString(),
          endAt: new Date(START.getTime() + i * 3600_000 + 1800_000).toISOString(),
          status,
        })),
      },
    ],
  });
  ids = Object.fromEntries(STATUSES.map((s, i) => [s, `${b.staffIds[0]}-ap-${i}`])) as typeof ids;
});
afterEach(() => vi.useRealTimers());

const startOf = (status: (typeof STATUSES)[number]) =>
  new Date(START.getTime() + STATUSES.indexOf(status) * 3600_000);
const tokFor = (status: (typeof STATUSES)[number], act: TokenAction = 'view') =>
  tok(ids[status], act, startOf(status));

describe('GET /api/links/{token}/outcome', () => {
  it('ATTENDED answers exactly {"completed":true}, no-store, 200', async () => {
    const r = await raw(tokFor('ATTENDED'));
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"completed":true}');
    expect(Object.fromEntries(r.headers)['cache-control']).toBe('no-store');
    expect(Object.fromEntries(r.headers)['content-type']).toMatch(/application\/json/);
  });

  it('every other status answers the byte-identical {"completed":false} (body, status, headers)', async () => {
    const others = STATUSES.filter((s) => s !== 'ATTENDED');
    const results = await Promise.all(others.map((s) => raw(tokFor(s))));
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body).toBe('{"completed":false}');
      expect(r).toEqual(results[0]);
    }
    // Also: a valid signature for an appointment that does not exist, and a future (not yet happened) one.
    const ghost = await raw(tok('no-such-appointment'));
    expect(ghost).toEqual(results[0]);
  });

  it('an appointment that has not happened yet (token still in its normal life) answers false', async () => {
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    const r = await raw(tokFor('BOOKED'));
    expect(r.body).toBe('{"completed":false}');
    // Even if the row were already ATTENDED early (a staff correction), nothing about the future is special.
    await pg.query(`UPDATE "Appointment" SET status = 'ATTENDED' WHERE id = $1`, [ids.BOOKED]);
    expect((await raw(tokFor('BOOKED'))).body).toBe('{"completed":true}');
  });

  it('a staff-corrected NO_SHOW -> ATTENDED answers true; an excused no-show (CANCELLED) answers false', async () => {
    expect((await raw(tokFor('NO_SHOW'))).body).toBe('{"completed":false}');
    await pg.query(`UPDATE "Appointment" SET status = 'ATTENDED' WHERE id = $1`, [ids.NO_SHOW]);
    expect((await raw(tokFor('NO_SHOW'))).body).toBe('{"completed":true}');
    await pg.query(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = $1`, [ids.NO_SHOW]);
    expect((await raw(tokFor('NO_SHOW'))).body).toBe('{"completed":false}');
  });

  it('honours the view token until 90 days after the start, then answers the usual 404', async () => {
    const token = tokFor('ATTENDED');
    vi.setSystemTime(new Date(startOf('ATTENDED').getTime() + 89 * DAY_MS));
    expect((await raw(token)).body).toBe('{"completed":true}');
    vi.setSystemTime(new Date(startOf('ATTENDED').getTime() + OUTCOME_GRACE_SEC * 1000 - 1000));
    expect((await raw(token)).body).toBe('{"completed":true}');
    vi.setSystemTime(new Date(startOf('ATTENDED').getTime() + OUTCOME_GRACE_SEC * 1000));
    const gone = await raw(token);
    expect(gone.status).toBe(404);
    expect(JSON.parse(gone.body).error.code).toBe('NOT_FOUND');
  });

  it('invalid signature, wrong act, beyond the grace and garbage all answer the SAME 404', async () => {
    const good = tokFor('ATTENDED');
    const tampered = `${good.slice(0, -3)}${good.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    const other = signToken(
      { a: ids.ATTENDED, act: 'view', exp: expiryFor(START) },
      'a-completely-different-secret-0123456789',
    );
    const offer = signToken(
      { o: 'offer_1', act: 'claim', exp: expiryFor(START) + 999999 },
      secret(),
    );
    const cases = [
      tampered,
      other,
      tokFor('ATTENDED', 'confirm'),
      tokFor('ATTENDED', 'cancel'),
      tok(ids.ATTENDED, 'view', new Date(START.getTime() - 120 * DAY_MS)), // beyond the 90 day grace
      offer,
      'garbage',
      'a.b',
      '.',
      'x'.repeat(300),
      'not-base64!.@@@',
    ];
    const results = await Promise.all(cases.map((c) => raw(c)));
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r).toEqual(results[0]);
    }
    expect(JSON.parse(results[0]!.body).error.code).toBe('NOT_FOUND');
    // ... and it is the very 404 the existing link endpoint gives for a bad token.
    const existing = await rawLink(getLink, 'garbage');
    expect(existing.status).toBe(404);
    expect(results[0]!.body).toBe(existing.body);
  });

  it('a token longer than the path parameter allows is a 400 like the other link routes; unknown query is a 400', async () => {
    const long = await outcome('x'.repeat(601));
    expect(long.status).toBe(400);
    expect((await long.json()).error.code).toBe('VALIDATION_FAILED');
    const token = tokFor('ATTENDED');
    const res = await getOutcome(new Request(`http://localhost/api/links/${token}/outcome?x=1`), {
      params: Promise.resolve({ token }),
    });
    expect(res.status).toBe(400);
  });

  it('returns only {completed}: no PII, ids, times, counters or reference', async () => {
    await pg.query(
      `UPDATE "Client" SET email = 'private.person@example.test' WHERE "businessId" = (SELECT "businessId" FROM "Appointment" WHERE id = $1)`,
      [ids.ATTENDED],
    );
    for (const status of STATUSES) {
      const r = await raw(tokFor(status));
      const parsed = JSON.parse(r.body);
      expect(Object.keys(parsed)).toEqual(['completed']);
      expect(typeof parsed.completed).toBe('boolean');
      expect(r.body).not.toMatch(/@|\+\d|Private|Outcome Studio|biz-|2026|ap-|reference/);
    }
  });

  it('timing parity: attended, every other status and a missing row run the SAME single SQL statement shape', async () => {
    const run = async (token: string) => (await countStatements(() => outcome(token))).statements;
    const attended = await run(tokFor('ATTENDED'));
    expect(attended).toHaveLength(1);
    const kinds = [
      ...STATUSES.filter((s) => s !== 'ATTENDED').map((s) => tokFor(s)),
      tok('no-such-appointment'),
    ];
    for (const token of kinds) {
      const statements = await run(token);
      expect(statements).toHaveLength(attended.length);
      expect(statements).toEqual(attended);
    }
  });

  it('is read-only: the appointment is not touched', async () => {
    const before = await pg.query('SELECT * FROM "Appointment" ORDER BY id');
    await raw(tokFor('ATTENDED'));
    await raw(tokFor('BOOKED'));
    const after = await pg.query('SELECT * FROM "Appointment" ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });
});

describe('the grace does not widen view / confirm / cancel (regression)', () => {
  const afterStart = () =>
    vi.setSystemTime(new Date(START.getTime() + 24 * 3600_000 + 7 * 3600_000));

  it.each(['view', 'confirm', 'cancel'] as const)(
    'GET with an expired %s token is still 410 LINK_EXPIRED, inside the outcome grace',
    async (act) => {
      afterStart();
      const r = await rawLink(getLink, tokFor('ATTENDED', act));
      expect(r.status).toBe(410);
      expect(JSON.parse(r.body).error.code).toBe('LINK_EXPIRED');
    },
  );

  it.each([
    ['view', 'confirm'],
    ['view', 'cancel'],
    ['confirm', 'confirm'],
    ['cancel', 'cancel'],
  ] as const)(
    'POST %s token -> %s after the start is still 410 and changes nothing',
    async (act, action) => {
      afterStart();
      const before = await pg.query('SELECT status FROM "Appointment" ORDER BY id');
      const r = await rawLink(postLink as any, tokFor('BOOKED', act), 'POST', { action });
      expect(r.status).toBe(410);
      expect(JSON.parse(r.body).error.code).toBe('LINK_EXPIRED');
      expect((await pg.query('SELECT status FROM "Appointment" ORDER BY id')).rows).toEqual(
        before.rows,
      );
    },
  );

  it('an outcome call does not make an expired token usable elsewhere (token still expired for GET /links)', async () => {
    afterStart();
    const t = tokFor('ATTENDED');
    expect((await raw(t)).body).toBe('{"completed":true}');
    expect((await rawLink(getLink, t)).status).toBe(410);
  });
});
