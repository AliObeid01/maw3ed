'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAppSession } from '@/components/app/SessionContext';
import { useErrorMessage } from '@/components/app/states';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { putBaseline, type Baseline } from '@/lib/api/pilot';
import { todayIn } from '@/lib/dashboard/agenda';
import {
  serverFieldErrors,
  validateBaseline,
  valuesFromBaseline,
  type BaselineErrors,
  type BaselineField,
  type BaselineValues,
} from '@/lib/pilot/baselineForm';

const ORDER: BaselineField[] = ['fromDate', 'toDate', 'appointments', 'noShows', 'lateCancels'];

function CountInput({
  name,
  label,
  hint,
  error,
  value,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <Input
      name={name}
      label={label}
      hint={hint}
      error={error}
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

/** Board 4.8 side card: the owner's pre-pilot numbers, to compare the pilot against. */
export function BaselineForm({
  baseline,
  definition,
  onSaved,
}: {
  baseline: Baseline | null;
  /** The server's wording of what "appointments" means (English); other languages use the translated copy. */
  definition?: string;
  onSaved: () => void;
}) {
  const t = useTranslations('app.pilot.baseline');
  const locale = useLocale();
  const { timezone } = useAppSession();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [values, setValues] = useState<BaselineValues>(() => valuesFromBaseline(baseline));
  const [errors, setErrors] = useState<BaselineErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const today = todayIn(timezone);
  const formRef = useRef<HTMLFormElement>(null);

  const set = (field: BaselineField) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const err = (field: BaselineField) => (errors[field] ? t(`errors.${errors[field]}`) : undefined);

  const focusFirst = (found: BaselineErrors) => {
    const first = ORDER.find((f) => found[f]);
    if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    setFormError(undefined);
    const result = validateBaseline(values, today);
    if (!result.ok) {
      setErrors(result.errors);
      focusFirst(result.errors);
      return;
    }
    setErrors({});
    busy.current = true;
    setSaving(true);
    try {
      await putBaseline(result.body);
      toast.show(t('saved'));
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const mapped = serverFieldErrors(error.fields);
        setErrors(mapped);
        setFormError(Object.keys(mapped).length === 0 ? errorMessage(error) : undefined);
        focusFirst(mapped);
      } else {
        setFormError(errorMessage(error));
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const count = (field: BaselineField, label: string, hint?: string) => ({
    name: field,
    label,
    hint,
    error: err(field),
    value: values[field],
    onChange: (value: string) => set(field)(value),
    disabled: saving,
  });

  const fields = {
    appointments: count('appointments', t('appointments')),
    noShows: count('noShows', t('noShows')),
    lateCancels: count('lateCancels', t('lateCancels'), t('lateCancelsHint')),
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Input
          name="fromDate"
          type="date"
          max={today}
          label={t('from')}
          error={err('fromDate')}
          autoComplete="off"
          value={values.fromDate}
          onChange={(e) => set('fromDate')(e.target.value)}
          disabled={saving}
          className="px-3"
        />
        <Input
          name="toDate"
          type="date"
          max={today}
          label={t('to')}
          error={err('toDate')}
          autoComplete="off"
          value={values.toDate}
          onChange={(e) => set('toDate')(e.target.value)}
          disabled={saving}
          className="px-3"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <CountInput {...fields.appointments} />
        <CountInput {...fields.noShows} />
      </div>
      <p className="m-0 -mt-1 text-[13px] leading-normal text-muted">
        {locale === 'en' && definition ? definition : t('definition')}
      </p>
      <CountInput {...fields.lateCancels} />
      {formError ? (
        <p role="alert" className="m-0 text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <Button type="submit" variant={baseline ? 'secondary' : 'primary'} size="lg" block loading={saving}>
        {baseline ? t('update') : t('save')}
      </Button>
    </form>
  );
}
