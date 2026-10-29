import { describe, expect, it } from 'vitest';
import {
  copyDay,
  emptyWeek,
  endFromInput,
  endToInput,
  suggestInterval,
  toMinutes,
  validateDay,
  validateWeek,
  weekFromApi,
  weekToApi,
} from '@/lib/setup/hours';

const iv = (start: string, end: string) => ({ start, end });

describe('toMinutes', () => {
  it('parses HH:mm and 24:00, rejects the rest', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('24:00')).toBe(1440);
    expect(toMinutes('24:30')).toBeNaN();
    expect(toMinutes('9:30')).toBeNaN();
    expect(toMinutes('12:60')).toBeNaN();
    expect(toMinutes('')).toBeNaN();
  });
});

describe('validateDay', () => {
  it('accepts split shifts and touching intervals', () => {
    expect(validateDay([iv('09:00', '13:00'), iv('14:00', '19:00')])).toEqual([]);
    expect(validateDay([iv('09:00', '13:00'), iv('13:00', '17:00')])).toEqual([]);
    expect(validateDay([iv('00:00', '24:00')])).toEqual([]);
  });

  it('detects overlap regardless of entry order', () => {
    expect(validateDay([iv('09:00', '13:00'), iv('12:59', '19:00')])).toContain('overlap');
    expect(validateDay([iv('14:00', '19:00'), iv('09:00', '14:01')])).toContain('overlap');
    expect(validateDay([iv('09:00', '17:00'), iv('10:00', '11:00')])).toContain('overlap');
  });

  it('flags end not after start and malformed times', () => {
    expect(validateDay([iv('13:00', '09:00')])).toContain('endBeforeStart');
    expect(validateDay([iv('09:00', '09:00')])).toContain('endBeforeStart');
    expect(validateDay([iv('', '09:00')])).toContain('invalid');
  });

  it('caps six intervals per day', () => {
    const six = Array.from({ length: 6 }, (_, i) => iv(`${String(i * 2).padStart(2, '0')}:00`, `${String(i * 2 + 1).padStart(2, '0')}:00`));
    expect(validateDay(six)).toEqual([]);
    expect(validateDay([...six, iv('13:00', '14:00')])).toContain('tooMany');
  });
});

describe('validateWeek', () => {
  it('reports only the days with problems, keyed by weekday', () => {
    const week = emptyWeek();
    week[1] = [iv('09:00', '13:00')];
    week[3] = [iv('09:00', '13:00'), iv('12:00', '14:00')];
    expect(validateWeek(week)).toEqual({ 3: ['overlap'] });
  });
});

describe('copyDay', () => {
  it('replaces the target days with a copy of the source and leaves the rest alone', () => {
    const week = emptyWeek();
    week[1] = [iv('09:00', '13:00'), iv('14:00', '19:00')];
    week[2] = [iv('10:00', '11:00')];
    week[0] = [iv('08:00', '09:00')];
    const next = copyDay(week, 1, [2, 3, 1]);
    expect(next[2]).toEqual(week[1]);
    expect(next[3]).toEqual(week[1]);
    expect(next[0]).toEqual([iv('08:00', '09:00')]);
    expect(next[1]).toEqual(week[1]);
  });

  it('does not alias the source intervals and does not mutate the input', () => {
    const week = emptyWeek();
    week[1] = [iv('09:00', '13:00')];
    const next = copyDay(week, 1, [2]);
    next[2]![0]!.start = '10:00';
    expect(week[1]![0]!.start).toBe('09:00');
    expect(week[2]).toEqual([]);
  });

  it('copying an empty day clears the targets (a day off)', () => {
    const week = emptyWeek();
    week[2] = [iv('10:00', '11:00')];
    expect(copyDay(week, 1, [2])[2]).toEqual([]);
  });
});

describe('week <-> API', () => {
  it('round-trips and sorts intervals by start', () => {
    const intervals = [
      { weekday: 1, startLocal: '14:00', endLocal: '19:00' },
      { weekday: 1, startLocal: '09:00', endLocal: '13:00' },
      { weekday: 0, startLocal: '10:00', endLocal: '24:00' },
    ];
    const week = weekFromApi(intervals);
    expect(week[1]).toEqual([iv('09:00', '13:00'), iv('14:00', '19:00')]);
    expect(weekToApi(week)).toEqual([
      { weekday: 0, startLocal: '10:00', endLocal: '24:00' },
      { weekday: 1, startLocal: '09:00', endLocal: '13:00' },
      { weekday: 1, startLocal: '14:00', endLocal: '19:00' },
    ]);
  });
});

describe('suggestInterval and 24:00 inputs', () => {
  it('suggests a full day on an empty day and an hour-later slot otherwise', () => {
    expect(suggestInterval([])).toEqual(iv('09:00', '17:00'));
    expect(suggestInterval([iv('09:00', '13:00')])).toEqual(iv('14:00', '18:00'));
    expect(suggestInterval([iv('09:00', '23:00')])).toEqual(iv('22:00', '24:00'));
  });

  it('maps end-of-day to the time input and back', () => {
    expect(endToInput('24:00')).toBe('00:00');
    expect(endToInput('17:00')).toBe('17:00');
    expect(endFromInput('00:00')).toBe('24:00');
    expect(endFromInput('17:00')).toBe('17:00');
  });
});
