import { describe, expect, it } from 'vitest';
import { plannedJobs, plannedReminders, remindersOf, sameBookingRequest } from '@/server/domain/bookingPlan';

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
