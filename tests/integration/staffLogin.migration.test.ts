import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from '../../src/server/repositories/db';
import { testConnectionString } from './helpers/db';

/**
 * PROOF for the staff-login migration on a POPULATED database (fake rows only): a private schema gets every
 * earlier migration and some users, then the migration is applied. Existing rows are untouched, e-mail is
 * optional but one identity is mandatory, phone is unique with many NULLs allowed, one StaffMember per
 * (user, business), one OPEN activation link per staff member, and a duplicate pre-flight fails loudly.
 */
const SCHEMA = 'itest_staffmig';
const DIR = path.resolve(import.meta.dirname, '../../prisma/migrations');
const MIGRATION = '20261107090000_staff_login';

let client: Client;
const sql = (name: string) => readFileSync(path.join(DIR, name, 'migration.sql'), 'utf8');
const exec = (text: string, params?: unknown[]) => client.query(text, params);
const rejects = async (text: string) => {
  await exec('SAVEPOINT s');
  try {
    await exec(text);
  } catch (e) {
    await exec('ROLLBACK TO SAVEPOINT s');
    return (e as Error).message;
  }
  await exec('RELEASE SAVEPOINT s');
  return null;
};

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
  await exec(`INSERT INTO "Business" (id, slug, name, "updatedAt") VALUES ('b1','mig-staff','Mig', now())`);
  await exec(`INSERT INTO "User" (id, email, "passwordHash", name, "updatedAt") VALUES ('u1','owner@mig.test','h','Owner', now())`);
  await exec(`INSERT INTO "Membership" (id, "businessId", "userId", role) VALUES ('m1','b1','u1','OWNER')`);
  await exec(`INSERT INTO "StaffMember" (id, "businessId", "userId", "displayName", "updatedAt") VALUES ('s1','b1','u1','Owner', now()), ('s2','b1',NULL,'Free', now())`);
  await exec('BEGIN');
});

afterAll(async () => {
  await exec('ROLLBACK').catch(() => {});
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe('staff login migration on a populated database', () => {
  it('fails loudly when a duplicate StaffMember(businessId, userId) exists', async () => {
    await exec(`INSERT INTO "StaffMember" (id, "businessId", "userId", "displayName", "updatedAt") VALUES ('dup','b1','u1','Dup', now())`);
    const msg = await rejects(sql(MIGRATION));
    expect(msg).toMatch(/duplicate StaffMember/);
    await exec(`DELETE FROM "StaffMember" WHERE id = 'dup'`);
  });

  it('applies without touching existing rows', async () => {
    await exec(sql(MIGRATION));
    const u = (await exec(`SELECT id, email, phone, name FROM "User"`)).rows;
    expect(u).toEqual([{ id: 'u1', email: 'owner@mig.test', phone: null, name: 'Owner' }]);
    expect((await exec(`SELECT 1 FROM "Membership"`)).rowCount).toBe(1);
    expect((await exec(`SELECT 1 FROM "StaffMember"`)).rowCount).toBe(2);
  });

  it('allows a phone-only user, many NULL phones, but not a user with no identity', async () => {
    await exec(`INSERT INTO "User" (id, phone, name, "updatedAt") VALUES ('p1','+96170000001','Barber', now())`);
    await exec(`INSERT INTO "User" (id, email, name, "updatedAt") VALUES ('e2','two@mig.test','Two', now())`);
    expect(await rejects(`INSERT INTO "User" (id, name, "updatedAt") VALUES ('none','No identity', now())`)).toMatch(/user_has_identity/);
    expect(await rejects(`INSERT INTO "User" (id, phone, name, "updatedAt") VALUES ('p2','+96170000001','Dupe', now())`)).toMatch(/User_phone_key/);
  });

  it('keeps email unique', async () => {
    expect(await rejects(`INSERT INTO "User" (id, email, name, "updatedAt") VALUES ('e3','two@mig.test','Dupe', now())`)).toMatch(/User_email_key/);
  });

  it('allows one StaffMember per user per business, many unlinked', async () => {
    expect(await rejects(`INSERT INTO "StaffMember" (id, "businessId", "userId", "displayName", "updatedAt") VALUES ('x','b1','u1','Again', now())`)).toMatch(/StaffMember_userId_businessId_key/);
    await exec(`INSERT INTO "StaffMember" (id, "businessId", "displayName", "updatedAt") VALUES ('f2','b1','Free 2', now())`);
  });

  it('allows one OPEN activation link per staff member, any number of used ones', async () => {
    const ins = (id: string, hash: string, used: string) =>
      `INSERT INTO "ActivationToken" (id, "businessId", "staffMemberId", phone, "tokenHash", "expiresAt", "usedAt") VALUES ('${id}','b1','s2','+96170000002','${hash}', now() + interval '3 days', ${used})`;
    await exec(ins('a1', 'h1', 'NULL'));
    expect(await rejects(ins('a2', 'h2', 'NULL'))).toMatch(/ActivationToken_open_staff_key/);
    await exec(ins('a3', 'h3', 'now()'));
    await exec(ins('a4', 'h4', 'now()'));
    expect(await rejects(ins('a5', 'h1', 'now()'))).toMatch(/ActivationToken_tokenHash_key/);
  });

  it('accepts the new role value', async () => {
    await exec('COMMIT');
    await exec(`INSERT INTO "Membership" (id, "businessId", "userId", role) VALUES ('m2','b1','p1','PRACTITIONER')`);
  });
});
