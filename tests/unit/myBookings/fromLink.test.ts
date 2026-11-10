import { describe, expect, it } from 'vitest';
import { canSaveLink, entryFromLink } from '@/lib/myBookings/fromLink';
import { parseStored } from '@/lib/myBookings/storage';
import type { LinkView } from '@/lib/api/links';

const NOW = new Date('2026-11-04T08:00:00Z');

const link = (over: Partial<LinkView['appointment']> = {}, act: LinkView['act'] = 'view'): LinkView => ({
  act,
  appointment: {
    id: 'a1',
    reference: 'ABC234',
    startAt: '2026-11-06T08:30:00.000Z',
    endAt: '2026-11-06T09:00:00.000Z',
    status: 'BOOKED',
    service: { id: 's1', name: 'Haircut', durationMin: 30, price: 15 },
    staff: { id: 'st1', displayName: 'Karim' },
    ...over,
  },
  business: { name: 'Studio Nour', slug: 'studio-nour', timezone: 'Asia/Beirut', locale: 'en' },
  canConfirm: true,
  canCancel: true,
  cancelCutoffAt: '2026-11-05T08:30:00.000Z',
  pastCutoff: false,
  confirmedAt: null,
});

const TOKEN = 'eyJhIjoxfQ.c2lnbmF0dXJl';

describe('entryFromLink', () => {
  it('maps the link to an entry with no client data', () => {
    const e = entryFromLink(link(), TOKEN, NOW);
    expect(e).toEqual({
      token: TOKEN,
      slug: 'studio-nour',
      businessName: 'Studio Nour',
      serviceName: 'Haircut',
      staffName: 'Karim',
      startAt: '2026-11-06T08:30:00.000Z',
      endAt: '2026-11-06T09:00:00.000Z',
      timezone: 'Asia/Beirut',
      reference: 'ABC234',
      savedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(e)).not.toMatch(/phone|email|\+961/i);
  });

  it('survives the storage validator unchanged (round trip)', () => {
    const e = entryFromLink(link(), TOKEN, NOW)!;
    expect(parseStored(JSON.stringify({ v: 1, entries: [e] }), NOW)).toEqual([e]);
  });

  it.each([
    ['a path', '../etc/passwd'],
    ['a scheme', 'https://evil.test/x'],
    ['spaces', 'tok en tok en'],
    ['html', '<script>alert(1)</script>'],
    ['too short', 'abc'],
    ['empty', ''],
  ])('refuses a hostile token (%s)', (_label, token) => {
    expect(entryFromLink(link(), token, NOW)).toBeUndefined();
  });

  it('refuses a hostile slug', () => {
    const bad = link();
    bad.business.slug = '../x';
    expect(entryFromLink(bad, TOKEN, NOW)).toBeUndefined();
  });

  it('drops a reference that is not a plain code', () => {
    const e = entryFromLink(link({ reference: 'a b<c>' }), TOKEN, NOW);
    expect(e?.reference).toBe('a b<c>'); // the mapper passes it on; the store validator is what drops it
    expect(parseStored(JSON.stringify({ v: 1, entries: [e] }), NOW)[0]?.reference ?? null).toBeNull();
  });

  it('only a view link can be saved (a confirm or cancel token cannot manage the booking later)', () => {
    expect(entryFromLink(link({}, 'confirm'), TOKEN, NOW)).toBeUndefined();
    expect(entryFromLink(link({}, 'cancel'), TOKEN, NOW)).toBeUndefined();
  });
});

describe('canSaveLink', () => {
  it('is true for an upcoming open booking on a view link', () => {
    expect(canSaveLink(link(), NOW)).toBe(true);
    expect(canSaveLink(link({ status: 'CONFIRMED' }), NOW)).toBe(true);
    expect(canSaveLink(link({ status: 'PENDING_PAYMENT' }), NOW)).toBe(true);
  });
  it('is false once cancelled', () => {
    expect(canSaveLink(link({ status: 'CANCELLED' }), NOW)).toBe(false);
    expect(canSaveLink(link({ status: 'LATE_CANCEL' }), NOW)).toBe(false);
  });
  it('is false for a past or finished booking', () => {
    expect(
      canSaveLink(link({ startAt: '2026-11-03T08:30:00.000Z', endAt: '2026-11-03T09:00:00.000Z' }), NOW),
    ).toBe(false);
    expect(canSaveLink(link({ status: 'ATTENDED' }), NOW)).toBe(false);
    expect(canSaveLink(link({ status: 'NO_SHOW' }), NOW)).toBe(false);
  });
  it('is false on confirm and cancel links', () => {
    expect(canSaveLink(link({}, 'confirm'), NOW)).toBe(false);
  });
});
