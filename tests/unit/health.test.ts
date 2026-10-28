import { describe, expect, it, vi } from 'vitest';

// Keep the unit test off the database: replace the repository (the only layer that would touch Prisma).
const ping = vi.fn<() => Promise<void>>();
vi.mock('@/server/repositories/health.repo', () => ({ healthRepo: { ping: () => ping() } }));

describe('GET /api/health', async () => {
  const { GET } = await import('@/app/api/health/route');
  const get = () => GET(new Request('http://localhost/api/health'));

  it('returns 200 when the db answers', async () => {
    ping.mockResolvedValueOnce();
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('returns 503 in the error shape when the db is down', async () => {
    ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await get();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(json)).not.toContain('ECONNREFUSED');
  });
});
