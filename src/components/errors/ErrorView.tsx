'use client';

import { useSyncExternalStore } from 'react';
import { Logo } from '@/components/brand/Logo';
import { PageState } from '@/components/public/PageState';
import { buttonClasses } from '@/components/ui/buttonStyles';
import type { Locale } from '@/i18n/config';
import { ERROR_PAGE, pickErrorLocale } from '@/i18n/errorPage';

const subscribe = () => () => {};

/**
 * The visitor's language, read from cookies in the browser. The server snapshot is English, so hydration
 * matches and React then switches to the real value (no provider exists in global-error).
 */
export function useErrorLocale(): Locale {
  return useSyncExternalStore(
    subscribe,
    () => pickErrorLocale(document.cookie),
    () => 'en' as const,
  );
}

/**
 * Branded crash card: what happened (no technical detail), try again, and a way home.
 * Deliberately light: the error boundary ships with every page, so it uses an inline icon and the plain button
 * classes instead of lucide-react, the Button component and next/link (measured: +16 KB gzip first load otherwise).
 */
export function ErrorView({ locale, onRetry }: { locale: Locale; onRetry: () => void }) {
  const s = ERROR_PAGE[locale];
  // A plain link on purpose: a full page load starts clean after a crash, and next/link would add ~14 KB to every page.
  const home = (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/" className={buttonClasses({ variant: 'secondary', size: 'lg', block: true })}>
      {s.home}
    </a>
  );
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="px-4 pt-6 md:px-8">
        <Logo width={120} />
      </div>
      <PageState
        role="alert"
        tone="warning"
        icon={
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        }
        title={s.title}
        body={s.body}
        action={
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={onRetry}
              className={buttonClasses({ size: 'lg', block: true })}
            >
              {s.retry}
            </button>
            {home}
          </div>
        }
      />
    </div>
  );
}
