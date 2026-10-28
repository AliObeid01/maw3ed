import { describe, expect, it } from 'vitest';
import { poolConfigFromUrl, schemaFromEnv } from '@/server/repositories/db';

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
