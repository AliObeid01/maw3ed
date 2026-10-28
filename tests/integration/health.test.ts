import { describe, expect, it } from 'vitest';
import { testConnectionString } from './helpers/db';

describe('GET /api/health (real database)', () => {
  it('pings Postgres and returns 200', async () => {
    process.env.DATABASE_URL = testConnectionString();
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});
