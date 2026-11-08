'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { profileLine, useAreaLabel } from '@/components/public/areaLabel';
import { useCategoryLabel } from '@/components/public/categoryLabel';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { Bidi } from '@/components/ui/Bidi';
import { BusinessAvatar } from '@/components/ui/BusinessAvatar';
import { Skeleton } from '@/components/ui/Skeleton';
import type { DirectoryBusiness } from '@/lib/api/directory';
import { getNextFreePanel, PANEL_ROWS } from '@/lib/api/home';
import { isAreaKey } from '@/lib/business/profile';
import { chipTime } from '@/lib/home/freeTimes';

/** The area select is debounced this long before a new request is sent. */
export const PANEL_DEBOUNCE_MS = 300;

type Result = { area: string; status: 'ready' | 'hidden'; items: DirectoryBusiness[] };

/**
 * Rows for the hero panel. The first request goes out at once; a later area change waits 300 ms (typing through the
 * select does not fire a request per option), aborts the previous request and uses the 60 s per-area cache. Any
 * failure (empty list, 429, network, bad response) hides the panel: it never stays on a skeleton.
 */
export function useNextFreePanel(area: string, enabled: boolean) {
  const [result, setResult] = useState<Result>();
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const delay = first.current ? 0 : PANEL_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      first.current = false;
      getNextFreePanel(area, controller.signal)
        .then((page) => {
          const items = page.businesses.filter((b) => b.nextFree).slice(0, PANEL_ROWS);
          setResult({ area, status: items.length > 0 ? 'ready' : 'hidden', items });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
          setResult({ area, status: 'hidden', items: [] });
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [area, enabled]);
  const current = result && result.area === area ? result : undefined;
  return { loading: !current, status: current?.status, items: current?.items ?? [] };
}

function Row({ business }: { business: DirectoryBusiness }) {
  const t = useTranslations('home.nextFree');
  const locale = useLocale();
  const categoryLabel = useCategoryLabel();
  const areaLabel = useAreaLabel();
  const zone = business.timezone ?? 'Asia/Beirut';
  const next = business.nextFree;
  const chip = next ? chipTime(next.startAt, zone, new Date(), locale) : null;
  const day = chip
    ? chip.day.kind === 'today'
      ? t('today')
      : chip.day.kind === 'tomorrow'
        ? t('tomorrow')
        : chip.day.text
    : null;
  const meta = profileLine(categoryLabel(business.category), business.address ?? areaLabel(business.area));

  return (
    <li className="border-t border-divider first:border-t-0">
      <Link
        href={`/b/${encodeURIComponent(business.slug)}`}
        className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-2.5 py-2 text-ink no-underline transition-colors duration-200 ease-out hover:bg-divider aria-busy:opacity-70 motion-reduce:transition-none"
      >
        <BusinessAvatar name={business.name} logoUrl={business.logoUrl} size={46} tone="navy" />
        <span className="min-w-0">
          <b className="block truncate text-[16px] leading-tight font-semibold">
            <Bidi>{business.name}</Bidi>
          </b>
          {meta ? <small className="mt-0.5 block truncate text-[13.5px] text-muted">{meta}</small> : null}
        </span>
        {chip && day ? (
          <span
            data-testid="panel-time"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-tile border-[1.5px] border-brand-avatar bg-surface px-3 text-[15px] font-semibold whitespace-nowrap text-brand"
          >
            {day}
            <bdi dir="ltr" className="tabular-nums">
              {chip.time}
            </bdi>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * The hero's right column (lg and up): ONE Royal Blue card "Next free" holding ONE white card with up to four rows, one
 * business per row across categories, each with its soonest free time. The whole row opens the business page (we do
 * not preselect the time: the booking page shows what is free right now).
 */
export function NextFreePanel({ area, onHidden }: { area: string; onHidden: (hidden: boolean) => void }) {
  const t = useTranslations('home.nextFree');
  const areaName = useTranslations('public.area');
  const { loading, status, items } = useNextFreePanel(area, true);
  const hidden = status === 'hidden';
  useEffect(() => {
    onHidden(hidden);
  }, [hidden, onHidden]);
  if (hidden) return null;

  const title = isAreaKey(area) ? t('titleIn', { area: areaName(area) }) : t('title');
  return (
    <section
      aria-labelledby="next-free-title"
      aria-busy={loading}
      data-testid="next-free-panel"
      className="rounded-[28px] bg-brand p-6 text-white lg:min-h-[480px]"
    >
      <h2 id="next-free-title" className="m-0 mb-1 text-[22px] font-semibold">
        {title}
      </h2>
      <p className="m-0 mb-4 text-[15.5px] text-brand-soft">{t('hint')}</p>
      <div className="rounded-[20px] bg-surface p-2.5 text-ink">
        {loading ? (
          <div role="status" className="grid gap-px">
            <span className="sr-only">{t('loading')}</span>
            {Array.from({ length: PANEL_ROWS }, (_, i) => (
              <Skeleton key={i} className="h-[72px] rounded-[14px]" />
            ))}
          </div>
        ) : (
          <ul className="m-0 grid list-none p-0">
            {items.map((b) => (
              <Row key={b.slug} business={b} />
            ))}
          </ul>
        )}
      </div>
      {!loading ? (
        <p className="m-0 mt-3 text-[13.5px] text-brand-soft">{t('note')}</p>
      ) : (
        <Skeleton aria-hidden="true" className="mt-3 h-[34px] rounded-nav bg-white/20" />
      )}
    </section>
  );
}
