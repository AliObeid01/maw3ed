import { ORIGIN } from './helpers/clock';
import { biz, chooseArea, chooseCategory, mockExplore, search, withFilters } from './helpers/explore';
import { expectNoPageOverflow } from './helpers/layout';
import { pickerText } from './helpers/pickers';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// PR-1 behaviours of the directory, kept on the Explore page. Self-contained: the public API is answered by page.route.
// The Explore features (cards, free times, when, sheet, 429, pagination) live in explore.spec.ts.

const sidonBarber = biz({
  slug: 'sidon-barber',
  name: 'Sidon Barber',
  category: 'barbers',
  area: 'sidon',
  address: 'Riad El Solh St',
  fromPrice: 10,
});
const beirutSalon = biz({
  slug: 'beirut-salon',
  name: 'Beirut Salon',
  category: 'hair-salons',
  area: 'beirut',
  address: null,
  fromPrice: 20,
});
const noAreaClinic = biz({
  slug: 'no-area-clinic',
  name: 'No Area Clinic',
  category: 'dental-clinics',
  area: null,
  address: null,
  fromPrice: 30,
});
const all = [sidonBarber, beirutSalon, noAreaClinic];

const heading = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('heading', { level: 2, name });

test.describe('public directory: category and area filters (PR-1)', () => {
  test('an over-long or NUL-like ?category= / ?search= is cleaned before the request: no error page', async ({ page }) => {
    const queries: string[] = [];
    await mockExplore(page, { all });
    // Like the real API: category over 40 characters, search over 80 or a NUL answer 400.
    await page.route('**/api/public/directory**', (route) => {
      const url = new URL(route.request().url());
      queries.push(url.search);
      const bad =
        (url.searchParams.get('category') ?? '').length > 40 ||
        (url.searchParams.get('search') ?? '').length > 80 ||
        url.search.includes('%00');
      if (!bad)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ businesses: all, nextCursor: null }),
        });
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'x', fields: { category: 'too long' } } }),
      });
    });
    for (const query of [
      `category=${'x'.repeat(60)}`,
      'category=%00%00',
      'category=barb%00ers',
      `search=${'s'.repeat(200)}`,
      'search=%00',
    ]) {
      await page.goto(`/directory?${query}`);
      await expect(heading(page, 'Sidon Barber')).toBeVisible();
    }
    expect(queries.some((q) => q.includes('%00'))).toBe(false);
    expect(queries.every((q) => !/category=x{41}/.test(q))).toBe(true);
  });

  test('cards show Category · Area and the street address with translated labels', async ({ page }) => {
    await mockExplore(page, { all });
    await page.goto('/directory');
    const card = page.getByRole('listitem').filter({ hasText: 'Sidon Barber' });
    await expect(card).toContainText('Barbers · Sidon');
    await expect(card).toContainText('Riad El Solh St');
    await expect(page.getByRole('listitem').filter({ hasText: 'Beirut Salon' })).toContainText('Hair salons · Beirut');
    // No area: only the category.
    const clinic = page.getByRole('listitem').filter({ hasText: 'No Area Clinic' });
    await expect(clinic).toContainText('Dental clinics');
    await expect(clinic).not.toContainText('·');
  });

  test('filters by area, category and text, keeps them in the URL and survives a reload', async ({ page }) => {
    const seen = await mockExplore(page, { all });
    await page.goto('/directory');
    await expect(heading(page, 'Sidon Barber')).toBeVisible();

    await chooseArea(page, 'Sidon');
    await expect(page).toHaveURL(/[?&]area=sidon/);
    await expect(heading(page, 'Beirut Salon')).toHaveCount(0);
    await expect(heading(page, 'No Area Clinic')).toHaveCount(0);
    await expect(heading(page, 'Sidon Barber')).toBeVisible();

    await chooseCategory(page, 'Barbers');
    await expect(page).toHaveURL(/area=sidon&category=barbers/);
    await expect.poll(() => seen.requests.at(-1)).toContain('area=sidon&category=barbers');

    await search(page, 'sidon');
    await expect(page).toHaveURL(/search=sidon&area=sidon&category=barbers/);

    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Service or business' })).toHaveValue('sidon');
    await withFilters(page, async () => {
      expect(await pickerText(page, 'Category')).toBe('Barbers');
      expect(await pickerText(page, 'Area')).toBe('Sidon');
    });
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
  });

  test('opens from a shared link with the filters applied', async ({ page }) => {
    const seen = await mockExplore(page, { all });
    await page.goto('/directory?category=hair-salons&area=beirut');
    await expect(heading(page, 'Beirut Salon')).toBeVisible();
    await expect(heading(page, 'Sidon Barber')).toHaveCount(0);
    await withFilters(page, async () => {
      expect(await pickerText(page, 'Category')).toBe('Hair salons');
      expect(await pickerText(page, 'Area')).toBe('Beirut');
    });
    expect(seen.requests[0]).toContain('area=beirut');
  });

  test('"All areas" brings back businesses that have no area', async ({ page }) => {
    await mockExplore(page, { all });
    await page.goto('/directory?area=sidon');
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
    await expect(heading(page, 'No Area Clinic')).toHaveCount(0);
    await chooseArea(page, 'All areas');
    await expect(heading(page, 'No Area Clinic')).toBeVisible();
    await expect(page).not.toHaveURL(/area=/);
  });

  test('an ignored unknown area in the URL means all areas', async ({ page }) => {
    await mockExplore(page, { all });
    await page.goto('/directory?area=atlantis');
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
    await withFilters(page, async () => {
      expect(await pickerText(page, 'Area')).toBe('All areas');
    });
  });

  test('a legacy free-text category in the URL still filters', async ({ page }) => {
    await mockExplore(page, {
      all: [biz({ slug: 'studio-nour', name: 'Studio Nour', category: 'Salon' }), biz({ slug: 'clinic-amal', name: 'Amal Physio', category: 'Physio' })],
    });
    await page.goto('/directory?category=Salon');
    await expect(heading(page, 'Studio Nour')).toBeVisible();
    await expect(heading(page, 'Amal Physio')).toHaveCount(0);
    await withFilters(page, async () => {
      expect(await pickerText(page, 'Category')).toBe('Salon');
    });
  });

  test('no matches: the empty state offers Clear filters, which resets the URL', async ({ page }) => {
    await mockExplore(page, { all });
    await page.goto('/directory?category=barbers&area=beirut');
    await expect(page.getByRole('heading', { name: 'No places match' })).toBeVisible();
    await expect(page.getByText('Try another area, day or service.')).toBeVisible();
    await page.getByTestId('explore-empty').getByRole('button', { name: 'Clear filters' }).click();
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
    await expect(page).not.toHaveURL(/category=|area=/);
  });

  test('Arabic: right to left, translated filters and labels, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockExplore(page, { all });
    await page.goto('/directory');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const card = page.getByRole('listitem').filter({ hasText: 'Sidon Barber' });
    await expect(card).toContainText('الحلاقون · صيدا');
    const phoneButton = page.getByRole('button', { name: /^الفلاتر/ });
    if (await phoneButton.isVisible()) await phoneButton.click();
    expect(await pickerText(page, 'الفئة')).toBe('كل الفئات');
    expect(await pickerText(page, 'المنطقة')).toBe('كل المناطق');
    await expectNoPageOverflow(page);
  });
});

test.describe('public business page: header', () => {
  test('shows Category · Area under the name', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(`/b/${SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Studio Nour' })).toBeVisible();
    await expect(page.getByText(/^Salon\s*·\s*,?\s*Sidon/)).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

test.describe('public directory', () => {
  test('lists cards with a View & book link, filters by name and shows the empty search state', async ({ page }) => {
    await mockExplore(page, { all });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { level: 1, name: 'Explore businesses' })).toBeVisible();
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Sidon Barber' })).toContainText(/from \u2066?10 USD/);
    await expect(page.getByRole('link', { name: 'View & book at Sidon Barber' })).toHaveAttribute('href', '/b/sidon-barber');

    await search(page, 'beirut');
    await expect(heading(page, 'Sidon Barber')).toHaveCount(0);
    await expect(heading(page, 'Beirut Salon')).toBeVisible();

    await search(page, 'zzz');
    await expect(page.getByRole('heading', { name: 'No places match' })).toBeVisible();
    await page.getByTestId('explore-empty').getByRole('button', { name: 'Clear filters' }).click();
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
  });

  test('empty directory', async ({ page }) => {
    await mockExplore(page, { all: [] });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'No businesses listed yet' })).toBeVisible();
    const own = page.getByRole('link', { name: 'Own a business? List yours' });
    await expect(own).toHaveAttribute('href', '/for-business#plans');
    await expect(page.getByText('switch your listing on from Share')).toBeVisible();
    expect((await own.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('a non-empty list ends with a lighter "List yours" link', async ({ page }) => {
    await mockExplore(page, { all });
    await page.goto('/directory');
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
    const cta = page.getByTestId('directory-owner-cta');
    await expect(cta).toContainText('Own a business?');
    await expect(cta.getByRole('link', { name: 'List yours' })).toHaveAttribute('href', '/for-business#plans');
    expect((await cta.getByRole('link').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('Arabic: the owner link is translated, RTL, with no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockExplore(page, { all: [] });
    await page.goto('/directory');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: 'تملك نشاطًا تجاريًا؟ أضف نشاطك' })).toHaveAttribute('href', '/for-business#plans');
    await expectNoPageOverflow(page);
  });

  test('shows an error state and recovers on retry', async ({ page }) => {
    const seen = await mockExplore(page, { all, mode: { status: 500 } });
    await page.goto('/directory');
    await expect(page.getByTestId('explore-error')).toContainText('We could not load places');
    seen.setMode({});
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(heading(page, 'Sidon Barber')).toBeVisible();
  });
});
