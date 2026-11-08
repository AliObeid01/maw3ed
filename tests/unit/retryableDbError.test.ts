import { describe, expect, it } from 'vitest';
import { isRetryableLockError } from '@/server/http/errors';

const wrapped = (code: string) => ({
  code: 'P2010',
  meta: { driverAdapterError: { cause: { originalCode: code, kind: 'postgres' } } },
});

describe('isRetryableLockError', () => {
  it('is true for a deadlock (40P01) and lock_not_available (55P03), plain and wrapped', () => {
    expect(isRetryableLockError({ code: '40P01' })).toBe(true);
    expect(isRetryableLockError({ code: '55P03' })).toBe(true);
    expect(isRetryableLockError(wrapped('40P01'))).toBe(true);
    expect(isRetryableLockError(wrapped('55P03'))).toBe(true);
    expect(isRetryableLockError({ cause: { cause: { sqlState: '40P01' } } })).toBe(true);
  });
  it('is false for the slot constraint, unique violations and everything else', () => {
    for (const code of ['23P01', '23505', '40001', '57014', '08006', 'P2002', 'P2034'])
      expect(isRetryableLockError({ code }), code).toBe(false);
    expect(isRetryableLockError(wrapped('23P01'))).toBe(false);
    expect(isRetryableLockError(wrapped('23505'))).toBe(false);
    expect(isRetryableLockError(new Error('boom'))).toBe(false);
    expect(isRetryableLockError(null)).toBe(false);
    expect(isRetryableLockError(undefined)).toBe(false);
  });
});
