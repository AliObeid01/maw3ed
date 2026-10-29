'use client';

import { Bell, Compass, WifiOff } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookingSummary, type SummaryRow } from '@/components/public/BookingSummary';
import { BusinessHero } from '@/components/public/BusinessHero';
import { PageState } from '@/components/public/PageState';
import { StepRail, type Step } from '@/components/public/StepRail';
import { StickySummaryBar } from '@/components/public/StickySummaryBar';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/auth';
import {
  createBooking,
  getPublicBusiness,
  type BookingBody,
  type BookingResult,
  type Slot,
} from '@/lib/api/booking';
import { useResource } from '@/lib/api/useResource';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { createAttemptKeys } from '@/lib/booking/attempt';
import {
  classifyBookingError,
  validateDetails,
  type BookingBanner,
  type DetailsErrors,
} from '@/lib/booking/errors';
import { assemblePhone, DEFAULT_DIAL } from '@/lib/booking/phone';
import {
  dayWindow,
  findSlotByLocalTime,
  firstDayWithSlots,
  localDay,
  localTime,
  replaceDay,
} from '@/lib/booking/slots';
import {
  backParams,
  parseBookingParams,
  resolveBookingState,
  serialiseBookingParams,
  type BookingParams,
} from '@/lib/booking/urlState';
import { loadSlotWindow } from '@/lib/booking/window';
import { useLocaleHint } from '@/lib/useLocaleHint';
import { BookedView } from './BookedView';
import { DetailsStep, type DetailsValues } from './DetailsStep';
import { ServiceSkeleton, ServiceStep } from './ServiceStep';
import { StaffStep } from './StaffStep';
import { TimeStep, type TakenInfo } from './TimeStep';
import { useBookingFormat } from './useBookingFormat';

const HOUR = 3_600_000;
const mainClass =
  'mx-auto flex w-full max-w-[1240px] flex-1 flex-wrap items-start gap-6 px-4 pt-5 pb-28 md:px-8 md:pt-7 lg:pb-10';

type BookedState = { result: BookingResult; name: string; hasEmail: boolean };
type FreshDays = { key: string; days: Record<string, Slot[]> };

/** The public booking flow (boards 1.1 to 1.6) at /b/[slug]. State lives in the URL so Back works and links are shareable. */
export function BookingFlow({ slug }: { slug: string }) {
  const t = useTranslations('booking');
  const tSum = useTranslations('booking.summary');
  const tEmpty = useTranslations('public.summary')('empty');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const business = useResource((signal) => getPublicBusiness(slug, signal), slug);
  const data = business.data;
  const timezone = data?.business.timezone ?? 'UTC';
  const f = useBookingFormat(timezone);
  useLocaleHint(data?.business.locale, '/b');

  const [now] = useState(() => new Date());
  const searchText = search.toString();
  const resolved = useMemo(
    () =>
      data ? resolveBookingState(parseBookingParams(new URLSearchParams(searchText)), data) : undefined,
    [data, searchText],
  );

  // ---- slots: one 14-day request per service + person --------------------------------------
  const ready = !!(resolved?.serviceId && resolved.staffId);
  const slotKey = `${ready}:${resolved?.serviceId}:${resolved?.staffId}`;
  const windowRes = useResource(
    async (signal) =>
      ready
        ? loadSlotWindow(
            slug,
            {
              serviceId: resolved!.serviceId!,
              staffId: resolved!.staffId === 'anyone' ? undefined : resolved!.staffId,
            },
            timezone,
            now,
            signal,
          )
        : null,
    slotKey,
  );
  const [fresh, setFresh] = useState<FreshDays>({ key: '', days: {} });
  const byDay = useMemo(
    () => ({ ...windowRes.data?.byDay, ...(fresh.key === slotKey ? fresh.days : {}) }),
    [windowRes.data, fresh, slotKey],
  );
  const days = useMemo(() => dayWindow(now, timezone), [now, timezone]);
  const selectedDay = resolved?.day ?? firstDayWithSlots(days, byDay);
  const selectedSlot =
    selectedDay && resolved?.time
      ? findSlotByLocalTime(byDay[selectedDay] ?? [], timezone, resolved.time)
      : undefined;

  // ---- details, submit state ----------------------------------------------------------------
  const [values, setValues] = useState<DetailsValues>({
    name: '',
    dial: DEFAULT_DIAL,
    phone: '',
    email: '',
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [banner, setBanner] = useState<BookingBanner>();
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [taken, setTaken] = useState<TakenInfo>();
  const [booked, setBooked] = useState<BookedState>();
  const guard = useRef(createSubmitGuard());
  const attempts = useRef(createAttemptKeys());
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (tick === 0) return;
    const form = formRef.current;
    const target =
      form?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form?.querySelector<HTMLElement>('[data-form-banner]');
    target?.focus();
  }, [tick]);

  // Move focus to the new step's heading so screen readers announce it.
  const step = resolved?.step;
  const stepKey = `${step}:${taken ? 'taken' : ''}:${booked ? 'booked' : ''}`;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepKey]);

  const go = (next: BookingParams, mode: 'push' | 'replace' = 'push') =>
    router[mode](`${pathname}${serialiseBookingParams(next)}`, { scroll: false });
  const base = { service: resolved?.serviceId, staff: resolved?.staffId };

  // ---- loading and failure of the business ---------------------------------------------------
  if (!data || !resolved) {
    if (business.error) {
      const notFound = business.error instanceof ApiError && business.error.status === 404;
      return notFound ? (
        <PageState
          icon={<Compass size={26} />}
          title={t('notFound.title')}
          body={t('notFound.body')}
          action={
            <ButtonLink href="/" size="lg" block>
              {t('notFound.action')}
            </ButtonLink>
          }
        />
      ) : (
        <PageState
          role="alert"
          tone="warning"
          icon={<WifiOff size={26} />}
          title={t('loadFailed.title')}
          body={t('loadFailed.body')}
          action={
            <Button size="lg" block onClick={business.reload}>
              {t('loadFailed.retry')}
            </Button>
          }
        />
      );
    }
    return <FlowSkeleton label={t('loading')} />;
  }

  // ---- derived view data ---------------------------------------------------------------------
  const service = data.services.find((s) => s.id === resolved.serviceId);
  const person = data.staff.find((p) => p.id === resolved.staffId);
  const staffLabel = resolved.staffId === 'anyone' ? t('anyone') : person?.displayName;
  const whenLabel = selectedSlot
    ? tSum('whenValue', { date: f.day(selectedSlot.startAt), time: f.time(selectedSlot.startAt) })
    : undefined;
  const price = service ? f.money(service.price) : undefined;

  const stepIds = ['service', ...(resolved.staffSkipped ? [] : ['staff']), 'time', 'details'] as const;
  const labelFor = (id: (typeof stepIds)[number]) => t(`steps.${id}`);
  const valueFor = (id: (typeof stepIds)[number]) =>
    id === 'service'
      ? service?.name
      : id === 'staff'
        ? staffLabel
        : id === 'time'
          ? whenLabel
          : values.name.trim() || undefined;
  const steps: Step[] = stepIds.map((id) => ({ id, label: labelFor(id), value: valueFor(id) }));
  const currentIndex = Math.max(0, stepIds.indexOf(resolved.step)) + 1;

  const rows: SummaryRow[] = [
    {
      id: 'service',
      label: tSum('service'),
      value: service
        ? tSum('serviceValue', { name: service.name, duration: f.duration(service.durationMin) })
        : undefined,
      empty: t('notChosen'),
    },
    { id: 'with', label: tSum('with'), value: staffLabel, empty: t('notChosen') },
    { id: 'when', label: tSum('when'), value: whenLabel, empty: tEmpty },
    { id: 'price', label: tSum('price'), value: price, empty: tEmpty },
  ];

  // ---- actions -------------------------------------------------------------------------------
  const back = () => {
    const target = backParams(resolved);
    if (target) {
      setTaken(undefined);
      go(target);
    }
  };

  const pickDay = (day: string) =>
    go({ step: 'time', ...base, day }, 'replace');
  const pickSlot = (slot: Slot) =>
    go(
      {
        step: 'time',
        ...base,
        day: localDay(slot.startAt, timezone),
        time: localTime(slot.startAt, timezone),
      },
      'replace',
    );
  const toDetails = () => {
    setTaken(undefined);
    go({ step: 'details', ...base, day: selectedDay, time: resolved.time });
  };

  async function submit() {
    if (!resolved || !resolved.serviceId || !resolved.staffId || !selectedSlot) return;
    const found = validateDetails(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setBanner('fixFields');
      setTick((n) => n + 1);
      if (resolved.step !== 'details') toDetails();
      return;
    }
    if (!guard.current.tryStart()) return;
    setPending(true);
    setErrors({});
    setBanner(undefined);

    const email = values.email.trim();
    const body: BookingBody = {
      serviceId: resolved.serviceId,
      staffId: resolved.staffId,
      startAt: selectedSlot.startAt,
      client: {
        name: values.name.trim(),
        phone: assemblePhone(values.dial, values.phone),
        ...(email ? { email } : {}),
      },
    };
    // One key per attempt: a retry of this same booking reuses it, a changed slot or detail gets a new one.
    const key = attempts.current.keyFor(body);
    try {
      const result = await createBooking(slug, body, key);
      attempts.current.reset();
      setTaken(undefined);
      setBooked({ result, name: body.client.name, hasEmail: !!email });
      router.replace(pathname, { scroll: false });
      window.scrollTo({ top: 0 });
    } catch (error) {
      const failure = classifyBookingError(error);
      guard.current.release();
      setPending(false);
      if (failure.kind === 'slotTaken') {
        showTaken(body.startAt, failure.slots);
        return;
      }
      if (failure.newAttempt) attempts.current.reset();
      setErrors(failure.fields);
      setBanner(failure.banner);
      setTick((n) => n + 1);
    }
  }

  /** Board 1.6: show the fresh slots from the 409 payload (no extra request) and pre-select the closest one. */
  function showTaken(startAt: string, slots: Slot[]) {
    const day = localDay(startAt, timezone);
    const merged = replaceDay(byDay, day, slots, timezone);
    setFresh({ key: slotKey, days: { ...(fresh.key === slotKey ? fresh.days : {}), [day]: merged[day]! } });
    setTaken({ time: f.time(startAt), day });
    const at = Date.parse(startAt);
    const closest = [...(merged[day] ?? [])].sort(
      (a, b) => Math.abs(Date.parse(a.startAt) - at) - Math.abs(Date.parse(b.startAt) - at),
    )[0];
    go(
      {
        step: 'time',
        ...base,
        day,
        time: closest ? localTime(closest.startAt, timezone) : undefined,
      },
      'replace',
    );
  }

  /** The CTA sits outside the form (summary bar / side card): submit through the browser so validation and Enter behave the same. */
  const submitForm = () =>
    (document.getElementById('booking-form') as HTMLFormElement | null)?.requestSubmit();

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const another = () => {
    guard.current = createSubmitGuard();
    attempts.current.reset();
    setBooked(undefined);
    go({});
  };

  // ---- render --------------------------------------------------------------------------------
  const hero = (
    <BusinessHero
      name={data.business.name}
      meta={[data.business.category, data.business.address].filter(Boolean).join(' · ')}
      facts={[t('heroFactReminders')]}
    />
  );

  if (booked) {
    return (
      <>
        {hero}
        <p role="status" className="sr-only">
          {t('bookedAnnounce')}
        </p>
        <main className={mainClass.replace('pb-28', 'pb-10')}>
          <BookedView
            result={booked.result}
            clientName={booked.name}
            hasEmail={booked.hasEmail}
            timezone={timezone}
            now={now}
            onAnother={another}
          />
        </main>
      </>
    );
  }

  const onTimeStep = resolved.step === 'time' && !taken;
  const onDetailsStep = resolved.step === 'details';
  const cta = onTimeStep
    ? { label: t('cta.continue'), disabled: !selectedSlot, onClick: toDetails }
    : onDetailsStep
      ? {
          label: t('cta.confirm'),
          disabled: false,
          onClick: submitForm,
        }
      : undefined;
  const retryable = banner === 'network' || banner === 'generic' || banner === 'tooMany';
  const startMs = selectedSlot ? Date.parse(selectedSlot.startAt) : undefined;
  const reminderAt = (hours: number) =>
    startMs !== undefined && startMs - hours * HOUR > now.getTime()
      ? tSum('whenValue', {
          date: f.day(new Date(startMs - hours * HOUR).toISOString()),
          time: f.time(new Date(startMs - hours * HOUR).toISOString()),
        })
      : undefined;

  return (
    <>
      {hero}
      <p role="status" className="sr-only">
        {t('stepAnnounce', {
          current: currentIndex,
          total: stepIds.length,
          label: labelFor(stepIds[currentIndex - 1]!),
        })}
      </p>
      <main className={mainClass}>
        <StepRail steps={steps} current={currentIndex} onBack={back} />

        {resolved.step === 'service' ? (
          <ServiceStep
            data={data}
            headingRef={headingRef}
            onChoose={(id) => go({ service: id })}
          />
        ) : null}
        {resolved.step === 'staff' ? (
          <StaffStep
            eligible={resolved.eligible}
            headingRef={headingRef}
            onBack={back}
            onChoose={(id) => go({ service: resolved.serviceId, staff: id })}
          />
        ) : null}
        {resolved.step === 'time' ? (
          <TimeStep
            timezone={timezone}
            now={now}
            days={days}
            byDay={byDay}
            loading={windowRes.loading}
            failed={!!windowRes.error}
            onRetry={windowRes.reload}
            day={selectedDay}
            time={resolved.time}
            onPickDay={pickDay}
            onPickSlot={pickSlot}
            onBack={back}
            headingRef={headingRef}
            taken={taken}
            onBookInstead={() => void submit()}
            onSeeOtherDays={() => setTaken(undefined)}
            submitting={pending}
          />
        ) : null}
        {onDetailsStep ? (
          <DetailsStep
            values={values}
            onChange={(patch) => {
              setValues((v) => ({ ...v, ...patch }));
              const touched = Object.keys(patch) as (keyof DetailsValues)[];
              setErrors((e) => {
                const next = { ...e };
                for (const k of touched) if (k !== 'dial') delete next[k];
                return next;
              });
            }}
            errors={errors}
            banner={banner}
            bannerAction={
              retryable ? (
                <Button variant="secondary" onClick={() => void submit()} loading={pending}>
                  {t('errors.retry')}
                </Button>
              ) : undefined
            }
            pending={pending}
            onSubmit={onFormSubmit}
            onBack={back}
            formRef={formRef}
            headingRef={headingRef}
            reminders={{ first: reminderAt(24), second: reminderAt(2) }}
          />
        ) : null}

        <aside className="hidden max-w-[290px] flex-[1_1_240px] flex-col gap-3.5 lg:flex">
          <BookingSummary rows={rows} />
          {cta ? (
            <Button
              size="lg"
              block
              disabled={cta.disabled}
              loading={pending && onDetailsStep}
              onClick={cta.onClick}
            >
              {cta.label}
            </Button>
          ) : null}
          <Callout icon={<Bell />}>{taken ? t('taken.saved') : t('side.noAccount')}</Callout>
        </aside>
      </main>
      {cta ? (
        <StickySummaryBar
          className="sticky-summary-bar"
          rows={rows}
          price={price}
          cta={cta.label}
          onCta={cta.onClick}
          ctaDisabled={cta.disabled}
          ctaLoading={pending && onDetailsStep}
        />
      ) : null}
    </>
  );
}

function FlowSkeleton({ label }: { label: string }) {
  return (
    <>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="bg-hero" aria-hidden="true">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-5 md:px-8 md:py-[26px]">
          <Skeleton className="size-12 rounded-[14px] bg-white/20 md:size-16 md:rounded-[20px]" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-48 bg-white/20" />
            <Skeleton className="h-5 w-64 bg-white/15" />
          </div>
        </div>
      </div>
      <main className={mainClass}>
        <ServiceSkeleton />
      </main>
    </>
  );
}
