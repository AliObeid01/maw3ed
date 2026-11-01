import { expect, test } from '../helpers/test';
import { mockSetupApi, setRole } from '../helpers/mockApi';

// Dashboard specs run against `next dev` with a fake session; every /api call is answered by page.route.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

type Sent = { currentPassword: string; newPassword: string };

test.describe('Settings > Account: change password', () => {
  test('validates, shows a wrong current password on its field, then succeeds', async ({ page }) => {
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
              ? {
                  error: {
                    code: 'VALIDATION_FAILED',
                    message: 'x',
                    fields: { currentPassword: 'Current password is incorrect.' },
                  },
                }
              : { ok: true },
          ),
        });
        return true;
      },
    });
    await page.goto('/app/settings');
    const card = page.getByRole('region', { name: 'Account' });
    await expect(card).toBeVisible();
    await expect(card.locator('input[name=currentPassword]')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    await expect(card.locator('input[name=newPassword]')).toHaveAttribute('dir', 'ltr');
    const submit = card.getByRole('button', { name: 'Change password' });
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Empty and short are caught before any request.
    await submit.click();
    await expect(card.getByText('Enter your current password.')).toBeVisible();
    expect(sent).toHaveLength(0);
    await card.locator('input[name=currentPassword]').fill('not-the-password');
    await card.locator('input[name=newPassword]').fill('short');
    await submit.click();
    await expect(card.getByText('Use at least 10 characters.').first()).toBeVisible();
    expect(sent).toHaveLength(0);

    // Wrong current password: the server answers 400 on that field.
    await card.locator('input[name=newPassword]').fill('a-brand-new-passphrase');
    await submit.click();
    await expect(card.getByText('That is not your current password.')).toBeVisible();
    expect(sent).toHaveLength(1);

    // Correct: success toast, fields cleared.
    await card.locator('input[name=currentPassword]').fill('correct-horse-battery');
    await submit.click();
    await expect(
      page.getByText('Password changed. Other devices were signed out.'),
    ).toBeVisible();
    await expect(card.locator('input[name=currentPassword]')).toHaveValue('');
    expect(sent.at(-1)).toEqual({
      currentPassword: 'correct-horse-battery',
      newPassword: 'a-brand-new-passphrase',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('a rate limit is explained', async ({ page }) => {
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
    await page.goto('/app/settings');
    const card = page.getByRole('region', { name: 'Account' });
    await card.locator('input[name=currentPassword]').fill('whatever-it-is');
    await card.locator('input[name=newPassword]').fill('a-brand-new-passphrase');
    await card.getByRole('button', { name: 'Change password' }).click();
    await expect(card.getByRole('alert')).toContainText('Too many attempts');
  });

  test('Arabic: the Account card is right-to-left with Arabic copy', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockSetupApi(page);
    await page.goto('/app/settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const card = page.getByRole('region', { name: 'الحساب' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'تغيير كلمة المرور' })).toBeVisible();
    await expect(card.locator('input[name=currentPassword]')).toHaveAttribute('dir', 'ltr');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
