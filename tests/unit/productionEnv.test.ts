import { describe, expect, it } from 'vitest';
import { productionEnvProblems } from '../../scripts/lib/productionEnv.mjs';

const good = {
  DATABASE_URL: 'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db?sslmode=require',
  DIRECT_URL: 'postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require',
  APP_URL: 'https://maw3edlb.com',
  NEXT_PUBLIC_APP_URL: 'https://maw3edlb.com',
  SESSION_SECRET: 'a'.repeat(40),
  LINK_SECRET: 'b'.repeat(40),
  CRON_SECRET: 'c'.repeat(40),
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Maw3ed <reminders@mail.maw3edlb.com>',
};

describe('productionEnvProblems', () => {
  it('accepts a complete production environment', () => {
    expect(productionEnvProblems(good)).toEqual([]);
  });

  it('lists every missing variable by name only', () => {
    const problems = productionEnvProblems({});
    expect(problems).toContain('DATABASE_URL is missing');
    expect(problems).toContain('RESEND_API_KEY is missing');
    expect(problems.length).toBeGreaterThanOrEqual(10);
  });

  it('rejects short, reused or http values and never echoes a value', () => {
    const bad = { ...good, SESSION_SECRET: 'short', LINK_SECRET: good.CRON_SECRET, APP_URL: 'http://maw3edlb.com' };
    const problems = productionEnvProblems(bad);
    expect(problems.join('\n')).toMatch(/SESSION_SECRET must be at least 32/);
    expect(problems.join('\n')).toMatch(/must all be different/);
    expect(problems.join('\n')).toMatch(/APP_URL must be an https origin/);
    expect(problems.join('\n')).not.toContain('short');
    expect(problems.join('\n')).not.toContain(good.CRON_SECRET);
  });

  it('requires the resend provider and forbids dev-only switches', () => {
    expect(productionEnvProblems({ ...good, EMAIL_PROVIDER: 'fake' })).toContain('EMAIL_PROVIDER must be "resend" in production');
    expect(productionEnvProblems({ ...good, ALLOW_SEED: '1' })).toContain('ALLOW_SEED must not be set in production');
    expect(productionEnvProblems({ ...good, E2E_FAKE_SESSION: '1' })).toContain('E2E_FAKE_SESSION must not be set in production');
  });

  it('catches swapped pooled and direct Neon strings', () => {
    const swapped = { ...good, DATABASE_URL: good.DIRECT_URL, DIRECT_URL: good.DATABASE_URL };
    const text = productionEnvProblems(swapped).join('\n');
    expect(text).toMatch(/DATABASE_URL should be the pooled/);
    expect(text).toMatch(/DIRECT_URL must be the direct/);
  });
});
