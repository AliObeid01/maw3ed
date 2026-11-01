'use client';

import { IntlErrorCode, NextIntlClientProvider, type AbstractIntlMessages, type IntlError } from 'next-intl';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';

/**
 * A key missing from the messages this route group provides (F11) is a bug, not a translation gap.
 * - `next dev` and vitest (NODE_ENV is not "production"): throws, so the page or test fails loudly.
 * - Production (including the production build Playwright serves): logs a console error and the page shows
 *   the raw key, so a visitor never gets a crashed page. Nothing is reported to a service yet (a Sentry
 *   captureMessage is planned); the e2e `test` fixture (tests/e2e/helpers/test.ts) fails any spec that logs it.
 */
export function onIntlError(error: IntlError) {
  if (error.code === IntlErrorCode.MISSING_MESSAGE && process.env.NODE_ENV !== 'production') {
    throw error;
  }
  console.error(error);
}

/** Client side of `ScopedIntl`: functions (`onError`) cannot cross from a Server Component, so the provider lives here. */
export function IntlBoundary({
  locale,
  messages,
  timeZone,
  children,
}: {
  locale: Locale;
  messages: AbstractIntlMessages;
  timeZone: string;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
      onError={onIntlError}
    >
      {children}
    </NextIntlClientProvider>
  );
}
