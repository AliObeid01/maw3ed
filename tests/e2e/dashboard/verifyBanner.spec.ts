import { expect, test, type Page } from '@playwright/test';
import { defaultState, mockSetupApi, setRole, type MockState } from '../helpers/mockApi';

// Dashboard specs run against `next dev` with a fake session; e2e_unverified=1 makes the fake owner unverified.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

async function unverified(page: Page) {
  await setRole(page, 'OWNER', DASHBOARD);
  await page.context().addCookies([{ name: 'e2e_unverified', value: '1', url: DASHBOARD }]);
}

function stateWithStaff(): MockState {
  const state = defaultState();
  state.staff = state.staff.filter((s) => s.role !== 'STAFF');
  return state;
}

test.describe('unverified email banner', () => {
  test('shows on every page, resends, and explains the two disabled controls', async ({ page }) => {
    await unverified(page);
    let sends = 0;
    await mockSetupApi(page, {
      state: stateWithStaff(),
      override: async (route, method, path) => {
        if (path === '/api/auth/resend-verification' && method === 'POST') {
          sends++;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, alreadyVerified: false }),
          });
          return true;
        }
        return false;
      },
    });

    await page.goto('/app/staff');
    const banner = page.getByRole('region', { name: 'Email confirmation' });
    await expect(banner).toContainText('Confirm your email address to invite staff');
    const resend = banner.getByRole('button', { name: 'Resend email' });
    expect((await resend.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await resend.click();
    await expect(page.getByText('Confirmation email sent.')).toBeVisible();
    expect(sends).toBe(1);

    // The invite control is disabled and says why.
    await expect(page.getByRole('button', { name: 'Invite receptionist' })).toBeDisabled();
    await expect(page.getByText('Confirm your email address to invite staff.')).toBeVisible();

  });

  test('the directory switch is disabled with its reason, under the same banner', async ({ page }) => {
    await unverified(page);
    await mockSetupApi(page, { state: stateWithStaff() });
    await page.goto('/app/share');
    await expect(page.getByRole('region', { name: 'Email confirmation' })).toBeVisible();
    await expect(page.getByRole('switch')).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByText('Confirm your email address to list your business')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('a rate-limited resend says so', async ({ page }) => {
    await unverified(page);
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (path === '/api/auth/resend-verification' && method === 'POST') {
          await route.fulfill({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'x', fields: {} } }),
          });
          return true;
        }
        return false;
      },
    });
    await page.goto('/app');
    await page.getByRole('button', { name: 'Resend email' }).click();
    await expect(page.getByText('Too many requests. Try again in a while.')).toBeVisible();
  });

  test('a verified owner sees no banner and enabled controls', async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await mockSetupApi(page, { state: stateWithStaff() });
    await page.goto('/app/staff');
    await expect(page.getByRole('button', { name: 'Invite receptionist' })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Email confirmation' })).toHaveCount(0);
  });

  test('Arabic: banner is right-to-left with Arabic copy', async ({ page, context }) => {
    await unverified(page);
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockSetupApi(page);
    await page.goto('/app');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const banner = page.getByRole('region', { name: 'تأكيد البريد الإلكتروني' });
    await expect(banner).toContainText('أكّد بريدك الإلكتروني');
    await expect(banner.getByRole('button', { name: 'إعادة إرسال الرسالة' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
