import { describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from '@/server/repositories/db';

describe('poolConfigFromUrl', () => {
  it('turns sslmode=require into an explicit verifying ssl option and drops the param', () => {
    const c = poolConfigFromUrl(
      'postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require',
    );
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
    expect(c.connectionString).not.toContain('sslmode');
    expect(c.connectionString).toContain('channel_binding=require');
  });

  it('keeps a local URL without sslmode plain (no TLS)', () => {
    const url = 'postgresql://u:p@localhost:5432/db';
    expect(poolConfigFromUrl(url)).toEqual({ connectionString: url });
  });

  it('honours sslmode=disable', () => {
    const c = poolConfigFromUrl('postgresql://u:p@localhost/db?sslmode=disable');
    expect(c.ssl).toBeUndefined();
    expect(c.connectionString).not.toContain('sslmode');
  });
});
