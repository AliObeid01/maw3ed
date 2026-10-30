import { expect, test } from '@playwright/test';
import { defaultState, mockSetupApi, setRole, type MockState } from '../helpers/mockApi';

// Dashboard specs run against `next dev` with a fake session (see playwright.config.ts); every /api call is
// answered by page.route, so no database is needed.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

/** Staff with no receptionist login, so "Invite your receptionist" stays open. */
function freshState(flags: Partial<MockState['business']['setup']> = {}): MockState {
  const state = defaultState();
  state.staff = state.staff.filter((s) => s.role !== 'STAFF');
  state.business.setup = { hasServices: true, hasBookableStaff: false, hasHours: false, ...flags };
  return state;
}

test.describe('3.4 setup checklist', () => {
  test('reflects the setup flags, counts progress and marks the first open step as current', async ({
    page,
  }) => {
    await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/setup');

    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    await expect(page.getByText('2 of 6 done')).toBeVisible();
    await expect(page.getByText('5 services added')).toBeVisible();

    const current = page.getByRole('link', { name: /Staff and who does what/ });
    await expect(current).toHaveAttribute('aria-current', 'step');
    await expect(current).toContainText('Next step');
    await expect(current).toHaveAttribute('href', '/app/staff');
    // Finished steps are marked done for assistive tech, open ones are not.
    await expect(page.getByRole('main').getByRole('link', { name: /Services/ })).toContainText(
      '(done)',
    );
    await expect(page.getByRole('link', { name: /Working hours/ })).not.toContainText('(done)');
  });

  test('moves on when the flags change', async ({ page }) => {
    await mockSetupApi(page, {
      state: freshState({ hasBookableStaff: true, hasHours: true }),
    });
    await page.goto('/app/setup');
    await expect(page.getByText('4 of 6 done')).toBeVisible();
    await expect(page.getByRole('link', { name: /Share your booking link/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByRole('link', { name: /Staff and who does what/ })).not.toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  test('shows an error with retry when the business cannot be loaded', async ({ page }) => {
    let failing = true;
    await mockSetupApi(page, {
      state: freshState(),
      override: async (route, _method, path) => {
        if (path !== '/api/business') return false;
        if (failing) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'INTERNAL' } }),
          });
          return true;
        }
        return false;
      },
    });
    await page.goto('/app/setup');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }),
    ).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('2 of 6 done')).toBeVisible();
  });
});

test.describe('3.5 services', () => {
  test('adds a service and shows it in the list', async ({ page }) => {
    const { calls, state } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/services');
    await expect(page.getByRole('button', { name: 'Edit Haircut' })).toBeVisible();

    await page.getByRole('button', { name: 'Add service' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Kids haircut');
    await page.getByLabel('Duration').selectOption('20');
    await page.getByLabel('Buffer after').selectOption('5');
    await page.getByLabel(/^Price/).fill('12,50');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Edit Kids haircut' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Kids haircut added');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/services');
    expect(post?.body).toEqual({
      name: 'Kids haircut',
      durationMin: 20,
      bufferMin: 5,
      price: 12.5,
    });
    expect(state.services.map((s) => s.name)).toContain('Kids haircut');
  });

  test('validates the name before calling the API', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/services');
    await page.getByRole('button', { name: 'Add service' }).first().click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Enter a name for this service.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('shows a translated message for a server validation error, never the raw text', async ({
    page,
  }) => {
    await mockSetupApi(page, {
      state: freshState(),
      override: async (route, method, path) => {
        if (method !== 'POST' || path !== '/api/services') return false;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'RAW_SERVER_TEXT',
              fields: { name: 'RAW_FIELD_TEXT' },
            },
          }),
        });
        return true;
      },
    });
    await page.goto('/app/services');
    await page.getByRole('button', { name: 'Add service' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Cut');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Please check this value.')).toBeVisible();
    await expect(page.getByText('RAW_SERVER_TEXT')).toHaveCount(0);
    await expect(page.getByText('RAW_FIELD_TEXT')).toHaveCount(0);
  });

  test('toggling active sends a PATCH and keeps the row', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/services');
    const toggle = page.getByRole('switch', { name: 'Haircut active' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/services/s1');
    expect(patch?.body).toEqual({ active: false });
  });
});

test.describe('3.7 hours and time off', () => {
  test('flags overlapping hours in the day editor, blocks Apply, and saves once fixed', async ({
    page,
  }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/hours');
    await page.getByRole('button', { name: /Edit Monday, 09:00 to 13:00/ }).click();

    const dialog = page.getByRole('dialog');
    const opens = dialog.getByLabel('Opens');
    await opens.nth(1).fill('12:00');
    await expect(dialog.getByText('These hours overlap.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await expect(opens.nth(1)).toHaveAttribute('aria-invalid', 'true');

    await opens.nth(1).fill('14:00');
    await expect(dialog.getByText('These hours overlap.')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Tue' }).click();
    await dialog.getByLabel('Closes').first().fill('12:30');
    await dialog.getByRole('button', { name: 'Apply' }).click();

    // Monday and the copied Tuesday both read 09:00 - 12:30 now.
    await expect(page.getByRole('button', { name: /Edit Monday, 09:00 to 12:30/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit Tuesday, 09:00 to 12:30/ })).toBeVisible();

    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByRole('status')).toContainText('Hours saved');
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/api/staff/p1/hours');
    const intervals = (put?.body as { intervals: Array<Record<string, unknown>> }).intervals;
    expect(intervals).toContainEqual({ weekday: 1, startLocal: '09:00', endLocal: '12:30' });
    expect(intervals).toContainEqual({ weekday: 2, startLocal: '09:00', endLocal: '12:30' });
    expect(intervals).toContainEqual({ weekday: 1, startLocal: '14:00', endLocal: '19:00' });
  });

  test('adds time off converted to UTC with the business timezone', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/hours');
    await page.getByLabel('From', { exact: true }).fill('2036-07-10T09:00');
    await page.getByLabel('To', { exact: true }).fill('2036-07-10T12:00');
    await page.getByRole('button', { name: 'Add time off' }).click();
    await expect(page.getByText(/Thu, Jul 10 · 09:00 – 12:00/)).toBeVisible();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/staff/p1/time-off');
    // Beirut is UTC+3 in July.
    expect(post?.body).toEqual({
      startAt: '2036-07-10T06:00:00Z',
      endAt: '2036-07-10T09:00:00Z',
      reason: 'VACATION',
    });
  });

  test('rejects an end before the start without calling the API', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/hours');
    await page.getByLabel('From', { exact: true }).fill('2036-07-10T12:00');
    await page.getByLabel('To', { exact: true }).fill('2036-07-10T09:00');
    await page.getByRole('button', { name: 'Add time off' }).click();
    await expect(page.getByText('The end must be after the start.')).toBeVisible();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

test.describe('3.6 staff', () => {
  test('invite sheet sends a Staff invite and shows the accept link only when the API returns one', async ({
    page,
  }) => {
    const { calls } = await mockSetupApi(page, {
      state: freshState(),
      override: async (route, method, path, body) => {
        if (method !== 'POST' || path !== '/api/invites') return false;
        const email = (body as { email: string }).email;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'i1',
            email,
            role: 'STAFF',
            expiresAt: '2036-11-12T10:00:00Z',
            ...(email.startsWith('dev') ? { acceptUrl: 'http://localhost/invite/abc' } : {}),
          }),
        });
        return true;
      },
    });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: 'Invite receptionist' }).click();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();

    await page.getByLabel('Email').fill('rana@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText('Invite sent to rana@example.com.')).toBeVisible();
    await expect(page.getByText('http://localhost/invite/abc')).toHaveCount(0);
    expect(calls.find((c) => c.path === '/api/invites' && c.method === 'POST')?.body).toEqual({
      email: 'rana@example.com',
      role: 'STAFF',
    });
  });

  test('shows the dev accept link with a copy button when present', async ({ page }) => {
    await mockSetupApi(page, {
      state: freshState(),
      override: async (route, method, path, body) => {
        if (method !== 'POST' || path !== '/api/invites') return false;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'i1',
            email: (body as { email: string }).email,
            role: 'STAFF',
            expiresAt: '2036-11-12T10:00:00Z',
            acceptUrl: 'http://localhost/invite/abc',
          }),
        });
        return true;
      },
    });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: 'Invite receptionist' }).click();
    await page.getByLabel('Email').fill('dev@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText('http://localhost/invite/abc')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
  });

  test('deactivating someone with future appointments shows the translated conflict', async ({
    page,
  }) => {
    await mockSetupApi(page, {
      state: freshState(),
      override: async (route, method, path) => {
        if (method !== 'PATCH' || path !== '/api/staff/p2') return false;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'HAS_FUTURE_APPOINTMENTS', message: 'RAW' } }),
        });
        return true;
      },
    });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: /^Karim/ }).click();
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.locator('[data-form-banner]')).toContainText(
      'Karim has upcoming appointments',
    );
    await expect(page.getByText('RAW')).toHaveCount(0);
  });

  test('saving edits sends the name, bookable flag and services', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: /^Karim/ }).click();
    await page.getByLabel('Display name').fill('Karim A.');
    await page.getByRole('button', { name: 'Beard trim' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Karim A. saved' }).first(),
    ).toBeVisible();
    expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/staff/p2')?.body).toEqual({
      displayName: 'Karim A.',
      bookable: true,
    });
    expect(
      calls.find((c) => c.method === 'PUT' && c.path === '/api/staff/p2/services')?.body,
    ).toEqual({
      serviceIds: ['s1', 's2', 's3', 's4'],
    });
  });
});

test.describe('3.8 settings', () => {
  test('saves rules with the cutoff converted from hours to minutes', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/settings');
    await expect(page.getByLabel('Cancellation cutoff')).toHaveValue('24');
    await page.getByRole('radio', { name: '30 min' }).click();
    await page.getByLabel('Cancellation cutoff').fill('48');
    await page.getByRole('button', { name: 'Save settings' }).last().click();
    await expect(page.getByRole('status')).toContainText('Settings saved');
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/business');
    expect(patch?.body).toMatchObject({ slotStepMin: 30, cancelCutoffMin: 2880, minNoticeMin: 60 });
  });

  test('rejects an out-of-range booking window locally', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: freshState() });
    await page.goto('/app/settings');
    await page.getByLabel('Booking window').fill('400');
    await page.getByRole('button', { name: 'Save settings' }).last().click();
    await expect(page.getByText('Enter a whole number from 1 to 365.')).toBeVisible();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

test('the service active switch is a 44 px tap target', async ({ page }) => {
  await mockSetupApi(page, { state: freshState() });
  await page.goto('/app/services');
  const toggle = page.getByRole('switch').first();
  await expect(toggle).toBeVisible();
  const box = (await toggle.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
});
