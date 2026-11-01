'use client';

import { CircleCheck, Footprints } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useAppSession } from '@/components/app/SessionContext';
import { useSummary } from '@/components/app/SummaryContext';
import { LoadError } from '@/components/app/states';
import { FormBanner } from '@/components/auth/formKit';
import { DayStrip } from '@/components/booking/DayStrip';
import { PhoneField } from '@/components/booking/PhoneField';
import { SlotGrid } from '@/components/booking/SlotGrid';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { isolate } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { createFrontDeskBooking, getPublicBusiness, type BookingBody, type BookingResult, type Slot } from '@/lib/api/booking';
import { searchClients } from '@/lib/api/dashboard';
import { useResource } from '@/lib/api/useResource';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { createAttemptKeys } from '@/lib/booking/attempt';
import {
  classifyBookingError,
  NAME_MAX,
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
  slotTime,
  replaceDay,
} from '@/lib/booking/slots';
import { parseBookingParams } from '@/lib/booking/urlState';
import { loadSlotWindow } from '@/lib/booking/window';
import { cn } from '@/lib/cn';
import { createLookup, type LookupState } from '@/lib/frontdesk/lookup';
import { earliestSlot } from '@/lib/frontdesk/walkin';
import { ClientCard } from './ClientCard';

type Done = { result: BookingResult; name: string };
type Taken = { time: string; day: string };

function FormSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label={label}>
      <Skeleton className="h-40 rounded-card" />
      <Skeleton className="h-48 rounded-card" />
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}

/** Board 4.3: book for a caller or a walk-in in a few taps. Service, person, time, then the client. */
export function FrontDeskForm() {
  const t = useTranslations('app.frontDesk');
  const tt = useTranslations('booking.time');
  const tErr = useTranslations('booking.errors');
  const { slug, timezone: sessionZone } = useAppSession();
  const { refresh: refreshSummary } = useSummary();
  const search = useSearchParams();
  const prefill = useMemo(() => parseBookingParams(new URLSearchParams(search.toString())), [search]);

  const business = useResource((signal) => getPublicBusiness(slug, signal), slug);
  const data = business.data;
  const timezone = data?.business.timezone ?? sessionZone;
  const f = useBookingFormat(timezone);

  // ---- choices ---------------------------------------------------------------------------------
  const [serviceId, setServiceId] = useState<string | undefined>(prefill.service);
  const [staffId, setStaffId] = useState<string>(prefill.staff ?? 'anyone');
  const [pickedDay, setPickedDay] = useState<string | undefined>(prefill.day);
  const [pickedTime, setPickedTime] = useState<string | undefined>(prefill.time);
  const service = data?.services.find((s) => s.id === serviceId);
  const eligible = useMemo(
    () => (data && service ? data.staff.filter((p) => p.serviceIds.includes(service.id)) : []),
    [data, service],
  );
  // A person who does not offer the chosen service falls back to "anyone".
  const effectiveStaff = staffId !== 'anyone' && eligible.some((p) => p.id === staffId) ? staffId : 'anyone';

  // ---- slots (one request for the next 14 days) -----------------------------------------------
  const [now, setNow] = useState(() => new Date());
  const days = useMemo(() => dayWindow(now, timezone), [now, timezone]);
  const ready = !!service && !!data;
  const slotKey = `${ready}:${service?.id}:${effectiveStaff}:${days[0]}`;
  const windowRes = useResource(async (signal) => {
    if (!ready) return null;
    const win = await loadSlotWindow(
      slug,
      { serviceId: service.id, staffId: effectiveStaff === 'anyone' ? undefined : effectiveStaff },
      timezone,
      now,
      signal,
      undefined,
      data!.business.bookingWindowDays,
    );
    return win;
  }, slotKey);
  const reloadSlots = windowRes.reload;
  const [fresh, setFresh] = useState<{ key: string; days: Record<string, Slot[]> }>({ key: '', days: {} });
  const byDay = useMemo(
    () => ({ ...windowRes.data?.byDay, ...(fresh.key === slotKey ? fresh.days : {}) }),
    [windowRes.data, fresh, slotKey],
  );
  const coveredDays = windowRes.data?.coveredDays ?? days;
  const day = pickedDay && coveredDays.includes(pickedDay) ? pickedDay : firstDayWithSlots(coveredDays, byDay);
  const slot = day && pickedTime ? findSlotByLocalTime(byDay[day] ?? [], timezone, pickedTime) : undefined;
  const slotsLoading = ready && windowRes.loading && !windowRes.data;
  const timesLabelId = useId();

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(new Date());
      reloadSlots();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reloadSlots]);

  // ---- client ----------------------------------------------------------------------------------
  const [values, setValues] = useState({ name: '', dial: DEFAULT_DIAL, phone: '', email: '' });
  const nameTouched = useRef(false);
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const lookupRef = useRef<ReturnType<typeof createLookup> | undefined>(undefined);
  useEffect(() => {
    const controller = createLookup({
      search: (digits, signal) => searchClients(digits, signal),
      onState: (state) => {
        setLookup(state);
        if (state.status === 'found' && !nameTouched.current) {
          setValues((v) => ({ ...v, name: state.client.name }));
        }
      },
    });
    lookupRef.current = controller;
    return () => controller.dispose();
  }, []);
  const phoneFull = assemblePhone(values.dial, values.phone);
  useEffect(() => {
    lookupRef.current?.input(phoneFull);
  }, [phoneFull]);

  // ---- submit ----------------------------------------------------------------------------------
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [banner, setBanner] = useState<BookingBanner>();
  const [notice, setNotice] = useState<'slotGone' | 'noWalkIn'>();
  const [taken, setTaken] = useState<Taken>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<Done>();
  const [tick, setTick] = useState(0);
  const guard = useRef(createSubmitGuard());
  const attempts = useRef(createAttemptKeys());
  const doneRef = useRef<HTMLHeadingElement>(null);
  const takenRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (tick === 0) return;
    const target =
      document.querySelector<HTMLElement>('#frontdesk-form [aria-invalid="true"]') ??
      document.querySelector<HTMLElement>('[data-form-banner]');
    target?.focus();
  }, [tick]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  useEffect(() => {
    if (taken) takenRef.current?.focus();
  }, [taken]);

  const choose = (patch: { day?: string; time?: string }) => {
    setNotice(undefined);
    setBanner(undefined);
    if (patch.day !== undefined) setPickedDay(patch.day);
    setPickedTime(patch.time);
  };

  const walkIn = () => {
    const all = Object.values(byDay).flat();
    const next = earliestSlot(all, new Date());
    if (!next) {
      setNotice('noWalkIn');
      return;
    }
    setTaken(undefined);
    choose({ day: localDay(next.startAt, timezone), time: slotTime(next.startAt, timezone) });
  };

  async function submit() {
    if (!service || !data) return;
    if (!slot) {
      setNotice('slotGone');
      return;
    }
    const found = validateDetails(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setBanner('fixFields');
      setTick((n) => n + 1);
      return;
    }
    if (!guard.current.tryStart()) return;
    setPending(true);
    setErrors({});
    setBanner(undefined);
    setNotice(undefined);
    const email = values.email.trim();
    const body: BookingBody = {
      serviceId: service.id,
      staffId: effectiveStaff,
      startAt: slot.startAt,
      client: { name: values.name.trim(), phone: phoneFull, ...(email ? { email } : {}) },
    };
    const key = attempts.current.keyFor(body);
    try {
      const result = await createFrontDeskBooking(body, key);
      attempts.current.reset();
      setTaken(undefined);
      setDone({ result, name: body.client.name });
      refreshSummary();
      window.scrollTo({ top: 0 });
    } catch (error) {
      const failure = classifyBookingError(error);
      guard.current.release();
      setPending(false);
      if (failure.kind === 'slotTaken') {
        const takenDay = localDay(body.startAt, timezone);
        const merged = replaceDay(byDay, takenDay, failure.slots, timezone);
        setFresh({
          key: slotKey,
          days: { ...(fresh.key === slotKey ? fresh.days : {}), [takenDay]: merged[takenDay]! },
        });
        setTaken({ time: f.time(body.startAt), day: takenDay });
        setPickedDay(takenDay);
        setPickedTime(undefined);
        return;
      }
      if (failure.newAttempt) attempts.current.reset();
      setErrors(failure.fields);
      setBanner(failure.banner);
      setTick((n) => n + 1);
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const another = () => {
    guard.current = createSubmitGuard();
    attempts.current.reset();
    nameTouched.current = false;
    setDone(undefined);
    setTaken(undefined);
    setValues({ name: '', dial: values.dial, phone: '', email: '' });
    setLookup({ status: 'idle' });
    setPickedTime(undefined);
    setNotice(undefined);
    setBanner(undefined);
    setErrors({});
    setPending(false);
    reloadSlots();
  };

  // ---- render ----------------------------------------------------------------------------------
  if (business.error && !data) return <LoadError error={business.error} onRetry={business.reload} />;
  if (!data) return <FormSkeleton label={t('loading')} />;

  if (done) {
    const appt = done.result.appointment;
    return (
      <Card className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 py-8 text-center" role="status">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-pill bg-success-soft text-success"
        >
          <CircleCheck size={28} />
        </span>
        <h2 ref={doneRef} tabIndex={-1} className="m-0 text-2xl font-semibold outline-none">
          {t('done.title')}
        </h2>
        <p className="m-0 text-[15px] leading-normal text-muted">
          {t('done.summary', {
            name: done.name,
            service: appt.service.name,
            day: f.day(appt.startAt),
            time: f.time(appt.startAt),
            staff: appt.staff.displayName,
          })}
        </p>
        <div className="flex w-full flex-col gap-2.5">
          <Button size="lg" block onClick={another}>
            {t('done.another')}
          </Button>
          <ButtonLink href="/app" variant="secondary" size="lg" block>
            {t('done.backToToday')}
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const staffOptions = eligible;
  const slotsOfDay = day ? (byDay[day] ?? []) : [];
  const summary = slot && service
    ? t('summary', {
        name: values.name.trim() || t('summaryNoName'),
        service: isolate(service.name),
        day: f.day(slot.startAt),
        range: f.range(slot.startAt, slot.endAt),
        staff:
          effectiveStaff === 'anyone'
            ? t('anyone')
            : (data.staff.find((p) => p.id === effectiveStaff)?.displayName ?? ''),
      })
    : undefined;
  const bannerText = banner ? tErr(banner) : undefined;
  const noTimesText = tt('noTimesDay');

  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-11 items-center rounded-pill border px-4 text-[15px] transition-colors duration-200 ease-out',
      active ? 'border-brand bg-brand font-semibold text-white' : 'border-line bg-surface text-ink hover:border-brand',
    );

  return (
    <form
      id="frontdesk-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 pb-24 lg:flex-row lg:flex-wrap lg:items-start lg:pb-0"
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-[1_1_380px]">
        <Card className="flex flex-col gap-3 md:p-[22px]">
          <h2 className="m-0 text-base font-semibold">{t('client.title')}</h2>
          <PhoneField
            dial={values.dial}
            onDialChange={(dial) => setValues((v) => ({ ...v, dial }))}
            value={values.phone}
            onChange={(phone) => setValues((v) => ({ ...v, phone }))}
            error={errors.phone ? tErr(errors.phone) : undefined}
            disabled={pending}
          />
          <ClientCard state={lookup} />
          <Input
            name="name"
            label={t('client.name')}
            autoComplete="off"
            maxLength={NAME_MAX}
            value={values.name}
            disabled={pending}
            error={errors.name ? tErr(errors.name, { max: NAME_MAX }) : undefined}
            onChange={(e) => {
              nameTouched.current = true;
              setValues((v) => ({ ...v, name: e.target.value }));
            }}
          />
          <Input
            name="email"
            type="email"
            dir="ltr"
            label={t('client.email')}
            autoComplete="off"
            value={values.email}
            disabled={pending}
            error={errors.email ? tErr(errors.email) : undefined}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          />
        </Card>

        <Card className="flex flex-col gap-4 md:p-[22px]">
          <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2.5 p-0 text-base font-semibold">{t('service.title')}</legend>
            <div className="flex flex-wrap gap-2">
              {data.services
                .filter((s) => data.staff.some((p) => p.serviceIds.includes(s.id)))
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={s.id === serviceId}
                    onClick={() => {
                      setServiceId(s.id);
                      setPickedTime(undefined);
                      setTaken(undefined);
                    }}
                    className={chip(s.id === serviceId)}
                  >
                    {s.id === serviceId
                      ? t('service.selected', {
                          // Isolate the (possibly Latin) name so Arabic text around it keeps its order.
                          name: `⁨${s.name}⁩`,
                          duration: f.duration(s.durationMin),
                        })
                      : s.name}
                  </button>
                ))}
            </div>
          </fieldset>
          <Select
            label={t('staff.title')}
            value={effectiveStaff}
            disabled={!service || pending}
            onChange={(e) => {
              setStaffId(e.target.value);
              setPickedTime(undefined);
            }}
          >
            <option value="anyone">{t('anyone')}</option>
            {staffOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Card>
      </div>

      <Card className="flex min-w-0 flex-col gap-4 md:p-[22px] lg:flex-[1_1_380px]">
        <div className="flex items-center justify-between gap-3">
          <h2 id={timesLabelId} className="m-0 text-base font-semibold">
            {t('times.title')}
          </h2>
          <Button
            variant="secondary"
            size="md"
            disabled={!service || slotsLoading || pending}
            onClick={walkIn}
          >
            <Footprints size={18} aria-hidden="true" />
            {t('walkIn')}
          </Button>
        </div>

        {!service ? (
          <p className="m-0 rounded-2xl bg-canvas p-4 text-[15px] text-muted">{t('times.pickService')}</p>
        ) : windowRes.error && !windowRes.data ? (
          <LoadError error={windowRes.error} onRetry={windowRes.reload} />
        ) : slotsLoading ? (
          <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label={t('loading')}>
            <Skeleton className="h-[68px]" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <>
            <DayStrip
              days={coveredDays}
              byDay={byDay}
              selected={day}
              onSelect={(d) => {
                setTaken(undefined);
                choose({ day: d });
              }}
              timezone={timezone}
            />
            {taken ? (
              <p
                ref={takenRef}
                tabIndex={-1}
                role="alert"
                className="m-0 rounded-2xl border border-warning-line bg-warning-soft p-3.5 text-[15px] text-warning-deep outline-none"
              >
                {t('taken', { time: taken.time })}
              </p>
            ) : null}
            {slotsOfDay.length === 0 ? (
              <p className="m-0 text-[15px] text-muted">{noTimesText}</p>
            ) : (
              <SlotGrid
                slots={slotsOfDay}
                timezone={timezone}
                selectedTime={slot ? slotTime(slot.startAt, timezone) : undefined}
                struckTimes={taken && taken.day === day ? [taken.time] : []}
                labelId={timesLabelId}
                onSelect={(s) => {
                  setTaken(undefined);
                  choose({ day: localDay(s.startAt, timezone), time: slotTime(s.startAt, timezone) });
                }}
              />
            )}
          </>
        )}

        {notice ? (
          <p role="alert" className="m-0 text-sm font-medium text-danger">
            {t(`notice.${notice}`)}
          </p>
        ) : null}
        <FormBanner message={bannerText} />

        <div className="rounded-2xl bg-canvas px-4 py-3.5 text-[15px] leading-normal" aria-live="polite">
          {summary ?? <span className="text-muted">{t('summaryEmpty')}</span>}
        </div>

        {/* Phones: pinned above the tab bar so the thumb never leaves the bottom of the screen. */}
        <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-divider bg-surface px-4 py-3 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0">
          <Button type="submit" variant="accent" size="lg" block loading={pending} className="lg:h-14 lg:text-[17px]">
            {t('book')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
