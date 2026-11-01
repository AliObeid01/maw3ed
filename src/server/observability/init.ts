import {
  buildSentryOptions,
  resolveSentryConfig,
  serverObservabilityEnv,
} from '@/lib/observability/config';
import { markActive } from './report';

/** The slice of the SDK the server needs. Loaded by `src/instrumentation.ts` only when reporting is on. */
export type ServerSdk = Pick<
  typeof import('@sentry/nextjs'),
  | 'init'
  | 'onUncaughtExceptionIntegration'
  | 'onUnhandledRejectionIntegration'
  | 'linkedErrorsIntegration'
  | 'dedupeIntegration'
>;

/** Per instance: identical events are dropped for a minute, and at most 100 events per minute leave it. */
const SERVER_GATE = { maxEvents: 100, windowMs: 60_000 };

/**
 * Initialise server-side error reporting, or do nothing. Without a DSN in a production deployment this
 * returns 'inert' before loading the SDK: no network, no console output, no failure. It never throws.
 */
export async function initServerSentry(
  source: Record<string, string | undefined>,
  loadSdk: () => Promise<ServerSdk>,
  now: () => number = () => Date.now(),
): Promise<'inert' | 'enabled' | 'failed'> {
  const config = resolveSentryConfig(serverObservabilityEnv(source));
  if (!config.enabled) return 'inert';
  try {
    const sdk = await loadSdk();
    sdk.init({
      ...buildSentryOptions(config, { ...SERVER_GATE, now }),
      // Errors only. No default integrations (no http/fs/db instrumentation, no context collection),
      // and the SDK does not take over OpenTelemetry (Next.js keeps its own).
      defaultIntegrations: false,
      enableOpenTelemetrySetup: false,
      integrations: [
        // Never exit the process or print warnings on our behalf: Next.js and the platform own that.
        sdk.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
        sdk.onUnhandledRejectionIntegration({ mode: 'none' }),
        sdk.linkedErrorsIntegration(),
        sdk.dedupeIntegration(),
      ],
    });
    markActive();
    return 'enabled';
  } catch {
    return 'failed';
  }
}
