import { describe, expect, it } from 'vitest';
import {
  serverFieldErrors,
  spanDays,
  validateBaseline,
  valuesFromBaseline,
  type BaselineValues,
} from '@/lib/pilot/baselineForm';

const TODAY = '2026-10-29';
const ok: BaselineValues = {
  fromDate: '2026-10-01',
  toDate: '2026-10-14',
  appointments: '78',
  noShows: '14',
  lateCancels: '3',
};
const errorsFor = (over: Partial<BaselineValues>) => {
  const r = validateBaseline({ ...ok, ...over }, TODAY);
  return r.ok ? {} : r.errors;
};

describe('validateBaseline', () => {
  it('parses a valid baseline into the request body (numbers, trimmed dates)', () => {
    expect(validateBaseline({ ...ok, fromDate: ' 2026-10-01 ' }, TODAY)).toEqual({
      ok: true,
      body: { fromDate: '2026-10-01', toDate: '2026-10-14', appointments: 78, noShows: 14, lateCancels: 3 },
    });
  });
  it('requires dates and counts', () => {
    expect(errorsFor({ fromDate: '', toDate: '', appointments: '', noShows: '', lateCancels: '' })).toEqual({
      fromDate: 'dateRequired',
      toDate: 'dateRequired',
      appointments: 'numberRequired',
      noShows: 'numberRequired',
      lateCancels: 'numberRequired',
    });
  });
  it('rejects impossible dates', () => {
    expect(errorsFor({ fromDate: '2026-02-31' }).fromDate).toBe('dateInvalid');
    expect(errorsFor({ toDate: 'soon' }).toDate).toBe('dateInvalid');
  });
  it('end before start', () => {
    expect(errorsFor({ fromDate: '2026-10-14', toDate: '2026-10-01' }).toDate).toBe('toBeforeFrom');
  });
  it('allows exactly 31 days inclusive and rejects 32', () => {
    expect(spanDays('2026-10-01', '2026-10-31')).toBe(31);
    expect(errorsFor({ fromDate: '2026-09-29', toDate: '2026-10-29' }).toDate).toBeUndefined();
    expect(errorsFor({ fromDate: '2026-09-28', toDate: '2026-10-29' }).toDate).toBe('tooLong');
  });
  it('allows ending today, rejects tomorrow (business-local today is injected)', () => {
    expect(errorsFor({ fromDate: '2026-10-20', toDate: TODAY }).toDate).toBeUndefined();
    expect(errorsFor({ fromDate: '2026-10-20', toDate: '2026-10-30' }).toDate).toBe('future');
  });
  it('no-shows cannot exceed the held-or-missed appointments', () => {
    expect(errorsFor({ appointments: '10', noShows: '11' }).noShows).toBe('noShowsAbove');
    expect(errorsFor({ appointments: '10', noShows: '10' }).noShows).toBeUndefined();
  });
  it('whole non-negative numbers only, capped at 10 000 combined with late cancels', () => {
    expect(errorsFor({ appointments: '-1' }).appointments).toBe('numberInvalid');
    expect(errorsFor({ appointments: '7.5' }).appointments).toBe('numberInvalid');
    expect(errorsFor({ lateCancels: 'a' }).lateCancels).toBe('numberInvalid');
    expect(errorsFor({ appointments: '10001' }).appointments).toBe('tooMany');
    expect(errorsFor({ appointments: '9999', lateCancels: '2' }).appointments).toBe('tooMany');
  });
});

describe('form helpers', () => {
  it('prefills from a saved baseline and starts empty without one', () => {
    expect(valuesFromBaseline({ fromDate: '2026-10-01', toDate: '2026-10-14', appointments: 78, noShows: 14, lateCancels: 3 })).toEqual(ok);
    expect(valuesFromBaseline(null).fromDate).toBe('');
  });
  it('maps server field errors, ignoring unknown keys', () => {
    expect(serverFieldErrors({ noShows: 'Expected a whole number', other: 'y' })).toEqual({
      noShows: 'numberInvalid',
    });
  });
  it('maps each server message to the matching text, not one text per field', () => {
    expect(serverFieldErrors({ noShows: 'No-shows cannot exceed appointments.' })).toEqual({ noShows: 'noShowsAbove' });
    expect(serverFieldErrors({ toDate: 'The baseline period cannot end in the future.' })).toEqual({ toDate: 'future' });
    expect(serverFieldErrors({ toDate: 'The baseline period is at most 31 days.' })).toEqual({ toDate: 'tooLong' });
    expect(serverFieldErrors({ toDate: 'The end date must not be before the start date.' })).toEqual({ toDate: 'toBeforeFrom' });
    expect(serverFieldErrors({ toDate: 'Use a real date like 2026-10-31.' })).toEqual({ toDate: 'dateInvalid' });
    expect(serverFieldErrors({ appointments: 'Appointments plus late cancels are at most 10000.' })).toEqual({
      appointments: 'tooMany',
    });
    expect(serverFieldErrors({ appointments: 'Expected a whole number from 0 to 10000.' }).appointments).toBe('numberInvalid');
  });
});
