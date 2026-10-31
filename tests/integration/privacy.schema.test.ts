import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { newClient, setupSchema, TEST_SCHEMA } from './helpers/db';

/**
 * NFR-04: only name, phone, email, appointment time, service and staff are stored about a client.
 * This checks the REAL migrated database (not the Prisma file): the personal-data tables carry an exact,
 * reviewed column list, so a `notes`/`comment` column added later makes this test fail until a human decides.
 */
let pg: Client;

const columns = async (table: string) =>
  (
    await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [TEST_SCHEMA, table],
    )
  ).rows
    .map((r) => r.column_name)
    .sort();

beforeAll(async () => {
  await setupSchema();
  pg = newClient();
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});

describe('NFR-04 privacy: no free-text personal data', () => {
  it('Client holds only name, phone, email, counters and bookkeeping', async () => {
    expect(await columns('Client')).toEqual(
      [
        'id',
        'businessId',
        'name',
        'phone',
        'email',
        'attended',
        'noShows',
        'lateCancels',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('Appointment holds only time, service, staff, status and bookkeeping (no notes)', async () => {
    expect(await columns('Appointment')).toEqual(
      [
        'id',
        'businessId',
        'clientId',
        'staffId',
        'serviceId',
        'startAt',
        'endAt',
        'blockedUntil',
        'status',
        'source',
        'idempotencyKey',
        'confirmedAt',
        'cancelledAt',
        'cancelledVia',
        'outcomeMarkedById',
        'outcomeMarkedAt',
        'holdExpiresAt', // deposit hold deadline (timestamp)
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('User holds only name, email, password hash, verification time and bookkeeping', async () => {
    expect(await columns('User')).toEqual(
      [
        'id',
        'email',
        'passwordHash',
        'name',
        'emailVerifiedAt', // when the address was proven (timestamp only)
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('EmailToken holds only a token hash, its kind and timestamps', async () => {
    expect(await columns('EmailToken')).toEqual(
      ['id', 'userId', 'kind', 'tokenHash', 'expiresAt', 'usedAt', 'createdAt'].sort(),
    );
  });

  it('no table anywhere has a notes/comment/memo/remarks column', async () => {
    const { rows } = await pg.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 AND column_name ~* '(note|comment|memo|remark|message_body|free_?text)'`,
      [TEST_SCHEMA],
    );
    expect(rows).toEqual([]);
  });
});
