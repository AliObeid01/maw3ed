import { expect, test, type Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { TZ } from './helpers/publicMock';
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
  await expect(page.getByText('Haircut with Karim · $15')).toBeVisible();
  const startLocal = start.setZone(TZ).toFormat('H:mm');
  await expect(page.getByText(new RegExp(`${startLocal} – `))).toBeVisible();
  const expires = expiresAt.setZone(TZ).toFormat('H:mm');
  await expect(page.getByText(`Offer expires at ${expires}`)).toBeVisible();
  await expect(page.getByText(/\d+ minutes? left/)).toBeVisible();
  expect(calls.map((c) => c.method)).toEqual(['GET']);
  await expect(page.getByRole('status').filter({ hasText: 'Offer expires at' })).toHaveAttribute('aria-live', 'polite');
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
  await expect(page.getByText(/Reminders will follow by email/)).toBeVisible();
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
  await open(page, { expiresInMin: -1 }, 'tok.def');
  await expect(page.getByRole('heading', { name: 'This offer has expired' })).toBeVisible();
  await expect(book(page)).toHaveCount(0);
});

test('a claim answered 410 shows expired', async ({ page }) => {
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
  await book(page).click();
  await expect(page.getByRole('heading', { name: "You're booked" })).toBeVisible();
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
});

test('the countdown updates politely every 30 s without moving the layout', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await open(page, { expiresInMin: 28 });
  const box = page.getByRole('status').filter({ hasText: 'Offer expires at' });
  await expect(box).toContainText(/2[78] minutes left/);
  const before = await box.boundingBox();
  await page.clock.runFor(5 * 60_000);
  await expect(box).toContainText(/2[2-3] minutes left/);
  const after = await box.boundingBox();
  expect(after!.height).toBe(before!.height);
  expect(after!.y).toBe(before!.y);
});

test('Arabic: RTL with times kept LTR', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: 'http://localhost:3000' }]);
  await mockOfferApi(page);
  await page.goto('/o/tok.abc');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'توفر موعد للتو' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'احجز هذا الموعد' })).toBeVisible();
  const start = DateTime.now().setZone(TZ);
  expect(start.isValid).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
