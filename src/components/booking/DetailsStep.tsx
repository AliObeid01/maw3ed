'use client';

import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FormEvent, Ref, RefObject } from 'react';
import { FormBanner } from '@/components/auth/formKit';
import { Input } from '@/components/ui/Field';
import type { BookingBanner, DetailsErrors } from '@/lib/booking/errors';
import { PhoneField } from './PhoneField';
import { StepHeading } from './StepHeading';

export type DetailsValues = { name: string; dial: string; phone: string; email: string };

/** Board 1.4: name, mobile with country code, optional email, the consent line and the two reminder times. */
export function DetailsStep({
  values,
  onChange,
  errors,
  banner,
  bannerAction,
  pending,
  onSubmit,
  onBack,
  formRef,
  headingRef,
  reminders,
}: {
  values: DetailsValues;
  onChange: (patch: Partial<DetailsValues>) => void;
  errors: DetailsErrors;
  banner?: BookingBanner;
  bannerAction?: React.ReactNode;
  pending: boolean;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
  formRef: RefObject<HTMLFormElement | null>;
  headingRef: Ref<HTMLHeadingElement>;
  /** Already formatted in the business timezone. */
  reminders: { first?: string; second?: string };
}) {
  const t = useTranslations('booking.details');
  const tErr = useTranslations('booking.errors');
  const err = (key?: NonNullable<DetailsErrors[keyof DetailsErrors]>) =>
    key ? tErr(key) : undefined;

  return (
    <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
      <StepHeading title={t('title')} onBack={onBack} headingRef={headingRef} />
      <form
        id="booking-form"
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4.5 rounded-card border border-line bg-surface p-5 md:p-6"
      >
        <FormBanner message={banner ? tErr(banner) : undefined} action={bannerAction} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            name="name"
            label={t('name')}
            autoComplete="name"
            value={values.name}
            disabled={pending}
            error={err(errors.name)}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <PhoneField
            dial={values.dial}
            onDialChange={(dial) => onChange({ dial })}
            value={values.phone}
            onChange={(phone) => onChange({ phone })}
            error={err(errors.phone)}
            disabled={pending}
          />
        </div>
        <Input
          name="email"
          type="email"
          label={t('email')}
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          value={values.email}
          disabled={pending}
          error={err(errors.email)}
          onChange={(e) => onChange({ email: e.target.value })}
        />
        <p className="m-0 flex items-start gap-2 text-sm text-muted">
          <BellRing size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
          <span>{t('consent')}</span>
        </p>
        {/* Lets Enter submit; the visible buttons live in the summary bar / card. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />
      </form>
      <div className="flex flex-col gap-2 rounded-[20px] bg-canvas p-4 text-sm">
        {[
          { label: t('reminder1'), when: reminders.first },
          { label: t('reminder2'), when: reminders.second },
        ]
          .filter((r) => r.when)
          .map((r) => (
            <div key={r.label} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <span className="text-muted">{r.label}</span>
              <span className="font-medium">{r.when}</span>
            </div>
          ))}
        <span className="text-muted">{t('reminderNote')}</span>
      </div>
    </section>
  );
}
