'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { splitMinutes } from '@/lib/setup/duration';

/** Shared number, money and duration formatting for the setup screens (Latin digits, USD). */
export function useAppFormat() {
  const format = useFormatter();
  const t = useTranslations('app.format');

  const money = (price: number) =>
    format.number(price, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
      maximumFractionDigits: 2,
      numberingSystem: 'latn',
    });

  /** "30 min", "2 h", "1 h 30" (the board's style). */
  const duration = (minutes: number) => {
    const { hours, minutes: rest } = splitMinutes(minutes);
    const total = hours;
    if (total === 0) return t('min', { count: rest });
    if (rest === 0) return t('hours', { count: total });
    return t('hoursMin', { hours: total, minutes: rest });
  };

  /** Longer wording for the booking-rule hints: "1 day 2 hours". */
  const longDuration = (minutes: number) => {
    const { days, hours, minutes: rest } = splitMinutes(minutes);
    const parts: string[] = [];
    if (days) parts.push(t('days', { count: days }));
    if (hours) parts.push(t('hoursLong', { count: hours }));
    if (rest || parts.length === 0) parts.push(t('minutesLong', { count: rest }));
    return parts.join(' ');
  };

  const currencySymbol = () =>
    format
      .number(0, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' })
      .replace(/[\d.,\s‏]/g, '');

  return { money, duration, longDuration, currencySymbol, format };
}
