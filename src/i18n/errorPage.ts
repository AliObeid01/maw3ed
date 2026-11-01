import { LOCALE_COOKIE, LOCALE_HINT_COOKIE, pickLocale, type Locale } from './config';

/**
 * Copy for the crash pages (`src/app/error.tsx`, `src/app/global-error.tsx`). Deliberately a static
 * dictionary, not `messages/*.json`: `global-error` replaces the root layout, so there is no intl provider
 * (and no messages) there, and a crash page must not depend on the machinery that may have crashed.
 * Two languages, same tone as `notFound`. No stack trace or error text is ever shown to a visitor.
 */
export interface ErrorPageStrings {
  title: string;
  body: string;
  retry: string;
  home: string;
}

export const ERROR_PAGE: Record<Locale, ErrorPageStrings> = {
  en: {
    title: 'Something went wrong',
    body: 'We could not show this page. Try again, or head back to the start.',
    retry: 'Try again',
    home: 'Go to Maw3ed',
  },
  ar: {
    title: 'حدث خطأ ما',
    body: 'تعذّر عرض هذه الصفحة. حاول مرة أخرى أو عد إلى الصفحة الرئيسية.',
    retry: 'حاول مجددًا',
    home: 'الانتقال إلى موعد',
  },
};

function cookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** The visitor's language from the `document.cookie` string: their own choice, then the hint, then English. */
export function pickErrorLocale(cookieHeader: string): Locale {
  try {
    return pickLocale(
      cookieValue(cookieHeader, LOCALE_COOKIE),
      cookieValue(cookieHeader, LOCALE_HINT_COOKIE),
    );
  } catch {
    return 'en';
  }
}
