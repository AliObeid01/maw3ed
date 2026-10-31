import { expect, test, type Page } from '@playwright/test';
import { nowMs } from '../helpers/clock';
import { defaultState, mockSetupApi, setRole, type MockState } from '../helpers/mockApi';

// Dashboard specs run against `next dev` with a fake session; every /api call is answered by page.route.
// The clock is the shared virtual one (helpers/clock.ts): invite dates derive from nowMs(), never the real time.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const DAY = 24 * 60 * 60 * 1000;

function state(): MockState {
  const s = defaultState();
  s.invites = [
    {
      id: 'i1',
      email: 'newhire@example.com',
      role: 'STAFF',
      expiresAt: new Date(nowMs() + 2 * DAY).toISOString(),
    },
  ];
  return s;
}

/** The section is collapsed on phones (a toggle with aria-expanded) and always open on desktop. */
async function openTeam(page: Page) {
  const section = page.getByRole('region', { name: 'Team access' });
  await expect(section).toBeVisible();
  const toggle = section.getByRole('button', { name: 'Team access' });
  if (await toggle.count()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(section.getByRole('list', { name: 'People with access' })).toBeVisible();
  return section;
}

test.describe('Staff > Team access', () => {
  test('lists people with role and verified marker; the own row has no remove action', async ({
    page,
  }) => {
    await mockSetupApi(page, { state: state() });
    await page.goto('/app/staff');
    const section = await openTeam(page);
    const rows = section.getByRole('list', { name: 'People with access' }).getByRole('listitem');
    await expect(rows).toHaveCount(3);

    const mine = rows.filter({ hasText: 'Lina' });
    await expect(mine).toContainText('(you)');
    await expect(mine).toContainText('Owner');
    await expect(mine).toContainText('Email verified');
    await expect(mine.getByRole('button')).toHaveCount(0);

    await expect(rows.filter({ hasText: 'Rana' })).toContainText('Staff');
    await expect(rows.filter({ hasText: 'Samir' })).toContainText('Email not verified');
    const remove = rows.filter({ hasText: 'Rana' }).getByRole('button', { name: 'Remove access' });
    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Revoke is a tap target too.
    const revokeBtn = section.getByRole('button', { name: /Revoke the invite/ });
    expect((await revokeBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('remove access: the confirmation says what happens, Cancel changes nothing, Confirm removes at once', async ({
    page,
  }) => {
    const { calls } = await mockSetupApi(page, { state: state() });
    await page.goto('/app/staff');
    const section = await openTeam(page);
    const rana = section
      .getByRole('list', { name: 'People with access' })
      .getByRole('listitem')
      .filter({ hasText: 'Rana' });

    await rana.getByRole('button', { name: /Remove access/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toContainText(/Remove access for .*Rana.*\?/);
    await expect(dialog).toContainText(
      'They will be signed out immediately and can no longer open the dashboard. They will also be hidden from your booking page, but their calendar entry and existing appointments are kept. You can make them bookable again in Staff.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(rana).toBeVisible();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    await rana.getByRole('button', { name: /Remove access/ }).click();
    await dialog.getByRole('button', { name: 'Remove access' }).click();
    // Toast first: it only lives 4 s, and the optimistic removal has already happened by then.
    await expect(page.getByText(/Access removed for .*Rana.*\./).first()).toBeVisible();
    await expect(rana).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
      '/api/team/members/u2',
    ]);
  });

  test('shows how many upcoming appointments remain on the removed person calendar', async ({ page }) => {
    const st = state();
    st.memberAppointments = { u2: 3 };
    await mockSetupApi(page, { state: st });
    await page.goto('/app/staff');
    const section = await openTeam(page);
    await section.getByRole('button', { name: /Remove access for Rana/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove access' }).click();
    await expect(section.getByText(/3 upcoming appointments remain on their calendar/)).toBeVisible();
    await expect(section.getByText(/is hidden from your booking page/)).toBeVisible();
  });

  test('a refused removal rolls the row back and says why', async ({ page }) => {
    await mockSetupApi(page, {
      state: state(),
      override: async (route, method, path) => {
        if (method !== 'DELETE' || path !== '/api/team/members/u2') return false;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'LAST_OWNER', message: 'x', fields: {} },
          }),
        });
        return true;
      },
    });
    await page.goto('/app/staff');
    const section = await openTeam(page);
    const rana = section
      .getByRole('list', { name: 'People with access' })
      .getByRole('listitem')
      .filter({ hasText: 'Rana' });
    await rana.getByRole('button', { name: /Remove access/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove access' }).click();
    await expect(page.getByText('A business must keep at least one owner.').first()).toBeVisible();
    await expect(rana).toBeVisible();
  });

  test('pending invites: listed with expiry, Revoke asks first, then removes the row', async ({
    page,
  }) => {
    const { calls } = await mockSetupApi(page, { state: state() });
    await page.goto('/app/staff');
    const section = await openTeam(page);
    const invite = section
      .getByRole('list', { name: 'Pending invites' })
      .getByRole('listitem')
      .filter({ hasText: 'newhire@example.com' });
    await expect(invite).toContainText(/Expires /);

    await invite.getByRole('button', { name: /Revoke/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText('Revoke this invite?');
    await expect(dialog).toContainText(/The link sent to .*newhire@example\.com.* stops working immediately\./);
    await dialog.getByRole('button', { name: 'Revoke invite' }).click();
    await expect(page.getByText('Invite revoked.').first()).toBeVisible();
    await expect(invite).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
      '/api/team/invites/i1',
    ]);
  });

  test('Invite someone opens the invite sheet', async ({ page }) => {
    await mockSetupApi(page, { state: state() });
    await page.goto('/app/staff');
    const section = await openTeam(page);
    await section.getByRole('button', { name: 'Invite someone' }).click();
    await expect(page.getByRole('dialog').getByLabel('Email')).toBeVisible();
  });
});

test.describe('Settings > Account: sign out other devices', () => {
  test('asks first, then reports how many devices were signed out', async ({ page }) => {
    const { calls } = await mockSetupApi(page, { state: state() });
    await page.goto('/app/settings');
    const card = page.getByRole('region', { name: 'Account' });
    await expect(card.getByText(/Signs you out everywhere else/)).toBeVisible();
    const open = card.getByRole('button', { name: 'Sign out other devices' });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      'Every other browser or phone signed in to your account will be signed out. This device stays signed in.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(calls.some((c) => c.path === '/api/auth/sign-out-others')).toBe(false);

    await open.click();
    await dialog.getByRole('button', { name: 'Sign out other devices' }).click();
    await expect(page.getByText('2 other devices were signed out.').first()).toBeVisible();
    await expect(card.getByText('2 other devices were signed out.')).toHaveText('2 other devices were signed out.');
    expect(calls.filter((c) => c.path === '/api/auth/sign-out-others')).toHaveLength(1);
  });
});

test.describe('Arabic', () => {
  test('Team access in RTL: Arabic confirmation, no horizontal scroll', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await mockSetupApi(page, { state: state() });
    await page.goto('/app/staff');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const section = page.getByRole('region', { name: 'صلاحيات الفريق' });
    await expect(section).toBeVisible();
    const toggle = section.getByRole('button', { name: 'صلاحيات الفريق' });
    if (await toggle.count()) await toggle.click();
    const rana = section
      .getByRole('list', { name: 'الأشخاص أصحاب الصلاحية' })
      .getByRole('listitem')
      .filter({ hasText: 'Rana' });
    const remove = rana.getByRole('button', { name: /إزالة صلاحية/ });
    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await remove.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('سيتم تسجيل خروجه فورًا');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'إزالة الصلاحية' }).click();
    await expect(rana).toHaveCount(0);
  });
});
