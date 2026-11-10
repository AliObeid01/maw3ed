import { describe, expect, it } from 'vitest';
import {
  GuardError,
  assertApplyAllowed,
  isPooledHost,
  parseArgs,
  readOwnerEnv,
  resolveDbTarget,
} from '../../../scripts/demo/guards';

const DIRECT = 'postgresql://u:p@ep-quiet-1.eu-central-1.aws.neon.tech/db?sslmode=require';
const POOLED = 'postgresql://u:p@ep-quiet-1-pooler.eu-central-1.aws.neon.tech/db?sslmode=require';
const HOST = 'ep-quiet-1.eu-central-1.aws.neon.tech';

const fails = (fn: () => unknown, re: RegExp) => {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(GuardError);
  expect((err as Error).message).toMatch(re);
};

describe('parseArgs', () => {
  it('is a dry run by default', () => {
    expect(parseArgs([])).toMatchObject({ apply: false, confirmHost: undefined });
  });
  it('reads --apply, --confirm-host, --now and --seed', () => {
    const a = parseArgs(['--apply', '--confirm-host', 'h.example', '--now', '2026-11-10T09:00:00Z', '--seed', '7']);
    expect(a.apply).toBe(true);
    expect(a.confirmHost).toBe('h.example');
    expect(a.now?.toISOString()).toBe('2026-11-10T09:00:00.000Z');
    expect(a.seed).toBe(7);
  });
  it('also reads --confirm-host=value', () => {
    expect(parseArgs(['--confirm-host=h.example']).confirmHost).toBe('h.example');
  });
  it('rejects unknown flags and bad dates', () => {
    fails(() => parseArgs(['--yolo']), /unknown option/i);
    fails(() => parseArgs(['--now', 'yesterday']), /--now/);
    fails(() => parseArgs(['--confirm-host']), /--confirm-host needs a value/);
  });
});

describe('resolveDbTarget', () => {
  it('prefers DIRECT_URL over DATABASE_URL', () => {
    const t = resolveDbTarget({ DIRECT_URL: DIRECT, DATABASE_URL: POOLED });
    expect(t.source).toBe('DIRECT_URL');
    expect(t.host).toBe(HOST);
  });
  it('falls back to DATABASE_URL', () => {
    expect(resolveDbTarget({ DATABASE_URL: DIRECT }).source).toBe('DATABASE_URL');
  });
  it('refuses when neither is set or the URL is not a URL', () => {
    fails(() => resolveDbTarget({}), /DIRECT_URL or DATABASE_URL/);
    fails(() => resolveDbTarget({ DIRECT_URL: 'not a url' }), /not a valid/);
  });
  it('knows a pooled host', () => {
    expect(isPooledHost('ep-a-1-pooler.eu.aws.neon.tech')).toBe(true);
    expect(isPooledHost(HOST)).toBe(false);
    expect(isPooledHost('localhost')).toBe(false);
  });
});

describe('assertApplyAllowed (the confirm-host guard)', () => {
  it('passes with the exact host', () => {
    expect(assertApplyAllowed({ confirmHost: HOST, env: { DIRECT_URL: DIRECT } }).host).toBe(HOST);
  });
  it('refuses without --confirm-host', () => {
    fails(() => assertApplyAllowed({ confirmHost: undefined, env: { DIRECT_URL: DIRECT } }), /--confirm-host/);
  });
  it('refuses a different host, whatever the case or a prefix', () => {
    fails(() => assertApplyAllowed({ confirmHost: 'other.neon.tech', env: { DIRECT_URL: DIRECT } }), /does not match/);
    fails(() => assertApplyAllowed({ confirmHost: HOST.toUpperCase() + '.', env: { DIRECT_URL: DIRECT } }), /does not match/);
    fails(() => assertApplyAllowed({ confirmHost: 'ep-quiet-1', env: { DIRECT_URL: DIRECT } }), /does not match/);
  });
  it('refuses a pooled host for writes, even when confirmed', () => {
    fails(() => assertApplyAllowed({ confirmHost: 'ep-quiet-1-pooler.eu-central-1.aws.neon.tech', env: { DIRECT_URL: POOLED } }), /pooled/i);
    fails(() => assertApplyAllowed({ confirmHost: 'ep-quiet-1-pooler.eu-central-1.aws.neon.tech', env: { DATABASE_URL: POOLED } }), /pooled/i);
  });
  it('honours EXPECTED_DB_HOST (compared without -pooler)', () => {
    expect(
      assertApplyAllowed({ confirmHost: HOST, env: { DIRECT_URL: DIRECT, EXPECTED_DB_HOST: HOST } }).host,
    ).toBe(HOST);
    fails(
      () => assertApplyAllowed({ confirmHost: HOST, env: { DIRECT_URL: DIRECT, EXPECTED_DB_HOST: 'ep-prod.neon.tech' } }),
      /EXPECTED_DB_HOST/,
    );
  });
});

describe('readOwnerEnv', () => {
  const ok = { DEMO_OWNER_EMAIL: 'Demo-Owner@demo.invalid', DEMO_OWNER_PASSWORD: 'a-long-enough-pass' };
  it('reads and lowercases the email, with a default name', () => {
    expect(readOwnerEnv(ok)).toEqual({
      email: 'demo-owner@demo.invalid',
      password: 'a-long-enough-pass',
      name: 'Demo Owner',
    });
    expect(readOwnerEnv({ ...ok, DEMO_OWNER_NAME: 'Dana' }).name).toBe('Dana');
  });
  it('refuses missing values and weak passwords', () => {
    fails(() => readOwnerEnv({ DEMO_OWNER_PASSWORD: 'a-long-enough-pass' }), /DEMO_OWNER_EMAIL/);
    fails(() => readOwnerEnv({ DEMO_OWNER_EMAIL: 'a@b.co' }), /DEMO_OWNER_PASSWORD/);
    fails(() => readOwnerEnv({ ...ok, DEMO_OWNER_PASSWORD: 'short-pass' }), /at least 12/);
    fails(() => readOwnerEnv({ ...ok, DEMO_OWNER_EMAIL: 'not-an-email' }), /DEMO_OWNER_EMAIL/);
  });
});
