import type { Page } from '@playwright/test';
import { mergeWeekIntervals } from '../../../src/lib/setup/hoursMerge';
import { expect, test } from '../helpers/test';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';
import { expectNoHorizontalOverflow, expectNoPageOverflow } from '../helpers/layout';
import { pickTime } from '../helpers/pickers';

// PR-3: touching hours blocks merge, and the owner can copy a week to other staff (mocked API).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

type Call = { method: string; path: string; body?: unknown };
const putBody = (calls: Call[]) =>
  (calls.find((c) => c.method === 'PUT' && c.path === '/api/staff/p1/hours')?.body as {
    intervals: Array<{ weekday: number; startLocal: string; endLocal: string }>;
  }).intervals;

async function openDay(page: Page, day: string) {
  await page.getByRole('button', { name: new RegExp(`Edit or add hours on ${day}`) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('merge touching blocks', () => {
  test('Apply joins 10:00-18:00 and 18:00-22:00 into ONE block, and Save sends one interval', async ({ page }) => {
    const { calls } = await mockSetupApi(page);
    await page.goto('/app/hours');
    const dialog = await openDay(page, 'Wednesday');
    await dialog.getByRole('button', { name: 'Add hours' }).click();
    await pickTime(page, 'Opens', '18:00', { within: dialog, nth: 1 });
    await pickTime(page, 'Closes', '22:00', { within: dialog, nth: 1 });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    const chips = page.getByRole('button', { name: /^Edit Wednesday, / });
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAccessibleName('Edit Wednesday, 10:00 to 22:00');
    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByRole('status')).toContainText('Hours saved');
    expect(putBody(calls).filter((i) => i.weekday === 3)).toEqual([
      { weekday: 3, startLocal: '10:00', endLocal: '22:00' },
    ]);
    await expectNoPageOverflow(page);
  });

  test('a real break stays two blocks', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/hours');
    // Monday is 09:00-13:00 and 14:00-19:00 in the mock: a one hour break.
    await expect(page.getByRole('button', { name: /^Edit Monday, / })).toHaveCount(2);
    const dialog = await openDay(page, 'Monday');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('button', { name: /^Edit Monday, / })).toHaveCount(2);
  });

  test('closing the break (second block opens where the first closes) merges on Apply', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/hours');
    const dialog = await openDay(page, 'Monday');
    await pickTime(page, 'Opens', '13:00', { within: dialog, nth: 1 });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    const chips = page.getByRole('button', { name: /^Edit Monday, / });
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAccessibleName('Edit Monday, 09:00 to 19:00');
  });

  test('hours already stored as touching blocks are shown merged when the week loads', async ({ page }) => {
    const state = defaultState();
    state.hours['p1'] = [
      { weekday: 3, startLocal: '09:00', endLocal: '17:00' },
      { weekday: 3, startLocal: '17:00', endLocal: '22:00' },
    ];
    await mockSetupApi(page, { state });
    await page.goto('/app/hours');
    const chips = page.getByRole('button', { name: /^Edit Wednesday, / });
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toHaveAccessibleName('Edit Wednesday, 09:00 to 22:00');
    // Nothing to save until the owner changes something.
    await expect(page.getByRole('button', { name: 'Save hours', disabled: false })).toHaveCount(0);
  });

  test('the midnight split across two days is not merged', async ({ page }) => {
    const state = defaultState();
    state.hours['p1'] = [
      { weekday: 1, startLocal: '09:00', endLocal: '24:00' },
      { weekday: 2, startLocal: '00:00', endLocal: '02:00' },
    ];
    await mockSetupApi(page, { state });
    await page.goto('/app/hours');
    await expect(page.getByRole('button', { name: 'Edit Monday, 09:00 to 24:00' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit Tuesday/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Edit Tuesday/ })).toContainText('02:00');
  });
});

test.describe('copy this week to other staff', () => {
  test('lists only the other schedulable staff, warns, and copies with one request', async ({ page }) => {
    const { calls, state } = await mockSetupApi(page);
    state.hours['p2'] = [{ weekday: 0, startLocal: '08:00', endLocal: '09:00' }];
    await page.goto('/app/hours');
    const button = page.getByRole('button', { name: 'Copy this week to other staff' });
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Copy this week to other staff' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('This replaces the weekly hours of the selected people. Their time off is not changed.');
    // Lina is the source, Rana is not bookable: only Karim and Jad are offered.
    await expect(dialog.getByRole('checkbox')).toHaveCount(3);
    await expect(dialog.getByRole('checkbox', { name: 'Karim' })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Jad' })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Lina' })).toHaveCount(0);
    const apply = dialog.getByRole('button', { name: 'Copy hours' });
    await expect(apply).toBeDisabled();
    for (const box of await dialog.getByRole('checkbox').all()) {
      const size = (await box.locator('xpath=ancestor::label').boundingBox())!;
      // 44 px CSS (min-h-11): the Pixel 5 emulation (device pixel ratio 2.625) can report 43.99997, so allow a half pixel
      // like the other tap-target checks (43.5).
      expect(size.height).toBeGreaterThanOrEqual(43.5);
    }
    await expectNoHorizontalOverflow(dialog, 'copy sheet');

    await dialog.getByRole('checkbox', { name: 'Select all' }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Karim' })).toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Jad' }).uncheck();
    await expect(dialog.getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Jad' }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Select all' })).toBeChecked();
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Hours copied to 2 people');
    const copies = calls.filter((c) => c.method === 'POST' && c.path === '/api/staff/p1/hours/copy');
    expect(copies).toHaveLength(1);
    expect(copies[0]!.body).toEqual({ targetStaffIds: ['p2', 'p3'] });
    expect(mergeWeekIntervals(state.hours['p2']!)).toEqual(mergeWeekIntervals(state.hours['p1']!));
    // Time off of the target is not touched by the request.
    expect(calls.some((c) => c.path.includes('time-off') && c.method !== 'GET')).toBe(false);
  });

  test('a failed copy keeps the sheet open with an error and lets the owner retry', async ({ page }) => {
    let fail = true;
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (method === 'POST' && path.endsWith('/hours/copy') && fail) {
          fail = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x', fields: {} } }),
          });
          return true;
        }
        return false;
      },
    });
    await page.goto('/app/hours');
    await page.getByRole('button', { name: 'Copy this week to other staff' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Karim' }).check();
    await dialog.getByRole('button', { name: 'Copy hours' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy hours' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Copy hours' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('unsaved edits disable the button and say why', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/hours');
    const dialog = await openDay(page, 'Wednesday');
    await pickTime(page, 'Closes', '19:00', { within: dialog });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('button', { name: 'Copy this week to other staff' })).toBeDisabled();
    await expect(page.getByText('Save your changes first. Only saved hours are copied.')).toBeVisible();
  });

  test('a business with a single schedulable person has no copy button', async ({ page }) => {
    const state = defaultState();
    state.staff = state.staff.filter((m) => m.id === 'p1');
    await mockSetupApi(page, { state });
    await page.goto('/app/hours');
    await expect(page.getByRole('heading', { name: 'Weekly hours' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy this week to other staff' })).toHaveCount(0);
  });

  test('Arabic and RTL: the sheet fits and the rows are tappable', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockSetupApi(page);
    await page.goto('/app/hours');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: 'نسخ هذا الأسبوع إلى فريق آخر' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('لن تتغير إجازاتهم');
    await expectNoHorizontalOverflow(dialog, 'copy sheet (ar)');
    const box = await dialog.getByRole('checkbox', { name: 'تحديد الكل' }).locator('xpath=ancestor::label').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectNoPageOverflow(page);
  });
});
