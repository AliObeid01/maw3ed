import type { SentryConfig } from './enabled';
import { createEventGate, eventFingerprint } from './gate';
import { beforeBreadcrumb, beforeSend, type EventLike } from './scrub';

export * from './enabled';

/** Control-flow and browser noise, also listed for the SDK besides the explicit checks in `scrub.ts`. */
export const IGNORE_ERRORS: (string | RegExp)[] = [
  /ResizeObserver loop/,
  /Non-Error promise rejection captured/,
  /NEXT_REDIRECT/,
  /NEXT_NOT_FOUND/,
  /NEXT_HTTP_ERROR_FALLBACK/,
  /AbortError/,
  'The user aborted a request.',
];

export interface GateOptions {
  maxEvents: number;
  windowMs?: number;
  now: () => number;
}

/**
 * The options both runtimes share. Errors only: no tracing, no profiling, no replay, no PII, no client reports.
 * `beforeSend` scrubs, drops noise, dedupes identical events and caps the volume.
 */
export function buildSentryOptions(
  config: Extract<SentryConfig, { enabled: true }>,
  gate: GateOptions,
) {
  const events = createEventGate(gate);
  return {
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),
    sendDefaultPii: false,
    sampleRate: 1,
    tracesSampleRate: 0,
    attachStacktrace: true,
    maxBreadcrumbs: 20,
    sendClientReports: false,
    ignoreErrors: IGNORE_ERRORS,
    beforeBreadcrumb,
    beforeSend<T extends EventLike>(event: T): T | null {
      const out = beforeSend(event);
      if (!out) return null;
      try {
        return events.allow(eventFingerprint(out)) ? out : null;
      } catch {
        return null;
      }
    },
  };
}
