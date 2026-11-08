import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { nowDate, nowMs, ORIGIN } from './helpers/clock';
import { readStored } from './helpers/myBookings';
import { IDS, mockPublicApi, SLUG } from './helpers/publicMock';

// Self-contained: every /api call is answered by page.route, so no database is needed. The server-side rules
// (threshold, hold, idempotent pay, expiry) are proven by tests/integration/deposit.test.ts; this spec proves
// the phone journey: a client who needs a deposit books, lands on the pay page, pays (TEST MODE), is confirmed.

const BOOK = `/b/${SLUG}`;
const PAY_TOKEN = 'mock-pay-token.mock-pay-sig';

const json = (status: number, body: unknown) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockDeposit(page: Page, opts: { declineFirst?: boolean } = {}) {
  const calls: { method: string; body: unknown }[] = [];
  const startAt = new Date(nowMs() + 2 * 24 * 3600_000).toISOString();
  const endAt = new Date(nowMs() + 2 * 24 * 3600_000 + 30 * 60_000).toISOString();
  const service = { id: IDS.haircut, name: 'Haircut', durationMin: 30, price: 15 };
  const staff = { id: 'ckstaff00000000000000000', displayName: 'Rima' };
  const view = (state: 'PENDING' | 'PAID') => ({
    state,
    appointment: {
      id: 'ckappt000000000000000000',
      startAt,
      endAt,
      status: state === 'PAID' ? 'BOOKED' : 'PENDING_PAYMENT',
      service: { id: service.id, name: service.name, durationMin: 30, price: service.price },
      staff,
    },
    business: { name: 'Studio Nour', slug: SLUG, timezone: 'Asia/Beirut', locale: 'en', address: 'Hamra, Beirut' },
    deposit: { amount: 5, currency: 'USD' },
    holdExpiresAt: new Date(nowMs() + 15 * 60_000).toISOString(),
    now: nowDate().toISOString(),
    testMode: true,
    reminders: state === 'PAID' ? { h24: true, h2: true, email: true } : { h24: false, h2: false, email: true },
  });

  // Registered after mockPublicApi, so these win for the booking POST.
  await page.route('**/api/public/*/bookings', (route) => {
    calls.push({ method: 'POST /bookings', body: JSON.parse(route.request().postData() ?? '{}') });
    return route.fulfill(
      json(201, {
        appointment: { id: 'ckappt000000000000000000', startAt, endAt, status: 'PENDING_PAYMENT', service, staff },
        links: { manage: '/l/mock-manage-token' },
        reminders: { h24: false, h2: false, email: true },
        status: 'PENDING_PAYMENT',
        payToken: PAY_TOKEN,
        payUrl: `${ORIGIN}/pay/${PAY_TOKEN}`,
        holdExpiresAt: new Date(nowMs() + 15 * 60_000).toISOString(),
      }),
    );
  });
  let paid = false;
  await page.route('**/api/pay/**', (route) => {
    const method = route.request().method();
    calls.push({ method, body: JSON.parse(route.request().postData() ?? 'null') });
    if (method === 'POST') {
      const scenario = (JSON.parse(route.request().postData() ?? '{}') as { scenario?: string }).scenario;
      if (scenario === 'declined' && opts.declineFirst)
        return route.fulfill(json(409, { error: { code: 'PAYMENT_DECLINED', message: 'declined', fields: {} } }));
      paid = true;
    }
    return route.fulfill(json(200, view(paid ? 'PAID' : 'PENDING')));
  });
  return { calls };
}

test.describe('deposit journey', () => {
  test('a client who needs a deposit books, pays on the pay page and is confirmed', async ({ page }) => {
    await mockPublicApi(page);
    const { calls } = await mockDeposit(page);

    await page.goto(BOOK);
    await page.getByRole('button', { name: /Haircut/ }).click();
    await page.getByRole('button', { name: /Anyone available/ }).click();
    const slot = page.getByRole('radio', { name: '09:00', exact: true }).first();
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Full name').fill('Nadia Haddad');
    await page.getByLabel('Mobile number').fill('71 234 567');
    await page.getByLabel('Email', { exact: true }).fill('nadia@example.test');
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    // The booking is held, not confirmed: the journey goes to the pay page.
    await expect(page).toHaveURL(new RegExp(`/pay/${PAY_TOKEN}$`));
    await expect(page.getByText('Studio Nour', { exact: true })).toBeVisible();
    await expect(page.getByText('Test mode: checkout is simulated and no card is charged.')).toBeVisible();
    await expect(page.getByTestId('countdown')).toHaveText(/^1[45]:\d\d$|^[0-9]:\d\d$/);
    // The hold is also kept on this device (pay token + end only), so the client can come back within 15 minutes.
    const stored = JSON.parse((await readStored(page)) ?? '{}');
    expect(stored.entries[0]).toMatchObject({ payToken: PAY_TOKEN });
    expect(typeof stored.entries[0].holdExpiresAt).toBe('string');
    expect(JSON.stringify(stored)).not.toContain('Nadia');

    const form = page.getByTestId('test-card-form');
    await expect(form.getByLabel('Card number')).toHaveAttribute('autocomplete', 'cc-number');
    const pay = form.getByRole('button', { name: /^Pay/ });
    await expect(pay).toHaveText(/^Pay\D*\$5\D*$/);
    const box = await pay.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await form.getByRole('button', { name: 'Fill test card' }).click();
    await pay.click();
    await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
    await expect(page.getByText('We will email you reminders 24 hours and 2 hours before.')).toBeVisible();
    await expect(page.getByTestId('test-card-form')).toHaveCount(0);

    // The POST carries ONLY the simulated scenario, never a card digit.
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toEqual([{ method: 'POST', body: { scenario: 'success' } }]);
    // Paid: the hold is gone from this device.
    expect(JSON.parse((await readStored(page)) ?? '{}').entries[0]).not.toHaveProperty('payToken');
  });

  test('a declined test card keeps the hold and can be retried; the digits are never sent', async ({ page }) => {
    await mockDeposit(page, { declineFirst: true });
    const sent: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') sent.push(`${req.url()} ${req.postData() ?? ''}`);
    });
    await page.goto(`/pay/${PAY_TOKEN}`);
    const form = page.getByTestId('test-card-form');
    await form.getByLabel('Card number').fill('4000000000000002');
    await form.getByLabel('Expiry').fill('1230');
    await form.getByLabel('CVC').fill('123');
    await form.getByLabel('Name on card').fill('Test Person');
    await form.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByTestId('pay-problem')).toContainText('declined');
    await expect(page.getByTestId('countdown')).toBeVisible(); // still held
    await form.getByLabel('Card number').fill('4242424242424242');
    await form.getByRole('button', { name: /^Pay/ }).click();
    await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
    expect(sent).toHaveLength(2);
    for (const body of sent) {
      expect(body.replaceAll(/\s/g, '')).not.toMatch(/\d{9,}/);
    }
    expect(sent[0]).toContain('"scenario":"declined"');
    expect(sent[1]).toContain('"scenario":"success"');
  });

  test('the pay page shows the business address and, apart from the deposit, the service total (board 5.2)', async ({
    page,
  }) => {
    await mockDeposit(page);
    await page.goto(`/pay/${PAY_TOKEN}`);
    await expect(page.getByTestId('business-address')).toHaveText('Hamra, Beirut');
    await expect(page.getByTestId('service-total')).toHaveText('$15');
    await expect(page.getByText('Service total')).toBeVisible();
    await expect(page.getByText('Deposit now')).toBeVisible();
    await expect(page.getByText('$5', { exact: true })).toBeVisible(); // the deposit, a different number
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('Arabic: address and total show in RTL without overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await mockDeposit(page);
    await page.goto(`/pay/${PAY_TOKEN}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('business-address')).toHaveText('Hamra, Beirut');
    await expect(page.getByText('إجمالي سعر الخدمة')).toBeVisible();
    await expect(page.getByText('العربون الآن')).toBeVisible();
    await expect(page.getByTestId('service-total')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('an expired hold shows a friendly state with a way back', async ({ page }) => {
    await page.route('**/api/pay/**', (route) =>
      route.fulfill(
        json(410, {
          error: {
            code: 'HOLD_EXPIRED',
            message: 'expired',
            fields: {},
            data: { slug: SLUG, serviceId: IDS.haircut, slots: [] },
          },
        }),
      ),
    );
    await page.goto(`/pay/${PAY_TOKEN}`);
    await expect(page.getByRole('heading', { name: 'This hold has expired' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See free times' })).toHaveAttribute('href', BOOK);
  });

  test('a cancelled booking shows the cancelled state with a way back and no form', async ({ page }) => {
    await page.route('**/api/pay/**', (route) =>
      route.fulfill(
        json(410, {
          error: { code: 'BOOKING_CANCELLED', message: 'cancelled', fields: {}, data: { slug: SLUG, slots: [] } },
        }),
      ),
    );
    await page.goto(`/pay/${PAY_TOKEN}`);
    await expect(page.getByRole('heading', { name: 'This booking was cancelled' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See free times' })).toHaveAttribute('href', BOOK);
    await expect(page.locator('input')).toHaveCount(0);
  });
});
