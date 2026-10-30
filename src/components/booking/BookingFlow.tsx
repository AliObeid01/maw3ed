'use client';

import { Bell, Compass, Info, ShieldCheck, WifiOff } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FormBanner } from '@/components/auth/formKit';
import { BookingSummary, type SummaryRow } from '@/components/public/BookingSummary';
import { BusinessHero } from '@/components/public/BusinessHero';
import { useCategoryLabel } from '@/components/public/categoryLabel';
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
import { clearBooked, loadBooked, saveBooked, type BookedState } from '@/lib/booking/bookedStore';
import { loadSlotWindow } from '@/lib/booking/window';
import { useLocaleHint } from '@/lib/useLocaleHint';
import { BookedView } from './BookedView';
import { DetailsStep, type DetailsValues } from './DetailsStep';
import { ServiceSkeleton, ServiceStep } from './ServiceStep';
import { StaffStep } from './StaffStep';
import { TimeStep, type TakenInfo } from './TimeStep';
import { useBookingFormat } from './useBookingFormat';

const HOUR = 3_600_000;
/** How long the slots from a 409 are trusted before the normal (refetched) data takes over again. */
const FRESH_MS = 60_000;
const mainClass =
  'mx-auto flex w-full max-w-[1240px] flex-1 flex-wrap items-start gap-6 px-4 pt-5 pb-28 md:px-8 md:pt-7 lg:pb-10';

// BookedState lives in @/lib/booking/bookedStore
type FreshDays = { key: string; days: Record<string, Slot[]> };
const NO_FRESH: FreshDays = { key: '', days: {} };

/** The public booking flow (boards 1.1 to 1.6) at /b/[slug]. State lives in the URL so Back works and links are shareable. */
export function BookingFlow({ slug }: { slug: string }) {
  const categoryLabel = useCategoryLabel();
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
  useLocaleHint(data?.business.locale, pathname);

  const [now, setNow] = useState(() => new Date());
  const days = useMemo(() => dayWindow(now, timezone), [now, timezone]);
  const searchText = search.toString();
  const resolved = useMemo(
    () =>
      data
        ? resolveBookingState(parseBookingParams(new URLSearchParams(searchText)), data, days)
        : undefined,
    [data, searchText, days],
  );

  // ---- slots: one request per service + person, covering up to 14 local days --------------
  const ready = !!(resolved?.serviceId && resolved.staffId);
  const slotKey = `${ready}:${resolved?.serviceId}:${resolved?.staffId}:${days[0]}`;
  const windowRes = useResource(async (signal) => {
    if (!ready) return null;
    const window = await loadSlotWindow(
      slug,
      {
        serviceId: resolved!.serviceId!,
        staffId: resolved!.staffId === 'anyone' ? undefined : resolved!.staffId,
      },
      timezone,
      now,
      signal,
      undefined,
      data!.business.bookingWindowDays,
    );
    return window;
  }, slotKey);
  const reloadSlots = windowRes.reload;

  const [fresh, setFresh] = useState<FreshDays>(NO_FRESH);
  const byDay = useMemo(
    () => ({ ...windowRes.data?.byDay, ...(fresh.key === slotKey ? fresh.days : {}) }),
    [windowRes.data, fresh, slotKey],
  );
  // Days beyond what the server was asked about are not shown at all (not as "fully booked").
  const coveredDays = windowRes.data?.coveredDays ?? days;
  const selectedDay = resolved?.day ?? firstDayWithSlots(coveredDays, byDay);
  const selectedSlot =
    selectedDay && resolved?.time
      ? findSlotByLocalTime(byDay[selectedDay] ?? [], timezone, resolved.time)
      : undefined;
  const slotsLoading = windowRes.loading && !windowRes.data;

  // The 409 slots are only trusted for a minute.
  useEffect(() => {
    if (!fresh.key) return;
    const id = setTimeout(() => setFresh(NO_FRESH), FRESH_MS);
    return () => clearTimeout(id);
  }, [fresh]);

  // Coming back to the tab (or a new day starting while it was open) refreshes the times.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(new Date());
      reloadSlots();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reloadSlots]);

  // ---- details, submit state ----------------------------------------------------------------
  const [values, setValues] = useState<DetailsValues>({
    name: '',
    dial: DEFAULT_DIAL,
    phone: '',
    email: '',
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [banner, setBanner] = useState<BookingBanner>();
  const [notice, setNotice] = useState<'slotGone'>();
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [taken, setTaken] = useState<TakenInfo>();
  const [takenSeq, setTakenSeq] = useState(0);
  const [booked, setBooked] = useState<BookedState>();
  // F17: a refresh on the confirmation screen restores it (per tab, see bookedStore). Read after mount so
  // the server and first client render agree.
  useEffect(() => {
    let live = true;
    void Promise.resolve(loadBooked(slug, new Date())).then((saved) => {
      if (live && saved) setBooked((current) => current ?? saved);
    });
    return () => {
      live = false;
    };
  }, [slug]);
  const guard = useRef(createSubmitGuard());
  const attempts = useRef(createAttemptKeys());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const go = useCallback(
    (next: BookingParams, mode: 'push' | 'replace' = 'push') =>
      router[mode](`${pathname}${serialiseBookingParams(next)}`, { scroll: false }),
    [router, pathname],
  );
  const base = { service: resolved?.serviceId, staff: resolved?.staffId };
  const clearMessages = () => {
    setBanner(undefined);
    setNotice(undefined);
  };

  // After a failed submit, focus the first invalid field, or the banner (it is shown on every step).
  useEffect(() => {
    if (tick === 0) return;
    const target =
      document.querySelector<HTMLElement>('#booking-form [aria-invalid="true"]') ??
      document.querySelector<HTMLElement>('[data-form-banner]');
    target?.focus();
  }, [tick]);

  // Browser Back or Forward leaves the "slot just taken" view behind.
  useEffect(() => {
    const onPop = () => setTaken(undefined);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The details step needs a slot that exists. A reload, a stale shared link or a hand-edited time has none:
  // once the times are known, go back to the time step with a notice instead of leaving a dead button.
  const step = resolved?.step;
  const day = resolved?.day;
  useEffect(() => {
    if (booked || taken || step !== 'details' || windowRes.loading || selectedSlot) return;
    // (Queued: this is a reaction to loaded data, not a render-time state change.)
    const failed = !!windowRes.error;
    queueMicrotask(() => setNotice(failed ? undefined : 'slotGone'));
    go({ step: 'time', service: resolved?.serviceId, staff: resolved?.staffId, day }, 'replace');
  }, [booked, taken, step, windowRes.loading, windowRes.error, selectedSlot, go, resolved?.serviceId, resolved?.staffId, day]);

  // Focus the new step's heading when the person moves between steps (not on the first render, not on every
  // re-render). The heading itself is the announcement; there is no second live region for the same change.
  const stepKey = booked ? 'booked' : taken ? `taken-${takenSeq}` : step;
  const previousKey = useRef<string>(undefined);
  useEffect(() => {
    if (stepKey === undefined) return;
    if (previousKey.current === undefined) {
      previousKey.current = stepKey;
      return;
    }
    if (previousKey.current !== stepKey) {
      previousKey.current = stepKey;
      headingRef.current?.focus();
    }
  }, [stepKey]);

  // ---- loading and failure of the business ---------------------------------------------------
  if (!data || !resolved) {
    if (business.error) {
      const status = business.error instanceof ApiError ? business.error.status : 0;
      // An unknown or malformed slug is a 404 (or a 400 from the slug schema): both mean "no such page".
      const notFound = status === 404 || status === 400;
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
  const freeCancelUntil = (startAt: string, cutoffMin: number) => {
    const cutoff = new Date(Date.parse(startAt) - cutoffMin * 60_000).toISOString();
    return `${f.day(cutoff)}, ${f.time(cutoff)}`;
  };
  const whenLabel = selectedSlot
    ? tSum('whenValue', { date: f.day(selectedSlot.startAt), time: f.time(selectedSlot.startAt) })
    : undefined;
  const price = service ? f.money(service.price) : undefined;

  const waitlistQuery = new URLSearchParams();
  if (resolved.serviceId) waitlistQuery.set('service', resolved.serviceId);
  if (resolved.staffId && resolved.staffId !== 'anyone') waitlistQuery.set('staff', resolved.staffId);
  const waitlistHref = `/b/${encodeURIComponent(slug)}/waitlist?${waitlistQuery}`;

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
      clearMessages();
      go(target);
    }
  };

  const pickDay = (picked: string) => {
    if (picked !== selectedDay) {
      // Leaving a day whose times came from a 409: drop them and refetch, they are only good for a minute.
      setFresh(NO_FRESH);
      reloadSlots();
    }
    go({ step: 'time', ...base, day: picked }, 'replace');
  };
  const pickSlot = (slot: Slot) => {
    clearMessages();
    go(
      {
        step: 'time',
        ...base,
        day: localDay(slot.startAt, timezone),
        time: localTime(slot.startAt, timezone),
      },
      'replace',
    );
  };
  const toDetails = () => {
    setTaken(undefined);
    clearMessages();
    go({ step: 'details', ...base, day: selectedDay, time: resolved.time });
  };

  async function submit() {
    if (!resolved || !resolved.serviceId || !resolved.staffId) return;
    // The button shows its loading state while the times load; nothing to do until they are known.
    if (windowRes.loading && !selectedSlot) return;
    if (!selectedSlot) {
      // Never a button that does nothing: say the time is gone and go back to pick another.
      setBanner(undefined);
      setNotice('slotGone');
      go({ step: 'time', ...base, day: resolved.day }, 'replace');
      return;
    }
    const found = validateDetails(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setNotice(undefined);
      setBanner('fixFields');
      setTick((n) => n + 1);
      if (resolved.step !== 'details') toDetails();
      return;
    }
    if (!guard.current.tryStart()) return;
    setPending(true);
    setErrors({});
    clearMessages();

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
    // One key per attempt: a retry of this same booking reuses it, a changed slot or phone gets a new one.
    const key = attempts.current.keyFor(body);
    try {
      const result = await createBooking(slug, body, key);
      attempts.current.reset();
      setTaken(undefined);
      if (result.payToken) {
        // Deposit needed (FR-26): the slot is held for 15 minutes. Nothing is "booked" yet, so no
        // confirmation screen; the pay page confirms it. Stay in the pending state while navigating.
        router.push(`/pay/${encodeURIComponent(result.payToken)}`);
        return;
      }
      const next: BookedState = { result, name: body.client.name, hasEmail: !!email };
      saveBooked(slug, next);
      setBooked(next);
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
    const takenDay = localDay(startAt, timezone);
    const merged = replaceDay(byDay, takenDay, slots, timezone);
    setFresh({
      key: slotKey,
      days: { ...(fresh.key === slotKey ? fresh.days : {}), [takenDay]: merged[takenDay]! },
    });
    setTaken({ time: f.time(startAt), day: takenDay });
    setTakenSeq((n) => n + 1);
    const at = Date.parse(startAt);
    const closest = [...(merged[takenDay] ?? [])].sort(
      (a, b) => Math.abs(Date.parse(a.startAt) - at) - Math.abs(Date.parse(b.startAt) - at),
    )[0];
    go(
      {
        step: 'time',
        ...base,
        day: takenDay,
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
    clearBooked(slug);
    setBooked(undefined);
    clearMessages();
    go({});
  };

  // ---- render --------------------------------------------------------------------------------
  const hero = (
    <BusinessHero
      name={data.business.name}
      meta={[categoryLabel(data.business.category), data.business.address].filter(Boolean).join(' · ')}
      facts={[t('heroFactReminders')]}
    />
  );

  if (booked) {
    return (
      <>
        {hero}
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
  // On the details step the button waits (loading, not clickable) while the times are being loaded.
  const waitingForTimes = onDetailsStep && windowRes.loading && !selectedSlot;
  const cta = onTimeStep
    ? { label: t('cta.continue'), disabled: !selectedSlot, onClick: toDetails }
    : onDetailsStep
      ? { label: t('cta.confirm'), disabled: false, onClick: submitForm }
      : undefined;
  const ctaLoading = (pending && onDetailsStep) || waitingForTimes;
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
      <main className={mainClass}>
        {banner || notice ? (
          <div className="flex w-full flex-col gap-3">
            {banner ? (
              <FormBanner
                message={t(`errors.${banner}`)}
                action={
                  retryable ? (
                    <Button variant="secondary" onClick={() => void submit()} loading={pending}>
                      {t('errors.retry')}
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {notice ? (
              <div role="status">
                <Callout tone="warning" icon={<Info />}>
                  {t('errors.slotGone')}
                </Callout>
              </div>
            ) : null}
          </div>
        ) : null}
        <StepRail steps={steps} current={currentIndex} onBack={back} />

        {resolved.step === 'service' ? (
          <ServiceStep
            data={data}
            headingRef={headingRef}
            onChoose={(id) => {
              clearMessages();
              go({ service: id });
            }}
          />
        ) : null}
        {resolved.step === 'staff' ? (
          <StaffStep
            eligible={resolved.eligible}
            headingRef={headingRef}
            onBack={back}
            onChoose={(id) => {
              clearMessages();
              go({ service: resolved.serviceId, staff: id });
            }}
          />
        ) : null}
        {resolved.step === 'time' ? (
          <TimeStep
            timezone={timezone}
            now={now}
            days={coveredDays}
            byDay={byDay}
            loading={slotsLoading}
            failed={!!windowRes.error}
            onRetry={reloadSlots}
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
            waitlistHref={waitlistHref}
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
            pending={pending}
            onSubmit={onFormSubmit}
            onBack={back}
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
              loading={ctaLoading}
              onClick={cta.onClick}
            >
              {cta.label}
            </Button>
          ) : null}
          <Callout icon={<Bell />}>{taken ? t('taken.saved') : t('side.noAccount')}</Callout>
          {selectedSlot && data ? (
            <Callout icon={<ShieldCheck />}>
              {t('side.freeCancelUntil', {
                when: freeCancelUntil(selectedSlot.startAt, data.business.cancelCutoffMin),
              })}
            </Callout>
          ) : null}
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
          ctaLoading={ctaLoading}
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
