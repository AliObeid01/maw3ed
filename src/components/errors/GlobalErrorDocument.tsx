'use client';

import { dirFor, type Locale } from '@/i18n/config';
import { ErrorView } from './ErrorView';

/** The whole document for `global-error`, which replaces the root layout. Fonts and the stylesheet come from the page file. */
export function GlobalErrorDocument({
  locale,
  onRetry,
  className,
}: {
  locale: Locale;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <html lang={locale} dir={dirFor(locale)} className={className}>
      <body>
        <ErrorView locale={locale} onRetry={onRetry} />
      </body>
    </html>
  );
}
