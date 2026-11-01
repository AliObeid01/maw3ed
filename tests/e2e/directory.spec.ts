import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';

// Self-contained: /api/public/directory is answered by page.route.

const studio = {
  slug: 'studio-nour',
  name: 'Studio Nour',
  category: 'Salon',
  address: 'Hamra, Beirut',
  serviceCount: 4,
  fromPrice: 15,
};
const clinic = {
  slug: 'clinic-amal',
  name: 'Amal Physio',
  category: 'Physio',
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

test.describe('home page', () => {
  test('shows the value line, three steps and the three ways in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fewer no-shows. More time.');
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'Clients book online',
      'Reminders go out',
      'No-shows drop',
    ]);
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Find a business' })).toHaveAttribute(
      'href',
      '/directory',
    );
    await expect(main.getByRole('link', { name: 'Set up your business' })).toHaveAttribute(
      'href',
      '/signup',
    );
    await expect(main.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('the language toggle switches to Arabic and flips the direction', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'عربي' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('غياب أقل. ووقت أكثر.');
  });
});
