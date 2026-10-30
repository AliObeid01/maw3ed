import { expect, test } from '@playwright/test';

// The global branded 404 (src/app/not-found.tsx): heading, link home, inside a landmark, in both languages.

test('unknown route shows the branded English 404 with a heading and a way home', async ({ page }) => {
  const response = await page.goto('/nope-this-does-not-exist');
  expect(response?.status()).toBe(404);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: "We can't find that page" })).toBeVisible();
  const home = main.getByRole('link', { name: 'Go to Maw3ed' });
  await expect(home).toHaveAttribute('href', '/');
  const box = await home.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // The header "Help" link pointed nowhere and was removed.
  await expect(page.getByRole('link', { name: 'Help' })).toHaveCount(0);
});

test('unknown route in Arabic is translated and right-to-left', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  await page.goto('/nope-this-does-not-exist');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'لا يمكننا العثور على هذه الصفحة' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'الانتقال إلى موعد' })).toHaveAttribute('href', '/');
});
