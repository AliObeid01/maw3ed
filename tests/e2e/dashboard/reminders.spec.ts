import { type Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { nowDate } from '../helpers/clock';
import { mockDashboardApi } from '../helpers/dashboardMock';
import { setRole } from '../helpers/mockApi';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
  // WhatsApp itself is never contacted: the popup just needs something to load.
  await page.context().route('https://wa.me/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>WhatsApp</body></html>' }),
  );
});

const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
const badge = (page: Page, count: number) =>
  page.getByRole('link', { name: new RegExp(`${count} reminders? due`) }).first();

test('lists due reminders with chips, the sent one and the no-phone one', async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto('/app/reminders');
  await expect(page.getByRole('status').filter({ hasText: '3 to send' })).toBeVisible();
  const nadine = row(page, 'Nadine Aoun');
  await expect(nadine).toContainText('2 no-shows');
  await expect(nadine).toContainText('+961 76 418 902');
  await expect(nadine.getByText('2 h', { exact: true })).toBeVisible();
  await expect(row(page, 'Maya Haddad').getByText('24 h', { exact: true })).toBeVisible();
  await expect(nadine.getByRole('link', { name: /Send the reminder to Nadine Aoun/ })).toBeVisible();
  await expect(row(page, 'Rami Haddad')).toContainText('Sent by Rana, 09:14');
  await expect(row(page, 'Rami Haddad').getByRole('link')).toHaveCount(0);
  // Board 4.2: the done state is a DISABLED button that carries the sender and the time (business timezone, 24 h).
  const sent = row(page, 'Rami Haddad').getByRole('button', { name: 'Sent by Rana, 09:14' });
  await expect(sent).toBeDisabled();
  await expect(sent).toHaveAttribute('aria-disabled', 'true');
  expect((await sent.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // F56: the announcements come from ONE persistent polite live region, empty until a row flips to sent.
  await expect(page.getByTestId('reminder-announcer')).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByTestId('reminder-announcer')).toHaveText('');
  const lea = row(page, 'Lea Saab');
  await expect(lea).toContainText('No valid phone');
  await expect(lea.getByRole('link', { name: 'Call instead' })).toHaveAttribute('href', 'tel:+9613512774');
});

test('Send opens WhatsApp in a new tab (noopener), records it, and updates the counter and badge', async ({
  page,
}) => {
  const { calls } = await mockDashboardApi(page);
  await page.goto('/app/reminders');
  await expect(badge(page, 3)).toBeVisible();
  const link = row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  const popup = page.context().waitForEvent('page');
  await link.click();
  expect((await popup).url()).toMatch(/^https:\/\/wa\.me\/96176418902/);
  await expect(row(page, 'Nadine Aoun')).toContainText('Sent by Lina');
  await expect(row(page, 'Nadine Aoun').getByRole('button', { name: /^Sent by Lina/ })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: '2 to send' })).toBeVisible();
  await expect(badge(page, 2)).toBeVisible();
  expect(calls.filter((c) => c.path === '/api/reminders/rm1/mark-sent' && c.method === 'POST')).toHaveLength(1);
});

test('F56: the persistent live region exists before the flip and announces the sent text after', async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto('/app/reminders');
  const region = page.getByTestId('reminder-announcer');
  await expect(row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ })).toBeVisible();
  // Before the update: already in the DOM (so a screen reader is watching it), polite, and empty.
  await expect(region).toHaveCount(1);
  await expect(region).toHaveAttribute('role', 'status');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveText('');
  const handle = await region.elementHandle();
  await row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ }).click();
  await expect(region).toContainText('Nadine Aoun: Sent by Lina');
  // The very same element received the text (it was not re-mounted with its content).
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
});

test('a double tap opens WhatsApp once and records once', async ({ page }) => {
  const { calls } = await mockDashboardApi(page);
  await page.goto('/app/reminders');
  let opened = 0;
  page.context().on('page', () => (opened += 1));
  // The new tab opens asynchronously: wait for it instead of hoping 300 ms is enough on a slow runner.
  const firstTab = page.context().waitForEvent('page');
  await row(page, 'Nadine Aoun')
    .getByRole('link', { name: /Send the reminder/ })
    .evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });
  await expect(row(page, 'Nadine Aoun')).toContainText('Sent by');
  await firstTab;
  await page.waitForTimeout(300);
  expect(opened).toBe(1);
  expect(calls.filter((c) => c.path.endsWith('/mark-sent'))).toHaveLength(1);
});

test('409 ALREADY_SENT shows who sent it first, without an error', async ({ page }) => {
  await mockDashboardApi(page, { markSentScript: ['conflict'] });
  await page.goto('/app/reminders');
  await row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ }).click();
  await expect(row(page, 'Nadine Aoun')).toContainText('Sent by Rana, 09:14');
  await expect(row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ })).toHaveCount(0);
  await expect(row(page, 'Nadine Aoun').getByRole('button', { name: 'Sent by Rana, 09:14' })).toBeDisabled();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('a failed mark-sent after WhatsApp opened shows a retry that does not reopen WhatsApp', async ({ page }) => {
  const { calls } = await mockDashboardApi(page, { markSentScript: ['500', 'ok'] });
  await page.goto('/app/reminders');
  let opened = 0;
  page.context().on('page', () => (opened += 1));
  const firstTab = page.context().waitForEvent('page');
  await row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ }).click();
  await firstTab;
  const alert = row(page, 'Nadine Aoun').getByRole('alert');
  await expect(alert).toContainText('could not record it as sent');
  await expect(alert).toContainText('may already be sent');
  // Still counts as to send, and the send link is gone so it cannot be reopened by accident.
  await expect(page.getByRole('status').filter({ hasText: '3 to send' })).toBeVisible();
  await expect(row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ })).toHaveCount(0);
  await row(page, 'Nadine Aoun').getByRole('button', { name: 'Mark as sent' }).click();
  await expect(row(page, 'Nadine Aoun')).toContainText('Sent by Lina');
  await page.waitForTimeout(300);
  expect(opened).toBe(1);
  expect(calls.filter((c) => c.path === '/api/reminders/rm1/mark-sent')).toHaveLength(2);
});

test('the list refreshes when the window regains focus (another device sent one)', async ({ page }) => {
  const { reminders } = await mockDashboardApi(page);
  await page.goto('/app/reminders');
  await expect(page.getByRole('status').filter({ hasText: '3 to send' })).toBeVisible();
  const maya = reminders.find((r) => r.id === 'rm2')!;
  maya.status = 'SENT';
  maya.sentBy = { id: 'u-rana', name: 'Rana' };
  maya.sentAt = nowDate().toISOString();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(row(page, 'Maya Haddad')).toContainText('Sent by Rana');
  await expect(page.getByRole('status').filter({ hasText: '2 to send' })).toBeVisible();
  await expect(badge(page, 2)).toBeVisible();
});

test('empty and error states', async ({ page }) => {
  await mockDashboardApi(page, { reminders: [] });
  await page.goto('/app/reminders');
  await expect(page.getByRole('heading', { name: 'All reminders sent' })).toBeVisible();

  const second = await page.context().newPage();
  await second.route('**/api/reminders/whatsapp-due', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"x"}}' }),
  );
  await second.goto('/app/reminders');
  await expect(second.getByRole('main').getByRole('alert')).toContainText('We could not load this');
  await expect(second.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test.describe('layouts', () => {
  test('phone: stacked cards with a full-width action; desktop: table header', async ({ page, isMobile }) => {
    await mockDashboardApi(page);
    await page.goto('/app/reminders');
    const link = row(page, 'Nadine Aoun').getByRole('link', { name: /Send the reminder/ });
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const header = page.getByText('Appointment', { exact: true });
    if (isMobile) {
      await expect(header).toBeHidden();
      const card = (await row(page, 'Nadine Aoun').boundingBox())!;
      expect(box.width).toBeGreaterThan(card.width * 0.8);
    } else {
      await expect(header).toBeVisible();
      expect(box.width).toBeLessThan(260);
    }
  });

  test('RTL: Arabic labels, phone number stays left-to-right', async ({ page }) => {
    await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockDashboardApi(page);
    await page.goto('/app/reminders');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('أرسل عبر واتساب').first()).toBeVisible();
    await expect(page.locator('bdi[dir="ltr"]', { hasText: '+961 76 418 902' })).toBeVisible();
    // The done state keeps the time as its own left-to-right run with Latin digits.
    const sent = page.getByRole('button', { name: /^أرسله Rana/ });
    await expect(sent).toBeDisabled();
    await expect(sent.locator('bdi[dir="ltr"]', { hasText: '09:14' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
