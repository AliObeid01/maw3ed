import { expect, test, type Page } from '@playwright/test';
import { mockPublicApi, SLUG, type PublicMockOptions } from './helpers/publicMock';

// Self-contained: every /api/public call is answered by page.route (see helpers/publicMock.ts), so no database is needed.

const BOOK = `/b/${SLUG}`;

async function pickService(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
}

async function pickFirstTime(page: Page) {
  const slot = page.getByRole('radio', { name: '9:00', exact: true }).first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(slot).toBeChecked();
}

async function fillDetails(page: Page, name = 'Maya Haddad', phone = '71 234 567') {
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Mobile number').fill(phone);
}

/** Service, anyone, first time, details form. */
async function reachDetails(page: Page, options: PublicMockOptions = {}) {
  const mock = await mockPublicApi(page, options);
  await page.goto(BOOK);
  await pickService(page, 'Haircut');
  await page.getByRole('button', { name: /Anyone available/ }).click();
  await pickFirstTime(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
  return mock;
}

const confirm = (page: Page) => page.getByRole('button', { name: 'Confirm booking' });

test.describe('happy path', () => {
  test('books in four screens and sends one Idempotency-Key', async ({ page, isMobile }) => {
    const { calls } = await mockPublicApi(page);
    await page.goto(BOOK);
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    const progress = page.locator('nav[aria-label="Booking steps"]').last();

    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
    if (isMobile) await expect(progress).toContainText('Step 1 of 4');
    await pickService(page, 'Haircut');

    await expect(page.getByRole('heading', { name: 'Who would you like?' })).toBeVisible();
    if (isMobile) await expect(progress).toContainText('Step 2 of 4');
    await page.getByRole('button', { name: /Anyone available/ }).click();

    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    if (isMobile) await expect(progress).toContainText('Step 3 of 4');
    await pickFirstTime(page);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    if (isMobile) await expect(progress).toContainText('Step 4 of 4');
    await fillDetails(page);
    await confirm(page).click();

    await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();
    await expect(page.getByText('What happens next')).toBeVisible();
    await expect(page.getByRole('link', { name: /Confirm or cancel your booking/ })).toHaveAttribute(
      'href',
      '/l/mock-manage-token',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
    expect(calls[0]!.body).toMatchObject({
      serviceId: 's1',
      staffId: 'anyone',
      client: { name: 'Maya Haddad', phone: '+96171234567' },
    });
    expect(calls[0]!.body.client).not.toHaveProperty('email');
  });

  test('the slots are fetched once for the whole 14-day strip, in the business timezone range', async ({
    page,
  }) => {
    const { slotRequests } = await mockPublicApi(page);
    await page.goto(`${BOOK}?service=s1&staff=anyone`);
    await expect(page.getByRole('radio', { name: '9:00', exact: true }).first()).toBeVisible();
    expect(slotRequests).toHaveLength(1);
    const q = new URLSearchParams(slotRequests[0]);
    expect(q.get('staffId')).toBeNull(); // "anyone" sends no staffId
    const days =
      (Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000 + 1;
    expect(days).toBe(14);
  });

  test('skips the staff step when only one person offers the service', async ({
    page,
    isMobile,
  }) => {
    await mockPublicApi(page);
    await page.goto(BOOK);
    await pickService(page, 'Beard trim');
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Who would you like?' })).toHaveCount(0);
    if (isMobile) {
      await expect(page.locator('nav[aria-label="Booking steps"]').last()).toContainText(
        'Step 2 of 3',
      );
    }
    await pickFirstTime(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await fillDetails(page);
    await confirm(page).click();
    await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
  });

  test('offers "Anyone available" first when several people offer the service', async ({
    page,
  }) => {
    await mockPublicApi(page);
    await page.goto(`${BOOK}?service=s1`);
    const buttons = page.getByRole('list', { name: "Choose who you'd like" }).getByRole('button');
    await expect(buttons.first()).toContainText('Anyone available');
    await expect(buttons).toHaveCount(4);
  });
});

test.describe('url state', () => {
  test('a shared link opens the right step and Back walks one step back', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(`${BOOK}?service=s1&staff=p2`);
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    await page.goto(BOOK);
    await pickService(page, 'Haircut');
    await expect(page).toHaveURL(/service=s1/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
  });

  test('unknown values fall back to the first step', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(`${BOOK}?service=nope&staff=zzz&day=2030-01-01&time=10:00`);
    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
  });

  test('an unknown business shows a friendly page', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto('/b/not-a-business');
    await expect(page.getByRole('heading', { name: "We can't find this booking page" })).toBeVisible();
  });
});

test.describe('slot just taken (board 1.6)', () => {
  test('shows the fresh times from the 409, keeps the details, rebooks in one tap with a new key', async ({
    page,
  }) => {
    const { calls, slotRequests } = await reachDetails(page, { takeSlotOnFirstBook: true });
    await fillDetails(page);
    await confirm(page).click();

    await expect(page.getByRole('alert').filter({ hasText: 'was just taken' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pick another time' })).toBeVisible();
    // The old time is struck out and disabled; the closest free time is already selected.
    await expect(page.getByRole('radio', { name: '9:00', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('9:30');
    // Fresh slots come from the 409 payload: no further slots request.
    expect(slotRequests).toHaveLength(1);

    await page.getByRole('button', { name: 'Book 9:30 instead' }).click();
    await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();

    expect(calls).toHaveLength(2);
    expect(calls[1]!.key).not.toBe(calls[0]!.key); // the slot changed: a new attempt, a new key
    expect(calls[1]!.body.client).toEqual(calls[0]!.body.client); // nothing was typed twice
    expect(calls[1]!.body.startAt).not.toBe(calls[0]!.body.startAt);
  });

  test('"See other days" returns to the day picker', async ({ page }) => {
    await reachDetails(page, { takeSlotOnFirstBook: true });
    await fillDetails(page);
    await confirm(page).click();
    await page.getByRole('button', { name: 'See other days' }).click();
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: /Choose a day|–/ }).first()).toBeVisible();
  });
});

test.describe('submitting', () => {
  test('a double click sends exactly one booking', async ({ page }) => {
    const { calls } = await reachDetails(page, { bookDelayMs: 600 });
    await fillDetails(page);
    await confirm(page).dblclick();
    await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
    expect(calls).toHaveLength(1);
  });

  test('retry after a dropped connection reuses the key and the server replays with 200', async ({
    page,
  }) => {
    const { calls } = await reachDetails(page, { dropFirstResponse: true });
    await fillDetails(page);
    await confirm(page).click();
    await expect(page.getByRole('alert').filter({ hasText: "couldn't reach the server" })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.key).toBe(calls[0]!.key);
  });

  test('a 5xx can be retried with the same key', async ({ page }) => {
    const { calls } = await reachDetails(page, { failFirstWith500: true });
    await fillDetails(page);
    await confirm(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
    expect(calls[1]!.key).toBe(calls[0]!.key);
  });

  test('changing a detail after a failure starts a new attempt with a new key', async ({
    page,
  }) => {
    const { calls } = await reachDetails(page, { failFirstWith500: true });
    await fillDetails(page);
    await confirm(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
    await page.getByLabel('Full name').fill('Maya H.');
    await confirm(page).click();
    await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  test('a 400 on the phone shows a translated message on the field and focuses it', async ({
    page,
  }) => {
    await reachDetails(page, { rejectPhone: true });
    await fillDetails(page);
    await confirm(page).click();
    const phone = page.getByLabel('Mobile number');
    await expect(page.getByText('Enter a valid mobile number.')).toBeVisible();
    await expect(phone).toBeFocused();
    await expect(phone).toHaveAttribute('aria-invalid', 'true');
    // Never the raw server text.
    await expect(page.getByText('Enter a valid phone number.')).toHaveCount(0);
  });

  test('empty details are caught before any request', async ({ page }) => {
    const { calls } = await reachDetails(page);
    await confirm(page).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeFocused();
    expect(calls).toHaveLength(0);
  });
});

test.describe('language and direction', () => {
  test('Arabic renders right-to-left without horizontal overflow', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
    await mockPublicApi(page);
    await page.goto(BOOK);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'اختر خدمة' })).toBeVisible();
    await pickService(page, 'Haircut');
    await page.getByRole('button', { name: /أي موظف متاح/ }).click();
    await expect(page.getByRole('heading', { name: 'اختر اليوم والوقت' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('?lang=ar sets the cookie and redirects without the parameter', async ({ page, context }) => {
    await mockPublicApi(page);
    await page.goto(`${BOOK}?lang=ar`);
    await expect(page).toHaveURL(new RegExp(`${BOOK}$`));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const cookie = (await context.cookies()).find((c) => c.name === 'locale');
    expect(cookie).toMatchObject({ value: 'ar', path: '/', sameSite: 'Lax' });
    expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86_400);
  });

  test('an unsupported ?lang is left alone', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(`${BOOK}?lang=fr`);
    await expect(page).toHaveURL(/lang=fr/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test("uses the business language when the visitor has not chosen one", async ({ page }) => {
    await mockPublicApi(page);
    await page.route(`**/api/public/${SLUG}`, async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          business: { name: 'Studio Nour', slug: SLUG, timezone: 'Asia/Beirut', locale: 'ar' },
          services: [{ id: 's1', name: 'Haircut', durationMin: 30, bufferMin: 10, price: 15 }],
          staff: [{ id: 'p1', displayName: 'Lina', serviceIds: ['s1'] }],
        }),
      });
    });
    await page.goto(BOOK);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'اختر خدمة' })).toBeVisible();
  });
});
