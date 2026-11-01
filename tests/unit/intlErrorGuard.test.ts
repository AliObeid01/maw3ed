import { describe, expect, it } from 'vitest';
import { onIntlError } from '@/components/i18n/IntlBoundary';
import { findIntlProblems } from '../e2e/helpers/intlErrorPatterns';

// What the browser logs in production for a missing key (the shape next-intl's error has).
const missing = 'MISSING_MESSAGE: Could not resolve `booking.title` in messages for locale `en`.';

describe('e2e next-intl guard (tests/e2e/helpers/test.ts)', () => {
  it('flags a logged missing message, a bad format and a page error', () => {
    expect(findIntlProblems([{ type: 'error', text: missing }])).toEqual([missing]);
    expect(findIntlProblems([{ type: 'error', text: 'INVALID_MESSAGE: x' }])).toHaveLength(1);
    expect(findIntlProblems([{ type: 'pageerror', text: missing }])).toEqual([`pageerror: ${missing}`]);
  });

  it('ignores unrelated console output', () => {
    expect(
      findIntlProblems([
        { type: 'error', text: 'Failed to load resource: 404' },
        { type: 'log', text: missing },
        { type: 'pageerror', text: 'TypeError: x is undefined' },
      ]),
    ).toEqual([]);
  });
});

describe('onIntlError', () => {
  const err = Object.assign(new Error(missing), { code: 'MISSING_MESSAGE' });

  it('throws outside production (vitest, dev) and only logs in production', () => {
    const log = console.error;
    console.error = () => {};
    try {
      expect(() => onIntlError(err as never)).toThrow();
      const env = process.env as Record<string, string | undefined>;
      const was = env.NODE_ENV;
      env.NODE_ENV = 'production';
      try {
        expect(() => onIntlError(err as never)).not.toThrow();
      } finally {
        env.NODE_ENV = was;
      }
    } finally {
      console.error = log;
    }
  });
});
