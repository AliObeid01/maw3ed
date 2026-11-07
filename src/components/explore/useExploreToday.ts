'use client';

import { useEffect, useState } from 'react';
import { msUntilNextDay, todayIn } from '@/lib/directory/explore';

/** setTimeout cannot wait longer than this (a 32-bit signed count of milliseconds). */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** A moment after midnight, so the timer never fires just before the day changes. */
const PAST_MIDNIGHT_MS = 250;

/**
 * "Now" and "today" for the Explore filters, in the Explore calendar zone (`Asia/Beirut`, see EXPLORE_ZONE; not the
 * device's zone). Refreshes when the day changes while the tab stays open (a timer to the next midnight) and when a
 * tab that was asleep or in the background becomes visible again, so "Today" never means yesterday.
 */
export function useExploreToday(): { now: Date; today: string } {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Move to the current instant only when the calendar day has changed (otherwise nothing re-renders). */
    const refresh = () =>
      setNow((current) => {
        const fresh = new Date();
        return todayIn(current) === todayIn(fresh) ? current : fresh;
      });
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          refresh();
          schedule();
        },
        Math.min(msUntilNextDay(new Date()) + PAST_MIDNIGHT_MS, MAX_TIMER_MS),
      );
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      refresh();
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { now, today: todayIn(now) };
}
