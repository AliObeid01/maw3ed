import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { clockNow, ORIGIN } from './helpers/clock';
import { DateTime } from 'luxon';
import { IDS, mockPublicApi, SLUG, TZ } from './helpers/publicMock';
import { mockJoinWaitlist, type JoinOptions } from './helpers/waitlistMock';

// Self-contained: /api/public (catalogue, slots) and the join POST are answered by page.route.

const WL = `/b/${SLUG}/waitlist`;
const ALL_TIMES = ['09:00', '09:30', '10:30', '14:00', '15:30'];

async function open(page: Page, query = '', join: JoinOptions = {}, bookedTimes: string[] = []) {
  await mockPublicApi(page, { bookedTimes });
  const api = await mockJoinWaitlist(page, join);
  await page.goto(`${WL}${query}`);
  await expect(page.getByRole('heading', { name: 'Join the waitlist', level: 2 })).toBeVisible();
  return api;
}

async function fill(page: Page, email = 'maya@example.com') {
  await page.getByLabel('Full name').fill('Maya Haddad');
  await page.getByLabel('Mobile number').fill('71 234 567');
  if (email) await page.getByLabel('Email').fill(email);
}

const submit = (page: Page) => page.getByRole('button', { name: 'Join the waitlist' }).filter({ visible: true });

test('join happy path sends the real contract and shows what happens next', async ({ page }) => {
  const { calls } = await open(page);
  await page.getByLabel('Service').selectOption(IDS.haircut);
  await page.getByLabel('With').selectOption(IDS.karim);
  await fill(page);
  await submit(page).click();
  await expect(page.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
  await expect(page.getByText('Each offer lasts about 30 minutes.')).toBeVisible();
  // F43: the confirmation tells the truth about leaving (the link in every offer email; contact the business before an offer).
  await expect(page.getByText(/every offer email has a link to leave the waitlist. To be removed before an offer, contact the business./)).toBeVisible();
  await expect(page.getByText('To be removed earlier')).toHaveCount(0);
  await expect(page.getByText('maya@example.com')).toBeVisible();
  const today = clockNow().setZone(TZ).toISODate()!;
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    serviceId: IDS.haircut,
    staffId: IDS.karim,
    fromDate: today,
    toDate: DateTime.fromISO(today).plus({ days: 13 }).toISODate(),
    client: { name: 'Maya Haddad', phone: '+96171234567', email: 'maya@example.com' },
  });
});

test('missing email is caught, focuses the email field and sends nothing', async ({ page }) => {
  const { calls } = await open(page, `?service=${IDS.haircut}`);
  await fill(page, '');
  await submit(page).click();
  const email = page.getByLabel('Email');
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter your email. Offers are sent by email.')).toBeVisible();
  expect(calls).toHaveLength(0);
});

test('the server 400 on the email field is translated and focused', async ({ page }) => {
  await mockPublicApi(page);
  await mockJoinWaitlist(page);
  // Skip the client check by sending an address the client accepts but the server rejects.
  await page.goto(`${WL}?service=${IDS.haircut}`);
  await page.getByLabel('Full name').fill('Maya');
  await page.getByLabel('Mobile number').fill('71 234 567');
  await page.getByLabel('Email').fill('a@b.c');
  await page.route(`**/api/public/${SLUG}/waitlist`, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'x', fields: { 'client.email': 'Invalid email address' } } }),
    }),
  );
  await submit(page).click();
  await expect(page.getByLabel('Email')).toBeFocused();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
});

test('prefills service and person from the URL; unknown ids are ignored', async ({ page }) => {
  await open(page, `?service=${IDS.haircut}&staff=${IDS.lina}`);
  await expect(page.getByLabel('Service')).toHaveValue(IDS.haircut);
  await expect(page.getByLabel('With')).toHaveValue(IDS.lina);
  await page.goto(`${WL}?service=nope&staff=${IDS.lina}`);
  await expect(page.getByLabel('Service')).toHaveValue('');
});

test('only people who perform the service are offered', async ({ page }) => {
  await open(page, `?service=${IDS.beard}`);
  const options = await page.getByLabel('With').locator('option').allTextContents();
  expect(options).toEqual(['Anyone available', 'Jad']);
});

test('the booking flow empty state links to the waitlist with the choice prefilled', async ({ page }) => {
  await mockPublicApi(page, { bookedTimes: ALL_TIMES });
  await mockJoinWaitlist(page);
  await page.goto(`/b/${SLUG}`);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.getByRole('button', { name: /Lina/ }).click();
  await expect(page.getByText(/No free times in the next/)).toBeVisible();
  await page.getByRole('link', { name: 'Join the waitlist' }).click();
  await expect(page).toHaveURL(new RegExp(`${WL}\\?service=${IDS.haircut}&staff=${IDS.lina}`));
  await expect(page.getByLabel('Service')).toHaveValue(IDS.haircut);
  await expect(page.getByLabel('With')).toHaveValue(IDS.lina);
});

test('the slot-just-taken view links to the waitlist', async ({ page }) => {
  await mockPublicApi(page, { takeSlotOnFirstBook: true });
  await page.goto(`/b/${SLUG}`);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.getByRole('button', { name: /Anyone available/ }).click();
  await page.getByRole('radio', { name: '09:00', exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Full name').fill('Maya');
  await page.getByLabel('Mobile number').fill('71 234 567');
  await page.getByRole('button', { name: 'Confirm booking' }).filter({ visible: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'was just taken' })).toBeVisible();
  await page.getByRole('link', { name: 'Join the waitlist' }).click();
  await expect(page).toHaveURL(new RegExp(`${WL}\\?service=${IDS.haircut}$`));
});

test('WAITLIST_LIMIT shows the friendly state', async ({ page }) => {
  await open(page, `?service=${IDS.haircut}`, { existingOpen: 5 });
  await fill(page);
  await submit(page).click();
  await expect(page.getByRole('heading', { name: "You're already on several waitlists here" })).toBeVisible();
});

test('a double click sends one request and the button shows pending', async ({ page }) => {
  const { calls } = await open(page, `?service=${IDS.haircut}`, { delayMs: 600 });
  await fill(page);
  const button = submit(page);
  await button.dblclick();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
  expect(calls).toHaveLength(1);
});

test('429 and a dropped connection show a banner with retry that works', async ({ page }) => {
  const { calls } = await open(page, `?service=${IDS.haircut}`, { failWith: 429 });
  await fill(page);
  await submit(page).click();
  const banner = page.getByRole('alert').filter({ hasText: 'Too many attempts' });
  await expect(banner).toBeFocused();
  await banner.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
  expect(calls).toHaveLength(2);
});

test('an unknown business is a friendly page', async ({ page }) => {
  await mockPublicApi(page);
  await page.goto('/b/no-such-place/waitlist');
  await expect(page.getByRole('heading', { name: "We can't find this booking page" })).toBeVisible();
});

test('Arabic: RTL page, translated heading, email and phone stay LTR', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
  await mockPublicApi(page);
  await mockJoinWaitlist(page);
  await page.goto(`${WL}?service=${IDS.haircut}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الانضمام إلى قائمة الانتظار', level: 2 })).toBeVisible();
  await expect(page.getByText(/في كل رسالة عرض رابط لمغادرة قائمة الانتظار/)).toBeVisible();
  await expect(page.locator('input[type="email"]')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('input[type="tel"]')).toHaveAttribute('dir', 'ltr');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the consent copy tells the truth: the entry stays until the last day chosen or until booking', async ({ page }) => {
  await open(page);
  const body = page.locator('main');
  await expect(body).toContainText('You stay on the waitlist until the last day you chose or until you book');
  await expect(body).toContainText('Every offer email has a link to leave the waitlist');
  await expect(body).toContainText('To be removed before an offer, contact the business');
  await expect(body).not.toContainText('To be removed earlier');
  await expect(body).not.toContainText('ignore the email');
});

test('the same request submitted twice (201 then 200 duplicate) succeeds both times', async ({ page }) => {
  const { calls } = await open(page, `?service=${IDS.haircut}`);
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('/waitlist') && r.request().method() === 'POST') statuses.push(r.status());
  });
  for (let i = 0; i < 2; i++) {
    await page.goto(`${WL}?service=${IDS.haircut}`);
    await expect(page.getByLabel('Service')).toHaveValue(IDS.haircut);
    await fill(page);
    await submit(page).click();
    await expect(page.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
  }
  expect(statuses).toEqual([201, 200]);
  expect(calls).toHaveLength(2);
});

test('tampered prefill: a staff id that does not do the service, and an over-long service id, are dropped', async ({ page }) => {
  await open(page, `?service=${IDS.beard}&staff=${IDS.lina}`);
  await expect(page.getByLabel('Service')).toHaveValue(IDS.beard);
  await expect(page.getByLabel('With')).toHaveValue('');
  await page.goto(`${WL}?service=${'a'.repeat(80)}&staff=${IDS.lina}`);
  await expect(page.getByLabel('Service')).toHaveValue('');
  await expect(page.getByLabel('With')).toHaveValue('');
});

test('the default range overshooting a short booking window is clipped to the named window and the user is told', async ({
  page,
}) => {
  await mockPublicApi(page, { windowDays: 7 });
  const { calls } = await mockJoinWaitlist(page, { windowDays: 7 });
  await page.goto(`${WL}?service=${IDS.haircut}`);
  await fill(page);
  await submit(page).click();
  await expect(page.getByRole('heading', { name: "You're on the waitlist" })).toBeVisible();
  await expect(page.getByText("We shortened the range to fit this business's booking window.")).toBeVisible();
  const today = clockNow().setZone(TZ).toISODate()!;
  expect(calls).toHaveLength(1);
  expect(calls[0]!.toDate).toBe(DateTime.fromISO(today).plus({ days: 7 }).toISODate());
});

test('when the window complaint names no length, the range is retried once at 7 days', async ({ page }) => {
  await mockPublicApi(page, { windowDays: 3 });
  const rejected: string[] = [];
  const { calls } = await mockJoinWaitlist(page, { windowDays: 3, unnamedWindow: true });
  page.on('response', (r) => {
    if (r.url().endsWith('/waitlist') && r.status() === 400) rejected.push('400');
  });
  await page.goto(`${WL}?service=${IDS.haircut}`);
  await fill(page);
  await submit(page).click();
  // 7 days is still beyond a 3-day window: the single retry fails and the field is marked, no loop.
  await expect(page.getByLabel('To day')).toHaveAttribute('aria-invalid', 'true');
  await expect.poll(() => rejected.length).toBe(2);
  expect(calls).toHaveLength(0);
  const today = clockNow().setZone(TZ).toISODate()!;
  await expect(page.getByLabel('To day')).toHaveValue(DateTime.fromISO(today).plus({ days: 6 }).toISODate()!);
});
