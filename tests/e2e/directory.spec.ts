import { type Page } from '@playwright/test';
import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { pickerText, selectOption } from './helpers/pickers';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// Self-contained: /api/public/directory is answered by page.route.

const studio = {
  slug: 'studio-nour',
  name: 'Studio Nour',
  category: 'Salon',
  area: 'beirut',
  address: 'Hamra, Beirut',
  serviceCount: 4,
  fromPrice: 15,
};
const clinic = {
  slug: 'clinic-amal',
  name: 'Amal Physio',
  category: 'Physio',
  area: null,
  address: null,
  serviceCount: 2,
  fromPrice: null,
};

async function mockDirectory(page: Page, opts: { fail?: boolean; all?: unknown[] } = {}) {
  const searches: string[] = [];
  await page.route('**/api/public/directory**', async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search') ?? '';
    searches.push(search);
    if (opts.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    const all = (opts.all ?? [studio, clinic]) as { name: string }[];
    const businesses = all.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ businesses, nextCursor: null }),
    });
  });
  return searches;
}

const third = { ...studio, slug: 'third', name: 'Third Place' };

// PR-1 fixtures: fixed category and area keys, like the real API returns for new listings.
const sidonBarber = {
  slug: 'sidon-barber',
  name: 'Sidon Barber',
  category: 'barbers',
  area: 'sidon',
  address: 'Riad El Solh St',
  serviceCount: 2,
  fromPrice: 10,
};
const beirutSalon = {
  slug: 'beirut-salon',
  name: 'Beirut Salon',
  category: 'hair-salons',
  area: 'beirut',
  address: null,
  serviceCount: 3,
  fromPrice: 20,
};
const noAreaClinic = {
  slug: 'no-area-clinic',
  name: 'No Area Clinic',
  category: 'dental-clinics',
  area: null,
  address: null,
  serviceCount: 1,
  fromPrice: 30,
};

/** Answers like the real endpoint: AND of search, category (case-insensitive equality) and area. */
async function mockFilteredDirectory(page: Page, all: Record<string, unknown>[]) {
  const queries: string[] = [];
  await page.route('**/api/public/directory**', (route) => {
    const url = new URL(route.request().url());
    queries.push(url.search);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const category = (url.searchParams.get('category') ?? '').toLowerCase();
    const area = url.searchParams.get('area') ?? '';
    const businesses = all.filter(
      (b) =>
        String(b.name).toLowerCase().includes(search) &&
        (!category || String(b.category).toLowerCase() === category) &&
        (!area || b.area === area),
    );
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ businesses, nextCursor: null }),
    });
  });
  return queries;
}

test.describe('public directory: category and area filters (PR-1)', () => {
  const all = [sidonBarber, beirutSalon, noAreaClinic];

  test('an over-long or NUL-like ?category= / ?search= is cleaned before the request: no error page', async ({
    page,
  }) => {
    const queries: string[] = [];
    // Like the real API: category over 40 characters, search over 80 or a NUL answer 400.
    await page.route('**/api/public/directory**', (route) => {
      const url = new URL(route.request().url());
      queries.push(url.search);
      const bad =
        (url.searchParams.get('category') ?? '').length > 40 ||
        (url.searchParams.get('search') ?? '').length > 80 ||
        url.search.includes('%00');
      return route.fulfill({
        status: bad ? 400 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          bad
            ? { error: { code: 'VALIDATION_FAILED', message: 'x', fields: { category: 'too long' } } }
            : { businesses: all, nextCursor: null },
        ),
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
      await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toBeVisible();
    }
    expect(queries.some((q) => q.includes('%00'))).toBe(false);
    expect(queries.every((q) => !/category=x{41}/.test(q))).toBe(true);
  });

  test('cards show Category · Area and the street address with translated labels', async ({ page }) => {
    await mockFilteredDirectory(page, all);
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

  test('filters by area, category and both, keeps them in the URL and survives a reload', async ({ page }) => {
    const queries = await mockFilteredDirectory(page, all);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toBeVisible();

    await selectOption(page, 'Area', 'Sidon');
    await expect(page).toHaveURL(/[?&]area=sidon/);
    await expect(page.getByRole('heading', { name: 'Beirut Salon' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No Area Clinic' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toBeVisible();

    await selectOption(page, 'Category', 'Barbers');
    await expect(page).toHaveURL(/category=barbers/);
    await expect(page).toHaveURL(/area=sidon/);
    expect(queries.at(-1)).toContain('category=barbers');
    expect(queries.at(-1)).toContain('area=sidon');

    await page.getByLabel('Search by name').fill('sidon');
    await expect(page).toHaveURL(/search=sidon/);
    await expect(page).toHaveURL(/category=barbers/);
    await expect(page).toHaveURL(/area=sidon/);

    await page.reload();
    await expect(page.getByLabel('Search by name')).toHaveValue('sidon');
    expect(await pickerText(page, 'Category')).toBe('Barbers');
    expect(await pickerText(page, 'Area')).toBe('Sidon');
    await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toBeVisible();
  });

  test('opens from a shared link with the filters applied', async ({ page }) => {
    const queries = await mockFilteredDirectory(page, all);
    await page.goto('/directory?category=hair-salons&area=beirut');
    await expect(page.getByRole('heading', { name: 'Beirut Salon' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toHaveCount(0);
    expect(await pickerText(page, 'Category')).toBe('Hair salons');
    expect(await pickerText(page, 'Area')).toBe('Beirut');
    expect(queries[0]).toContain('area=beirut');
  });

  test('"All areas" brings back businesses that have no area', async ({ page }) => {
    await mockFilteredDirectory(page, all);
    await page.goto('/directory?area=sidon');
    await expect(page.getByRole('heading', { name: 'No Area Clinic' })).toHaveCount(0);
    await selectOption(page, 'Area', 'All areas');
    await expect(page.getByRole('heading', { name: 'No Area Clinic' })).toBeVisible();
    await expect(page).not.toHaveURL(/area=/);
  });

  test('an ignored unknown area in the URL means all areas', async ({ page }) => {
    await mockFilteredDirectory(page, all);
    await page.goto('/directory?area=atlantis');
    await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toBeVisible();
    expect(await pickerText(page, 'Area')).toBe('All areas');
  });

  test('a legacy free-text category in the URL still filters', async ({ page }) => {
    await mockFilteredDirectory(page, [studio, clinic, sidonBarber]);
    await page.goto('/directory?category=Salon');
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Amal Physio' })).toHaveCount(0);
    expect(await pickerText(page, 'Category')).toBe('Salon');
  });

  test('no matches: the empty state offers Clear filters, which resets the URL', async ({ page }) => {
    await mockFilteredDirectory(page, all);
    await page.goto('/directory?category=barbers&area=beirut');
    await expect(page.getByRole('heading', { name: 'No matches here' })).toBeVisible();
    await expect(page.getByText('Try another area or category.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toBeVisible();
    await expect(page).not.toHaveURL(/category=|area=/);
  });

  test('tap targets are 44 px and nothing overflows', async ({ page }) => {
    await mockFilteredDirectory(page, all);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Sidon Barber' })).toBeVisible();
    for (const name of ['Category', 'Area']) {
      const box = (await page.getByRole('combobox', { name }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await expectNoPageOverflow(page);
  });

  test('Arabic: right to left, translated filters and labels, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockFilteredDirectory(page, all);
    await page.goto('/directory');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const card = page.getByRole('listitem').filter({ hasText: 'Sidon Barber' });
    await expect(card).toContainText('الحلاقون · صيدا');
    await selectOption(page, 'المنطقة', 'بيروت');
    await expect(page).toHaveURL(/area=beirut/);
    await expect(page.getByRole('heading', { name: 'Beirut Salon' })).toBeVisible();
    expect(await pickerText(page, 'الفئة')).toBe('كل الفئات');
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

test.describe('public directory: show more', () => {
  test('appends the next page when Show more is pressed', async ({ page }) => {
    await page.route('**/api/public/directory**', (route) => {
      const url = new URL(route.request().url());
      const more = url.searchParams.get('cursor') === 'c1';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          businesses: more ? [third] : [studio],
          nextCursor: more ? null : 'c1',
        }),
      });
    });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.getByRole('heading', { name: 'Third Place' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  });

  test('a slow Show more never lands in the results of a newer search', async ({ page }) => {
    let releaseMore: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseMore = resolve;
    });
    await page.route('**/api/public/directory**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('cursor') === 'c1') {
        await gate;
        return route
          .fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ businesses: [third], nextCursor: null }),
          })
          .catch(() => undefined);
      }
      const search = url.searchParams.get('search') ?? '';
      const businesses = search ? [clinic] : [studio];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ businesses, nextCursor: search ? null : 'c1' }),
      });
    });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    await page.getByRole('button', { name: 'Show more' }).click();
    await page.getByLabel('Search by name').fill('amal');
    await expect(page.getByRole('heading', { name: 'Amal Physio' })).toBeVisible();
    releaseMore();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'Third Place' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toHaveCount(0);
  });
});

test.describe('public directory', () => {
  test('lists cards with a Book link, filters by name and shows the empty search state', async ({
    page,
  }) => {
    await mockDirectory(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { level: 1, name: 'Find a business' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    await expect(page.getByText(/From\s*\W*\$15/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book at Studio Nour' })).toHaveAttribute(
      'href',
      '/b/studio-nour',
    );

    await page.getByLabel('Search by name').fill('amal');
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Amal Physio' })).toBeVisible();

    await page.getByLabel('Search by name').fill('zzz');
    await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
  });

  test('empty directory', async ({ page }) => {
    await mockDirectory(page, { all: [] });
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'No businesses listed yet' })).toBeVisible();
    const own = page.getByRole('link', { name: 'Own a business? List yours' });
    await expect(own).toHaveAttribute('href', '/signup');
    await expect(page.getByText('switch your listing on from Share')).toBeVisible();
    expect((await own.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('a non-empty list ends with a lighter "List yours" link', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    const cta = page.getByTestId('directory-owner-cta');
    await expect(cta).toContainText('Own a business?');
    await expect(cta.getByRole('link', { name: 'List yours' })).toHaveAttribute('href', '/signup');
    expect((await cta.getByRole('link').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('Arabic: the owner link is translated, RTL, with no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockDirectory(page, { all: [] });
    await page.goto('/directory');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: 'تملك نشاطًا تجاريًا؟ أضف نشاطك' })).toHaveAttribute('href', '/signup');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('shows an error state and recovers on retry', async ({ page }) => {
    let fail = true;
    await page.route('**/api/public/directory**', (route) =>
      fail
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        : route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ businesses: [studio], nextCursor: null }),
          }),
    );
    await page.goto('/directory');
    await expect(page.getByRole('alert').filter({ hasText: 'Could not load' })).toContainText('Could not load the directory');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
  });

  test('has no horizontal overflow and tap targets of at least 44 px', async ({ page }) => {
    await mockDirectory(page);
    await page.goto('/directory');
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    const box = await page.getByRole('link', { name: 'Book at Studio Nour' }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});
