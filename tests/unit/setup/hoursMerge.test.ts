import { describe, expect, it } from 'vitest';
import { mergeDayIntervals, mergeWeekIntervals } from '@/lib/setup/hoursMerge';

const d = (start: string, end: string) => ({ start, end });
const iv = (weekday: number, startLocal: string, endLocal: string) => ({
  weekday,
  startLocal,
  endLocal,
});

describe('mergeDayIntervals', () => {
  it('merges touching blocks into one', () => {
    expect(mergeDayIntervals([d('09:00', '17:00'), d('17:00', '22:00')])).toEqual([d('09:00', '22:00')]);
  });
  it('keeps a real break as two blocks', () => {
    expect(mergeDayIntervals([d('09:00', '12:00'), d('13:00', '17:00')])).toEqual([
      d('09:00', '12:00'),
      d('13:00', '17:00'),
    ]);
  });
  it('merges three chained blocks', () => {
    expect(
      mergeDayIntervals([d('09:00', '12:00'), d('12:00', '15:00'), d('15:00', '18:00')]),
    ).toEqual([d('09:00', '18:00')]);
  });
  it('handles an end of 24:00', () => {
    expect(mergeDayIntervals([d('18:00', '24:00'), d('09:00', '18:00')])).toEqual([d('09:00', '24:00')]);
  });
  it('sorts unsorted input', () => {
    expect(mergeDayIntervals([d('13:00', '17:00'), d('09:00', '12:00')])).toEqual([
      d('09:00', '12:00'),
      d('13:00', '17:00'),
    ]);
  });
  it('unions overlapping blocks', () => {
    expect(
      mergeDayIntervals([d('09:00', '14:00'), d('12:00', '17:00'), d('10:00', '11:00')]),
    ).toEqual([d('09:00', '17:00')]);
  });
  it('is idempotent and does not mutate its input', () => {
    const input = [d('09:00', '12:00'), d('12:00', '15:00'), d('16:00', '18:00')];
    const copy = JSON.parse(JSON.stringify(input));
    const once = mergeDayIntervals(input);
    expect(input).toEqual(copy);
    expect(mergeDayIntervals(once)).toEqual(once);
    expect(once).toEqual([d('09:00', '15:00'), d('16:00', '18:00')]);
  });
  it('never returns more blocks than it was given (MAX_INTERVALS_PER_DAY holds)', () => {
    const six = Array.from({ length: 6 }, (_, k) =>
      d(`${String(8 + k * 2).padStart(2, '0')}:00`, `${String(9 + k * 2).padStart(2, '0')}:00`),
    );
    expect(mergeDayIntervals(six)).toHaveLength(6);
    expect(mergeDayIntervals([...six, d('09:00', '10:00')]).length).toBeLessThanOrEqual(6);
  });
  it('leaves malformed entries alone', () => {
    expect(mergeDayIntervals([d('xx', '10:00'), d('09:00', '10:00')])).toHaveLength(2);
  });
});

describe('mergeWeekIntervals', () => {
  it('merges per weekday and returns sorted output', () => {
    expect(
      mergeWeekIntervals([iv(3, '17:00', '22:00'), iv(1, '09:00', '12:00'), iv(3, '09:00', '17:00')]),
    ).toEqual([iv(1, '09:00', '12:00'), iv(3, '09:00', '22:00')]);
  });
  it('does NOT merge across days (the midnight split stays)', () => {
    const split = [
      iv(1, '09:00', '24:00'),
      iv(2, '00:00', '02:00'),
      iv(0, '09:00', '24:00'),
      iv(1, '00:00', '02:00'),
    ];
    expect(mergeWeekIntervals(split)).toEqual([
      iv(0, '09:00', '24:00'),
      iv(1, '00:00', '02:00'),
      iv(1, '09:00', '24:00'),
      iv(2, '00:00', '02:00'),
    ]);
  });
  it('is idempotent', () => {
    const once = mergeWeekIntervals([
      iv(2, '09:00', '12:00'),
      iv(2, '12:00', '15:00'),
      iv(5, '10:00', '11:00'),
    ]);
    expect(mergeWeekIntervals(once)).toEqual(once);
  });
});
