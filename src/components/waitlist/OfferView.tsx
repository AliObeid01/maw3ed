'use client';

import { Check, Clock, ExternalLink, LinkIcon, TriangleAlert, WifiOff, BellRing } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { BusinessHero } from '@/components/public/BusinessHero';
import { PageState } from '@/components/public/PageState';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import type { BookingResult } from '@/lib/api/booking';
import { claimOffer, getOffer, type OfferView as Offer } from '@/lib/api/waitlist';
import { useResource } from '@/lib/api/useResource';
import {
  classifyOfferError,
  createClaimRunner,
  minutesLeft,
  offerScreen,
  type OfferFailure,
} from '@/lib/waitlist/offer';
import { useLocaleHint } from '@/lib/useLocaleHint';

const mainClass =
  'mx-auto flex w-full max-w-[1240px] flex-1 flex-wrap items-start gap-6 px-4 pt-5 pb-10 md:px-8 md:pt-7';
const TICK_MS = 30_000;

/** Board 2.3 at /o/[token]. Reading the offer never changes anything; booking is a POST on a button press. */
export function OfferView({ token }: { token: string }) {
  const t = useTranslations('offer');
  const resource = useResource((signal) => getOffer(token, signal), token);
  const pathname = usePathname();
  useLocaleHint(resource.data?.business.locale, pathname);
  const [gone, setGone] = useState<OfferFailure>();

  const failure: OfferFailure | undefined = resource.error ? classifyOfferError(resource.error) : gone;
  if (failure === 'invalid') {
    return (
      <PageState
        role="status"
        icon={<LinkIcon size={26} />}
        title={t('invalid.title')}
        body={t('invalid.body')}
        action={
          <ButtonLink href="/" size="lg" block>
            {t('invalid.action')}
          </ButtonLink>
        }
      />
    );
  }
  if (failure === 'expired') {
    return <Ended kind="expired" slug={resource.data?.business.slug} />;
  }
  if (failure) {
    return (
      <PageState
        role="alert"
        tone="warning"
        icon={<WifiOff size={26} />}
        title={t('errors.generic')}
        body={t(failure === 'network' ? 'errors.network' : 'errors.generic')}
        action={
          <Button size="lg" block onClick={resource.reload}>
            {t('errors.retry')}
          </Button>
        }
      />
    );
  }
  if (!resource.data) return <OfferSkeleton label={t('loading')} />;
  return <OfferBody token={token} view={resource.data} onGone={setGone} />;
}

function Ended({ kind, slug }: { kind: 'expired' | 'taken' | 'unavailable'; slug?: string }) {
  const t = useTranslations('offer');
  return (
    <PageState
      role="status"
      tone="warning"
      icon={kind === 'expired' ? <Clock size={26} /> : <TriangleAlert size={26} />}
      title={t(`${kind}.title`)}
      body={t(`${kind}.body`)}
      action={
        slug ? (
          <ButtonLink href={`/b/${encodeURIComponent(slug)}`} size="lg" block>
            {t(`${kind}.action`)}
          </ButtonLink>
        ) : undefined
      }
    />
  );
}

function OfferBody({
  token,
  view,
  onGone,
}: {
  token: string;
  view: Offer;
  onGone: (kind: OfferFailure) => void;
}) {
  const t = useTranslations('offer');
  const { offer, business } = view;
  const f = useBookingFormat(business.timezone);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [booked, setBooked] = useState<BookingResult>();
  const [taken, setTaken] = useState(false);
  const [problem, setProblem] = useState<OfferFailure>();
  const [pending, setPending] = useState(false);
  const runner = useRef(createClaimRunner(() => claimOffer(token)));
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Polite refresh of the countdown text; the live region only changes every 30 s.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (booked) headingRef.current?.focus();
  }, [booked]);

  const screen = offerScreen(view, nowMs);

  async function claim() {
    if (runner.current.isRunning()) return;
    setPending(true);
    setProblem(undefined);
    try {
      const result = await runner.current.run();
      setBooked(result);
      window.scrollTo({ top: 0 });
    } catch (error) {
      const kind = classifyOfferError(error);
      if (kind === 'taken') setTaken(true);
      else if (kind === 'expired' || kind === 'invalid') onGone(kind);
      else if (kind === 'unavailable') onGone('unavailable');
      else setProblem(kind);
    } finally {
      setPending(false);
    }
  }

  if (taken || screen === 'taken') return <Ended kind="taken" slug={business.slug} />;
  if (!booked && screen === 'expired') return <Ended kind="expired" slug={business.slug} />;
  if (!booked && screen === 'unavailable') return <Ended kind="unavailable" slug={business.slug} />;

  const slot = booked?.appointment ?? offer;
  const when = t('when', { date: f.day(slot.startAt), start: f.time(slot.startAt), end: f.time(slot.endAt) });
  const detail = t('detail', {
    service: slot.service.name,
    staff: slot.staff.displayName,
    price: f.money(slot.service.price),
  });
  const tile = (
    <div className="flex flex-wrap items-center gap-4 rounded-[20px] bg-canvas p-[18px]">
      <span
        aria-hidden="true"
        className="flex h-[72px] w-[68px] shrink-0 flex-col items-center justify-center rounded-tile border border-line bg-surface"
      >
        <span className="text-xs font-semibold text-brand uppercase">{f.month(slot.startAt)}</span>
        <span className="text-[26px] leading-tight font-semibold tabular-nums">{f.dayOfMonth(slot.startAt)}</span>
      </span>
      <span className="flex min-w-[200px] flex-1 flex-col gap-1">
        <span className="text-lg font-semibold md:text-xl">
          <bdi>{when}</bdi>
        </span>
        <span className="text-[15px] text-muted">
          <bdi>{detail}</bdi>
        </span>
      </span>
    </div>
  );

  if (booked || screen === 'claimed') {
    return (
      <>
        <BusinessHero name={business.name} meta="" />
        <main className={mainClass}>
          <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
            <Card className="flex flex-col gap-5 md:p-8">
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
                    {booked ? t('done.title') : t('mine.title')}
                  </h2>
                  <p className="m-0 text-[15px] text-muted">
                    {booked
                      ? t('done.body', {
                          service: slot.service.name,
                          staff: slot.staff.displayName,
                          when: `${f.day(slot.startAt)} · ${f.time(slot.startAt)}`,
                        })
                      : t('mine.body')}
                  </p>
                </div>
              </div>
              {tile}
              {booked ? (
                <>
                  <Callout icon={<BellRing />}>{t('done.next')}</Callout>
                  <div className="flex flex-col gap-2">
                    <ButtonLink
                      href={booked.links.manage}
                      variant="secondary"
                      size="lg"
                      className="max-sm:w-full sm:self-start"
                    >
                      {t('done.manage')}
                      <ExternalLink size={16} aria-hidden="true" className="rtl:-scale-x-100" />
                    </ButtonLink>
                    <p className="m-0 text-[13px] text-muted">{t('done.manageHint')}</p>
                  </div>
                </>
              ) : null}
            </Card>
          </section>
        </main>
      </>
    );
  }

  const left = minutesLeft(offer.expiresAt, nowMs);
  return (
    <>
      <BusinessHero name={business.name} meta="" />
      <main className={mainClass}>
        <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">
          <Card className="flex flex-col gap-5 md:gap-[22px] md:p-8">
            <div className="flex flex-col gap-1.5">
              <Chip tone="brand" className="self-start px-3 py-1.5 text-[13px]">
                {t('eyebrow')}
              </Chip>
              <h2 className="m-0 mt-1 text-2xl font-semibold md:text-[30px]">{t('title')}</h2>
            </div>
            {tile}
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-[58px] items-center gap-3 rounded-[20px] border border-warning-line bg-warning-soft p-4 text-[15px] text-warning-deep"
            >
              <Clock size={22} aria-hidden="true" className="shrink-0 text-warning" />
              <span>
                <b className="font-semibold">
                  {t('expiresAt', { time: f.time(offer.expiresAt) })}
                </b>{' '}
                · {t('minutesLeft', { minutes: left })} · {t('firstToClaim')}
              </span>
            </div>
            {problem ? (
              <div role="alert">
                <Callout tone="danger">{t(`errors.${problem === 'tooMany' ? 'tooMany' : problem === 'network' ? 'network' : 'generic'}`)}</Callout>
              </div>
            ) : null}
            <Button
              variant="accent"
              size="lg"
              block
              className="h-[54px] text-base"
              loading={pending}
              onClick={() => void claim()}
            >
              {t('book')}
            </Button>
          </Card>
        </section>
        <aside className="flex w-full flex-[1_1_240px] flex-col gap-3.5 lg:max-w-[290px]">
          <Card size="sm" padding="compact" className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-semibold">{business.name}</h2>
          </Card>
          <Callout icon={<BellRing />}>{t('side.reminders')}</Callout>
        </aside>
      </main>
    </>
  );
}

function OfferSkeleton({ label }: { label: string }) {
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
          <Skeleton className="h-[360px] rounded-card" />
        </section>
      </main>
    </>
  );
}
