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
        'reference', // PR-6: 6-character booking code (A-Z, 2-9); a label, not free text
        'contactEmail', // F16: the email typed for THIS booking (NFR-04 allows email); nulled on anonymisation
        'contactName', // F16 review: the name typed for THIS booking (the only name a public mail may greet with); nulled on anonymisation
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

  it('User holds only name, email, phone, password hash, verification time and bookkeeping', async () => {
    expect(await columns('User')).toEqual(
      [
        'id',
        'email',
        'phone', // E.164 staff login (PR-4)
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

  it('BusinessLogo holds only the processed image, its size, a hash and a timestamp (no personal data)', async () => {
    expect(await columns('BusinessLogo')).toEqual(
      ['businessId', 'mime', 'bytes', 'width', 'height', 'hash', 'updatedAt'].sort(),
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
