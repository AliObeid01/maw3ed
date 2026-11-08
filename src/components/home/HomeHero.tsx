'use client';

import { ArrowRight, MapPin, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { cn } from '@/lib/cn';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Select, type SelectOption } from '@/components/ui/Select';
import { PendingLink as Link, useNavigationFlag } from '@/components/public/PendingLink';
import { getCategoriesCached } from '@/lib/api/home';
import { useResource } from '@/lib/api/useResource';
import { AREA_KEYS } from '@/lib/business/profile';
import { DIRECTORY_SEARCH_MAX } from '@/lib/directory/params';
import { heroChips } from '@/lib/home/popular';
import { buildDirectoryUrl, POPULAR_SEARCHES } from '@/lib/home/search';
import { useIsDesktop } from '@/lib/useMediaQuery';
import { NextFreePanel } from './NextFreePanel';

const AREAS = AREA_KEYS.filter((k) => k !== 'other');

/** Board "Home": navy hero with the search card, popular chips and (lg+) the live Next free panel. */
export function HomeHero() {
  const t = useTranslations('home.hero');
  const areaName = useTranslations('public.area');
  const router = useRouter();
  const desktop = useIsDesktop();
  const [text, setText] = useState('');
  const [area, setArea] = useState('');
  const [pending, setPending] = useState(false);
  const [navigating, startNavigation] = useTransition();
  useNavigationFlag(navigating); // the top progress bar shows while the search page loads
  // The right column is reserved while the panel loads or shows; it collapses only when there is nothing to show.
  const [panelHidden, setPanelHidden] = useState(false);
  // Popular chips come from the live categories (the same cached request the category list uses); the static list is the fallback.
  const cats = useResource(() => getCategoriesCached(''), 'categories');
  const chips = useMemo(
    () => heroChips(cats.data?.categories, POPULAR_SEARCHES.map((key) => t(`popularItems.${key}`))),
    [cats.data, t],
  );

  const options = useMemo<SelectOption[]>(
    () => [{ value: '', label: t('areaAll') }, ...AREAS.map((k) => ({ value: k, label: areaName(k) }))],
    [t, areaName],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    startNavigation(() => router.push(buildDirectoryUrl({ search: text, area })));
  };

  return (
    <section data-surface="dark" className="bg-navy text-white">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-12 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:py-[72px] lg:pb-[88px]">
        <div className="min-w-0">
          <h1 className="m-0 max-w-[13ch] text-[clamp(38px,6.2vw,64px)] leading-[1.05] font-bold tracking-[-0.03em] rtl:max-w-[14ch] rtl:leading-[1.2] rtl:tracking-normal">
            {t('titleLead')} <span className="text-hero-accent">{t('titleAccent')}</span>
          </h1>
          <p className="m-0 mt-[18px] max-w-[44ch] text-[19px] text-hero-muted">{t('subtitle')}</p>

          <form
            role="search"
            onSubmit={onSubmit}
            className="mt-[30px] grid gap-1 rounded-[20px] bg-surface p-2 text-ink sm:grid-cols-[1.6fr_1fr_auto] sm:items-center"
          >
            <div className="grid gap-0.5 rounded-[14px] px-3.5 py-1.5 transition-colors duration-200 focus-within:bg-divider">
              <label htmlFor="home-search" className="text-[13px] font-semibold text-muted">
                {t('searchLabel')}
              </label>
              <div className="flex items-center gap-2.5 text-brand">
                <Search size={20} aria-hidden="true" className="shrink-0" />
                <input
                  id="home-search"
                  name="search"
                  type="search"
                  value={text}
                  maxLength={DIRECTORY_SEARCH_MAX}
                  autoComplete="off"
                  enterKeyHint="search"
                  placeholder={t('searchPlaceholder')}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-11 w-full min-w-0 border-0 bg-transparent p-0 text-[17px] font-medium text-ink outline-none placeholder:text-subtle"
                />
              </div>
            </div>
            <div className="grid gap-0.5 rounded-[14px] px-3.5 py-1.5 transition-colors duration-200 focus-within:bg-divider">
              <label htmlFor="home-area" className="text-[13px] font-semibold text-muted">
                {t('areaLabel')}
              </label>
              <div className="flex items-center gap-2.5 text-brand">
                <MapPin size={20} aria-hidden="true" className="shrink-0" />
                <Select
                  bare
                  id="home-area"
                  label={t('areaLabel')}
                  value={area}
                  onChange={setArea}
                  options={options}
                  className="h-11 min-h-11 border-0 bg-transparent px-0 text-[17px] font-medium"
                />
              </div>
            </div>
            <button
              type="submit"
              aria-disabled={pending || undefined}
              className={buttonClasses({
                variant: 'turquoise',
                size: 'hero',
                className: 'min-h-[54px] sm:m-1',
              })}
            >
              {t('submit')}
              <ArrowRight size={20} aria-hidden="true" className="rtl:-scale-x-100" />
            </button>
          </form>

          {/* One line, never wraps: the row keeps its height whether the chips are the fallback or live names. */}
          <div
            data-allow-overflow
            data-testid="hero-chips"
            className="mt-[18px] flex min-h-11 flex-nowrap items-center gap-2 overflow-x-auto text-[15px] text-hero-muted"
          >
            <span className="shrink-0">{t('popular')}</span>
            {chips.map((name) => (
              <Link
                key={name.toLowerCase()}
                href={buildDirectoryUrl({ search: name })}
                className="inline-flex min-h-11 max-w-[220px] shrink-0 items-center rounded-pill border border-white/35 px-4 font-medium text-white no-underline transition-colors duration-200 ease-out hover:bg-white/15 aria-busy:opacity-70 motion-reduce:transition-none"
              >
                <span className="truncate">{name}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className={cn('hidden lg:block', !panelHidden && 'lg:min-h-[496px]')}>
          {desktop ? <NextFreePanel area={area} onHidden={setPanelHidden} /> : null}
        </div>
      </div>
    </section>
  );
}
