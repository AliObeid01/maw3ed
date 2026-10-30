export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'ar';
}

export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Cookie written by the language toggle and `?lang=`: an explicit choice that always wins. */
export const LOCALE_COOKIE = 'locale';
/** Session cookie (path-scoped to the one business page it was learned on) carrying the business's default language for visitors who never chose one. */
export const LOCALE_HINT_COOKIE = 'locale_hint';

/** Resolution order: the visitor's own choice, then the client hint, then the business default resolved on the server (public pages), then English. */
export function pickLocale(stored: string | undefined, hint?: string, business?: string): Locale {
  if (isLocale(stored)) return stored;
  if (isLocale(hint)) return hint;
  if (isLocale(business)) return business;
  return defaultLocale;
}

/** Request header the proxy sets to the page path, so the server can resolve the business language (F14). */
export const PATH_HEADER = 'x-maw3ed-path';
