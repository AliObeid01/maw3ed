import { describe, expect, it } from 'vitest';
import { decrementCounter, planExcuse } from '@/server/domain/outcomes';

describe('planExcuse', () => {
  it('a no-show is excused: the no-show counter goes down', () => {
    expect(planExcuse({ status: 'NO_SHOW' })).toEqual({ kind: 'apply', decrement: 'noShows' });
  });
  it('a late cancel (staff-marked or link-set) is excused: the late-cancel counter goes down', () => {
    expect(planExcuse({ status: 'LATE_CANCEL' })).toEqual({
      kind: 'apply',
      decrement: 'lateCancels',
    });
  });
  it('an already CANCELLED appointment is a no-op (idempotent)', () => {
    expect(planExcuse({ status: 'CANCELLED' })).toEqual({ kind: 'noop' });
  });
  it.each(['BOOKED', 'CONFIRMED', 'ATTENDED', 'PENDING_PAYMENT', 'WHATEVER'])(
    '%s cannot be excused',
    (status) => {
      expect(planExcuse({ status })).toEqual({ kind: 'conflict' });
    },
  );
});

describe('decrementCounter', () => {
  it('goes down by one and never below zero', () => {
    expect(decrementCounter(3)).toBe(2);
    expect(decrementCounter(1)).toBe(0);
    expect(decrementCounter(0)).toBe(0);
    expect(decrementCounter(-2)).toBe(0);
  });
});
