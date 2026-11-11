'use client';

import { useMemo, useSyncExternalStore } from 'react';

/**
 * One shared clock for every "In 15 min" / "Free today" label on a page: a single interval for all subscribers,
 * started with the first one, stopped with the last, and paused while the tab is hidden (it catches up the moment
 * the tab is visible again). No per-card timers, nothing left running after unmount.
 */
type Doc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

export function createClock(periodMs: number, now: () => number = Date.now, doc?: Doc) {
  const page = (): Doc | undefined => doc ?? (typeof document === 'undefined' ? undefined : document);
  let current = now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();

  const tick = () => {
    current = now();
    listeners.forEach((l) => l());
  };
  const hidden = () => page()?.visibilityState === 'hidden';
  const start = () => {
    if (timer === undefined && !hidden()) timer = setInterval(tick, periodMs);
  };
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const onVisibility = () => {
    if (hidden()) stop();
    else {
      tick();
      start();
    }
  };

  return {
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        current = now(); // not a stale value from the last time anyone listened
        page()?.addEventListener('visibilitychange', onVisibility);
        start();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop();
          page()?.removeEventListener('visibilitychange', onVisibility);
        }
      };
    },
    snapshot: () => current,
  };
}

const minute = createClock(60_000);
// Date.now() at module load is only a safe server snapshot because every card's data is client-fetched, so no
// time-dependent label is ever server-rendered and hydration cannot mismatch. If cards are ever server-rendered,
// pass `now` from the server instead. (Left as is: a constant here would show wrong labels on the first client frame.)
const serverTime = Date.now();

/** The current time as a Date, re-rendering the caller every minute (shared timer, paused in a hidden tab). */
export function useNow(): Date {
  const ms = useSyncExternalStore(minute.subscribe, minute.snapshot, () => serverTime);
  return useMemo(() => new Date(ms), [ms]);
}
