import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from '../../src/server/repositories/db';
import { testConnectionString } from './helpers/db';

/**
 * PROOF for the e-mail verification migration on a POPULATED database. A private schema gets every migration
 * before it, is filled with users (some with sessions and memberships), then the migration is applied.
 * Afterwards: every pre-existing user is verified (at their createdAt), rows are untouched, the token table
 * exists with its unique and cleanup indexes, and re-running the backfill changes nothing.
 */
const SCHEMA = 'itest_emailmig';
const DIR = path.resolve(import.meta.dirname, '../../prisma/migrations');
const MIGRATION = '20261031120000_email_verification';

let client: Client;
const sql = (name: string) => readFileSync(path.join(DIR, name, 'migration.sql'), 'utf8');
const exec = (text: string, params?: unknown[]) => client.query(text, params);

beforeAll(async () => {
  client = new Client(poolConfigFromUrl(testConnectionString()));
  await client.connect();
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await exec(`CREATE SCHEMA ${SCHEMA}`);
  await exec(`SET search_path TO ${SCHEMA}`);

  const all = readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  expect(all).toContain(MIGRATION);
  for (const dir of all.filter((d) => d < MIGRATION)) await exec(sql(dir));

  // Production-like rows, written BEFORE the migration (no emailVerifiedAt column exists yet).
  await exec(
    `INSERT INTO "Business" (id, slug, name, "updatedAt") VALUES ('b1', 'mig-proof', 'Mig Proof', now())`,
  );
  await exec(
    `INSERT INTO "User" (id, email, "passwordHash", name, "createdAt", "updatedAt") VALUES
       ('u-owner', 'owner@mig.test', 'hash', 'Owner', '2026-10-01T08:00:00Z', now()),
       ('u-staff', 'staff@mig.test', 'hash', 'Staff', '2026-10-15T09:30:00Z', now()),
       ('u-nopw', 'seed@mig.test', NULL, 'Seeded', '2026-09-01T00:00:00Z', now())`,
  );
  await exec(
    `INSERT INTO "Membership" (id, "businessId", "userId", role) VALUES
       ('m1', 'b1', 'u-owner', 'OWNER'), ('m2', 'b1', 'u-staff', 'STAFF')`,
  );
  await exec(
    `INSERT INTO "Session" (id, "businessId", "userId", "tokenHash", "expiresAt")
     VALUES ('s1', 'b1', 'u-owner', 'th-1', now() + interval '1 day')`,
  );
});

afterAll(async () => {
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe('email verification migration on a populated database', () => {
  it('before: users have no emailVerifiedAt column and there is no token table', async () => {
    const cols = await exec(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'User' AND column_name = 'emailVerifiedAt'`,
      [SCHEMA],
    );
    expect(cols.rowCount).toBe(0);
    const table = await exec(`SELECT to_regclass('"EmailToken"') AS t`);
    expect(table.rows[0].t).toBeNull();
  });

  it('applies to existing rows and auto-verifies every pre-existing user at their createdAt', async () => {
    const before = (await exec(`SELECT id, email, "passwordHash", name FROM "User" ORDER BY id`)).rows;
    await exec(sql(MIGRATION));
    const after = (
      await exec(`SELECT id, email, "passwordHash", name, "createdAt", "emailVerifiedAt" FROM "User" ORDER BY id`)
    ).rows;

    expect(after).toHaveLength(3);
    expect(after.map(({ id, email, passwordHash, name }) => ({ id, email, passwordHash, name }))).toEqual(
      before,
    );
    for (const row of after) {
      expect(row.emailVerifiedAt).not.toBeNull();
      expect((row.emailVerifiedAt as Date).toISOString()).toBe((row.createdAt as Date).toISOString());
    }
    // Nothing else moved.
    expect((await exec(`SELECT 1 FROM "Membership"`)).rowCount).toBe(2);
    expect((await exec(`SELECT 1 FROM "Session"`)).rowCount).toBe(1);
  });

  it('a user created AFTER the migration starts unverified', async () => {
    await exec(
      `INSERT INTO "User" (id, email, name, "updatedAt") VALUES ('u-new', 'new@mig.test', 'New', now())`,
    );
    const row = (await exec(`SELECT "emailVerifiedAt" FROM "User" WHERE id = 'u-new'`)).rows[0];
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('the backfill only touches NULL rows (idempotent)', async () => {
    await exec(`UPDATE "User" SET "emailVerifiedAt" = '2026-10-20T00:00:00Z' WHERE id = 'u-staff'`);
    await exec(
      `UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL AND id <> 'u-new'`,
    );
    const staff = (await exec(`SELECT "emailVerifiedAt" FROM "User" WHERE id = 'u-staff'`)).rows[0];
    expect((staff.emailVerifiedAt as Date).toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('EmailToken has a unique tokenHash, cascades with its user, and has the lookup/cleanup indexes', async () => {
    await exec(
      `INSERT INTO "EmailToken" (id, "userId", kind, "tokenHash", "expiresAt")
       VALUES ('t1', 'u-new', 'VERIFY', 'hash-1', now() + interval '1 day')`,
    );
    await expect(
      exec(
        `INSERT INTO "EmailToken" (id, "userId", kind, "tokenHash", "expiresAt")
         VALUES ('t2', 'u-new', 'RESET', 'hash-1', now() + interval '1 hour')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const idx = (
      await exec(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'EmailToken'`, [
        SCHEMA,
      ])
    ).rows.map((r) => r.indexname as string);
    expect(idx).toEqual(
      expect.arrayContaining([
        'EmailToken_tokenHash_key',
        'EmailToken_userId_kind_idx',
        'EmailToken_expiresAt_idx',
      ]),
    );
    await exec(`DELETE FROM "User" WHERE id = 'u-new'`);
    expect((await exec(`SELECT 1 FROM "EmailToken"`)).rowCount).toBe(0);
  });

  it('the guarantees are untouched: overlap constraint and ReminderJob unique key still exist', async () => {
    const c = await exec(
      `SELECT 1 FROM pg_constraint WHERE conname = 'appointment_no_overlap' AND connamespace = '${SCHEMA}'::regnamespace`,
    );
    expect(c.rowCount).toBe(1);
    const idx = await exec(
      `SELECT 1 FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'ReminderJob_appointmentId_kind_channel_key'`,
    );
    expect(idx.rowCount).toBe(1);
  });
});
