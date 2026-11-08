import type { Page } from '@playwright/test';
import { clockNow, freezeClock, ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { selectOption } from './helpers/pickers';
import { expect, test } from './helpers/test';

// The marketplace home (PR-11: short, like the owner's design). Self-contained: the public data requests are
// answered by page.route, on the frozen clock. The long sections moved to /how-it-works and /for-business
// (tests/e2e/marketplacePages.spec.ts).

/** Beirut local time `days` from the virtual now at hh:mm, as a UTC instant. */
const beirut = (days: number, hh: number, mm: number, zone = 'Asia/Beirut') =>
  clockNow().setZone(zone).plus({ days }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 }).toUTC().toISO()!;

const barber = (over: Record<string, unknown> = {}) => ({
  slug: 'abu-karam',
  name: 'Abu Karam Barbershop',
  category: 'barbers',
  area: 'sidon',
  address: 'Riad El Solh St',
  serviceCount: 3,
  fromPrice: 8,
  timezone: 'Asia/Beirut',
  nextFree: { startAt: beirut(0, 10, 30), service: { id: 's1', name: 'Haircut', durationMin: 30 } },
  freeTimes: [beirut(0, 10, 30), beirut(0, 11, 30), beirut(0, 14, 0), beirut(0, 16, 30)],
  services: [
    { name: 'Haircut', durationMin: 30, price: 8 },
    { name: 'Beard trim', durationMin: 20, price: 12.5 },
    { name: 'Shave', durationMin: 20, price: 6 },
    { name: 'Hidden fourth', durationMin: 20, price: 30 },
  ],
  ...over,
});
const fade = barber({
  slug: 'fade-lab',
  name: 'Fade Lab',
  area: 'beirut',
  address: 'Mar Mikhael',
  nextFree: { startAt: beirut(1, 12, 15), service: { id: 's2', name: 'Fade', durationMin: 45 } },
  freeTimes: [beirut(1, 12, 15), beirut(1, 13, 0)],
});
const salon = barber({
  slug: 'salon-layal',
  name: 'Salon Layal',
  category: 'hair-salons',
  address: 'Nejmeh Sq',
  nextFree: { startAt: beirut(0, 11, 0), service: { id: 's3', name: 'Blow-dry', durationMin: 40 } },
  freeTimes: [beirut(0, 11, 0)],
});
const dental = barber({
  slug: 'dr-nour',
  name: 'Dr. Nour Dental Clinic',
  category: 'dental-clinics',
  address: 'Downtown Sidon',
  nextFree: { startAt: beirut(5, 9, 30), service: { id: 's4', name: 'Check-up', durationMin: 30 } },
  freeTimes: [beirut(5, 9, 30)],
});
const beauty = barber({
  slug: 'glow',
  name: 'Glow Beauty Clinic',
  category: 'beauty-clinics',
  address: 'Seaside Road',
  nextFree: { startAt: beirut(1, 10, 0), service: { id: 's5', name: 'Facial', durationMin: 50 } },
  freeTimes: [beirut(1, 10, 0)],
});

type Places = Partial<Record<string, number>>;
const DEFAULT_PLACES: Places = {
  barbers: 3,
  'hair-salons': 3,
  'dental-clinics': 3,
  'beauty-clinics': 3,
  'spa-massage': 3,
  physiotherapy: 0,
};
const FROM: Record<string, number> = {
  barbers: 6,
  'hair-salons': 15,
  'dental-clinics': 30,
  'beauty-clinics': 18,
  'spa-massage': 35,
  physiotherapy: 30,
};
const KEYS = ['barbers', 'hair-salons', 'dental-clinics', 'beauty-clinics', 'spa-massage', 'physiotherapy'];

const categoriesBody = (places: Places, popular?: Record<string, string[]>) => ({
  categories: [
    ...KEYS.map((category) => {
      const n = places[category] ?? 0;
      return {
        category,
        places: n,
        fromPrice: n === 0 ? null : FROM[category],
        nextFree:
          n === 0
            ? null
            : {
                startAt: beirut(0, 10, 30),
                service: { id: 'x', name: 'Cut', durationMin: 30 },
                business: { slug: 'abu-karam', name: 'Abu Karam Barbershop', timezone: 'Asia/Beirut' },
              },
        popularServices:
          n === 0
            ? []
            : (popular?.[category] ?? [category === 'dental-clinics' ? 'Check-up' : 'Haircut', 'Beard trim']).map(
                (name, i) => ({ name, fromPrice: i === 0 ? 8 : 12.5 }),
              ),
      };
    }),
    { category: 'other', places: 4, fromPrice: 1, nextFree: null, popularServices: [] },
  ],
});

type Mock = { categories: string[]; directory: string[] };
type Opts = {
  fail?: boolean;
  /** Answers to the category "Top places" requests (include=nextFree,services). */
  directory?: unknown[];
  /** Answers to the hero panel request (sort=soonest). Defaults to four businesses across categories. */
  panel?: unknown[];
  /** Answer the panel request with this status instead. */
  panelStatus?: number;
  places?: Places;
  popular?: Record<string, string[]>;
  /** Hold the categories answer back for this long. */
  categoriesDelayMs?: number;
};

async function mockHome(page: Page, opts: Opts = {}): Promise<Mock> {
  const seen: Mock = { categories: [], directory: [] };
  await freezeClock(page);
  await page.route('**/api/public/categories**', async (route) => {
    seen.categories.push(new URL(route.request().url()).search);
    if (opts.categoriesDelayMs) await new Promise((r) => setTimeout(r, opts.categoriesDelayMs));
    if (opts.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
      body: JSON.stringify(categoriesBody(opts.places ?? DEFAULT_PLACES, opts.popular)),
    });
  });
  await page.route('**/api/public/directory**', (route) => {
    const url = new URL(route.request().url());
    seen.directory.push(url.search);
    if (opts.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    const soonest = url.searchParams.get('sort') === 'soonest';
    if (soonest && opts.panelStatus) {
      return route.fulfill({ status: opts.panelStatus, contentType: 'application/json', body: '{"error":{"code":"RATE_LIMITED","message":"x"}}' });
    }
    // The directory page itself (no `include`) gets a plain list; the home asks with include.
    let businesses: unknown[] = [];
    if (soonest) businesses = opts.panel ?? opts.directory ?? [barber(), salon, dental, beauty];
    else if (url.searchParams.get('include')) businesses = opts.directory ?? [barber(), fade];
    // Like the real server: `sort=soonest` has no paging, so its answer carries NO `nextCursor` key at all.
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(soonest ? { businesses } : { businesses, nextCursor: null }),
    });
  });
  return seen;
}

const categoryList = (page: Page) => page.getByRole('navigation', { name: 'Category list' });
const categoryButton = (page: Page, name: RegExp | string) => categoryList(page).getByRole('button', { name });
const panel = (page: Page) => page.getByTestId('category-panel');
const hero = (page: Page) => page.locator('main > section').first();

test('the page is complete and SHORT: one h1, landmarks, skip link, the design sections only, no overflow', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Book your next appointment in minutes');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  await expect(skip).toBeVisible();
  await expect(page.locator('#main-content')).toHaveCount(1);
  // Hero, Browse by category, the navy closing band: nothing else (how it works, owners, pricing moved to their pages).
  await expect(page.locator('main > section')).toHaveCount(3);
  await expect(page.getByRole('heading', { level: 2, name: 'Browse by category' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Run a salon, barbershop or clinic?' })).toBeVisible();
  for (const gone of ['How Maw3ed works', 'Common questions', 'Set up in five steps', 'Simple pricing', 'Every no-show is a paid hour lost.']) {
    await expect(page.getByRole('heading', { name: gone })).toHaveCount(0);
  }
  await expect(page.locator('#how')).toHaveCount(0);
  await expectNoPageOverflow(page);
  await expect(page).toHaveTitle(/Maw3ed/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Book barbers/);
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
});

test('the navy closing band: pitch, Put your business on Maw3ed and Business sign in', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  const band = page.getByRole('region', { name: 'Run a salon, barbershop or clinic?' });
  await expect(band).toContainText('Put your business on Maw3ed and let the reminders do the chasing.');
  await expect(band.getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', '/signup');
  await expect(band.getByRole('link', { name: 'Business sign in' })).toHaveAttribute('href', '/login');
  for (const link of await band.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
});

test('PR-10b: a place card shows its logo, falls back to initials when the image fails, and keeps its box', async ({
  page,
}) => {
  const logo = (slug: string) => `/api/public/${slug}/logo?v=0123456789abcdef`;
  // 1x1 transparent GIF bytes are enough: the browser decodes them as a valid image of any declared size.
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await page.route('**/api/public/*/logo*', (route) =>
    route.request().url().includes('/abu-karam/')
      ? route.fulfill({ status: 200, contentType: 'image/gif', body: pixel })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await mockHome(page, {
    directory: [barber({ logoUrl: logo('abu-karam') }), { ...fade, logoUrl: logo('fade-lab') }],
  });
  await page.goto('/');
  const abu = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Abu Karam Barbershop' }) });
  await expect(abu.locator('img')).toHaveAttribute('src', logo('abu-karam'));
  await expect(abu.locator('img')).toHaveAttribute('width', '46');
  const lab = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Fade Lab' }) });
  await expect(lab.locator('img')).toHaveCount(0);
  await expect(lab.getByText('FL', { exact: true })).toBeVisible();
  expect((await lab.getByText('FL', { exact: true }).boundingBox())!.width).toBe(46);
  await expectNoPageOverflow(page);
});

test('the language toggle switches to Arabic and flips the direction', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: 'عربي' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('احجز موعدك القادم خلال');
});

test('search: text and area build the directory URL; with little data the Popular chips are the static four', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  await page.getByLabel('Service or business').fill('haircut');
  await selectOption(page, 'Area', 'Sidon');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/directory?search=haircut&area=sidon`);

  await page.goto('/');
  const chips = page.getByTestId('hero-chips');
  // The default data has only three distinct popular services, so the row falls back to the static list.
  await expect(chips.getByRole('link')).toHaveText(['Haircut', 'Dental check-up', 'Massage', 'Hydrafacial']);
  for (const chip of ['Haircut', 'Dental check-up', 'Massage', 'Hydrafacial']) {
    await expect(chips.getByRole('link', { name: chip, exact: true })).toHaveAttribute(
      'href',
      `/directory?search=${encodeURIComponent(chip).replace(/%20/g, '+')}`,
    );
  }
  // An empty search goes to the plain directory.
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/directory`);
});

test('Popular chips come from the live categories: top service of each non-empty category, de-duplicated, max 4, no layout shift', async ({ page }) => {
  await mockHome(page, {
    categoriesDelayMs: 600,
    popular: {
      barbers: ['Skin fade', 'Shave'],
      'hair-salons': ['skin fade', 'Balayage'],
      'dental-clinics': ['Scale and polish'],
      'beauty-clinics': ['Hydrafacial'],
      'spa-massage': ['Hot stone'],
    },
  });
  await page.goto('/');
  const chips = page.getByTestId('hero-chips');
  // Before the data arrives: the static row. After: live names. The row keeps its box.
  await expect(chips.getByRole('link')).toHaveText(['Haircut', 'Dental check-up', 'Massage', 'Hydrafacial']);
  const before = await chips.boundingBox();
  await expect(chips.getByRole('link')).toHaveText(['Skin fade', 'Balayage', 'Scale and polish', 'Hydrafacial']);
  const after = await chips.boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(after!.y).toBe(before!.y);
  await expect(chips.getByRole('link', { name: 'Skin fade' })).toHaveAttribute('href', '/directory?search=Skin+fade');
  await expectNoPageOverflow(page);
});

test('the area picker lists All areas and the six areas', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Area' }).click();
  const options = page.getByRole('option');
  await expect(options).toHaveText(['All areas', 'Sidon', 'Beirut', 'Tripoli', 'Jounieh', 'Tyre', 'Zahle']);
});

test('Next free panel (wide screens): one blue card, one white card, one row per business, time in the business zone', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is shown from lg');
  const seen = await mockHome(page, {
    panel: [
      barber(),
      salon,
      dental,
      barber({ slug: 'ny', name: 'NY Cuts', category: null, timezone: 'America/New_York', area: 'tyre', address: null, freeTimes: [beirut(0, 10, 30, 'America/New_York')], nextFree: { startAt: beirut(0, 10, 30, 'America/New_York'), service: { id: 's', name: 'Cut', durationMin: 20 } } }),
    ],
  });
  await page.goto('/');
  const region = page.getByTestId('next-free-panel');
  await expect(region.getByRole('heading', { name: 'Next free', exact: true })).toBeVisible();
  await expect(region).toContainText('Tap a time to open the business page.');
  const rows = region.getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(region.getByRole('article')).toHaveCount(0); // rows, not cards
  const abu = rows.filter({ hasText: 'Abu Karam Barbershop' });
  await expect(abu).toContainText('Barbers · Riad El Solh St');
  await expect(abu.getByTestId('panel-time')).toHaveText('Today10:30');
  await expect(abu.getByRole('link')).toHaveAttribute('href', '/b/abu-karam');
  await expect(rows.filter({ hasText: 'Dr. Nour Dental Clinic' }).getByTestId('panel-time')).toHaveText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)09:30$/);
  // 10:30 in New York is 10:30 on that business's clock, whatever the viewer's zone is; no category -> street/area only.
  await expect(rows.filter({ hasText: 'NY Cuts' }).getByTestId('panel-time')).toHaveText('Today10:30');
  // The request: identical for every visitor, fixed order, no cursor.
  expect(seen.directory).toContain('?include=nextFree&sort=soonest&spread=category&limit=4');
  // A phone-sized row is a 44 px target at least.
  for (const row of await rows.getByRole('link').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoPageOverflow(page);
});

test('Next free panel: the Area select changes the panel (debounced, one request per area, cached)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is shown from lg');
  const seen = await mockHome(page);
  await page.goto('/');
  const region = page.getByTestId('next-free-panel');
  await expect(region.getByRole('heading', { name: 'Next free', exact: true })).toBeVisible();
  await expect(region.getByRole('listitem')).toHaveCount(4);

  await selectOption(page, 'Area', 'Sidon');
  await expect(region.getByRole('heading', { name: 'Next free in Sidon' })).toBeVisible();
  await expect(region.getByRole('listitem')).toHaveCount(4);
  expect(seen.directory).toContain('?area=sidon&include=nextFree&sort=soonest&spread=category&limit=4');

  // Back to all areas: served from the 60 s cache, no second request for the same URL.
  await selectOption(page, 'Area', 'All areas');
  await expect(region.getByRole('heading', { name: 'Next free', exact: true })).toBeVisible();
  const panelCalls = seen.directory.filter((q) => q.includes('sort=soonest'));
  expect(panelCalls).toEqual([
    '?include=nextFree&sort=soonest&spread=category&limit=4',
    '?area=sidon&include=nextFree&sort=soonest&spread=category&limit=4',
  ]);
});

test('Next free panel: phones do not fetch it', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'phones only');
  const seen = await mockHome(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('next-free-panel')).toHaveCount(0);
  expect(seen.directory.filter((q) => q.includes('sort=soonest'))).toEqual([]);
});

test('Next free panel is hidden, with no spinner left, when the API returns nothing, errors or rate-limits', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is shown from lg');
  for (const opts of [{ panel: [] }, { panelStatus: 429 }, { panelStatus: 500 }] as Opts[]) {
    await mockHome(page, opts);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('next-free-panel')).toHaveCount(0);
    await expect(page.getByTestId('next-free-panel').getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('categories: list with stats, switching panels, popular services, top places with services and free times', async ({ page }) => {
  const seen = await mockHome(page, { directory: [barber(), fade] });
  await page.goto('/');
  // Five categories have places (physiotherapy has none and is hidden), never "other".
  await expect(categoryList(page).getByRole('button')).toHaveCount(5);
  await expect(categoryList(page)).not.toContainText('Other');
  await expect(categoryButton(page, /Barbers/)).toContainText(/3 places · from .*6 USD/);
  await expect(categoryButton(page, /Barbers/)).toHaveAttribute('aria-pressed', 'true');

  await expect(panel(page).getByRole('heading', { level: 3, name: 'Barbers' })).toBeVisible();
  await expect(panel(page)).toContainText('Places');
  await expect(panel(page)).toContainText('Prices from');
  await expect(panel(page)).toContainText('Next free');
  await expect(panel(page)).toContainText('Today 10:30');
  await expect(panel(page).getByRole('heading', { level: 4, name: 'Popular services' })).toBeVisible(); // 3 places
  await expect(panel(page).getByRole('link', { name: /Beard trim/ }).first()).toHaveAttribute('href', '/directory?category=barbers&service=Beard+trim');
  await expect(panel(page).getByRole('link', { name: /Beard trim/ }).first()).toContainText(/from .*12.50 USD/);
  const top = panel(page).getByRole('article');
  await expect(top).toHaveCount(2);
  // Up to three service chips with a "from" price; the fourth is not shown.
  const chips = top.first().getByTestId('card-services').getByRole('listitem');
  await expect(chips).toHaveCount(3);
  await expect(chips.first()).toContainText('Haircut');
  await expect(chips.first()).toContainText(/from .*8 USD/);
  await expect(top.first()).not.toContainText('Hidden fourth');
  // Free times are labelled with the service they belong to.
  const label = (card: ReturnType<typeof top.first>) => card.getByTestId('free-label');
  await expect(label(top.first()).getByTestId('free-label-service')).toHaveText(/^Free times for ⁨?Haircut⁩?$/);
  await expect(label(top.first()).getByTestId('free-label-day')).toHaveText('Today');
  await expect(label(top.first())).not.toContainText('·'); // no separator dot that could wrap to the start of a line
  await expect(top.first().getByRole('link', { name: /^\d\d:\d\d, / })).toHaveText(['10:30', '11:30', '14:00', '16:30']);
  await expect(label(top.nth(1)).getByTestId('free-label-service')).toHaveText(/^Free times for ⁨?Fade⁩?$/);
  await expect(label(top.nth(1)).getByTestId('free-label-day')).toHaveText('Tomorrow');
  await expect(top.first().getByRole('link', { name: 'View the page of Abu Karam Barbershop' })).toHaveAttribute('href', '/b/abu-karam');
  await expect(panel(page).getByRole('link', { name: 'See all barbers' })).toHaveAttribute('href', '/directory?category=barbers');
  await expect(panel(page)).toContainText('Free times can be taken before you book.');
  await expect(page.getByText(/no availability|fully booked/i)).toHaveCount(0);

  await categoryButton(page, /Dental clinics/).click();
  await expect(categoryButton(page, /Dental clinics/)).toHaveAttribute('aria-pressed', 'true');
  await expect(categoryButton(page, /Barbers/)).toHaveAttribute('aria-pressed', 'false');
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Dental clinics' })).toBeVisible();
  await expect(panel(page).getByRole('link', { name: /Check-up/ })).toHaveAttribute('href', '/directory?category=dental-clinics&service=Check-up');
  await expect(panel(page).getByRole('link', { name: 'See all dental clinics' })).toHaveAttribute('href', '/directory?category=dental-clinics');

  // One categories request (shared with the hero chips); one directory request per category opened, cached when you
  // go back. No per-user params; the comma of include is encoded the same for everyone.
  await categoryButton(page, /Barbers/).click();
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Barbers' })).toBeVisible();
  expect(seen.categories).toEqual(['']);
  const perCategory = seen.directory.filter((q) => q.includes('category='));
  expect(perCategory.sort()).toEqual([
    '?category=barbers&include=nextFree%2Cservices&limit=3',
    '?category=dental-clinics&include=nextFree%2Cservices&limit=3',
  ]);
});

test('empty categories are hidden, with one quiet line to list a business; no "0 places" anywhere', async ({ page }) => {
  const seen = await mockHome(page);
  await page.goto('/');
  await expect(categoryButton(page, /Barbers/)).toBeVisible();
  await expect(categoryList(page).getByRole('button', { name: /Physiotherapy/ })).toHaveCount(0);
  const soon = page.getByTestId('categories-soon');
  await expect(soon).toContainText('More categories are coming soon.');
  await expect(soon.getByRole('link', { name: 'Own a salon or clinic? List your business.' })).toHaveAttribute('href', '/signup');
  await expect(page.locator('main')).not.toContainText(/\b0 places|0 أماكن/);
  expect(seen.directory.some((q) => q.includes('physiotherapy'))).toBe(false);
  // The Explore filter keeps all six (tests/e2e/explore.spec.ts); the home footer lists them too.
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Physiotherapy' })).toBeVisible();
});

test('the default category is the first one WITH places, and the quiet line is absent when all six are listed', async ({ page }) => {
  await mockHome(page, { places: { 'dental-clinics': 2, physiotherapy: 1 } });
  await page.goto('/');
  await expect(categoryList(page).getByRole('button')).toHaveCount(2);
  await expect(categoryButton(page, /Dental clinics/)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Dental clinics' })).toBeVisible();
  // 2 places: the heading is plain "Services", not "Popular services".
  await expect(panel(page).getByRole('heading', { level: 4, name: 'Services', exact: true })).toBeVisible();
  await expect(panel(page).getByRole('heading', { level: 4, name: 'Popular services' })).toHaveCount(0);
  await categoryButton(page, /Physiotherapy/).click();
  await expect(panel(page).getByRole('heading', { level: 4, name: 'Services', exact: true })).toBeVisible(); // 1 place
});

test('all six listed: no "coming soon" line', async ({ page }) => {
  await mockHome(page, { places: { barbers: 3, 'hair-salons': 1, 'dental-clinics': 3, 'beauty-clinics': 3, 'spa-massage': 3, physiotherapy: 3 } });
  await page.goto('/');
  await expect(categoryList(page).getByRole('button')).toHaveCount(6);
  await expect(page.getByTestId('categories-soon')).toHaveCount(0);
  await categoryButton(page, /Hair salons/).click();
  await expect(panel(page).getByRole('heading', { level: 4, name: 'Services', exact: true })).toBeVisible(); // 1 place
});

test('no category has a place: a friendly "Be the first" block instead of the two-pane, never flashed while loading', async ({ page }) => {
  await mockHome(page, { places: {}, categoriesDelayMs: 700 });
  await page.goto('/');
  // While loading: a stable skeleton of the same size, no invitation, no list.
  await expect(page.getByTestId('category-skeleton')).toBeVisible();
  await expect(page.getByTestId('category-first')).toHaveCount(0);
  await expect(categoryList(page)).toHaveCount(0);
  await expect(page.getByTestId('category-first')).toBeVisible();
  const first = page.getByTestId('category-first');
  await expect(first).toContainText('Be the first on Maw3ed');
  await expect(first.getByRole('link', { name: 'Be the first' })).toHaveAttribute('href', '/signup');
  await expect(categoryList(page)).toHaveCount(0);
  await expect(page.getByTestId('categories-soon')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/\b0 places/);
  await expectNoPageOverflow(page);
});

test('the category block keeps its height while loading (nothing below it jumps for the skeleton)', async ({ page }) => {
  await mockHome(page, { categoriesDelayMs: 800 });
  await page.goto('/');
  const box = page.getByTestId('category-skeleton').locator('xpath=..');
  await expect(box).toBeVisible();
  const loading = (await box.boundingBox())!.height;
  await expect(categoryList(page)).toBeVisible();
  const loaded = (await categoryList(page).locator('xpath=ancestor::div[contains(@class,"min-h-")][1]').boundingBox())!.height;
  expect(loaded).toBeGreaterThanOrEqual(loading - 2);
});

test('when the API fails the page stays complete, the six static categories are listed and offer a retry', async ({ page }) => {
  await mockHome(page, { fail: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(categoryList(page).getByRole('button')).toHaveCount(6);
  await expect(page.getByRole('alert').first()).toContainText('Could not load the categories');
  await expect(page.getByRole('link', { name: 'See all barbers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run a salon, barbershop or clinic?' })).toBeVisible();
  await expect(page.getByTestId('hero-chips').getByRole('link')).toHaveText(['Haircut', 'Dental check-up', 'Massage', 'Hydrafacial']);
  await expect(page.getByTestId('categories-soon')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test('footer: real links, one config for contact placeholders, no dead social links, no #how anchors', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Hair salons' })).toHaveAttribute('href', '/directory?category=hair-salons');
  await expect(footer.getByRole('link', { name: 'Zahle' })).toHaveAttribute('href', '/directory?area=zahle');
  await expect(footer.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  await expect(footer.getByRole('link', { name: 'Overview for businesses' })).toHaveAttribute('href', '/for-business');
  await expect(footer.getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', '/signup');
  await expect(footer.getByRole('link', { name: 'Business sign in' })).toHaveAttribute('href', '/login');
  await expect(footer.getByRole('link', { name: 'Reminders and confirmations' })).toHaveAttribute('href', '/how-it-works#reminders');
  await expect(footer.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works');
  await expect(footer.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', 'mailto:hello@[YOUR-DOMAIN]');
  await expect(footer.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy');
  await expect(footer.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms');
  expect((await footer.getByRole('link', { name: /hello@/ }).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await expect(footer.getByRole('link', { name: 'Back to top' })).toHaveAttribute('href', '#top');
  await expect(footer).toContainText('hello@[YOUR-DOMAIN]');
  await expect(footer).toContainText('+961 [XX XXX XXX]');
  await expect(footer).toContainText('[YOUR ADDRESS], Lebanon');
  await expect(footer).toContainText('© 2026 Maw3ed. All rights reserved.');
  await expect(footer).not.toContainText(/My bookings|Help centre|Beirut time \(Asia/);
  await expect(footer.getByRole('link', { name: /Instagram|Facebook|WhatsApp/ })).toHaveCount(0);
  await expect(footer.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('a[href*="#how"]')).toHaveCount(0);
  await expect(footer.getByRole('button', { name: 'عربي' })).toBeVisible();
});

test('navigation: Explore, How it works, For business owners button, Sign in, language; phones get 2 tabs', async ({ page }, info) => {
  await mockHome(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'My bookings' })).toHaveCount(0);
  const owners = page.getByRole('banner').getByRole('link', { name: /For (business )?owners/ });
  await expect(owners.first()).toHaveAttribute('href', '/for-business');
  if (info.project.name === 'desktop') {
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link')).toHaveText(['Explore', 'How it works']);
    await expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/');
    await expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works');
    await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    await expect(page.getByRole('banner').getByRole('button', { name: 'عربي' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  } else {
    const tabs = page.getByRole('navigation', { name: 'Main' });
    await expect(tabs.getByRole('link')).toHaveText(['Explore', 'How it works']);
    await expect(tabs.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('link', { name: 'How it works' })).not.toHaveAttribute('aria-current', 'page');
    const box = await tabs.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 2); // sticks to the bottom
    for (const link of await tabs.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await tabs.getByRole('link', { name: 'How it works' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/how-it-works`);
    await expect(tabs.getByRole('link', { name: 'How it works' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('banner').getByRole('link', { name: 'For owners' })).toBeVisible();
  }
});

test('tap targets are at least 44 px high', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  const targets = [
    page.getByRole('button', { name: 'Search' }),
    page.getByRole('link', { name: 'Haircut', exact: true }),
    page.getByRole('combobox', { name: 'Area' }),
    categoryButton(page, /Barbers/),
    page.getByRole('link', { name: 'See all barbers' }),
    page.getByTestId('categories-soon').getByRole('link'),
    page.getByRole('contentinfo').getByRole('link', { name: 'Privacy policy' }),
    page.getByRole('contentinfo').getByRole('link', { name: 'Zahle' }),
  ];
  for (const t of targets) {
    await t.scrollIntoViewIfNeeded();
    expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  }
});

test('reduced motion: the panel does not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockHome(page);
  await page.goto('/');
  await expect(panel(page)).toBeVisible();
  const ms = await panel(page).evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) * 1000);
  expect(ms).toBeLessThan(1);
});

test('Arabic: right to left, mirrored layout, Latin digits, no overflow', async ({ page, context }, info) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  await mockHome(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('احجز موعدك القادم خلال');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('دقائق');
  await expect(page.getByRole('button', { name: 'بحث' })).toBeVisible();
  const list = page.getByRole('navigation', { name: 'قائمة الفئات' });
  await expect(list.getByRole('button')).toHaveCount(5);
  await expect(panel(page).getByRole('link', { name: /^\d\d:\d\d، / }).first()).toBeVisible();
  await expect(page.getByTestId('categories-soon')).toContainText('فئات أخرى قادمة قريبًا.');
  await expect(page.getByRole('heading', { level: 2, name: 'هل تدير صالونًا أو محل حلاقة أو عيادة؟' })).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/); // Latin digits only
  await expectNoPageOverflow(page);
  if (info.project.name === 'desktop') {
    // The category list sits on the right, the panel on the left.
    const l = await list.boundingBox();
    const p = await panel(page).boundingBox();
    expect(l!.x).toBeGreaterThan(p!.x);
    // And the next-free panel mirrors the hero text to the other side.
    const h1 = await page.getByRole('heading', { level: 1 }).boundingBox();
    const nf = await page.getByTestId('next-free-panel').boundingBox();
    expect(nf!.x).toBeLessThan(h1!.x);
    await expect(page.getByTestId('next-free-panel').getByTestId('panel-time').first()).toContainText(/^(اليوم|غدًا|[^\d]+)\d\d:\d\d$/);
  }
  await expect(page.getByRole('contentinfo')).toContainText('سياسة الخصوصية');
});

test.describe('overflow at the four widths', () => {
  for (const [w, h] of [[320, 700], [360, 740], [768, 1024], [1440, 900]] as const) {
    test(`no horizontal overflow at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await mockHome(page);
      await page.goto('/');
      await expect(panel(page)).toBeVisible();
      await expectNoPageOverflow(page);
    });
  }
});

test('wide screens: the hero does not jump when the Next free panel arrives, and gives its column back when there is nothing', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is shown from lg');
  await mockHome(page);
  // Answer the panel slowly so the loading state can be measured, then the real rows.
  await page.route('**/api/public/directory**', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByTestId('next-free-panel')).toHaveAttribute('aria-busy', 'true');
  const loading = (await hero(page).boundingBox())!.height;
  await expect(page.getByTestId('next-free-panel')).toHaveAttribute('aria-busy', 'false');
  const loaded = (await hero(page).boundingBox())!.height;
  expect(Math.abs(loaded - loading)).toBeLessThanOrEqual(2);
  // Nothing to show: no empty box is left behind.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockHome(page, { panel: [] });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('next-free-panel')).toHaveCount(0);
  const column = hero(page).locator('xpath=./div/div[2]');
  await expect.poll(async () => (await column.boundingBox())!.height).toBeLessThan(5);
});

test('Arabic at 320: the free-times label wraps as two whole pieces (service, day), never a dot at the start of a line', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  await page.setViewportSize({ width: 320, height: 700 });
  await mockHome(page, { directory: [barber({ name: 'Abu Karam Barbershop', nextFree: { startAt: beirut(0, 10, 30), service: { id: 's1', name: 'Hydrafacial deep cleansing', durationMin: 50 } } })] });
  await page.goto('/');
  const label = page.getByTestId('free-label').first();
  await expect(label).toBeVisible();
  await expect(label.getByTestId('free-label-service')).toContainText('أوقات متاحة لخدمة');
  await expect(label.getByTestId('free-label-day')).toHaveText('اليوم');
  await expect(label).not.toContainText('·');
  await expectNoPageOverflow(page);
});
