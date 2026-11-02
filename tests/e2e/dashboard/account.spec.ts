import { type Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { mockSetupApi, setRole } from '../helpers/mockApi';

// F35: /app/account is open to every signed-in role. Dashboard specs run against `next dev` with a fake
// session (e2e_role cookie); every /api call is answered by page.route. No date or time is shown here.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
// `next dev` compiles /app/account on first visit; give a slow CI or a busy machine room.
test.setTimeout(90_000);

type Sent = { currentPassword: string; newPassword: string };

/** Open the Account page the way a person does: the More sheet on phones, the sidebar footer on desktop. */
async function openFromNav(page: Page, isMobile: boolean, label = 'Account') {
  await page.goto('/app');
  if (isMobile) {
    await page.getByRole('button', { name: /^(More|المزيد)$/ }).click();
    await page.getByRole('dialog').getByRole('link', { name: label }).click();
  } else {
    await page.getByRole('navigation', { name: label }).getByRole('link', { name: label }).click();
  }
  await page.waitForURL('**/app/account');
}

for (const role of ['OWNER', 'STAFF'] as const) {
  test.describe(`Account page as ${role}`, () => {
    test.beforeEach(async ({ page }) => {
      await setRole(page, role, DASHBOARD);
    });

    test('is reachable from the navigation, marks it current, and shows only my own data', async ({
      page,
      isMobile,
    }) => {
      const { calls } = await mockSetupApi(page);
      await openFromNav(page, isMobile);
      await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();

      const profile = page.getByRole('region', { name: 'Your sign-in' });
      await expect(profile).toContainText('Lina');
      await expect(profile).toContainText('lina@studio-nour.test');
      await expect(profile).toContainText('Confirmed');
      await expect(profile).toContainText(role === 'OWNER' ? 'Owner' : 'Staff');

      // Current page is announced in the navigation.
      if (isMobile) {
        await page.getByRole('button', { name: 'More' }).click();
        await expect(page.getByRole('dialog').getByRole('link', { name: 'Account' })).toHaveAttribute(
          'aria-current',
          'page',
        );
      } else {
        await expect(page.getByRole('link', { name: 'Account' })).toHaveAttribute(
          'aria-current',
          'page',
        );
      }
      // No setup (owner-only) endpoint is called; the shell's own badge polling is fine.
      expect(calls.filter((c) => !c.path.startsWith('/api/dashboard/'))).toEqual([]);
    });

    test('changes the password: validation, wrong current password, then success', async ({ page }) => {
      const sent: Sent[] = [];
      await mockSetupApi(page, {
        override: async (route, method, path, body) => {
          if (path !== '/api/auth/change-password' || method !== 'POST') return false;
          sent.push(body as Sent);
          const wrong = (body as Sent).currentPassword !== 'correct-horse-battery';
          await route.fulfill({
            status: wrong ? 400 : 200,
            contentType: 'application/json',
            body: JSON.stringify(
              wrong
                ? { error: { code: 'VALIDATION_FAILED', message: 'x', fields: { currentPassword: 'wrong' } } }
                : { ok: true },
            ),
          });
          return true;
        },
      });
      await page.goto('/app/account');
      const card = page.getByRole('region', { name: 'Account' });
      const submit = card.getByRole('button', { name: 'Change password' });
      expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      // The button is server-rendered before React attaches its handler: retry the click until it takes effect.
      await expect(async () => {
        await submit.click();
        await expect(card.getByText('Enter your current password.')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 25_000 });
      expect(sent).toHaveLength(0);

      await card.locator('input[name=currentPassword]').fill('not-the-password');
      await card.locator('input[name=newPassword]').fill('a-brand-new-passphrase');
      await submit.click();
      await expect(card.getByText('That is not your current password.')).toBeVisible();

      await card.locator('input[name=currentPassword]').fill('correct-horse-battery');
      await submit.click();
      await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible();
      expect(sent.at(-1)).toEqual({
        currentPassword: 'correct-horse-battery',
        newPassword: 'a-brand-new-passphrase',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test('signs out other devices after a confirmation, and signs out this one', async ({ page }) => {
      const { calls } = await mockSetupApi(page);
      await page.goto('/app/account');
      const card = page.getByRole('region', { name: 'Account' });
      const open = card.getByRole('button', { name: 'Sign out other devices' });
      expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await open.click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Sign out other devices' }).click();
      await expect(card.getByText('2 other devices were signed out.')).toBeVisible();
      expect(calls.filter((c) => c.path === '/api/auth/sign-out-others')).toHaveLength(1);

      await page.getByRole('main').getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL('**/login');
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true);
    });
  });
}

test.describe('Account page: other states', () => {
  test('an unverified address says so, and the banner still resends from this page', async ({ page }) => {
    await setRole(page, 'STAFF', DASHBOARD);
    await page.context().addCookies([{ name: 'e2e_unverified', value: '1', url: DASHBOARD }]);
    let sends = 0;
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (path !== '/api/auth/resend-verification' || method !== 'POST') return false;
        sends++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, alreadyVerified: false }),
        });
        return true;
      },
    });
    await page.goto('/app/account');
    await expect(page.getByRole('region', { name: 'Your sign-in' })).toContainText('Not confirmed yet');
    const banner = page.getByRole('region', { name: 'Email confirmation' });
    await expect(async () => {
      await banner.getByRole('button', { name: 'Resend email' }).click();
      await expect(page.getByText('Confirmation email sent.')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    expect(sends).toBeGreaterThanOrEqual(1);
  });

  test('a rate limit on change password is explained', async ({ page }) => {
    await setRole(page, 'STAFF', DASHBOARD);
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (path !== '/api/auth/change-password' || method !== 'POST') return false;
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'x', fields: {} } }),
        });
        return true;
      },
    });
    await page.goto('/app/account');
    const card = page.getByRole('region', { name: 'Account' });
    await card.locator('input[name=currentPassword]').fill('whatever-it-is');
    await card.locator('input[name=newPassword]').fill('a-brand-new-passphrase');
    await card.getByRole('button', { name: 'Change password' }).click();
    await expect(card.getByRole('alert')).toContainText('Too many attempts');
  });

  test('Settings no longer holds the Account card', async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await mockSetupApi(page);
    await page.goto('/app/settings');
    await expect(page.getByLabel('Cancellation cutoff')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0);
  });

  test('Arabic: right-to-left page with Arabic copy, reached from the navigation', async ({
    page,
    context,
    isMobile,
  }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await setRole(page, 'STAFF', DASHBOARD);
    await mockSetupApi(page);
    await openFromNav(page, isMobile, 'الحساب');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الحساب' })).toBeVisible();
    const profile = page.getByRole('region', { name: 'تسجيل دخولك' });
    await expect(profile).toContainText('مؤكَّد');
    await expect(profile.getByText('lina@studio-nour.test')).toHaveAttribute('dir', 'ltr');
    const card = page.getByRole('region', { name: 'الحساب' });
    await expect(card.getByRole('button', { name: 'تغيير كلمة المرور' })).toBeVisible();
    await expect(card.locator('input[name=newPassword]')).toHaveAttribute('dir', 'ltr');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
