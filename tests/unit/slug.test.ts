import { describe, expect, it } from 'vitest';
import { isValidTimezone, RESERVED_SLUGS, slugProblem } from '@/server/contracts/slug';

describe('slugProblem', () => {
  it('accepts lowercase letters, digits and inner hyphens, 3-40 chars', () => {
    for (const s of ['studio-nour', 'abc', 'a1b', 'x'.repeat(40), 'my-shop-2']) {
      expect(slugProblem(s)).toBeUndefined();
    }
  });

  it('rejects bad formats as invalid', () => {
    for (const s of [
      '',
      'ab',
      'x'.repeat(41),
      '-abc',
      'abc-',
      'Abc',
      'a b c',
      'a_b',
      'abç',
      'a/b',
      '../x',
    ]) {
      expect(slugProblem(s), s).toBe('invalid');
    }
  });

  it('blocks reserved words', () => {
    for (const s of [
      'api',
      'login',
      'signup',
      'admin',
      'www',
      'static',
      '_next',
      'pricing',
      'invite',
      'pay',
    ]) {
      expect(RESERVED_SLUGS.has(s), s).toBe(true);
    }
    // Reserved words shorter than 3 chars are caught by the format rule first, longer by the list.
    expect(slugProblem('api')).toBe('reserved');
    expect(slugProblem('login')).toBe('reserved');
    expect(slugProblem('app')).toBe('reserved');
    expect(slugProblem('b')).toBe('invalid');
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimezone('Asia/Beirut')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('x'.repeat(100))).toBe(false);
  });
});
