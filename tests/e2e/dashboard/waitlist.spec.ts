import { expect, test } from '../helpers/test';
import { mockDashboardApi } from '../helpers/dashboardMock';
import { expectNoHorizontalOverflow, expectNoPageOverflow } from '../helpers/layout';
import { setRole } from '../helpers/mockApi';
import { mockWaitlistScreen, waitlistEntry } from '../helpers/waitlistScreenMock';

// F65: the Waitlist screen (/app/waitlist). Every API call is answered by page.route (no database).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const rows = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'People on the waitlist' }).getByRole('listitem');

test('lists who is waiting, oldest first, with a first name, masked phone, service, staff, dates and when they joined', async ({
  page,
}) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page);
  await page.goto('/app/waitlist');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Waitlist');
  await expect(page.getByText('the order offers are sent', { exact: false })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '3 people waiting' })).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('Rami');
  await expect(rows(page).nth(1)).toContainText('Nadine');
  await expect(rows(page).nth(2)).toContainText('ليلى');
  const rami = rows(page).nth(0);
  await expect(rami).toContainText('•••• ••• 918');
  await expect(rami).toContainText('Haircut');
  await expect(rami).toContainText('Anyone');
  await expect(rami).toContainText(/Thu, Nov 5 to Mon, Nov 9/);
  await expect(rami).toContainText('Joined Sun, Nov 1');
  const nadine = rows(page).nth(1);
  await expect(nadine).toContainText('Colour and cut');
  await expect(nadine).toContainText('Jad');
  // One day only: a single date, not "x to x".
  await expect(nadine).toContainText('Fri, Nov 6');
  await expect(nadine).not.toContainText(' to ');
  // Never an email or a full number.
  const text = await page.getByRole('main').innerText();
  expect(text).not.toContain('@');
  expect(text).not.toMatch(/\+?\d{8,}/);
  // The activity feed is on the same screen.
  await expect(page.getByRole('heading', { name: 'Waitlist activity' })).toBeVisible();
  await expect(page.getByText('Rami took 12:30 with Jad')).toBeVisible();
  await expectNoPageOverflow(page);
});

test('layout: no sideways overflow, Remove is at least 44 px tall', async ({ page }) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page);
  await page.goto('/app/waitlist');
  await expect(rows(page)).toHaveCount(3);
  await expectNoHorizontalOverflow(page.getByRole('main'), 'waitlist screen');
  await expectNoPageOverflow(page);
  for (const name of ['Rami', 'Nadine', 'ليلى']) {
    const box = await page.getByRole('button', { name: `Remove ${name} from the waitlist` }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('an empty waitlist says so calmly', async ({ page }) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page, { entries: [] });
  await page.goto('/app/waitlist');
  await expect(page.getByRole('heading', { name: 'Nobody is waiting' })).toBeVisible();
  await expect(page.getByText('Nobody is waiting').first()).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test('a failed load shows an error with a retry that recovers', async ({ page }) => {
  await mockDashboardApi(page);
  const mock = await mockWaitlistScreen(page, { failGet: 500 });
  await page.goto('/app/waitlist');
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' })).toBeVisible();
  mock.recover();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(rows(page)).toHaveCount(3);
});

test('a capped list says how many are shown', async ({ page }) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page, { total: 140 });
  await page.goto('/app/waitlist');
  await expect(page.getByText('140 people waiting')).toBeVisible();
  await expect(page.getByText('Showing the first 3 of 140')).toBeVisible();
});

test('Remove asks first, names the person, removes at once and confirms', async ({ page }) => {
  await mockDashboardApi(page);
  const mock = await mockWaitlistScreen(page);
  await page.goto('/app/waitlist');
  await page.getByRole('button', { name: 'Remove Rami from the waitlist' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    /Remove .*Rami.* from the waitlist\? They will not receive offers any more\. They can join again from your booking page\./,
  );
  // Nothing was sent yet; Cancel keeps the row.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(rows(page)).toHaveCount(3);
  expect(mock.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

  await page.getByRole('button', { name: 'Remove Rami from the waitlist' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: '2 people waiting' })).toBeVisible();
  await expect(page.getByText(/Rami.* removed from the waitlist/)).toBeVisible();
  expect(mock.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
    '/api/waitlist/wl1',
  ]);
  expect(mock.remaining()).toEqual(['wl2', 'wl3']);
});

test('a server error puts the row back and says so', async ({ page }) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page, { deleteScript: ['500'] });
  await page.goto('/app/waitlist');
  await page.getByRole('button', { name: 'Remove Nadine from the waitlist' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Something went wrong on our side. Please try again.')).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  // Back in its place, between Rami and the third entry.
  await expect(rows(page).nth(1)).toContainText('Nadine');
  await expect(page.getByRole('status').filter({ hasText: '3 people waiting' })).toBeVisible();
});

test('an entry that is already gone (404) refreshes the list quietly', async ({ page }) => {
  await mockDashboardApi(page);
  const mock = await mockWaitlistScreen(page, { deleteScript: ['gone'] });
  await page.goto('/app/waitlist');
  await page.getByRole('button', { name: 'Remove Rami from the waitlist' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText('Nadine');
  // No error toast, no success toast.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByText('removed from the waitlist')).toHaveCount(0);
  await expect.poll(() => mock.calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2);
});

test('the last person removed leaves the empty state', async ({ page }) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page, { entries: [waitlistEntry('only', 'Rami', '918')] });
  await page.goto('/app/waitlist');
  await page.getByRole('button', { name: 'Remove Rami from the waitlist' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nobody is waiting' })).toBeVisible();
});

test('reachable from navigation, and the page is marked current', async ({ page, isMobile }) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page);
  await page.goto('/app');
  if (isMobile) {
    // No new bottom tab: it lives in More.
    await expect(
      page.getByRole('navigation', { name: 'Main tabs' }).getByRole('link', { name: /Waitlist/ }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Waitlist' }).click();
    await expect(page).toHaveURL(/\/app\/waitlist$/);
    await expect(rows(page)).toHaveCount(3);
    const more = page.getByRole('navigation', { name: 'Main tabs' }).getByRole('button', { name: 'More' });
    // The More tab shows as the active place, and the entry inside is the current page.
    await more.click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Waitlist' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  } else {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Waitlist' }).click();
    await expect(page).toHaveURL(/\/app\/waitlist$/);
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Waitlist' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(rows(page)).toHaveCount(3);
  }
});

test('Today links to the screen from the Waitlist activity card', async ({ page }) => {
  await mockDashboardApi(page);
  await mockWaitlistScreen(page);
  await page.goto('/app');
  await page.getByRole('link', { name: 'View waitlist' }).click();
  await expect(page).toHaveURL(/\/app\/waitlist$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Waitlist');
});

test('STAFF can open the screen and remove someone', async ({ page }) => {
  await setRole(page, 'STAFF', DASHBOARD);
  await mockDashboardApi(page);
  const mock = await mockWaitlistScreen(page);
  await page.goto('/app/waitlist');
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove Rami from the waitlist' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  expect(mock.remaining()).toEqual(['wl2', 'wl3']);
});

test.describe('Arabic', () => {
  test('rtl layout, Arabic copy, masked phone stays left-to-right, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockDashboardApi(page);
    await mockWaitlistScreen(page);
    await page.goto('/app/waitlist');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('قائمة الانتظار');
    await expect(page.getByRole('status').filter({ hasText: '3 أشخاص في الانتظار' })).toBeVisible();
    const list = page.getByRole('list', { name: 'الأشخاص في قائمة الانتظار' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('listitem').first()).toContainText('Rami');
    await expect(list.getByRole('listitem').first()).toContainText('أي موظف');
    const phone = list.getByRole('listitem').first().locator('bdi[dir="ltr"]').first();
    await expect(phone).toHaveText('•••• ••• 918');
    await expectNoHorizontalOverflow(page.getByRole('main'), 'waitlist screen (ar)');
    await expectNoPageOverflow(page);

    await page.getByRole('button', { name: 'إزالة Rami من قائمة الانتظار' }).click();
    await expect(page.getByRole('dialog')).toContainText('هل تريد إزالة');
    await expectNoHorizontalOverflow(page.getByRole('dialog'), 'confirm sheet (ar)');
  });
});
