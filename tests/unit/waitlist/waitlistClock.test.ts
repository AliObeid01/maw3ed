import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import { safeHref, serverNow, serverOffsetMs } from '@/lib/waitlist/clock';
import { classifyJoinError, dateError, isOutOfWindow, windowDaysFromError } from '@/lib/waitlist/errors';
import { announcementFor, isExpired, minutesLeft } from '@/lib/waitlist/offer';

describe('server clock offset', () => {
  it('is server minus device, and 0 for a missing or invalid header', () => {
    const device = Date.parse('2026-10-29T12:00:00Z');
    expect(serverOffsetMs('Thu, 29 Oct 2026 12:10:00 GMT', device)).toBe(600_000);
    expect(serverOffsetMs('Thu, 29 Oct 2026 11:50:00 GMT', device)).toBe(-600_000);
    expect(serverOffsetMs(null, device)).toBe(0);
    expect(serverOffsetMs('', device)).toBe(0);
    expect(serverOffsetMs('not a date', device)).toBe(0);
  });

  it('a slow device (10 min behind) still counts down to the server expiry', () => {
    const serverTime = Date.parse('2026-10-29T12:00:00Z');
    const device = serverTime - 600_000;
    const offset = serverOffsetMs(new Date(serverTime).toUTCString(), device);
    const expiresAt = new Date(serverTime + 28 * 60_000).toISOString();
    expect(minutesLeft(expiresAt, device)).toBe(38);
    expect(minutesLeft(expiresAt, serverNow(offset, device))).toBe(28);
  });

  it('a fast device (40 min ahead) is not expired once corrected', () => {
    const serverTime = Date.parse('2026-10-29T12:00:00Z');
    const device = serverTime + 40 * 60_000;
    const offset = serverOffsetMs(new Date(serverTime).toUTCString(), device);
    const expiresAt = new Date(serverTime + 28 * 60_000).toISOString();
    expect(isExpired(expiresAt, device)).toBe(true);
    expect(isExpired(expiresAt, serverNow(offset, device))).toBe(false);
  });
});

describe('announcements', () => {
  const expiresAt = '2026-10-29T12:30:00.000Z';
  const at = Date.parse(expiresAt);
  it('speak only at 10, 5 and 1 minute and at expiry', () => {
    expect(announcementFor(expiresAt, at - 28 * 60_000)).toBe('');
    expect(announcementFor(expiresAt, at - 11 * 60_000)).toBe('');
    expect(announcementFor(expiresAt, at - 10 * 60_000)).toBe('m10');
    expect(announcementFor(expiresAt, at - 6 * 60_000)).toBe('m10');
    expect(announcementFor(expiresAt, at - 5 * 60_000)).toBe('m5');
    expect(announcementFor(expiresAt, at - 60_000)).toBe('m1');
    expect(announcementFor(expiresAt, at)).toBe('expired');
  });
});

describe('safeHref', () => {
  it('allows same-origin paths and https only', () => {
    expect(safeHref('/l/abc.def', 'https://x.test')).toBe('/l/abc.def');
    expect(safeHref('https://maw3ed.test/l/t', 'https://x.test')).toBe('https://maw3ed.test/l/t');
    expect(safeHref('http://x.test/l/t', 'http://x.test')).toBe('http://x.test/l/t');
    expect(safeHref('http://evil.test/l/t', 'https://x.test')).toBeUndefined();
    expect(safeHref('javascript:alert(1)', 'https://x.test')).toBeUndefined();
    expect(safeHref('//evil.test/x', 'https://x.test')).toBeUndefined();
    expect(safeHref('data:text/html,hi', 'https://x.test')).toBeUndefined();
  });
});

describe('server date messages', () => {
  it('maps known texts and never guesses a reason for unknown ones', () => {
    expect(dateError('fromDate', 'Pick today or a later date.')).toBe('fromPast');
    expect(dateError('toDate', 'The end date must not be before the start date.')).toBe('toBeforeFrom');
    expect(dateError('toDate', 'The range is at most 31 days.')).toBe('tooLong');
    expect(dateError('toDate', 'Bookings open up to 14 days ahead.')).toBe('toOutOfWindow');
    expect(dateError('toDate', 'Use a date like 2026-11-10.')).toBe('toRequired');
    expect(dateError('toDate', 'Something new')).toBe('dateInvalid');
    expect(dateError('fromDate', 'Something new')).toBe('dateInvalid');
  });

  it('parses the booking window and spots an out-of-window-only 400', () => {
    const named = { toDate: 'Bookings open up to 14 days ahead.' };
    const e = new ApiError(400, 'VALIDATION_FAILED', 'x', named);
    expect(windowDaysFromError(e)).toBe(14);
    expect(isOutOfWindow(e)).toBe(true);
    expect(isOutOfWindow(new ApiError(400, 'V', 'x', { ...named, 'client.email': 'bad' }))).toBe(false);
    expect(windowDaysFromError(new ApiError(400, 'V', 'x', { toDate: 'Bookings open further out.' }))).toBeUndefined();
    expect(classifyJoinError(new ApiError(400, 'V', 'x', { toDate: 'Something new' }))).toEqual({
      kind: 'failed',
      fields: { to: 'dateInvalid' },
      banner: 'fixFields',
    });
  });
});
