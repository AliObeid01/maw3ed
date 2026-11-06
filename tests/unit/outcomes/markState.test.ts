import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import type { QueueItem } from '@/lib/api/outcomes';
import {
  canMark,
  emptyMarks,
  justMarked,
  markReducer,
  outcomeFailure,
  pendingItems,
  remainingCount,
  type MarkEvent,
  type MarkState,
} from '@/lib/outcomes/state';

const item = (id: string): QueueItem => ({
  id,
  startAt: '2026-10-29T08:00:00Z',
  endAt: '2026-10-29T08:30:00Z',
  service: { id: 's', name: 'Haircut' },
  staff: { id: 'p', displayName: 'Karim' },
  client: { id, name: `Client ${id}`, phone: '+96170555218', noShows: 0 },
});
const run = (events: MarkEvent[], from: MarkState = emptyMarks) => events.reduce(markReducer, from);

describe('outcomeFailure', () => {
  it('maps the documented 409 codes and 404', () => {
    expect(outcomeFailure(new ApiError(409, 'NOT_ENDED', 'x'))).toEqual({ kind: 'notEnded' });
    expect(outcomeFailure(new ApiError(409, 'NOT_STARTED', 'x'))).toEqual({ kind: 'notStarted' });
    expect(outcomeFailure(new ApiError(409, 'CONFLICT', 'x'))).toEqual({ kind: 'conflict' });
    expect(outcomeFailure(new ApiError(404, 'NOT_FOUND', 'x'))).toEqual({ kind: 'notFound' });
  });
  it('maps NO_SHOW_TOO_EARLY with the time it opens, and tolerates a missing or odd payload', () => {
    expect(
      outcomeFailure(
        new ApiError(409, 'NO_SHOW_TOO_EARLY', 'x', {}, { availableAt: '2026-11-04T12:10:00.000Z' }),
      ),
    ).toEqual({ kind: 'tooEarly', availableAt: '2026-11-04T12:10:00.000Z' });
    expect(outcomeFailure(new ApiError(409, 'NO_SHOW_TOO_EARLY', 'x'))).toEqual({
      kind: 'tooEarly',
      availableAt: null,
    });
    expect(outcomeFailure(new ApiError(409, 'NO_SHOW_TOO_EARLY', 'x', {}, { availableAt: 5 }))).toEqual({
      kind: 'tooEarly',
      availableAt: null,
    });
  });
  it('keeps anything else for the generic message', () => {
    const e = new ApiError(500, 'INTERNAL', 'x');
    expect(outcomeFailure(e)).toEqual({ kind: 'other', error: e });
  });
});

describe('mark state machine', () => {
  const a = item('a');
  const b = item('b');

  it('a first mark in flight stays in the queue (nothing slides under a double tap) and moves once confirmed', () => {
    const saving = run([{ type: 'tap', item: a, outcome: 'NO_SHOW' }]);
    expect(saving.entries.a).toMatchObject({ phase: 'saving', outcome: 'NO_SHOW', confirmed: null });
    expect(pendingItems([a, b], saving).map((i) => i.id)).toEqual(['a', 'b']);
    expect(justMarked(saving)).toEqual([]);
    const done = markReducer(saving, { type: 'ok', id: 'a', outcome: 'NO_SHOW' });
    expect(pendingItems([a, b], done).map((i) => i.id)).toEqual(['b']);
    expect(justMarked(done).map((e) => e.item.id)).toEqual(['a']);
  });

  it('a correction in flight stays in "just marked" with the new outcome', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'NO_SHOW' },
      { type: 'ok', id: 'a', outcome: 'NO_SHOW' },
      { type: 'tap', item: a, outcome: 'ATTENDED' },
    ]);
    expect(pendingItems([a], s)).toEqual([]);
    expect(justMarked(s).map((e) => [e.item.id, e.outcome])).toEqual([['a', 'ATTENDED']]);
  });

  it('ignores a second tap while saving (no double submit)', () => {
    const first = run([{ type: 'tap', item: a, outcome: 'NO_SHOW' }]);
    const second = markReducer(first, { type: 'tap', item: a, outcome: 'ATTENDED' });
    expect(second).toBe(first);
    expect(canMark(first, 'a')).toBe(false);
  });

  it('ok confirms; a later tap is a correction that remembers what was confirmed', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'NO_SHOW' },
      { type: 'ok', id: 'a', outcome: 'NO_SHOW' },
      { type: 'tap', item: a, outcome: 'ATTENDED' },
    ]);
    expect(s.entries.a).toMatchObject({ phase: 'saving', outcome: 'ATTENDED', confirmed: 'NO_SHOW' });
  });

  it('a failed first mark returns the card to the queue with the reason', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'fail', id: 'a', failure: { kind: 'notEnded' } },
    ]);
    expect(s.entries.a).toMatchObject({ phase: 'failed', outcome: null, error: { kind: 'notEnded' } });
    expect(pendingItems([a], s).map((i) => i.id)).toEqual(['a']);
    expect(justMarked(s)).toEqual([]);
    expect(canMark(s, 'a')).toBe(true);
  });

  it('a failed correction rolls back to the confirmed outcome and keeps the error', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'NO_SHOW' },
      { type: 'ok', id: 'a', outcome: 'NO_SHOW' },
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'fail', id: 'a', failure: { kind: 'notEnded' } },
    ]);
    expect(s.entries.a).toMatchObject({ phase: 'done', outcome: 'NO_SHOW', error: { kind: 'notEnded' } });
    expect(justMarked(s)).toHaveLength(1);
  });

  it('only a 404 removes the card for good', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'fail', id: 'a', failure: { kind: 'notFound' } },
    ]);
    expect(s.entries.a!.phase).toBe('gone');
    expect(pendingItems([a], s)).toEqual([]);
    expect(justMarked(s)).toEqual([]);
    expect(canMark(s, 'a')).toBe(false);
  });

  it('a 409 CONFLICT on a first mark keeps the card in the queue with a retry and still counts it as waiting', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'fail', id: 'a', failure: { kind: 'conflict' } },
    ]);
    expect(s.entries.a).toMatchObject({ phase: 'failed', outcome: null, error: { kind: 'conflict' } });
    expect(pendingItems([a], s).map((i) => i.id)).toEqual(['a']);
    expect(canMark(s, 'a')).toBe(true);
    expect(remainingCount(1, [a], s)).toBe(1);
  });

  it('a 409 CONFLICT on a correction rolls back to the confirmed outcome', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'NO_SHOW' },
      { type: 'ok', id: 'a', outcome: 'NO_SHOW' },
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'fail', id: 'a', failure: { kind: 'conflict' } },
    ]);
    expect(s.entries.a).toMatchObject({ phase: 'done', outcome: 'NO_SHOW' });
  });

  it('a late answer for a card that is not saving is ignored', () => {
    const s = run([{ type: 'ok', id: 'a', outcome: 'ATTENDED' }]);
    expect(s).toBe(emptyMarks);
  });

  it('keeps most recent first and moves a corrected card to the top', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'ok', id: 'a', outcome: 'ATTENDED' },
      { type: 'tap', item: b, outcome: 'NO_SHOW' },
      { type: 'ok', id: 'b', outcome: 'NO_SHOW' },
      { type: 'tap', item: a, outcome: 'NO_SHOW' },
    ]);
    expect(s.order).toEqual(['a', 'b']);
  });
});

describe('remainingCount', () => {
  const a = item('a');
  const b = item('b');
  it('subtracts handled cards the server still lists, not after a reload', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'ok', id: 'a', outcome: 'ATTENDED' },
    ]);
    expect(remainingCount(2, [a, b], s)).toBe(1);
    // after a reload the server no longer lists a and already counts 1
    expect(remainingCount(1, [b], s)).toBe(1);
  });
  it('failed first marks still count as waiting and the count never goes negative', () => {
    const s = run([
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'fail', id: 'a', failure: { kind: 'notEnded' } },
    ]);
    expect(remainingCount(2, [a, b], s)).toBe(2);
    const done = run([
      { type: 'tap', item: a, outcome: 'ATTENDED' },
      { type: 'ok', id: 'a', outcome: 'ATTENDED' },
    ]);
    expect(remainingCount(0, [a], done)).toBe(0);
  });
});
