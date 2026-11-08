import { expect, test } from '../helpers/test';

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
    await expect(page.getByText('Recommended')).toBeVisible();
    await expect(page.getByText('1 bookable staff member')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/signup');
    await expect(page.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute(
      'href',
      '/signup?plan=pro',
    );
    // No card form on the plan page itself.
    await expect(page.locator('input')).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
