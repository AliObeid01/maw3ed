'use client';

import { DateTime } from 'luxon';
import { useFormatter } from 'next-intl';
import { useAppFormat } from '@/lib/useAppFormat';

const LATIN = { numberingSystem: 'latn' } as const;

/** A local `yyyy-MM-dd` as a Date that formats the same calendar day in UTC (no timezone drift). */
const ymdDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

/**
 * Dates, times and prices for the public pages. Instants are shown in the business timezone (never the device's),
 * with Latin digits in both languages so times and phones stay copyable.
 */
export function useBookingFormat(timezone: string) {
  const format = useFormatter();
  const { money, duration } = useAppFormat();
  const zoned = { ...LATIN, timeZone: timezone } as const;
  const utc = { ...LATIN, timeZone: 'UTC' } as const;
  const time = (iso: string) =>
    DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone).toFormat('H:mm');

  return {
    money,
    duration,
    /** "9:00" / "10:30": 24-hour, Latin digits in both languages (Luxon, so it never depends on the ICU locale). */
    time,
    /** "Thu 29 Oct" */
    day: (iso: string) =>
      format.dateTime(new Date(iso), {
        ...zoned,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    /** "Thu, 29 October" for the cutoff and long sentences */
    dayLong: (iso: string) =>
      format.dateTime(new Date(iso), { ...zoned, weekday: 'long', day: 'numeric', month: 'long' }),
    /** Same as `day` for a local date string. */
    ymd: (ymd: string) =>
      format.dateTime(ymdDate(ymd), { ...utc, weekday: 'short', day: 'numeric', month: 'short' }),
    weekday: (ymd: string) => format.dateTime(ymdDate(ymd), { ...utc, weekday: 'short' }),
    dayNumber: (ymd: string) => format.dateTime(ymdDate(ymd), { ...utc, day: 'numeric' }),
    /** "28 Oct" */
    dayMonth: (ymd: string) =>
      format.dateTime(ymdDate(ymd), { ...utc, day: 'numeric', month: 'short' }),
    /** "Oct" and "29" for the date tile on the link pages. */
    month: (iso: string) => format.dateTime(new Date(iso), { ...zoned, month: 'short' }),
    dayOfMonth: (iso: string) => format.dateTime(new Date(iso), { ...zoned, day: 'numeric' }),
    /** "Wed 28 Oct, 10:30" for cutoffs. */
    dayAndTime: (iso: string) =>
      `${format.dateTime(new Date(iso), { ...zoned, weekday: 'short', day: 'numeric', month: 'short' })}, ${time(iso)}`,
  };
}
