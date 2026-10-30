import { expect, test } from '@playwright/test';
import { mockDashboardApi } from '../helpers/dashboardMock';
import { setRole } from '../helpers/mockApi';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.skip(({ isMobile }) => !isMobile, 'bottom tabs are a phone layout');
test.use({ baseURL: DASHBOARD });

test('Today in Arabic: rtl, mirrored bottom tabs, no horizontal scroll, language toggle in More', async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await setRole(page, 'OWNER', DASHBOARD);
  await mockDashboardApi(page);
  await page.goto('/app');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/(صباح|مساء) الخير، Lina/);

  const tabs = page.getByRole('navigation', { name: 'التبويبات الرئيسية' });
  const today = tabs.getByRole('link', { name: /اليوم/ });
  const reminders = tabs.getByRole('link', { name: /التذكيرات/ });
  await expect(today).toHaveAttribute('aria-current', 'page');
  const [a, b] = await Promise.all([today.boundingBox(), reminders.boundingBox()]);
  // Mirrored: the first tab sits at the right-hand edge.
  expect(a!.x).toBeGreaterThan(b!.x);
  expect(a!.height).toBeGreaterThanOrEqual(44);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await tabs.getByRole('button', { name: 'المزيد' }).click();
  const toggle = page.getByRole('dialog').getByRole('button', { name: 'English' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(new URL(page.url()).pathname).toBe('/app');
});
