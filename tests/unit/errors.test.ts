import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, mapError, pgErrorCode, zodFields } from '@/server/http/errors';

describe('AppError constructors', () => {
  it.each([
    [AppError.notFound(), 404, 'NOT_FOUND'],
    [AppError.forbidden(), 403, 'FORBIDDEN'],
    [AppError.unauthenticated(), 401, 'UNAUTHENTICATED'],
    [AppError.validation({ name: 'Required' }), 400, 'VALIDATION_FAILED'],
    [AppError.conflict('SLOT_TAKEN', { slots: [] }), 409, 'SLOT_TAKEN'],
    [AppError.gone(), 410, 'LINK_EXPIRED'],
    [AppError.gone('OFFER_EXPIRED'), 410, 'OFFER_EXPIRED'],
  ])('maps %# to %i %s', (err, status, code) => {
    const mapped = mapError(err);
    expect(mapped.status).toBe(status);
    expect(mapped.body.error.code).toBe(code);
    expect(mapped.unexpected).toBe(false);
  });

  it('always includes fields and carries conflict data', () => {
    const body = mapError(AppError.conflict('SLOT_TAKEN', { slots: ['a'] })).body;
    expect(body.error.fields).toEqual({});
    expect(body.error.data).toEqual({ slots: ['a'] });
  });
});

describe('database errors', () => {
  it('maps Postgres 23P01 to 409 SLOT_TAKEN', () => {
    const mapped = mapError(
      Object.assign(new Error('conflicting key value violates exclusion constraint'), {
        code: '23P01',
      }),
    );
    expect(mapped.status).toBe(409);
    expect(mapped.body.error.code).toBe('SLOT_TAKEN');
    expect(mapped.body.error.data).toEqual({ slots: [] });
  });

  it('maps 23P01 nested in Prisma driver-adapter metadata', () => {
    const err = {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
    };
    expect(pgErrorCode(err)).toBe('23P01');
    expect(mapError(err).body.error.code).toBe('SLOT_TAKEN');
  });

  it('maps 23505 and P2002 to 409 CONFLICT', () => {
    expect(mapError({ code: '23505' })).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFLICT' } },
    });
    expect(mapError({ code: 'P2002' })).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFLICT' } },
    });
  });

  it('does not mistake Prisma codes for SQLSTATE', () => {
    expect(pgErrorCode({ code: 'P2002' })).toBeUndefined();
  });

  it('maps unknown errors to 500 without leaking the message', () => {
    const mapped = mapError(new Error('secret connection string'));
    expect(mapped.status).toBe(500);
    expect(mapped.unexpected).toBe(true);
    expect(JSON.stringify(mapped.body)).not.toContain('secret');
  });
});

describe('zodFields', () => {
  it('flattens paths and names unknown keys', () => {
    const schema = z
      .object({ name: z.string().min(1), nested: z.object({ n: z.number() }) })
      .strict();
    const result = schema.safeParse({ name: '', nested: { n: 'x' }, extra: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodFields(result.error);
      expect(Object.keys(fields).sort()).toEqual(['extra', 'name', 'nested.n']);
      expect(fields.extra).toBe('Unknown field.');
    }
  });
});
