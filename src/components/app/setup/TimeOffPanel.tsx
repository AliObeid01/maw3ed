'use client';

import { CircleAlert, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { DateTimeField } from '@/components/ui/DateTimeFields';
import { Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  TIME_OFF_REASONS,
  createTimeOff,
  deleteTimeOff,
  type TimeOff,
  type TimeOffReason,
} from '@/lib/api/setup';
import { errorKey } from '@/lib/setup/errors';
import { formatClock } from '@/lib/time/clock';
import { allDayLastDay, isAllDay, resolveLocalToUtc, type LocalResolution } from '@/lib/setup/time';
import { useAppSession } from '../SessionContext';
import { useErrorMessage } from '../states';

type FieldKey = 'from' | 'to';

/** Board 3.7 "Time off": existing entries (amber pills), then From / To (business timezone) and Add. */
export function TimeOffPanel({
  staffId,
  items,
  onChange,
}: {
  staffId: string;
  items: TimeOff[];
  /** Functional update so overlapping add/remove requests never overwrite each other. */
  onChange: (update: (current: TimeOff[]) => TimeOff[]) => void;
}) {
  const t = useTranslations('app.hours.timeOff');
  const errorText = useErrorMessage();
  const toast = useToast();
  const format = useFormatter();
  const { timezone } = useAppSession();
  const formRef = useRef<HTMLFormElement>(null);

  const [fromDate, setFromDate] = useState('');
  const [fromTime, setFromTime] = useState('09:00');
  const [toDate, setToDate] = useState('');
  const [toTime, setToTime] = useState('17:00');
  const from = fromDate ? `${fromDate}T${fromTime}` : '';
  const to = toDate ? `${toDate}T${toTime}` : '';
  const [reason, setReason] = useState<TimeOffReason>('VACATION');
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [banner, setBanner] = useState<string>();
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const date = (iso: string) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: timezone,
    });
  const time = (iso: string) => formatClock(iso, timezone);

  const describe = (item: TimeOff) => {
    if (isAllDay(item.startAt, item.endAt, timezone)) {
      const first = date(item.startAt);
      const last = date(allDayLastDay(item.endAt, timezone).toISOString());
      return t('allDay', { range: first === last ? first : `${first} – ${last}` });
    }
    const sameDay = date(item.startAt) === date(item.endAt);
    return sameDay
      ? t('sameDay', { date: date(item.startAt), from: time(item.startAt), to: time(item.endAt) })
      : t('span', {
          from: `${date(item.startAt)} ${time(item.startAt)}`,
          to: `${date(item.endAt)} ${time(item.endAt)}`,
        });
  };

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-banner]')
        ?.focus(),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setBanner(undefined);
    const start: LocalResolution | null = from ? resolveLocalToUtc(from, timezone) : null;
    const end: LocalResolution | null = to ? resolveLocalToUtc(to, timezone) : null;
    const startAt = start?.ok ? start.iso : null;
    const endAt = end?.ok ? end.iso : null;
    const next: Partial<Record<FieldKey, string>> = {};
    // A time skipped by the spring-forward change is named, not silently moved an hour.
    const missing = (r: LocalResolution | null) =>
      r && !r.ok && r.reason === 'nonexistent' ? t('errors.nonexistent') : t('errors.required');
    if (!startAt) next.from = missing(start);
    if (!endAt) next.to = missing(end);
    if (startAt && endAt && new Date(endAt) <= new Date(startAt))
      next.to = t('errors.endBeforeStart');
    setErrors(next);
    if (!startAt || !endAt || Object.keys(next).length > 0) {
      focusFirstInvalid();
      return;
    }
    setPending(true);
    try {
      const created = await createTimeOff(staffId, { startAt, endAt, reason });
      onChange((current) => [...current, created]);
      setFromDate('');
      setToDate('');
      toast.show(t('added'));
    } catch (error) {
      setBanner(errorKey(error) === 'validation' ? t('errors.checkDates') : errorText(error));
      focusFirstInvalid();
    } finally {
      setPending(false);
    }
  };

  const remove = async (item: TimeOff) => {
    if (removingId) return;
    setRemovingId(item.id);
    try {
      await deleteTimeOff(staffId, item.id);
      onChange((current) => current.filter((i) => i.id !== item.id));
      toast.show(t('removed'));
    } catch (error) {
      toast.show(errorText(error), 'error');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card
      as="aside"
      aria-labelledby="time-off-title"
      padding="none"
      className="flex w-full max-w-none flex-[1_1_300px] flex-col gap-3.5 p-[22px] lg:max-w-[380px]"
    >
      <h2 id="time-off-title" className="m-0 text-lg font-semibold">
        {t('title')}
      </h2>

      {items.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2.5 rounded-input bg-warning-soft py-0.5 ps-3 pe-1"
            >
              <span className="flex-1 py-2 text-[15px] font-medium text-warning-deep">
                <bdi>{describe(item)}</bdi>
              </span>
              <button
                type="button"
                aria-label={t('remove')}
                aria-busy={removingId === item.id || undefined}
                disabled={removingId !== null}
                onClick={() => remove(item)}
                className="flex size-11 shrink-0 items-center justify-center rounded-pill text-warning-deep transition-colors duration-200 ease-out hover:bg-white/50 disabled:opacity-60"
              >
                <X size={18} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        {banner ? (
          <div role="alert" tabIndex={-1} data-form-banner className="rounded-[20px] outline-none">
            <Callout tone="danger" icon={<CircleAlert />}>
              {banner}
            </Callout>
          </div>
        ) : null}
        <DateTimeField
          label={t('from')}
          name="from"
          date={fromDate}
          time={fromTime}
          onDateChange={setFromDate}
          onTimeChange={setFromTime}
          error={errors.from}
        />
        <DateTimeField
          label={t('to')}
          name="to"
          date={toDate}
          time={toTime}
          onDateChange={setToDate}
          onTimeChange={setToTime}
          error={errors.to}
          hint={t('timezoneHint', { timezone: timezone.replace(/_/g, ' ') })}
        />
        <Select
          label={t('reason')}
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as TimeOffReason)}
        >
          {TIME_OFF_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(`reasons.${value}`)}
            </option>
          ))}
        </Select>
        <Button
          type="submit"
          variant="ghost"
          size="row"
          block
          loading={pending}
          className="bg-brand-avatar"
        >
          {t('add')}
        </Button>
      </form>
    </Card>
  );
}
