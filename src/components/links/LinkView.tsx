'use client';

import { Bell, Check, Clock, LinkIcon, WifiOff, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';
import { PageState } from '@/components/public/PageState';
import { BusinessHero } from '@/components/public/BusinessHero';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import { isolate, ltr } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { getLink, postLinkAction, type LinkView as Link } from '@/lib/api/links';
import { useResource } from '@/lib/api/useResource';
import { createSubmitGuard } from '@/lib/auth/submitGuard';
import {
  buttonsFor,
  cancelNoteKind,
  classifyLinkError,
  screenFor,
  screenAfter,
  tokenCanCancel,
  type LinkAction,
  type LinkFailure,
  type LinkScreen,
} from '@/lib/links/state';
import { useLocaleHint } from '@/lib/useLocaleHint';

const mainClass =
  'mx-auto flex w-full max-w-[1240px] flex-1 flex-wrap items-start gap-6 px-4 pt-5 pb-10 md:px-8 md:pt-7';

type Shown = { link: Link; screen: LinkScreen };

/** Boards 2.1 (confirm or cancel) and 2.2 (cancelled) at /l/[token]. Loading never changes anything; actions are POSTs on a button press. */
export function LinkView({ token }: { token: string }) {
  const t = useTranslations('link');
  const resource = useResource((signal) => getLink(token, signal), token);
  const [shown, setShown] = useState<Shown>();
  const [gone, setGone] = useState<'invalid' | 'expired'>();
  const pathname = usePathname();
  useLocaleHint(resource.data?.business.locale, pathname);

  const failure: LinkFailure | undefined = resource.error ? classifyLinkError(resource.error) : gone;

  if (failure === 'invalid' || failure === 'expired') {
    return (
      <PageState
        role="status"
        icon={failure === 'invalid' ? <LinkIcon size={26} /> : <Clock size={26} />}
        title={t(`${failure}.title`)}
        body={t(`${failure}.body`)}
        action={
          <ButtonLink href="/" size="lg" block>
            {t(`${failure}.action`)}
          </ButtonLink>
        }
      />
    );
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
  if (!resource.data) return <LinkSkeleton label={t('loading')} />;

  const current: Shown = shown ?? { link: resource.data, screen: screenFor(resource.data) };
  return (
    <LinkBody
      token={token}
      shown={current}
      onShown={setShown}
      onGone={(kind) => setGone(kind)}
    />
  );
}

function LinkBody({
  token,
  shown,
  onShown,
  onGone,
}: {
  token: string;
  shown: Shown;
  onShown: (next: Shown) => void;
  onGone: (kind: 'invalid' | 'expired') => void;
}) {
  const t = useTranslations('link');
  const { link, screen } = shown;
  const { appointment, business } = link;
  const f = useBookingFormat(business.timezone);
  const guard = useRef(createSubmitGuard());
  const [pending, setPending] = useState<LinkAction>();
  const [problem, setProblem] = useState<Exclude<LinkFailure, 'invalid' | 'expired'>>();
  const [dialog, setDialog] = useState(false);

  const when = t('when', {
    date: f.day(appointment.startAt),
    range: f.range(appointment.startAt, appointment.endAt),
  });
  const detail = t('details', {
    service: isolate(appointment.service.name),
    staff: isolate(appointment.staff.displayName),
    price: ltr(f.money(appointment.service.price)),
  });
  const cutoff = f.dayAndTime(link.cancelCutoffAt);
  const late = cancelNoteKind(link) === 'late';

  /** Re-read the appointment (GET, no side effects) and re-derive the screen and buttons from it. */
  async function refetch(keepOpenScreen: boolean) {
    try {
      const fresh = await getLink(token);
      const next = screenFor(fresh);
      onShown({ link: fresh, screen: keepOpenScreen && next === 'actionable' ? screen : next });
    } catch (error) {
      const kind = classifyLinkError(error);
      if (kind === 'invalid' || kind === 'expired') onGone(kind);
    }
  }

  /** Opening the dialog re-reads the appointment so "free" or "late" is current, not as of page load. */
  function openCancel() {
    setDialog(true);
    void refetch(true);
  }

  async function run(action: LinkAction) {
    if (!guard.current.tryStart()) return;
    setPending(action);
    setProblem(undefined);
    try {
      const { result, ...next } = await postLinkAction(token, action);
      onShown({ link: next, screen: screenAfter(result, next) });
      setDialog(false);
      window.scrollTo({ top: 0 });
    } catch (error) {
      const kind = classifyLinkError(error);
      if (kind === 'invalid' || kind === 'expired') onGone(kind);
      else setProblem(kind);
      setDialog(false);
      // 409: the appointment changed under us (cancelled elsewhere, already attended): show what it is now.
      if (kind === 'notAllowed') await refetch(false);
    } finally {
      guard.current.release();
      setPending(undefined);
    }
  }

  const tile = (
    <div className="flex flex-wrap items-center gap-4 rounded-[20px] bg-canvas p-[18px]">
      <span
        aria-hidden="true"
        className="flex h-[72px] w-[68px] shrink-0 flex-col items-center justify-center rounded-tile border border-line bg-surface"
      >
        <span className="text-xs font-semibold text-brand uppercase">
          {f.month(appointment.startAt)}
        </span>
        <span className="text-[26px] leading-tight font-semibold tabular-nums">
          {f.dayOfMonth(appointment.startAt)}
        </span>
      </span>
      <span className="flex min-w-[200px] flex-1 flex-col gap-1">
        <span className="text-lg font-semibold md:text-xl">
          <bdi>{when}</bdi>
        </span>
        <span className="text-[15px] text-muted">{detail}</span>
      </span>
    </div>
  );

  let body: ReactNode;
  if (screen === 'actionable') {
    const buttons = buttonsFor(link);
    const confirmed = appointment.status === 'CONFIRMED' || link.confirmedAt !== null;
    body = (
      <Card className="flex flex-col gap-5 md:gap-[22px] md:p-8">
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] text-muted">{t('eyebrow')}</span>
          <h2 className="m-0 text-2xl font-semibold md:text-[30px]">{t(`title.${link.act}`)}</h2>
        </div>
        {tile}
        <div>
          <Chip tone={confirmed ? 'brand' : 'warning'} className="px-3 py-1.5 text-[13px]">
            {confirmed ? t('status.confirmed') : t('status.waiting')}
          </Chip>
        </div>
        {problem ? (
          <div role="alert">
            <Callout tone="danger">{t(`errors.${problem}`)}</Callout>
          </div>
        ) : null}
        {buttons.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            {buttons.map(({ action, primary }) => (
              <Button
                key={action}
                data-primary={primary}
                size="lg"
                block
                variant={action === 'cancel' ? 'danger' : primary ? 'accent' : 'secondary'}
                className="h-[54px] text-base"
                loading={pending === action && action === 'confirm'}
                disabled={pending !== undefined && pending !== action}
                onClick={() => (action === 'confirm' ? void run('confirm') : openCancel())}
              >
                {t(`actions.${action}`)}
              </Button>
            ))}
          </div>
        ) : null}
        {buttons.length === 0 ? (
          <Callout>
            {appointment.status === 'PENDING_PAYMENT' ? t('noActions.pendingPayment') : t('noActions.generic')}
          </Callout>
        ) : null}
        {link.act === 'confirm' && link.canCancel ? (
          <p className="m-0 text-sm text-muted">{t('confirmOnlyHint')}</p>
        ) : null}
      </Card>
    );
  } else if (screen === 'confirmed') {
    body = (
      <Card className="flex flex-col gap-5 md:p-8">
        <Banner tone="success" icon={<Check size={30} strokeWidth={3} />} title={t('confirmedScreen.title')}>
          {t('confirmedScreen.body', { name: business.name, when: `${f.day(appointment.startAt)} · ${f.time(appointment.startAt)}` })}
        </Banner>
        {tile}
        {tokenCanCancel(link) ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-muted">{t('confirmedScreen.cancelHint')}</p>
            {problem ? (
              <div role="alert">
                <Callout tone="danger">{t(`errors.${problem}`)}</Callout>
              </div>
            ) : null}
            <Button
              variant="danger"
              size="lg"
              className="h-[54px] text-base sm:self-start"
              onClick={openCancel}
            >
              {t('actions.cancel')}
            </Button>
          </div>
        ) : null}
      </Card>
    );
  } else if (screen === 'cancelled' || screen === 'lateCancelled') {
    body = (
      <Card className="flex flex-col gap-5 md:p-8">
        <Banner tone="muted" icon={<X size={28} strokeWidth={2.5} />} title={t('cancelledScreen.title')}>
          {screen === 'lateCancelled'
            ? t('cancelledScreen.bodyLate', { name: business.name })
            : t('cancelledScreen.bodyFree')}
        </Banner>
        {tile}
        <Callout icon={<Bell />}>{t('cancelledScreen.freed')}</Callout>
        <ButtonLink
          href={`/b/${encodeURIComponent(business.slug)}`}
          variant="accent"
          size="lg"
          className="h-[54px] text-base max-sm:w-full sm:self-start"
        >
          {t('cancelledScreen.bookNew')}
        </ButtonLink>
      </Card>
    );
  } else {
    body = (
      <Card className="flex flex-col gap-5 md:p-8">
        <Banner tone="muted" icon={<Check size={28} strokeWidth={2.5} />} title={t('overScreen.title')}>
          {t('overScreen.body', { name: business.name })}
        </Banner>
        {tile}
      </Card>
    );
  }

  const showCutoff = screen === 'actionable' && link.canCancel;

  return (
    <>
      <BusinessHero name={business.name} meta="" />
      <main className={mainClass}>
        <section className="flex min-w-0 flex-[999_1_320px] flex-col gap-4.5">{body}</section>
        <aside className="flex w-full flex-[1_1_240px] flex-col gap-3.5 lg:max-w-[290px]">
          <Card size="sm" padding="compact" className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-semibold">{business.name}</h2>
            <ButtonLink
              href={`/b/${encodeURIComponent(business.slug)}`}
              variant="ghost"
              className="self-start"
            >
              {t('side.bookAgain')}
            </ButtonLink>
          </Card>
          {showCutoff ? (
            <Callout icon={<Bell />}>
              {late ? t('side.lateCancel', { cutoff }) : t('side.freeCancel', { cutoff, name: business.name })}
            </Callout>
          ) : null}
          <p className="m-0 px-1 text-[13px] text-muted">{t('side.privacy')}</p>
        </aside>
      </main>

      <Sheet
        open={dialog}
        onOpenChange={(open) => !pending && setDialog(open)}
        title={t('cancelDialog.title')}
        description={late ? t('cancelDialog.late', { cutoff, name: business.name }) : t('cancelDialog.free', { cutoff })}
        closeLabel={t('cancelDialog.close')}
      >
        <div className="flex flex-col gap-3 pt-2">
          <Button
            variant="danger"
            size="lg"
            block
            loading={pending === 'cancel'}
            onClick={() => void run('cancel')}
          >
            {t('cancelDialog.yes')}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            disabled={pending === 'cancel'}
            onClick={() => setDialog(false)}
          >
            {t('cancelDialog.keep')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'success' | 'muted';
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <span
        aria-hidden="true"
        className={
          tone === 'success'
            ? 'flex size-14 shrink-0 items-center justify-center rounded-pill bg-success-soft text-success'
            : 'flex size-14 shrink-0 items-center justify-center rounded-pill bg-divider text-muted'
        }
      >
        {icon}
      </span>
      <div role="status" className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 text-2xl leading-tight font-semibold md:text-[28px]">{title}</h2>
        <p className="m-0 text-[15px] text-muted">{children}</p>
      </div>
    </div>
  );
}

function LinkSkeleton({ label }: { label: string }) {
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
