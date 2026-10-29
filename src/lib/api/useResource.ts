'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Resource<T> = {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Refetch (keeps showing the current data while loading). */
  reload: () => void;
  /** Replace the cached value after a mutation. */
  setData: (updater: T | ((current: T | undefined) => T)) => void;
};

/**
 * Minimal fetch-on-mount hook for the dashboard. Aborts the request when `key` changes or on unmount;
 * keeps the previous data while a reload is in flight.
 */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  key: string = '',
): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean; key: string }>({
    loading: true,
    key,
  });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, key });
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setState((s) => ({ data: s.key === key ? s.data : undefined, error, loading: false, key }));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, tick]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: undefined, loading: true }));
    setTick((n) => n + 1);
  }, []);

  const setData = useCallback((updater: T | ((current: T | undefined) => T)) => {
    setState((s) => ({
      ...s,
      data: typeof updater === 'function' ? (updater as (c: T | undefined) => T)(s.data) : updater,
    }));
  }, []);

  const stale = state.key !== key;
  return {
    data: stale ? undefined : state.data,
    error: stale ? undefined : state.error,
    loading: stale || state.loading,
    reload,
    setData,
  };
}
