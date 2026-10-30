import { expect, test, type Page } from '@playwright/test';
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

async function mockDeposit(page: Page) {
  const calls: { method: string; body: unknown }[] = [];
  const startAt = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
  const endAt = new Date(Date.now() + 2 * 24 * 3600_000 + 30 * 60_000).toISOString();
  const service = { id: IDS.haircut, name: 'Haircut', durationMin: 30, price: 15 };
  const staff = { id: 'ckstaff00000000000000000', displayName: 'Rima' };
  const view = (state: 'PENDING' | 'PAID') => ({
    state,
    appointment: {
      id: 'ckappt000000000000000000',
      startAt,
      endAt,
      status: state === 'PAID' ? 'BOOKED' : 'PENDING_PAYMENT',
      service: { id: service.id, name: service.name, durationMin: 30 },
      staff,
    },
    business: { name: 'Studio Nour', slug: SLUG, timezone: 'Asia/Beirut', locale: 'en' },
    deposit: { amount: 5, currency: 'USD' },
    holdExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    now: new Date().toISOString(),
    testMode: true,
  });

  // Registered after mockPublicApi, so these win for the booking POST.
  await page.route('**/api/public/*/bookings', (route) => {
    calls.push({ method: 'POST /bookings', body: JSON.parse(route.request().postData() ?? '{}') });
    return route.fulfill(
      json(201, {
        appointment: { id: 'ckappt000000000000000000', startAt, endAt, status: 'PENDING_PAYMENT', service, staff },
        links: { manage: '/l/mock-manage-token' },
        status: 'PENDING_PAYMENT',
        payToken: PAY_TOKEN,
        payUrl: `http://localhost:3000/pay/${PAY_TOKEN}`,
        holdExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      }),
    );
  });
  let paid = false;
  await page.route('**/api/pay/**', (route) => {
    const method = route.request().method();
    calls.push({ method, body: JSON.parse(route.request().postData() ?? 'null') });
    if (method === 'POST') paid = true;
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
    const slot = page.getByRole('radio', { name: '9:00', exact: true }).first();
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Full name').fill('Nadia Haddad');
    await page.getByLabel('Mobile number').fill('71 234 567');
    await page.getByRole('button', { name: 'Confirm booking' }).click();

    // The booking is held, not confirmed: the journey goes to the pay page.
    await expect(page).toHaveURL(new RegExp(`/pay/${PAY_TOKEN}$`));
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    await expect(page.getByText('TEST MODE', { exact: false })).toBeVisible();
    await expect(page.getByTestId('countdown')).toHaveText(/^1[45]:\d\d$|^[0-9]:\d\d$/);
    // Never a card form: no inputs at all, exactly one action.
    await expect(page.locator('input')).toHaveCount(0);
    const pay = page.getByRole('button', { name: 'Pay deposit (test)' });
    await expect(pay).toBeVisible();
    await expect(pay).toHaveCount(1);
    const box = await pay.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await pay.click();
    await expect(page.getByRole('heading', { name: "You're booked and confirmed" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay deposit (test)' })).toHaveCount(0);

    // The POST carries an empty body: whether it was paid is the server's call, never the page's.
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toEqual([{ method: 'POST', body: {} }]);
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
});
