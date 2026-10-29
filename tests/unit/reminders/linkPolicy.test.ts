import { describe, expect, it } from 'vitest';
import {
  cancelCutoffAt,
  cancelOutcomeFor,
  confirmOutcomeFor,
  linkActionAllowed,
} from '@/server/domain/linkPolicy';

describe('linkActionAllowed', () => {
  it('a view token may confirm or cancel; confirm only confirms; cancel only cancels', () => {
    expect(linkActionAllowed('view', 'confirm')).toBe(true);
    expect(linkActionAllowed('view', 'cancel')).toBe(true);
    expect(linkActionAllowed('confirm', 'confirm')).toBe(true);
    expect(linkActionAllowed('confirm', 'cancel')).toBe(false);
    expect(linkActionAllowed('cancel', 'cancel')).toBe(true);
    expect(linkActionAllowed('cancel', 'confirm')).toBe(false);
    expect(linkActionAllowed('claim', 'confirm')).toBe(false);
    expect(linkActionAllowed('pay', 'cancel')).toBe(false);
  });
});

describe('cancel cutoff', () => {
  const start = new Date('2026-11-04T09:00:00Z');
  it('is startAt minus the cutoff minutes', () => {
    expect(cancelCutoffAt(start, 1440).toISOString()).toBe('2026-11-03T09:00:00.000Z');
  });
  it('free before the cutoff, late from the cutoff on', () => {
    const cutoff = cancelCutoffAt(start, 1440);
    expect(cancelOutcomeFor('BOOKED', new Date(cutoff.getTime() - 1), start, 1440)).toBe('cancel');
    expect(cancelOutcomeFor('BOOKED', cutoff, start, 1440)).toBe('late_cancel');
    expect(cancelOutcomeFor('CONFIRMED', new Date(cutoff.getTime() + 1), start, 1440)).toBe(
      'late_cancel',
    );
  });
  it('is idempotent for cancelled appointments and conflicts once an outcome exists', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(cancelOutcomeFor('CANCELLED', now, start, 1440)).toBe('already_cancelled');
    expect(cancelOutcomeFor('LATE_CANCEL', now, start, 1440)).toBe('already_cancelled');
    expect(cancelOutcomeFor('ATTENDED', now, start, 1440)).toBe('conflict');
    expect(cancelOutcomeFor('NO_SHOW', now, start, 1440)).toBe('conflict');
  });
});

describe('confirmOutcomeFor', () => {
  it('confirms BOOKED, repeats are fine, cancelled and outcome-marked conflict', () => {
    expect(confirmOutcomeFor('BOOKED')).toBe('confirm');
    expect(confirmOutcomeFor('CONFIRMED')).toBe('already_confirmed');
    for (const s of ['CANCELLED', 'LATE_CANCEL', 'ATTENDED', 'NO_SHOW', 'PENDING_PAYMENT'])
      expect(confirmOutcomeFor(s)).toBe('conflict');
  });
});
