import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { defaultLocale, isLocale } from '@/i18n/config';
import { namespacesFor, pickMessages, type IntlScope } from '@/i18n/scopes';
import { DEFAULT_TIMEZONE } from '@/lib/auth/timezones';
import { IntlBoundary } from './IntlBoundary';

/**
 * The i18n provider for one route group: only the namespaces that group's Client Components use (F11) and
 * the time zone client-side formatting falls back to (F5). Pass the business zone where the server knows
 * the business (the dashboard); elsewhere the business loads in the browser and its formatters pass the
 * zone explicitly, so the fallback is the product default and never the visitor's device zone.
 */
export async function ScopedIntl({
  scope,
  timeZone = DEFAULT_TIMEZONE,
  children,
}: {
  scope: IntlScope;
  timeZone?: string;
  children: ReactNode;
}) {
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : defaultLocale;
  const messages = pickMessages(await getMessages(), namespacesFor(scope));
  return (
    <IntlBoundary locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </IntlBoundary>
  );
}
