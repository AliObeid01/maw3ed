import { expect, test } from '../helpers/test';
import { expectNoHorizontalOverflow } from '../helpers/layout';
import { mockSetupApi, setRole } from '../helpers/mockApi';

// Runs against the fake-session dev server; /api is answered by page.route (no database).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

const OK_CARD = '4242424242424242';
const DECLINE_CARD = '4000000000000002';

test.describe('Pro checkout (TEST MODE)', () => {
  test('/pricing Pro goes to signup with the plan; Free stays plain', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/pricing');
    await expect(page.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/signup');
    await expect(page.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute(
      'href',
      '/signup?plan=pro',
    );
    await expect(page.locator('input')).toHaveCount(0);
  });

  test('Settings has one way to Pro: a link to the checkout page, no direct upgrade', async ({
    page,
  }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 800 });
    const { calls } = await mockSetupApi(page);
    await page.goto('/app/settings');
    const link = page.getByRole('link', { name: 'Upgrade (test checkout)' });
    await expect(link).toHaveAttribute('href', '/app/checkout?plan=pro');
    expect(calls.filter((c) => c.path === '/api/billing/checkout')).toHaveLength(0);
  });

  test('validation, decline, then success; only the scenario is ever sent', async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 900 });
    const { calls } = await mockSetupApi(page);
    const bodies: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'GET') bodies.push(`${req.url()} ${req.postData() ?? ''}`);
    });
    await page.goto('/app/checkout?plan=pro');

    // Exactly one h1 (the shell header's title).
    await expect(page.getByRole('heading', { name: 'Upgrade to Pro', level: 1 })).toHaveCount(1);
    await expect(page.getByText('$9 / month')).toBeVisible();
    await expect(
      page.getByText('Test mode: checkout is simulated and no card is charged.').first(),
    ).toBeVisible();
    const form = page.getByTestId('test-card-form');
    await expectNoHorizontalOverflow(form, 'card form');

    // autofill hints and numeric keyboards
    await expect(form.getByLabel('Card number')).toHaveAttribute('autocomplete', 'cc-number');
    await expect(form.getByLabel('Card number')).toHaveAttribute('inputmode', 'numeric');
    await expect(form.getByLabel('Expiry')).toHaveAttribute('autocomplete', 'cc-exp');
    await expect(form.getByLabel('CVC')).toHaveAttribute('autocomplete', 'cc-csc');
    await expect(form.getByLabel('Name on card')).toHaveAttribute('autocomplete', 'cc-name');
    // 44 px targets
    const pay = form.getByRole('button', { name: /^Pay/ });
    expect((await pay.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // empty: inline errors, focus on the first, nothing sent
    await pay.click();
    await expect(form.getByText('Enter the card number.')).toBeVisible();
    await expect(form.getByLabel('Card number')).toBeFocused();
    expect(calls.filter((c) => c.path === '/api/billing/checkout')).toHaveLength(0);

    // bad Luhn, expired date, short CVC
    await form.getByLabel('Card number').fill('4242424242424241');
    await form.getByLabel('Expiry').fill('0120');
    await form.getByLabel('CVC').fill('12');
    await form.getByLabel('Name on card').fill('Test Person');
    await pay.click();
    await expect(form.getByText('This card number is not valid.')).toBeVisible();
    await expect(form.getByText('This card has expired.')).toBeVisible();
    await expect(form.getByText('The CVC has 3 or 4 digits.')).toBeVisible();
    expect(calls.filter((c) => c.path === '/api/billing/checkout')).toHaveLength(0);

    // formatted input
    await form.getByLabel('Card number').fill(DECLINE_CARD);
    await expect(form.getByLabel('Card number')).toHaveValue('4000 0000 0000 0002');
    await form.getByLabel('Expiry').fill('1230');
    await expect(form.getByLabel('Expiry')).toHaveValue('12/30');
    await form.getByLabel('CVC').fill('123');

    // declined: friendly message, nothing echoed, still on the page
    await pay.click();
    const problem = page.getByTestId('checkout-problem');
    await expect(problem).toContainText('Card declined');
    await expect(problem).not.toContainText('4000');
    expect(calls.filter((c) => c.path === '/api/billing/checkout')).toHaveLength(1);

    // retry with the success card
    await form.getByLabel('Card number').fill(OK_CARD);
    await pay.click();
    const done = page.getByTestId('checkout-done');
    await expect(done.getByRole('heading', { name: 'You are on Pro' })).toBeVisible();
    await expect(done.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/app');

    const checkoutCalls = calls.filter((c) => c.path === '/api/billing/checkout');
    expect(checkoutCalls.map((c) => c.body)).toEqual([
      { plan: 'PRO', scenario: 'declined' },
      { plan: 'PRO', scenario: 'success' },
    ]);
    // The card-digits guard: no request body or URL contained any run of card digits.
    for (const b of bodies) {
      expect(b.replaceAll(/\s/g, '')).not.toMatch(/\d{9,}/);
      expect(b).not.toContain(OK_CARD);
      expect(b).not.toContain(DECLINE_CARD);
    }
  });

  test('"Fill test card" fills the chosen test card and the scenario picker is a custom listbox', async ({
    page,
  }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 900 });
    await mockSetupApi(page);
    await page.goto('/app/checkout?plan=pro');
    const form = page.getByTestId('test-card-form');
    await expect(form.locator('select')).toHaveCount(0);
    await expect(form.getByText(/Test card\D*4242 4242 4242 4242/)).toBeVisible();
    await form.getByRole('button', { name: 'Fill test card' }).click();
    await expect(form.getByLabel('Card number')).toHaveValue('4242 4242 4242 4242');
    await form.getByRole('combobox', { name: 'Simulated result' }).click();
    await page.getByRole('option', { name: 'Card declined' }).click();
    await expect(form.getByText(/Test card\D*4000 0000 0000 0002/)).toBeVisible();
    await form.getByRole('button', { name: 'Fill test card' }).click();
    await expect(form.getByLabel('Card number')).toHaveValue('4000 0000 0000 0002');
  });

  test('a receptionist gets the owner-only state and no card form', async ({ page }) => {
    await setRole(page, 'STAFF', DASHBOARD);
    await mockSetupApi(page);
    await page.goto('/app/checkout?plan=pro');
    await expect(page.getByText('Only the owner can change this')).toBeVisible();
    await expect(page.getByTestId('test-card-form')).toHaveCount(0);
  });

  test('a barber (PRACTITIONER) is sent back to Today', async ({ page }) => {
    await setRole(page, 'PRACTITIONER', DASHBOARD);
    await mockSetupApi(page);
    await page.goto('/app/checkout?plan=pro');
    await expect(page).toHaveURL(/\/app\/today$/);
  });

  test('"Finish upgrading" shows on the dashboard and Settings for a Pro-intent owner, with no dismiss, and not after paying', async ({
    page,
  }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 900 });
    await mockSetupApi(page);
    await page.addInitScript(() =>
      localStorage.setItem('maw3ed:proIntent:v1', JSON.stringify({ v: 1, slug: 'studio-nour' })),
    );
    await page.goto('/app/settings');
    const banner = page.getByTestId('finish-upgrade');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Finish upgrading' })).toHaveAttribute(
      'href',
      '/app/checkout?plan=pro',
    );
    await expect(banner.getByRole('button')).toHaveCount(0);
    await expectNoHorizontalOverflow(banner, 'banner');

    await banner.getByRole('link', { name: 'Finish upgrading' }).click();
    await page.getByTestId('test-card-form').getByRole('button', { name: 'Fill test card' }).click();
    await page.getByTestId('test-card-form').getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByTestId('checkout-done')).toBeVisible();
    await page.goto('/app/settings');
    await expect(page.getByText('Your plan')).toBeVisible();
    await expect(page.getByTestId('finish-upgrade')).toHaveCount(0);
  });

  test('without a Pro intent there is no banner', async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await mockSetupApi(page);
    await page.goto('/app/settings');
    await expect(page.getByText('Your plan')).toBeVisible();
    await expect(page.getByTestId('finish-upgrade')).toHaveCount(0);
  });

  test('Arabic: the card fields stay left to right and nothing overflows', async ({ page, context }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await page.setViewportSize({ width: 360, height: 900 });
    await mockSetupApi(page);
    await page.goto('/app/checkout?plan=pro');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const form = page.getByTestId('test-card-form');
    for (const label of ['رقم البطاقة', 'تاريخ الانتهاء', 'رمز الأمان CVC'])
      await expect(form.getByLabel(label)).toHaveAttribute('dir', 'ltr');
    await expectNoHorizontalOverflow(form, 'card form (rtl)');
  });
});
