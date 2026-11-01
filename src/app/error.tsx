'use client';

import { useEffect } from 'react';
import { ErrorView, useErrorLocale } from '@/components/errors/ErrorView';
import { reportClientError } from '@/lib/observability/clientReport';

/** A render error in any page: branded, bilingual, no technical detail; the root layout (html, fonts) stays. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useErrorLocale();
  useEffect(() => {
    // An error with a digest happened on the server and was already reported there (onRequestError).
    if (!error.digest) reportClientError(error, { boundary: 'route' });
  }, [error]);
  return <ErrorView locale={locale} onRetry={reset} />;
}
