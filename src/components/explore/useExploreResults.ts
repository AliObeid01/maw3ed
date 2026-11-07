'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/auth';
import { getExplorePage, type DirectoryBusiness } from '@/lib/api/directory';
import { requestUrl, type ExploreFilters } from '@/lib/directory/explore';

/** At most one request per this many ms while the filters keep changing; the previous in-flight request is aborted. */
export const EXPLORE_DEBOUNCE_MS = 400;

export type FailKind = 'rate' | 'error';

export type ExploreState = {
  /** The shown results (they answer the last successful request, which can be older than the current filters). */
  items: DirectoryBusiness[];
  cursor: string | null;
  /** Nothing has been answered yet: the skeleton shows. */
  initial: boolean;
  /** A request for the current filters is pending (the old results stay visible, dimmed). */
  pending: boolean;
  /** The request for the current filters failed; the old results stay visible. */
  failed: FailKind | null;
  more: 'idle' | 'loading' | FailKind;
};

type Core = {
  items: DirectoryBusiness[];
  cursor: string | null;
  /** The request URL the items answer; null before the first answer. */
  answered: string | null;
  failure: { url: string; kind: FailKind } | null;
  more: { url: string; status: 'loading' | FailKind } | null;
};

const kindOf = (error: unknown): FailKind =>
  error instanceof ApiError && error.status === 429 ? 'rate' : 'error';

const aborted = (error: unknown, signal: AbortSignal) =>
  signal.aborted || (error instanceof DOMException && error.name === 'AbortError');

/**
 * Results for the filters in the URL. Rules (the live endpoint is rate-limited and CDN-cached):
 * - the first request goes out at once, later ones after EXPLORE_DEBOUNCE_MS of quiet, and each aborts the one before;
 * - `submit()` (the search box, Apply, Retry, Clear) makes the next one go out at once;
 * - a failure (429 included) keeps the previous results on screen;
 * - "Show more" is one request per click, never a loop, and new filters abort it.
 */
export function useExploreResults(filters: ExploreFilters) {
  const [core, setCore] = useState<Core>({
    items: [],
    cursor: null,
    answered: null,
    failure: null,
    more: null,
  });
  const [attempt, setAttempt] = useState(0);
  const immediate = useRef(true);
  const moreAbort = useRef<AbortController | null>(null);
  const url = requestUrl(filters);

  useEffect(() => {
    const controller = new AbortController();
    const delay = immediate.current ? 0 : EXPLORE_DEBOUNCE_MS;
    immediate.current = false;
    const timer = setTimeout(() => {
      getExplorePage(url, controller.signal)
        .then((page) =>
          setCore({
            items: page.businesses,
            cursor: page.nextCursor,
            answered: url,
            failure: null,
            more: null,
          }),
        )
        .catch((error: unknown) => {
          if (aborted(error, controller.signal)) return;
          setCore((c) => ({ ...c, failure: { url, kind: kindOf(error) } }));
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
      moreAbort.current?.abort(); // a "Show more" of the old filters must never land in the new results
    };
  }, [url, attempt]);

  /** The next change goes out at once (a deliberate action: Enter, Apply, Retry, Clear). */
  const submit = useCallback(() => {
    immediate.current = true;
  }, []);

  const retry = useCallback(() => {
    immediate.current = true;
    setCore((c) => ({ ...c, failure: null }));
    setAttempt((n) => n + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (!core.cursor || core.answered !== url || core.more?.status === 'loading') return;
    const controller = new AbortController();
    moreAbort.current?.abort();
    moreAbort.current = controller;
    setCore((c) => ({ ...c, more: { url, status: 'loading' } }));
    getExplorePage(requestUrl(filters, core.cursor), controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setCore((c) => {
          const seen = new Set(c.items.map((b) => b.slug));
          return {
            ...c,
            items: [...c.items, ...page.businesses.filter((b) => !seen.has(b.slug))],
            cursor: page.nextCursor,
            more: null,
          };
        });
      })
      .catch((error: unknown) => {
        if (aborted(error, controller.signal)) return;
        setCore((c) => ({ ...c, more: { url, status: kindOf(error) } }));
      });
  }, [core.cursor, core.answered, core.more, url, filters]);

  const failed = core.failure?.url === url ? core.failure.kind : null;
  const state: ExploreState = {
    items: core.items,
    cursor: core.cursor,
    initial: core.answered === null,
    pending: core.answered !== url && !failed,
    failed,
    more: core.more?.url === url ? core.more.status : 'idle',
  };
  return { state, submit, retry, loadMore };
}
