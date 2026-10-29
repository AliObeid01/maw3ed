import { describe, expect, it } from 'vitest';
import {
  backParams,
  parseBookingParams,
  resolveBookingState,
  serialiseBookingParams,
} from '@/lib/booking/urlState';

const catalogue = {
  services: [{ id: 's1' }, { id: 's2' }],
  staff: [
    { id: 'p1', displayName: 'Lina', serviceIds: ['s1', 's2'] },
    { id: 'p2', displayName: 'Karim', serviceIds: ['s1'] },
  ],
};
const parse = (qs: string) => parseBookingParams(new URLSearchParams(qs));

describe('parseBookingParams / serialiseBookingParams', () => {
  it('round-trips a full state with a stable key order', () => {
    const params = {
      step: 'details',
      service: 's1',
      staff: 'anyone',
      day: '2026-11-03',
      time: '10:30',
    } as const;
    const qs = serialiseBookingParams(params);
    expect(qs).toBe('?step=details&service=s1&staff=anyone&day=2026-11-03&time=10%3A30');
    expect(parse(qs)).toEqual(params);
  });

  it('is empty when nothing is chosen', () => {
    expect(serialiseBookingParams({})).toBe('');
  });

  it('drops dates that match the shape but are not real calendar days', () => {
    expect(parse('day=2026-02-31')).toEqual({});
    expect(parse('day=2026-13-01')).toEqual({});
    expect(parse('day=2028-02-29')).toEqual({ day: '2028-02-29' });
  });

  it('drops malformed values instead of trusting them', () => {
    expect(parse('step=hack&service=a b&staff=<x>&day=2026-1-3&time=25:00&other=1')).toEqual({});
    expect(parse('time=09:05')).toEqual({ time: '09:05' });
  });
});

describe('resolveBookingState', () => {
  it('starts at the service step and ignores everything else for an unknown service', () => {
    expect(resolveBookingState(parse('service=nope&staff=p1'), catalogue).step).toBe('service');
    expect(resolveBookingState({}, catalogue).step).toBe('service');
  });

  it('asks for staff when several people offer the service', () => {
    const state = resolveBookingState(parse('service=s1'), catalogue);
    expect(state).toMatchObject({ step: 'staff', staffSkipped: false });
    expect(state.eligible.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('skips the staff step entirely when one person offers the service', () => {
    const state = resolveBookingState(parse('service=s2'), catalogue);
    expect(state).toMatchObject({ step: 'time', staffSkipped: true, staffId: 'p1' });
  });

  it('accepts "anyone" and an eligible person, rejects someone who does not offer it', () => {
    expect(resolveBookingState(parse('service=s1&staff=anyone'), catalogue).step).toBe('time');
    expect(resolveBookingState(parse('service=s1&staff=p2'), catalogue).staffId).toBe('p2');
    expect(resolveBookingState(parse('service=s2&staff=p2'), catalogue).staffId).toBe('p1');
    expect(resolveBookingState(parse('service=s1&staff=ghost'), catalogue).step).toBe('staff');
  });

  it('only reaches details with a day and a time', () => {
    const base = 'service=s1&staff=anyone&step=details';
    expect(resolveBookingState(parse(base), catalogue).step).toBe('time');
    expect(resolveBookingState(parse(`${base}&day=2026-11-03`), catalogue).step).toBe('time');
    expect(resolveBookingState(parse(`${base}&time=10:30`), catalogue).step).toBe('time');
    expect(resolveBookingState(parse(`${base}&day=2026-11-03&time=10:30`), catalogue).step).toBe(
      'details',
    );
  });
});

describe('resolveBookingState with the visible day window', () => {
  const window = ['2026-11-02', '2026-11-03'];
  const qs = 'service=s1&staff=anyone&step=details&time=10:30&day=';
  it('keeps a day inside the window', () => {
    expect(resolveBookingState(parse(qs + '2026-11-03'), catalogue, window)).toMatchObject({
      step: 'details',
      day: '2026-11-03',
    });
  });
  it('ignores a day outside the window (and with it the time and the details step)', () => {
    const state = resolveBookingState(parse(qs + '2027-01-01'), catalogue, window);
    expect(state).toMatchObject({ step: 'time', day: undefined, time: undefined });
  });
});

describe('backParams', () => {
  it('walks back one step and skips the staff step when it was skipped', () => {
    const details = resolveBookingState(
      parse('service=s1&staff=p2&day=2026-11-03&time=10:30&step=details'),
      catalogue,
    );
    expect(backParams(details)).toMatchObject({ step: 'time', day: '2026-11-03', time: '10:30' });

    const timeWithStaff = resolveBookingState(parse('service=s1&staff=p2'), catalogue);
    expect(backParams(timeWithStaff)).toEqual({ step: 'staff', service: 's1' });

    const timeSkipped = resolveBookingState(parse('service=s2'), catalogue);
    expect(backParams(timeSkipped)).toEqual({});

    expect(backParams(resolveBookingState(parse('service=s1'), catalogue))).toEqual({});
    expect(backParams(resolveBookingState({}, catalogue))).toBeUndefined();
  });
});
