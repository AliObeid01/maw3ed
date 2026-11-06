import { describe, expect, it } from 'vitest';
import { apptTone } from '@/lib/dashboard/agenda';
import { outcomeOptions, outcomeWindow } from '@/lib/outcomes/eligibility';

const START = '2026-10-29T08:00:00Z';
const END = '2026-10-29T08:30:00Z';
const at = (iso: string) => new Date(iso);
const appt = (status: string) => ({ status, startAt: START, endAt: END });

describe('outcomeWindow boundaries', () => {
  it('is upcoming until the exact start instant, in progress from it', () => {
    expect(outcomeWindow(START, END, at('2026-10-29T07:59:59.999Z'))).toBe('upcoming');
    expect(outcomeWindow(START, END, at('2026-10-29T08:00:00.000Z'))).toBe('inProgress');
  });
  it('is in progress until the exact end instant, ended from it', () => {
    expect(outcomeWindow(START, END, at('2026-10-29T08:29:59.999Z'))).toBe('inProgress');
    expect(outcomeWindow(START, END, at('2026-10-29T08:30:00.000Z'))).toBe('ended');
  });
});

describe('outcomeOptions', () => {
  it('offers nothing before the start', () => {
    const r = outcomeOptions(appt('BOOKED'), at('2026-10-29T07:00:00Z'));
    expect(r).toMatchObject({
      open: true,
      current: null,
      options: { ATTENDED: 'notStarted', NO_SHOW: 'notStarted', LATE_CANCEL: 'notStarted' },
    });
  });
  it('while in progress Attended waits for the end but no-show and late cancel work', () => {
    const r = outcomeOptions(appt('CONFIRMED'), at('2026-10-29T08:10:00Z'));
    expect(r).toMatchObject({
      options: { ATTENDED: 'notEnded', NO_SHOW: 'enabled', LATE_CANCEL: 'enabled' },
    });
  });
  it('No-show waits for the 10 minute grace period, then works; the time it opens is reported', () => {
    const early = outcomeOptions(appt('BOOKED'), at('2026-10-29T08:09:59.999Z'));
    expect(early).toMatchObject({
      noShowAvailableAt: '2026-10-29T08:10:00.000Z',
      options: { ATTENDED: 'notEnded', NO_SHOW: 'grace', LATE_CANCEL: 'enabled' },
    });
    const on = outcomeOptions(appt('BOOKED'), at('2026-10-29T08:10:00.000Z'));
    expect(on).toMatchObject({ noShowAvailableAt: null, options: { NO_SHOW: 'enabled' } });
  });
  it('before the start No-show is notStarted, not grace', () => {
    const r = outcomeOptions(appt('CONFIRMED'), at('2026-10-29T07:00:00Z'));
    expect(r).toMatchObject({ options: { NO_SHOW: 'notStarted' } });
  });
  it('a correction INTO No-show from Attended also waits for the grace period', () => {
    const appointment = { status: 'ATTENDED', startAt: START, endAt: '2026-10-29T08:05:00Z' };
    const early = outcomeOptions(appointment, at('2026-10-29T08:06:00Z'));
    expect(early).toMatchObject({
      noShowAvailableAt: '2026-10-29T08:10:00.000Z',
      options: { NO_SHOW: 'grace' },
    });
    const on = outcomeOptions(appointment, at('2026-10-29T08:10:00Z'));
    expect(on).toMatchObject({ noShowAvailableAt: null, options: { NO_SHOW: 'enabled' } });
  });
  it('once ended all three work', () => {
    const r = outcomeOptions(appt('BOOKED'), at('2026-10-29T08:30:00Z'));
    expect(r).toMatchObject({
      options: { ATTENDED: 'enabled', NO_SHOW: 'enabled', LATE_CANCEL: 'enabled' },
    });
  });
  it('a recorded outcome is current and the others are corrections', () => {
    const r = outcomeOptions(appt('NO_SHOW'), at('2026-10-29T09:00:00Z'));
    expect(r).toMatchObject({
      current: 'NO_SHOW',
      options: { ATTENDED: 'enabled', NO_SHOW: 'current', LATE_CANCEL: 'enabled' },
    });
  });
  it('a correction to Attended during the appointment is still gated on the end', () => {
    const r = outcomeOptions(appt('NO_SHOW'), at('2026-10-29T08:10:00Z'));
    expect(r).toMatchObject({ options: { ATTENDED: 'notEnded', LATE_CANCEL: 'enabled' } });
  });
  it('a late cancel is final for Attended and No-show (the server answers 409 CONFLICT)', () => {
    const r = outcomeOptions(appt('LATE_CANCEL'), at('2026-10-29T09:00:00Z'));
    expect(r).toMatchObject({
      current: 'LATE_CANCEL',
      options: { ATTENDED: 'locked', NO_SHOW: 'locked', LATE_CANCEL: 'current' },
    });
  });
  it('PENDING_PAYMENT has its own tone, not Booked', () => {
    expect(apptTone({ status: 'PENDING_PAYMENT', source: 'PUBLIC' })).toBe('pendingPayment');
    expect(apptTone({ status: 'BOOKED', source: 'PUBLIC' })).toBe('booked');
  });
  it('cancelled and unknown statuses never take an outcome', () => {
    expect(outcomeOptions(appt('CANCELLED'), at('2026-10-29T09:00:00Z'))).toEqual({ open: false });
    expect(outcomeOptions(appt('PENDING_PAYMENT'), at('2026-10-29T09:00:00Z'))).toEqual({
      open: false,
    });
  });
});
