'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { splitMinutes } from '@/lib/setup/duration';

const CURRENCY_SYMBOL = '$';

/** Shared number, money and duration formatting for the setup screens (Latin digits, USD). */
export function useAppFormat() {
  const format = useFormatter();
  const t = useTranslations('app.format');

  /** "$15" or "$12.50": symbol first, Latin digits, same in both languages (no currency conversion happens). */
  const money = (price: number) => {
    const amount = format.number(price, {
      minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
      maximumFractionDigits: 2,
      numberingSystem: 'latn',
    });
    return `${CURRENCY_SYMBOL}${amount}`;
  };

  /** "30 min", "2 h", "1 h 30" (the board's style). */
  const duration = (minutes: number) => {
    const { hours, minutes: rest } = splitMinutes(minutes);
    if (hours === 0) return t('min', { count: rest });
    if (rest === 0) return t('hours', { count: hours });
    return t('hoursMin', { hours, minutes: rest });
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

  const currencySymbol = () => CURRENCY_SYMBOL;

  return { money, duration, longDuration, currencySymbol, format };
}
