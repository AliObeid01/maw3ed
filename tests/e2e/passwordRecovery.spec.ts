import { type Page, type Route } from '@playwright/test';
import { expect, test } from './helpers/test';
import { freezeClock, ORIGIN } from './helpers/clock';

// Self-contained: every API call is answered by page.route (virtual clock via freezeClock), no backend.
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const err = (route: Route, status: number, code: string, fields: Record<string, string> = {}) =>
  json(route, status, { error: { code, message: code, fields } });

async function mock(page: Page, path: string, answer: (route: Route, body: unknown) => unknown) {
  await freezeClock(page);
  const calls: unknown[] = [];
  await page.route(`**${path}`, async (route) => {
    const raw = route.request().postData();
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push(body);
    await answer(route, body);
  });
  return calls;
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe('login page', () => {
  test('has a Forgot password link that is a 44 px tap target', async ({ page }) => {
    await page.goto('/login');
    const link = page.getByRole('link', { name: 'Forgot password?' });
    await expect(link).toHaveAttribute('href', '/forgot-password');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('forgot password', () => {
  test('validates, then shows the same generic confirmation', async ({ page }) => {
    const calls = await mock(page, '/api/auth/forgot-password', (route) =>
      json(route, 200, { ok: true }),
    );
    await page.goto('/forgot-password');
    const email = page.locator('input[name=email]');
    await expect(email).toHaveAttribute('dir', 'ltr');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Enter your email address.');
    expect(calls).toHaveLength(0);

    await email.fill('nobody@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('If an account exists for that address')).toBeVisible();
    expect(calls).toEqual([{ email: 'nobody@example.com' }]);
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(await noSideScroll(page)).toBe(true);
  });

  test('a rate limit is explained and can be retried', async ({ page }) => {
    let n = 0;
    await mock(page, '/api/auth/forgot-password', (route) =>
      n++ === 0 ? err(route, 429, 'RATE_LIMITED') : json(route, 200, { ok: true }),
    );
    await page.goto('/forgot-password');
    await page.locator('input[name=email]').fill('a@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Too many requests');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  test('Arabic: right-to-left, Arabic copy, email field stays left-to-right', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mock(page, '/api/auth/forgot-password', (route) => json(route, 200, { ok: true }));
    await page.goto('/forgot-password');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'نسيت كلمة المرور؟' })).toBeVisible();
    await expect(page.locator('input[name=email]')).toHaveAttribute('dir', 'ltr');
    await page.locator('input[name=email]').fill('a@example.com');
    await page.getByRole('button', { name: 'إرسال رابط إعادة التعيين' }).click();
    await expect(page.getByRole('heading', { name: 'تحقق من بريدك الإلكتروني' })).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });
});

test.describe('reset password', () => {
  test('sends no-referrer and no-store, validates, then shows success with a sign-in link', async ({
    page,
  }) => {
    const calls = await mock(page, '/api/auth/reset-password', (route) =>
      json(route, 200, { ok: true }),
    );
    const response = await page.goto('/reset-password/tok123');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page.locator('input[name=password]')).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.locator('input[name=password]')).toHaveAttribute('dir', 'ltr');

    await page.locator('input[name=password]').fill('short');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Use at least 10 characters.');
    expect(calls).toHaveLength(0);

    await page.locator('input[name=password]').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(calls).toEqual([{ token: 'tok123', newPassword: 'a-brand-new-passphrase' }]);
    expect(await noSideScroll(page)).toBe(true);
  });

  test('an expired or used link offers a new one', async ({ page }) => {
    await mock(page, '/api/auth/reset-password', (route) => err(route, 410, 'LINK_INVALID'));
    await page.goto('/reset-password/old');
    await page.locator('input[name=password]').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  test('Arabic: right-to-left form and success state', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mock(page, '/api/auth/reset-password', (route) => json(route, 200, { ok: true }));
    await page.goto('/reset-password/tok');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'اختيار كلمة مرور جديدة' })).toBeVisible();
    await page.locator('input[name=password]').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'حفظ كلمة المرور الجديدة' }).click();
    await expect(page.getByRole('heading', { name: 'تم تغيير كلمة المرور' })).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  });
});
