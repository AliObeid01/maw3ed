/**
 * Shared, SDK-free types for error reporting. The SDK is imported only by the instrumentation files and by
 * `src/server/observability/report.ts` / `src/lib/observability/clientReport.ts`, so tests inject a fake
 * `Reporter` and nothing in the test suite can reach the network.
 */
export type ReportLevel = 'info' | 'warning' | 'error';

/** Small, non-personal diagnostics. Becomes Sentry tags/extra after scrubbing. */
export interface ReportContext {
  /** Templated route (`/api/staff/[id]`), never the real URL. */
  route?: string;
  requestId?: string;
  /** Internal business id: not personal data. */
  businessId?: string;
  method?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface Reporter {
  error(error: unknown, ctx: ReportContext): void;
  message(level: ReportLevel, text: string, ctx: ReportContext): void;
}

export const noopReporter: Reporter = { error() {}, message() {} };
