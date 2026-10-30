import { expect, test } from '@playwright/test';
import { mockSetupApi, setRole } from '../helpers/mockApi';

// Runs against the fake-session dev server; /api is answered by page.route (no database, no card form).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.describe('5.1 pricing', () => {
  test('shows Free and Pro with the test-mode label and no overflow at 360 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Free', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro', level: 2 })).toBeVisible();
    await expect(page.getByText('TEST MODE').first()).toBeVisible();
    await expect(page.getByText('1 bookable staff member')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/signup');
    await expect(page.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute(
      'href',
      '/app/settings',
    );
    // No card form anywhere.
    await expect(page.locator('input')).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('upgrade from Settings goes through a confirmation sheet, then shows Pro and a way back', async ({
    page,
  }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 800 });
    const { calls } = await mockSetupApi(page);
    await page.goto('/app/settings');

    await expect(page.getByText('Bookable staff: 3 of 1')).toBeVisible();
    await page.getByRole('button', { name: 'Upgrade (test checkout)' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/TEST MODE/)).toBeVisible();
    await expect(sheet.locator('input')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Confirm test upgrade' }).click();

    await expect(
      page.getByText('You are now on Pro. You can add more bookable staff.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch back to Free' })).toBeVisible();
    expect(calls.filter((c) => c.path === '/api/billing/checkout')).toHaveLength(1);

    await page.getByRole('button', { name: 'Switch back to Free' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Switch to Free' }).click();
    await expect(page.getByRole('button', { name: 'Upgrade (test checkout)' })).toBeVisible();
  });
});
