import { expect, test, type Page, type Route } from '@playwright/test';
import { freezeClock, ORIGIN } from './helpers/clock';

// Self-contained: every API call is answered by page.route (virtual clock via freezeClock), no backend.
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string) =>
  json(route, status, { error: { code, message: code, fields: {} } });

async function mockVerify(page: Page, answer: (route: Route) => unknown) {
  await freezeClock(page);
  const calls: Array<{ method: string; body: unknown }> = [];
  await page.route('**/api/auth/verify-email', async (route) => {
    const raw = route.request().postData();
    calls.push({ method: route.request().method(), body: raw ? JSON.parse(raw) : undefined });
    await answer(route);
  });
  return calls;
}

test.describe('verify email page', () => {
  test('opening the link changes nothing; the button confirms and shows success', async ({
    page,
  }) => {
    const calls = await mockVerify(page, (route) => json(route, 200, { ok: true }));
    const response = await page.goto('/verify-email/tok123');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
    expect(calls).toHaveLength(0);

    const button = page.getByRole('button', { name: 'Confirm my email' });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to my dashboard' })).toHaveAttribute(
      'href',
      '/app',
    );
    expect(calls).toEqual([{ method: 'POST', body: { token: 'tok123' } }]);
    // 360 px first: nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('an expired, used or unknown token shows one generic state with a way forward', async ({
    page,
  }) => {
    await mockVerify(page, (route) => err(route, 410, 'LINK_INVALID'));
    await page.goto('/verify-email/old');
    await page.getByRole('button', { name: 'Confirm my email' }).click();
    await expect(page.getByRole('alert')).toContainText('This link is not valid');
    await expect(page.getByRole('alert')).toContainText('Resend email');
    await expect(page.getByRole('link', { name: 'Go to my dashboard' })).toBeVisible();
  });

  test('a network failure can be retried', async ({ page }) => {
    let n = 0;
    await mockVerify(page, (route) => (n++ === 0 ? route.abort('connectionreset') : json(route, 200, { ok: true })));
    await page.goto('/verify-email/tok');
    await page.getByRole('button', { name: 'Confirm my email' }).click();
    await expect(page.getByRole('alert')).toContainText("can't reach the server");
    await page.getByRole('button', { name: 'Confirm my email' }).click();
    await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  });

  test('Arabic: right-to-left page with Arabic copy and no sideways scroll', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockVerify(page, (route) => err(route, 410, 'LINK_INVALID'));
    await page.goto('/verify-email/tok');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تأكيد بريدك الإلكتروني' })).toBeVisible();
    await page.getByRole('button', { name: 'تأكيد بريدي الإلكتروني' }).click();
    await expect(page.getByRole('heading', { name: 'هذا الرابط غير صالح' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
