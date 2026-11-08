'use client';

import { useEffect, useState } from 'react';

/** How often an open page re-reads the clock (a booking that starts meanwhile moves to "Previous visits"). */
export const NOW_TICK_MS = 60_000;

/**
 * The current time, refreshed every minute while the page is visible and at once when a hidden or sleeping tab
 * becomes visible again. The first render uses one fixed instant (no `Date.now()` per render).
 */
export function useNow(tickMs: number = NOW_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, tickMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tickMs]);
  return now;
}
