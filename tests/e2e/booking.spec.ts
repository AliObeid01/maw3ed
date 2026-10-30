import { expect, test, type Page } from '@playwright/test';
import { firstBookableDay, IDS, mockPublicApi, SLUG, type PublicMockOptions } from './helpers/publicMock';

// Self-contained: every /api/public call is answered by page.route (see helpers/publicMock.ts), so no database is needed.

const BOOK = `/b/${SLUG}`;
const STALE = 'step=details';

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
const takenAlert = (page: Page) => page.getByRole('alert').filter({ hasText: 'was just taken' });
const detailsUrl = (extra: string) =>
  `${BOOK}?${STALE}&service=${IDS.haircut}&staff=anyone&${extra}`;

test.describe('happy path', () => {
  test('books in four screens and sends one Idempotency-Key', async ({ page, isMobile }) => {
    const { calls } = await mockPublicApi(page);
    await page.goto(BOOK);
    await expect(page.getByRole('heading', { name: 'Studio Nour' })).toBeVisible();
    const progress = page.locator('nav[aria-label="Booking steps"]').last();

    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
    // Nothing steals focus when the page first resolves.
    await expect(page.getByRole('heading', { name: 'Choose a service' })).not.toBeFocused();
    if (isMobile) await expect(progress).toContainText('Step 1 of 4');
    await pickService(page, 'Haircut');

    await expect(page.getByRole('heading', { name: 'Who would you like?' })).toBeVisible();
    // A user-driven step change moves focus to the new heading (that is the announcement).
    await expect(page.getByRole('heading', { name: 'Who would you like?' })).toBeFocused();
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

    // F17: the confirmation survives a refresh (no second booking is made).
    await page.reload();
    await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();
    await expect(page.getByRole('link', { name: /Confirm or cancel your booking/ })).toHaveAttribute(
      'href',
      '/l/mock-manage-token',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toMatch(/^[A-Za-z0-9_.:-]{8,100}$/);
    expect(calls[0]!.body).toMatchObject({
      serviceId: IDS.haircut,
      staffId: 'anyone',
      client: { name: 'Maya Haddad', phone: '+96171234567' },
    });
    expect(calls[0]!.body.client).not.toHaveProperty('email');
  });

  test('the slots are fetched once for the whole 14-day strip, in the business timezone range', async ({
    page,
  }) => {
    const { slotRequests } = await mockPublicApi(page);
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await expect(page.getByRole('radio', { name: '9:00', exact: true }).first()).toBeVisible();
    expect(slotRequests).toHaveLength(1);
    const q = new URLSearchParams(slotRequests[0]);
    expect(q.get('staffId')).toBeNull(); // "anyone" sends no staffId
    const days = (Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000 + 1;
    expect(days).toBe(14);
  });

  test('skips the staff step when only one person offers the service', async ({ page, isMobile }) => {
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

  test('offers "Anyone available" first when several people offer the service', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(`${BOOK}?service=${IDS.haircut}`);
    const buttons = page.getByRole('list', { name: "Choose who you'd like" }).getByRole('button');
    await expect(buttons.first()).toContainText('Anyone available');
    await expect(buttons).toHaveCount(4);
  });
});

test.describe('url state', () => {
  test('a shared link opens the right step and Back walks one step back', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=${IDS.karim}`);
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    await page.goto(BOOK);
    await pickService(page, 'Haircut');
    await expect(page).toHaveURL(/service=/);
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

  test('a slug the API rejects with 400 is also "not found"', async ({ page }) => {
    await mockPublicApi(page);
    await page.goto(`/b/${'a'.repeat(90)}`);
    await expect(page.getByRole('heading', { name: "We can't find this booking page" })).toBeVisible();
  });

  test('a hand-edited day (not a real date, or outside the visible days) is ignored', async ({ page }) => {
    await mockPublicApi(page);
    for (const day of ['2026-02-31', '2099-01-01']) {
      await page.goto(detailsUrl(`day=${day}&time=09:00`));
      await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your details' })).toHaveCount(0);
    }
  });
});

test.describe('the details step never stands on a missing time', () => {
  const day = firstBookableDay();

  test('a reload with a time that does not exist goes back to the time step with a notice', async ({
    page,
  }) => {
    await mockPublicApi(page);
    await page.goto(detailsUrl(`day=${day}&time=09:05`));
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'That time is no longer available' })).toBeVisible();
    await expect(page).not.toHaveURL(/step=details/);
    await expect(page).not.toHaveURL(/time=/);
    await expect(page.getByRole('heading', { name: 'Your details' })).toHaveCount(0);
  });

  test('a stale shared link (the time was booked since) does the same', async ({ page }) => {
    await mockPublicApi(page, { bookedTimes: ['09:00'] });
    await page.goto(detailsUrl(`day=${day}&time=09:00`));
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    await expect(page.getByText('That time is no longer available. Please pick another.')).toBeVisible();
    // The other times of that day are offered.
    await expect(page.getByRole('radio', { name: '9:30', exact: true })).toBeVisible();
  });

  test('while the times load the button shows its loading state and sends nothing', async ({ page }) => {
    const { calls } = await mockPublicApi(page, { slotsDelayMs: 1500 });
    await page.goto(detailsUrl(`day=${day}&time=09:00`));
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    await fillDetails(page);
    const button = confirm(page);
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await button.click({ force: true });
    expect(calls).toHaveLength(0);
    // Once the times are known the same link is a normal, working details step.
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    await button.click();
    await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
    expect(calls).toHaveLength(1);
  });
});

test.describe('slot just taken (board 1.6)', () => {
  test('shows the fresh times from the 409, keeps the details, rebooks in one tap with a new key', async ({
    page,
  }) => {
    const { calls, slotRequests } = await reachDetails(page, { takeSlotOnFirstBook: true });
    await fillDetails(page);
    await confirm(page).click();

    await expect(takenAlert(page)).toBeVisible();
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

  test('browser Back leaves the "just taken" view behind', async ({ page }) => {
    await reachDetails(page, { takeSlotOnFirstBook: true });
    await fillDetails(page);
    await confirm(page).click();
    await expect(takenAlert(page)).toBeVisible();
    await page.goBack();
    await expect(takenAlert(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
  });

  test('a second 409 updates the message and moves focus to the heading again', async ({ page }) => {
    await reachDetails(page, { script: ['taken', 'taken'] });
    await fillDetails(page);
    await confirm(page).click();
    await expect(takenAlert(page)).toContainText('9:00 was just taken');
    await page.getByRole('button', { name: 'Book 9:30 instead' }).click();
    await expect(takenAlert(page)).toContainText('9:30 was just taken');
    await expect(page.getByRole('heading', { name: 'Pick another time' })).toBeFocused();
    await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('10:30');
  });
});

test.describe('"Book instead" failures are visible and retryable', () => {
  const cases = [
    { label: '500', second: '500', text: 'Something went wrong', sameKey: true },
    { label: 'dropped connection', second: 'drop', text: "couldn't reach the server", sameKey: true },
    { label: '429', second: '429', text: 'Too many attempts', sameKey: true },
    { label: 'a 400 that spends the key', second: 'bad-request', text: 'Something went wrong', sameKey: false },
  ] as const;

  for (const c of cases) {
    test(`${c.label}: banner with retry, details kept, key ${c.sameKey ? 'reused' : 'regenerated'}`, async ({
      page,
    }) => {
      const { calls } = await reachDetails(page, { script: ['taken', c.second] });
      await fillDetails(page);
      await confirm(page).click();
      await expect(takenAlert(page)).toBeVisible();

      await page.getByRole('button', { name: 'Book 9:30 instead' }).click();
      const banner = page.getByRole('alert').filter({ hasText: c.text });
      await expect(banner).toBeVisible();
      await expect(banner).toBeFocused();
      await expect(banner.getByRole('button', { name: 'Try again' })).toBeVisible();

      await banner.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();
      expect(calls).toHaveLength(3);
      if (c.sameKey) expect(calls[2]!.key).toBe(calls[1]!.key);
      else expect(calls[2]!.key).not.toBe(calls[1]!.key);
      expect(calls[2]!.body.client).toEqual(calls[0]!.body.client);
    });
  }
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

  test('fixing a typo in the name after a lost response still replays (the server compares service, staff, start, phone)', async ({
    page,
  }) => {
    const { calls, bookings } = await reachDetails(page, { dropFirstResponse: true });
    await fillDetails(page, 'Maya Hadad');
    await confirm(page).click();
    await expect(page.getByRole('alert').filter({ hasText: "couldn't reach the server" })).toBeVisible();
    await page.getByLabel('Full name').fill('Maya Haddad');
    await confirm(page).click();
    await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.key).toBe(calls[0]!.key);
    expect(bookings.size).toBe(1);
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

  test('changing the phone after a failure starts a new attempt with a new key', async ({ page }) => {
    const { calls } = await reachDetails(page, { failFirstWith500: true });
    await fillDetails(page);
    await confirm(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
    await page.getByLabel('Mobile number').fill('70 111 222');
    await confirm(page).click();
    await expect(page.getByRole('heading', { name: /You're booked/ })).toBeVisible();
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  test('a 400 on the phone shows a translated message on the field and focuses it', async ({ page }) => {
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

  test('an invalid number (checked with libphonenumber like the server) is a field error, not a crash', async ({
    page,
  }) => {
    await reachDetails(page);
    await fillDetails(page, 'Maya Haddad', '99 999 999 999');
    await confirm(page).click();
    await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Enter a valid mobile number.')).toBeVisible();
  });

  test('empty details are caught before any request', async ({ page }) => {
    const { calls } = await reachDetails(page);
    await confirm(page).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeFocused();
    expect(calls).toHaveLength(0);
  });

  test('the inputs carry the server limits (name 80, phone 32)', async ({ page }) => {
    await reachDetails(page);
    await expect(page.getByLabel('Full name')).toHaveAttribute('maxlength', '80');
    await expect(page.getByLabel('Mobile number')).toHaveAttribute('maxlength', '32');
  });
});

test.describe('the booking window', () => {
  test('a business with a short window: the range falls back, only covered days are shown, and it is remembered', async ({
    page,
  }) => {
    const { slotRequests } = await mockPublicApi(page, { windowDays: 5 });
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    const dayPills = page.getByRole('radio', { name: /times? available|no free times/ });
    await expect(dayPills.first()).toBeVisible();
    // 14 days is rejected (fields.to), 7 is rejected, 3 works.
    const length = (search: string) => {
      const q = new URLSearchParams(search);
      return (Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000 + 1;
    };
    expect(slotRequests.map(length)).toEqual([14, 7, 3]);
    // Days beyond the window are not drawn as "fully booked": only the three covered days exist.
    await expect(dayPills).toHaveCount(3);

    // The discovered length is remembered for the session: the next load goes straight to it.
    await page.reload();
    await expect(dayPills.first()).toBeVisible();
    expect(slotRequests.slice(3).map(length)).toEqual([3]);
  });

  test('coming back to the tab refetches the times', async ({ page }) => {
    const { slotRequests } = await mockPublicApi(page);
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await expect(page.getByRole('radio', { name: '9:00', exact: true }).first()).toBeVisible();
    expect(slotRequests).toHaveLength(1);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => slotRequests.length).toBe(2);
    await expect(page.getByRole('radio', { name: '9:00', exact: true }).first()).toBeVisible();
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
    // The counts in the day names use Latin digits too.
    const label = await page.getByRole('radio', { name: /متاحة/ }).first().getAttribute('aria-label');
    expect(label).not.toMatch(/[٠-٩]/);
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

  const arabicBusiness = {
    business: { name: 'Studio Nour', slug: SLUG, timezone: 'Asia/Beirut', locale: 'ar' },
    services: [{ id: IDS.haircut, name: 'Haircut', durationMin: 30, bufferMin: 10, price: 15 }],
    staff: [{ id: IDS.lina, displayName: 'Lina', serviceIds: [IDS.haircut] }],
  };

  test('uses the business language when the visitor has not chosen one (hint scoped to this business page)', async ({
    page,
    context,
  }) => {
    await mockPublicApi(page);
    await page.route(`**/api/public/${SLUG}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(arabicBusiness) }),
    );
    await page.goto(BOOK);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'اختر خدمة' })).toBeVisible({ timeout: 15_000 });
    // The hint is a session cookie for this one business page, so another business never inherits it.
    const hint = (await context.cookies()).find((c) => c.name === 'locale_hint');
    expect(hint).toMatchObject({ value: 'ar', path: `/b/${SLUG}`, expires: -1 });
  });

  test("another business's language hint does not leak onto this one", async ({ page, context, baseURL }) => {
    await mockPublicApi(page);
    // A hint learned on a different business page is scoped to that page's path and is never sent here.
    await context.addCookies([
      { name: 'locale_hint', value: 'ar', domain: new URL(baseURL!).hostname, path: '/b/another-business' },
    ]);
    await page.goto(BOOK);
    await expect(page.getByRole('heading', { name: 'Choose a service' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
