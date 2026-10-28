import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Writable } from 'node:stream';
import { AppError, mapError, pgErrorCode } from '@/server/http/errors';
import { createLogger } from '@/server/http/logger';
import { MAX_BODY_BYTES, ok, withRoute } from '@/server/http/withRoute';

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { logger: createLogger({ level: 'info', destination }), lines };
}

describe('logger redaction', () => {
  it('redacts secrets at several depths and header names', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      token: 'T0KEN',
      tokenHash: 'HASH',
      password: 'PW',
      user: { passwordHash: 'PWHASH' },
      req: { headers: { cookie: 'sid=COOKIE', authorization: 'Bearer AUTH', 'set-cookie': 'SC' } },
      headers: { 'x-cron-secret': 'CRON' },
      err: { meta: { token: 'DEEP' } },
    });
    const out = lines.join('');
    for (const secret of [
      'T0KEN',
      'HASH',
      'PW"',
      'PWHASH',
      'COOKIE',
      'AUTH',
      '"SC"',
      'CRON',
      'DEEP',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[redacted]');
  });
});

describe('error mapping hardening', () => {
  it('turns a ZodError thrown outside request parsing into a 500', () => {
    const result = z.string().safeParse(1);
    if (result.success) throw new Error('unreachable');
    const mapped = mapError(result.error);
    expect(mapped.status).toBe(500);
    expect(mapped.unexpected).toBe(true);
  });

  it('only accepts well-formed SQLSTATE codes', () => {
    expect(pgErrorCode({ code: 'ENOENT' })).toBeUndefined();
    expect(pgErrorCode({ code: 'ABCDE' })).toBeUndefined();
    expect(pgErrorCode({ code: '23P01' })).toBe('23P01');
  });
});

describe('withRoute input limits', () => {
  const route = withRoute(
    { auth: 'public', body: z.object({ a: z.string() }).strict() },
    async ({ body }) => ok(body),
  );
  const post = (body: string, headers: Record<string, string> = {}) =>
    route(
      new Request('http://localhost/x', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', ...headers },
      }),
    );

  it('rejects an oversized body by content-length with 413', async () => {
    const res = await post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects an oversized body by real size', async () => {
    const res = await post(JSON.stringify({ a: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(res.status).toBe(413);
  });

  it('accepts a body just under the limit', async () => {
    const res = await post(JSON.stringify({ a: 'x'.repeat(MAX_BODY_BYTES - 100) }));
    expect(res.status).toBe(200);
  });

  it('ignores prototype-polluting query keys', async () => {
    let seen: unknown;
    const q = withRoute(
      { auth: 'public', query: z.object({ a: z.string() }).strict() },
      async ({ query }) => {
        seen = query;
        return ok({});
      },
    );
    const res = await q(new Request('http://localhost/x?a=1&__proto__=evil&constructor=x'));
    expect(res.status).toBe(200);
    expect(seen).toEqual({ a: '1' });
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });

  it('keeps AppError available for statuses', () => {
    expect(AppError.payloadTooLarge().status).toBe(413);
  });
});
