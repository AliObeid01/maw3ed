import { describe, expect, it } from 'vitest';
import { prefillRange } from '@/lib/waitlist/range';

const TZ = 'Asia/Beirut';

describe('prefillRange (?from= on the waitlist page, F63)', () => {
  const now = new Date('2026-10-29T10:00:00Z');

  it('starts the default-length range on the chosen day, clipped to the booking window', () => {
    expect(prefillRange('2026-11-02', now, TZ, 30)).toEqual({ from: '2026-11-02', to: '2026-11-15' });
    expect(prefillRange('2026-11-02', now, TZ, 7)).toEqual({ from: '2026-11-02', to: '2026-11-04' });
    expect(prefillRange('2026-10-29', now, TZ, 14)).toEqual({ from: '2026-10-29', to: '2026-11-11' });
  });

  it('ignores garbage, past days and days outside the window', () => {
    for (const bad of [null, undefined, '', 'tomorrow', '2026-13-40', '2026-2-3', '2026-10-28', '2026-11-12']) {
      expect(prefillRange(bad, now, TZ, 14)).toBeUndefined();
    }
  });

  it('accepts exactly today and exactly the last bookable day, nothing beyond', () => {
    expect(prefillRange('2026-10-29', now, TZ, 14)?.from).toBe('2026-10-29');
    expect(prefillRange('2026-11-11', now, TZ, 14)).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(prefillRange('2026-11-12', now, TZ, 14)).toBeUndefined();
  });

  it('rejects impossible dates, ISO datetimes and padded input', () => {
    for (const bad of ['2026-02-31', '2026-10-30T00:00:00Z', '2026-10-30T10:00', ' 2026-10-30', '2026-10-30 ', '20261030']) {
      expect(prefillRange(bad, now, TZ, 14)).toBeUndefined();
    }
  });

  it('never throws on a bad window length and falls back to the default length', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      expect(() => prefillRange('2026-10-30', now, TZ, bad)).not.toThrow();
      expect(prefillRange('2026-10-30', now, TZ, bad)).toEqual({ from: '2026-10-30', to: '2026-11-11' });
    }
    expect(prefillRange('2026-10-29', now, TZ, 1)).toEqual({ from: '2026-10-29', to: '2026-10-29' });
    expect(prefillRange('2026-10-30', now, TZ, 2.9)).toEqual({ from: '2026-10-30', to: '2026-10-30' });
  });

  it('counts calendar days across DST changes in Beirut and New York', () => {
    // Beirut springs forward 28 Mar 2027 (last Saturday of March at midnight); New York 14 Mar 2027.
    const beirut = new Date('2027-03-25T10:00:00Z');
    expect(prefillRange('2027-03-29', beirut, 'Asia/Beirut', 14)).toEqual({ from: '2027-03-29', to: '2027-04-07' });
    expect(prefillRange('2027-04-07', beirut, 'Asia/Beirut', 14)).toEqual({ from: '2027-04-07', to: '2027-04-07' });
    expect(prefillRange('2027-04-08', beirut, 'Asia/Beirut', 14)).toBeUndefined();
    const ny = new Date('2027-03-12T15:00:00Z');
    expect(prefillRange('2027-03-14', ny, 'America/New_York', 14)).toEqual({ from: '2027-03-14', to: '2027-03-25' });
    expect(prefillRange('2027-03-25', ny, 'America/New_York', 14)).toEqual({ from: '2027-03-25', to: '2027-03-25' });
    expect(prefillRange('2027-03-26', ny, 'America/New_York', 14)).toBeUndefined();
    const fall = new Date('2026-10-30T15:00:00Z'); // NY falls back 1 Nov 2026
    expect(prefillRange('2026-11-01', fall, 'America/New_York', 3)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });

  it('judges "today" in the business timezone, not UTC', () => {
    const late = new Date('2026-10-29T22:30:00Z'); // 30 Oct 00:30 in Beirut
    expect(prefillRange('2026-10-29', late, TZ, 14)).toBeUndefined();
    expect(prefillRange('2026-10-30', late, TZ, 14)).toEqual({ from: '2026-10-30', to: '2026-11-12' });
  });
});
