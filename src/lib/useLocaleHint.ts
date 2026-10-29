'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isLocale, LOCALE_COOKIE, LOCALE_HINT_COOKIE } from '@/i18n/config';

const hasCookie = (name: string, value?: string) =>
  document.cookie
    .split(';')
    .map((c) => c.trim())
    .some((c) => (value === undefined ? c.startsWith(`${name}=`) : c === `${name}=${value}`));

/**
 * Applies the business's language as the default for a visitor who never picked one: writes a session
 * `locale_hint` cookie scoped to `scopePath` (`/b` or `/l`) and refreshes once. An explicit `locale` cookie
 * (the language toggle or `?lang=`) always wins, and the check for an existing hint prevents a refresh loop.
 */
export function useLocaleHint(businessLocale: string | undefined, scopePath: '/b' | '/l') {
  const current = useLocale();
  const router = useRouter();
  useEffect(() => {
    if (!isLocale(businessLocale) || businessLocale === current) return;
    if (hasCookie(LOCALE_COOKIE) || hasCookie(LOCALE_HINT_COOKIE, businessLocale)) return;
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_HINT_COOKIE}=${businessLocale}; path=${scopePath}; samesite=lax${secure}`;
    router.refresh();
  }, [businessLocale, current, router, scopePath]);
}
