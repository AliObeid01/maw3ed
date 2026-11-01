import { describe, expect, it } from 'vitest';
import { poolConfigFromUrl, poolConnectTimeoutMs, schemaFromEnv } from '@/server/repositories/db';

const TLS = { rejectUnauthorized: true };
const remote = (q = '') => `postgresql://u:p@ep-x.neon.tech/db${q}`;

describe('poolConfigFromUrl: remote hosts', () => {
  it.each(['require', 'prefer', 'verify-ca', 'verify-full'])(
    'sslmode=%s -> verified TLS, param dropped',
    (mode) => {
      const c = poolConfigFromUrl(remote(`?sslmode=${mode}&channel_binding=require`));
      expect(c.ssl).toEqual(TLS);
      expect(c.connectionString).not.toContain('sslmode');
      expect(c.connectionString).toContain('channel_binding=require');
    },
  );

  it('no sslmode -> TLS is still on', () => {
    expect(poolConfigFromUrl(remote()).ssl).toEqual(TLS);
  });

  it.each(['disable', 'allow', 'no-verify', 'requre', 'true', ''])('sslmode=%s throws', (mode) => {
    expect(() => poolConfigFromUrl(remote(`?sslmode=${mode}`))).toThrow(/without TLS/);
  });
});

describe('poolConfigFromUrl: local hosts', () => {
  const hosts = ['localhost:5432', '127.0.0.1:5432', '[::1]:5432'];
  it.each(hosts)('%s without sslmode has no TLS', (h) => {
    expect(poolConfigFromUrl(`postgresql://u:p@${h}/db`).ssl).toBeUndefined();
  });
  it.each(hosts)('%s: verifying modes use TLS; everything else is plain and allowed', (h) => {
    for (const mode of ['require', 'prefer', 'verify-ca', 'verify-full'])
      expect(poolConfigFromUrl(`postgresql://u:p@${h}/db?sslmode=${mode}`).ssl).toEqual(TLS);
    for (const mode of ['disable', 'allow', 'no-verify', 'weird']) {
      const c = poolConfigFromUrl(`postgresql://u:p@${h}/db?sslmode=${mode}`);
      expect(c.ssl).toBeUndefined();
      expect(c.connectionString).not.toContain('sslmode');
    }
  });
});

describe('schemaFromEnv', () => {
  it('is undefined when unset, validated otherwise, and refused in production', () => {
    expect(schemaFromEnv({ NODE_ENV: 'test' })).toBeUndefined();
    expect(schemaFromEnv({ NODE_ENV: 'test', DATABASE_SCHEMA: 'itest' })).toBe('itest');
    expect(() => schemaFromEnv({ NODE_ENV: 'test', DATABASE_SCHEMA: 'x"; DROP' })).toThrow();
    expect(() => schemaFromEnv({ NODE_ENV: 'test', DATABASE_SCHEMA: 'Public' })).toThrow();
    expect(() => schemaFromEnv({ NODE_ENV: 'production', DATABASE_SCHEMA: 'itest' })).toThrow(
      /production/,
    );
  });
});

describe('poolConnectTimeoutMs (TEST ONLY seam)', () => {
  it('defaults to 5000 and ignores junk', () => {
    expect(poolConnectTimeoutMs({ NODE_ENV: 'test' })).toBe(5000);
    expect(poolConnectTimeoutMs({ NODE_ENV: 'test', DATABASE_POOL_CONNECT_TIMEOUT_MS: 'abc' })).toBe(5000);
  });
  it('clamps to 1000..120000', () => {
    expect(poolConnectTimeoutMs({ NODE_ENV: 'test', DATABASE_POOL_CONNECT_TIMEOUT_MS: '10' })).toBe(1000);
    expect(poolConnectTimeoutMs({ NODE_ENV: 'test', DATABASE_POOL_CONNECT_TIMEOUT_MS: '15000' })).toBe(15000);
    expect(poolConnectTimeoutMs({ NODE_ENV: 'test', DATABASE_POOL_CONNECT_TIMEOUT_MS: '999999' })).toBe(120000);
  });
  it('is ignored in production', () => {
    expect(poolConnectTimeoutMs({ NODE_ENV: 'production', DATABASE_POOL_CONNECT_TIMEOUT_MS: '60000' })).toBe(5000);
  });
});
