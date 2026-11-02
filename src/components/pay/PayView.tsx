'use client';

import { Check, Clock, FlaskConical, LinkIcon, TriangleAlert, WifiOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { PageState } from '@/components/public/PageState';
import { monogram } from '@/components/public/monogram';
import { Bidi, isolate, MetaLine, TimeRange } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/Skeleton';
import { useResource } from '@/lib/api/useResource';
import {
  classifyPayError,
  expiredData,
  getPay,
  postPay,
  type PayFailure,
  type PayView as Pay,
} from '@/lib/api/pay';
import { reminderPromiseKind } from '@/lib/reminders/promise';
import { useLocaleHint } from '@/lib/useLocaleHint';
import { msLeft } from '@/lib/waitlist/offer';
import { serverNow } from '@/lib/waitlist/clock';

const mainClass =
  'mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-5 px-4 pt-5 pb-10 md:px-8 md:pt-8 lg:flex-row lg:items-start lg:gap-8 lg:pt-12';

/** Business header of board 5.2: monogram tile and name (a paragraph; the page h1 is the hero title). */
/** mm:ss until the hold ends. Owns the one-second tick so the rest of the page does not re-render. */
function Countdown({
  holdEnd,
  offsetMs,
  onEnd,
}: {
  holdEnd: string | null;
  offsetMs: number;
  onEnd: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => serverNow(offsetMs));
  useEffect(() => {
    const id = setInterval(() => setNowMs(serverNow(offsetMs)), 1000);
    return () => clearInterval(id);
  }, [offsetMs]);
  const left = holdEnd ? msLeft(holdEnd, nowMs) : 0;
  useEffect(() => {
    if (holdEnd !== null && left === 0) onEnd();
  }, [holdEnd, left, onEnd]);
  return (
    <span dir="ltr" data-testid="countdown" className="font-semibold tabular-nums">
      {clockText(left)}
    </span>
  );
}

function BusinessHeader({ name, address }: { name: string; address?: string | undefined }) {
  return (
    <div className="border-b border-divider bg-surface">
      <div className="mx-auto flex max-w-[1120px] items-center gap-3 px-4 py-3 md:px-8">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-accent text-base font-bold text-ink"
        >
          {monogram(name)}
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="m-0 truncate text-[17px] font-semibold">
            <bdi>{name}</bdi>
          </p>
          {address ? (
            <p data-testid="business-address" className="m-0 truncate text-sm text-muted">
              <bdi>{address}</bdi>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const heroClass =
  'bg-hero flex flex-col gap-4 rounded-[28px] p-6 text-white md:p-7 lg:max-w-[400px] lg:flex-[1_1_300px]';

/** mm:ss with Latin digits in both languages. */
export function clockText(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Board 5.2 at /pay/[token]: the deposit page. TEST MODE only: one button, no card form, nothing typed. Loading
 * the page changes nothing; the button sends an empty POST and the server asks the payment provider.
 */
export function PayView({ token }: { token: string }) {
  const t = useTranslations('deposit');
  const resource = useResource((signal) => getPay(token, signal), token);
  const pathname = usePathname();
  useLocaleHint(resource.data?.business.locale, pathname);

  if (resource.error) {
    const failure = classifyPayError(resource.error);
    if (failure === 'invalid') return <Invalid />;
    if (failure === 'expired' || failure === 'cancelled')
      return <Ended kind={failure} slug={expiredData(resource.error).slug} />;
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
  if (!resource.data) return <PaySkeleton label={t('loading')} />;
  return <PayBody token={token} view={resource.data} offsetMs={resource.data.clockOffsetMs} />;
}

function Invalid() {
  const t = useTranslations('deposit');
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

function Ended({
  slug,
  kind = 'expired',
}: {
  slug?: string | undefined;
  kind?: 'expired' | 'cancelled';
}) {
  const t = useTranslations('deposit');
  return (
    <main className={cn(mainClass, 'lg:justify-center')}>
      <section role="status" className={cn(heroClass, 'lg:max-w-[480px]')}>
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-[16px] bg-white/10"
        >
          <Clock size={24} />
        </span>
        <h1 className="m-0 text-[26px] leading-tight font-semibold md:text-[30px]">
          {t(`${kind}.title`)}
        </h1>
        <p className="m-0 text-base leading-normal text-hero-muted">{t(`${kind}.body`)}</p>
        {slug ? (
          <ButtonLink
            href={`/b/${encodeURIComponent(slug)}`}
            size="lg"
            block
            variant="accent"
            className="mt-2"
          >
            {t(`${kind}.action`)}
          </ButtonLink>
        ) : null}
      </section>
    </main>
  );
}

function PaySkeleton({ label }: { label: string }) {
  return (
    <main className={mainClass} aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-[220px] rounded-[28px] lg:max-w-[400px] lg:flex-1" />
      <Skeleton className="h-[320px] rounded-card lg:flex-[2]" />
    </main>
  );
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'paying' }
  | { kind: 'paid'; view: Pay }
  | { kind: 'ended'; slug?: string | undefined; as: 'expired' | 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'problem'; failure: Exclude<PayFailure, 'invalid' | 'expired' | 'cancelled'> };

function PayBody({ token, view, offsetMs }: { token: string; view: Pay; offsetMs: number }) {
  const t = useTranslations('deposit');
  const tr = useTranslations('reminderPromise');
  const f = useBookingFormat(view.business.timezone);
  const [timeUp, setTimeUp] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(
    view.state === 'PAID' ? { kind: 'paid', view } : { kind: 'idle' },
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = useRef(false);
  const holdEnd = view.holdExpiresAt;

  useEffect(() => {
    if (outcome.kind === 'paid') headingRef.current?.focus();
  }, [outcome.kind]);

  // While a payment is in flight the server decides; the page never swaps to "expired" under it.
  const lapsed = timeUp && outcome.kind !== 'paid' && outcome.kind !== 'paying';

  async function pay() {
    if (busy.current) return;
    busy.current = true;
    setOutcome({ kind: 'paying' });
    try {
      const paid = await postPay(token);
      setOutcome({ kind: 'paid', view: paid });
      window.scrollTo({ top: 0 });
    } catch (error) {
      const failure = classifyPayError(error);
      if (failure === 'expired' || failure === 'cancelled')
        setOutcome({ kind: 'ended', slug: expiredData(error).slug, as: failure });
      else if (failure === 'invalid') setOutcome({ kind: 'invalid' });
      else setOutcome({ kind: 'problem', failure });
    } finally {
      busy.current = false;
    }
  }

  if (outcome.kind === 'invalid') return <Invalid />;
  if (outcome.kind === 'ended') return <Ended kind={outcome.as} slug={outcome.slug} />;
  if (lapsed) return <Ended slug={view.business.slug} />;

  const shown = outcome.kind === 'paid' ? outcome.view : view;
  const { appointment: a, deposit } = shown;
  const when = (
    <MetaLine
      items={[
        f.day(a.startAt),
        <TimeRange key="r" start={f.time(a.startAt)} end={f.time(a.endAt)} />,
        t('withStaff', { staff: isolate(a.staff.displayName) }),
      ]}
    />
  );
  const service = (
    <MetaLine items={[<Bidi key="s">{a.service.name}</Bidi>, f.duration(a.service.durationMin)]} />
  );

  if (outcome.kind === 'paid') {
    // The post-payment truth (F44): the reminders created when the deposit was paid.
    const reminderCopy = tr('promise', { kind: reminderPromiseKind(shown.reminders) });
    return (
      <>
        <BusinessHeader name={shown.business.name} address={shown.business.address} />
        <main className={cn(mainClass, 'lg:justify-center')}>
          <Card className="flex w-full flex-col gap-4 lg:max-w-[560px]">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand"
            >
              <Check size={26} />
            </span>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="m-0 text-[22px] font-semibold outline-none md:text-[26px]"
            >
              {t('done.title')}
            </h1>
            <p className="m-0 text-[17px] font-semibold">{when}</p>
            <p className="m-0 text-[15px] text-muted">{service}</p>
            <p className="m-0 text-[15px]">{t('done.next')}</p>
            <p className="m-0 text-[15px]">{reminderCopy}</p>
            <ButtonLink
              href={`/b/${encodeURIComponent(shown.business.slug)}`}
              size="lg"
              block
              variant="secondary"
            >
              {t('done.action')}
            </ButtonLink>
          </Card>
        </main>
      </>
    );
  }

  const paying = outcome.kind === 'paying';
  return (
    <>
      <BusinessHeader name={view.business.name} address={view.business.address} />
      <main className={mainClass}>
        <aside className={heroClass}>
          <h1 className="m-0 text-[26px] leading-tight font-semibold tracking-[-0.01em] md:text-[30px]">
            {t('heroTitle')}
          </h1>
          <p className="m-0 text-base leading-normal text-hero-muted">{t('intro')}</p>
          {/* Visual countdown only: it ticks every second, so it stays out of any live region. */}
          <div className="flex items-center gap-2 self-start rounded-[16px] bg-white/10 px-3.5 py-3 text-[15px] font-medium">
            <Clock size={18} aria-hidden="true" />
            <span>{t('heldFor')}</span>
            <Countdown holdEnd={holdEnd} offsetMs={offsetMs} onEnd={() => setTimeUp(true)} />
          </div>
        </aside>

        <section
          aria-label={t('summaryLabel')}
          className="flex min-w-0 flex-col gap-4 lg:flex-[999_1_460px]"
        >
          <Card className="flex flex-col gap-4">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-[18px] gap-y-3 text-base">
              <dt className="text-muted">{t('service')}</dt>
              <dd className="m-0 min-w-0 font-medium">{service}</dd>
              <dt className="text-muted">{t('whenLabel')}</dt>
              <dd className="m-0 min-w-0 font-medium">{when}</dd>
              <dt className="text-muted">{t('total')}</dt>
              <dd data-testid="service-total" dir="ltr" className="m-0 min-w-0 text-start font-medium tabular-nums">
                {f.money(a.service.price)}
              </dd>
            </dl>
            <div className="h-px bg-divider" aria-hidden="true" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-semibold">{t('amount')}</span>
              <span dir="ltr" className="text-[30px] leading-none font-semibold tabular-nums">
                {f.money(deposit.amount)}
              </span>
            </div>
          </Card>

          <Callout tone="warning" icon={<FlaskConical />}>
            {t('testMode')}
          </Callout>

          {outcome.kind === 'problem' ? (
            <div role="alert">
              <Callout tone="danger" icon={<TriangleAlert />}>
                {t(`errors.${outcome.failure}`)}
              </Callout>
            </div>
          ) : null}

          <p className="m-0 text-sm leading-[1.45] text-muted">{t('releaseNote')}</p>
          <Button
            size="lg"
            block
            variant="accent"
            onClick={pay}
            loading={paying}
            disabled={paying}
            className="md:h-[58px] md:text-lg"
          >
            {paying ? t('paying') : t('pay')}
          </Button>
        </section>
      </main>
    </>
  );
}
