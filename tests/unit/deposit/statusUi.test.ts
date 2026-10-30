import { describe, expect, it } from 'vitest';
import { apptTone, isActive } from '@/lib/dashboard/agenda';
import { outcomeOptions } from '@/lib/outcomes/eligibility';
import { ACTIVE_APPOINTMENT_STATUSES, REMINDABLE_STATUSES } from '@/server/domain/appointmentStatus';
import { planOutcome } from '@/server/domain/outcomes';

const past = { startAt: '2026-11-01T07:00:00.000Z', endAt: '2026-11-01T07:30:00.000Z' };
const now = new Date('2026-11-02T08:00:00Z');

describe('PENDING_PAYMENT in the UI helpers', () => {
  it('is labelled as pending payment, and still shown on the calendar', () => {
    expect(apptTone({ status: 'PENDING_PAYMENT', source: 'PUBLIC' })).toBe('pendingPayment');
    expect(apptTone({ status: 'PENDING_PAYMENT', source: 'WAITLIST' })).toBe('pendingPayment');
    expect(isActive({ status: 'PENDING_PAYMENT' })).toBe(true);
  });

  it('never offers an outcome, even once the start has passed', () => {
    expect(outcomeOptions({ status: 'PENDING_PAYMENT', ...past }, now)).toEqual({ open: false });
  });

  it('the server refuses an outcome for it as well', () => {
    const plan = planOutcome({
      status: 'PENDING_PAYMENT',
      target: 'NO_SHOW',
      cancelledVia: null,
      startAt: new Date(past.startAt),
      endAt: new Date(past.endAt),
      now,
    } as never);
    expect(plan.kind).toBe('conflict');
  });

  it('holds a slot but gets no reminders', () => {
    expect(ACTIVE_APPOINTMENT_STATUSES).toContain('PENDING_PAYMENT');
    expect(REMINDABLE_STATUSES).not.toContain('PENDING_PAYMENT');
  });
});
