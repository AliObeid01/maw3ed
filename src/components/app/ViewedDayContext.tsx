'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { greetingFor, todayIn } from '@/lib/dashboard/agenda';

/** How often the clock is re-read; the screen only re-renders when the day or the greeting actually changes. */
export const CLOCK_TICK_MS = 30_000;

type ViewedDayApi = {
  /** The day chosen in the Today agenda, or null while it follows the real today. */
  viewedDay: string | null;
  setViewedDay: (day: string | null) => void;
  /** "Now", refreshed on a timer and on focus so a tab left open past midnight (or past noon) moves on. */
  now: Date;
};

const ViewedDayContext = createContext<ViewedDayApi>({
  viewedDay: null,
  setViewedDay: () => undefined,
  now: new Date(0),
});

export const useViewedDay = () => useContext(ViewedDayContext);

/**
 * The day the Today screen is showing, shared with the app header so its date follows the agenda. It lives in the
 * frame (not in TodayView) so the header can read it; TodayView clears it on unmount, so coming back starts on the
 * real today. `now` only changes when the business-local day or the greeting part changes.
 */
export function ViewedDayProvider({
  timezone,
  children,
}: {
  timezone: string;
  children: ReactNode;
}) {
  const [viewedDay, setViewedDayState] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const read = () => {
      const next = new Date();
      setNow((prev) =>
        todayIn(timezone, prev) === todayIn(timezone, next) &&
        greetingFor(timezone, prev) === greetingFor(timezone, next)
          ? prev
          : next,
      );
    };
    read();
    const timer = setInterval(read, CLOCK_TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [timezone]);

  const setViewedDay = useCallback((day: string | null) => setViewedDayState(day), []);
  const api = useMemo(() => ({ viewedDay, setViewedDay, now }), [viewedDay, setViewedDay, now]);
  return <ViewedDayContext.Provider value={api}>{children}</ViewedDayContext.Provider>;
}
