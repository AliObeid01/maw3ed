import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { biz, fade, mockExplore } from './helpers/explore';
import { expectNoPageOverflow } from './helpers/layout';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// PR-10b: the business avatar on Explore cards and on the public business page. Self-contained: the directory, the
// booking catalogue and the logo image itself are answered by page.route. The image is a generated 256 px WebP.

const LOGO = (slug: string) => `/api/public/${slug}/logo?v=0123456789abcdef`;
const webp = () =>
  sharp({ create: { width: 256, height: 256, channels: 3, background: '#12a37f' } }).webp().toBuffer();

/** Serves the generated image for `ok` slugs and a 404 for the rest, and counts the image requests. */
async function serveLogos(page: Page, ok: string[]) {
  const image = await webp();
  const hits: string[] = [];
  await page.route('**/api/public/*/logo*', (route) => {
    const url = new URL(route.request().url());
    hits.push(`${url.pathname}${url.search}`);
    const slug = url.pathname.split('/')[3]!;
    return ok.includes(slug)
      ? route.fulfill({ status: 200, contentType: 'image/webp', body: image })
      : route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x', fields: {} } }),
        });
  });
  return hits;
}

const card = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });

test.describe('Explore cards', () => {
  const withLogo = biz({ logoUrl: LOGO('abu-karam') });
  const broken = biz({ slug: 'broken-img', name: 'Broken Image Barbers', logoUrl: LOGO('broken-img') });
  const none = { ...fade, logoUrl: null };

  test('a logo replaces the initials; a business without one (or whose image 404s) keeps them', async ({
    page,
  }) => {
    await mockExplore(page, { all: [withLogo, broken, none] });
    await serveLogos(page, ['abu-karam']);
    await page.goto('/directory');

    const abu = card(page, 'Abu Karam Barbershop');
    const img = abu.locator('img');
    await expect(img).toHaveAttribute('src', LOGO('abu-karam'));
    await expect(img).toHaveAttribute('alt', '');
    await expect(img).toHaveAttribute('width', '64');
    await expect(img).toHaveAttribute('height', '64');
    await expect(img).toHaveAttribute('decoding', 'async');
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(256);
    expect((await abu.locator('img').boundingBox())!.width).toBe(58); // 64 px box minus the card avatar's 3 px border on each side

    // 404: the img is gone and the initials tile stands in the same 64 px box.
    const bad = card(page, 'Broken Image Barbers');
    await expect(bad.locator('img')).toHaveCount(0);
    await expect(bad.getByText('BI', { exact: true })).toBeVisible();
    expect((await bad.getByText('BI', { exact: true }).boundingBox())!.width).toBe(64);
    // null: initials from the start.
    await expect(card(page, 'Fade Lab').locator('img')).toHaveCount(0);
    await expect(card(page, 'Fade Lab').getByText('FL', { exact: true })).toBeVisible();
  });

  for (const [label, width, height] of [
    ['360', 360, 800],
    ['1440', 1440, 900],
  ] as const)
    test(`no overflow at ${label} px with logos`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockExplore(page, { all: [withLogo, none] });
      await serveLogos(page, ['abu-karam']);
      await page.goto('/directory');
      await expect(card(page, 'Abu Karam Barbershop').locator('img')).toBeVisible();
      await expectNoPageOverflow(page);
    });

  test('Arabic: rtl, the logo and the initials stay on the start side', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: 'http://localhost:3000' }]);
    await mockExplore(page, { all: [withLogo, none] });
    await serveLogos(page, ['abu-karam']);
    await page.goto('/directory');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const img = card(page, 'Abu Karam Barbershop').locator('img');
    await expect(img).toBeVisible();
    const [imgBox, headingBox] = await Promise.all([
      img.boundingBox(),
      card(page, 'Abu Karam Barbershop').getByRole('heading').boundingBox(),
    ]);
    expect(imgBox!.x).toBeGreaterThan(headingBox!.x); // mirrored: the avatar is at the right-hand start
    await expectNoPageOverflow(page);
  });
});

test.describe('public business page', () => {
  test('the hero shows the logo when there is one, with the business name as the heading', async ({
    page,
  }) => {
    await mockPublicApi(page, { logoUrl: LOGO(SLUG) });
    await serveLogos(page, [SLUG]);
    await page.goto(`/b/${SLUG}`);
    const hero = page.getByRole('region', { name: 'Studio Nour' });
    await expect(hero.getByRole('heading', { level: 1, name: 'Studio Nour' })).toBeVisible();
    const img = hero.locator('img');
    await expect(img).toHaveAttribute('src', LOGO(SLUG));
    await expect(img).toHaveAttribute('alt', '');
    await expect(img).toHaveAttribute('loading', 'eager'); // above the fold
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(256);
    await expectNoPageOverflow(page);
  });

  test('a missing image falls back to the cyan monogram, and no logo means the monogram', async ({
    page,
  }) => {
    await mockPublicApi(page, { logoUrl: LOGO(SLUG) });
    await serveLogos(page, []); // 404
    await page.goto(`/b/${SLUG}`);
    const hero = page.getByRole('region', { name: 'Studio Nour' });
    await expect(hero.locator('img')).toHaveCount(0);
    await expect(hero.getByText('SN', { exact: true })).toBeVisible();

    const second = await page.context().newPage();
    await mockPublicApi(second, { logoUrl: null });
    await second.goto(`/b/${SLUG}`);
    await expect(second.getByRole('region', { name: 'Studio Nour' }).getByText('SN', { exact: true })).toBeVisible();
    await expect(second.getByRole('region', { name: 'Studio Nour' }).locator('img')).toHaveCount(0);
  });

  test('360 and 1440 px: the hero with a logo does not overflow', async ({ page }) => {
    await mockPublicApi(page, { logoUrl: LOGO(SLUG) });
    await serveLogos(page, [SLUG]);
    for (const [width, height] of [
      [360, 800],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/b/${SLUG}`);
      await expect(page.getByRole('region', { name: 'Studio Nour' }).locator('img')).toBeVisible();
      await expectNoPageOverflow(page);
    }
  });
});
