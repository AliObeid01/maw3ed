import { expect, test } from '../helpers/test';
import { expectNoPageOverflow } from '../helpers/layout';
import { pickerText, selectOption } from '../helpers/pickers';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';

// PR-1: category, area and address in Settings, and the listing rule on the Share page. Every /api call is answered
// by page.route (see helpers/mockApi.ts, whose PATCH /api/business applies the same rules as businessService).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const patchBody = (calls: { method: string; path: string; body?: unknown }[]) =>
  calls.filter((c) => c.method === 'PATCH' && c.path === '/api/business').map((c) => c.body);

test.describe('Settings: business profile', () => {
  test('sets category, area and address from the fixed lists and saves them', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/settings');
    await expect(page.getByLabel('Name')).toHaveValue('Studio Nour');
    await expect(page.getByLabel('Address')).toHaveAccessibleDescription(
      'Street and building, e.g. Riad El Solh St',
    );

    await selectOption(page, 'Category', 'Hair salons');
    await selectOption(page, 'Area', 'Sidon');
    await page.getByLabel('Address').fill('  Riad El Solh St  ');
    await page.getByRole('button', { name: 'Save settings' }).last().click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible();

    expect(patchBody(calls).at(-1)).toMatchObject({
      category: 'hair-salons',
      area: 'sidon',
      address: 'Riad El Solh St',
    });
    expect(await pickerText(page, 'Category')).toBe('Hair salons');
    expect(await pickerText(page, 'Area')).toBe('Sidon');
    await expect(page.getByLabel('Address')).toHaveValue('Riad El Solh St');
  });

  test('offers exactly the seven areas and the seven categories', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/settings');
    await page.getByRole('combobox', { name: 'Area' }).click();
    await expect(page.getByRole('option')).toHaveText([
      'Sidon',
      'Beirut',
      'Tripoli',
      'Jounieh',
      'Tyre',
      'Zahle',
      'Other',
    ]);
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Category' }).click();
    await expect(page.getByRole('option')).toHaveText([
      'Barbers',
      'Hair salons',
      'Dental clinics',
      'Beauty clinics',
      'Spa & massage',
      'Physiotherapy',
      'Other',
    ]);
  });

  test('rejects an address over 120 characters locally, with an inline error', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/settings');
    await page.getByLabel('Address').fill('x'.repeat(121));
    await page.getByRole('button', { name: 'Save settings' }).last().click();
    await expect(page.getByText('Keep the address under 120 characters.')).toBeVisible();
    await expect(page.getByLabel('Address')).toHaveAttribute('aria-invalid', 'true');
    expect(patchBody(calls)).toEqual([]);
  });

  test('shows the server field errors under the right inputs', async ({ page }) => {
    await mockSetupApi(page, {
      state: defaultState(),
      override: async (route, method, path) => {
        if (path !== '/api/business' || method !== 'PATCH') return false;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'VALIDATION_FAILED', message: 'x', fields: { area: 'bad', address: 'bad' } },
          }),
        });
        return true;
      },
    });
    await page.goto('/app/settings');
    await page.getByLabel('Address').fill('Somewhere');
    await page.getByRole('button', { name: 'Save settings' }).last().click();
    await expect(page.getByText('Some details need another look')).toBeVisible();
    await expect(page.getByText('Please check this value.')).toHaveCount(2);
  });

  test('a legacy free-text category shows as "Current" and is never written back', async ({ page }) => {
    const state = defaultState();
    state.business.category = 'Hair salon';
    const { calls } = await mockSetupApi(page, { state });
    await page.goto('/app/settings');
    expect(await pickerText(page, 'Category')).toBe('Current: Hair salon');

    await page.getByLabel('Booking window').fill('45');
    await page.getByRole('button', { name: 'Save settings' }).last().click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible();
    expect(patchBody(calls).at(-1)).not.toHaveProperty('category');
    expect(patchBody(calls).at(-1)).not.toHaveProperty('area');
    expect(await pickerText(page, 'Category')).toBe('Current: Hair salon');

    await selectOption(page, 'Category', 'Barbers');
    await page.getByRole('button', { name: 'Save settings' }).last().click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved' })).toBeVisible();
    expect(patchBody(calls).at(-1)).toMatchObject({ category: 'barbers' });
    expect(await pickerText(page, 'Category')).toBe('Barbers');
  });

  test('has no horizontal overflow and 44 px fields at the current width', async ({ page }) => {
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/settings');
    await expect(page.getByLabel('Address')).toBeVisible();
    await expectNoPageOverflow(page);
    for (const name of ['Category', 'Area']) {
      const box = (await page.getByRole('combobox', { name }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    expect((await page.getByLabel('Address').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('Arabic: right to left, translated lists, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockSetupApi(page, { state: defaultState() });
    await page.goto('/app/settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('combobox', { name: 'المنطقة', exact: true }).click();
    await expect(page.getByRole('option')).toHaveText([
      'صيدا',
      'بيروت',
      'طرابلس',
      'جونية',
      'صور',
      'زحلة',
      'أخرى',
    ]);
    await page.keyboard.press('Escape');
    await selectOption(page, 'الفئة', 'صالونات الشعر');
    await expect(page.getByLabel('العنوان')).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

test.describe('Share: the listing needs a category and an area', () => {
  const readyState = () => {
    const state = defaultState();
    state.business.setup = { hasServices: true, hasBookableStaff: true, hasHours: true };
    return state;
  };

  test('turning it on without them fails with the message and a link to the fields', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: readyState() });
    await page.goto('/app/share');
    await expect(
      page.getByText('Choose a category and an area in your business settings before listing.'),
    ).toBeVisible();
    await page.getByRole('switch').click();
    const alert = page.getByRole('alert').filter({ hasText: 'Choose a category and an area first' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Open business settings' })).toHaveAttribute(
      'href',
      '/app/settings#business-profile',
    );
    expect(patchBody(calls)).toEqual([{ listed: true }]);
    await expect(page.getByRole('switch')).not.toBeChecked();
    expect((await alert.getByRole('link').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoPageOverflow(page);
  });

  test('works once category and area are set', async ({ page }) => {
    const state = readyState();
    state.business.category = 'barbers';
    state.business.area = 'tyre';
    await mockSetupApi(page, { state });
    await page.goto('/app/share');
    await expect(page.getByText('in your business settings before listing')).toHaveCount(0);
    await page.getByRole('switch').click();
    await expect(page.getByRole('status').filter({ hasText: 'Your business is now listed' })).toBeVisible();
  });
});
