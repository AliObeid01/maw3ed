import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from '../../src/server/repositories/db';
import { testConnectionString } from './helpers/db';

/**
 * PROOF for the logo migration on a POPULATED database: every earlier migration is applied in a private schema,
 * it is filled with a business, a client and appointments, then ONLY the logo migration runs. Rows are intact, the
 * guarantees survive, the new table cascades, and the new index exists.
 */
const SCHEMA = 'itest_logomig';
const NEW = '20261109090000_business_logo';
const DIR = path.resolve(import.meta.dirname, '../../prisma/migrations');

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
  expect(all).toContain(NEW);
  for (const dir of all.filter((d) => d < NEW)) await exec(sql(dir));
  await exec(
    `INSERT INTO "Business" (id, slug, name, "updatedAt") VALUES ('b1', 'mig-logo', 'Mig Logo', now())`,
  );
  await exec(
    `INSERT INTO "StaffMember" (id, "businessId", "displayName", "updatedAt") VALUES ('st1', 'b1', 'S1', now())`,
  );
  await exec(
    `INSERT INTO "Service" (id, "businessId", name, "durationMin", "updatedAt") VALUES ('sv1', 'b1', 'Cut', 30, now())`,
  );
  await exec(
    `INSERT INTO "Client" (id, "businessId", name, phone, "updatedAt") VALUES ('c1', 'b1', 'C', '+96171000001', now())`,
  );
  await exec(
    `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
     VALUES ('a1', 'b1', 'c1', 'st1', 'sv1', '2026-12-01T09:00:00Z', '2026-12-01T09:30:00Z', '2026-12-01T09:30:00Z', 'BOOKED', now())`,
  );
  await exec(sql(NEW));
});

afterAll(async () => {
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe('business logo migration on existing rows', () => {
  it('leaves existing rows untouched and creates an empty table', async () => {
    expect((await exec(`SELECT count(*)::int AS n FROM "Business"`)).rows[0].n).toBe(1);
    expect((await exec(`SELECT count(*)::int AS n FROM "Appointment"`)).rows[0].n).toBe(1);
    expect((await exec(`SELECT count(*)::int AS n FROM "BusinessLogo"`)).rows[0].n).toBe(0);
  });

  it('keeps the three guarantees: the overlap is still rejected, the reminder key is still unique', async () => {
    await expect(
      exec(
        `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
         VALUES ('a2', 'b1', 'c1', 'st1', 'sv1', '2026-12-01T09:15:00Z', '2026-12-01T09:45:00Z', '2026-12-01T09:45:00Z', 'BOOKED', now())`,
      ),
    ).rejects.toMatchObject({ code: '23P01' });
    const idx = await exec(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'ReminderJob_appointmentId_kind_channel_key'`,
      [SCHEMA],
    );
    expect(idx.rowCount).toBe(1);
  });

  it('has the new index, the foreign key cascades, and a business may hold one logo only', async () => {
    const idx = await exec(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'Appointment_businessId_createdAt_idx'`,
      [SCHEMA],
    );
    expect(idx.rows[0].indexdef).toMatch(/\("businessId", "createdAt"\)/);
    await exec(
      `INSERT INTO "BusinessLogo" ("businessId", mime, bytes, width, height, hash, "updatedAt") VALUES ('b1','image/webp','\\x00',256,256,'h', now())`,
    );
    await expect(
      exec(
        `INSERT INTO "BusinessLogo" ("businessId", mime, bytes, width, height, hash, "updatedAt") VALUES ('b1','image/webp','\\x00',256,256,'h', now())`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      exec(
        `INSERT INTO "BusinessLogo" ("businessId", mime, bytes, width, height, hash, "updatedAt") VALUES ('nope','image/webp','\\x00',256,256,'h', now())`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
    // Cascade: removing the business removes its logo (other tables reference it without cascade, so use a bare business).
    await exec(
      `INSERT INTO "Business" (id, slug, name, "updatedAt") VALUES ('b2', 'mig-logo-2', 'Two', now())`,
    );
    await exec(
      `INSERT INTO "BusinessLogo" ("businessId", mime, bytes, width, height, hash, "updatedAt") VALUES ('b2','image/webp','\\x00',256,256,'h2', now())`,
    );
    await exec(`DELETE FROM "Business" WHERE id = 'b2'`);
    expect((await exec(`SELECT 1 FROM "BusinessLogo" WHERE "businessId" = 'b2'`)).rowCount).toBe(0);
  });
});
