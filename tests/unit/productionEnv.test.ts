import { describe, expect, it } from 'vitest';
import { checkProductionEnv, shouldMigrate } from '../../scripts/lib/productionEnv.mjs';

const good = {
  DATABASE_URL: 'postgresql://u:pw-secret@ep-prod-pooler.eu-central-1.aws.neon.tech/db?sslmode=require',
  DIRECT_URL: 'postgresql://u:pw-secret@ep-prod.eu-central-1.aws.neon.tech/db?sslmode=require',
  EXPECTED_DB_HOST: 'ep-prod.eu-central-1.aws.neon.tech',
  APP_URL: 'https://maw3edlb.com',
  NEXT_PUBLIC_APP_URL: 'https://maw3edlb.com',
  LINK_SECRET: 'b'.repeat(40),
  CRON_SECRET: 'c'.repeat(40),
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'Maw3ed <reminders@mail.maw3edlb.com>',
};
const errorsOf = (env: Record<string, string | undefined>) => checkProductionEnv(env).errors;

describe('shouldMigrate: migrations run for Vercel production deploys only', () => {
  it('is true only for VERCEL_ENV=production', () => {
    expect(shouldMigrate({ VERCEL_ENV: 'production' })).toBe(true);
  });
  it.each([['preview'], ['development'], [''], ['Production'], ['PRODUCTION'], [' production']])('is false for %j', (v) => {
    expect(shouldMigrate({ VERCEL_ENV: v })).toBe(false);
  });
  it('is false when VERCEL_ENV is unset (local build, CI)', () => {
    expect(shouldMigrate({})).toBe(false);
    expect(shouldMigrate({ NODE_ENV: 'production' })).toBe(false);
  });
});

describe('checkProductionEnv', () => {
  it('accepts a complete production environment with no warnings', () => {
    expect(checkProductionEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it('lists every missing variable by name only', () => {
    const errors = errorsOf({});
    for (const n of ['DATABASE_URL', 'DIRECT_URL', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'LINK_SECRET', 'CRON_SECRET', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM']) {
      expect(errors).toContain(`${n} is missing`);
    }
  });

  it('treats whitespace-only values as missing', () => {
    expect(errorsOf({ ...good, RESEND_API_KEY: '   ' })).toContain('RESEND_API_KEY is missing');
  });

  it('enforces secret length at exactly 31 and 32 characters', () => {
    expect(errorsOf({ ...good, LINK_SECRET: 'x'.repeat(31) })).toContain('LINK_SECRET must be at least 32 characters');
    expect(errorsOf({ ...good, LINK_SECRET: 'x'.repeat(32) })).toEqual([]);
  });

  it('rejects reused secrets', () => {
    expect(errorsOf({ ...good, LINK_SECRET: good.CRON_SECRET })).toContain('LINK_SECRET and CRON_SECRET must be different');
  });

  it('does not require SESSION_SECRET (sessions use a database table)', () => {
    expect(errorsOf({ ...good })).not.toContain('SESSION_SECRET is missing');
  });

  it('accepts a trailing slash on the app URL but rejects http, paths, queries and credentials', () => {
    expect(errorsOf({ ...good, APP_URL: 'https://maw3edlb.com/', NEXT_PUBLIC_APP_URL: 'https://maw3edlb.com' })).toEqual([]);
    for (const bad of ['http://maw3edlb.com', 'https://maw3edlb.com/path', 'https://maw3edlb.com?x=1', 'https://user:pw@maw3edlb.com', 'maw3edlb.com']) {
      expect(errorsOf({ ...good, APP_URL: bad, NEXT_PUBLIC_APP_URL: bad }).join('\n')).toMatch(/APP_URL must be an https origin/);
    }
  });

  it('requires APP_URL and NEXT_PUBLIC_APP_URL to match', () => {
    expect(errorsOf({ ...good, NEXT_PUBLIC_APP_URL: 'https://other.example.com' })).toContain('APP_URL and NEXT_PUBLIC_APP_URL must be the same');
  });

  it('requires the resend provider and forbids dev-only switches', () => {
    expect(errorsOf({ ...good, EMAIL_PROVIDER: 'fake' })).toContain('EMAIL_PROVIDER must be "resend" in production');
    for (const n of ['ALLOW_SEED', 'ALLOW_SEED_REMOTE', 'E2E_FAKE_SESSION']) {
      expect(errorsOf({ ...good, [n]: '1' })).toContain(`${n} must not be set in production`);
    }
  });

  it('fails on a pooled DIRECT_URL or identical connection strings, and only warns on an unpooled DATABASE_URL', () => {
    expect(errorsOf({ ...good, DIRECT_URL: good.DATABASE_URL }).join('\n')).toMatch(/DIRECT_URL must be the direct/);
    expect(errorsOf({ ...good, DATABASE_URL: good.DIRECT_URL })).toContain('DATABASE_URL and DIRECT_URL must be different (pooled vs direct)');
    const unpooled = checkProductionEnv({ ...good, DATABASE_URL: 'postgresql://u:pw-secret@db.example.com/db', EXPECTED_DB_HOST: 'db.example.com', DIRECT_URL: 'postgresql://u:pw-secret@db.example.com:5433/db' });
    expect(unpooled.errors).toEqual([]);
    expect(unpooled.warnings.join('\n')).toMatch(/does not look like a pooled Neon string/);
  });

  it('refuses a dev database when EXPECTED_DB_HOST is set, and warns when it is not', () => {
    const dev = 'postgresql://u:pw-secret@ep-dev-pooler.eu-central-1.aws.neon.tech/db';
    expect(errorsOf({ ...good, DATABASE_URL: dev }).join('\n')).toMatch(/DATABASE_URL does not point at EXPECTED_DB_HOST/);
    const { EXPECTED_DB_HOST: _omit, ...withoutExpected } = good;
    expect(_omit).toBeDefined();
    expect(checkProductionEnv(withoutExpected).warnings.join('\n')).toMatch(/EXPECTED_DB_HOST is not set/);
  });

  it('never echoes any environment value in an error or warning', () => {
    const bad = {
      ...good,
      LINK_SECRET: 'short-link-secret',
      CRON_SECRET: 'short-link-secret',
      APP_URL: 'http://leaky.example.com',
      NEXT_PUBLIC_APP_URL: 'http://other-leaky.example.com',
      EMAIL_PROVIDER: 'fake-provider-value',
      DATABASE_URL: 'postgresql://u:pw-secret@ep-dev-pooler.eu-central-1.aws.neon.tech/db',
      ALLOW_SEED: 'seed-flag-value',
    };
    const { errors, warnings } = checkProductionEnv(bad);
    const text = [...errors, ...warnings].join('\n');
    expect(errors.length).toBeGreaterThan(3);
    for (const value of Object.values(bad)) expect(text).not.toContain(value);
    expect(text).not.toContain('pw-secret');
  });
});
