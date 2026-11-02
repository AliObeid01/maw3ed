import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from '../../src/server/repositories/db';
import { testConnectionString } from './helpers/db';

/**
 * PROOF for the F16 migration (Appointment.contactEmail) on a POPULATED database. A private schema gets
 * every migration before it, is filled with appointments in several statuses (some with a client email,
 * some without) and reminder jobs, then the migration is applied. Afterwards: every row is identical, the
 * new column is NULL everywhere (no backfill), appointment_no_overlap and the ReminderJob unique key are
 * intact, and the rows still book, overlap-fail and de-duplicate exactly as before.
 */
const SCHEMA = 'itest_contactmig';
const DIR = path.resolve(import.meta.dirname, '../../prisma/migrations');
const MIGRATION = '20261102090000_appointment_contact_email';

let client: Client;
const sql = (name: string) => readFileSync(path.join(DIR, name, 'migration.sql'), 'utf8');
const exec = (text: string, params?: unknown[]) => client.query(text, params);

const insertAppointment = (id: string, status: string, start: string, end: string, clientId = 'c1') =>
  exec(
    `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
     VALUES ($1, 'b1', $5, 'st1', 'sv1', $2, $3, $3, $4::"AppointmentStatus", now())`,
    [id, start, end, status, clientId],
  );

const snapshot = async () =>
  (
    await exec(
      `SELECT to_jsonb(a) - 'contactEmail' - 'contactName' AS a FROM "Appointment" a ORDER BY id`,
    )
  ).rows.map((r) => r.a);
const jobs = async () => (await exec(`SELECT * FROM "ReminderJob" ORDER BY id`)).rows;
const clients = async () => (await exec(`SELECT * FROM "Client" ORDER BY id`)).rows;

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
  expect(all[all.length - 1]).toBe(MIGRATION); // it is the latest migration
  for (const dir of all.filter((d) => d < MIGRATION)) await exec(sql(dir));

  // Production-like rows, written BEFORE the migration.
  await exec(
    `INSERT INTO "Business" (id, slug, name, "updatedAt") VALUES ('b1', 'mig-proof', 'Mig Proof', now())`,
  );
  await exec(
    `INSERT INTO "StaffMember" (id, "businessId", "displayName", "updatedAt") VALUES ('st1', 'b1', 'S1', now())`,
  );
  await exec(
    `INSERT INTO "Service" (id, "businessId", name, "durationMin", "updatedAt") VALUES ('sv1', 'b1', 'Cut', 30, now())`,
  );
  await exec(
    `INSERT INTO "Client" (id, "businessId", name, phone, email, "updatedAt") VALUES
       ('c1', 'b1', 'Rana', '+96171000001', 'rana.old@gmail.test', now()),
       ('c2', 'b1', 'No Mail', '+96171000002', NULL, now())`,
  );
  await insertAppointment('a-booked', 'BOOKED', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z');
  await insertAppointment('a-conf', 'CONFIRMED', '2026-12-01T11:00:00Z', '2026-12-01T11:30:00Z', 'c2');
  await insertAppointment('a-cancel', 'CANCELLED', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z');
  await insertAppointment('a-done', 'ATTENDED', '2026-11-01T09:00:00Z', '2026-11-01T09:30:00Z');
  await exec(
    `INSERT INTO "ReminderJob" (id, "businessId", "appointmentId", kind, channel, "dueAt", status) VALUES
       ('j1', 'b1', 'a-booked', 'BOOKING', 'EMAIL', now(), 'PENDING'),
       ('j2', 'b1', 'a-booked', 'H24', 'EMAIL', now(), 'PENDING'),
       ('j3', 'b1', 'a-booked', 'H24', 'WHATSAPP', now(), 'PENDING'),
       ('j4', 'b1', 'a-conf', 'H2', 'EMAIL', now(), 'SENT')`,
  );
});

afterAll(async () => {
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

const uniqueDef = async () =>
  (
    await exec(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'ReminderJob_appointmentId_kind_channel_key'`,
    )
  ).rows[0]?.indexdef as string | undefined;
const constraintDef = async () =>
  (
    await exec(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'appointment_no_overlap' AND connamespace = '${SCHEMA}'::regnamespace`,
    )
  ).rows[0]?.def as string | undefined;

describe('F16 contactEmail migration on a populated database', () => {
  let before: { appointments: unknown[]; jobs: unknown[]; clients: unknown[]; constraint?: string; unique?: string };

  it('before: no contactEmail column', async () => {
    const cols = await exec(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'Appointment' AND column_name IN ('contactEmail', 'contactName')`,
      [SCHEMA],
    );
    expect(cols.rowCount).toBe(0);
    before = {
      appointments: await snapshot(),
      jobs: await jobs(),
      clients: await clients(),
      constraint: await constraintDef(),
      unique: await uniqueDef(),
    };
    expect(before.appointments).toHaveLength(4);
  });

  it('applies to existing rows without changing one of them, and without a backfill', async () => {
    await exec(sql(MIGRATION));
    expect(await snapshot()).toEqual(before.appointments);
    expect(await jobs()).toEqual(before.jobs);
    expect(await clients()).toEqual(before.clients);
    expect((await exec(`SELECT count(*)::int AS n FROM "Appointment"`)).rows[0].n).toBe(4);
    // Nullable, no default, NULL everywhere: old appointments fall back to Client.email.
    const col = (
      await exec(
        `SELECT is_nullable, column_default, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'Appointment' AND column_name = 'contactEmail'`,
        [SCHEMA],
      )
    ).rows[0];
    expect(col).toEqual({ is_nullable: 'YES', column_default: null, data_type: 'text' });
    expect((await exec(`SELECT 1 FROM "Appointment" WHERE "contactEmail" IS NOT NULL`)).rowCount).toBe(0);
    const nameCol = (
      await exec(
        `SELECT is_nullable, column_default, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'Appointment' AND column_name = 'contactName'`,
        [SCHEMA],
      )
    ).rows[0];
    expect(nameCol).toEqual({ is_nullable: 'YES', column_default: null, data_type: 'text' });
    expect((await exec(`SELECT 1 FROM "Appointment" WHERE "contactName" IS NOT NULL`)).rowCount).toBe(0);
  });

  it('appointment_no_overlap is byte-for-byte the same and still rejects an overlap (23P01)', async () => {
    expect(await constraintDef()).toBe(before.constraint);
    await expect(
      insertAppointment('x1', 'BOOKED', '2026-12-01T10:10:00Z', '2026-12-01T10:20:00Z'),
    ).rejects.toMatchObject({ code: '23P01' });
    // A cancelled row still does not block.
    await insertAppointment('x2', 'CANCELLED', '2026-12-01T10:10:00Z', '2026-12-01T10:20:00Z');
  });

  it('the ReminderJob unique key is the same and still rejects a duplicate (23505)', async () => {
    expect(await uniqueDef()).toBe(before.unique);
    await expect(
      exec(
        `INSERT INTO "ReminderJob" (id, "businessId", "appointmentId", kind, channel, "dueAt") VALUES ('j9', 'b1', 'a-booked', 'BOOKING', 'EMAIL', now())`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('the column works for new rows and can be nulled', async () => {
    await exec(
      `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", "contactEmail", "contactName", "updatedAt")
       VALUES ('n1', 'b1', 'c1', 'st1', 'sv1', '2026-12-05T10:00:00Z', '2026-12-05T10:30:00Z', '2026-12-05T10:30:00Z', 'rana.new@gmail.test', 'Rana', now())`,
    );
    expect(
      (await exec(`SELECT "contactEmail" FROM "Appointment" WHERE id = 'n1'`)).rows[0].contactEmail,
    ).toBe('rana.new@gmail.test');
    await exec(`UPDATE "Appointment" SET "contactEmail" = NULL, "contactName" = NULL WHERE id = 'n1'`);
    expect(
      (await exec(`SELECT 1 FROM "Appointment" WHERE "contactEmail" IS NOT NULL OR "contactName" IS NOT NULL`))
        .rowCount,
    ).toBe(0);
  });
});
