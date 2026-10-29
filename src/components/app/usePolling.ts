'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` every `intervalMs` while the tab is visible, and again when the window regains focus or the tab
 * becomes visible. Use for views that must stay current without the user pulling to refresh.
 */
export function usePolling(refresh: () => void, intervalMs = 60_000) {
  const ref = useRef(refresh);
  useEffect(() => {
    ref.current = refresh;
  });
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    const timer = setInterval(run, intervalMs);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [intervalMs]);
}
