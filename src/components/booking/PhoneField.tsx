'use client';

import { useId, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { control, describedByIds, FieldShell, ltrNumericEnd } from '@/components/ui/Field';
import { Select, type SelectOption } from '@/components/ui/Select';
import { PHONE_MAX } from '@/lib/booking/errors';
import { COUNTRIES } from '@/lib/booking/phone';
import { cn } from '@/lib/cn';


/** Country-code select (+961 first) beside the national number. Both are LTR data inside Arabic text. */
export function PhoneField({
  dial,
  onDialChange,
  value,
  onChange,
  error,
  disabled,
  id: idProp,
}: {
  dial: string;
  onDialChange: (dial: string) => void;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  id?: string;
}) {
  const t = useTranslations('booking.details');
  const auto = useId();
  const id = idProp ?? auto;
  const border = error ? 'border-danger' : 'border-line';
  const locale = useLocale();
  const options = useMemo<SelectOption[]>(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    // Keep "+961" in reading order inside Arabic text (an isolate, not a hidden character in the data).
    const dialText = (dial: string) => (locale === 'ar' ? `⁦${dial}⁩` : dial);
    return COUNTRIES.map((c) => {
      const name = names.of(c.code) ?? c.code;
      return {
        value: c.dial,
        label: `${dialText(c.dial)}  ${name}`,
        shortLabel: dialText(c.dial),
        searchText: `${c.dial} ${name} ${c.code}`,
      };
    });
  }, [locale]);
  return (
    <FieldShell id={id} label={t('phone')} error={error}>
      <div className="flex gap-2" dir="ltr">
        <Select
          bare
          searchable
          label={t('countryCode')}
          name="dial"
          value={dial}
          disabled={disabled}
          onChange={onDialChange}
          options={options}
          menuWidth={288}
          className="w-[104px] shrink-0 px-3"
          wrapperClassName="shrink-0"
        />
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
          className={cn(control, border, 'min-w-0 flex-1', ltrNumericEnd)}
        />
      </div>
    </FieldShell>
  );
}
