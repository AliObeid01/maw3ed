'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLink, type LinkView } from '@/lib/api/links';
import { classifyLinkError } from '@/lib/links/state';
import { holdStillOpen } from '@/lib/myBookings/hold';
import { runPool } from '@/lib/myBookings/pool';
import { myBookings } from '@/lib/myBookings/storage';

/** At most this many link requests at once (the link endpoints are rate limited per address). */
export const LIVE_CONCURRENCY = 3;

/** A booking whose live state is not here yet is loading. */
export type Live = { phase: 'ready'; link: LinkView } | { phase: 'error' };

const CANCELLED = new Set(['CANCELLED', 'LATE_CANCEL']);
const OVER = new Set(['ATTENDED', 'NO_SHOW']);

/**
 * The current status of each upcoming booking, read with its own signed link (GET /api/links/{token}, no side
 * effects). Rules:
 * - up to LIVE_CONCURRENCY requests at a time; all aborted when the page closes;
 * - a link the server refuses (404 unknown, 410 expired, 403) is not an error for the visitor: the entry quietly
 *   moves to "Previous visits" (kept as a summary, flagged `ended: 'closed'`);
 * - a cancelled booking is shown as "Cancelled" for this page view (`pinned`) and is previous from the next visit on;
 * - a network failure keeps the saved summary and offers Retry.
 */
export function useLiveBookings(tokens: readonly string[]) {
  const [live, setLive] = useState<Record<string, Live>>({});
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());
  const controller = useRef<AbortController | null>(null);
  const requested = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  /** Record what a link says now (also used after Confirm / Cancel). */
  const apply = useCallback((token: string, link: LinkView) => {
    const status = link.appointment.status;
    // Paid, cancelled or released: the pay token and the countdown are no longer wanted on this device.
    if (!holdStillOpen(status)) myBookings.clearHold(token);
    if (CANCELLED.has(status)) {
      setPinned((p) => new Set(p).add(token));
      // After the render that shows "Cancelled": from the next visit the entry is under "Previous visits".
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        myBookings.markEnded(token, 'cancelled');
      }, 0);
      timers.current.add(timer);
    } else if (OVER.has(status)) {
      // Never show an outcome and never leave the card on its skeleton: file it under previous at once.
      myBookings.markEnded(token, 'closed');
      return;
    }
    setLive((l) => ({ ...l, [token]: { phase: 'ready', link } }));
  }, []);

  const fetchTokens = useCallback(
    (list: readonly string[]) => {
      const c = controller.current;
      if (!c) return;
      const todo = list.filter((token) => !requested.current.has(token));
      if (todo.length === 0) return;
      for (const token of todo) requested.current.add(token);
      void runPool(
        todo.map((token) => async () => {
          try {
            apply(token, await getLink(token, c.signal));
          } catch (error) {
            if (c.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
            const kind = classifyLinkError(error);
            if (kind === 'invalid' || kind === 'expired' || kind === 'wrongAction') {
              myBookings.markEnded(token, 'closed');
            } else {
              setLive((l) => ({ ...l, [token]: { phase: 'error' } }));
            }
          }
        }),
        LIVE_CONCURRENCY,
        c.signal,
      );
    },
    [apply],
  );

  const key = tokens.join('\n');
  const latest = useRef(tokens);
  useEffect(() => {
    latest.current = tokens;
  });

  // Open the pool when the page opens, close it (abort everything) when it closes.
  useEffect(() => {
    const c = new AbortController();
    const seen = requested.current;
    const pending = timers.current;
    controller.current = c;
    fetchTokens(latest.current);
    return () => {
      c.abort();
      seen.clear();
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
      controller.current = null;
    };
  }, [fetchTokens]);

  // A booking saved in another tab appears while this page is open.
  useEffect(() => {
    fetchTokens(latest.current);
  }, [key, fetchTokens]);

  const retry = useCallback(
    (token: string) => {
      requested.current.delete(token);
      setLive((l) => {
        const next = { ...l };
        delete next[token];
        return next;
      });
      fetchTokens([token]);
    },
    [fetchTokens],
  );

  return { live, pinned, apply, retry };
}
