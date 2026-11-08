import { DateTime } from 'luxon';

const FALLBACK_ZONE = 'Asia/Beirut';

const inZone = (iso: string, timeZone: string): DateTime => {
  const dt = DateTime.fromISO(iso, { zone: timeZone });
  if (dt.isValid) return dt;
  return DateTime.fromISO(iso, { zone: FALLBACK_ZONE });
};

/** "10:30": HH:mm 24 h, Latin digits, in the BUSINESS time zone (never the viewer's). */
export function formatFreeTime(iso: string, timeZone: string): string {
  return inZone(iso, timeZone).setLocale('en').toFormat('HH:mm');
}

export type ChipDay = { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'weekday'; text: string };

/**
 * The text of the outlined chip on a hero row: today, tomorrow or the weekday ("Mon"), and HH:mm, both on the
 * BUSINESS calendar and clock, Latin digits. The next free time is within 7 days, so a weekday is unambiguous.
 */
export function chipTime(iso: string, timeZone: string, now: Date, locale: string): { day: ChipDay; time: string } {
  const at = inZone(iso, timeZone);
  const label = dayLabel(iso, timeZone, now, locale);
  const time = formatFreeTime(iso, timeZone);
  if (label.kind === 'today' || label.kind === 'tomorrow') return { day: { kind: label.kind }, time };
  const loc = locale === 'ar' ? 'ar-u-nu-latn' : 'en';
  return { day: { kind: 'weekday', text: at.setLocale(loc).toFormat('ccc') }, time };
}

export type DayLabel = { kind: 'today' | 'tomorrow' } | { kind: 'date'; text: string };
type DayLabelOut = { kind: 'today' | 'tomorrow'; text?: undefined } | { kind: 'date'; text: string };

/**
 * Which day a free time falls on, by the BUSINESS calendar: today, tomorrow, or "Sat 7 Nov" (weekday and date in
 * the locale, Latin digits). `now` is injected.
 */
export function dayLabel(iso: string, timeZone: string, now: Date, locale: string): DayLabelOut {
  const at = inZone(iso, timeZone);
  const today = DateTime.fromJSDate(now, { zone: at.zone }).startOf('day');
  const diff = Math.round(at.startOf('day').diff(today, 'days').days);
  if (diff === 0) return { kind: 'today' };
  if (diff === 1) return { kind: 'tomorrow' };
  const loc = locale === 'ar' ? 'ar-u-nu-latn' : 'en';
  return { kind: 'date', text: at.setLocale(loc).toFormat('ccc d LLL') };
}
