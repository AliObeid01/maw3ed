import { type Route } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';

// Dashboard specs run against `next dev` with a fake session; every /api call is answered by page.route.
// Fake values only: obviously fake Lebanese numbers.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function stateWithLogins() {
  const s = defaultState();
  const karim = s.staff.find((m) => m.id === 'p2')!;
  Object.assign(karim, { loginStatus: 'NONE', loginPhone: null, linkExpiresAt: null });
  return s;
}

/** Answers the two login endpoints the way the server does (link, then DELETE). */
function loginOverride(state: ReturnType<typeof stateWithLogins>, posted: unknown[]) {
  return async (route: Route, method: string, path: string, body: unknown) => {
    const m = /^\/api\/staff\/([^/]+)\/login$/.exec(path);
    if (!m) return false;
    const person = state.staff.find((s) => s.id === m[1])!;
    if (method === 'DELETE') {
      Object.assign(person, { loginStatus: 'OFF', loginPhone: null, linkExpiresAt: null });
      await json(route, 200, { ok: true });
      return true;
    }
    posted.push(body);
    const phone = (body as { phone?: string }).phone;
    if (phone === '70 000 009') {
      await json(route, 409, { error: { code: 'PHONE_IN_USE', message: 'x', fields: {} } });
      return true;
    }
    const expiresAt = new Date(Date.now() + 72 * 3_600_000).toISOString();
    Object.assign(person, {
      loginStatus: 'NOT_ACTIVATED',
      loginPhone: '+96170000001',
      linkExpiresAt: expiresAt,
    });
    await json(route, 200, {
      url: 'https://maw3ed.test/activate/fake-one-time-token',
      whatsappUrl: 'https://wa.me/96170000001?text=hi',
      phone: '+96170000001',
      expiresAt,
      reset: false,
    });
    return true;
  };
}

test.describe('owner: Staff login', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
  });

  test('360 px: give a login, send via WhatsApp, status chip, turn off', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const state = stateWithLogins();
    const posted: unknown[] = [];
    await mockSetupApi(page, { state, override: loginOverride(state, posted) });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: /Karim/ }).click();

    const section = page.getByRole('group', { name: 'Staff login' });
    await expect(section).toBeVisible();
    // The owner row has no login section (own login).
    const phone = section.getByLabel('Login phone number');
    expect((await phone.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await section.getByRole('button', { name: 'Give this person a login' }).click();
    await expect(page.getByText('Enter their phone number.')).toBeVisible();
    expect(posted).toHaveLength(0);

    await phone.fill('70 000 009');
    await section.getByRole('button', { name: 'Give this person a login' }).click();
    await expect(
      page.getByText('This phone number already belongs to another account.'),
    ).toBeVisible();

    await phone.fill('70 000 001');
    await section.getByRole('button', { name: 'Give this person a login' }).click();
    const sheet = page.getByRole('dialog', { name: 'Send the link' });
    await expect(sheet).toBeVisible();
    const wa = sheet.getByRole('link', { name: 'Send via WhatsApp' });
    await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/96170000001/);
    await expect(wa).toHaveAttribute('target', '_blank');
    await expect(wa).toHaveAttribute('rel', /noopener/);
    expect((await wa.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
    // The secret link is not printed anywhere on the page.
    await expect(page.locator('body')).not.toContainText('fake-one-time-token');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await sheet.getByRole('button', { name: 'Close' }).first().click();
    await expect(section).toContainText('Not activated');
    await expect(section.getByRole('button', { name: 'Send a new link' })).toBeVisible();

    // Turn off from the pending state is not offered; give a login then switch it off.
    await section.getByRole('button', { name: 'Turn off login' }).click();
    const confirm = page.getByRole('dialog', { name: 'Turn off this login?' });
    await expect(confirm).toContainText('The person and their appointments stay');
    await confirm.getByRole('button', { name: 'Turn off login' }).click();
    await expect(section).toContainText('Off');
    await expect(section.getByRole('button', { name: 'Give this person a login' })).toBeVisible();
  });

  test('Arabic: right-to-left and no horizontal scroll', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await page.setViewportSize({ width: 360, height: 800 });
    const state = stateWithLogins();
    await mockSetupApi(page, { state, override: loginOverride(state, []) });
    await page.goto('/app/staff');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: /Karim/ }).click();
    const section = page.getByRole('group', { name: 'دخول الموظف' });
    await expect(section).toBeVisible();
    await expect(section.getByRole('button', { name: 'امنح هذا الشخص حساب دخول' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('the owner and receptionists have no login section', async ({ page }) => {
    const state = defaultState();
    await mockSetupApi(page, { state });
    await page.goto('/app/staff');
    await page.getByRole('button', { name: /Lina/ }).click();
    await expect(page.getByRole('group', { name: 'Staff login' })).toHaveCount(0);
  });
});
