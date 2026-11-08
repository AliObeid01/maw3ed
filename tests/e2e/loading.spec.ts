import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { clockNow, freezeClock } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

type Messages = {
  public: { loadingPage: string; header: { tabsLabel: string; howItWorks: string; forBusinessesShort: string } };
};
const messages = (locale: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Messages;

// PR-12 (replaces tests/unit/public/loading.test.ts, which only checked that files exist). A client navigation is
// held on the network in two stages, so the real loading states can be inspected: first nothing has arrived (the
// clicked link is `aria-busy`, the top progress bar is up), then the route skeleton arrives (role=status with the
// loading text, header and tab bar still in place, the bar still up), then the page is ready and all of it is gone.
// English and Arabic, 360 px, no horizontal overflow at any stage.

const beirut = (days: number, hh: number, mm: number) =>
  clockNow().setZone('Asia/Beirut').plus({ days }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 }).toUTC().toISO()!;

async function mockHome(page: Page) {
  await freezeClock(page);
  await page.route('**/api/public/categories**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categories: [
          { category: 'barbers', places: 3, fromPrice: 8, nextFree: null, popularServices: [{ name: 'Haircut', fromPrice: 8 }] },
        ],
      }),
    }),
  );
  await page.route('**/api/public/directory**', (route) => {
    const soonest = new URL(route.request().url()).searchParams.get('sort') === 'soonest';
    const businesses = [
      {
        slug: 'place-1',
        name: 'Place 1',
        category: 'barbers',
        area: 'sidon',
        address: 'Riad El Solh St',
        serviceCount: 1,
        fromPrice: 8,
        timezone: 'Asia/Beirut',
        nextFree: { startAt: beirut(0, 11, 30), service: { id: 's', name: 'Haircut', durationMin: 30 } },
        freeTimes: [beirut(0, 11, 30)],
        services: [{ name: 'Haircut', durationMin: 30, price: 8 }],
      },
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(soonest ? { businesses } : { businesses, nextCursor: null }),
    });
  });
}

/**
 * Hold the page requests of one route behind gates. `holdPrefetch` also holds the prefetch (nothing of the route is
 * known yet: the link is busy and the bar is up); without it the prefetch goes through and brings the route's loading
 * skeleton, so the click shows the skeleton while only the page itself is held. Install BEFORE the first page load.
 */
async function holdRoute(page: Page, pathname: string, holdPrefetch: boolean) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let navigations = 0;
  await page.route(
    (url) => url.pathname === pathname && url.searchParams.has('_rsc'),
    async (route) => {
      const prefetch = Boolean(route.request().headers()['next-router-prefetch']);
      if (prefetch && !holdPrefetch) return route.continue();
      if (!prefetch) navigations += 1;
      await gate;
      return route.continue();
    },
  );
  return { release, navigations: () => navigations };
}

const CASES = [
  { name: 'How it works (tab bar)', path: '/how-it-works' },
  { name: 'For business owners (header button)', path: '/for-business' },
] as const;

for (const locale of ['en', 'ar'] as const) {
  const text = messages(locale);
  test.describe(`navigation loading state (${locale}, 360 px)`, () => {
    test.use({ reducedMotion: 'no-preference' });
    for (const c of CASES) {
      for (const prefetched of [false, true]) {
        test(`${c.name}, ${prefetched ? 'route skeleton known (prefetched)' : 'nothing known yet'}: loading feedback, then all gone when ready`, async ({
          page,
          context,
          baseURL,
        }) => {
          if (locale === 'ar') await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
          await page.setViewportSize({ width: 360, height: 740 });
          await mockHome(page);
          const hold = await holdRoute(page, c.path, !prefetched);
          const prefetchDone = prefetched
            ? page.waitForResponse((r) => new URL(r.url()).pathname === c.path && r.url().includes('_rsc'))
            : undefined;
          await page.goto('/');
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await expect(page.getByTestId('nav-progress')).toHaveCount(0);
          await prefetchDone;

          const tabLabel = text.public.header.tabsLabel;
          const tabs = page.getByRole('navigation', { name: tabLabel });
          const link =
            c.path === '/how-it-works'
              ? tabs.getByRole('link', { name: text.public.header.howItWorks })
              : page.getByTestId('public-header').getByRole('link', { name: text.public.header.forBusinessesShort });
          await link.click();
          await expect.poll(() => hold.navigations()).toBeGreaterThan(0);

          const loadingStatus = page.getByRole('main').getByRole('status').filter({ hasText: text.public.loadingPage });
          if (prefetched) {
            // The route skeleton is in the frame: it reads 'loading' to assistive technology, the header and the tab
            // bar stay in place, the progress bar stays up, and the real page is not in yet.
            await expect(loadingStatus).toHaveText(text.public.loadingPage);
            await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
          } else {
            // Nothing of the new page is known: the clicked link itself is busy.
            await expect(link).toHaveAttribute('aria-busy', 'true');
            await expect(loadingStatus).toHaveCount(0);
          }
          await expect(page.getByTestId('public-header')).toBeVisible();
          await expect(tabs).toBeVisible();
          await expect(page.getByTestId('nav-progress')).toBeVisible(); // appears after its short delay
          await expectNoPageOverflow(page);

          // Ready: skeleton, bar and busy mark are all gone.
          hold.release();
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await expect(page.getByTestId('nav-progress')).toHaveCount(0);
          await expect(link).not.toHaveAttribute('aria-busy', 'true');
          await expect(loadingStatus).toHaveCount(0);
          await expect(page).toHaveURL(new RegExp(`${c.path}$`));
          await expectNoPageOverflow(page);
        });
      }
    }
  });
}
