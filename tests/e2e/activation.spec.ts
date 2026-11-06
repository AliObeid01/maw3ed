import { type Route } from '@playwright/test';
import { expect, test } from './helpers/test';

// Self-contained: every API call is answered by page.route. Fake values only (obviously fake LB numbers).

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const dead = { error: { code: 'NOT_FOUND', message: 'This link is not valid or has expired.', fields: {} } };
const session = {
  user: { id: 'u9', name: 'Barber One', email: null, phone: '+96170000001', emailVerified: false },
  business: { id: 'b1', slug: 'studio-nour', name: 'Studio Nour', timezone: 'Asia/Beirut' },
  role: 'PRACTITIONER',
};

test.describe('activation page', () => {
  test('360 px: choose a password, weak one is refused inline, then signed in and sent to the welcome page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    let posted: unknown;
    await page.route('**/api/activation/tok', async (route) => {
      if (route.request().method() === 'GET') return json(route, 200, { ok: true });
      posted = route.request().postDataJSON();
      return json(route, 200, session);
    });
    await page.goto('/activate/tok');
    const password = page.locator('input[name=password]');
    await expect(password).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
    expect((await password.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Nothing about the business or the person is shown before the password is set.
    await expect(page.locator('body')).not.toContainText('Studio Nour');

    await password.fill('short');
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('Use at least 10 characters.').first()).toBeVisible();
    expect(posted).toBeUndefined();

    await password.fill('a brand new password');
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/app/welcome');
    expect(posted).toEqual({ password: 'a brand new password' });
  });

  test('a link that is not usable only says not valid or expired', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.route('**/api/activation/gone', (route) => json(route, 404, dead));
    await page.goto('/activate/gone');
    await expect(page.getByRole('heading', { name: 'This link is not valid or has expired' })).toBeVisible();
    await expect(page.locator('input[name=password]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
  });

  test('the token never leaks: no-referrer, no-store, no indexing', async ({ page }) => {
    await page.route('**/api/activation/tok', (route) => json(route, 200, { ok: true }));
    const response = await page.goto('/activate/tok');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page.locator('head meta[name=referrer]')).toHaveAttribute('content', 'no-referrer');
    await expect(page.locator('head meta[name=robots]')).toHaveAttribute('content', /noindex/);
  });

  test('Arabic: right-to-left, no horizontal scroll at 360 px', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.route('**/api/activation/tok', (route) => json(route, 200, { ok: true }));
    await page.goto('/activate/tok');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'اختر كلمة المرور' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test.describe('login form accepts email or phone', () => {
  test('a phone number is sent as the identifier', async ({ page }) => {
    let posted: unknown;
    await page.route('**/api/auth/login', (route) => {
      posted = route.request().postDataJSON();
      return json(route, 200, session);
    });
    await page.goto('/login');
    await expect(page.getByLabel('Email or phone')).toBeVisible();
    await page.fill('input[name=email]', '70 000 001');
    await page.fill('input[name=password]', 'a brand new password');
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/app');
    expect(posted).toEqual({ identifier: '70 000 001', password: 'a brand new password' });
  });

  test('text that is neither is refused before any request', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/login', (route) => {
      calls++;
      return json(route, 200, session);
    });
    await page.goto('/login');
    await page.fill('input[name=email]', 'barber');
    await page.fill('input[name=password]', 'whatever password');
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('Enter an email address or a phone number.')).toBeVisible();
    expect(calls).toBe(0);
  });
});
