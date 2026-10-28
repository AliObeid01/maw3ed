import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale } from './config';

// No URL prefix: locale comes from the `locale` cookie, then the default.
// (`?lang=` is handled by the page/route that sets the cookie; it is not readable here.)
export default getRequestConfig(async () => {
  const stored = (await cookies()).get('locale')?.value;
  const locale = isLocale(stored) ? stored : defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
