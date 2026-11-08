'use client';

import { useEffect, useRef } from 'react';
import { getOutcome } from '@/lib/api/links';
import { OUTCOME_CONCURRENCY, outcomeTodo } from '@/lib/myBookings/outcome';
import { runPool } from '@/lib/myBookings/pool';
import { myBookings, type SavedBooking } from '@/lib/myBookings/storage';

/**
 * Asks, once per previous visit, whether the business marked it attended, and keeps the answer in the saved entry
 * (`completed` for good, otherwise the check time so it waits 6 hours). Rules live in `lib/myBookings/outcome.ts`.
 * - at most 3 requests at once; everything is aborted when the page closes (not when an answer changes the list);
 * - any failure (404, 429, network) is silent and also waits out the cooldown: no retry loop;
 * - each token is asked at most once per page view.
 */
export function useOutcomes(past: readonly SavedBooking[], now: Date) {
  const asked = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ past, now });
  useEffect(() => {
    latest.current = { past, now };
  });
  const key = outcomeTodo(past, now).join('\n');

  // One controller for the life of the page.
  useEffect(() => {
    const c = new AbortController();
    const seen = asked.current;
    controller.current = c;
    return () => {
      c.abort();
      seen.clear();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    const c = controller.current;
    if (!c) return;
    const todo = outcomeTodo(latest.current.past, latest.current.now).filter((t) => !asked.current.has(t));
    if (todo.length === 0) return;
    for (const token of todo) asked.current.add(token);
    void runPool(
      todo.map((token) => async () => {
        try {
          const { completed } = await getOutcome(token, c.signal);
          if (!c.signal.aborted) myBookings.markOutcome(token, completed);
        } catch (error) {
          if (c.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
          myBookings.markOutcome(token, false); // 404, 429, network: note the time only, retry after the cooldown
        }
      }),
      OUTCOME_CONCURRENCY,
      c.signal,
    );
  }, [key]);
}
