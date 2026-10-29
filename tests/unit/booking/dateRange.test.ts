import { describe, expect, it } from 'vitest';
import { localDayOf, resolveLocalRange } from '@/server/domain/dateRange';

const now = new Date('2026-11-10T09:00:00Z');
const base = { timezone: 'Asia/Beirut', maxDays: 31, now };

describe('resolveLocalRange', () => {
  it('converts an inclusive local range to a UTC half-open interval', () => {
    const r = resolveLocalRange({ ...base, from: '2026-11-10', to: '2026-11-11' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.days).toBe(2);
      expect(r.startUtc.toISOString()).toBe('2026-11-09T22:00:00.000Z'); // UTC+2 in winter
      expect(r.endUtc.toISOString()).toBe('2026-11-11T22:00:00.000Z');
    }
  });

  it('spans a DST change', () => {
    const r = resolveLocalRange({
      ...base,
      now: new Date('2026-03-20T00:00:00Z'),
      from: '2026-03-28',
      to: '2026-03-29',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 2026-03-28 00:00 Beirut = UTC+2; 2026-03-30 00:00 Beirut = UTC+3
      expect(r.startUtc.toISOString()).toBe('2026-03-27T22:00:00.000Z');
      expect(r.endUtc.toISOString()).toBe('2026-03-29T21:00:00.000Z');
    }
  });

  it('rejects malformed, inverted, too long and beyond-window ranges with field messages', () => {
    expect(resolveLocalRange({ ...base, from: '2026-13-01', to: '2026-11-11' })).toMatchObject({
      ok: false,
      fields: { from: expect.any(String) },
    });
    expect(resolveLocalRange({ ...base, from: '2026-11-12', to: '2026-11-11' })).toMatchObject({
      ok: false,
      fields: { to: expect.any(String) },
    });
    expect(resolveLocalRange({ ...base, from: '2026-11-01', to: '2026-12-02' }).ok).toBe(false); // 32 days
    expect(resolveLocalRange({ ...base, from: '2026-11-01', to: '2026-12-01' }).ok).toBe(true); // 31 days
    expect(
      resolveLocalRange({ ...base, bookingWindowDays: 30, from: '2026-12-01', to: '2026-12-11' }),
    ).toMatchObject({ ok: false, fields: { to: expect.any(String) } });
    expect(
      resolveLocalRange({ ...base, bookingWindowDays: 30, from: '2026-12-01', to: '2026-12-10' }).ok,
    ).toBe(true);
  });
});

describe('localDayOf', () => {
  it('uses the business zone, not UTC', () => {
    // 22:30Z on the 9th is already the 10th in Beirut
    const d = localDayOf(new Date('2026-11-09T22:30:00Z'), 'Asia/Beirut');
    expect(d.date).toBe('2026-11-10');
    expect(d.startUtc.toISOString()).toBe('2026-11-09T22:00:00.000Z');
    expect(d.endUtc.toISOString()).toBe('2026-11-10T22:00:00.000Z');
  });
});
