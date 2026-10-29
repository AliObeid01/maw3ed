import type { ClientPage, ClientRow, ClientSort } from '@/lib/api/outcomes';

export type ListState = {
  /** Bumped on every new search/sort; responses carry the seq they were asked under. */
  seq: number;
  search: string;
  sort: ClientSort;
  items: ClientRow[];
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  moreFailed: boolean;
  error?: unknown;
};

export const initialList: ListState = {
  seq: 0,
  search: '',
  sort: 'name',
  items: [],
  nextCursor: null,
  status: 'loading',
  loadingMore: false,
  moreFailed: false,
};

export type ListEvent =
  | { type: 'filter'; search: string; sort: ClientSort }
  | { type: 'retry' }
  | { type: 'loaded'; seq: number; page: ClientPage }
  | { type: 'failed'; seq: number; error: unknown }
  | { type: 'loadMore' }
  | { type: 'moreLoaded'; seq: number; page: ClientPage }
  | { type: 'moreFailed'; seq: number };

/** Append a page, skipping rows already shown (a cursor page can overlap after a client is added). */
export function mergePage(items: ClientRow[], page: ClientRow[]): ClientRow[] {
  const seen = new Set(items.map((c) => c.id));
  return [...items, ...page.filter((c) => !seen.has(c.id))];
}

const restart = (state: ListState, search: string, sort: ClientSort): ListState => ({
  ...state,
  seq: state.seq + 1,
  search,
  sort,
  status: 'loading',
  loadingMore: false,
  moreFailed: false,
  error: undefined,
});

export function listReducer(state: ListState, event: ListEvent): ListState {
  switch (event.type) {
    case 'filter': {
      const search = event.search.trim();
      if (search === state.search && event.sort === state.sort) return state;
      return restart(state, search, event.sort);
    }
    case 'retry':
      return restart(state, state.search, state.sort);
    case 'loaded':
      if (event.seq !== state.seq) return state; // an answer to an older search
      return {
        ...state,
        items: event.page.clients,
        nextCursor: event.page.nextCursor,
        status: 'ready',
        error: undefined,
      };
    case 'failed':
      if (event.seq !== state.seq) return state;
      return { ...state, status: 'error', error: event.error };
    case 'loadMore':
      if (!state.nextCursor || state.loadingMore || state.status !== 'ready') return state;
      return { ...state, loadingMore: true, moreFailed: false };
    case 'moreLoaded':
      if (event.seq !== state.seq) return state;
      return {
        ...state,
        items: mergePage(state.items, event.page.clients),
        nextCursor: event.page.nextCursor,
        loadingMore: false,
      };
    case 'moreFailed':
      if (event.seq !== state.seq) return state;
      return { ...state, loadingMore: false, moreFailed: true };
  }
}
