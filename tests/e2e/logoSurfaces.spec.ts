import { ORIGIN } from './helpers/clock';
import { expect, test } from './helpers/test';

// PR-16b: the new logo on every surface. One named logo per surface, light on white (header, auth), reverse on
// navy (footer), correct aspect ratio, never mirrored under RTL.

const RATIO = 469.53 / 141.04;

for (const lang of ['en', 'ar'] as const) {
  test.describe(`logo surfaces (${lang})`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies([{ name: 'locale', value: lang, url: ORIGIN }]);
    });

    test('public header uses the light logo, the footer the reverse one, each exactly once', async ({ page }) => {
      await page.goto('/privacy');
      const header = page.locator('header').first().locator('svg[role="img"][aria-label*="Maw3ed"]');
      const footer = page.locator('footer svg[role="img"][aria-label*="Maw3ed"]');
      await expect(header).toHaveCount(1);
      await expect(footer).toHaveCount(1);
      await expect(page.locator('svg[role="img"][aria-label*="Maw3ed"]')).toHaveCount(2);
      await expect(header).toHaveAttribute('data-tone', 'brand');
      await expect(footer).toHaveAttribute('data-tone', 'white');
      await expect(footer).toHaveAttribute('data-logo', 'full');
      for (const logo of [header, footer]) {
        await expect(logo).toBeVisible();
        const box = (await logo.boundingBox())!;
        expect(box.width / box.height).toBeCloseTo(RATIO, 0);
        expect(await logo.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
        expect(await logo.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
      }
      // The footer is navy: the wordmark is white there.
      await expect(footer.locator('g[fill="#FFFFFF"]')).toHaveCount(1);
      await expect(header.locator('g[fill="#0B1938"]')).toHaveCount(1);
    });

    test('sign-in page shows one logo, light', async ({ page }) => {
      await page.goto('/login');
      const logo = page.locator('main svg[role="img"][aria-label*="Maw3ed"]');
      await expect(logo).toHaveCount(1);
      await expect(logo).toHaveAttribute('data-tone', 'brand');
    });
  });
}

test('the header logo stays sharp and in proportion at 360 px (104 px wide)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/privacy');
  await expect(page.locator('header svg[role="img"]').first()).toBeVisible();
  const box = (await page.locator('header svg[role="img"]').first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(100);
  expect(box.width / box.height).toBeCloseTo(RATIO, 0);
});
