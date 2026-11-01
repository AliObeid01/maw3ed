import type { ReportContext, ReportLevel, Reporter } from '@/lib/observability/report';
import { isNoiseEvent } from '@/lib/observability/scrub';
import { afterResponse } from '@/server/http/afterResponse';
import type { MappedError } from '@/server/http/errors';

/**
 * The only server code that talks to the error service. Everything goes through `reportError` /
 * `reportMessage`; tests replace the reporter with `setReporter(fake)`, so no test reaches the network.
 *
 * Inert unless `instrumentation.ts` initialised the SDK (a DSN in a production deployment): `markActive()`
 * sets a process-wide flag (a global, because the instrumentation bundle and the route bundles do not share
 * module instances), and until then the default reporter does nothing, not even load the SDK.
 */
const FLAG = '__maw3edSentryActive';

export function markActive(): void {
  (globalThis as Record<string, unknown>)[FLAG] = true;
}
export function isActive(): boolean {
  return (globalThis as Record<string, unknown>)[FLAG] === true;
}

const tags = (ctx: ReportContext): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) if (v !== undefined) out[k] = String(v).slice(0, 200);
  return out;
};

/** Run SDK work after the response (so the answer is not delayed) and flush before the function freezes. */
function withSdk(work: (sdk: typeof import('@sentry/nextjs')) => void): void {
  if (!isActive()) return;
  void afterResponse(async () => {
    try {
      const sdk = await import('@sentry/nextjs');
      work(sdk);
      await sdk.flush(2000);
    } catch {
      /* reporting must never break a request */
    }
  });
}

const sdkReporter: Reporter = {
  error(error, ctx) {
    withSdk((sdk) =>
      sdk.withScope((scope) => {
        scope.setTags(tags(ctx));
        sdk.captureException(error);
      }),
    );
  },
  message(level, text, ctx) {
    withSdk((sdk) =>
      sdk.withScope((scope) => {
        scope.setTags(tags(ctx));
        sdk.captureMessage(text, level);
      }),
    );
  },
};

let reporter: Reporter | undefined;

/** Tests inject a fake; `undefined` restores the SDK-backed default. */
export function setReporter(next: Reporter | undefined): void {
  reporter = next;
}

export function reportError(error: unknown, ctx: ReportContext = {}): void {
  try {
    (reporter ?? sdkReporter).error(error, ctx);
  } catch {
    /* never throws */
  }
}

export function reportMessage(level: ReportLevel, text: string, ctx: ReportContext = {}): void {
  try {
    (reporter ?? sdkReporter).message(level, text, ctx);
  } catch {
    /* never throws */
  }
}

/**
 * Only unexpected failures are worth a report: a non-AppError (500) or a 5xx AppError. 4xx (validation,
 * auth, not found, conflicts, rate limits), load shedding (SERVICE_BUSY) and control-flow errors are not.
 */
export function isReportable(
  mapped: Pick<MappedError, 'status' | 'unexpected' | 'body'>,
  error: unknown,
): boolean {
  if (!mapped.unexpected && mapped.status < 500) return false;
  if (mapped.body.error.code === 'SERVICE_BUSY') return false;
  const e = (error ?? {}) as { name?: unknown; message?: unknown; digest?: unknown };
  return !isNoiseEvent({
    exception: {
      values: [
        {
          type: typeof e.name === 'string' ? e.name : undefined,
          value: typeof e.message === 'string' ? e.message : String(error),
          ...(typeof e.digest === 'string' ? { digest: e.digest } : {}),
        },
      ],
    },
  });
}
