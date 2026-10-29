import 'dotenv/config';
import { testConnectionString } from './db';

/**
 * Runs before every integration test file: point the app's own Prisma client at the isolated `itest`
 * schema (never the default schema), and use the fake email provider.
 */
// Optional private schema (ITEST_SCHEMA, must start with 'itest') so concurrent runs do not drop each other's tables.
const schema = process.env.ITEST_SCHEMA ?? 'itest';
// `$queryRaw` (FOR UPDATE locks) does not get the adapter's schema, so also set search_path on the connection.
const appUrl = new URL(testConnectionString());
appUrl.searchParams.set('options', `-c search_path=${schema}`);
process.env.DATABASE_URL = appUrl.toString();
process.env.DATABASE_SCHEMA = schema;
process.env.EMAIL_PROVIDER = 'fake';
process.env.APP_URL = 'http://localhost:3000';
if ((process.env.LINK_SECRET ?? '').length < 32)
  process.env.LINK_SECRET = 'integration-test-link-secret-0123456789abcdef';
