import { describe, expect, it } from 'vitest';
import {
  MAX_INTERVALS_PER_DAY,
  continuesFromPrevious,
  emptyWeek,
  endFromInput,
  mergeDay,
  nextWeekday,
  overnightIndex,
  openPastMidnight,
  type Week,
} from '@/lib/setup/hours';

const iv = (start: string, end: string) => ({ start, end });
const weekWith = (days: Record<number, Array<{ start: string; end: string }>>): Week => {
  const w = emptyWeek();
  for (const [d, v] of Object.entries(days)) w[Number(d)] = v;
  return w;
};

describe('nextWeekday', () => {
  it('wraps Sunday (0) ... Saturday (6) back to Sunday', () => {
    expect(nextWeekday(1)).toBe(2);
    expect(nextWeekday(6)).toBe(0);
    expect(nextWeekday(0)).toBe(1);
  });
});

describe('overnightIndex', () => {
  it('finds a valid entry that closes earlier than it opens, and nothing else', () => {
    expect(overnightIndex([iv('09:00', '17:00')])).toBe(-1);
    expect(overnightIndex([iv('09:00', '17:00'), iv('23:00', '02:00')])).toBe(1);
    expect(overnightIndex([iv('10:00', '10:00')])).toBe(-1);
    expect(overnightIndex([iv('xx', '02:00')])).toBe(-1);
    expect(overnightIndex([iv('23:30', '00:30')])).toBe(0);
  });
});

describe('endFromInput (old 00:00 means 24:00 values still read correctly)', () => {
  it('maps a legacy 00:00 end to 24:00 and leaves other ends alone', () => {
    expect(endFromInput('00:00')).toBe('24:00');
    expect(endFromInput('00:30')).toBe('00:30');
    expect(endFromInput('24:00')).toBe('24:00');
  });
});

describe('mergeDay', () => {
  it('sorts, drops exact duplicates and unions overlapping entries but keeps touching ones apart', () => {
    expect(mergeDay([iv('09:00', '12:00')], iv('11:00', '14:00'))).toEqual([iv('09:00', '14:00')]);
    expect(mergeDay([iv('09:00', '12:00')], iv('09:00', '12:00'))).toEqual([iv('09:00', '12:00')]);
    expect(mergeDay([iv('09:00', '12:00')], iv('12:00', '13:00'))).toEqual([iv('09:00', '12:00'), iv('12:00', '13:00')]);
    expect(mergeDay([iv('14:00', '18:00')], iv('00:00', '02:00'))).toEqual([iv('00:00', '02:00'), iv('14:00', '18:00')]);
  });
});

describe('openPastMidnight', () => {
  it('splits 09:00 to 02:00 into this day to 24:00 and next day 00:00 to 02:00', () => {
    const week = weekWith({ 1: [iv('09:00', '02:00')] });
    const r = openPastMidnight(week, 1, week[1]!, 0);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.week[1]).toEqual([iv('09:00', '24:00')]);
    expect(r.week[2]).toEqual([iv('00:00', '02:00')]);
  });

  it('keeps other entries of the day and sorts them', () => {
    const week = weekWith({ 5: [iv('23:00', '01:00'), iv('09:00', '13:00')] });
    const r = openPastMidnight(week, 5, week[5]!, 0);
    if (!r.ok) throw new Error('expected ok');
    expect(r.week[5]).toEqual([iv('09:00', '13:00'), iv('23:00', '24:00')]);
    expect(r.week[6]).toEqual([iv('00:00', '01:00')]);
  });

  it('wraps Sunday to Monday', () => {
    const week = weekWith({ 0: [iv('20:00', '03:00')], 1: [iv('09:00', '17:00')] });
    const r = openPastMidnight(week, 0, week[0]!, 0);
    if (!r.ok) throw new Error('expected ok');
    expect(r.week[0]).toEqual([iv('20:00', '24:00')]);
    expect(r.week[1]).toEqual([iv('00:00', '03:00'), iv('09:00', '17:00')]);
  });

  it('merges with an existing tail on the next day and never overlaps', () => {
    const week = weekWith({ 1: [iv('18:00', '03:00')], 2: [iv('00:00', '02:00'), iv('09:00', '12:00')] });
    const r = openPastMidnight(week, 1, week[1]!, 0);
    if (!r.ok) throw new Error('expected ok');
    expect(r.week[2]).toEqual([iv('00:00', '03:00'), iv('09:00', '12:00')]);
  });

  it('absorbs a next-day entry the new tail runs into', () => {
    const week = weekWith({ 1: [iv('18:00', '10:00')], 2: [iv('09:00', '17:00')] });
    const r = openPastMidnight(week, 1, week[1]!, 0);
    if (!r.ok) throw new Error('expected ok');
    expect(r.week[2]).toEqual([iv('00:00', '17:00')]);
  });

  it('fails with tooMany on the next day instead of exceeding the maximum', () => {
    const full = Array.from({ length: MAX_INTERVALS_PER_DAY }, (_, k) =>
      iv(`${String(8 + k * 2).padStart(2, '0')}:00`, `${String(9 + k * 2).padStart(2, '0')}:00`),
    );
    const week = weekWith({ 1: [iv('20:00', '02:00')], 2: full });
    const r = openPastMidnight(week, 1, week[1]!, 0);
    expect(r).toEqual({ ok: false, problem: 'tooMany', weekday: 2 });
  });

  it('fails when the new first part overlaps another entry of the same day', () => {
    const week = weekWith({ 1: [iv('09:00', '02:00'), iv('20:00', '22:00')] });
    const r = openPastMidnight(week, 1, week[1]!, 0);
    expect(r).toEqual({ ok: false, problem: 'overlap', weekday: 1 });
  });

  it('with copy to other days gives each copied day its own next-day tail', () => {
    const week = weekWith({ 1: [iv('09:00', '02:00')], 3: [iv('10:00', '12:00')], 5: [iv('08:00', '09:00')] });
    const r = openPastMidnight(week, 1, week[1]!, 0, [3, 5]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.week[1]).toEqual([iv('09:00', '24:00')]);
    expect(r.week[2]).toEqual([iv('00:00', '02:00')]);
    expect(r.week[3]).toEqual([iv('09:00', '24:00')]);
    expect(r.week[4]).toEqual([iv('00:00', '02:00')]);
    expect(r.week[5]).toEqual([iv('09:00', '24:00')]);
    expect(r.week[6]).toEqual([iv('00:00', '02:00')]);
  });

  it('copy onto consecutive days chains the tails into the next copy', () => {
    const week = weekWith({ 1: [iv('09:00', '02:00')] });
    const r = openPastMidnight(week, 1, week[1]!, 0, [2]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.week[2]).toEqual([iv('00:00', '02:00'), iv('09:00', '24:00')]);
    expect(r.week[3]).toEqual([iv('00:00', '02:00')]);
  });

  it('leaves the input week untouched', () => {
    const week = weekWith({ 1: [iv('09:00', '02:00')] });
    const copy = JSON.parse(JSON.stringify(week));
    openPastMidnight(week, 1, week[1]!, 0, [2]);
    expect(week).toEqual(copy);
  });
});

describe('continuesFromPrevious', () => {
  it('is true for a 00:00 start when the previous day closes at 24:00', () => {
    const week = weekWith({ 1: [iv('09:00', '24:00')], 2: [iv('00:00', '02:00'), iv('09:00', '12:00')] });
    expect(continuesFromPrevious(week, 2)).toBe(true);
    expect(continuesFromPrevious(week, 1)).toBe(false);
    expect(continuesFromPrevious(week, 3)).toBe(false);
  });
  it('wraps Sunday to Monday and is false when the previous day does not reach midnight', () => {
    const week = weekWith({ 0: [iv('09:00', '24:00')], 1: [iv('00:00', '01:00')], 3: [iv('00:00', '01:00')], 2: [iv('09:00', '23:00')] });
    expect(continuesFromPrevious(week, 1)).toBe(true);
    expect(continuesFromPrevious(week, 3)).toBe(false);
  });
});
