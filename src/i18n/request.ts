import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, LOCALE_HINT_COOKIE, pickLocale } from './config';

// No URL prefix. Order: the `locale` cookie (set by the toggle or by `?lang=` in src/proxy.ts), then the
// business-default hint on public pages, then English.
export default getRequestConfig(async () => {
  const jar = await cookies();
  const locale = pickLocale(jar.get(LOCALE_COOKIE)?.value, jar.get(LOCALE_HINT_COOKIE)?.value);
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
