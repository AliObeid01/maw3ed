import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { freezeClock, ORIGIN } from './helpers/clock';
import { IDS, TZ } from './helpers/publicMock';
import { mockOfferApi, type OfferMock } from './helpers/waitlistMock';

// Self-contained: every /api/offers call is answered by page.route.

async function open(page: Page, mock: OfferMock = {}, token = 'tok.abc') {
  const api = await mockOfferApi(page, mock);
  await page.goto(`/o/${token}`);
  return api;
}
const book = (page: Page) => page.getByRole('button', { name: 'Book this slot' });

test('shows the slot in the business timezone with an expiry time; GET alone never mutates', async ({ page }) => {
  const { calls, start, expiresAt } = await open(page);
  await expect(page.getByRole('heading', { name: 'A spot just opened up' })).toBeVisible();
  await expect(page.getByText(/.?Haircut.? with .?Karim.? · .?\$15/)).toBeVisible(); // bidi isolates surround the name and price
  const startLocal = start.setZone(TZ).toFormat('H:mm');
  await expect(page.getByText(new RegExp(`${startLocal} – `))).toBeVisible();
  const expires = expiresAt.setZone(TZ).toFormat('H:mm');
  await expect(page.getByText(`Offer expires at ${expires}`)).toBeVisible();
  await expect(page.getByText(/\d+ minutes? left/)).toBeVisible();
  expect(calls.map((c) => c.method)).toEqual(['GET']);
});

test('the page is noindex, no-referrer and not cached', async ({ page }) => {
  await mockOfferApi(page);
  const response = await page.goto('/o/tok.abc');
  expect(response!.headers()['referrer-policy']).toBe('no-referrer');
  expect(response!.headers()['cache-control']).toBe('no-store');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('claim books it and shows the summary, the manage link and the reminders note', async ({ page }) => {
  const { calls } = await open(page);
  await book(page).click();
  await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
  await expect(page.getByRole('link', { name: /Confirm or cancel your booking/ })).toHaveAttribute('href', '/l/mock-manage-token');
  await expect(page.getByText('We will email you reminders 24 hours and 2 hours before.')).toBeVisible();
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts).toEqual([expect.objectContaining({ token: 'tok.abc', body: {} })]);
  expect(posts[0]!.contentType).toContain('application/json');
});

test('a double click sends one claim request', async ({ page }) => {
  const { calls } = await open(page, { claimDelayMs: 600 });
  await book(page).dblclick();
  await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
});

test('a claim that loses (409 SLOT_TAKEN) shows the taken state', async ({ page }) => {
  await open(page, { claim: 'taken' });
  await book(page).click();
  await expect(page.getByRole('heading', { name: 'Someone else got this slot' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See free times' })).toHaveAttribute('href', '/b/studio-nour');
});

test('an offer already TAKEN is shown as taken without any button', async ({ page }) => {
  await open(page, { status: 'TAKEN', canClaim: false });
  await expect(page.getByRole('heading', { name: 'Someone else got this slot' })).toBeVisible();
  await expect(book(page)).toHaveCount(0);
});

test('410 and an expiresAt in the past both show expired', async ({ page }) => {
  await open(page, { gone: { 'tok.abc': 410 } });
  await expect(page.getByRole('heading', { name: 'This offer has expired' })).toBeVisible();
  await page.unrouteAll();
  await open(page, { expiresInMin: -1, canClaim: false }, 'tok.def');
  await expect(page.getByRole('heading', { name: 'This offer has expired' })).toBeVisible();
  await expect(book(page)).toHaveCount(0);
});

test('the offer looked open, the server answers 410 just after the tap: expired screen', async ({ page }) => {
  await open(page, { claim: 'expired' });
  await book(page).click();
  await expect(page.getByRole('heading', { name: 'This offer has expired' })).toBeVisible();
});

test('CLAIMED offer shows that it is already booked, with no button', async ({ page }) => {
  await open(page, { status: 'CLAIMED', canClaim: false });
  await expect(page.getByRole('heading', { name: 'You already booked this spot' })).toBeVisible();
  await expect(book(page)).toHaveCount(0);
});

test('a forged or malformed link (404) is the invalid state', async ({ page }) => {
  await open(page, { gone: { bad: 404 } }, 'bad');
  await expect(page.getByRole('heading', { name: "This link doesn't work" })).toBeVisible();
});

test('a dropped connection on claim shows a retry that books', async ({ page }) => {
  const { calls } = await open(page, { claim: 'drop-once' });
  await book(page).click();
  const alert = page.getByRole('alert').filter({ hasText: "We couldn't reach the server" });
  await expect(alert).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
});

test('the countdown updates politely every 30 s without moving the layout', async ({ page }) => {
  await freezeClock(page);
  await open(page, { expiresInMin: 28 });
  const box = page.getByTestId('expiry');
  await expect(box).toContainText(/2[789] minutes left/);
  const before = await box.boundingBox();
  await page.clock.runFor(5 * 60_000);
  await expect(box).toContainText(/2[2-4] minutes left/);
  const after = await box.boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(after!.y).toBe(before!.y);
});

test('a claim answered 409 CONFLICT shows the unavailable screen, not a retry', async ({ page }) => {
  const { calls } = await open(page, { claim: 'conflict' });
  await book(page).click();
  await expect(page.getByRole('heading', { name: "This offer can't be claimed" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'See free times' })).toBeVisible();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
});

test('a SUPERSEDED offer (TAKEN on GET) is the taken screen with no Book button', async ({ page }) => {
  await open(page, { status: 'TAKEN', canClaim: false });
  await expect(page.getByRole('heading', { name: 'Someone else got this slot' })).toBeVisible();
  await expect(page.getByText('until the last day you chose')).toBeVisible();
});

test('a lapsed deposit hold (HOLD_LAPSED on GET) says the time ran out and that they stay on the waitlist, no Book button', async ({ page }) => {
  await open(page, { status: 'HOLD_LAPSED', canClaim: false });
  await expect(page.getByRole('heading', { name: 'Your deposit time ran out' })).toBeVisible();
  await expect(page.getByText('You are still on the waitlist')).toBeVisible();
  await expect(book(page)).toHaveCount(0);
  await expect(page.getByText('no longer active')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'See free times' })).toBeVisible();
});

test('a claim answered 409 HOLD_LAPSED shows the lapsed state, not the unavailable one', async ({ page }) => {
  const { calls } = await open(page, { claim: 'hold-lapsed' });
  await book(page).click();
  await expect(page.getByRole('heading', { name: 'Your deposit time ran out' })).toBeVisible();
  await expect(page.getByRole('heading', { name: "This offer can't be claimed" })).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
});

test('Arabic: a lapsed deposit hold is RTL with the translated copy', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  await open(page, { status: 'HOLD_LAPSED', canClaim: false });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'انتهت مهلة دفع العربون' })).toBeVisible();
  await expect(page.getByText('ما زلت في قائمة الانتظار')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('device clock skew', () => {
  test('a slow device clock (10 min behind) still shows the server countdown', async ({ page }) => {
    await freezeClock(page, -10 * 60_000);
    await open(page, { expiresInMin: 28 });
    await expect(page.getByTestId('expiry')).toContainText(/2[789] minutes left/);
    await expect(book(page)).toBeEnabled();
  });

  test('a fast device clock (40 min ahead) does not turn an open offer into an expired one', async ({ page }) => {
    await freezeClock(page, +40 * 60_000);
    const { calls } = await open(page, { expiresInMin: 28 });
    await expect(page.getByTestId('expiry')).toContainText(/2[789] minutes left/);
    await expect(book(page)).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'This offer has expired' })).toHaveCount(0);
    await book(page).click();
    await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  test('without a Date header and a clock past expiry: Book is disabled with the ended text, no expired screen, nothing is sent', async ({
    page,
  }) => {
    await freezeClock(page, +40 * 60_000);
    const { calls } = await open(page, { expiresInMin: 28, noDateHeader: true });
    await expect(page.getByTestId('expiry')).toContainText('Offer ended at');
    await expect(book(page)).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'This offer has expired' })).toHaveCount(0);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});

test('the visible countdown is not a live region; a hidden one speaks only at 10, 5 and 1 minute and expiry', async ({
  page,
}) => {
  await freezeClock(page);
  await open(page, { expiresInMin: 28 });
  await expect(page.getByTestId('expiry')).not.toHaveAttribute('aria-live', /.+/);
  const live = page.getByTestId('expiry-live');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveText('');
  await page.clock.runFor(19 * 60_000);
  await expect(live).toHaveText(/About 10 minutes left/);
  await page.clock.runFor(4 * 60_000 + 30_000);
  await expect(live).toHaveText(/About 5 minutes left/);
  await page.clock.runFor(4 * 60_000);
  await expect(live).toHaveText(/About 1 minute left/);
  await page.clock.runFor(60_000);
  await expect(live).toHaveText('This offer has ended.');
  await expect(book(page)).toBeDisabled();
});

test('a dotted token with ?lang=ar sets the language cookie and strips the parameter', async ({ page, context }) => {
  await mockOfferApi(page);
  await page.goto('/o/tok.abc?lang=ar');
  await expect(page).toHaveURL(`${ORIGIN}/o/tok.abc`);
  expect((await context.cookies()).find((c) => c.name === 'locale')?.value).toBe('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'توفر موعد للتو' })).toBeVisible();
});

test('Arabic: RTL, translated expiry text, times and money isolated as LTR', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  await mockOfferApi(page);
  await page.goto('/o/tok.abc');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'توفر موعد للتو' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'احجز هذا الموعد' })).toBeVisible();
  await expect(page.getByTestId('expiry')).toContainText('ينتهي العرض عند');
  await expect(page.locator('bdi').filter({ hasText: /⁦\d{1,2}:\d{2} – \d{1,2}:\d{2}⁩/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'احجز هذا الموعد' }).click();
  await expect(page.getByRole('heading', { name: 'تم حجزك' })).toBeVisible();
  await expect(page.locator('bdi', { hasText: 'Haircut' }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('join the waitlist again (F49)', () => {
  const rejoin = (page: Page) => page.getByRole('link', { name: 'Join the waitlist again' });
  const cases = [
    { status: 'EXPIRED', heading: 'This offer has expired' },
    { status: 'TAKEN', heading: 'Someone else got this slot' },
    { status: 'HOLD_LAPSED', heading: 'Your deposit time ran out' },
    { status: 'UNAVAILABLE', heading: "This offer can't be claimed" },
  ] as const;
  for (const c of cases) {
    test(`${c.status}: a secondary link goes to the waitlist pre-filled with the service`, async ({ page }) => {
      await open(page, { status: c.status, canClaim: false });
      await expect(page.getByRole('heading', { name: c.heading })).toBeVisible();
      await expect(rejoin(page)).toHaveAttribute('href', `/b/studio-nour/waitlist?service=${IDS.haircut}`);
      await expect(page.getByRole('link', { name: 'See free times' })).toHaveAttribute('href', '/b/studio-nour');
      expect((await rejoin(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test('a request for one staff member also pre-fills the staff', async ({ page }) => {
    await open(page, { status: 'TAKEN', canClaim: false, entryStaffId: IDS.karim });
    await expect(rejoin(page)).toHaveAttribute(
      'href',
      `/b/studio-nour/waitlist?service=${IDS.haircut}&staff=${IDS.karim}`,
    );
  });

  test('ALREADY_BOOKED has no rejoin link (the client holds a booking)', async ({ page }) => {
    await open(page, { status: 'ALREADY_BOOKED', canClaim: false });
    await expect(page.getByRole('heading', { name: 'You already have a booking' })).toBeVisible();
    await expect(rejoin(page)).toHaveCount(0);
  });

  test('a claim that loses shows the rejoin link too', async ({ page }) => {
    await open(page, { claim: 'taken' });
    await book(page).click();
    await expect(rejoin(page)).toHaveAttribute('href', `/b/studio-nour/waitlist?service=${IDS.haircut}`);
  });

  test('following it opens the waitlist form with the service already chosen', async ({ page }) => {
    await open(page, { status: 'EXPIRED', canClaim: false });
    await rejoin(page).click();
    await expect(page).toHaveURL(new RegExp(`/b/studio-nour/waitlist\\?service=${IDS.haircut}`));
  });

  test('Arabic: the link is translated, RTL, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await open(page, { status: 'EXPIRED', canClaim: false });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: 'الانضمام إلى قائمة الانتظار مرة أخرى' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
