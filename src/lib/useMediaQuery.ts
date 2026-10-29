'use client';

import { useSyncExternalStore } from 'react';

/** True when the media query matches. Server render and first hydration read `false`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind `lg` and up: the dashboard shows side panels instead of sheets. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
