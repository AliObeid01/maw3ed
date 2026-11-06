'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getSummary, type DashboardSummary } from '@/lib/api/dashboard';
import { errorKey } from '@/lib/setup/errors';

export const SUMMARY_POLL_MS = 60_000;

type SummaryApi = {
  summary: DashboardSummary | undefined;
  /** Refetch now (after sending a reminder, marking an outcome, ...). */
  refresh: () => void;
  /** Show a count right away (optimistic) until the next fetch confirms it. */
  setWhatsappDue: (count: number) => void;
  /** Same for the outcomes badge. */
  setOutcomesToMark: (count: number | ((current: number) => number)) => void;
};

const SummaryContext = createContext<SummaryApi>({
  summary: undefined,
  refresh: () => undefined,
  setWhatsappDue: () => undefined,
  setOutcomesToMark: () => undefined,
});

export const useSummary = () => useContext(SummaryContext);

/**
 * The two nav badge counts (`/api/dashboard/summary`), fetched on mount, every 60 s while the tab is visible, and
 * whenever the window regains focus. A failed poll keeps the last counts (a badge must not flicker to 0 offline);
 * a 401 sends the user to sign in.
 */
export function SummaryProvider({
  children,
  fetcher = getSummary,
}: {
  children: ReactNode;
  /** Where the counts come from: the barber (PRACTITIONER) has no access to /api/dashboard/summary. */
  fetcher?: (signal?: AbortSignal) => Promise<DashboardSummary>;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary>();
  const inflight = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    fetcher(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setSummary(next);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (errorKey(error) === 'unauthorized') router.replace('/login');
      });
  }, [router, fetcher]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, SUMMARY_POLL_MS);
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      inflight.current?.abort();
    };
  }, [refresh]);

  const setWhatsappDue = useCallback((count: number) => {
    setSummary((s) => (s ? { ...s, whatsappDue: Math.max(0, count) } : s));
  }, []);

  const setOutcomesToMark = useCallback((count: number | ((current: number) => number)) => {
    setSummary((s) =>
      s ? { ...s, outcomesToMark: Math.max(0, typeof count === 'function' ? count(s.outcomesToMark) : count) } : s,
    );
  }, []);

  const api = useMemo(
    () => ({ summary, refresh, setWhatsappDue, setOutcomesToMark }),
    [summary, refresh, setWhatsappDue, setOutcomesToMark],
  );
  return <SummaryContext.Provider value={api}>{children}</SummaryContext.Provider>;
}
