import { expect, test } from '../helpers/test';
import { mockDashboardApi } from '../helpers/dashboardMock';
import { clockNow } from '../helpers/clock';
import { expectNoPageOverflow } from '../helpers/layout';
import { setRole } from '../helpers/mockApi';

// PR-19 part B: the Today header date opens a month calendar, so any past or future day is two taps away.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const TZ = 'Asia/Beirut';
const ymd = (offset: number) => clockNow().setZone(TZ).plus({ days: offset }).toISODate()!;
const long = (offset: number) =>
  new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    numberingSystem: 'latn',
  }).format(new Date(`${ymd(offset)}T12:00:00Z`));

test('open the picker, jump back in two taps, Escape restores focus, Today returns', async ({ page }) => {
  await mockDashboardApi(page);
  const requests: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/dashboard/today') requests.push(u.searchParams.get('date') ?? '');
  });
  await page.goto('/app');
  const banner = page.locator('header').first();
  const trigger = page.getByRole('button', { name: /^Pick a day/ });
  await expect(banner).toContainText(long(0));

  // Two taps: the date, then "Last week".
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose a date' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('grid')).toBeVisible();
  await dialog.getByRole('button', { name: 'Last week' }).click();
  await expect(dialog).toBeHidden();
  await expect(banner.getByRole('heading', { level: 1 })).toHaveText('Agenda');
  await expect(page.getByRole('heading', { level: 2, name: long(-7) })).toBeVisible();
  await expect.poll(() => requests).toContain(ymd(-7));
  await expect(trigger).toBeFocused();

  // Three weeks ago: the calendar opens on the viewed month (October), so it is date, day.
  await trigger.click();
  await page.locator(`[data-ymd="${ymd(-21)}"]`).click();
  await expect(page.getByRole('heading', { level: 2, name: long(-21) })).toBeVisible();
  await expect.poll(() => requests).toContain(ymd(-21));

  // Escape closes and hands focus back.
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeHidden();
  await expect(trigger).toBeFocused();

  // Keyboard: the viewed day has focus on open, arrows move, Enter picks.
  await trigger.click();
  await expect(page.locator(`[data-ymd="${ymd(-21)}"]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: long(-14) })).toBeVisible();

  // Month arrows reach any other month: back to November, then Today's day is two taps away.
  await trigger.click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.locator(`[data-ymd="${ymd(0)}"]`).click();
  await expect(banner.getByRole('heading', { level: 1 })).toHaveText(/^Good /);
  await page.getByRole('button', { name: /^Pick a day/ }).click();
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Enter');
  await expect(banner.getByRole('heading', { level: 1 })).toHaveText('Agenda');

  // The Today button returns to the real today and goes quiet.
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(banner.getByRole('heading', { level: 1 })).toHaveText(/^Good /);
  await expect(page.getByRole('button', { name: 'Today' })).toBeDisabled();
  await expect(banner).toContainText(long(0));
});

test('phone: the week strip switches the day; 360 px has no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockDashboardApi(page);
  await page.goto('/app');
  const strip = page.getByRole('group', { name: 'Days of this week' });
  await expect(strip.getByRole('button')).toHaveCount(7);
  await expect(strip.locator('[aria-current="date"]')).toHaveCount(1);
  await strip.locator('[aria-pressed="false"]').first().click();
  await expect(page.locator('header').first().getByRole('heading', { level: 1 })).toHaveText(/^Good |Agenda/);
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: /^Pick a day/ }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('Arabic RTL at 360 px: arrows swap, grid mirrors, Latin digits, no overflow', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await page.setViewportSize({ width: 360, height: 740 });
  await mockDashboardApi(page);
  await page.goto('/app');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: /^اختر يومًا/ }).click();
  const dialog = page.getByRole('dialog', { name: 'اختر تاريخًا' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('grid')).toBeVisible();
  // First column (Monday) sits at the inline start = the right edge in RTL.
  const first = await dialog.getByRole('columnheader').first().boundingBox();
  const last = await dialog.getByRole('columnheader').last().boundingBox();
  expect(first!.x).toBeGreaterThan(last!.x);
  // ArrowLeft moves to the NEXT day in RTL.
  await expect(page.locator(`[data-ymd="${ymd(0)}"]`)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(`[data-ymd="${ymd(1)}"]`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expect(await page.locator('header').first().innerText()).not.toMatch(/[٠-٩]/);
  await expectNoPageOverflow(page);
});
