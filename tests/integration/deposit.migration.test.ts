import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from '../../src/server/repositories/db';
import { testConnectionString } from './helpers/db';

/**
 * PROOF for the deposit migrations on a POPULATED database. A private schema gets every migration up to the
 * one before the deposit pair, is filled with confirmed, cancelled and overlapping-cancelled appointments,
 * then the two deposit migrations are applied. Afterwards: rows intact, overlap still rejected,
 * PENDING_PAYMENT now blocks, and the cancelled rows still do not.
 */
const SCHEMA = 'itest_depmig';
const DIR = path.resolve(import.meta.dirname, '../../prisma/migrations');
const FIRST = '20261031090000_deposit_columns';
const SECOND = '20261031090100_deposit_overlap_constraint';

let client: Client;
const sql = (name: string) => readFileSync(path.join(DIR, name, 'migration.sql'), 'utf8');

async function exec(text: string, params?: unknown[]) {
  return client.query(text, params);
}

async function insertAppointment(
  id: string,
  status: string,
  start: string,
  end: string,
  staff = 'st1',
) {
  await exec(
    `INSERT INTO "Appointment" (id, "businessId", "clientId", "staffId", "serviceId", "startAt", "endAt", "blockedUntil", status, "updatedAt")
     VALUES ($1, 'b1', 'c1', $2, 'sv1', $3, $4, $4, $5::"AppointmentStatus", now())`,
    [id, staff, start, end, status],
  );
}

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
  expect(all).toContain(FIRST);
  expect(all).toContain(SECOND);
  for (const dir of all.filter((d) => d < FIRST)) await exec(sql(dir));

  // Production-like rows, written BEFORE the deposit migrations.
  await exec(
    `INSERT INTO "Business" (id, slug, name, "updatedAt") VALUES ('b1', 'mig-proof', 'Mig Proof', now())`,
  );
  await exec(
    `INSERT INTO "StaffMember" (id, "businessId", "displayName", "updatedAt") VALUES ('st1', 'b1', 'S1', now()), ('st2', 'b1', 'S2', now())`,
  );
  await exec(
    `INSERT INTO "Service" (id, "businessId", name, "durationMin", "updatedAt") VALUES ('sv1', 'b1', 'Cut', 30, now())`,
  );
  await exec(
    `INSERT INTO "Client" (id, "businessId", name, phone, "updatedAt") VALUES ('c1', 'b1', 'C', '+96171000001', now())`,
  );
  await insertAppointment('a-conf', 'CONFIRMED', '2026-12-01T09:00:00Z', '2026-12-01T09:30:00Z');
  await insertAppointment('a-booked', 'BOOKED', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z');
  await insertAppointment('a-cancel', 'CANCELLED', '2026-12-01T09:00:00Z', '2026-12-01T09:30:00Z');
  await insertAppointment('a-cancel2', 'CANCELLED', '2026-12-01T09:15:00Z', '2026-12-01T09:45:00Z');
  await insertAppointment('a-done', 'ATTENDED', '2026-11-01T09:00:00Z', '2026-11-01T09:30:00Z');
});

afterAll(async () => {
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

const constraintDef = async () =>
  (
    await exec(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'appointment_no_overlap' AND connamespace = '${SCHEMA}'::regnamespace`,
    )
  ).rows[0]?.def as string | undefined;

describe('deposit migrations on a populated database', () => {
  it('before: the constraint covers BOOKED and CONFIRMED only', async () => {
    const def = await constraintDef();
    expect(def).toContain('BOOKED');
    expect(def).not.toContain('PENDING_PAYMENT');
  });

  it('applies both migrations to existing rows without touching them', async () => {
    const before = (await exec(`SELECT id, status, "startAt", "blockedUntil" FROM "Appointment" ORDER BY id`)).rows;
    await exec(sql(FIRST));
    await exec(sql(SECOND));
    const after = (
      await exec(`SELECT id, status, "startAt", "blockedUntil" FROM "Appointment" ORDER BY id`)
    ).rows;
    expect(after).toEqual(before);
    expect(after).toHaveLength(5);

    const cols = await exec(
      `SELECT "holdExpiresAt" FROM "Appointment" WHERE "holdExpiresAt" IS NOT NULL`,
    );
    expect(cols.rowCount).toBe(0);
    const biz = await exec(`SELECT "depositEnabled", "depositThreshold", "depositAmount" FROM "Business"`);
    expect(biz.rows[0]).toMatchObject({ depositEnabled: false, depositThreshold: 1 });
    expect(Number(biz.rows[0].depositAmount)).toBe(5);
  });

  it('after: same definition plus PENDING_PAYMENT', async () => {
    const def = await constraintDef();
    expect(def).toMatch(/EXCLUDE USING gist/);
    expect(def).toContain('PENDING_PAYMENT');
    expect(def).toContain('BOOKED');
    expect(def).toContain('CONFIRMED');
    expect(def).toContain("tstzrange(\"startAt\", \"blockedUntil\", '[)'::text)");
  });

  it('still rejects an overlap of live bookings (23P01)', async () => {
    await expect(
      insertAppointment('x1', 'BOOKED', '2026-12-01T09:10:00Z', '2026-12-01T09:20:00Z'),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('a PENDING_PAYMENT hold now blocks the slot, and blocks others', async () => {
    await insertAppointment('p1', 'PENDING_PAYMENT', '2026-12-02T09:00:00Z', '2026-12-02T09:30:00Z');
    await expect(
      insertAppointment('p2', 'BOOKED', '2026-12-02T09:10:00Z', '2026-12-02T09:20:00Z'),
    ).rejects.toMatchObject({ code: '23P01' });
    await expect(
      insertAppointment('p3', 'PENDING_PAYMENT', '2026-12-02T09:10:00Z', '2026-12-02T09:20:00Z'),
    ).rejects.toMatchObject({ code: '23P01' });
    // another staff member is unaffected
    await insertAppointment('p4', 'BOOKED', '2026-12-02T09:10:00Z', '2026-12-02T09:20:00Z', 'st2');
  });

  it('cancelled rows still do not block, and a pending hold can be released by cancelling', async () => {
    await insertAppointment('c9', 'CANCELLED', '2026-12-01T09:10:00Z', '2026-12-01T09:20:00Z');
    await exec(`UPDATE "Appointment" SET status = 'CANCELLED' WHERE id = 'p1'`);
    await insertAppointment('p5', 'BOOKED', '2026-12-02T09:00:00Z', '2026-12-02T09:30:00Z');
  });

  it('paying (PENDING_PAYMENT -> CONFIRMED) stays inside the constraint', async () => {
    await insertAppointment('p6', 'PENDING_PAYMENT', '2026-12-03T09:00:00Z', '2026-12-03T09:30:00Z');
    await exec(`UPDATE "Appointment" SET status = 'CONFIRMED' WHERE id = 'p6'`);
    await expect(
      insertAppointment('p7', 'BOOKED', '2026-12-03T09:00:00Z', '2026-12-03T09:30:00Z'),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('the ReminderJob unique key is untouched', async () => {
    const idx = await exec(
      `SELECT 1 FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'ReminderJob_appointmentId_kind_channel_key'`,
    );
    expect(idx.rowCount).toBe(1);
  });
});
