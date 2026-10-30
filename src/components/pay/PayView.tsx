'use client';

import { Check, Clock, FlaskConical, LinkIcon, TriangleAlert, WifiOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { PageState } from '@/components/public/PageState';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
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
import { useLocaleHint } from '@/lib/useLocaleHint';
import { msLeft } from '@/lib/waitlist/offer';
import { serverNow } from '@/lib/waitlist/clock';

const mainClass =
  'mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 pt-5 pb-10 md:px-8 md:pt-7';

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
    <PageState
      role="status"
      tone="warning"
      icon={<Clock size={26} />}
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

function PaySkeleton({ label }: { label: string }) {
  return (
    <main className={mainClass} aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-[320px] rounded-card" />
    </main>
  );
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'paying' }
  | { kind: 'paid'; view: Pay }
  | { kind: 'ended'; slug?: string | undefined; as: 'expired' | 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'problem'; failure: PayFailure };

function PayBody({ token, view, offsetMs }: { token: string; view: Pay; offsetMs: number }) {
  const t = useTranslations('deposit');
  const f = useBookingFormat(view.business.timezone);
  const [nowMs, setNowMs] = useState(() => serverNow(offsetMs));
  const [outcome, setOutcome] = useState<Outcome>(
    view.state === 'PAID' ? { kind: 'paid', view } : { kind: 'idle' },
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = useRef(false);
  const holdEnd = view.holdExpiresAt;

  useEffect(() => {
    const id = setInterval(() => setNowMs(serverNow(offsetMs)), 1000);
    return () => clearInterval(id);
  }, [offsetMs]);
  useEffect(() => {
    if (outcome.kind === 'paid') headingRef.current?.focus();
  }, [outcome.kind]);

  const left = holdEnd ? msLeft(holdEnd, nowMs) : 0;
  const lapsed = outcome.kind !== 'paid' && holdEnd !== null && left === 0;

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
  const when = t('when', { date: f.day(a.startAt), start: f.time(a.startAt), end: f.time(a.endAt) });
  const detail = t('detail', { service: a.service.name, staff: a.staff.displayName });

  if (outcome.kind === 'paid') {
    return (
      <main className={mainClass}>
        <Card className="flex flex-col gap-4">
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
          <p className="m-0 text-[17px] font-semibold">
            <bdi>{when}</bdi>
          </p>
          <p className="m-0 text-[15px] text-muted">
            <bdi>{detail}</bdi>
          </p>
          <p className="m-0 text-[15px]">{t('done.next')}</p>
          <ButtonLink href={`/b/${encodeURIComponent(shown.business.slug)}`} size="lg" block variant="secondary">
            {t('done.action')}
          </ButtonLink>
        </Card>
      </main>
    );
  }

  const paying = outcome.kind === 'paying';
  return (
    <main className={mainClass}>
      <Card className="flex flex-col gap-4">
        <span className="text-xs font-semibold text-brand uppercase">{t('eyebrow')}</span>
        <h1 className="m-0 text-[22px] font-semibold md:text-[26px]">
          <bdi>{view.business.name}</bdi>
        </h1>
        <p className="m-0 text-[17px] font-semibold">
          <bdi>{when}</bdi>
        </p>
        <p className="m-0 text-[15px] text-muted">
          <bdi>{detail}</bdi>
        </p>
        <p className="m-0 text-[15px]">{t('intro')}</p>

        <dl className="m-0 grid grid-cols-2 gap-3 rounded-[20px] bg-canvas p-[18px]">
          <div className="flex flex-col gap-1">
            <dt className="text-[13px] text-muted">{t('amount')}</dt>
            <dd className="m-0 text-xl font-semibold tabular-nums" dir="ltr">
              {f.money(deposit.amount)}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-[13px] text-muted">{t('countdownLabel')}</dt>
            <dd
              className="m-0 text-xl font-semibold tabular-nums"
              dir="ltr"
              data-testid="countdown"
            >
              {clockText(left)}
            </dd>
          </div>
        </dl>

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

        <Button size="lg" block onClick={pay} loading={paying} disabled={paying}>
          {paying ? t('paying') : t('pay')}
        </Button>
      </Card>
    </main>
  );
}
