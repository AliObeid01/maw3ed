import { resolveSentryConfig, serverObservabilityEnv } from '@/lib/observability/config';
import { NoQuery } from '@/server/contracts/reminders';
import { AppError } from '@/server/http/errors';
import { withRoute } from '@/server/http/withRoute';

export const dynamic = 'force-dynamic';

/**
 * Owner verification of error monitoring: a deliberate server error so one event shows up in Sentry.
 * Cron-secret guarded like the other job routes (401 without it), and 404 unless reporting is actually
 * active (a DSN in a Production deployment), so it is inert everywhere else. It does nothing but throw.
 */
export const POST = withRoute({ auth: 'cron', query: NoQuery }, () => {
  if (!resolveSentryConfig(serverObservabilityEnv()).enabled) throw AppError.notFound();
  throw new Error('Sentry test event (deliberate, from /api/jobs/sentry-test)');
});
