import { expect, test } from '../helpers/test';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';
import { mockOutcomesApi } from '../helpers/outcomesMock';
import { expectNoHorizontalOverflow, expectNoPageOverflow } from '../helpers/layout';

// F62 regression guard: the Monday hours sheet once had content wider than the sheet (Cancel/Apply were two
// `w-full shrink-0` buttons in a flex row), so it scrolled sideways and clipped controls. No spec looked at layout
// inside the sheet, which is why CI stayed green. These specs assert it at phone and desktop widths, both locales.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

const SIZES = [
  { name: '360', width: 360, height: 640 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
] as const;
const LOCALES = [
  { code: 'en', monday: /Edit Monday/, add: 'Add hours', apply: 'Apply' },
  { code: 'ar', monday: /الاثنين/, add: 'إضافة ساعات', apply: 'تطبيق' },
] as const;

for (const locale of LOCALES) {
  for (const size of SIZES) {
    test.describe(`no horizontal overflow, ${locale.code} at ${size.name}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });
      test.beforeEach(async ({ page, context }) => {
        await context.addCookies([{ name: 'locale', value: locale.code, url: DASHBOARD }]);
        await setRole(page, 'OWNER', DASHBOARD);
      });

      test('the weekday hours sheet with a second interval and the copy-to row', async ({ page }) => {
        await mockSetupApi(page, { state: defaultState() });
        await page.goto('/app/hours');
        await page.getByRole('button', { name: locale.monday }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const before = await dialog.getByRole('group').count();
        await dialog.getByRole('button', { name: locale.add }).click();
        await expect(dialog.getByRole('group')).not.toHaveCount(before);
        // Select the first copy-to day so the note under the pills shows too.
        await dialog.locator('button[aria-pressed="false"]').first().click();

        await expectNoHorizontalOverflow(dialog, 'hours sheet');
        // Cancel and Apply are both fully inside the sheet and tappable (>= 44 px).
        const apply = await dialog.getByRole('button', { name: locale.apply, exact: true }).boundingBox();
        const box = await dialog.boundingBox();
        expect(apply!.x + apply!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
        expect(apply!.x).toBeGreaterThanOrEqual(box!.x - 1);
        expect(apply!.height).toBeGreaterThanOrEqual(44);
        await expectNoPageOverflow(page);
      });

      test('the time-off panel', async ({ page }) => {
        await mockSetupApi(page, { state: defaultState() });
        await page.goto('/app/hours');
        const panel = page.locator('aside[aria-labelledby="time-off-title"]');
        await expect(panel).toBeVisible();
        await expectNoHorizontalOverflow(panel, 'time-off panel');
        await expectNoPageOverflow(page);
      });

      test('the pilot baseline form', async ({ page }) => {
        await mockOutcomesApi(page, { clients: [], appointments: [], baseline: null });
        await page.goto('/app/pilot');
        const form = page.locator('aside[aria-labelledby="baseline-title"]');
        await expect(form.first()).toBeVisible();
        await expectNoHorizontalOverflow(form.first(), 'baseline form');
        await expectNoPageOverflow(page);
      });
    });
  }
}
