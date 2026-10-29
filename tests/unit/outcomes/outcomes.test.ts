import { describe, expect, it } from 'vitest';
import { isRepeatNoShow, REPEAT_NO_SHOW_THRESHOLD } from '@/server/domain/clientFlags';
import { planOutcome, type PlanInput } from '@/server/domain/outcomes';

const NOW = new Date('2026-11-04T12:00:00Z');
const past = new Date('2026-11-04T08:00:00Z');
const future = new Date('2026-11-04T15:00:00Z');
const base: PlanInput = { status: 'BOOKED', cancelledVia: null, startAt: past, now: NOW, target: 'ATTENDED' };

describe('planOutcome', () => {
  it('rejects an appointment that has not started', () => {
    expect(planOutcome({ ...base, startAt: future })).toEqual({ kind: 'not_started' });
  });
  it('allows an appointment that starts exactly now', () => {
    expect(planOutcome({ ...base, startAt: NOW }).kind).toBe('apply');
  });
  it.each(['BOOKED', 'CONFIRMED'] as const)('from %s increments only the target counter', (status) => {
    expect(planOutcome({ ...base, status, target: 'NO_SHOW' })).toEqual({
      kind: 'apply',
      decrement: null,
      increment: 'noShows',
    });
    expect(planOutcome({ ...base, status, target: 'LATE_CANCEL' })).toEqual({
      kind: 'apply',
      decrement: null,
      increment: 'lateCancels',
    });
  });
  it('a correction moves one count from the old counter to the new one', () => {
    expect(planOutcome({ ...base, status: 'NO_SHOW', target: 'ATTENDED' })).toEqual({
      kind: 'apply',
      decrement: 'noShows',
      increment: 'attended',
    });
    expect(planOutcome({ ...base, status: 'ATTENDED', target: 'LATE_CANCEL' })).toEqual({
      kind: 'apply',
      decrement: 'attended',
      increment: 'lateCancels',
    });
  });
  it('marking the same outcome again is a no-op', () => {
    for (const s of ['ATTENDED', 'NO_SHOW', 'LATE_CANCEL'] as const)
      expect(planOutcome({ ...base, status: s, target: s })).toEqual({ kind: 'noop' });
  });
  it('a late cancel recorded by the cancel flow is final', () => {
    expect(planOutcome({ ...base, status: 'LATE_CANCEL', cancelledVia: 'LINK', target: 'LATE_CANCEL' })).toEqual({
      kind: 'noop',
    });
    expect(planOutcome({ ...base, status: 'LATE_CANCEL', cancelledVia: 'LINK', target: 'ATTENDED' })).toEqual({
      kind: 'conflict',
    });
    expect(planOutcome({ ...base, status: 'LATE_CANCEL', cancelledVia: 'LINK', target: 'NO_SHOW' })).toEqual({
      kind: 'conflict',
    });
  });
  it('a late cancel marked by staff can be corrected', () => {
    expect(planOutcome({ ...base, status: 'LATE_CANCEL', target: 'ATTENDED' })).toEqual({
      kind: 'apply',
      decrement: 'lateCancels',
      increment: 'attended',
    });
  });
  it('cancelled and unpaid appointments cannot get an outcome', () => {
    expect(planOutcome({ ...base, status: 'CANCELLED' })).toEqual({ kind: 'conflict' });
    expect(planOutcome({ ...base, status: 'PENDING_PAYMENT' })).toEqual({ kind: 'conflict' });
  });
});

describe('isRepeatNoShow', () => {
  it('flags at the threshold', () => {
    expect(REPEAT_NO_SHOW_THRESHOLD).toBe(2);
    expect(isRepeatNoShow(1)).toBe(false);
    expect(isRepeatNoShow(2)).toBe(true);
    expect(isRepeatNoShow(5)).toBe(true);
  });
});
