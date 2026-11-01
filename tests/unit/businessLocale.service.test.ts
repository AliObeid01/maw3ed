import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '@/server/domain/tokens';
import { createBusinessLocaleService } from '@/server/services/businessLocale';

const SECRET = 's'.repeat(40);
const NOW = new Date('2026-11-01T10:00:00Z');

/** Stand-in for React `cache` (which only memoises inside a server render): one Map per "request". */
function requestScopedMemo<F extends (arg: string | null | undefined) => Promise<string | undefined>>(
  fn: F,
): F {
  const seen = new Map<string | null | undefined, Promise<string | undefined>>();
  return ((arg) => {
    if (!seen.has(arg)) seen.set(arg, fn(arg));
    return seen.get(arg)!;
  }) as F;
}

const lookups = () => ({
  localeBySlug: vi.fn(async (slug: string) => (slug === 'nour' ? 'ar' : null)),
  localeByAppointment: vi.fn(async () => 'ar'),
  localeByOffer: vi.fn(async () => 'en'),
});
const env = { now: () => NOW, secret: () => SECRET };

describe('businessLocaleService.forPath', () => {
  it('two reads for one page in one request make one lookup', async () => {
    const l = lookups();
    const svc = createBusinessLocaleService(l, requestScopedMemo, env);
    expect(await svc.forPath('/b/nour')).toBe('ar');
    expect(await svc.forPath('/b/nour')).toBe('ar');
    expect(l.localeBySlug).toHaveBeenCalledTimes(1);
  });

  it('resolves a signed link through the appointment lookup, an offer through the offer lookup', async () => {
    const l = lookups();
    const svc = createBusinessLocaleService(l, requestScopedMemo, env);
    const exp = Math.floor(NOW.getTime() / 1000) + 3600;
    const link = signToken({ a: 'appt_1', act: 'view', exp }, SECRET);
    expect(await svc.forPath(`/l/${link}`)).toBe('ar');
    expect(l.localeByAppointment).toHaveBeenCalledWith('appt_1');
    const offer = signToken({ o: 'offer_1', act: 'claim', exp }, SECRET);
    expect(await svc.forPath(`/o/${offer}`)).toBe('en');
    expect(l.localeByOffer).toHaveBeenCalledWith('offer_1');
  });

  it('does not touch the database for non-public paths or a missing path header', async () => {
    const l = lookups();
    const svc = createBusinessLocaleService(l, requestScopedMemo, env);
    expect(await svc.forPath('/app/today')).toBeUndefined();
    expect(await svc.forPath(null)).toBeUndefined();
    expect(l.localeBySlug).not.toHaveBeenCalled();
  });
});

describe('src/i18n/request.ts resolution order', () => {
  const forPath = vi.fn();
  let jar: Record<string, string>;
  let pathHeader: string | null;

  beforeEach(() => {
    vi.resetModules();
    forPath.mockReset();
    jar = {};
    pathHeader = '/b/nour';
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ get: (k: string) => (k in jar ? { value: jar[k] } : undefined) }),
      headers: async () => ({ get: (k: string) => (k === 'x-maw3ed-path' ? pathHeader : null) }),
    }));
    vi.doMock('next-intl/server', () => ({
      getRequestConfig: (fn: () => Promise<unknown>) => fn,
    }));
    vi.doMock('@/server/services/businessLocale', () => ({ businessLocaleService: { forPath } }));
  });

  const run = async () => {
    const mod = await import('@/i18n/request');
    return (await (mod.default as unknown as () => Promise<{ locale: string }>)()).locale;
  };

  it('cookie beats hint beats business beats English', async () => {
    forPath.mockResolvedValue('ar');
    jar = { locale: 'en', locale_hint: 'ar' };
    expect(await run()).toBe('en');
    jar = { locale_hint: 'ar' };
    expect(await run()).toBe('ar');
    expect(forPath).not.toHaveBeenCalled();
    jar = {};
    expect(await run()).toBe('ar');
    expect(forPath).toHaveBeenCalledWith('/b/nour');
    forPath.mockResolvedValue(undefined);
    expect(await run()).toBe('en');
  });

  it('an invalid cookie value is ignored and falls through to the business', async () => {
    forPath.mockResolvedValue('ar');
    jar = { locale: 'fr' };
    expect(await run()).toBe('ar');
  });

  it('passes a missing path header through as null', async () => {
    pathHeader = null;
    forPath.mockResolvedValue(undefined);
    expect(await run()).toBe('en');
    expect(forPath).toHaveBeenCalledWith(null);
  });
});
