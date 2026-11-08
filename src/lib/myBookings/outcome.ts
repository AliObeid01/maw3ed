import type { SavedBooking } from './storage';

/** The outcome link works for 90 days after the start (same window the saved entry itself is kept). */
export const OUTCOME_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** A visit that was NOT completed (or whose check failed) is asked about again after this long, never sooner. */
export const OUTCOME_RECHECK_MS = 6 * 60 * 60 * 1000;
/** At most this many outcome requests at once (the endpoint has its own per-address limit). */
export const OUTCOME_CONCURRENCY = 3;

/**
 * Whether to ask the server if this previous visit was completed.
 * - never for a visit that has not started, or started more than 90 days ago;
 * - never again once `completed` is true (cached permanently);
 * - never for a booking the visitor cancelled;
 * - otherwise at most once per 6 hours: attended can be marked later, so a "not completed" answer is only provisional.
 * A failed check (404, 429, network) records the same time, so it waits out the same cooldown.
 */
export function shouldCheckOutcome(entry: SavedBooking, now: Date): boolean {
  if (entry.completed) return false;
  if (entry.ended === 'cancelled') return false;
  const age = now.getTime() - Date.parse(entry.startAt);
  if (!(age > 0) || age > OUTCOME_WINDOW_MS) return false;
  if (entry.outcomeCheckedAt) {
    const since = now.getTime() - Date.parse(entry.outcomeCheckedAt);
    if (!(since >= OUTCOME_RECHECK_MS)) return false; // includes a time in the future
  }
  return true;
}

/** The tokens to ask about: newest visit first, each once. */
export function outcomeTodo(entries: readonly SavedBooking[], now: Date): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const newestFirst = [...entries].sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  for (const entry of newestFirst) {
    if (seen.has(entry.token) || !shouldCheckOutcome(entry, now)) continue;
    seen.add(entry.token);
    out.push(entry.token);
  }
  return out;
}
