import { expect, test } from '../helpers/test';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const saveSettings = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Save settings' }).last();

test.describe('settings: cancellation cutoff unit stays put after a save', () => {
  test('90 min -> type 120 -> save keeps minutes, and a later save sends the same minutes', async ({
    page,
  }) => {
    const state = defaultState();
    state.business.cancelCutoffMin = 90;
    const { calls } = await mockSetupApi(page, { state });
    await page.goto('/app/settings');

    const cutoff = page.getByLabel('Cancellation cutoff');
    const unit = cutoff.locator('xpath=following-sibling::span');
    await expect(cutoff).toHaveValue('90');
    await expect(unit).toHaveText('min');

    await cutoff.fill('120');
    await saveSettings(page).click();
    await expect(page.getByRole('status')).toContainText('Settings saved');
    // The server now stores 120, a whole number of hours; the form must NOT flip to "120 hours".
    await expect(cutoff).toHaveValue('120');
    await expect(unit).toHaveText('min');

    await page.getByLabel('Name', { exact: true }).fill('Studio Nour 2');
    await saveSettings(page).click();
    await expect(page.getByRole('status')).toContainText('Settings saved');

    const patches = calls.filter((c) => c.method === 'PATCH' && c.path === '/api/business');
    expect(patches).toHaveLength(2);
    expect(patches[0]!.body).toMatchObject({ cancelCutoffMin: 120 });
    expect(patches[1]!.body).toMatchObject({ cancelCutoffMin: 120, name: 'Studio Nour 2' });
  });

  test('1440 minutes loads as 24 hours', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/settings');
    const cutoff = page.getByLabel('Cancellation cutoff');
    await expect(cutoff).toHaveValue('24');
    await expect(cutoff.locator('xpath=following-sibling::span')).toHaveText('hours');
  });
});

test.describe('services: the desktop panel resets', () => {
  test('after creating, the panel is empty and a second Save does not create a duplicate', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the panel is always mounted only at lg+; phones use a sheet');
    const { calls } = await mockSetupApi(page);
    await page.goto('/app/services');
    const name = page.getByLabel('Name', { exact: true });

    await name.fill('Kids haircut');
    await page.getByLabel(/^Price/).fill('9');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Kids haircut' })).toBeVisible();

    await expect(name).toHaveValue('');
    await expect(page.getByLabel(/^Price/)).toHaveValue('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Enter a name for this service.')).toBeVisible();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/services')).toHaveLength(1);
  });

  test('Cancel clears what was typed', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop panel only');
    await mockSetupApi(page);
    await page.goto('/app/services');
    const name = page.getByLabel('Name', { exact: true });
    await name.fill('Something');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(name).toHaveValue('');
  });

  test('two toggles in flight keep their own pending state', async ({ page }) => {
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (method === 'PATCH' && path.startsWith('/api/services/')) {
          await new Promise((r) => setTimeout(r, 800));
        }
        return false;
      },
    });
    await page.goto('/app/services');
    const a = page.getByRole('switch', { name: 'Haircut active' });
    const b = page.getByRole('switch', { name: 'Blow-dry active' });
    await a.click();
    await b.click();
    await expect(a).toHaveAttribute('aria-busy', 'true');
    await expect(b).toHaveAttribute('aria-busy', 'true');
    await expect(a).toHaveAttribute('aria-checked', 'false');
    await expect(b).toHaveAttribute('aria-checked', 'false');
    await expect(a).not.toHaveAttribute('aria-busy', 'true');
  });
});

test.describe('mid-session 401 on a mutation', () => {
  test('sends the owner to the sign-in page', async ({ page }) => {
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (method !== 'PATCH' || path !== '/api/services/s1') return false;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }),
        });
        return true;
      },
    });
    await page.goto('/app/services');
    await page.getByRole('switch', { name: 'Haircut active' }).click();
    await page.waitForURL('**/login');
  });
});

test.describe('staff: invites and partial saves', () => {
  test('inviting an existing member shows the already-a-member message', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/staff');
    await page.getByRole('button', { name: 'Invite receptionist' }).click();
    await page.getByLabel('Email').fill('Lina@Example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'That person already has a login for this business.',
    );
  });

  test('a PLAN_LIMIT on a new bookable member shows a friendly upgrade card, not a red error', async ({
    page,
  }) => {
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (method !== 'POST' || path !== '/api/staff') return false;
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'PLAN_LIMIT', message: 'limit', fields: {} } }),
        });
        return true;
      },
    });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: 'Add staff member' }).first().click();
    await page.getByLabel('Display name').fill('Dana');
    await page.getByRole('button', { name: 'Add staff member' }).last().click();
    const card = page.getByRole('alert').filter({ hasText: 'Your Free plan is full' });
    await expect(card).toBeVisible();
    const link = card.getByRole('link', { name: 'See plans' });
    await expect(link).toHaveAttribute('href', '/pricing');
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('a failed services step after a saved name still refreshes the list and shows the error', async ({
    page,
  }) => {
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (method !== 'PUT' || !path.endsWith('/services')) return false;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL' } }),
        });
        return true;
      },
    });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: /^Karim/ }).click();
    await page.getByLabel('Display name').fill('Karim B.');
    await page.getByRole('button', { name: 'Beard trim' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-form-banner]')).toContainText('Something went wrong');
    // The name change did save, so the list already shows it.
    await expect(page.getByRole('heading', { name: 'Edit Karim B.' })).toBeVisible();
  });

  test('a toast raised inside an open sheet is announced from the sheet itself', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: DASHBOARD });
    await mockSetupApi(page, {
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
    await page.getByLabel('Email').fill('new@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await page.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(page.getByRole('dialog').locator('.sr-only[role=status]')).toContainText(
      'Link copied',
    );
  });
});

test.describe('hours', () => {
  test('a server overlap error (400 fields.intervals) shows the translated banner', async ({
    page,
  }) => {
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (method !== 'PUT' || !path.endsWith('/hours')) return false;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'VALIDATION_ERROR', fields: { intervals: 'RAW_OVERLAP' } },
          }),
        });
        return true;
      },
    });
    await page.goto('/app/hours');
    await page.getByRole('button', { name: /Edit Monday, 09:00 to 13:00/ }).click();
    await page.getByRole('dialog').getByLabel('Closes').first().fill('12:30');
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Some hours overlap' })).toBeVisible();
    await expect(page.getByText('RAW_OVERLAP')).toHaveCount(0);
  });

  test('the mock enforces the real 6-per-day rule with 400 fields.intervals', async ({ page }) => {
    // Guards the mock itself: it must reject what the server rejects.
    await mockSetupApi(page);
    await page.goto('/app/hours');
    const status = await page.evaluate(async () => {
      const intervals = Array.from({ length: 7 }, (_, i) => ({
        weekday: 1,
        startLocal: `${String(i * 3).padStart(2, '0')}:00`,
        endLocal: `${String(i * 3 + 1).padStart(2, '0')}:00`,
      }));
      const res = await fetch('/api/staff/p1/hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervals }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(status.status).toBe(400);
    expect(status.body.error.fields.intervals).toMatch(/At most 6/);
  });

  test('adding time off while a delete is in flight does not resurrect the deleted item', async ({
    page,
  }) => {
    await mockSetupApi(page, {
      override: async (route, method, path) => {
        if (method === 'DELETE' && path.includes('/time-off/')) {
          await new Promise((r) => setTimeout(r, 1500));
        }
        return false;
      },
    });
    await page.goto('/app/hours');
    await page.getByRole('radio', { name: 'Karim' }).click();
    await expect(page.getByText(/all day/)).toBeVisible();

    await page.getByRole('button', { name: 'Remove time off' }).click();
    await page.getByLabel('From', { exact: true }).fill('2036-08-10T09:00');
    await page.getByLabel('To', { exact: true }).fill('2036-08-10T12:00');
    await page.getByRole('button', { name: 'Add time off' }).click();
    await expect(page.getByText(/09:00 – 12:00/)).toBeVisible();

    // The slow delete finishes after the add: the old entry is gone and the new one is still there.
    await expect(page.getByText(/all day/)).toHaveCount(0);
    await expect(page.getByText(/09:00 – 12:00/)).toBeVisible();
  });

  test('time off the server returns is shown as is (no client-side date filtering)', async ({
    page,
  }) => {
    const state = defaultState();
    state.timeOff.p1 = [
      {
        id: 'past1',
        startAt: '2019-12-31T22:00:00Z',
        endAt: '2020-01-01T22:00:00Z',
        reason: 'SICK',
      },
    ];
    await mockSetupApi(page, {
      state,
      override: async (route, method, path) => {
        if (method === 'GET' && path === '/api/staff/p1/time-off') {
          // Whatever the API sends (here a past entry) is rendered; the default query asks for no past items.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: state.timeOff.p1 }),
          });
          return true;
        }
        return false;
      },
    });
    await page.goto('/app/hours');
    await expect(page.getByText(/all day/)).toBeVisible();
  });
});

test.describe('radio groups use the ARIA keyboard pattern', () => {
  test('slot step: one tab stop, arrows move and select, Home/End jump', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/settings');
    const group = page.getByRole('radiogroup', { name: 'Time slots every' });
    const radios = group.getByRole('radio');
    await expect(radios).toHaveCount(3);
    // Roving tabindex: exactly the checked radio is tabbable.
    await expect(group.locator('[role=radio][tabindex="0"]')).toHaveText('15 min');

    await radios.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(2)).toBeFocused();
    await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Home');
    await expect(radios.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
  });

  test('staff switcher on Hours: arrow keys change the person shown', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/hours');
    const group = page
      .getByRole('radiogroup', { name: 'Whose hours' })
      .and(page.locator(':visible'));
    await expect(group.locator('[role=radio][tabindex="0"]')).toHaveText('Lina');
    await group.getByRole('radio', { name: 'Lina' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: 'Karim' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(group.getByRole('radio', { name: 'Karim' })).toBeFocused();
    await expect(page.getByText(/all day/)).toBeVisible();
  });
});
