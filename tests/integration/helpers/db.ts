import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { PrismaClient } from '../../../src/generated/prisma/client';

/**
 * Integration DB helper.
 *
 * Everything runs in an ISOLATED schema (`itest`) of DATABASE_URL_TEST. DATABASE_URL_TEST may point at a
 * shared dev database, so this helper never drops, truncates or alters the default/public schema:
 * it only ever touches `itest`, and refuses any other schema name. In CI the same variable points at a
 * throwaway postgres:16 service and the helper behaves identically.
 */
export const TEST_SCHEMA = 'itest';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../prisma/migrations');

function assertSafeSchema(name: string) {
  if (name !== TEST_SCHEMA || !/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(
      `Refusing to touch schema "${name}"; integration tests only use "${TEST_SCHEMA}".`,
    );
  }
}

/** DATABASE_URL_TEST without any `schema` query parameter (the schema is applied via search_path). */
export function testConnectionString(): string {
  const raw = process.env.DATABASE_URL_TEST;
  if (!raw) throw new Error('DATABASE_URL_TEST is not set');
  const url = new URL(raw);
  url.searchParams.delete('schema');
  return url.toString();
}

export function newClient(): Client {
  return new Client({
    connectionString: testConnectionString(),
    options: `-c search_path=${TEST_SCHEMA},public`,
  });
}

/** (Re)create the isolated schema and apply every migration, in order, inside it. */
export async function setupSchema(): Promise<void> {
  assertSafeSchema(TEST_SCHEMA);
  const client = new Client({ connectionString: testConnectionString() });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

/** Empty every table in the isolated schema. Never looks at any other schema. */
export async function truncateAll(client: Client): Promise<void> {
  assertSafeSchema(TEST_SCHEMA);
  const { rows } = await client.query<{ tablename: string }>(
    'SELECT tablename FROM pg_tables WHERE schemaname = $1',
    [TEST_SCHEMA],
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `${TEST_SCHEMA}."${r.tablename}"`).join(', ');
  await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** Prisma client bound to the isolated schema (for fixtures and for checking real driver errors). */
export function newPrisma(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: testConnectionString() }, { schema: TEST_SCHEMA }),
  });
}
