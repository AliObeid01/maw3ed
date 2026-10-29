import { describe, expect, it } from 'vitest';
import { findHoursProblem, sortIntervals } from '@/server/domain/hours';

const iv = (weekday: number, startLocal: string, endLocal: string) => ({
  weekday,
  startLocal,
  endLocal,
});

describe('findHoursProblem', () => {
  it('accepts a normal week, touching intervals and 24:00 ends', () => {
    expect(
      findHoursProblem([iv(1, '09:00', '12:00'), iv(1, '12:00', '15:00'), iv(2, '09:00', '24:00')]),
    ).toBeUndefined();
  });
  it('rejects end <= start with the index', () => {
    expect(findHoursProblem([iv(1, '09:00', '12:00'), iv(2, '10:00', '10:00')])).toMatchObject({
      index: 1,
    });
    expect(findHoursProblem([iv(2, '10:00', '09:00')])).toMatchObject({ index: 0 });
  });
  it('rejects overlap on the same weekday only', () => {
    expect(findHoursProblem([iv(1, '09:00', '12:00'), iv(2, '10:00', '13:00')])).toBeUndefined();
    expect(findHoursProblem([iv(1, '09:00', '12:00'), iv(1, '11:59', '13:00')])).toMatchObject({
      index: 1,
    });
  });
  it('rejects exact duplicates', () => {
    expect(findHoursProblem([iv(3, '09:00', '12:00'), iv(3, '09:00', '12:00')])).toMatchObject({
      index: 1,
    });
  });
  it('rejects more than 6 intervals in a day', () => {
    const starts = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00'];
    const day = starts.map((s, k) => iv(0, s, k + 1 < starts.length ? starts[k + 1]! : '14:00'));
    expect(findHoursProblem(day)).toMatchObject({ index: 6 });
  });
  it('sorts by weekday then start', () => {
    expect(
      sortIntervals([iv(2, '09:00', '10:00'), iv(1, '13:00', '14:00'), iv(1, '09:00', '10:00')]),
    ).toEqual([iv(1, '09:00', '10:00'), iv(1, '13:00', '14:00'), iv(2, '09:00', '10:00')]);
  });
});
