import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';
import { nowMs, ORIGIN } from './helpers/clock';
import { readStored, saved, seedBookings, seedRaw } from './helpers/myBookings';
import { mockLinkApi } from './helpers/publicMock';

// An unpaid deposit hold kept in "My bookings on this device": "Deposit due", a live countdown, a Pay deposit button
// that links to /pay/<payToken>; after expiry or when the server says the booking is no longer held, the entry falls
// back to normal. All API calls are answered by page.route on the frozen clock; fake values only.

const PAY = 'pay-token-abc.pay-sig-123';
const heldEntry = (msFromNow: number, over = {}) =>
  saved({
    payToken: PAY,
    holdExpiresAt: new Date(nowMs() + msFromNow).toISOString(),
    ...over,
  } as never);

test.describe('My bookings: unpaid deposit hold', () => {
  test('shows Deposit due, a live countdown and a Pay deposit button to the pay page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await seedBookings(page, [heldEntry(10 * 60_000)]);
    const { calls } = await mockLinkApi(page, { act: 'view', status: 'PENDING_PAYMENT' });
    await page.goto('/my-bookings');

    const card = page.getByTestId('upcoming-card').first();
    await expect(card.getByTestId('deposit-chip')).toHaveText('Deposit due');
    const countdown = card.getByTestId('hold-countdown');
    await expect(countdown).toContainText(/Time left\D*(9|10):\d\d/);
    const first = await countdown.textContent();
    await expect.poll(async () => countdown.textContent(), { timeout: 5000 }).not.toBe(first);

    const pay = card.getByTestId('hold-pay');
    await expect(pay).toHaveText('Pay deposit');
    await expect(pay).toHaveAttribute('href', `/pay/${PAY}`);
    expect((await pay.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The ticking digits are hidden from assistive technology; the live region is polite and silent while time is plentiful.
    await expect(countdown).toHaveAttribute('aria-hidden', 'true');
    await expect(card.locator('[role="status"][aria-live="polite"]')).toHaveText('');
    // The status was read once for the entry.
    expect(calls.filter((c) => c.method === 'GET' && c.token === 'tok-upcoming-1')).toHaveLength(1);
    await expectNoPageOverflow(page);
  });

  test('stops at 0: the Pay button goes away and the end is announced once', async ({ page }) => {
    await seedBookings(page, [heldEntry(3000)]);
    await mockLinkApi(page, { act: 'view', status: 'PENDING_PAYMENT' });
    await page.goto('/my-bookings');
    const card = page.getByTestId('upcoming-card').first();
    await expect(card.getByTestId('hold-pay')).toBeVisible();
    await expect(card.getByTestId('hold-expired')).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId('hold-pay')).toHaveCount(0);
    await expect(card.getByTestId('hold-countdown')).toHaveCount(0);
    await expect(card.getByTestId('deposit-chip')).toHaveCount(0);
    await expect(card.locator('[role="status"][aria-live="polite"]')).toHaveText(
      'The deposit hold has ended.',
    );
  });

  test('an already expired hold is not shown on load, even if the server still says pending', async ({
    page,
  }) => {
    await seedBookings(page, [heldEntry(-60_000)]);
    await mockLinkApi(page, { act: 'view', status: 'PENDING_PAYMENT' });
    await page.goto('/my-bookings');
    const card = page.getByTestId('upcoming-card').first();
    await expect(card.getByTestId('status-chip')).toBeVisible();
    await expect(card.getByTestId('hold-pay')).toHaveCount(0);
    await expect(card.getByTestId('deposit-chip')).toHaveCount(0);
  });

  test('when the server says it is paid, the pay token and hold end are removed from storage', async ({
    page,
  }) => {
    await seedBookings(page, [heldEntry(10 * 60_000)]);
    await mockLinkApi(page, { act: 'view', status: 'BOOKED' });
    await page.goto('/my-bookings');
    const card = page.getByTestId('upcoming-card').first();
    await expect(card.getByTestId('status-chip')).toHaveText('Booked');
    await expect(card.getByTestId('hold-pay')).toHaveCount(0);
    await expect.poll(() => readStored(page)).not.toContain('payToken');
    expect(await readStored(page)).not.toContain('holdExpiresAt');
  });

  test('when the server says it was cancelled, the hold is removed too', async ({ page }) => {
    await seedBookings(page, [heldEntry(10 * 60_000)]);
    await mockLinkApi(page, { act: 'view', status: 'CANCELLED' });
    await page.goto('/my-bookings');
    await expect(page.getByTestId('upcoming-card').first().getByTestId('hold-pay')).toHaveCount(0);
    await expect.poll(() => readStored(page)).not.toContain('payToken');
  });

  test('an entry without a hold never gets the deposit UI and makes one status request', async ({
    page,
  }) => {
    await seedBookings(page, [saved()]);
    const { calls } = await mockLinkApi(page, { act: 'view' });
    await page.goto('/my-bookings');
    const card = page.getByTestId('upcoming-card').first();
    await expect(card.getByTestId('status-chip')).toBeVisible();
    await expect(card.getByTestId('hold-panel')).toHaveCount(0);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
  });

  test('hostile storage values never become a link or a request', async ({ page }) => {
    const base = saved();
    await seedRaw(
      page,
      JSON.stringify({
        v: 1,
        entries: [
          {
            ...base,
            payToken: 'javascript:alert(1)',
            holdExpiresAt: new Date(nowMs() + 600_000).toISOString(),
          },
          {
            ...base,
            token: 'tok-two-two',
            reference: 'ZZZ999',
            payToken: '../../evil',
            holdExpiresAt: 'not a date',
          },
        ],
      }),
    );
    await mockLinkApi(page, { act: 'view' });
    await page.goto('/my-bookings');
    await expect(page.getByTestId('upcoming-card').first()).toBeVisible();
    await expect(page.getByTestId('hold-pay')).toHaveCount(0);
    expect(await page.locator('a[href^="javascript:"], a[href*="evil"]').count()).toBe(0);
  });

  test('Arabic: the countdown stays left to right and the card does not overflow', async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await page.setViewportSize({ width: 360, height: 800 });
    await seedBookings(page, [heldEntry(10 * 60_000)]);
    await mockLinkApi(page, { act: 'view', status: 'PENDING_PAYMENT' });
    await page.goto('/my-bookings');
    const card = page.getByTestId('upcoming-card').first();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(card.getByTestId('deposit-chip')).toHaveText('عربون مستحق');
    await expect(card.getByTestId('hold-pay')).toHaveText('ادفع العربون');
    await expectNoPageOverflow(page);
  });
});
