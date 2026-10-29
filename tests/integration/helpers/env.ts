import 'dotenv/config';
import { testConnectionString } from './db';

/**
 * Runs before every integration test file: point the app's own Prisma client at the isolated `itest`
 * schema (never the default schema), and use the fake email provider.
 */
// `$queryRaw` (FOR UPDATE locks) does not get the adapter's schema, so also set search_path on the connection.
const appUrl = new URL(testConnectionString());
appUrl.searchParams.set('options', '-c search_path=itest');
process.env.DATABASE_URL = appUrl.toString();
process.env.DATABASE_SCHEMA = 'itest';
process.env.EMAIL_PROVIDER = 'fake';
process.env.APP_URL = 'http://localhost:3000';
