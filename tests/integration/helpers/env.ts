import 'dotenv/config';
import { testConnectionString } from './db';

/**
 * Runs before every integration test file: point the app's own Prisma client at the isolated `itest`
 * schema (never the default schema), and use the fake email provider.
 */
process.env.DATABASE_URL = testConnectionString();
process.env.DATABASE_SCHEMA = 'itest';
process.env.EMAIL_PROVIDER = 'fake';
process.env.APP_URL = 'http://localhost:3000';
