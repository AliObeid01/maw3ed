import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { businessLocaleService } from '@/server/services/businessLocale';
import { LOCALE_COOKIE, LOCALE_HINT_COOKIE, PATH_HEADER, isLocale, pickLocale } from './config';

// No URL prefix. Order: the `locale` cookie (set by the toggle or by `?lang=` in src/proxy.ts), then the
// client hint cookie, then the business default resolved on the SERVER for /b/<slug>, /l/<token> and
// /o/<token> (so the first visit renders once, in the right language), then English.
// The lookup lives in a service (layering) and is memoised per request.
export default getRequestConfig(async () => {
  const jar = await cookies();
  const stored = jar.get(LOCALE_COOKIE)?.value;
  const hint = jar.get(LOCALE_HINT_COOKIE)?.value;
  const business =
    isLocale(stored) || isLocale(hint)
      ? undefined
      : await businessLocaleService.forPath((await headers()).get(PATH_HEADER));
  const locale = pickLocale(stored, hint, business);
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
