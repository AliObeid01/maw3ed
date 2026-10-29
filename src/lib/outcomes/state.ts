import { ApiError } from '@/lib/api/auth';
import type { Outcome, QueueItem } from '@/lib/api/outcomes';

/** Why marking an outcome failed, as the screen needs to react to it. */
export type OutcomeFailure =
  | { kind: 'notEnded' }
  | { kind: 'notStarted' }
  | { kind: 'conflict' }
  | { kind: 'notFound' }
  | { kind: 'other'; error: unknown };

export function outcomeFailure(error: unknown): OutcomeFailure {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: 'notFound' };
    if (error.status === 409) {
      if (error.code === 'NOT_ENDED') return { kind: 'notEnded' };
      if (error.code === 'NOT_STARTED') return { kind: 'notStarted' };
      return { kind: 'conflict' };
    }
  }
  return { kind: 'other', error };
}

/**
 * One appointment's local state while it is being marked or corrected.
 *  - saving: request in flight; `outcome` is shown optimistically.
 *  - done: the server confirmed `outcome`.
 *  - failed: first mark failed; the card is back in the queue with an error.
 *  - gone: 404 / 409 CONFLICT; nothing more to do here, the card is hidden.
 */
export type Entry = {
  item: QueueItem;
  phase: 'saving' | 'done' | 'failed' | 'gone';
  /** Shown outcome (optimistic while saving). */
  outcome: Outcome | null;
  /** Last outcome the server confirmed (null before the first successful mark). */
  confirmed: Outcome | null;
  error?: OutcomeFailure;
};

export type MarkState = {
  entries: Record<string, Entry>;
  /** Ids, most recent first. */
  order: string[];
};

export const emptyMarks: MarkState = { entries: {}, order: [] };

export type MarkEvent =
  | { type: 'tap'; item: QueueItem; outcome: Outcome }
  | { type: 'ok'; id: string; outcome: Outcome }
  | { type: 'fail'; id: string; failure: OutcomeFailure };

/** Can this card start a new request? (not while one is in flight, not once it is gone). */
export const canMark = (state: MarkState, id: string): boolean => {
  const e = state.entries[id];
  return !e || e.phase === 'done' || e.phase === 'failed';
};

export function markReducer(state: MarkState, event: MarkEvent): MarkState {
  switch (event.type) {
    case 'tap': {
      if (!canMark(state, event.item.id)) return state;
      const prev = state.entries[event.item.id];
      const entry: Entry = {
        item: event.item,
        phase: 'saving',
        outcome: event.outcome,
        confirmed: prev?.confirmed ?? null,
      };
      return {
        entries: { ...state.entries, [event.item.id]: entry },
        order: [event.item.id, ...state.order.filter((id) => id !== event.item.id)],
      };
    }
    case 'ok': {
      const prev = state.entries[event.id];
      if (!prev || prev.phase !== 'saving') return state;
      return {
        ...state,
        entries: {
          ...state.entries,
          [event.id]: {
            ...prev,
            phase: 'done',
            outcome: event.outcome,
            confirmed: event.outcome,
            error: undefined,
          },
        },
      };
    }
    case 'fail': {
      const prev = state.entries[event.id];
      if (!prev || prev.phase !== 'saving') return state;
      const { kind } = event.failure;
      let next: Entry;
      if (kind === 'notFound' || kind === 'conflict') {
        next = { ...prev, phase: 'gone', error: event.failure };
      } else if (prev.confirmed) {
        // A correction failed: the card keeps showing what is really recorded.
        next = { ...prev, phase: 'done', outcome: prev.confirmed, error: event.failure };
      } else {
        next = { ...prev, phase: 'failed', outcome: null, error: event.failure };
      }
      return { ...state, entries: { ...state.entries, [event.id]: next } };
    }
  }
}

/**
 * Cards in the queue: server items with no local entry, first marks that failed, and first marks still in flight.
 * A card whose first mark is saving STAYS where it is (buttons disabled, spinner on the one tapped) and only moves
 * to "Just marked" once the server confirmed it. Removing it at once would slide the next card under the finger,
 * and a double tap would mark the wrong client.
 */
export function pendingItems(items: QueueItem[], state: MarkState): QueueItem[] {
  return items.filter((item) => {
    const e = state.entries[item.id];
    return !e || e.phase === 'failed' || (e.phase === 'saving' && e.confirmed === null);
  });
}

/** The "Just marked" list, newest first: confirmed marks, and corrections being saved. */
export function justMarked(state: MarkState): Entry[] {
  return state.order
    .map((id) => state.entries[id]!)
    .filter((e) => e.phase === 'done' || (e.phase === 'saving' && e.confirmed !== null));
}

/**
 * Number still to mark. `serverCount` may include entries we already handled locally; those are subtracted only
 * while the server still lists them (after a reload the count already excludes them).
 */
export function remainingCount(serverCount: number, items: QueueItem[], state: MarkState): number {
  const listed = new Set(items.map((i) => i.id));
  let handled = 0;
  for (const e of Object.values(state.entries)) {
    if (e.phase !== 'failed' && listed.has(e.item.id)) handled += 1;
  }
  return Math.max(0, serverCount - handled);
}
