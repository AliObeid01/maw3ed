import { describe, expect, it } from 'vitest';
import { plannedJobs, sameBookingRequest } from '@/server/domain/bookingPlan';

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
