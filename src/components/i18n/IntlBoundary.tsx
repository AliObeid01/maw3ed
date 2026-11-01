'use client';

import { IntlErrorCode, NextIntlClientProvider, type AbstractIntlMessages, type IntlError } from 'next-intl';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';

/**
 * A key missing from the messages this route group provides (F11) is a bug, not a translation gap: outside
 * production it throws so dev and the Playwright dashboard specs fail loudly instead of rendering raw keys.
 * In production it is logged and the key is shown, so a visitor never gets a crashed page.
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
