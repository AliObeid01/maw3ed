import { describe, expect, it } from 'vitest';
import {
  bookingEmailPlan,
  plannedJobs,
  plannedReminders,
  remindersOf,
  sameBookingRequest,
} from '@/server/domain/bookingPlan';
import { reminderPlan } from '@/server/domain/reminderWindows';

const booked = new Date('2026-11-10T08:00:00Z');
const h = (n: number) => new Date(booked.getTime() + n * 3_600_000);
const keys = (start: Date) =>
  plannedJobs(start, booked)
    .map((j) => `${j.kind}/${j.channel}`)
    .sort();

describe('plannedJobs', () => {
  it('plans booking + H24 + H2 on both channels when booked far ahead', () => {
    expect(keys(h(48))).toEqual(
      ['BOOKING/EMAIL', 'H24/EMAIL', 'H24/WHATSAPP', 'H2/EMAIL', 'H2/WHATSAPP'].sort(),
    );
    const h24 = plannedJobs(h(48), booked).find((j) => j.kind === 'H24')!;
    expect(h24.dueAt.toISOString()).toBe(h(24).toISOString());
    expect(plannedJobs(h(48), booked).find((j) => j.kind === 'BOOKING')!.dueAt).toEqual(booked);
  });
  it('skips H24 under 24 h and H2 under 2 h', () => {
    expect(keys(h(5))).toEqual(['BOOKING/EMAIL', 'H2/EMAIL', 'H2/WHATSAPP']);
    expect(keys(h(1))).toEqual(['BOOKING/EMAIL']);
  });
});

describe('plannedReminders / remindersOf (what the pages may promise)', () => {
  it('30 h ahead: both', () => expect(plannedReminders(h(30), booked)).toEqual({ h24: true, h2: true, email: true }));
  it('exactly 24 h ahead: both (the same >= rule that creates the rows)', () =>
    expect(plannedReminders(h(24), booked)).toEqual({ h24: true, h2: true, email: true }));
  it('10 h ahead: only the 2 h reminder', () =>
    expect(plannedReminders(h(10), booked)).toEqual({ h24: false, h2: true, email: true }));
  it('1 h ahead: none', () => expect(plannedReminders(h(1), booked)).toEqual({ h24: false, h2: false, email: true }));
  it('equals remindersOf the planned jobs, whatever the lead', () => {
    for (const lead of [0.5, 1, 2, 5, 23.9, 24, 30, 100])
      expect(plannedReminders(h(lead), booked)).toEqual(remindersOf(plannedJobs(h(lead), booked)));
  });
  it('a client without an email is promised nothing, whatever the rows', () => {
    expect(remindersOf(plannedJobs(h(30), booked), false)).toEqual({ h24: false, h2: false, email: false });
  });
  it('only EMAIL H24/H2 rows count; BOOKING and other channels do not', () => {
    expect(remindersOf([{ kind: 'BOOKING', channel: 'EMAIL' }])).toEqual({ h24: false, h2: false, email: true });
    expect(remindersOf([{ kind: 'H24', channel: 'WHATSAPP' }])).toEqual({ h24: false, h2: false, email: true });
    expect(remindersOf([{ kind: 'H24' }, { kind: 'H2' }])).toEqual({ h24: true, h2: true, email: true });
  });
});

describe('sameBookingRequest', () => {
  const stored = { serviceId: 's', staffId: 'a', startAt: h(48), phone: '+96171234567' };
  const req = { serviceId: 's', staffId: 'a', startAt: h(48), phone: '+96171234567' };
  it('matches the same request and "anyone"', () => {
    expect(sameBookingRequest(stored, req)).toBe(true);
    expect(sameBookingRequest(stored, { ...req, staffId: 'anyone' })).toBe(true);
  });
  it('rejects a different slot, service, staff or phone', () => {
    expect(sameBookingRequest(stored, { ...req, startAt: h(49) })).toBe(false);
    expect(sameBookingRequest(stored, { ...req, serviceId: 'x' })).toBe(false);
    expect(sameBookingRequest(stored, { ...req, staffId: 'b' })).toBe(false);
    expect(sameBookingRequest(stored, { ...req, phone: '+96170000000' })).toBe(false);
  });
});

describe('F68 LATE: the receptionist item for a public booking made under 2 h ahead', () => {
  const late = (start: Date, source?: 'PUBLIC' | 'FRONT_DESK' | 'WAITLIST') =>
    plannedJobs(start, booked, source ? { source } : {})
      .map((j) => `${j.kind}/${j.channel}`)
      .sort();
  const min = (n: number) => new Date(booked.getTime() + n * 60_000);

  it('PUBLIC, 1 h ahead: one WHATSAPP LATE job due immediately, plus the booking email', () => {
    expect(late(h(1), 'PUBLIC')).toEqual(['BOOKING/EMAIL', 'LATE/WHATSAPP']);
    const job = plannedJobs(h(1), booked, { source: 'PUBLIC' }).find((j) => j.kind === 'LATE')!;
    expect(job.channel).toBe('WHATSAPP');
    expect(job.dueAt).toEqual(booked);
  });
  it('PUBLIC, 1 h 59 m 59 s ahead still gets it; exactly 2 h ahead does not (H2 takes over)', () => {
    expect(late(new Date(h(2).getTime() - 1000), 'PUBLIC')).toContain('LATE/WHATSAPP');
    expect(late(h(2), 'PUBLIC')).toEqual(['BOOKING/EMAIL', 'H2/EMAIL', 'H2/WHATSAPP']);
    expect(late(min(30), 'PUBLIC')).toContain('LATE/WHATSAPP');
  });
  it('PUBLIC, 24 h and 48 h ahead: none', () => {
    expect(late(h(24), 'PUBLIC')).not.toContain('LATE/WHATSAPP');
    expect(late(h(48), 'PUBLIC')).not.toContain('LATE/WHATSAPP');
  });
  it('front desk, waitlist claim and an unknown source never get one', () => {
    expect(late(h(1), 'FRONT_DESK')).toEqual(['BOOKING/EMAIL']);
    expect(late(h(1), 'WAITLIST')).toEqual(['BOOKING/EMAIL']);
    expect(late(h(1))).toEqual(['BOOKING/EMAIL']);
  });
  it('is never an email job and never part of the promise to the client', () => {
    expect(plannedJobs(h(1), booked, { source: 'PUBLIC' }).filter((j) => j.kind === 'LATE')).toEqual([
      { kind: 'LATE', channel: 'WHATSAPP', dueAt: booked },
    ]);
    expect(remindersOf(plannedJobs(h(1), booked, { source: 'PUBLIC' }), true)).toEqual({
      h24: false,
      h2: false,
      email: true,
    });
    expect(remindersOf([{ kind: 'LATE', channel: 'WHATSAPP' }, { kind: 'LATE' }])).toEqual({
      h24: false,
      h2: false,
      email: true,
    });
    expect(plannedReminders(h(1), booked)).toEqual({ h24: false, h2: false, email: true });
  });
});

describe('F68 bookingEmailPlan: which links the booking email carries (same lead rule as reminderPlan)', () => {
  const min = (n: number) => new Date(booked.getTime() + n * 60_000);
  const plan = (start: Date, hasEmail = true) => bookingEmailPlan(start, booked, hasEmail);

  it('23 h 59 m ahead: both links, a reminder (H2) follows', () => {
    expect(plan(min(24 * 60 - 1))).toEqual({ links: 'both', reminderPromise: true });
  });
  it('exactly 24 h ahead: cancel only (H24 follows)', () => {
    expect(plan(h(24))).toEqual({ links: 'cancel', reminderPromise: true });
  });
  it('25 h and 10 days ahead: cancel only', () => {
    expect(plan(h(25)).links).toBe('cancel');
    expect(plan(h(240)).links).toBe('cancel');
  });
  it('1 h ahead and exactly 2 h ahead: both links', () => {
    expect(plan(h(1))).toEqual({ links: 'both', reminderPromise: false });
    expect(plan(h(2))).toEqual({ links: 'both', reminderPromise: true });
  });
  it('promises nothing to a client without an email, links unchanged', () => {
    expect(plan(h(48), false)).toEqual({ links: 'cancel', reminderPromise: false });
  });
  it('agrees with reminderPlan for every lead', () => {
    for (const lead of [0.5, 1, 1.99, 2, 5, 23.99, 24, 24.01, 30, 100])
      expect(plan(h(lead)).links === 'cancel').toBe(
        reminderPlan(h(lead), booked).some((r) => r.kind === 'H24'),
      );
  });
});
