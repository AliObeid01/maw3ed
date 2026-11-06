import { expect, test } from '../helpers/test';
import { mockDashboardApi } from '../helpers/dashboardMock';
import { clockNow } from '../helpers/clock';
import { expectNoPageOverflow } from '../helpers/layout';
import { setRole } from '../helpers/mockApi';

// PR-3 part C: the app header follows the day the agenda shows (mocked API, fake-session dev server).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const TZ = 'Asia/Beirut';
/** The header date for `offset` days from the virtual today, as the app formats it (en, Latin digits). */
const label = (offset: number) =>
  new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    numberingSystem: 'latn',
  }).format(
    new Date(`${clockNow().setZone(TZ).plus({ days: offset }).toISODate()}T12:00:00Z`),
  );


async function header(page: import('@playwright/test').Page) {
  const banner = page.locator('header').first();
  return { banner, title: banner.getByRole('heading', { level: 1 }) };
}

test('today greets and shows the real date; a past day and a future day show their own date and a neutral title; Today jumps back', async ({
  page,
}) => {
  await mockDashboardApi(page);
  await page.goto('/app');
  const { banner, title } = await header(page);

  await expect(title).toHaveText(/^Good (morning|afternoon|evening), Lina$/);
  await expect(banner).toContainText(label(0));

  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(banner).toContainText(label(-1));
  await expect(title).toHaveText('Agenda');
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(title).toHaveText(/^Good /);
  await expect(banner).toContainText(label(0));

  await page.getByRole('button', { name: 'Next day' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(banner).toContainText(label(2));
  await expect(title).toHaveText('Agenda');
  await expect(page.getByRole('heading', { level: 2, name: label(2) })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Today' }).click();
  await expect(banner).toContainText(label(0));
  await expect(title).toHaveText(/^Good (morning|afternoon|evening), Lina$/);
});

test('leaving Today and coming back starts on the real today again', async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto('/app');
  const { banner, title } = await header(page);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(title).toHaveText('Agenda');
  await page.goto('/app/reminders');
  await page.goto('/app');
  await expect(title).toHaveText(/^Good /);
  await expect(banner).toContainText(label(0));
});

test('a tab left open past midnight moves on to the new day and the greeting follows', async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto('/app');
  const { banner, title } = await header(page);
  await expect(banner).toContainText(label(0));
  // The stats come from a client-side fetch, so seeing them proves the page has hydrated before the clock jumps.
  await expect(page.getByText('Appointments today')).toBeVisible();
  // Jump the page clock to 00:10 on the next business-local day (fires the 30 s clock timer once).
  const now = clockNow().setZone(TZ);
  const target = now.plus({ days: 1 }).startOf('day').plus({ minutes: 10 });
  await page.clock.fastForward(target.toMillis() - now.toMillis());
  await expect(banner).toContainText(label(1));
  await expect(title).toHaveText(/^Good morning, Lina$/);
});

test('Arabic: the header date follows the viewed day with Latin digits', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockDashboardApi(page);
  await page.goto('/app');
  const { banner, title } = await header(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(title).toContainText(/(صباح|مساء) الخير، Lina/);
  const before = (await banner.innerText()).split('\n')[0]!;
  await page.getByRole('button', { name: 'اليوم السابق' }).click();
  await expect(title).toHaveText('الجدول');
  await expect.poll(async () => (await banner.innerText()).split('\n')[0]).not.toBe(before);
  expect(await banner.innerText()).toMatch(/\d/);
  expect(await banner.innerText()).not.toMatch(/[٠-٩]/);
  await expectNoPageOverflow(page);
});
