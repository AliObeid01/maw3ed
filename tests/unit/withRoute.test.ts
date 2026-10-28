import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '@/server/http/errors';
import { created, ok, withRoute } from '@/server/http/withRoute';

const Body = z
  .object({ name: z.string().trim().min(1), age: z.number().int().optional() })
  .strict();
const Params = z.object({ id: z.string().min(3) }).strict();
const Query = z.object({ limit: z.coerce.number().int().max(50).default(10) }).strict();

const post = (body: unknown, init: RequestInit = {}) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

describe('withRoute parsing', () => {
  const route = withRoute(
    { auth: 'public', body: Body, params: Params, query: Query },
    async ({ body, params, query }) => created({ body, params, query }),
  );
  const args = { params: Promise.resolve({ id: 'abc' }) };

  it('passes parsed params, query and body', async () => {
    const res = await route(
      new Request('http://localhost/api/x?limit=5', {
        method: 'POST',
        body: JSON.stringify({ name: ' Lina ' }),
      }),
      args,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      body: { name: 'Lina' },
      params: { id: 'abc' },
      query: { limit: 5 },
    });
  });

  it('returns 400 with fields for an invalid body', async () => {
    const res = await route(post({ name: '' }), args);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_FAILED');
    expect(json.error.fields.name).toBeTruthy();
  });

  it('rejects unknown body fields', async () => {
    const res = await route(post({ name: 'Lina', businessId: 'evil' }), args);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.businessId).toBe('Unknown field.');
  });

  it('rejects unknown query params and bad params', async () => {
    const badQuery = await route(
      new Request('http://localhost/api/x?nope=1', { method: 'POST', body: '{"name":"a"}' }),
      args,
    );
    expect(badQuery.status).toBe(400);
    const badParams = await route(post({ name: 'a' }), { params: Promise.resolve({ id: 'a' }) });
    expect(badParams.status).toBe(400);
    expect((await badParams.json()).error.fields.id).toBeTruthy();
  });

  it('returns 400 for malformed JSON and for a missing required body', async () => {
    expect((await route(post('{oops'), args)).status).toBe(400);
    const missing = await route(new Request('http://localhost/api/x', { method: 'POST' }), args);
    expect(missing.status).toBe(400);
  });

  it('sets x-request-id and honours a sane incoming one', async () => {
    const res = await route(post({ name: 'a' }), args);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await route(
      post({ name: 'a' }, { headers: { 'x-request-id': 'req-12345678' } }),
      args,
    );
    expect(echoed.headers.get('x-request-id')).toBe('req-12345678');
    const rejected = await route(
      post({ name: 'a' }, { headers: { 'x-request-id': 'bad id with spaces' } }),
      args,
    );
    expect(rejected.headers.get('x-request-id')).not.toBe('bad id with spaces');
  });
});

describe('withRoute error mapping', () => {
  it('maps thrown AppErrors, DB errors and unknown errors', async () => {
    const notFound = withRoute({ auth: 'public' }, async () => {
      throw AppError.notFound();
    });
    expect((await notFound(new Request('http://localhost/x'))).status).toBe(404);

    const taken = withRoute({ auth: 'public' }, async () => {
      throw Object.assign(new Error('x'), { code: '23P01' });
    });
    const res = await taken(new Request('http://localhost/x'));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('SLOT_TAKEN');

    const boom = withRoute({ auth: 'public' }, async () => {
      throw new Error('kaboom');
    });
    const res500 = await boom(new Request('http://localhost/x'));
    expect(res500.status).toBe(500);
    expect((await res500.json()).error.code).toBe('INTERNAL');
  });
});

describe('withRoute auth modes', () => {
  const ENV = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = 'a-cron-secret-for-tests';
  });
  afterEach(() => {
    if (ENV === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ENV;
  });

  const handler = vi.fn(async () => ok({ ran: true }));
  const cron = withRoute({ auth: 'cron' }, handler);
  const call = (headers?: Record<string, string>) =>
    cron(new Request('http://localhost/api/jobs', { method: 'POST', headers }));

  it('accepts the right secret', async () => {
    handler.mockClear();
    const res = await call({ 'x-cron-secret': 'a-cron-secret-for-tests' });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, wrong, and different-length secrets with 401 without running the handler', async () => {
    handler.mockClear();
    for (const headers of [
      undefined,
      { 'x-cron-secret': 'nope' },
      { 'x-cron-secret': 'a-cron-secret-for-tests-and-more' },
      { 'x-cron-secret': '' },
    ]) {
      const res = await call(headers);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await call({ 'x-cron-secret': '' });
    expect(res.status).toBe(401);
    const res2 = await call({ 'x-cron-secret': 'undefined' });
    expect(res2.status).toBe(401);
  });

  it('answers 401 for session mode without a cookie and 501 for token mode until it lands', async () => {
    const session = withRoute({ auth: 'session' }, async () => ok({}));
    expect((await session(new Request('http://localhost/x'))).status).toBe(401);
    const token = withRoute({ auth: 'token' }, async () => ok({}));
    expect((await token(new Request('http://localhost/x'))).status).toBe(501);
  });
});
