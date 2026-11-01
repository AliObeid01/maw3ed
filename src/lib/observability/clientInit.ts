import { expectClientReporter, setClientReporter } from './clientReport';
import { resolveSentryConfig, type ObservabilityEnv } from './enabled';
import type { Reporter } from './report';

/** The slice of the SDK the browser needs. Loaded lazily by `instrumentation-client.ts`, never imported here. */
export type ClientSdk = Pick<
  typeof import('@sentry/nextjs'),
  | 'init'
  | 'captureException'
  | 'captureMessage'
  | 'withScope'
  | 'globalHandlersIntegration'
  | 'linkedErrorsIntegration'
  | 'dedupeIntegration'
  | 'breadcrumbsIntegration'
  | 'consoleIntegration'
>;

interface WindowLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural stand-in for Window
  addEventListener(type: string, handler: (event: any) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, handler: (event: any) => void): void;
}

/** At most this many events per page load leave the browser. */
export const CLIENT_EVENT_CAP = 50;
const EARLY_BUFFER = 10;

const stringTags = (ctx: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) if (v !== undefined) out[k] = String(v).slice(0, 200);
  return out;
};

export function sdkReporter(
  sdk: Pick<ClientSdk, 'captureException' | 'captureMessage' | 'withScope'>,
): Reporter {
  return {
    error: (error, ctx) =>
      sdk.withScope((scope) => {
        scope.setTags(stringTags(ctx));
        sdk.captureException(error);
      }),
    message: (level, text, ctx) =>
      sdk.withScope((scope) => {
        scope.setTags(stringTags(ctx));
        sdk.captureMessage(text, level);
      }),
  };
}

/**
 * Start browser error reporting. Returns synchronously:
 * - 'inert': no DSN, or not a production deployment. Nothing is loaded, listened to or sent.
 * - 'loading': the SDK chunk is being fetched (after startup, outside the first-load bundle). Errors raised
 *   meanwhile are buffered (bounded) and replayed once it is ready.
 */
export function initClientSentry(opts: {
  env: ObservabilityEnv;
  loadSdk: () => Promise<ClientSdk>;
  win: WindowLike;
  now: () => number;
}): 'inert' | 'loading' {
  const config = resolveSentryConfig(opts.env);
  if (!config.enabled) return 'inert';

  expectClientReporter();
  const early: unknown[] = [];
  const onError = (e: { error?: unknown; message?: unknown }) => {
    if (early.length < EARLY_BUFFER) early.push(e.error ?? e.message);
  };
  const onRejection = (e: { reason?: unknown }) => {
    if (early.length < EARLY_BUFFER) early.push(e.reason);
  };
  opts.win.addEventListener('error', onError as never);
  opts.win.addEventListener('unhandledrejection', onRejection as never);
  const stopEarly = () => {
    opts.win.removeEventListener('error', onError as never);
    opts.win.removeEventListener('unhandledrejection', onRejection as never);
  };

  // The options (and the scrubber they carry) load with the SDK, not with the page.
  Promise.all([opts.loadSdk(), import('./config')]).then(
    ([sdk, { buildSentryOptions }]) => {
      try {
        sdk.init({
          ...buildSentryOptions(config, { maxEvents: CLIENT_EVENT_CAP, now: opts.now }),
          // Errors only: the SDK's defaults (tracing, replay hooks, http context, feedback) stay out.
          defaultIntegrations: false,
          integrations: [
            sdk.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
            sdk.linkedErrorsIntegration(),
            sdk.dedupeIntegration(),
            // Breadcrumbs: navigation (history) and console output only; beforeBreadcrumb keeps console errors, no data.
            sdk.breadcrumbsIntegration({
              dom: false,
              fetch: false,
              history: true,
              xhr: false,
              sentry: false,
            }),
            sdk.consoleIntegration(),
          ],
        });
        stopEarly();
        const reporter = sdkReporter(sdk);
        for (const error of early) reporter.error(error, { source: 'early' });
        early.length = 0;
        setClientReporter(reporter);
      } catch {
        stopEarly();
      }
    },
    () => stopEarly(),
  );
  return 'loading';
}
