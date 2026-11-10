'use client';

import { Bidi, MetaLine } from '@/components/ui/Bidi';
import { Bell, Compass, Info, ShieldCheck, WifiOff } from 'lucide-react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FormBanner } from '@/components/auth/formKit';
import { BookingSummary, type SummaryRow } from '@/components/public/BookingSummary';
import { BusinessHero } from '@/components/public/BusinessHero';
import { useAreaLabel } from '@/components/public/areaLabel';
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
  replaceDay,
  slotTime,
} from '@/lib/booking/slots';
import {
  backParams,
  parseBookingParams,
  resolveBookingState,
  serialiseBookingParams,
  type BookingParams,
} from '@/lib/booking/urlState';
import { clearBooked, loadBooked, saveBooked, type BookedState } from '@/lib/booking/bookedStore';
import { createLiveRefresh, sameData } from '@/lib/booking/liveRefresh';
import { loadSlotWindow } from '@/lib/booking/window';
import { YourBookingsStrip } from '@/components/myBookings/YourBookingsStrip';
import { entryFromBooking, myBookings } from '@/lib/myBookings/storage';
import { useLocaleHint } from '@/lib/useLocaleHint';
import { BookedView } from './BookedView';
import { DetailsStep, type DetailsValues } from './DetailsStep';
import { ServiceSkeleton, ServiceStep } from './ServiceStep';
import { StaffStep } from './StaffStep';
import { TimeStep, type TakenInfo } from './TimeStep';
import { useBookingFormat } from './useBookingFormat';

// PR-16: fetched only when the button renders (connector on and business listed); a switched-off server never sends it.
const ClaudeButton = dynamic(() => import('./ClaudeButton').then((m) => m.ClaudeButton));

const HOUR = 3_600_000;
/** How long the slots from a 409 are trusted before the normal (refetched) data takes over again. */
const FRESH_MS = 60_000;
const mainClass =
  'mx-auto flex w-full max-w-[1240px] flex-1 flex-wrap items-start gap-6 px-4 pt-5 pb-[calc(9rem+env(safe-area-inset-bottom))] md:px-8 md:pt-7 lg:pb-10';

// BookedState lives in @/lib/booking/bookedStore
type FreshDays = { key: string; days: Record<string, Slot[]> };
const NO_FRESH: FreshDays = { key: '', days: {} };

/** The public booking flow (boards 1.1 to 1.6) at /b/[slug]. State lives in the URL so Back works and links are shareable. */
export function BookingFlow({ slug, assistantEnabled = false }: { slug: string; assistantEnabled?: boolean }) {
  const categoryLabel = useCategoryLabel();
  const areaLabel = useAreaLabel();
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
  // Only the reminder estimate on the details step reads this; kept apart so refreshing it moves nothing else.
  const [previewNow, setPreviewNow] = useState(() => new Date());
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
  // The booking window re-read after the server rejected the published one (F28); wins over the first load.
  const knownWindow = useRef<number | undefined>(undefined);
  const fetchWindow = async (signal: AbortSignal) => {
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
      knownWindow.current ?? data!.business.bookingWindowDays,
      async (abort) => {
        // The window the page was loaded with was rejected: re-read the business and remember what it says now.
        const fresh = await getPublicBusiness(slug, abort);
        knownWindow.current = fresh.business.bookingWindowDays;
        return fresh.business.bookingWindowDays;
      },
    );
    return window;
  };
  const windowRes = useResource(fetchWindow, slotKey);
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

  // Live refresh (F68-B): about every minute while the tab is visible, the business and the chosen service's slots
  // are re-read quietly. Only changed data replaces what is on screen (same object when equal), the form state lives
  // above and is never touched, errors are ignored (the next tick tries again), and a result for a service/person
  // the client has since left is dropped.
  const liveWindow = useRef(fetchWindow);
  const liveKey = useRef(slotKey);
  const liveBusiness = useRef(business.setData);
  const liveSlots = useRef(windowRes.setData);
  useEffect(() => {
    liveWindow.current = fetchWindow;
    liveKey.current = slotKey;
    liveBusiness.current = business.setData;
    liveSlots.current = windowRes.setData;
  });
  const liveReady = !!data;
  useEffect(() => {
    if (!liveReady) return;
    let controller: AbortController | undefined;
    const refreshQuietly = async () => {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      const key = liveKey.current;
      try {
        const [fresh, slots] = await Promise.all([
          getPublicBusiness(slug, mine.signal),
          liveWindow.current(mine.signal),
        ]);
        if (mine.signal.aborted) return;
        liveBusiness.current((current) => (sameData(current, fresh) ? current! : fresh));
        if (liveKey.current === key) {
          liveSlots.current((current) => (sameData(current, slots) ? current! : slots));
        }
      } catch {
        /* background refresh: keep what is shown */
      }
    };
    const live = createLiveRefresh({ refresh: () => void refreshQuietly() });
    live.start();
    return () => {
      live.stop();
      controller?.abort();
    };
  }, [slug, liveReady]);

  // ---- details, submit state ----------------------------------------------------------------
  const [values, setValues] = useState<DetailsValues>({
    name: '',
    dial: DEFAULT_DIAL,
    phone: '',
    email: '',
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [banner, setBanner] = useState<BookingBanner>();
  const [notice, setNotice] = useState<'slotGone' | 'slotTaken'>();
  // True while the client has a real chosen time on the details step; if it vanishes after that, someone took it.
  const hadSlot = useRef(false);
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
    if (step !== 'details') hadSlot.current = false;
    else if (selectedSlot) hadSlot.current = true;
  }, [step, selectedSlot]);
  useEffect(() => {
    if (booked || taken || step !== 'details' || windowRes.loading || selectedSlot) return;
    // (Queued: this is a reaction to loaded data, not a render-time state change.)
    const failed = !!windowRes.error;
    const someoneTookIt = hadSlot.current;
    hadSlot.current = false;
    queueMicrotask(() => setNotice(failed ? undefined : someoneTookIt ? 'slotTaken' : 'slotGone'));
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
  // One line for both the desktop card and the phone's summary bar; the date is isolated so it reads in order in Arabic.
  const freeCancelNote = selectedSlot
    ? t.rich('side.freeCancelUntil', {
        when: freeCancelUntil(selectedSlot.startAt, data.business.cancelCutoffMin),
        d: (chunks) => <Bidi>{chunks}</Bidi>,
      })
    : undefined;
  const whenLabel = selectedSlot
    ? tSum('whenValue', { date: f.day(selectedSlot.startAt), time: f.time(selectedSlot.startAt) })
    : undefined;
  const price = service ? f.money(service.price) : undefined;

  const waitlistQuery = new URLSearchParams();
  if (resolved.serviceId) waitlistQuery.set('service', resolved.serviceId);
  if (resolved.staffId && resolved.staffId !== 'anyone') waitlistQuery.set('staff', resolved.staffId);
  const waitlistHref = `/b/${encodeURIComponent(slug)}/waitlist?${waitlistQuery}`;

  const stepIds: ('service' | 'staff' | 'time' | 'details')[] = [
    'service',
    ...(resolved.staffSkipped ? [] : (['staff'] as const)),
    'time',
    'details',
  ];
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
        time: slotTime(slot.startAt, timezone),
      },
      'replace',
    );
  };
  const toDetails = () => {
    setPreviewNow(new Date()); // the estimate below reads a clock as fresh as the step
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
    const found = validateDetails(values, { requireEmail: true });
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
        // "My bookings on this device" keeps the hold (pay token + end) so the client can come back within the 15 minutes.
        const held = entryFromBooking(
          result,
          { slug, name: data?.business.name ?? slug, timezone },
          new Date(),
        );
        if (held) myBookings.save(held);
        router.push(`/pay/${encodeURIComponent(result.payToken)}`);
        return;
      }
      const next: BookedState = { result, name: body.client.name, hasEmail: !!email };
      saveBooked(slug, next);
      // "My bookings on this device": business, service, staff, time and the view link only. `next.name`,
      // the phone and the email are deliberately not passed (entryFromBooking cannot take them).
      const saved = entryFromBooking(
        result,
        { slug, name: data?.business.name ?? slug, timezone },
        new Date(),
      );
      if (saved) myBookings.save(saved);
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
        time: closest ? slotTime(closest.startAt, timezone) : undefined,
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
      logoUrl={data.business.logoUrl}
      meta={
        <MetaLine
          items={[
            categoryLabel(data.business.category),
            areaLabel(data.business.area),
            data.business.address ? <Bidi>{data.business.address}</Bidi> : null,
          ]}
        />
      }
      facts={[t('heroFactReminders')]}
      action={
        // PR-15b: only while the connector is switched on (server flag) AND this business is listed.
        assistantEnabled && data.business.listed ? (
          <ClaudeButton name={data.business.name} slug={data.business.slug} />
        ) : undefined
      }
    />
  );

  if (booked) {
    return (
      <>
        {hero}
        <main className={mainClass.replace('pb-[calc(9rem+env(safe-area-inset-bottom))]', 'pb-10')}>
          <BookedView
            result={booked.result}
            clientName={booked.name}
            hasEmail={booked.hasEmail}
            timezone={timezone}
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
  // A preview ESTIMATE only (the confirmation shows what the server planned): same `>=` rule as the server's
  // reminderPlan, the device clock re-read on entering the step and on each keystroke, and no preview at all without an email address.
  const hasTypedEmail = values.email.trim().length > 0;
  const reminderAt = (hours: number) =>
    hasTypedEmail && startMs !== undefined && startMs - hours * HOUR >= previewNow.getTime()
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
                  {t(notice === 'slotTaken' ? 'errors.slotTakenLive' : 'errors.slotGone')}
                </Callout>
              </div>
            ) : null}
          </div>
        ) : null}
        <YourBookingsStrip slug={slug} />
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
              setPreviewNow(new Date());
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
          {freeCancelNote ? <Callout icon={<ShieldCheck />}>{freeCancelNote}</Callout> : null}
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
          note={freeCancelNote}
          reserveNote
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
          <Skeleton className="size-12 rounded-[14px] bg-white/20 md:size-16 md:rounded-tile" />
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
