import { noopReporter, type ReportContext, type ReportLevel, type Reporter } from './report';

/**
 * Browser side of error reporting. Components call these; they never import the SDK. `instrumentation-client.ts`
 * installs the real reporter once the SDK has loaded (only when a DSN is configured in production). With no
 * reporter every call is a no-op, so the feature is inert without a DSN.
 *
 * Reports that happen while the SDK chunk is still loading are queued (bounded) and replayed.
 */
type Pending = (r: Reporter) => void;

const MAX_PENDING = 20;
let reporter: Reporter = noopReporter;
let waiting = false;
let pending: Pending[] = [];
const sentOnce = new Set<string>();

/** Called by instrumentation-client when reporting is enabled and the SDK is about to load. */
export function expectClientReporter(): void {
  waiting = true;
}

export function setClientReporter(next: Reporter): void {
  reporter = next;
  waiting = false;
  const queued = pending;
  pending = [];
  for (const run of queued) run(next);
}

/** Tests: back to the inert state. */
export function resetClientReporting(): void {
  reporter = noopReporter;
  waiting = false;
  pending = [];
  sentOnce.clear();
}

function dispatch(run: Pending): void {
  try {
    if (reporter !== noopReporter) run(reporter);
    else if (waiting && pending.length < MAX_PENDING) pending.push(run);
  } catch {
    /* reporting never breaks the page */
  }
}

export function reportClientError(error: unknown, ctx: ReportContext = {}): void {
  dispatch((r) => r.error(error, ctx));
}

export function reportClientMessage(
  level: ReportLevel,
  text: string,
  ctx: ReportContext = {},
): void {
  dispatch((r) => r.message(level, text, ctx));
}

/** One report per distinct `dedupeKey` per page load. */
export function reportClientMessageOnce(
  dedupeKey: string,
  level: ReportLevel,
  text: string,
  ctx: ReportContext = {},
): void {
  if (sentOnce.has(dedupeKey)) return;
  if (sentOnce.size >= 200) return; // a runaway render loop cannot grow this without bound
  sentOnce.add(dedupeKey);
  reportClientMessage(level, text, ctx);
}
