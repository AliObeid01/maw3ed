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
// Route-level per-IP limits are off by default (many tests fire hundreds of requests from one fake
// address). tests/integration/rateLimit.routes.test.ts switches them on. The login guard is always on.
process.env.RATE_LIMIT_DISABLED = '1';
// The remote test database is slow under concurrent bursts; production uses 300 ms.
process.env.RATE_LIMIT_TIMEOUT_MS = '15000';
// A burst larger than the app pool (max 5) queues for a connection; on the slow remote database the queue can
// outlast the production 5 s connect timeout and surface as a 500 (F22). 15 s here; waitlist.test.ts raises it for its 8-wide burst.
process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS = '15000';
