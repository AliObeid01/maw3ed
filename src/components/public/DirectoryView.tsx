'use client';

import { CloudOff, Search, SearchX } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ltr } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { getDirectory, type DirectoryBusiness } from '@/lib/api/directory';
import { AREA_KEYS, CATEGORY_KEYS, isAreaKey } from '@/lib/business/profile';
import { useAppFormat } from '@/lib/useAppFormat';
import { cleanCategoryParam, cleanSearchParam } from '@/lib/directory/params';
import { profileLine, useAreaLabel } from './areaLabel';
import { useCategoryLabel } from './categoryLabel';
import { monogram } from './monogram';
import { PageState } from './PageState';

const PAGE_SIZE = 24;
const DEBOUNCE_MS = 300;

type State = {
  key: string;
  items: DirectoryBusiness[];
  cursor: string | null;
  status: 'loading' | 'ready' | 'error';
  more: 'idle' | 'loading' | 'error';
};

const initial: State = { key: '', items: [], cursor: null, status: 'loading', more: 'idle' };

function BusinessCard({ business }: { business: DirectoryBusiness }) {
  const t = useTranslations('directory');
  const { money } = useAppFormat();
  const price = business.fromPrice === null ? null : ltr(money(business.fromPrice));
  const categoryLabel = useCategoryLabel();
  const areaLabel = useAreaLabel();
  const line = profileLine(categoryLabel(business.category), areaLabel(business.area));
  return (
    <Card as="li" size="sm" padding="compact" className="flex flex-col gap-4 list-none">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-brand-soft text-lg font-semibold text-brand"
        >
          {monogram(business.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="m-0 truncate text-[17px] font-semibold">{business.name}</h2>
          {line ? <span className="truncate text-sm text-muted">{line}</span> : null}
          {business.address ? (
            <span className="truncate text-sm text-muted">{business.address}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink">
          {price ? t('from', { price }) : t('servicesCount', { count: business.serviceCount })}
        </span>
        <ButtonLink
          href={`/b/${encodeURIComponent(business.slug)}`}
          aria-label={t('bookAria', { name: business.name })}
        >
          {t('book')}
        </ButtonLink>
      </div>
    </Card>
  );
}

/** For business owners who land here: sign up to be listed (listing itself is switched on later, from Share). */
function OwnerLink({ variant }: { variant: 'empty' | 'list' }) {
  const t = useTranslations('directory.ownerCta');
  if (variant === 'empty')
    return (
      <div className="mt-2 flex flex-col items-center gap-2" data-testid="directory-owner-cta">
        <ButtonLink href="/signup" variant="secondary">
          {t('link')}
        </ButtonLink>
        <p className="m-0 max-w-sm text-[13px] text-muted">{t('hint')}</p>
      </div>
    );
  return (
    <p
      className="m-0 flex flex-wrap items-center justify-center gap-x-1 text-center text-sm text-muted"
      data-testid="directory-owner-cta"
    >
      {t('own')}
      <ButtonLink href="/signup" variant="ghost" size="row" className="font-semibold text-brand">
        {t('listYours')}
      </ButtonLink>
    </p>
  );
}

function ListSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="directory-skeleton"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-[142px] rounded-card-sm" />
      ))}
    </div>
  );
}

/** Public directory: search by name, cards linking to each booking page. Opt-in listings only. */
export function DirectoryView() {
  const t = useTranslations('directory');
  const categoryLabel = useCategoryLabel();
  const areaLabel = useAreaLabel();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The URL is the source of truth for the filters (shareable, survives reload and back); the text box is debounced.
  // Values from the URL are cleaned like `area`: what the API would refuse (too long, NUL) never reaches it.
  const initialSearch = cleanSearchParam(params.get('search'));
  const category = cleanCategoryParam(params.get('category'));
  const areaParam = params.get('area') ?? '';
  const area = isAreaKey(areaParam) ? areaParam : '';
  const [text, setText] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [fetched, setState] = useState<State>(initial);
  const [attempt, setAttempt] = useState(0);

  /** Write one or more query parameters (empty removes them) without adding history entries or scrolling. */
  const writeParams = useCallback(
    (next: Record<string, string>) => {
      const q = new URLSearchParams(window.location.search);
      for (const [name, value] of Object.entries(next)) {
        if (value) q.set(name, value);
        else q.delete(name);
      }
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  useEffect(() => {
    const id = setTimeout(() => {
      const value = text.trim();
      setSearch(value);
      if (value !== (new URLSearchParams(window.location.search).get('search') ?? ''))
        writeParams({ search: value });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, writeParams]);

  const categoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('filters.categoryAll') },
      // A legacy free-text value in the URL stays selectable so the closed field shows what is applied.
      ...(category && !(CATEGORY_KEYS as readonly string[]).includes(category)
        ? [{ value: category, label: categoryLabel(category) ?? category }]
        : []),
      ...CATEGORY_KEYS.map((key) => ({ value: key, label: categoryLabel(key) ?? key })),
    ],
    [category, categoryLabel, t],
  );
  const areaOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('filters.areaAll') },
      ...AREA_KEYS.map((key) => ({ value: key, label: areaLabel(key) ?? key })),
    ],
    [areaLabel, t],
  );
  const filtered = Boolean(category || area);

  // The result is tagged with the query that produced it; a different current key means "loading".
  const key = `${attempt}:${search}:${category}:${area}`;
  const state: State = fetched.key === key ? fetched : { ...initial, key };
  const moreAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getDirectory({ search, category, area, limit: PAGE_SIZE }, controller.signal)
      .then((page) =>
        setState({
          key,
          items: page.businesses,
          cursor: page.nextCursor,
          status: 'ready',
          more: 'idle',
        }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
          return;
        setState({ ...initial, key, status: 'error' });
      });
    return () => {
      controller.abort();
      moreAbort.current?.abort(); // a "Show more" of the old query must never land in the new one
    };
  }, [key, search, category, area]);

  const loadMore = useCallback(async () => {
    if (!state.cursor) return;
    const cursor = state.cursor;
    const requestKey = key;
    const controller = new AbortController();
    moreAbort.current = controller;
    setState((s) => (s.key === requestKey ? { ...s, more: 'loading' } : s));
    try {
      const page = await getDirectory(
        { search, category, area, cursor, limit: PAGE_SIZE },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setState((s) =>
        s.key !== requestKey
          ? s
          : {
              key: s.key,
              items: [...s.items, ...page.businesses],
              cursor: page.nextCursor,
              status: 'ready',
              more: 'idle',
            },
      );
    } catch {
      if (controller.signal.aborted) return;
      setState((s) => (s.key === requestKey ? { ...s, more: 'error' } : s));
    }
  }, [state.cursor, search, category, area, key]);

  if (state.status === 'error')
    return (
      <PageState
        role="alert"
        tone="warning"
        icon={<CloudOff size={26} />}
        title={t('error.title')}
        body={t('error.body')}
        action={<Button onClick={() => setAttempt((n) => n + 1)}>{t('error.retry')}</Button>}
      />
    );

  return (
    <main id="main-content" className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-[-0.01em] md:text-4xl">
          {t('title')}
        </h1>
        <p className="m-0 max-w-xl text-[15px] text-muted md:text-base">{t('subtitle')}</p>
      </header>

      <div className="grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative col-span-2 md:col-span-1">
          <Input
            type="search"
            label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={80}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="ps-11"
          />
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute start-4 bottom-[15px] text-muted"
          />
        </div>
        <Select
          label={t('filters.category')}
          value={category}
          options={categoryOptions}
          onChange={(value) => writeParams({ category: value })}
        />
        <Select
          label={t('filters.area')}
          value={area}
          options={areaOptions}
          onChange={(value) => writeParams({ area: value })}
        />
      </div>

      <p role="status" className="sr-only">
        {state.status === 'ready' ? t('resultsCount', { count: state.items.length }) : ''}
      </p>
      <div aria-busy={state.status === 'loading'} className="flex flex-col gap-5">
        {state.status === 'loading' ? (
          <>
            <span className="sr-only">{t('loading')}</span>
            <ListSkeleton />
          </>
        ) : state.items.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 py-10 text-center">
            <span
              aria-hidden="true"
              className="flex size-14 items-center justify-center rounded-[18px] bg-brand-soft text-brand"
            >
              <SearchX size={26} />
            </span>
            <h2 className="m-0 text-xl font-semibold">
              {filtered
                ? t('empty.filterTitle')
                : search
                  ? t('empty.searchTitle')
                  : t('empty.title')}
            </h2>
            <p className="m-0 max-w-sm text-[15px] text-muted">
              {filtered
                ? t('empty.filterBody')
                : search
                  ? t('empty.searchBody', { search })
                  : t('empty.body')}
            </p>
            {filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setText('');
                  setSearch('');
                  writeParams({ search: '', category: '', area: '' });
                }}
              >
                {t('empty.clearFilters')}
              </Button>
            ) : search ? (
              <Button variant="secondary" onClick={() => setText('')}>
                {t('empty.clear')}
              </Button>
            ) : (
              <OwnerLink variant="empty" />
            )}
          </Card>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-3.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {state.items.map((b) => (
                <BusinessCard key={b.slug} business={b} />
              ))}
            </ul>
            {state.cursor ? (
              <div className="flex flex-col items-center gap-2">
                {state.more === 'error' ? (
                  <p role="alert" className="m-0 text-sm text-danger">
                    {t('moreError')}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  loading={state.more === 'loading'}
                  disabled={state.more === 'loading'}
                  onClick={loadMore}
                >
                  {t('loadMore')}
                </Button>
              </div>
            ) : null}
            <OwnerLink variant="list" />
          </>
        )}
      </div>
    </main>
  );
}
