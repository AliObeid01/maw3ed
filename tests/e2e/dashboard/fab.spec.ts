import { expect, test, type Page } from '@playwright/test';
import { setRole } from '../helpers/mockApi';
import { client, mockOutcomesApi } from '../helpers/outcomesMock';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

const many = () =>
  Array.from({ length: 14 }, (_, i) => client(`cl${i}`, `Client Number${i}`, `+9617100${String(i).padStart(4, '0')}`, { attended: i }));

async function check(page: Page) {
  await page.setViewportSize({ width: 360, height: 700 });
  await mockOutcomesApi(page, { clients: many() });
  await page.goto('/app/clients');
  const fab = page.getByRole('link', { name: /New booking|حجز جديد/ });
  await expect(fab).toBeVisible();
  await expect(fab).not.toHaveAttribute('aria-hidden', 'true');
  await expect(fab).not.toHaveAttribute('tabindex', '-1');

  // Keyboard users can reach it on a long page.
  await page.keyboard.press('Tab');
  for (let i = 0; i < 60; i++) {
    if (await fab.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(fab).toBeFocused();

  // A text field hides it (the keyboard would cover it); blur brings it straight back.
  const search = page.getByRole('searchbox').or(page.locator('input[type="search"], input[type="text"]')).first();
  await search.focus();
  await expect(fab).toHaveCSS('opacity', '0');
  await expect(fab).toHaveCSS('pointer-events', 'none');
  await search.blur();
  await expect(fab).toHaveCSS('opacity', '1');
  await expect(fab).toBeVisible();

  // Scrolling never hides it.
  await page.mouse.wheel(0, 1500);
  await expect(fab).toHaveCSS('opacity', '1');
  const box = (await fab.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test('FAB stays reachable, hides only while a text field has focus (en)', async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
  await check(page);
});

test('FAB behaves the same in Arabic (rtl)', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await setRole(page, 'OWNER', DASHBOARD);
  await check(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
