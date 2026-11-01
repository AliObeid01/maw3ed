import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ReportContext, Reporter } from '@/lib/observability/report';
import { AppError } from '@/server/http/errors';
import { ok, withRoute } from '@/server/http/withRoute';
import { setReporter } from '@/server/observability/report';

/** Records what would have been sent to the error service. */
function fakeReporter() {
  const errors: { error: unknown; ctx: ReportContext }[] = [];
  const messages: { level: string; text: string; ctx: ReportContext }[] = [];
  const reporter: Reporter = {
    error: (error, ctx) => void errors.push({ error, ctx }),
    message: (level, text, ctx) => void messages.push({ level, text, ctx }),
  };
  return { reporter, errors, messages };
}

let fake: ReturnType<typeof fakeReporter>;
beforeEach(() => {
  fake = fakeReporter();
  setReporter(fake.reporter);
});
afterEach(() => setReporter(undefined));

const req = (path = '/api/staff/abc?phone=71123456&lang=ar', init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'maw3ed_session=SECRET',
      'x-request-id': 'req-abcdef12',
    },
    body: JSON.stringify({ name: 'Lina', phone: '71123456' }),
    ...init,
  });
const args = { params: Promise.resolve({ id: 'abc' }) };
const Params = z.object({ id: z.string() }).strict();

function failing(error: unknown) {
  return withRoute({ auth: 'public', params: Params }, () => {
    throw error;
  });
}

describe('withRoute reports unexpected failures only', () => {
  it('reports a plain Error as a 500 with the templated route, request id and method', async () => {
    const route = withRoute({ auth: 'public', params: Params }, ({ ctx }) => {
      ctx.businessId = 'biz_internal_1';
      throw new Error('db exploded');
    });
    const res = await route(req(), args);
    expect(res.status).toBe(500);
    expect(fake.errors).toHaveLength(1);
    const { error, ctx } = fake.errors[0]!;
    expect((error as Error).message).toBe('db exploded');
    expect(ctx).toEqual({
      route: '/api/staff/[id]',
      requestId: 'req-abcdef12',
      businessId: 'biz_internal_1',
      method: 'POST',
    });
  });

  it('puts no body, cookie, query or real URL in the context', async () => {
    await failing(new Error('x'))(req(), args);
    const dump = JSON.stringify(fake.errors[0]!.ctx);
    for (const leak of ['SECRET', 'Lina', '71123456', 'lang=ar', '/api/staff/abc', 'cookie']) {
      expect(dump).not.toContain(leak);
    }
  });

  it('reports a 5xx AppError (misconfiguration) but not load shedding', async () => {
    await failing(new AppError(500, 'SERVER_MISCONFIGURED', 'x'))(req(), args);
    await failing(AppError.unavailable())(req(), args);
    expect(fake.errors).toHaveLength(2);
    await failing(AppError.busy())(req(), args);
    expect(fake.errors).toHaveLength(2);
  });

  it.each([
    ['400 validation', AppError.validation({ a: 'b' })],
    ['401', AppError.unauthenticated()],
    ['403', AppError.forbidden()],
    ['404', AppError.notFound()],
    ['409 SLOT_TAKEN', AppError.conflict('SLOT_TAKEN')],
    ['410', AppError.gone()],
    ['429', AppError.rateLimited(30)],
    ['429 login', AppError.tooManyAttempts(30)],
  ])('does not report %s', async (_name, error) => {
    const res = await failing(error)(req(), args);
    expect(res.status).toBeLessThan(500);
    expect(fake.errors).toHaveLength(0);
    expect(fake.messages).toHaveLength(0);
  });

  it('does not report a request that fails parsing (bad params, bad JSON, bad content type)', async () => {
    const route = withRoute(
      { auth: 'public', params: Params, body: z.object({ n: z.string() }).strict() },
      () => ok({}),
    );
    expect((await route(req('/api/x', { body: '{not json' }), args)).status).toBe(400);
    expect((await route(req('/api/x', { body: JSON.stringify({ n: 1 }) }), args)).status).toBe(400);
    expect(
      (await route(req('/api/x', { headers: { 'content-type': 'text/plain' } }), args)).status,
    ).toBe(415);
    expect(fake.errors).toHaveLength(0);
  });

  it('does not report cron-secret failures', async () => {
    const route = withRoute({ auth: 'cron' }, () => ok({}));
    const res = await route(new Request('http://localhost/api/jobs/x', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(fake.errors).toHaveLength(0);
  });

  it('does not report Next control-flow or abort errors', async () => {
    const digest = (d: string) => Object.assign(new Error(d), { digest: d });
    await failing(digest('NEXT_REDIRECT;replace;/login;307;'))(req(), args);
    await failing(digest('NEXT_HTTP_ERROR_FALLBACK;404'))(req(), args);
    await failing(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))(
      req(),
      args,
    );
    expect(fake.errors).toHaveLength(0);
  });

  it('never lets a failing reporter change the response', async () => {
    setReporter({
      error() {
        throw new Error('reporter down');
      },
      message() {},
    });
    const res = await failing(new Error('x'))(req(), args);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL');
  });
});
