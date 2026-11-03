'use client';

import { Check, Copy, Download, ExternalLink, MapPin, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { getBusiness } from '@/lib/api/setup';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import {
  bookingUrl,
  copyText,
  displayUrl,
  publicOrigin,
  whatsappShareUrl,
} from '@/lib/setup/clipboard';
import { shareSeenKey } from '@/lib/setup/steps';
import { useAppSession } from '../SessionContext';
import { DirectoryCard } from './DirectoryCard';
import { LoadError, OwnerOnly } from '../states';

const noopSubscribe = () => () => undefined;

function markShared(slug: string) {
  try {
    window.localStorage.setItem(shareSeenKey(slug), '1');
  } catch {
    // private mode: the checklist simply keeps the step open
  }
}

/** Copies the link, flips the label to "Copied" for two seconds and tells screen readers via the toast. */
function useCopy(url: string, slug: string) {
  const t = useTranslations('app.share');
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(url);
    if (ok) {
      markShared(slug);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
      toast.show(t('copied'));
    } else {
      toast.show(t('copyFailed'), 'error');
    }
  };
  return { copied, copy };
}

function ChannelCard({
  icon,
  tint,
  title,
  body,
  action,
  href,
  onClick,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  body: string;
  action: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const className =
    'flex min-h-11 w-full flex-col gap-3 rounded-card-sm border border-line bg-surface p-5 text-start text-ink no-underline transition-shadow duration-200 ease-out hover:shadow-[0_4px_14px_rgb(11_25_56/0.06)]';
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn('flex size-12 items-center justify-center rounded-input', tint)}
      >
        {icon}
      </span>
      <span className="text-[17px] font-semibold">{title}</span>
      <span className="text-sm leading-[1.45] text-muted">{body}</span>
      <span className="mt-auto flex items-center gap-1.5 pt-1 text-sm font-semibold text-brand">
        {action}
      </span>
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={className}
    >
      {content}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function QrCard({ url, name }: { url: string; name: string }) {
  const t = useTranslations('app.share.qr');
  const [dataUrl, setDataUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((QR) =>
        QR.toDataURL(url, {
          width: 352,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0B1938', light: '#FFFFFF' },
        }),
      )
      .then((value) => {
        if (!cancelled) setDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <Card size="sm" className="flex flex-wrap items-center gap-5 p-5">
      <div className="size-44 shrink-0 overflow-hidden rounded-2xl border border-line bg-white">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing to optimise
          <img
            src={dataUrl}
            width={176}
            height={176}
            alt={t('alt', { name })}
            className="size-full"
          />
        ) : failed ? (
          <span className="flex size-full items-center justify-center p-3 text-center text-[13px] text-muted">
            {t('failed')}
          </span>
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </div>
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
        <h3 className="m-0 text-[17px] font-semibold">{t('title')}</h3>
        <p className="m-0 text-sm leading-[1.45] text-muted">{t('body')}</p>
        {dataUrl ? (
          <a
            href={dataUrl}
            download="booking-qr.png"
            className={buttonClasses({ variant: 'secondary', className: 'mt-2 w-fit' })}
          >
            <Download size={18} aria-hidden="true" />
            {t('download')}
          </a>
        ) : null}
      </div>
    </Card>
  );
}

function ShareSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <Skeleton className="h-[200px] rounded-card md:h-[117px]" />
      <Skeleton className="h-7 w-64" />
      <div className="grid gap-3.5 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[154px] rounded-card-sm" />
        ))}
      </div>
    </div>
  );
}

function ShareBody({
  ready,
  businessName,
  directory,
}: {
  ready: boolean;
  businessName: string;
  directory: ReactNode;
}) {
  const t = useTranslations('app.share');
  const { slug } = useAppSession();
  const origin = useSyncExternalStore(
    noopSubscribe,
    // NEXT_PUBLIC_APP_URL (public site address) wins; otherwise the origin the dashboard is served from.
    () => publicOrigin(process.env.NEXT_PUBLIC_APP_URL, window.location.origin),
    () => '',
  );
  const url = origin ? bookingUrl(origin, slug) : '';
  const hero = useCopy(url, slug);
  const instagram = useCopy(url, slug);
  const maps = useCopy(url, slug);

  if (!url) return <ShareSkeleton />;

  return (
    <>
      <section className="flex flex-wrap items-center gap-5 rounded-card bg-hero p-5 text-white md:p-7">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn('size-2.5 rounded-pill', ready ? 'bg-accent' : 'bg-white/60')}
            />
            <span className="text-sm font-semibold text-hero-ink">
              {ready ? t('live') : t('notReady')}
            </span>
          </div>
          <div
            dir="ltr"
            className="text-start text-xl font-semibold [overflow-wrap:anywhere] md:text-[28px]"
          >
            {displayUrl(url)}
          </div>
          {!ready ? (
            <Link
              href="/app/setup"
              className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-white underline"
            >
              {t('finishSetup')}
            </Link>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap gap-2.5 md:w-auto">
          <button
            type="button"
            onClick={hero.copy}
            className={buttonClasses({
              variant: 'accent',
              size: 'lg',
              className: 'flex-1 md:flex-none',
            })}
          >
            {hero.copied ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <Copy size={18} aria-hidden="true" />
            )}
            {hero.copied ? t('copiedShort') : t('copy')}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => markShared(slug)}
            className={buttonClasses({
              variant: 'ghost',
              size: 'lg',
              className:
                'flex-1 border border-white/35 font-medium text-white hover:bg-white/10 md:flex-none',
            })}
          >
            {t('open')}
            <ExternalLink size={16} aria-hidden="true" className="rtl:-scale-x-100" />
          </a>
        </div>
      </section>

      {directory}

      <h2 className="m-0 mt-1 text-[19px] font-semibold">{t('where')}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3.5">
        <ChannelCard
          icon={<MessageCircle size={24} />}
          tint="bg-success-soft text-success"
          title={t('whatsapp.title')}
          body={t('whatsapp.body')}
          href={whatsappShareUrl(t('whatsapp.message', { name: businessName, url }))}
          onClick={() => markShared(slug)}
          action={
            <>
              {t('whatsapp.action')}
              <ExternalLink size={16} aria-hidden="true" className="rtl:-scale-x-100" />
            </>
          }
        />
        <ChannelCard
          icon={<InstagramGlyph />}
          tint="bg-brand-soft text-brand"
          title={t('instagram.title')}
          body={t('instagram.body')}
          onClick={instagram.copy}
          action={
            <>
              {instagram.copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {instagram.copied ? t('copiedShort') : t('copy')}
            </>
          }
        />
        <ChannelCard
          icon={<MapPin size={24} />}
          tint="bg-warning-soft text-warning"
          title={t('maps.title')}
          body={t('maps.body')}
          onClick={maps.copy}
          action={
            <>
              {maps.copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {maps.copied ? t('copiedShort') : t('copy')}
            </>
          }
        />
      </div>
      <QrCard url={url} name={businessName} />
    </>
  );
}

/** lucide-react 1.x ships no brand icons; this is the Instagram outline in the same stroke style. */
function InstagramGlyph() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function ShareView() {
  return (
    <OwnerOnly>
      <ShareInner />
    </OwnerOnly>
  );
}

function ShareInner() {
  const business = useResource(getBusiness, 'business');
  if (business.error && !business.data)
    return <LoadError error={business.error} onRetry={business.reload} />;
  if (!business.data) return <ShareSkeleton />;
  const { setup, name } = business.data;
  const current = business.data;
  return (
    <ShareBody
      directory={<DirectoryCard business={current} onChange={business.setData} />}
      ready={setup.hasServices && setup.hasBookableStaff && setup.hasHours}
      businessName={name}
    />
  );
}
