import type { Page } from '@playwright/test';
import { clockNow, freezeClock, ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { selectOption } from './helpers/pickers';
import { expect, test } from './helpers/test';

// The marketplace home. Self-contained: both public data requests are answered by page.route, on the frozen clock.

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

const CATS = [
  ['barbers', 3, 6],
  ['hair-salons', 3, 15],
  ['dental-clinics', 3, 30],
  ['beauty-clinics', 3, 18],
  ['spa-massage', 3, 35],
  ['physiotherapy', 0, null],
] as const;

const categoriesBody = () => ({
  categories: [
    ...CATS.map(([category, places, fromPrice]) => ({
      category,
      places,
      fromPrice,
      nextFree:
        places === 0
          ? null
          : {
              startAt: beirut(0, 10, 30),
              service: { id: 'x', name: 'Cut', durationMin: 30 },
              business: { slug: 'abu-karam', name: 'Abu Karam Barbershop', timezone: 'Asia/Beirut' },
            },
      popularServices:
        places === 0
          ? []
          : [
              { name: category === 'dental-clinics' ? 'Check-up' : 'Haircut', fromPrice: 8 },
              { name: 'Beard trim', fromPrice: 12.5 },
            ],
    })),
    { category: 'other', places: 4, fromPrice: 1, nextFree: null, popularServices: [] },
  ],
});

type Mock = { categories: string[]; directory: string[] };

async function mockHome(page: Page, opts: { fail?: boolean; directory?: unknown[] } = {}): Promise<Mock> {
  const seen: Mock = { categories: [], directory: [] };
  await freezeClock(page);
  await page.route('**/api/public/categories**', (route) => {
    seen.categories.push(new URL(route.request().url()).search);
    if (opts.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
      body: JSON.stringify(categoriesBody()),
    });
  });
  await page.route('**/api/public/directory**', (route) => {
    const url = new URL(route.request().url());
    seen.directory.push(url.search);
    if (opts.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    // The directory page itself (no `include`) gets a plain list; the home asks with include=nextFree.
    const businesses = url.searchParams.get('include') ? (opts.directory ?? [barber(), fade]) : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ businesses, nextCursor: null }),
    });
  });
  return seen;
}

const categoryButton = (page: Page, name: RegExp | string) =>
  page.getByRole('navigation', { name: 'Category list' }).getByRole('button', { name });
const panel = (page: Page) => page.getByTestId('category-panel');

test('the page is complete: one h1, landmarks, skip link, no overflow', async ({ page }) => {
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
  await expectNoPageOverflow(page);
  await expect(page).toHaveTitle(/Maw3ed/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Book barbers/);
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
});

test('the language toggle switches to Arabic and flips the direction', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: 'عربي' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('احجز موعدك القادم خلال');
});

test('search: text and area build the directory URL; Popular chips link to a search', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  await page.getByLabel('Service or business').fill('haircut');
  await selectOption(page, 'Area', 'Sidon');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/directory?search=haircut&area=sidon`);

  await page.goto('/');
  for (const chip of ['Haircut', 'Dental check-up', 'Massage', 'Hydrafacial']) {
    await expect(page.getByRole('link', { name: chip, exact: true })).toHaveAttribute(
      'href',
      `/directory?search=${encodeURIComponent(chip).replace(/%20/g, '+')}`,
    );
  }
  // An empty search goes to the plain directory.
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/directory`);
});

test('the area picker lists All areas and the six areas', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Area' }).click();
  const options = page.getByRole('option');
  await expect(options).toHaveText(['All areas', 'Sidon', 'Beirut', 'Tripoli', 'Jounieh', 'Tyre', 'Zahle']);
});

test('Next free panel (wide screens): live cards in the business zone, then filtered by area', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is shown from lg');
  const seen = await mockHome(page, {
    directory: [barber(), barber({ slug: 'ny', name: 'NY Cuts', timezone: 'America/New_York', area: null, address: null, freeTimes: [beirut(0, 10, 30, 'America/New_York')], nextFree: { startAt: beirut(0, 10, 30, 'America/New_York'), service: { id: 's', name: 'Cut', durationMin: 20 } } })],
  });
  await page.goto('/');
  const region = page.getByTestId('next-free-panel');
  await expect(region.getByRole('heading', { name: 'Next free', exact: true })).toBeVisible();
  const card = region.getByRole('article').filter({ hasText: 'Abu Karam Barbershop' });
  await expect(card).toContainText('Sidon · Riad El Solh St');
  await expect(card).toContainText('Haircut · 30 min');
  await expect(card).toContainText('Today');
  await expect(card.getByRole('link', { name: /^\d\d:\d\d, / })).toHaveText(['10:30', '11:30', '14:00', '16:30']);
  await expect(card.getByRole('link', { name: 'View the page of Abu Karam Barbershop' })).toHaveAttribute('href', '/b/abu-karam');
  // 10:30 in New York is 10:30 on that business's clock, whatever the viewer's zone is.
  const ny = region.getByRole('article').filter({ hasText: 'NY Cuts' });
  await expect(ny.getByRole('link', { name: /^\d\d:\d\d, / })).toHaveText(['10:30']);
  // Identical for every visitor: no per-user params, a stable order.
  expect(seen.directory).toContain('?include=nextFree&limit=3');

  await selectOption(page, 'Area', 'Sidon');
  await expect(region.getByRole('heading', { name: 'Next free in Sidon' })).toBeVisible();
  expect(seen.directory).toContain('?area=sidon&include=nextFree&limit=3');
});

test('Next free panel is hidden, with no spinner left, when the API returns nothing or errors', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is shown from lg');
  await mockHome(page, { directory: [] });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('next-free-panel')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
});

test('categories: list with stats, switching panels, popular services, top places with free times', async ({ page }) => {
  const seen = await mockHome(page, { directory: [barber(), fade] });
  await page.goto('/');
  // Six categories, never "other".
  const list = page.getByRole('navigation', { name: 'Category list' });
  await expect(list.getByRole('button')).toHaveCount(6);
  await expect(list).not.toContainText('Other');
  await expect(categoryButton(page, /Barbers/)).toContainText(/3 places · from .*6 USD/);
  await expect(categoryButton(page, /Barbers/)).toHaveAttribute('aria-pressed', 'true');

  await expect(panel(page).getByRole('heading', { level: 3, name: 'Barbers' })).toBeVisible();
  await expect(panel(page)).toContainText('Places');
  await expect(panel(page)).toContainText('Prices from');
  await expect(panel(page)).toContainText('Next free');
  await expect(panel(page)).toContainText('Today 10:30');
  await expect(panel(page).getByRole('link', { name: /Beard trim/ })).toHaveAttribute('href', '/directory?category=barbers&service=Beard+trim');
  await expect(panel(page).getByRole('link', { name: /Beard trim/ })).toContainText(/from .*12.50 USD/);
  const top = panel(page).getByRole('article');
  await expect(top).toHaveCount(2);
  await expect(top.first().getByRole('link', { name: /^\d\d:\d\d, / })).toHaveText(['10:30', '11:30', '14:00', '16:30']);
  await expect(top.nth(1)).toContainText('Tomorrow');
  await expect(panel(page).getByRole('link', { name: 'See all barbers' })).toHaveAttribute('href', '/directory?category=barbers');
  await expect(panel(page)).toContainText('Free times can be taken before you book.');
  await expect(page.getByText(/no availability|fully booked/i)).toHaveCount(0);

  await categoryButton(page, /Dental clinics/).click();
  await expect(categoryButton(page, /Dental clinics/)).toHaveAttribute('aria-pressed', 'true');
  await expect(categoryButton(page, /Barbers/)).toHaveAttribute('aria-pressed', 'false');
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Dental clinics' })).toBeVisible();
  await expect(panel(page).getByRole('link', { name: /Check-up/ })).toHaveAttribute('href', '/directory?category=dental-clinics&service=Check-up');
  await expect(panel(page).getByRole('link', { name: 'See all dental clinics' })).toHaveAttribute('href', '/directory?category=dental-clinics');

  // One categories request; one directory request per category opened, cached when you go back. No per-user params.
  await categoryButton(page, /Barbers/).click();
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Barbers' })).toBeVisible();
  expect(seen.categories).toEqual(['']);
  const perCategory = seen.directory.filter((q) => q.includes('category='));
  expect(perCategory.sort()).toEqual(['?category=barbers&include=nextFree&limit=3', '?category=dental-clinics&include=nextFree&limit=3']);
});

test('a category with no places says so honestly and invites the owner to sign up', async ({ page }) => {
  const seen = await mockHome(page);
  await page.goto('/');
  await categoryButton(page, /Physiotherapy/).click();
  await expect(categoryButton(page, /Physiotherapy/)).toContainText('0 places');
  const empty = panel(page).getByTestId('category-empty');
  await expect(empty).toContainText('No places here yet');
  await expect(empty.getByRole('link', { name: 'Be the first' })).toHaveAttribute('href', '/signup');
  await expect(panel(page).getByRole('article')).toHaveCount(0);
  expect(seen.directory.some((q) => q.includes('physiotherapy'))).toBe(false); // nothing to ask for
});

test('when the API fails the page stays complete and the categories offer a retry', async ({ page }) => {
  await mockHome(page, { fail: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Category list' }).getByRole('button')).toHaveCount(6);
  await expect(page.getByRole('alert').first()).toContainText('Could not load the categories');
  await expect(page.getByRole('link', { name: 'See all barbers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How Maw3ed works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Simple pricing' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test('How it works: true steps, the reminder email preview, and a keyboard FAQ', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  const how = page.locator('#how');
  await expect(how.getByRole('heading', { level: 3 })).toContainText([
    /Choose a service and a person/,
    /Pick a free time/,
    /Get your reminder/,
  ]);
  const preview = how.getByTestId('email-preview');
  await expect(preview).toHaveAttribute('aria-hidden', 'true');
  await expect(preview).toContainText('Maw3ed · Reminder');
  // Same wording as the real reminder (email.h24 and email.actions).
  await expect(preview).toContainText('Your appointment is tomorrow');
  await expect(preview).toContainText('This is a reminder of your appointment at');
  await expect(preview).toContainText('Confirm my appointment');
  await expect(preview).toContainText('Cancel my appointment');
  await expect(preview).toContainText('Illustration');
  await expect(preview.locator('a, button')).toHaveCount(0);
  // Claims that were removed because the product does not do them.
  await expect(page.locator('main')).not.toContainText(/My bookings|your reference|next 30 days|Help centre/i);

  const first = how.getByText('Do I need an account?');
  const details = how.locator('details').first();
  await first.focus();
  await expect(details).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details).toContainText('name, phone and email');
  await page.keyboard.press('Space');
  await expect(details).not.toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(how.locator('details').nth(1)).toContainText('The booking email has a Cancel link (and a Confirm link when the visit is within 24 hours); every reminder has both.');
  await expect(how.locator('details')).toHaveCount(4);
});

test('For business owners: band, links, phone mockup and the five setup steps', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  const band = page.getByRole('region', { name: 'Every no-show is a paid hour lost.' });
  await expect(band.getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', '/signup');
  await expect(band.getByRole('link', { name: 'Business sign in' })).toHaveAttribute('href', '/login');
  await expect(band.getByTestId('owner-phone')).toHaveAttribute('aria-hidden', 'true');
  const steps = page.getByRole('region', { name: 'Set up in five steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(2)).toContainText('Each person can get a login and sees only their own appointments');
});

test('pricing teaser shows the real Free and Pro plans, the same as /pricing', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  const teaser = page.getByRole('region', { name: 'Simple pricing' });
  await expect(teaser).toContainText('Free');
  await expect(teaser).toContainText('Pro');
  await expect(teaser).not.toContainText(/Solo|Clinic|\[XX\]|\[N\]/);
  await expect(teaser.getByRole('link', { name: 'See all plans' })).toHaveAttribute('href', '/pricing');
  const free = await teaser.locator('#teaser-free').locator('xpath=ancestor::article').innerText();
  const pro = await teaser.locator('#teaser-pro').locator('xpath=ancestor::article').innerText();
  await page.goto('/pricing');
  const freePlan = await page.locator('section[aria-labelledby="plan-free"]').innerText();
  const proPlan = await page.locator('section[aria-labelledby="plan-pro"]').innerText();
  for (const line of ['$0', '/ month', 'Your own booking page', 'Email reminders 24 h and 2 h before']) {
    expect(free).toContain(line);
    expect(freePlan).toContain(line);
  }
  for (const line of ['$9', 'Everything in Free', 'More than one bookable staff member', 'TEST MODE']) {
    expect(pro).toContain(line);
    expect(proPlan).toContain(line);
  }
});

test('footer: real links, contact placeholders from one config, no dead social links', async ({ page }) => {
  await mockHome(page);
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Hair salons' })).toHaveAttribute('href', '/directory?category=hair-salons');
  await expect(footer.getByRole('link', { name: 'Zahle' })).toHaveAttribute('href', '/directory?area=zahle');
  await expect(footer.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
  await expect(footer.getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', '/signup');
  await expect(footer.getByRole('link', { name: 'Business sign in' })).toHaveAttribute('href', '/login');
  await expect(footer.getByRole('link', { name: 'Reminders and confirmations' })).toHaveAttribute('href', '/#how');
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
  await expect(footer.getByRole('button', { name: 'عربي' })).toBeVisible();
});

test('navigation: header on wide screens, bottom tab bar on phones, aria-current, no My bookings', async ({ page }, info) => {
  await mockHome(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'My bookings' })).toHaveCount(0);
  const owners = page.getByRole('banner').getByRole('link', { name: /For (business )?owners/ });
  await expect(owners.first()).toHaveAttribute('href', '/signup');
  if (info.project.name === 'desktop') {
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/#how');
    await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    await expect(page.getByRole('banner').getByRole('button', { name: 'عربي' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  } else {
    const tabs = page.getByRole('navigation', { name: 'Main' });
    await expect(tabs.getByRole('link')).toHaveText(['Explore', 'How it works', 'For business owners']);
    await expect(tabs.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('link', { name: 'How it works' })).not.toHaveAttribute('aria-current', 'page');
    const box = await tabs.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 2); // sticks to the bottom
    for (const link of await tabs.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await tabs.getByRole('link', { name: 'How it works' }).click();
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
  await expect(list.getByRole('button')).toHaveCount(6);
  await expect(panel(page).getByRole('link', { name: /^\d\d:\d\d، / }).first()).toBeVisible();
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
  }
  await expect(page.locator('details').first()).toContainText('هل أحتاج');
  await expect(page.getByRole('contentinfo')).toContainText('سياسة الخصوصية');
});

test.describe('overflow at the three widths', () => {
  for (const [w, h] of [[360, 740], [768, 1024], [1440, 900]] as const) {
    test(`no horizontal overflow at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await mockHome(page);
      await page.goto('/');
      await expect(panel(page)).toBeVisible();
      await expectNoPageOverflow(page);
    });
  }
});

test('wide screens: the hero does not jump when the Next free panel arrives', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is shown from lg');
  await mockHome(page);
  // Answer the panel slowly so the loading state can be measured, then the real cards.
  await page.route('**/api/public/directory**', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.fallback();
  });
  await page.goto('/');
  const hero = page.locator('main > section').first();
  await expect(page.getByTestId('next-free-panel')).toHaveAttribute('aria-busy', 'true');
  const loading = (await hero.boundingBox())!.height;
  await expect(page.getByTestId('next-free-panel')).toHaveAttribute('aria-busy', 'false');
  const loaded = (await hero.boundingBox())!.height;
  expect(Math.abs(loaded - loading)).toBeLessThanOrEqual(2);
  // Nothing to show: the reserved space is given back, no empty box is left behind.
  await page.unroute('**/api/public/directory**');
  await page.route('**/api/public/directory**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ businesses: [], nextCursor: null }) }),
  );
  await page.goto('/');
  await expect(page.getByTestId('next-free-panel')).toHaveCount(0);
  await expect.poll(async () => (await hero.boundingBox())!.height).toBeLessThan(loaded - 100);
});
