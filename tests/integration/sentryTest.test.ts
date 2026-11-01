import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as sentryTest } from '@/app/api/jobs/sentry-test/route';
import type { ReportContext, Reporter } from '@/lib/observability/report';
import { setReporter } from '@/server/observability/report';
import { call } from './helpers/api';

const SECRET = 'integration-cron-secret-0123456789abcdef-xyz';
const DSN = 'https://abc123@o1.ingest.de.sentry.io/42';

let errors: { error: unknown; ctx: ReportContext }[];
const saved: Record<string, string | undefined> = {};
const KEYS = ['CRON_SECRET', 'SENTRY_DSN', 'VERCEL_ENV'] as const;

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CRON_SECRET = SECRET;
  delete process.env.SENTRY_DSN;
  delete process.env.VERCEL_ENV;
  errors = [];
  const reporter: Reporter = {
    error: (error, ctx) => void errors.push({ error, ctx }),
    message() {},
  };
  setReporter(reporter);
});
afterEach(() => {
  setReporter(undefined);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const run = (headers: Record<string, string> = {}, query: Record<string, string> = {}) =>
  call(sentryTest, '/api/jobs/sentry-test', { method: 'POST', headers, query });

describe('POST /api/jobs/sentry-test', () => {
  it('401 without the cron secret, even when monitoring is on', async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.VERCEL_ENV = 'production';
    expect((await run()).status).toBe(401);
    expect((await run({ 'x-cron-secret': 'wrong' })).status).toBe(401);
    expect(errors).toHaveLength(0);
  });

  it('401 (fail closed) when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    process.env.SENTRY_DSN = DSN;
    process.env.VERCEL_ENV = 'production';
    expect((await run({ 'x-cron-secret': '' })).status).toBe(401);
    expect(errors).toHaveLength(0);
  });

  it('400 on an unknown query parameter', async () => {
    const res = await run({ 'x-cron-secret': SECRET }, { nope: '1' });
    expect(res.status).toBe(400);
    expect(res.body?.error.code).toBe('VALIDATION_FAILED');
  });

  it('404 with the secret but no DSN: nothing thrown, nothing reported', async () => {
    const res = await run({ 'x-cron-secret': SECRET });
    expect(res.status).toBe(404);
    expect(errors).toHaveLength(0);
  });

  it('404 with a DSN on a preview deployment', async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.VERCEL_ENV = 'preview';
    expect((await run({ 'x-cron-secret': SECRET })).status).toBe(404);
    expect(errors).toHaveLength(0);
  });

  it('with the secret, a DSN and Production: answers 500 and reports one deliberate error with the templated route', async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.VERCEL_ENV = 'production';
    const res = await run({ 'x-cron-secret': SECRET });
    expect(res.status).toBe(500);
    expect(res.body?.error.code).toBe('INTERNAL');
    expect(errors).toHaveLength(1);
    expect((errors[0]!.error as Error).message).toMatch(/deliberate server error/);
    expect(errors[0]!.ctx).toMatchObject({ route: '/api/jobs/sentry-test', method: 'POST' });
    expect(JSON.stringify(errors[0]!.ctx)).not.toContain(SECRET);
  });
});
