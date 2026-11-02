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

  it('judges "today" in the business timezone, not UTC', () => {
    const late = new Date('2026-10-29T22:30:00Z'); // 30 Oct 00:30 in Beirut
    expect(prefillRange('2026-10-29', late, TZ, 14)).toBeUndefined();
    expect(prefillRange('2026-10-30', late, TZ, 14)).toEqual({ from: '2026-10-30', to: '2026-11-12' });
  });
});
