'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { describedByIds, FieldShell } from '@/components/ui/Field';
import { PHONE_MAX } from '@/lib/booking/errors';
import { COUNTRIES } from '@/lib/booking/phone';
import { cn } from '@/lib/cn';

const control =
  'h-[52px] rounded-input border bg-surface px-3.5 text-base text-ink transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-60';

/** Country-code select (+961 first) beside the national number. Both are LTR data inside Arabic text. */
export function PhoneField({
  dial,
  onDialChange,
  value,
  onChange,
  error,
  disabled,
}: {
  dial: string;
  onDialChange: (dial: string) => void;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('booking.details');
  const id = useId();
  const border = error ? 'border-danger' : 'border-line';
  return (
    <FieldShell id={id} label={t('phone')} error={error}>
      <div className="flex gap-2" dir="ltr">
        <select
          aria-label={t('countryCode')}
          name="dial"
          value={dial}
          disabled={disabled}
          onChange={(e) => onDialChange(e.target.value)}
          className={cn(control, border, 'w-[104px] shrink-0')}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.dial}>
              {c.dial}
            </option>
          ))}
        </select>
        <input
          id={id}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          dir="ltr"
          maxLength={PHONE_MAX}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds(id, error, undefined, undefined)}
          className={cn(control, border, 'min-w-0 flex-1')}
        />
      </div>
    </FieldShell>
  );
}
