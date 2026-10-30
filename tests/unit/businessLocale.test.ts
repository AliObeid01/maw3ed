import { describe, expect, it } from 'vitest';
import { pickLocale } from '@/i18n/config';
import { signToken } from '@/server/domain/tokens';
import {
  parseLocaleScope,
  resolveBusinessLocale,
  type BusinessLocaleDeps,
} from '@/server/i18n/businessLocale';

const SECRET = 's'.repeat(40);
const NOW = new Date('2026-11-01T10:00:00Z');
const exp = Math.floor(NOW.getTime() / 1000) + 3600;

const deps = (over: Partial<BusinessLocaleDeps> = {}): BusinessLocaleDeps => ({
  now: () => NOW,
  secret: () => SECRET,
  localeBySlug: async (slug) => (slug === 'nour' ? 'ar' : null),
  localeByAppointment: async (id) => (id === 'appt_1' ? 'ar' : null),
  localeByOffer: async (id) => (id === 'offer_1' ? 'ar' : null),
  ...over,
});

describe('parseLocaleScope', () => {
  it('only recognises /b/<slug>, /l/<token> and /o/<token>', () => {
    expect(parseLocaleScope('/b/nour')).toEqual({ kind: 'slug', slug: 'nour' });
    expect(parseLocaleScope('/b/nour/waitlist')).toEqual({ kind: 'slug', slug: 'nour' });
    expect(parseLocaleScope('/l/abc.def')).toEqual({ kind: 'token', token: 'abc.def' });
    expect(parseLocaleScope('/o/abc.def/leave')).toEqual({ kind: 'token', token: 'abc.def' });
    expect(parseLocaleScope('/app/today')).toBeUndefined();
    expect(parseLocaleScope('/b/Bad Slug')).toBeUndefined();
    expect(parseLocaleScope('/l/not-a-token')).toBeUndefined();
    expect(parseLocaleScope(null)).toBeUndefined();
  });
});

describe('resolveBusinessLocale (F14)', () => {
  it('resolves the business language from the slug', async () => {
    expect(await resolveBusinessLocale('/b/nour', deps())).toBe('ar');
    expect(await resolveBusinessLocale('/b/unknown', deps())).toBeUndefined();
  });

  it('resolves it from a signed appointment link and from an offer link', async () => {
    const link = signToken({ a: 'appt_1', act: 'view', exp }, SECRET);
    const offer = signToken({ o: 'offer_1', act: 'claim', exp }, SECRET);
    const leave = signToken({ o: 'offer_1', act: 'leave', exp }, SECRET);
    expect(await resolveBusinessLocale(`/l/${link}`, deps())).toBe('ar');
    expect(await resolveBusinessLocale(`/o/${offer}`, deps())).toBe('ar');
    expect(await resolveBusinessLocale(`/o/${leave}/leave`, deps())).toBe('ar');
  });

  it('ignores forged, expired and unknown tokens, and never throws', async () => {
    const forged = signToken({ a: 'appt_1', act: 'view', exp }, 'x'.repeat(40));
    const expired = signToken({ a: 'appt_1', act: 'view', exp: exp - 7200 }, SECRET);
    const unknown = signToken({ a: 'appt_9', act: 'view', exp }, SECRET);
    expect(await resolveBusinessLocale(`/l/${forged}`, deps())).toBeUndefined();
    expect(await resolveBusinessLocale(`/l/${expired}`, deps())).toBeUndefined();
    expect(await resolveBusinessLocale(`/l/${unknown}`, deps())).toBeUndefined();
    const boom = deps({
      localeBySlug: async () => {
        throw new Error('db down');
      },
    });
    expect(await resolveBusinessLocale('/b/nour', boom)).toBeUndefined();
    expect(await resolveBusinessLocale('/b/nour', deps({ secret: () => undefined }))).toBe('ar');
  });
});

describe('pickLocale order with a server-resolved business language', () => {
  it('cookie > hint > business > English', () => {
    expect(pickLocale('en', 'ar', 'ar')).toBe('en');
    expect(pickLocale(undefined, 'en', 'ar')).toBe('en');
    expect(pickLocale(undefined, undefined, 'ar')).toBe('ar');
    expect(pickLocale(undefined, undefined, undefined)).toBe('en');
  });
});
