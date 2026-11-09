import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { expectNoPageOverflow } from '../helpers/layout';
import { mockSetupApi, setRole } from '../helpers/mockApi';

// PR-13: the plan lives in the Settings page header as a chip ("Free" or "Pro" plus the TEST MODE tag) that opens a small
// menu. Runs against the fake-session dev server; every /api call is answered by page.route.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.setTimeout(90_000);

const box = async (l: Locator) => (await l.boundingBox())!;

async function open(page: Page, plan: 'FREE' | 'PRO', width = 1440) {
  await setRole(page, 'OWNER', DASHBOARD);
  await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
  const mock = await mockSetupApi(page, { plan });
  await page.goto('/app/settings');
  const chip = page.getByTestId('plan-chip');
  await expect(chip).toBeVisible();
  return { chip, ...mock };
}

test.describe('plan chip in the Settings header', () => {
  test('FREE: the chip says Free + TEST MODE; the menu has usage, Upgrade to Pro and Compare plans, nothing else', async ({ page }) => {
    const { chip } = await open(page, 'FREE');
    await expect(chip).toContainText('Free');
    await expect(chip).toContainText('TEST MODE');
    await expect(chip).toHaveAccessibleName(/Your plan: Free/);
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect((await box(chip)).height).toBeGreaterThanOrEqual(44);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByTestId('plan-menu');
    await expect(menu).toContainText('Bookable staff: 1 of 1');
    await expect(menu.getByRole('menuitem')).toHaveText(['Upgrade to Pro', 'Compare plans']);
    await expect(menu.getByRole('menuitem', { name: 'Upgrade to Pro' })).toHaveAttribute('href', '/app/checkout?plan=pro');
    await expect(menu.getByRole('menuitem', { name: 'Compare plans' })).toHaveAttribute('href', '/for-business#plans');
    await expect(menu.getByRole('menuitem', { name: 'Switch back to Free' })).toHaveCount(0);
    for (const item of await menu.getByRole('menuitem').all()) expect((await box(item)).height).toBeGreaterThanOrEqual(43.5);
  });

  test('PRO: no limit text, Compare plans and Switch back to Free (the existing confirmation and endpoint)', async ({ page }) => {
    const { chip, calls } = await open(page, 'PRO');
    await expect(chip).toContainText('Pro');
    await chip.click();
    const menu = page.getByTestId('plan-menu');
    await expect(menu).toContainText('Bookable staff: 1 (no limit)');
    await expect(menu.getByRole('menuitem')).toHaveText(['Compare plans', 'Switch back to Free']);
    await expect(menu.getByRole('menuitem', { name: 'Compare plans' })).toHaveAttribute('href', '/for-business#plans');
    await expect(menu.getByRole('menuitem', { name: 'Upgrade to Pro' })).toHaveCount(0);

    // Switch back: the menu closes, the same confirmation as before opens; Cancel changes nothing.
    await menu.getByRole('menuitem', { name: 'Switch back to Free' }).click();
    const dialog = page.getByRole('dialog', { name: 'Switch back to Free?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Free includes one bookable staff member.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.filter((c) => c.path === '/api/billing/downgrade')).toHaveLength(0);
    await expect(chip).toContainText('Pro');

    await chip.click();
    await page.getByTestId('plan-menu').getByRole('menuitem', { name: 'Switch back to Free' }).click();
    await page.getByRole('dialog', { name: 'Switch back to Free?' }).getByRole('button', { name: 'Switch to Free' }).click();
    await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.path === '/api/billing/downgrade').length).toBe(1);
    await expect(chip).toContainText('Free');
    await expect(page.getByText('You are on the Free plan.')).toBeVisible();
  });

  test('keyboard: Enter and Space open, arrows move, Escape closes and returns focus, Tab leaves, outside click closes', async ({ page }) => {
    const { chip } = await open(page, 'PRO');
    const menu = page.getByTestId('plan-menu');

    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    // The first item takes focus on open; the arrows move through the items.
    await expect(menu.getByRole('menuitem', { name: 'Compare plans' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Switch back to Free' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Compare plans' })).toBeFocused(); // wraps
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Switch back to Free' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(menu.getByRole('menuitem', { name: 'Compare plans' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Space');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);

    await chip.click();
    await expect(menu).toBeVisible();
    await page.getByRole('heading', { name: 'Booking rules' }).click({ force: true });
    await expect(menu).toHaveCount(0);

    // The chip toggles it too.
    await chip.click();
    await expect(menu).toBeVisible();
    await chip.click();
    await expect(menu).toHaveCount(0);
  });

  for (const width of [320, 360, 390, 768, 1440]) {
    test(`the header stays tidy at ${width}: title, chip (and Save) on one row, nothing overlaps or overflows`, async ({ page }) => {
      const { chip } = await open(page, 'PRO', width);
      const title = page.getByRole('heading', { level: 1, name: 'Business settings' });
      await expect(title).toBeVisible();
      const t = await box(title);
      const c = await box(chip);
      expect(c.x, 'chip is next to the title, not under it').toBeGreaterThanOrEqual(t.x + t.width - 1);
      expect(Math.abs(c.y + c.height / 2 - (t.y + t.height / 2)), 'same row').toBeLessThan(26);
      expect(c.x + c.width).toBeLessThanOrEqual(width);
      const save = page.getByRole('banner').getByRole('button', { name: 'Save settings' });
      if (await save.isVisible()) {
        const s = await box(save);
        expect(s.x >= c.x + c.width - 1 || s.x + s.width <= c.x + 1, 'Save does not overlap the chip').toBe(true);
      }
      // Phones show "Pro" only; the TEST MODE tag moves into the menu.
      if (width < 640) {
        await expect(chip.getByText('TEST MODE')).toBeHidden();
        await chip.click();
        await expect(page.getByTestId('plan-menu')).toContainText('TEST MODE');
      } else {
        await expect(chip.getByText('TEST MODE')).toBeVisible();
      }
      await expectNoPageOverflow(page);
    });
  }

  test('Arabic: right to left, the chip still opens the menu', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    const { chip } = await open(page, 'FREE', 390);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(chip).toContainText('مجاني');
    await chip.click();
    await expect(page.getByTestId('plan-menu').getByRole('menuitem')).toHaveCount(2);
    await expectNoPageOverflow(page);
  });
});
