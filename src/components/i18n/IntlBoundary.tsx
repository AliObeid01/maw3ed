'use client';

import { IntlErrorCode, NextIntlClientProvider, type AbstractIntlMessages, type IntlError } from 'next-intl';
import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import { reportClientMessageOnce } from '@/lib/observability/clientReport';

/** `Could not resolve \`booking.title\` in messages for locale \`en\`` -> the key path and locale, nothing else. */
function describeIntlError(error: IntlError) {
  const message = typeof error.message === 'string' ? error.message : '';
  const path = /`([A-Za-z0-9_.-]{1,120})`/.exec(message)?.[1];
  const locale = /locale `([A-Za-z-]{2,10})`/.exec(message)?.[1];
  const cut = path ? path.lastIndexOf('.') : -1;
  return {
    path,
    ctx: {
      code: String(error.code),
      ...(path ? { namespace: cut === -1 ? '' : path.slice(0, cut), key: path.slice(cut + 1) } : {}),
      ...(locale ? { locale } : {}),
    },
  };
}

/**
 * A key missing from the messages this route group provides (F11) is a bug, not a translation gap.
 * - `next dev` and vitest (NODE_ENV is not "production"): throws, so the page or test fails loudly.
 * - Production (including the production build Playwright serves): logs a console error and the page shows
 *   the raw key, so a visitor never gets a crashed page. It is also reported once per distinct key per page
 *   load (a `warning` message with only the code, key path and locale; no user data) when error monitoring is
 *   on. The e2e `test` fixture (tests/e2e/helpers/test.ts) fails any spec that logs it, so a hole is caught in CI first.
 */
export function onIntlError(error: IntlError) {
  if (error.code === IntlErrorCode.MISSING_MESSAGE && process.env.NODE_ENV !== 'production') {
    throw error;
  }
  console.error(error);
  const { path, ctx } = describeIntlError(error);
  reportClientMessageOnce(
    `${ctx.code}|${ctx.locale ?? ''}|${path ?? ''}`,
    'warning',
    'i18n missing message',
    ctx,
  );
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
