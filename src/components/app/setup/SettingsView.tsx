'use client';

import { CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { PlanCard } from '@/components/billing/PlanCard';
import { DepositSettings } from './DepositSettings';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { getBusiness, updateBusiness, type Business } from '@/lib/api/setup';
import { useResource } from '@/lib/api/useResource';
import { timezoneGroups, timezoneLabel } from '@/lib/auth/timezones';
import { cn } from '@/lib/cn';
import { cutoffUnit, parseWhole } from '@/lib/setup/duration';
import {
  cutoffMinutes,
  toSettingsValues,
  type CutoffUnit,
  type SettingsValues,
} from '@/lib/setup/settingsForm';
import { errorKey, invalidFields } from '@/lib/setup/errors';
import { utcOffsetLabel } from '@/lib/setup/time';
import { HeaderActions } from '../HeaderActions';
import { StickySaveBar } from '../StickySaveBar';
import { LoadError, OwnerOnly, useErrorMessage, useSharedText } from '../states';
import { useAppFormat } from '@/lib/useAppFormat';

const FORM_ID = 'business-settings-form';
const BOOKING_PATH = '/b/';
const HEADER_SAVE_CLASS = 'hidden md:inline-flex';
const NAME_MAX = 80;
const SLOT_CHOICES = [10, 15, 30];

type NumberKey = 'window' | 'notice' | 'cutoff';

/** Number field with the board's right-aligned unit (64 px box, centred digits). */
function RuleRow({
  id,
  title,
  hint,
  unit,
  value,
  onChange,
  error,
}: {
  id: string;
  title: string;
  hint: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium">{title}</span>
          <span className="text-[13px] text-muted">{hint}</span>
        </label>
        <input
          id={id}
          name={id}
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            'h-12 w-16 shrink-0 rounded-nav border bg-surface text-center text-base tabular-nums',
            error ? 'border-danger' : 'border-line',
          )}
        />
        <span className="w-11 shrink-0 text-sm text-muted">{unit}</span>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-5 lg:grid-cols-2">
      <Skeleton className="h-[360px] rounded-card" />
      <Skeleton className="h-[360px] rounded-card" />
      <Skeleton className="h-[110px] rounded-card" />
    </div>
  );
}

function SettingsForm({
  business,
  onSaved,
}: {
  business: Business;
  onSaved: (b: Business) => void;
}) {
  const t = useTranslations('app.settings');
  const shared = useSharedText();
  const errorText = useErrorMessage();
  const toast = useToast();
  const router = useRouter();
  const { longDuration } = useAppFormat();
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();

  // Chosen once from the loaded value; see toSettingsValues for why it must not follow the saved value.
  const [unit] = useState<CutoffUnit>(() => cutoffUnit(business.cancelCutoffMin));
  const [initial] = useState(() => toSettingsValues(business, unit));
  const [values, setValues] = useState<SettingsValues>(initial);
  const [baseline, setBaseline] = useState<SettingsValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<'name' | NumberKey, string>>>({});
  const [banner, setBanner] = useState<string>();
  const [pending, setPending] = useState(false);

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const zones = useMemo(() => {
    const now = new Date();
    const groups = timezoneGroups();
    const label = (zone: string) => `${timezoneLabel(zone)} (${utcOffsetLabel(zone, now)})`;
    const all = new Set([...groups.common, ...groups.rest]);
    return {
      common: groups.common.map((z) => ({ z, label: label(z) })),
      rest: groups.rest.map((z) => ({ z, label: label(z) })),
      extra: all.has(business.timezone)
        ? null
        : { z: business.timezone, label: label(business.timezone) },
    };
  }, [business.timezone]);

  const slotChoices = [...new Set([...SLOT_CHOICES, values.slotStepMin])].sort((a, b) => a - b);

  const parsedMinutes = (key: NumberKey) =>
    key === 'cutoff' ? cutoffMinutes(values.cutoff, unit) : parseWhole(values[key]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !dirty) return;
    const next: Partial<Record<'name' | NumberKey, string>> = {};
    const name = values.name.trim();
    if (!name) next.name = t('errors.nameRequired');
    else if (name.length > NAME_MAX) next.name = t('errors.nameTooLong', { max: NAME_MAX });
    const windowDays = parseWhole(values.window);
    if (windowDays === null || windowDays < 1 || windowDays > 365)
      next.window = t('errors.range', { min: 1, max: 365 });
    const notice = parsedMinutes('notice');
    if (notice === null || notice > 10080) next.notice = t('errors.range', { min: 0, max: 10080 });
    const cutoff = parsedMinutes('cutoff');
    if (cutoff === null || cutoff > 10080)
      next.cutoff = t('errors.range', {
        min: 0,
        max: unit === 'hours' ? 168 : 10080,
      });
    setErrors(next);
    setBanner(undefined);
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }

    setPending(true);
    try {
      const saved = await updateBusiness({
        name,
        timezone: values.timezone,
        slotStepMin: values.slotStepMin,
        bookingWindowDays: windowDays!,
        minNoticeMin: notice!,
        cancelCutoffMin: cutoff!,
      });
      const savedValues = toSettingsValues(saved, unit);
      setValues(savedValues);
      setBaseline(savedValues);
      onSaved(saved);
      toast.show(t('saved'));
      // The shell shows the business name and the dashboard times use the timezone: refresh the server tree.
      if (saved.name !== business.name || saved.timezone !== business.timezone) router.refresh();
    } catch (error) {
      const fields = invalidFields(error);
      const serverErrors: Partial<Record<'name' | NumberKey, string>> = {};
      if (fields.includes('name')) serverErrors.name = t('errors.fieldInvalid');
      if (fields.includes('bookingWindowDays')) serverErrors.window = t('errors.fieldInvalid');
      if (fields.includes('minNoticeMin')) serverErrors.notice = t('errors.fieldInvalid');
      if (fields.includes('cancelCutoffMin')) serverErrors.cutoff = t('errors.fieldInvalid');
      setErrors(serverErrors);
      setBanner(
        errorKey(error) === 'validation' && fields.length > 0
          ? t('errors.checkFields')
          : errorText(error),
      );
    } finally {
      setPending(false);
    }
  };

  const saveButton = (props: { block?: boolean; className?: string }) => (
    <Button
      type="submit"
      form={FORM_ID}
      size={props.block ? 'lg' : 'md'}
      block={props.block}
      loading={pending}
      disabled={!dirty}
      className={props.className}
    >
      {pending ? shared.saving : t('save')}
    </Button>
  );

  return (
    <>
      <HeaderActions>{saveButton({ className: HEADER_SAVE_CLASS })}</HeaderActions>
      <form
        id={FORM_ID}
        ref={formRef}
        onSubmit={submit}
        noValidate
        className="grid grid-cols-1 content-start gap-5 lg:grid-cols-2"
      >
        {banner ? (
          <div role="alert" className="lg:col-span-2">
            <Callout tone="danger" icon={<CircleAlert />}>
              {banner}
            </Callout>
          </div>
        ) : null}

        <Card
          padding="none"
          as="section"
          aria-labelledby={`${uid}-business`}
          className="flex flex-col gap-4 p-[22px]"
        >
          <h2 id={`${uid}-business`} className="m-0 text-lg font-semibold">
            {t('business')}
          </h2>
          <Input
            label={t('field.name')}
            name="name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            autoComplete="organization"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-slug`} className="text-[15px] font-medium">
              {t('field.link')}
            </label>
            <div
              className="flex h-[52px] items-center overflow-hidden rounded-input border border-line bg-canvas"
              dir="ltr"
            >
              <span className="flex h-full items-center border-e border-line px-3 text-[15px] text-muted">
                {BOOKING_PATH}
              </span>
              <input
                id={`${uid}-slug`}
                value={business.slug}
                readOnly
                aria-describedby={`${uid}-slug-hint`}
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-3.5 text-base text-ink"
              />
            </div>
            <p id={`${uid}-slug-hint`} className="m-0 text-[13px] text-muted">
              {t('field.linkHint')}
            </p>
          </div>
          <Select
            label={t('field.timezone')}
            name="timezone"
            value={values.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            hint={t('field.timezoneHint')}
            dir="ltr"
          >
            {zones.extra ? <option value={zones.extra.z}>{zones.extra.label}</option> : null}
            <optgroup label={t('field.zonesCommon')}>
              {zones.common.map(({ z, label }) => (
                <option key={z} value={z}>
                  {label}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('field.zonesAll')}>
              {zones.rest.map(({ z, label }) => (
                <option key={z} value={z}>
                  {label}
                </option>
              ))}
            </optgroup>
          </Select>
        </Card>

        <Card
          padding="none"
          as="section"
          aria-labelledby={`${uid}-rules`}
          className="flex flex-col gap-4 p-[22px]"
        >
          <h2 id={`${uid}-rules`} className="m-0 text-lg font-semibold">
            {t('rules')}
          </h2>
          <Segmented
            label={t('field.slotStep')}
            value={values.slotStepMin}
            onChange={(v) => set('slotStepMin', v)}
            options={slotChoices.map((value) => ({
              value,
              label: t('minutes', { count: value }),
            }))}
          />
          <RuleRow
            id={`${uid}-window`}
            title={t('field.window')}
            hint={t('field.windowHint')}
            unit={t('units.days')}
            value={values.window}
            onChange={(v) => set('window', v)}
            error={errors.window}
          />
          <RuleRow
            id={`${uid}-notice`}
            title={t('field.notice')}
            hint={noticeHint(t('field.noticeHint'), parsedMinutes('notice'), longDuration, t)}
            unit={t('units.min')}
            value={values.notice}
            onChange={(v) => set('notice', v)}
            error={errors.notice}
          />
          <RuleRow
            id={`${uid}-cutoff`}
            title={t('field.cutoff')}
            hint={noticeHint(t('field.cutoffHint'), parsedMinutes('cutoff'), longDuration, t)}
            unit={unit === 'hours' ? t('units.hours') : t('units.min')}
            value={values.cutoff}
            onChange={(v) => set('cutoff', v)}
            error={errors.cutoff}
          />
        </Card>

        <DepositSettings business={business} onSaved={onSaved} />
        <PlanCard />
      </form>
      {dirty ? <StickySaveBar>{saveButton({ block: true })}</StickySaveBar> : null}
    </>
  );
}

/** "No bookings closer than this" plus "= 1 hour" once the typed value is a valid number of minutes. */
function noticeHint(
  base: string,
  minutes: number | null,
  longDuration: (m: number) => string,
  t: ReturnType<typeof useTranslations>,
) {
  return minutes === null || minutes === 0
    ? base
    : `${base} · ${t('equals', { value: longDuration(minutes) })}`;
}

export function SettingsView() {
  return (
    <OwnerOnly>
      <SettingsInner />
    </OwnerOnly>
  );
}

function SettingsInner() {
  const business = useResource(getBusiness, 'business');
  if (business.error && !business.data)
    return <LoadError error={business.error} onRetry={business.reload} />;
  if (!business.data) return <SettingsSkeleton />;
  return <SettingsForm business={business.data} onSaved={business.setData} />;
}
