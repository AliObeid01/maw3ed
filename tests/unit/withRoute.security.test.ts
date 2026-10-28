import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const logged = vi.hoisted(() => [] as unknown[]);
vi.mock('@/server/http/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/http/logger')>();
  const capture = {
    info: (o: unknown) => logged.push(o),
    error: (o: unknown) => logged.push(o),
    warn: () => {},
  };
  return { ...actual, childLogger: () => capture };
});

import { ok, routeTemplate, withRoute } from '@/server/http/withRoute';

const Body = z.object({ a: z.string() }).strict();
const post = (headers: Record<string, string>, url = 'http://localhost/api/x') =>
  new Request(url, { method: 'POST', headers, body: JSON.stringify({ a: 'b' }) });

afterEach(() => {
  logged.length = 0;
  vi.unstubAllEnvs();
});

describe('content type (login CSRF)', () => {
  const route = withRoute({ auth: 'public', body: Body }, async () => ok({}));

  it('415 for text/plain, form posts and a missing content type', async () => {
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      '',
    ]) {
      const res = await route(post(type ? { 'content-type': type } : {}));
      expect(res.status, type).toBe(415);
      expect((await res.json()).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('accepts application/json in any case, with a charset', async () => {
    for (const type of [
      'application/json',
      'Application/JSON',
      'application/json; charset=utf-8',
    ]) {
      expect((await route(post({ 'content-type': type }))).status, type).toBe(200);
    }
  });
});

describe('origin check on session routes', () => {
  const route = withRoute({ auth: 'session' }, async () => ok({}));
  const json = { 'content-type': 'application/json' };

  it('403 for a cross-origin POST, before any auth work', async () => {
    const res = await route(post({ ...json, origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect((await route(post({ ...json, origin: 'null' }))).status).toBe(403);
  });

  it('same-origin, APP_URL origin and absent Origin get past the check (then 401: no cookie)', async () => {
    vi.stubEnv('APP_URL', 'https://app.maw3ed.test');
    for (const headers of [
      { ...json, origin: 'http://localhost' },
      { ...json, origin: 'https://app.maw3ed.test' },
      json,
    ]) {
      expect((await route(post(headers))).status).toBe(401);
    }
  });

  it('does not apply to safe methods', async () => {
    const res = await route(
      new Request('http://localhost/x', { headers: { origin: 'https://evil.example' } }),
    );
    expect(res.status).toBe(401);
  });
});

describe('logging never contains a token path', () => {
  it('logs the route template, not the raw token', async () => {
    const route = withRoute({ auth: 'public', params: z.object({ token: z.string() }) }, async () =>
      ok({}),
    );
    const secret = 'SECRETTOKEN0123456789abcdefghijklmnopqrstuv';
    await route(new Request(`http://localhost/api/invites/${secret}/accept`, { method: 'POST' }), {
      params: Promise.resolve({ token: secret }),
    });
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain(secret);
    expect(logged[0]).toMatchObject({ path: '/api/invites/[token]/accept' });
  });

  it('also redacts on early failures (401 before params are parsed)', async () => {
    const route = withRoute(
      { auth: 'session', params: z.object({ token: z.string() }) },
      async () => ok({}),
    );
    const secret = 'ANOTHERSECRETTOKEN0123456789abcdefghijklmnop';
    await route(new Request(`http://localhost/api/invites/${secret}`), {
      params: Promise.resolve({ token: secret }),
    });
    expect(JSON.stringify(logged)).not.toContain(secret);
  });

  it('routeTemplate handles encoded and catch-all values', () => {
    expect(routeTemplate('/a/x%20y/b', { id: 'x y' })).toBe('/a/[id]/b');
    expect(routeTemplate('/a/1/2', { rest: ['1', '2'] })).toBe('/a/[...rest]');
    expect(routeTemplate('/plain', {})).toBe('/plain');
  });
});

describe('cache control', () => {
  it('defaults every API response to no-store', async () => {
    const route = withRoute({ auth: 'public' }, async () => ok({}));
    expect((await route(new Request('http://localhost/x'))).headers.get('cache-control')).toBe(
      'no-store',
    );
  });
});
