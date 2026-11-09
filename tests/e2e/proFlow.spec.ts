import { type Route } from '@playwright/test';
import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';

// The Pro entry flow: /for-business#plans -> /signup?plan=pro -> /app/checkout, and /login?next=. Every API call is answered by
// page.route; /app pages are not rendered here (the production build has no fake session), only the navigation target
// is asserted. The checkout page itself is covered by tests/e2e/dashboard/checkout.spec.ts.

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const session = (role: string) => ({
  user: { id: 'u1', name: 'Lina', email: 'lina@example.com' },
  business: { id: 'b1', slug: 'studio-nour', name: 'Studio Nour', timezone: 'Asia/Beirut' },
  role,
});

async function fillSignup(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/slug-check**', (route) => json(route, 200, { available: true }));
  await page.fill('input[name=businessName]', 'Studio Nour');
  await page.fill('input[name=slug]', 'studio-nour');
  await page.fill('input[name=ownerName]', 'Lina Haddad');
  await page.fill('input[name=email]', 'lina@example.com');
  await page.fill('input[name=password]', 'correct-horse-battery');
}

test.describe('Pro flow: signup', () => {
  test('the Upgrade to Pro button in the plans leads to /signup?plan=pro', async ({ page }) => {
    await page.goto('/for-business#plans');
    await page.getByRole('link', { name: 'Upgrade to Pro' }).click();
    await expect(page).toHaveURL(/\/signup\?plan=pro$/);
    await expect(page.getByTestId('pro-notice')).toBeVisible();
  });

  test('only the whitelisted plan is kept; anything else is ignored', async ({ page }) => {
    for (const q of ['plan=free', 'plan=PRO', 'plan=pro%20', 'plan=<script>', 'plan[]=pro']) {
      await page.goto(`/signup?${q}`);
      await expect(page.getByTestId('pro-notice'), q).toHaveCount(0);
    }
  });

  test('with plan=pro, a successful signup goes to the checkout, not the dashboard', async ({ page }) => {
    await page.route('**/api/auth/signup', (route) => json(route, 201, session('OWNER')));
    await page.goto('/signup?plan=pro');
    await fillSignup(page);
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/app/checkout?plan=pro');
    const intent = await page.evaluate(() => localStorage.getItem('maw3ed:proIntent:v1'));
    expect(JSON.parse(intent!)).toEqual({ v: 1, slug: 'studio-nour' });
  });

  test('without the plan, signup still goes to setup and remembers nothing', async ({ page }) => {
    await page.route('**/api/auth/signup', (route) => json(route, 201, session('OWNER')));
    await page.goto('/signup');
    await fillSignup(page);
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/app/setup');
    expect(await page.evaluate(() => localStorage.getItem('maw3ed:proIntent:v1'))).toBeNull();
  });

  test('the signup page with the plan has no overflow at 320 px and in Arabic', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/signup?plan=pro');
    await expectNoPageOverflow(page);
  });
});

test.describe('Pro flow: login next', () => {
  const login = async (page: import('@playwright/test').Page) => {
    await page.route('**/api/auth/login', (route) => json(route, 200, session('OWNER')));
    await page.fill('input[name=email]', 'lina@example.com');
    await page.fill('input[name=password]', 'correct horse');
    await page.locator('button[type=submit]').click();
  };

  test('a safe next is followed after signing in', async ({ page }) => {
    await page.goto('/login?next=%2Fapp%2Fcheckout%3Fplan%3Dpro');
    await expect(page.getByText('Sign in to continue where you left off.')).toBeVisible();
    await login(page);
    await page.waitForURL('**/app/checkout?plan=pro');
  });

  test('the Sign in tab of the Pro signup page carries the checkout as next', async ({ page }) => {
    await page.goto('/signup?plan=pro');
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
      'href',
      '/login?next=%2Fapp%2Fcheckout%3Fplan%3Dpro',
    );
  });

  for (const bad of [
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '%2F%2Fevil.com',
    '/app/%2F%2Fevil.com',
    '/login',
    '/api/me',
  ]) {
    test(`an unsafe next (${bad}) is ignored: the user lands on /app`, async ({ page }) => {
      await page.goto(`/login?next=${encodeURIComponent(bad)}`);
      await expect(page.getByText('Sign in to continue where you left off.')).toHaveCount(0);
      await login(page);
      // Without a real session /app itself redirects on to /login; either way the page stays on our origin.
      await page.waitForURL((url) => url.pathname === '/app' || url.pathname === '/login');
      expect(new URL(page.url()).hostname).toBe(new URL(test.info().project.use.baseURL!).hostname);
    });
  }
});
