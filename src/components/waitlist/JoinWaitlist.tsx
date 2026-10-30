'use client';

import { Bidi, MetaLine } from '@/components/ui/Bidi';
import { BellRing, Compass, Check, WifiOff, ChevronLeft, Info } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FormBanner } from '@/components/auth/formKit';
import { PhoneField } from '@/components/booking/PhoneField';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { BusinessHero } from '@/components/public/BusinessHero';
import { useCategoryLabel } from '@/components/public/categoryLabel';
import { PageState } from '@/components/public/PageState';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/auth';
import { getPublicBusiness } from '@/lib/api/booking';
import { useResource } from '@/lib/api/useResource';
import { joinWaitlist, type JoinWaitlistBody } from '@/lib/api/waitlist';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import { assemblePhone, DEFAULT_DIAL } from '@/lib/booking/phone';
import { rememberWindowLength } from '@/lib/booking/window';
import {
  classifyJoinError,
  isOutOfWindow,
  windowDaysFromError,
  validateJoin,
  type JoinBanner,
  type JoinErrors,
  type JoinField,
} from '@/lib/waitlist/errors';
import { addDays, defaultRange, followStart, MAX_SPAN_DAYS, todayIn } from '@/lib/waitlist/range';
import { useLocaleHint } from '@/lib/useLocaleHint';

const mainClass =
  'mx-auto flex w-full max-w-[1240px] flex-1 flex-wrap items-start gap-6 px-4 pt-5 pb-10 md:px-8 md:pt-7';
/** Rich-text tag that isolates emails, dates and names inside right-to-left sentences. */
const bdiTag = { b: (chunks: ReactNode) => <bdi>{chunks}</bdi> };
const HOW_STEPS = ['s1', 's2', 's3'] as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Order the fields appear on the page: the first invalid one gets focus. */
const FIELD_IDS: Record<JoinField, string> = {
  service: 'wl-service',
  staff: 'wl-staff',
  from: 'wl-from',
  to: 'wl-to',
  name: 'wl-name',
  phone: 'wl-phone',
  email: 'wl-email',
};

/** Board 1.7 at /b/[slug]/waitlist. `?service=&staff=` prefill the form (from the booking flow's empty or "just taken" views). */
export function JoinWaitlist({ slug }: { slug: string }) {
  const categoryLabel = useCategoryLabel();
  const t = useTranslations('waitlist');
  const tErr = useTranslations('waitlist.errors');
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const business = useResource((signal) => getPublicBusiness(slug, signal), slug);
  const data = business.data;
  const timezone = data?.business.timezone ?? 'UTC';
  const f = useBookingFormat(timezone);
  useLocaleHint(data?.business.locale, pathname);

  const [now] = useState(() => new Date());
  // What the person changed; until then the URL prefill and the defaults show (no effect needed).
  const [pickedService, setPickedService] = useState<string>();
  const [pickedStaff, setPickedStaff] = useState<string | null>();
  const [pickedRange, setPickedRange] = useState<{ from: string; to: string }>();
  const [name, setName] = useState('');
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<JoinErrors>({});
  const [banner, setBanner] = useState<JoinBanner>();
  const [limit, setLimit] = useState(false);
  const [shortened, setShortened] = useState(false);
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [joined, setJoined] = useState<{ email: string; service: string }>();
  const guard = useRef(createSubmitGuard());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const services = useMemo(
    () => (data ? data.services.filter((s) => data.staff.some((p) => p.serviceIds.includes(s.id))) : []),
    [data],
  );

  const searchText = search.toString();
  const prefill = useMemo(() => {
    const q = new URLSearchParams(searchText);
    const s = q.get('service');
    const p = q.get('staff');
    const svc = s && ID.test(s) ? services.find((x) => x.id === s) : undefined;
    const serviceId = svc?.id ?? (services.length === 1 ? services[0]!.id : undefined);
    const eligible = svc && data ? data.staff.filter((x) => x.serviceIds.includes(svc.id)) : [];
    return { serviceId, staffId: svc && p && eligible.some((x) => x.id === p) ? p : undefined };
  }, [searchText, services, data]);
  const serviceId = pickedService ?? prefill.serviceId;
  const staffId = pickedStaff === undefined ? (pickedService ? undefined : prefill.staffId) : (pickedStaff ?? undefined);
  const range = pickedRange ?? (data ? defaultRange(now, data.business.timezone, data.business.bookingWindowDays) : undefined);
  const setRange = (updater: (r: { from: string; to: string }) => { from: string; to: string }) =>
    setPickedRange(updater(range!));

  // Focus the first invalid field (in page order), else the banner, after a failed submit.
  useEffect(() => {
    if (tick === 0) return;
    const target =
      document.querySelector<HTMLElement>('#waitlist-form [aria-invalid="true"]') ??
      document.querySelector<HTMLElement>('[data-form-banner]');
    target?.focus();
  }, [tick]);

  useEffect(() => {
    if (joined) headingRef.current?.focus();
  }, [joined]);

  if (!data || !range) {
    if (business.error) {
      const status = business.error instanceof ApiError ? business.error.status : 0;
      return status === 404 || status === 400 ? (
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
    return <JoinSkeleton label={t('loading')} />;
  }

  const bookHref = `/b/${encodeURIComponent(slug)}`;
  const service = services.find((s) => s.id === serviceId);
  const eligible = service ? data.staff.filter((p) => p.serviceIds.includes(service.id)) : [];
  const person = eligible.find((p) => p.id === staffId);
  const hero = (
    <BusinessHero
      name={data.business.name}
      meta={
        <MetaLine
          items={[
            categoryLabel(data.business.category),
            data.business.address ? <Bidi>{data.business.address}</Bidi> : null,
          ]}
        />
      }
      facts={[t('heroFact')]}
    />
  );

  if (services.length === 0) {
    return (
      <PageState
        icon={<Compass size={26} />}
        title={t('noServices.title')}
        body={t('noServices.body', { name: data.business.name })}
      />
    );
  }

  const doneBody = joined
    ? t.rich('done.body', { email: joined.email, service: joined.service, ...bdiTag })
    : null;
  if (joined) {
    const steps = [
      { id: 'n1', title: t('done.n1Title'), body: t('done.n1Body') },
      { id: 'n2', title: t('done.n2Title'), body: t('done.n2Body') },
      { id: 'n3', title: t('done.n3Title'), body: t('done.n3Body') },
    ];
    return (
      <>
        {hero}
        <main className={mainClass}>
          <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
            <Card className="flex flex-col gap-5 md:gap-6">
              <div className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="flex size-14 shrink-0 items-center justify-center rounded-pill bg-success-soft text-success"
                >
                  <Check size={30} strokeWidth={3} />
                </span>
                <div role="status" className="flex min-w-0 flex-col gap-1">
                  <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className="m-0 text-2xl leading-tight font-semibold outline-none md:text-[28px]"
                  >
                    {t('done.title')}
                  </h2>
                  <p className="m-0 text-[15px] text-muted">
                    {doneBody}
                  </p>
                </div>
              </div>
            </Card>
            {shortened ? (
              <div role="status">
                <Callout tone="warning" icon={<Info />}>
                  {t('shortened')}
                </Callout>
              </div>
            ) : null}
            <Card className="flex flex-col gap-4">
              <h3 className="m-0 text-lg font-semibold">{t('done.nextTitle')}</h3>
              <ol className="m-0 flex list-none flex-col gap-4 p-0">
                {steps.map((s, i) => (
                  <li key={s.id} className="flex items-start gap-3.5">
                    <span
                      aria-hidden="true"
                      className="flex size-[30px] shrink-0 items-center justify-center rounded-pill bg-brand-soft text-sm font-semibold text-brand"
                    >
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{s.title}</span>
                      <span className="text-sm text-muted">{s.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="m-0 text-sm text-muted">{t('done.leave')}</p>
            </Card>
            <ButtonLink href={bookHref} variant="secondary" size="lg" className="max-sm:w-full sm:self-start">
              {t('done.back')}
            </ButtonLink>
          </section>
        </main>
      </>
    );
  }

  if (limit) {
    return (
      <PageState
        role="alert"
        tone="warning"
        icon={<BellRing size={26} />}
        title={t('limit.title')}
        body={t('limit.body')}
        action={
          <ButtonLink href={bookHref} size="lg" block>
            {t('limit.action')}
          </ButtonLink>
        }
      />
    );
  }

  const err = (key?: string) => (key ? tErr(key) : undefined);
  const today = todayIn(now, timezone);
  const clearField = (field: JoinField) =>
    setErrors((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!data) return;
    const found = validateJoin(
      { serviceId: serviceId ?? '', from: range!.from, to: range!.to, name, dial, phone, email },
      new Date(),
      timezone,
    );
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
    const body: JoinWaitlistBody = {
      serviceId: serviceId!,
      staffId: staffId ?? null,
      fromDate: range!.from,
      toDate: range!.to,
      client: { name: name.trim(), phone: assemblePhone(dial, phone), email: email.trim() },
    };
    await send(body, false);
  }

  /**
   * One POST. If the only complaint is "too far ahead" (the first visit has not learned the booking window yet),
   * clip the range to the window the server names (7 days when it names none), remember it, and send once more.
   */
  async function send(body: JoinWaitlistBody, retried: boolean) {
    try {
      await joinWaitlist(slug, body);
      setJoined({ email: body.client.email, service: service?.name ?? '' });
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (!retried && isOutOfWindow(error)) {
        const named = windowDaysFromError(error);
        const days = named ?? 7;
        const last = named ? addDays(todayIn(new Date(), timezone), named) : addDays(todayIn(new Date(), timezone), 6);
        const to = body.toDate < last ? body.toDate : last;
        const clipped = { ...body, toDate: to < body.fromDate ? body.fromDate : to };
        rememberWindowLength(slug, days);
        setPickedRange({ from: clipped.fromDate, to: clipped.toDate });
        setShortened(true);
        await send(clipped, true);
        return;
      }
      const failure = classifyJoinError(error);
      guard.current.release();
      setPending(false);
      if (failure.kind === 'limit') {
        setLimit(true);
        return;
      }
      setErrors(failure.fields);
      setBanner(failure.banner);
      setTick((n) => n + 1);
      return;
    }
    setPending(false);
  }

  const retryable = banner === 'network' || banner === 'generic' || banner === 'tooMany';
  const summaryRows = [
    { id: 'service', label: t('summary.service'), value: service?.name },
    { id: 'with', label: t('summary.with'), value: staffId && person ? person.displayName : t('want.anyone') },
    {
      id: 'days',
      label: t('summary.days'),
      value: t.rich('summary.range', { from: f.ymd(range.from), to: f.ymd(range.to), ...bdiTag }),
    },
  ];

  return (
    <>
      {hero}
      <main className={mainClass}>
        <nav
          aria-label={t('how.title')}
          className="flex w-full flex-[1_1_220px] flex-col gap-4 rounded-card border border-line bg-surface p-5 max-lg:hidden lg:max-w-[250px]"
        >
          <span className="text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">{t('how.title')}</span>
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {HOW_STEPS.map((k, i) => (
              <li key={k} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-[30px] shrink-0 items-center justify-center rounded-pill bg-brand text-sm font-semibold text-white"
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{t(`how.${k}Title`)}</span>
                  <span className="text-[13px] text-muted">{t(`how.${k}Body`)}</span>
                </span>
              </li>
            ))}
          </ol>
        </nav>

        <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
          <div className="flex items-center gap-3">
            <IconButton
              label={t('back')}
              onClick={() => (window.history.length > 1 ? router.back() : router.push(bookHref))}
            >
              <ChevronLeft size={20} aria-hidden="true" className="rtl:-scale-x-100" />
            </IconButton>
            <h2 className="m-0 text-[22px] font-semibold md:text-2xl">{t('title')}</h2>
          </div>

          {shortened ? (
            <div role="status">
              <Callout tone="warning" icon={<Info />}>
                {t('shortened')}
              </Callout>
            </div>
          ) : null}
          {banner ? (
            <FormBanner
              message={t(`banner.${banner}`)}
              action={
                retryable ? (
                  <Button variant="secondary" onClick={() => void submit()} loading={pending}>
                    {t('banner.retry')}
                  </Button>
                ) : undefined
              }
            />
          ) : null}

          <form id="waitlist-form" onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4.5">
            <Card className="flex flex-col gap-4.5 md:p-6">
              <span className="text-base font-semibold">{t('want.title')}</span>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Select
                  id={FIELD_IDS.service}
                  label={t('want.service')}
                  value={serviceId ?? ''}
                  disabled={pending}
                  error={err(errors.service)}
                  onChange={(e) => {
                    setPickedService(e.target.value || '');
                    setPickedStaff(null);
                    clearField('service');
                  }}
                >
                  <option value="">{t('want.servicePlaceholder')}</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {f.duration(s.durationMin)}
                    </option>
                  ))}
                </Select>
                <Select
                  id={FIELD_IDS.staff}
                  label={t('want.with')}
                  value={staffId ?? ''}
                  disabled={pending || !service}
                  error={err(errors.staff)}
                  onChange={(e) => {
                    setPickedStaff(e.target.value || null);
                    clearField('staff');
                  }}
                >
                  <option value="">{t('want.anyone')}</option>
                  {eligible.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  id={FIELD_IDS.from}
                  type="date"
                  label={t('want.from')}
                  value={range.from}
                  min={today}
                  disabled={pending}
                  error={err(errors.from)}
                  autoComplete="off"
                  onChange={(e) => {
                    setRange((r) => followStart(r!, e.target.value));
                    clearField('from');
                    clearField('to');
                  }}
                />
                <Input
                  id={FIELD_IDS.to}
                  type="date"
                  label={t('want.to')}
                  value={range.to}
                  min={range.from || today}
                  max={range.from ? addDays(range.from, MAX_SPAN_DAYS - 1) : undefined}
                  disabled={pending}
                  error={err(errors.to)}
                  hint={t('want.rangeHint')}
                  autoComplete="off"
                  onChange={(e) => {
                    setRange((r) => ({ ...r!, to: e.target.value }));
                    clearField('to');
                  }}
                />
              </div>
            </Card>

            <Card className="flex flex-col gap-4.5 md:p-6">
              <span className="text-base font-semibold">{t('contact.title')}</span>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  id={FIELD_IDS.name}
                  name="name"
                  label={t('contact.name')}
                  autoComplete="name"
                  maxLength={80}
                  value={name}
                  disabled={pending}
                  error={err(errors.name)}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearField('name');
                  }}
                />
                <PhoneField
                  id={FIELD_IDS.phone}
                  dial={dial}
                  onDialChange={setDial}
                  value={phone}
                  onChange={(v) => {
                    setPhone(v);
                    clearField('phone');
                  }}
                  error={err(errors.phone)}
                  disabled={pending}
                />
              </div>
              <Input
                id={FIELD_IDS.email}
                name="email"
                type="email"
                dir="ltr"
                label={t('contact.email')}
                hint={t('contact.emailHint')}
                autoComplete="email"
                value={email}
                disabled={pending}
                error={err(errors.email)}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearField('email');
                }}
              />
              <p className="m-0 flex items-start gap-2 text-sm text-muted">
                <BellRing size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
                <span>{t('consent')}</span>
              </p>
            </Card>

            <Button type="submit" size="lg" block loading={pending} className="h-[54px] text-base lg:hidden">
              {t('submit')}
            </Button>
          </form>
        </section>

        <aside className="flex w-full flex-[1_1_240px] flex-col gap-3.5 lg:max-w-[290px]">
          <Card size="sm" padding="compact" className="flex flex-col gap-3.5">
            <h2 className="m-0 text-base font-semibold">{t('summary.title')}</h2>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2.5 text-sm">
              {summaryRows.map((r) => (
                <div key={r.id} className="contents">
                  <dt className="text-muted">{r.label}</dt>
                  <dd className="m-0 font-medium">{r.value ?? t('summary.notChosen')}</dd>
                </div>
              ))}
            </dl>
            <Button
              size="lg"
              block
              loading={pending}
              className="h-[54px] text-base max-lg:hidden"
              onClick={() => (document.getElementById('waitlist-form') as HTMLFormElement | null)?.requestSubmit()}
            >
              {t('submit')}
            </Button>
          </Card>
          <Callout icon={<BellRing />}>{t('side.free')}</Callout>
        </aside>
      </main>
    </>
  );
}

function JoinSkeleton({ label }: { label: string }) {
  return (
    <>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="bg-hero" aria-hidden="true">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-5 md:px-8 md:py-[26px]">
          <Skeleton className="size-12 rounded-[14px] bg-white/20 md:size-16 md:rounded-[20px]" />
          <Skeleton className="h-7 w-48 bg-white/20" />
        </div>
      </div>
      <main className={mainClass}>
        <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-[260px] rounded-card" />
          <Skeleton className="h-[260px] rounded-card" />
        </section>
      </main>
    </>
  );
}
