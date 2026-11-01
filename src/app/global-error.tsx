'use client';

import { useEffect } from 'react';
import { GlobalErrorDocument } from '@/components/errors/GlobalErrorDocument';
import { useErrorLocale } from '@/components/errors/ErrorView';
import { reportClientError } from '@/lib/observability/clientReport';
import { outfit, plexArabic } from './fonts';
import './globals.css';

/**
 * Last resort: an error in the root layout itself. It replaces the whole document, so it brings its own
 * `<html>`, fonts and styles, and its copy comes from a static dictionary (no intl provider exists here).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useErrorLocale();
  useEffect(() => {
    // An error with a digest happened on the server and was already reported there (onRequestError).
    if (!error.digest) reportClientError(error, { boundary: 'global' });
  }, [error]);
  return (
    <GlobalErrorDocument
      locale={locale}
      onRetry={reset}
      className={`${outfit.variable} ${plexArabic.variable}`}
    />
  );
}
