import { describe, expect, it } from 'vitest';
import {
  CURATED_TIMEZONES,
  DEFAULT_TIMEZONE,
  timezoneGroups,
  timezoneLabel,
} from '@/lib/auth/timezones';

describe('timezoneGroups', () => {
  it('lists the curated zones first, in order, with Beirut as the default', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Beirut');
    expect(timezoneGroups(['Europe/Rome']).common).toEqual([...CURATED_TIMEZONES]);
    expect(CURATED_TIMEZONES[0]).toBe('Asia/Beirut');
  });

  it('puts every other zone in a sorted rest list without duplicating curated ones', () => {
    const { rest } = timezoneGroups(['Europe/Rome', 'Asia/Beirut', 'Africa/Lagos', 'Europe/Rome']);
    expect(rest).toEqual(['Africa/Lagos', 'Europe/Rome']);
  });

  it('works with the real runtime list', () => {
    const { common, rest } = timezoneGroups();
    expect(common).toHaveLength(CURATED_TIMEZONES.length);
    expect(rest.some((z) => CURATED_TIMEZONES.includes(z as never))).toBe(false);
  });
});

describe('timezoneLabel', () => {
  it('replaces underscores for display', () => {
    expect(timezoneLabel('America/New_York')).toBe('America/New York');
  });
});
