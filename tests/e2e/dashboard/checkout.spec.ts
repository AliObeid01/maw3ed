import { clockNow } from '../helpers/clock';
import { expect, test } from '../helpers/test';
import { expectNoHorizontalOverflow } from '../helpers/layout';
import { watchCardLeaks } from '../helpers/cardLeak';
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
    const leaks = await watchCardLeaks(page);
    const bodies: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'GET') bodies.push(`${req.url()} ${req.postData() ?? ''}`);
    });
    await page.goto('/app/checkout?plan=pro');

    // Exactly one h1 (the shell header's title).
    await expect(page.getByRole('heading', { name: 'Upgrade to Pro', level: 1 })).toHaveCount(1);
    await expect(page.getByText('$9 / month')).toBeVisible();
    // ONE test-mode note on the page (PR-12: the order summary used to add a second "TEST MODE" chip).
    await expect(page.getByText('Test mode: checkout is simulated and no card is charged.')).toHaveCount(1);
    await expect(page.getByText('Test mode: checkout is simulated and no card is charged.')).toBeVisible();
    await expect(page.getByText(/test mode/i)).toHaveCount(1);
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
    // The card-digits guard, end to end: no request (URL, headers, body), console line, storage write or cookie
    // contained a run of 8+ digits of any card that was typed (see helpers/cardLeak.ts).
    await leaks.assertNoCardDigits([OK_CARD, DECLINE_CARD, '4242424242424241']);
    // And the request bodies themselves, as before:
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

  test('"Fill test card" derives the expiry year from the (frozen) clock, three years ahead', async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 900 });
    await mockSetupApi(page); // freezes the browser clock at FIXED_NOW
    await page.goto('/app/checkout?plan=pro');
    const form = page.getByTestId('test-card-form');
    await form.getByRole('button', { name: 'Fill test card' }).click();
    await expect(form.getByLabel('Expiry')).toHaveValue(`12/${String((clockNow().year + 3) % 100).padStart(2, '0')}`);
  });

  test('the floating New booking button is hidden on the checkout (it could cover Pay) and present elsewhere on a phone', async ({
    page,
  }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 640 });
    await mockSetupApi(page);
    await page.goto('/app/settings');
    await expect(page.getByTestId('new-booking-fab')).toBeVisible();
    await page.goto('/app/checkout?plan=pro');
    await expect(page.getByTestId('test-card-form')).toBeVisible();
    await expect(page.getByTestId('new-booking-fab')).toHaveCount(0);
    // On the shortest phone the Pay button can be scrolled fully into view with nothing floating over it.
    const pay = page.getByTestId('test-card-form').getByRole('button', { name: /^Pay/ });
    await pay.scrollIntoViewIfNeeded();
    const covering = await pay.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el || el.contains(top);
    });
    expect(covering).toBe(true);
  });

  test('card errors are bound to their inputs, and a failed submit focuses the first invalid field', async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 900 });
    await mockSetupApi(page);
    await page.goto('/app/checkout?plan=pro');
    const form = page.getByTestId('test-card-form');
    await form.getByRole('button', { name: /^Pay/ }).click();
    for (const label of ['Card number', 'Expiry', 'CVC', 'Name on card']) {
      const input = form.getByLabel(label);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      const describedBy = await input.getAttribute('aria-describedby');
      expect(describedBy, label).toBeTruthy();
      await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/\S/);
    }
    await expect(form.getByLabel('Card number')).toBeFocused();
    // Fixing a field clears only its own error.
    await form.getByLabel('Card number').fill(OK_CARD);
    await expect(form.getByLabel('Card number')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByLabel('Expiry')).toHaveAttribute('aria-invalid', 'true');
  });

  test('the scenario picker works from the keyboard (popover from md): arrows, Home/End, typeahead, Enter, Escape returns focus', async ({
    page,
  }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 1024, height: 900 });
    await mockSetupApi(page);
    await page.goto('/app/checkout?plan=pro');
    const form = page.getByTestId('test-card-form');
    const picker = form.getByRole('combobox', { name: 'Simulated result' });
    await picker.focus();
    await page.keyboard.press('ArrowDown');
    await expect(picker).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await expect(picker).toBeFocused();
    await expect(form.getByText(/Test card\D*4000 0000 0000 0002/)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(form.getByText(/Test card\D*4242 4242 4242 4242/)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('Card d');
    await page.keyboard.press('Enter');
    await expect(form.getByText(/Test card\D*4000 0000 0000 0002/)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await expect(picker).toBeFocused();
    await expect(form.getByText(/Test card\D*4000 0000 0000 0002/)).toBeVisible();
  });

  test('a declined card moves focus to the one alert (no shake), and the form stays usable', async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
    await page.setViewportSize({ width: 360, height: 900 });
    await mockSetupApi(page);
    await page.goto('/app/checkout?plan=pro');
    const form = page.getByTestId('test-card-form');
    await form.getByRole('combobox', { name: 'Simulated result' }).click();
    await page.getByRole('option', { name: 'Card declined' }).click();
    await form.getByRole('button', { name: 'Fill test card' }).click();
    await form.getByRole('button', { name: /^Pay/ }).click();
    const problem = page.getByTestId('checkout-problem');
    await expect(problem).toBeFocused();
    await expect(problem).toHaveAttribute('role', 'alert');
    // Exactly one live alert for the problem (field errors are not shown for a valid card).
    await expect(page.getByRole('alert').filter({ hasText: 'declined' })).toHaveCount(1);
    expect(await problem.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('shake');
    await expect(form.getByRole('button', { name: /^Pay/ })).toBeEnabled();
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
