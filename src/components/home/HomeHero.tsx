'use client';

import { ArrowRight, MapPin, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { getHomeDirectory } from '@/lib/api/home';
import { useResource } from '@/lib/api/useResource';
import { AREA_KEYS, isAreaKey } from '@/lib/business/profile';
import { DIRECTORY_SEARCH_MAX } from '@/lib/directory/params';
import { buildDirectoryUrl, POPULAR_SEARCHES } from '@/lib/home/search';
import { useIsDesktop } from '@/lib/useMediaQuery';
import { PlaceCard } from './PlaceCard';

const AREAS = AREA_KEYS.filter((k) => k !== 'other');

/** Right column of the hero (lg and up): live next-free cards. Hidden when there is nothing to show. */
function NextFreePanel({ area }: { area: string }) {
  const t = useTranslations('home.nextFree');
  const areaName = useTranslations('public.area');
  const { data, error, loading } = useResource(
    () => getHomeDirectory(area ? { area } : {}),
    `nextfree:${area}`,
  );
  const items = data?.businesses.filter((b) => (b.freeTimes?.length ?? 0) > 0) ?? [];
  if (!loading && (error || items.length === 0)) return null;

  const title = isAreaKey(area) ? t('titleIn', { area: areaName(area) }) : t('title');
  return (
    <section
      aria-labelledby="next-free-title"
      aria-busy={loading}
      data-testid="next-free-panel"
      className="rounded-[28px] bg-brand p-6 text-white"
    >
      <h2 id="next-free-title" className="m-0 mb-1 text-[22px] font-semibold">
        {title}
      </h2>
      <p className="m-0 mb-4 text-[15.5px] text-brand-soft">{t('hint')}</p>
      {loading ? (
        <div role="status" className="grid gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-[188px] rounded-[18px] bg-white/20" />
          <Skeleton className="h-[188px] rounded-[18px] bg-white/20" />
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {items.map((b) => (
            <li key={b.slug}>
              <PlaceCard business={b} avatar="navy" />
            </li>
          ))}
        </ul>
      )}
      {!loading ? <p className="m-0 mt-3 text-[13.5px] text-brand-soft">{t('note')}</p> : null}
    </section>
  );
}

/** Board "Home": navy hero with the search card, popular chips and (lg+) the live Next free panel. */
export function HomeHero() {
  const t = useTranslations('home.hero');
  const areaName = useTranslations('public.area');
  const router = useRouter();
  const desktop = useIsDesktop();
  const [text, setText] = useState('');
  const [area, setArea] = useState('');
  const [pending, setPending] = useState(false);

  const options = useMemo<SelectOption[]>(
    () => [{ value: '', label: t('areaAll') }, ...AREAS.map((k) => ({ value: k, label: areaName(k) }))],
    [t, areaName],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    router.push(buildDirectoryUrl({ search: text, area }));
  };

  return (
    <section data-surface="dark" className="bg-navy text-white">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-12 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:py-[72px] lg:pb-[88px]">
        <div>
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

          <div className="mt-[18px] flex flex-wrap items-center gap-2 text-[15px] text-hero-muted">
            <span>{t('popular')}</span>
            {POPULAR_SEARCHES.map((key) => (
              <Link
                key={key}
                href={buildDirectoryUrl({ search: t(`popularItems.${key}`) })}
                className="inline-flex min-h-11 items-center rounded-pill border border-white/35 px-4 font-medium text-white no-underline transition-colors duration-200 ease-out hover:bg-white/15"
              >
                {t(`popularItems.${key}`)}
              </Link>
            ))}
          </div>
        </div>

        {desktop ? <NextFreePanel area={area} /> : null}
      </div>
    </section>
  );
}
