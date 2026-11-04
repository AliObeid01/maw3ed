import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { DateTime } from 'luxon';
import { clockNow } from './helpers/clock';
import { firstBookableDay, IDS, mockPublicApi, SLUG, type PublicMockOptions } from './helpers/publicMock';

// Self-contained: every /api/public call is answered by page.route (see helpers/publicMock.ts), so no database is needed.

const BOOK = `/b/${SLUG}`;
const STALE = 'step=details';

async function pickService(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
}

async function pickFirstTime(page: Page) {
  const slot = page.getByRole('radio', { name: '09:00', exact: true }).first();
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(slot).toBeChecked();
}

async function fillDetails(page: Page, name = 'Maya Haddad', phone = '71 234 567', email = 'maya@example.test') {
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Email', { exact: true }).fill(email);
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
      client: { name: 'Maya Haddad', phone: '+96171234567', email: 'maya@example.test' },
    });
  });

  test('the slots are fetched once for the whole 14-day strip, in the business timezone range', async ({
    page,
  }) => {
    const { slotRequests } = await mockPublicApi(page);
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();
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
    await expect(page.getByRole('radio', { name: '09:30', exact: true })).toBeVisible();
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
    await expect(page.getByRole('radio', { name: '09:00', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName('09:30');
    // Fresh slots come from the 409 payload: no further slots request.
    expect(slotRequests).toHaveLength(1);

    await page.getByRole('button', { name: 'Book 09:30 instead' }).click();
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
    await expect(takenAlert(page)).toContainText('09:00 was just taken');
    await page.getByRole('button', { name: 'Book 09:30 instead' }).click();
    await expect(takenAlert(page)).toContainText('09:30 was just taken');
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

      await page.getByRole('button', { name: 'Book 09:30 instead' }).click();
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

  test('F68: the email is required (aria-required, no "optional"), blank and invalid are caught before any request', async ({
    page,
  }) => {
    const { calls } = await reachDetails(page);
    const email = page.getByLabel('Email', { exact: true });
    await expect(email).toHaveAttribute('aria-required', 'true');
    await expect(page.getByText('Email (optional)')).toHaveCount(0);
    await expect(page.locator('#booking-form').getByText(/optional/i)).toHaveCount(0);

    await fillDetails(page, 'Maya Haddad', '71 234 567', '');
    await confirm(page).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toBeFocused();
    expect(calls).toHaveLength(0);

    await email.fill('not-an-email');
    await confirm(page).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    expect(calls).toHaveLength(0);

    await email.fill('maya@example.test');
    await confirm(page).click();
    await expect(page.getByRole('heading', { name: "You're booked, Maya!" })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.client).toMatchObject({ email: 'maya@example.test' });
  });

  test('F68: a server 400 about a missing email shows the same message on the field', async ({ page }) => {
    await reachDetails(page, { rejectEmail: true });
    await fillDetails(page);
    await confirm(page).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  });

  test('the inputs carry the server limits (name 80, phone 32)', async ({ page }) => {
    await reachDetails(page);
    await expect(page.getByLabel('Full name')).toHaveAttribute('maxlength', '80');
    await expect(page.getByLabel('Mobile number')).toHaveAttribute('maxlength', '32');
  });
});

test.describe('the booking window', () => {
  // The public API publishes bookingWindowDays (F13) and BookingFlow hands it to loadSlotWindow, so a business
  // with a short window costs ONE slots request for exactly that many local days: no probing, no 400 retries.
  // The business is in Pacific/Honolulu so its "today" differs from the runner's and from Beirut's at the default now.
  const WINDOW_TZ = 'Pacific/Honolulu';
  const pills = (page: Page) => page.getByRole('radio', { name: /times? available|no free times/ });
  const nextDays = (page: Page) => page.getByRole('button', { name: 'Next days' });
  const prevDays = (page: Page) => page.getByRole('button', { name: 'Previous days' });

  /** Every day pill across the strip's pages, as aria labels in order. */
  async function stripLabels(page: Page): Promise<string[]> {
    await expect(pills(page).first()).toBeVisible();
    while (await prevDays(page).isEnabled()) await prevDays(page).click();
    const labels: string[] = [];
    for (;;) {
      labels.push(...(await pills(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))));
      if (!(await nextDays(page).isEnabled())) break;
      await nextDays(page).click();
    }
    return labels;
  }
  const label = (ymd: string) => DateTime.fromISO(ymd, { zone: 'utc' }).setLocale('en').toFormat('ccc, LLL d');

  const cases: { published: number; asked: number }[] = [
    { published: 1, asked: 1 },
    { published: 3, asked: 3 },
    { published: 7, asked: 7 },
    { published: 14, asked: 14 },
    { published: 30, asked: 14 },
  ];
  for (const { published, asked } of cases) {
    test(`bookingWindowDays ${published}: one slots request for ${asked} local day(s) in the business timezone`, async ({
      page,
    }) => {
      const { slotRequests } = await mockPublicApi(page, { bookingWindowDays: published, timezone: WINDOW_TZ });
      await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
      // A one-day window is the local day of "now" only (the server's own window is rolling, now + N days), which
      // has no bookable times in the mock (minimum notice), so the page shows the neutral "no free times right now"
      // state (F38: singular, never "1 days") instead of a strip; longer windows draw one pill per day.
      let days: string[] = [];
      if (asked === 1) {
        await expect(page.getByText('No free times right now. Please check back soon.')).toBeVisible();
        await expect(page.getByText(/next 1 days/)).toHaveCount(0);
        await expect(pills(page)).toHaveCount(0);
      } else {
        days = await stripLabels(page);
      }

      // Exactly one request, no 400 retry sequence, from today to the last covered day in the BUSINESS zone.
      expect(slotRequests).toHaveLength(1);
      const q = new URLSearchParams(slotRequests[0]);
      const today = clockNow().setZone(WINDOW_TZ).startOf('day');
      expect(q.get('from')).toBe(today.toISODate());
      expect(q.get('to')).toBe(today.plus({ days: asked - 1 }).toISODate());

      // The strip shows exactly the covered days: the last one is `to`, and the day after it is not drawn.
      if (asked > 1) {
        expect(days).toHaveLength(asked);
        expect(days[0]).toContain(label(today.toISODate()!));
        expect(days[asked - 1]).toContain(label(today.plus({ days: asked - 1 }).toISODate()!));
        expect(days.join('|')).not.toContain(label(today.plus({ days: asked }).toISODate()!));
      }
    });
  }

  // Finding F28: the window is trusted, but if the owner shortens it after the page loaded its business the slots
  // endpoint answers 400 on `to`. loadSlotWindow then re-reads the business ONCE and falls back through 7, 3, 1
  // days below the attempted length, so the page still shows times for the shorter window.
  test('slots rejected as beyond the published window: falls back to a shorter range, one business refresh (F28)', async ({
    page,
  }) => {
    const mock = await mockPublicApi(page, { bookingWindowDays: 7, windowDays: 3 });
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: "We couldn't load the free times." })).toHaveCount(0);
    // 7 days was rejected, 3 days worked; the business was read once at load and once to refresh the window.
    const today = clockNow().setZone('Asia/Beirut').startOf('day');
    expect(mock.slotRequests.map((s) => new URLSearchParams(s).get('to'))).toEqual([
      today.plus({ days: 6 }).toISODate(),
      today.plus({ days: 2 }).toISODate(),
    ]);
    expect(mock.businessRequests).toBe(2);
    expect(await stripLabels(page)).toHaveLength(3);
  });

  test('the refreshed business window is used directly when it is not on the 7, 3, 1 ladder (F28)', async ({
    page,
  }) => {
    const mock = await mockPublicApi(page, { bookingWindowDays: 7, windowDays: 2, refreshedBookingWindowDays: 2 });
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();
    const today = clockNow().setZone('Asia/Beirut').startOf('day');
    expect(mock.slotRequests.map((s) => new URLSearchParams(s).get('to'))).toEqual([
      today.plus({ days: 6 }).toISODate(),
      today.plus({ days: 1 }).toISODate(),
    ]);
    expect(mock.businessRequests).toBe(2);
  });

  test('when every range is rejected the error shows and Try again is bounded, not an endless loop (F28)', async ({
    page,
  }) => {
    const mock = await mockPublicApi(page, { bookingWindowDays: 7, windowDays: -1 });
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    const alert = page.getByRole('alert').filter({ hasText: "We couldn't load the free times." });
    await expect(alert).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pick a day and time' })).toBeVisible();
    // 7, 3 and 1 day once each, and exactly one extra business read (plus the initial load).
    expect(mock.slotRequests).toHaveLength(3);
    expect(mock.businessRequests).toBe(2);

    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => mock.slotRequests.length).toBe(6);
    await expect(alert).toBeVisible();
    expect(mock.slotRequests).toHaveLength(6);
    expect(mock.businessRequests).toBe(3);
  });

  for (const timezone of ['Asia/Tokyo', 'America/New_York']) {
    test(`Free cancellation until: the cutoff is shown in the business timezone (${timezone})`, async ({ page }) => {
      const cancelCutoffMin = 24 * 60;
      await mockPublicApi(page, { bookingWindowDays: 14, cancelCutoffMin, timezone });
      await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
      await pickFirstTime(page);

      // The mock's first free day (the SAME helper the mock uses): tomorrow or later in the business zone,
      // never a Sunday, 09:00 business time. F59: no second, independent day computation here.
      const start = DateTime.fromISO(firstBookableDay(timezone), { zone: timezone }).set({ hour: 9 });
      const cutoff = start.minus({ minutes: cancelCutoffMin }).setLocale('en');
      const when = `${cutoff.toFormat('ccc, LLL d')}, ${cutoff.toFormat('HH:mm')}`;
      // F37: shown on phones in the sticky summary bar and at lg in the side card, exactly once at any width.
      const line = page.getByText(`Free cancellation until ${when}.`).locator('visible=true');
      await expect(line).toBeVisible();
      await expect(line).toHaveCount(1);
    });
  }

  test('F37: on a 360 x 640 phone the cancellation line shows in the summary bar and the CTA stays on screen', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone layout');
    await page.setViewportSize({ width: 360, height: 640 });
    await mockPublicApi(page, { bookingWindowDays: 14, cancelCutoffMin: 120 });
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    const bar = page.locator('.sticky-summary-bar');
    const continueButton = page.getByRole('button', { name: 'Continue' }).locator('visible=true');
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^Free cancellation until /).locator('visible=true')).toHaveCount(0);
    // Before a time is picked the note's line is already reserved: neither the bar nor the button moves later.
    const barBefore = (await bar.boundingBox())!;
    const buttonBefore = (await continueButton.boundingBox())!;
    await pickFirstTime(page);
    const note = page.getByText(/^Free cancellation until /).locator('visible=true');
    await expect(note).toBeVisible();
    const barAfter = (await bar.boundingBox())!;
    const buttonAfter = (await continueButton.boundingBox())!;
    expect(barAfter.y).toBeCloseTo(barBefore.y, 0);
    expect(barAfter.height).toBeCloseTo(barBefore.height, 0);
    expect(buttonAfter.y).toBeCloseTo(buttonBefore.y, 0);

    await continueButton.click();
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    await expect(note).toBeVisible();
    const cta = page.getByRole('button', { name: 'Confirm booking' }).locator('visible=true');
    const ctaBox = (await cta.boundingBox())!;
    const noteBox = (await note.boundingBox())!;
    expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(640);
    expect(ctaBox.height).toBeGreaterThanOrEqual(44);
    // The line sits under the price and button, inside the viewport, and the page does not scroll sideways.
    expect(noteBox.y).toBeGreaterThanOrEqual(ctaBox.y + ctaBox.height - 1);
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(640);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Scrolled to the very end, the fixed bar covers neither the last form element nor the footer text.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bottoms = await page.evaluate(() => {
      const bar = document.querySelector('.sticky-summary-bar')!.getBoundingClientRect().top;
      const form = document.querySelector('main section')!.lastElementChild!.getBoundingClientRect().bottom;
      const footer = document.querySelector('footer span')!.getBoundingClientRect().bottom;
      return { bar, form, footer };
    });
    expect(bottoms.form).toBeLessThanOrEqual(bottoms.bar);
    expect(bottoms.footer).toBeLessThanOrEqual(bottoms.bar);
  });

  test('F37: the line reads right to left in Arabic and stays inside the phone viewport', async ({
    page,
    context,
    baseURL,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone layout');
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
    await page.setViewportSize({ width: 360, height: 640 });
    await mockPublicApi(page, { bookingWindowDays: 14, cancelCutoffMin: 120 });
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const slot = page.getByRole('radio', { name: /09:00/ }).first();
    await expect(slot).toBeVisible();
    await slot.click();
    const note = page.getByText(/^إلغاء مجاني حتى/).locator('visible=true');
    await expect(note).toBeVisible();
    const box = (await note.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    // One line, so the reserved line in the bar is enough and the button does not move.
    expect(box.height).toBeLessThan(24);
  });

  test('F19: the picked time is kept in the URL with its UTC offset and survives a reload', async ({ page }) => {
    await mockPublicApi(page, { bookingWindowDays: 14 });
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await pickFirstTime(page);
    // 09:00 in Beirut in November is +02:00: the instant is unambiguous even on the repeated hour of a fall-back night.
    await expect(page).toHaveURL(/time=09%3A00%2B02%3A00/);
    const urlTime = new URL(page.url()).searchParams.get('time');
    const urlDay = new URL(page.url()).searchParams.get('day');
    // Reload on the time step: the SAME slot (same day, 09:00) is still the checked one.
    await page.reload();
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).locator('visible=true')).toBeChecked();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    const after = new URL(page.url()).searchParams;
    expect(after.get('time')).toBe(urlTime);
    expect(after.get('day')).toBe(urlDay);
  });

  test('coming back to the tab refetches the times', async ({ page }) => {
    const { slotRequests } = await mockPublicApi(page);
    await page.goto(`${BOOK}?service=${IDS.haircut}&staff=anyone`);
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();
    expect(slotRequests).toHaveLength(1);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => slotRequests.length).toBe(2);
    await expect(page.getByRole('radio', { name: '09:00', exact: true }).first()).toBeVisible();
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
