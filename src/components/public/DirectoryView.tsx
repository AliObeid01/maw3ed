'use client';

import { CloudOff, Search, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ltr } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { getDirectory, type DirectoryBusiness } from '@/lib/api/directory';
import { useAppFormat } from '@/lib/useAppFormat';
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
          {business.category ? (
            <span className="truncate text-sm text-muted">{business.category}</span>
          ) : null}
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
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [fetched, setState] = useState<State>(initial);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setSearch(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  // The result is tagged with the query that produced it; a different current key means "loading".
  const key = `${attempt}:${search}`;
  const state: State = fetched.key === key ? fetched : { ...initial, key };
  const moreAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getDirectory({ search, limit: PAGE_SIZE }, controller.signal)
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
  }, [key, search]);

  const loadMore = useCallback(async () => {
    if (!state.cursor) return;
    const cursor = state.cursor;
    const requestKey = key;
    const controller = new AbortController();
    moreAbort.current = controller;
    setState((s) => (s.key === requestKey ? { ...s, more: 'loading' } : s));
    try {
      const page = await getDirectory({ search, cursor, limit: PAGE_SIZE }, controller.signal);
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
  }, [state.cursor, search, key]);

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
    <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-[28px] leading-tight font-semibold tracking-[-0.01em] md:text-4xl">
          {t('title')}
        </h1>
        <p className="m-0 max-w-xl text-[15px] text-muted md:text-base">{t('subtitle')}</p>
      </header>

      <div className="relative max-w-xl">
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
              {search ? t('empty.searchTitle') : t('empty.title')}
            </h2>
            <p className="m-0 max-w-sm text-[15px] text-muted">
              {search ? t('empty.searchBody', { search }) : t('empty.body')}
            </p>
            {search ? (
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
