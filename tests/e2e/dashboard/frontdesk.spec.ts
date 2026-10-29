import { expect, test, type Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { mockDashboardApi } from '../helpers/dashboardMock';
import { setRole } from '../helpers/mockApi';
import { IDS, TZ } from '../helpers/publicMock';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

test.beforeEach(async ({ page }) => {
  await setRole(page, 'OWNER', DASHBOARD);
});

const times = (page: Page) => page.getByRole('radiogroup').filter({ has: page.getByRole('radio') }).last();
const firstTime = (page: Page) => times(page).getByRole('radio').first();

async function fillClient(page: Page, phone: string, name?: string) {
  await page.getByLabel('Mobile number').fill(phone);
  if (name !== undefined) await page.getByLabel('Full name').fill(name);
}

test('books in under 30 seconds: service, time, client, Book', async ({ page }) => {
  const { calls } = await mockDashboardApi(page, { clientsEndpoint: false });
  const started = Date.now();
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await expect(firstTime(page)).toBeVisible();
  await firstTime(page).click();
  await fillClient(page, '03 123 456', 'Sara Mansour');
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.getByRole('heading', { name: 'Booked' })).toBeFocused();
  expect(Date.now() - started).toBeLessThan(30_000);

  const post = calls.find((c) => c.path === '/api/appointments' && c.method === 'POST')!;
  expect(post.key).toMatch(/^bk-/);
  expect(post.body).toMatchObject({
    serviceId: IDS.haircut,
    staffId: 'anyone',
    client: { name: 'Sara Mansour', phone: '+9613123456' },
  });
  expect(Object.keys((post.body as { client: object }).client)).not.toContain('email');
  await expect(page.getByText(/Sara Mansour · Haircut/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/app');
});

test('Book another resets the form but keeps the service flow usable', async ({ page }) => {
  await mockDashboardApi(page, { clientsEndpoint: false });
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await firstTime(page).click();
  await fillClient(page, '03 123 456', 'Sara Mansour');
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await page.getByRole('button', { name: 'Book another' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('');
  await expect(page.getByLabel('Mobile number')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Book appointment' })).toBeVisible();
});

test('returning client: phone lookup shows the history badge and prefills the name', async ({ page }) => {
  const { calls } = await mockDashboardApi(page);
  await page.goto('/app/book');
  await page.getByLabel('Mobile number').fill('70 555 218');
  const card = page.getByRole('status').filter({ hasText: 'Maya Haddad' });
  await expect(card).toContainText('Returning client');
  await expect(card).toContainText('6 visits');
  await expect(card).toContainText('2 no-shows');
  await expect(page.getByLabel('Full name')).toHaveValue('Maya Haddad');
  // One debounced search for the final digits, not one per keystroke.
  const searches = calls.filter((c) => c.path === '/api/clients');
  expect(searches).toHaveLength(1);
  expect(searches[0]!.search).toBe('?search=96170555218');
});

test('a name typed by the receptionist is not overwritten by the lookup', async ({ page }) => {
  await mockDashboardApi(page);
  await page.goto('/app/book');
  await page.getByLabel('Full name').fill('Maya H.');
  await page.getByLabel('Mobile number').fill('70 555 218');
  await expect(page.getByRole('status').filter({ hasText: 'Returning client' })).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('Maya H.');
});

test('without the clients endpoint (404) the form still works and says "New client"', async ({ page }) => {
  await mockDashboardApi(page, { clientsEndpoint: false });
  await page.goto('/app/book');
  await page.getByLabel('Mobile number').fill('70 555 218');
  await expect(page.getByText('New client', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

test('Walk-in now picks the earliest free slot from now', async ({ page }) => {
  await mockDashboardApi(page, { clientsEndpoint: false });
  const slotsReply = page.waitForResponse((r) => r.url().includes('/slots'));
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Walk-in now' }).isDisabled();
  await page.getByRole('button', { name: 'Beard trim' }).click();
  const { slots } = (await (await slotsReply).json()) as { slots: { startAt: string }[] };
  await page.getByRole('button', { name: 'Walk-in now' }).click();
  const now = Date.now();
  const earliest = slots
    .map((s) => s.startAt)
    .filter((s) => Date.parse(s) >= now)
    .sort()[0]!;
  const expected = DateTime.fromISO(earliest).setZone(TZ).toFormat('H:mm');
  const checked = times(page).getByRole('radio', { checked: true });
  await expect(checked).toHaveCount(1);
  await expect(checked).toHaveText(expected);
});

test('SLOT_TAKEN: shows the slot-just-taken state with fresh slots and books another time', async ({ page }) => {
  const { calls } = await mockDashboardApi(page, { clientsEndpoint: false, bookScript: ['taken'] });
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await firstTime(page).click();
  const takenLabel = (await firstTime(page).innerText()).trim();
  await fillClient(page, '03 123 456', 'Sara Mansour');
  await page.getByRole('button', { name: 'Book appointment' }).click();

  await expect(page.getByRole('main').getByRole('alert').filter({ hasText: 'was just taken' })).toContainText(takenLabel);
  const struck = page.getByRole('radio', { name: takenLabel, exact: true }).first();
  await expect(struck).toBeDisabled();
  // Nothing is selected until a new time is picked; the form is still filled in.
  await expect(times(page).getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(page.getByLabel('Full name')).toHaveValue('Sara Mansour');
  await expect(page.getByRole('button', { name: 'Book appointment' })).toBeEnabled();

  await times(page).getByRole('radio').filter({ hasNotText: takenLabel }).first().click();
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.getByRole('heading', { name: 'Booked' })).toBeVisible();
  const posts = calls.filter((c) => c.path === '/api/appointments' && c.method === 'POST');
  expect(posts).toHaveLength(2);
  expect((posts[1]!.body as { startAt: string }).startAt).not.toBe((posts[0]!.body as { startAt: string }).startAt);
  expect(posts[1]!.key).not.toBe(posts[0]!.key);
});

test('a server error keeps the Idempotency-Key on retry; a lost response replays instead of double booking', async ({
  page,
}) => {
  const { calls, bookings } = await mockDashboardApi(page, {
    clientsEndpoint: false,
    bookScript: ['500', 'drop-after-commit'],
  });
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await firstTime(page).click();
  await fillClient(page, '03 123 456', 'Sara Mansour');
  const book = page.getByRole('button', { name: 'Book appointment' });
  await book.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Something went wrong');
  await book.click(); // committed on the server, response lost
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await book.click(); // replay
  await expect(page.getByRole('heading', { name: 'Booked' })).toBeVisible();
  const posts = calls.filter((c) => c.path === '/api/appointments' && c.method === 'POST');
  expect(posts).toHaveLength(3);
  expect(new Set(posts.map((p) => p.key)).size).toBe(1);
  expect(bookings.size).toBe(1);
});

test('double submit sends one request while pending', async ({ page }) => {
  const { calls } = await mockDashboardApi(page, { clientsEndpoint: false, bookDelayMs: 700 });
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await firstTime(page).click();
  await fillClient(page, '03 123 456', 'Sara Mansour');
  const book = page.getByRole('button', { name: 'Book appointment' });
  await book.dblclick();
  await expect(page.getByRole('heading', { name: 'Booked' })).toBeVisible();
  expect(calls.filter((c) => c.path === '/api/appointments' && c.method === 'POST')).toHaveLength(1);
});

test('validation: a missing name or phone blocks the request and focuses the first problem', async ({ page }) => {
  const { calls } = await mockDashboardApi(page, { clientsEndpoint: false });
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await firstTime(page).click();
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  await expect(page.getByText('Enter a valid mobile number.')).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toBeFocused();
  expect(calls.filter((c) => c.path === '/api/appointments' && c.method === 'POST')).toHaveLength(0);
});

test('choosing no time says so instead of doing nothing', async ({ page }) => {
  await mockDashboardApi(page, { clientsEndpoint: false });
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await fillClient(page, '03 123 456', 'Sara Mansour');
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.getByRole('main').getByRole('alert').filter({ hasText: 'Pick a time first.' })).toBeVisible();
});

test('?service=&staff= prefill the choices; an unknown person falls back to anyone', async ({ page }) => {
  await mockDashboardApi(page, { clientsEndpoint: false });
  await page.goto(`/app/book?service=${IDS.blowdry}&staff=${IDS.karim}`);
  await expect(page.getByRole('button', { name: /Blow-dry/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('With')).toHaveValue(IDS.karim);
  await page.goto(`/app/book?service=${IDS.beard}&staff=${IDS.karim}`);
  await expect(page.getByLabel('With')).toHaveValue('anyone');
});

test('layout: Book is pinned on phones and every control is at least 44px tall', async ({ page, isMobile }) => {
  await mockDashboardApi(page, { clientsEndpoint: false });
  await page.goto('/app/book');
  await page.getByRole('button', { name: 'Haircut' }).click();
  await expect(firstTime(page)).toBeVisible();
  const book = page.getByRole('button', { name: 'Book appointment' });
  const box = (await book.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  if (isMobile) {
    // Visible without scrolling, above the tab bar.
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 56);
    await expect(page.getByRole('link', { name: 'New booking' })).toHaveCount(0);
  }
  for (const chip of await page.getByRole('button', { name: /(Haircut|Blow-dry|Beard trim)/ }).all()) {
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('RTL: Arabic form keeps the phone left-to-right', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockDashboardApi(page, { clientsEndpoint: false });
  await page.goto('/app/book');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'احجز الموعد' })).toBeVisible();
  await expect(page.locator('input[type="tel"]')).toHaveAttribute('dir', 'ltr');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
