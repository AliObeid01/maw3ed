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
/** Session cookie (path-scoped to /b and /l) carrying the business's default language for visitors who never chose one. */
export const LOCALE_HINT_COOKIE = 'locale_hint';

/** Resolution order: the visitor's own choice, then the business default (public pages), then English. */
export function pickLocale(stored: string | undefined, hint?: string): Locale {
  if (isLocale(stored)) return stored;
  if (isLocale(hint)) return hint;
  return defaultLocale;
}
