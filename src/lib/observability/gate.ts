import type { EventLike } from './scrub';

/** A stable key for "the same error": type, message and the top stack frame (already scrubbed). */
export function eventFingerprint(event: EventLike): string {
  const first = event.exception?.values?.[0];
  const frames = first?.stacktrace?.frames ?? [];
  const top = frames[frames.length - 1];
  return [
    first?.type ?? '',
    first?.value ?? event.message ?? '',
    top?.filename ?? '',
    top?.lineno ?? '',
    top?.colno ?? '',
    top?.function ?? '',
  ].join('|');
}

/**
 * Drops events identical to one already let through and caps how many get through at all.
 * Without `windowMs` the budget lasts for the life of the gate (a page load); with it, it resets every window.
 * Time is injected.
 */
export function createEventGate(opts: { maxEvents: number; windowMs?: number; now: () => number }) {
  let windowStart = opts.now();
  let sent = 0;
  let seen = new Set<string>();
  return {
    allow(fingerprint: string): boolean {
      const t = opts.now();
      if (opts.windowMs !== undefined && t - windowStart >= opts.windowMs) {
        windowStart = t;
        sent = 0;
        seen = new Set();
      }
      if (seen.has(fingerprint)) return false;
      if (sent >= opts.maxEvents) return false;
      seen.add(fingerprint);
      sent += 1;
      return true;
    },
  };
}
