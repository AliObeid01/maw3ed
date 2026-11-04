import { type Page, type Route } from '@playwright/test';
import { expect, test } from './helpers/test';
import { freezeClock, nowMs } from './helpers/clock';

// Self-contained: every API call is answered by page.route, so no database or backend is needed.

const session = (role: string) => ({
  user: { id: 'u1', name: 'Lina', email: 'lina@example.com' },
  business: { id: 'b1', slug: 'studio-nour', name: 'Studio Nour', timezone: 'Asia/Beirut' },
  role,
});
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const invite = {
  businessName: 'Studio Nour',
  email: 'rana@example.com',
  role: 'STAFF',
  expiresAt: new Date(nowMs() + 6 * 86_400_000).toISOString(),
};

async function mockInvite(page: Page, accept: (route: Route) => unknown) {
  await freezeClock(page);
  await page.route('**/api/invites/tok', (route) => json(route, 200, invite));
  await page.route('**/api/invites/tok/accept', accept);
}

test.describe('autocomplete values', () => {
  test('login uses username + current-password', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name=email]')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('input[name=password]')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
  });

  test('signup uses new-password', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('input[name=password]')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    await expect(page.locator('input[name=email]')).toHaveAttribute('autocomplete', 'email');
  });

  test('invite pairs the read-only email as username with a new-password field', async ({
    page,
  }) => {
    await mockInvite(page, (route) => json(route, 200, session('STAFF')));
    await page.goto('/invite/tok');
    const email = page.locator('input[name=email]');
    await expect(email).toHaveAttribute('autocomplete', 'username');
    await expect(email).toHaveAttribute('readonly', '');
    await expect(email).not.toBeDisabled();
    await expect(page.locator('input[name=password]')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });
});

test.describe('F68-A placeholders (guidance only: labels and accessible names stay)', () => {
  test('login, signup and invite show password and name placeholders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('placeholder', 'Your password');
    await page.goto('/signup');
    await expect(page.getByLabel('Your name', { exact: true })).toHaveAttribute('placeholder', 'e.g. Alex Morgan');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('placeholder', '10+ characters');
    await mockInvite(page, (route) => json(route, 200, session('STAFF')));
    await page.goto('/invite/tok');
    await expect(page.getByLabel('Your name', { exact: true })).toHaveAttribute('placeholder', 'e.g. Alex Morgan');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('placeholder', '10+ characters');
  });

  test('Arabic: the same fields carry Arabic placeholders', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
    await page.goto('/login');
    await expect(page.locator('input[name=password]')).toHaveAttribute('placeholder', 'أدخل كلمة المرور');
    await page.goto('/signup');
    await expect(page.locator('input[name=ownerName]')).toHaveAttribute('placeholder', /\S/);
    await expect(page.locator('input[name=ownerName]')).not.toHaveAttribute('placeholder', 'e.g. Alex Morgan');
  });
});

test.describe('invite token privacy', () => {
  test('sends no-referrer as a response header and in the page head', async ({ page }) => {
    await mockInvite(page, (route) => json(route, 200, session('STAFF')));
    const response = await page.goto('/invite/tok');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page.locator('head meta[name=referrer]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
  });
});

test.describe('submit behaviour', () => {
  test('two rapid login submits send exactly one request', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/login', async (route) => {
      calls++;
      await new Promise((r) => setTimeout(r, 400));
      await json(route, 200, session('OWNER'));
    });
    await page.goto('/login');
    await page.fill('input[name=email]', 'lina@example.com');
    await page.fill('input[name=password]', 'correct horse');
    await page.locator('input[name=password]').press('Enter');
    await page.locator('input[name=password]').press('Enter');
    await expect(page.locator('button[type=submit]')).toHaveAttribute('aria-busy', 'true');
    await page.waitForTimeout(600);
    expect(calls).toBe(1);
  });

  test('a successful login replaces history so Back does not return to the form', async ({
    page,
  }) => {
    await page.route('**/api/auth/login', (route) => json(route, 200, session('OWNER')));
    await page.goto('/signup');
    await page.goto('/login');
    await page.fill('input[name=email]', 'lina@example.com');
    await page.fill('input[name=password]', 'correct horse');
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/app');
    await page.goBack();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('401 on login shows one generic banner and focuses it', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      json(route, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'no' } }),
    );
    await page.goto('/login');
    await page.fill('input[name=email]', 'lina@example.com');
    await page.fill('input[name=password]', 'wrongpass12');
    await page.locator('button[type=submit]').click();
    await expect(page.locator('[data-form-banner]')).toBeFocused();
    await expect(page.locator('[data-form-banner]')).toContainText('not right');
  });
});

test.describe('invite accept errors', () => {
  const accept = async (page: Page) => {
    await page.goto('/invite/tok');
    await page.fill('input[name=name]', 'Rana');
    await page.fill('input[name=password]', 'whatever-it-is');
    await page.locator('button[type=submit]').click();
  };

  test('404 after load switches to the expired state', async ({ page }) => {
    await mockInvite(page, (route) =>
      json(route, 404, { error: { code: 'NOT_FOUND', message: 'x' } }),
    );
    await accept(page);
    await expect(page.getByRole('heading', { name: /expired or was already used/ })).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
  });

  test('401 shows the invite-specific wrong password copy', async ({ page }) => {
    await mockInvite(page, (route) =>
      json(route, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }),
    );
    await accept(page);
    await expect(page.locator('[data-form-banner]')).toContainText('Incorrect password');
    await expect(page.locator('[data-form-banner]')).toContainText('already have a Maw3ed account');
  });

  test('409 ALREADY_MEMBER shows its banner with a sign in action', async ({ page }) => {
    await mockInvite(page, (route) =>
      json(route, 409, { error: { code: 'ALREADY_MEMBER', message: 'x' } }),
    );
    await accept(page);
    await expect(page.locator('[data-form-banner]')).toContainText('already a member');
    await expect(page.locator('[data-form-banner] a[href="/login"]')).toBeVisible();
  });

  test('429 shows the rate limit banner', async ({ page }) => {
    await mockInvite(page, (route) =>
      json(route, 429, { error: { code: 'TOO_MANY_ATTEMPTS', message: 'x' } }),
    );
    await accept(page);
    await expect(page.locator('[data-form-banner]')).toContainText('Too many attempts');
  });
});

test.describe('slug field', () => {
  test('the live region announces the status only, never the URL preview', async ({ page }) => {
    await page.route('**/api/auth/slug-check**', (route) =>
      json(route, 200, { available: false, reason: 'taken' }),
    );
    await page.goto('/signup');
    await page.fill('input[name=slug]', 'studio-nour');
    const live = page.locator('[aria-live=polite][id$="-status"]');
    await expect(live).toContainText('already taken');
    await expect(live).not.toContainText('studio-nour');
    await expect(page.getByText('/b/studio-nour')).toBeVisible();
  });

  test('a reserved slug shows the reserved copy without a network call', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/slug-check**', (route) => {
      calls++;
      return json(route, 200, { available: true });
    });
    await page.goto('/signup');
    await page.fill('input[name=slug]', 'admin');
    await expect(page.locator('[aria-live=polite][id$="-status"]')).toContainText('reserved');
    await page.waitForTimeout(600);
    expect(calls).toBe(0);
  });
});
