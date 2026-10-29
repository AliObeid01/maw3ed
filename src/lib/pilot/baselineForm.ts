import { DateTime } from 'luxon';
import type { Baseline } from '@/lib/api/pilot';

export const MAX_BASELINE_DAYS = 31;
export const MAX_BASELINE_COUNT = 10_000;

export type BaselineValues = {
  fromDate: string;
  toDate: string;
  appointments: string;
  noShows: string;
  lateCancels: string;
};

export type BaselineField = keyof BaselineValues;

/** Keys under `app.pilot.baseline.errors`. */
export type BaselineErrorKey =
  | 'dateRequired'
  | 'dateInvalid'
  | 'toBeforeFrom'
  | 'tooLong'
  | 'future'
  | 'numberRequired'
  | 'numberInvalid'
  | 'noShowsAbove'
  | 'tooMany';

export type BaselineErrors = Partial<Record<BaselineField, BaselineErrorKey>>;

export const emptyBaselineValues: BaselineValues = {
  fromDate: '',
  toDate: '',
  appointments: '',
  noShows: '',
  lateCancels: '',
};

export function valuesFromBaseline(b: Baseline | null | undefined): BaselineValues {
  return b
    ? {
        fromDate: b.fromDate,
        toDate: b.toDate,
        appointments: String(b.appointments),
        noShows: String(b.noShows),
        lateCancels: String(b.lateCancels),
      }
    : emptyBaselineValues;
}

const parseCount = (text: string): { value?: number; error?: BaselineErrorKey } => {
  const s = text.trim();
  if (s === '') return { error: 'numberRequired' };
  if (!/^\d+$/.test(s)) return { error: 'numberInvalid' };
  const n = Number(s);
  return n > MAX_BASELINE_COUNT ? { error: 'tooMany' } : { value: n };
};

const validDay = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && DateTime.fromISO(ymd, { zone: 'utc' }).isValid;

/** Inclusive number of local days between two valid `yyyy-MM-dd` dates. */
export const spanDays = (from: string, to: string): number =>
  Math.round(DateTime.fromISO(to, { zone: 'utc' }).diff(DateTime.fromISO(from, { zone: 'utc' }), 'days').days) + 1;

/**
 * Mirrors the server rules (so the owner sees the problem before sending): both dates real, to >= from, at most 31
 * days, not after `today` (business-local, injected), counts are whole numbers, no-shows <= appointments (held or
 * missed), appointments + late cancels <= 10 000. Returns the parsed body when valid.
 */
export function validateBaseline(
  values: BaselineValues,
  today: string,
): { ok: true; body: Baseline } | { ok: false; errors: BaselineErrors } {
  const errors: BaselineErrors = {};
  const from = values.fromDate.trim();
  const to = values.toDate.trim();
  if (!from) errors.fromDate = 'dateRequired';
  else if (!validDay(from)) errors.fromDate = 'dateInvalid';
  if (!to) errors.toDate = 'dateRequired';
  else if (!validDay(to)) errors.toDate = 'dateInvalid';
  if (!errors.fromDate && !errors.toDate) {
    if (to < from) errors.toDate = 'toBeforeFrom';
    else if (spanDays(from, to) > MAX_BASELINE_DAYS) errors.toDate = 'tooLong';
  }
  if (!errors.toDate && to > today) errors.toDate = 'future';

  const appointments = parseCount(values.appointments);
  const noShows = parseCount(values.noShows);
  const lateCancels = parseCount(values.lateCancels);
  if (appointments.error) errors.appointments = appointments.error;
  if (noShows.error) errors.noShows = noShows.error;
  if (lateCancels.error) errors.lateCancels = lateCancels.error;
  if (appointments.value !== undefined && noShows.value !== undefined && noShows.value > appointments.value)
    errors.noShows = 'noShowsAbove';
  if (
    appointments.value !== undefined &&
    lateCancels.value !== undefined &&
    appointments.value + lateCancels.value > MAX_BASELINE_COUNT
  )
    errors.appointments = 'tooMany';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      fromDate: from,
      toDate: to,
      appointments: appointments.value!,
      noShows: noShows.value!,
      lateCancels: lateCancels.value!,
    },
  };
}

/**
 * Map a 400 `fields` object from the server onto form fields (unknown keys are ignored). The server's text decides
 * which of our messages fits: a field can fail for more than one reason ("No-shows cannot exceed appointments" is
 * only one of the ways `noShows` can be wrong).
 */
export function serverFieldErrors(fields: Record<string, string>): BaselineErrors {
  const out: BaselineErrors = {};
  const has = (field: string, pattern: RegExp) => pattern.test(fields[field] ?? '');
  if (fields.fromDate) out.fromDate = 'dateInvalid';
  if (fields.toDate) {
    out.toDate = has('toDate', /before the start/i)
      ? 'toBeforeFrom'
      : has('toDate', /at most \d+ days/i)
        ? 'tooLong'
        : has('toDate', /future/i)
          ? 'future'
          : 'dateInvalid';
  }
  if (fields.appointments) out.appointments = has('appointments', /at most 10000|10,?000/i) ? 'tooMany' : 'numberInvalid';
  if (fields.noShows) out.noShows = has('noShows', /exceed|more than/i) ? 'noShowsAbove' : 'numberInvalid';
  if (fields.lateCancels) out.lateCancels = 'numberInvalid';
  return out;
}
