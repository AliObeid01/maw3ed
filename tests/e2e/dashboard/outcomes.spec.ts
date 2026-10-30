import { expect, test, type Page } from '@playwright/test';
import { trackIntlErrors } from '../helpers/intlErrors';
import { setRole } from '../helpers/mockApi';
import { appt, client, mockOutcomesApi, SERVICES, STAFF } from '../helpers/outcomesMock';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

let intl: string[] = [];
test.beforeEach(async ({ page }) => {
  intl = trackIntlErrors(page);
  await setRole(page, 'OWNER', DASHBOARD);
});
test.afterEach(() => {
  expect(intl).toEqual([]);
});

const MAYA = client('clmaya', 'Maya Khoury', '+96171234567', { attended: 4 });
const NADINE = client('clnadine', 'Nadine Aoun', '+96176418902', { attended: 7, noShows: 2, lateCancels: 1 });
const OMAR = client('clomar', 'Omar Daher', '+96170555218', { attended: 6 });

/** Two ended appointments waiting for an outcome (newest first: Maya, then Nadine) and one still upcoming. */
function fixtures() {
  return {
    clients: [{ ...MAYA }, { ...NADINE }, { ...OMAR }],
    appointments: [
      appt('apmaya', 'clmaya', -120, 30),
      appt('apnadine', 'clnadine', -200, 90, { serviceId: SERVICES.colour.id, staffId: STAFF.lina.id }),
      appt('apomar', 'clomar', 180, 30),
    ],
  };
}

const card = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Appointments waiting for an outcome' }).getByRole('listitem').filter({ hasText: name });
const marked = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Just marked' }).getByRole('listitem').filter({ hasText: name });
const outcomesBadge = (page: Page, n: number) =>
  page.getByRole('link', { name: new RegExp(`${n} outcomes? to mark`) }).first();

test('lists the ended appointments newest first with the repeat no-show badge and 44 px buttons', async ({ page }) => {
  await mockOutcomesApi(page, fixtures());
  await page.goto('/app/outcomes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mark outcome');
  await expect(page.getByRole('status').filter({ hasText: '2 left' })).toBeVisible();
  const cards = page.getByRole('list', { name: 'Appointments waiting for an outcome' }).getByRole('listitem');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Maya Khoury');
  await expect(cards.nth(1)).toContainText('Nadine Aoun');
  await expect(cards.nth(1)).toContainText('2 no-shows');
  await expect(cards.nth(1)).toContainText(/Hair colour[ ·,]+Lina/);
  await expect(cards.nth(0)).not.toContainText('no-show');
  // The upcoming appointment is not in the queue.
  await expect(page.getByText('Omar Daher')).toHaveCount(0);
  for (const button of await cards.nth(0).getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(cards.nth(0).getByRole('button')).toHaveText(['Attended', 'No-show', 'Late cancel']);
  await expect(outcomesBadge(page, 2)).toBeVisible();
});

test('marking No-show saves, moves the card to Just marked, confirms with a toast and refreshes the badge', async ({
  page,
}) => {
  const { calls, clients } = await mockOutcomesApi(page, fixtures());
  await page.goto('/app/outcomes');
  await expect(outcomesBadge(page, 2)).toBeVisible();
  await card(page, 'Maya Khoury').getByRole('button', { name: 'Mark Maya Khoury as No-show' }).click();

  await expect(card(page, 'Maya Khoury')).toHaveCount(0);
  await expect(marked(page, 'Maya Khoury')).toContainText('No-show');
  await expect(page.getByRole('status').filter({ hasText: 'Marked Maya Khoury as No-show' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '1 left' })).toBeVisible();
  await expect(outcomesBadge(page, 1)).toBeVisible();

  const patches = calls.filter((c) => c.method === 'PATCH');
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({ path: '/api/appointments/apmaya/outcome', body: { outcome: 'NO_SHOW' } });
  expect(clients.find((c) => c.id === 'clmaya')!.noShows).toBe(1);
});

test('all three outcomes hit the API with the right body; the last mark shows the calm empty state', async ({ page }) => {
  const f = fixtures();
  f.appointments.push(appt('apextra', 'clomar', -400, 30));
  const { calls } = await mockOutcomesApi(page, f);
  await page.goto('/app/outcomes');
  await card(page, 'Maya Khoury').getByRole('button', { name: /as Attended/ }).click();
  await expect(marked(page, 'Maya Khoury')).toContainText('Attended');
  await card(page, 'Nadine Aoun').getByRole('button', { name: /as No-show/ }).click();
  await expect(marked(page, 'Nadine Aoun')).toContainText('No-show');
  await card(page, 'Omar Daher').getByRole('button', { name: /as Late cancel/ }).click();
  await expect(marked(page, 'Omar Daher')).toContainText('Late cancel');

  expect(calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body])).toEqual([
    ['/api/appointments/apmaya/outcome', { outcome: 'ATTENDED' }],
    ['/api/appointments/apnadine/outcome', { outcome: 'NO_SHOW' }],
    ['/api/appointments/apextra/outcome', { outcome: 'LATE_CANCEL' }],
  ]);
  await expect(page.getByRole('heading', { name: 'All outcomes marked' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'All done' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Appointments waiting for an outcome' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /\d+ outcomes? to mark/ })).toHaveCount(0);
});

test('Change corrects a mark: the counters move on the server and the chip updates', async ({ page }) => {
  const { calls, clients } = await mockOutcomesApi(page, fixtures());
  await page.goto('/app/outcomes');
  await card(page, 'Maya Khoury').getByRole('button', { name: /as No-show/ }).click();
  const row = marked(page, 'Maya Khoury');
  await expect(row).toContainText('No-show');
  await row.getByRole('button', { name: 'Change the outcome for Maya Khoury' }).click();
  // The recorded outcome is shown pressed and cannot be re-sent.
  await expect(row.getByRole('button', { name: /as No-show/ })).toBeDisabled();
  await row.getByRole('button', { name: /as Attended/ }).click();

  await expect(row.locator('span', { hasText: /^Attended$/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Marked Maya Khoury as Attended' })).toBeVisible();
  expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
    { outcome: 'NO_SHOW' },
    { outcome: 'ATTENDED' },
  ]);
  const maya = clients.find((c) => c.id === 'clmaya')!;
  expect([maya.attended, maya.noShows]).toEqual([5, 0]);
});

test('409 NOT_ENDED keeps the card in the queue and explains why', async ({ page }) => {
  const f = fixtures();
  // The server clock is 30 minutes ahead of the browser: it lists an appointment that is still in progress.
  f.appointments.push(appt('apnow', 'clomar', -10, 40));
  await mockOutcomesApi(page, { ...f, queueSkewMinutes: 40 });
  await page.goto('/app/outcomes');
  const omar = card(page, 'Omar Daher');
  await omar.getByRole('button', { name: /as Attended/ }).click();
  await expect(omar.getByRole('alert')).toHaveText('You can mark Attended once the appointment has ended.');
  await expect(marked(page, 'Omar Daher')).toHaveCount(0);
  // No-show is allowed once it started.
  await omar.getByRole('button', { name: /as No-show/ }).click();
  await expect(marked(page, 'Omar Daher')).toContainText('No-show');
});

test('a 409 CONFLICT on a first mark keeps the card with a calm message and a retry; only a 404 drops it', async ({
  page,
}) => {
  const { appointments, calls } = await mockOutcomesApi(page, fixtures());
  let conflicts = 1;
  await page.route('**/api/appointments/apmaya/outcome', (route) =>
    conflicts-- > 0
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: 'x' } }) })
      : route.fallback(),
  );
  await page.goto('/app/outcomes');
  const maya = card(page, 'Maya Khoury');
  await expect(maya).toBeVisible();
  await maya.getByRole('button', { name: /as Attended/ }).click();
  await expect(maya.getByRole('alert')).toContainText('This appointment can no longer be marked');
  await expect(marked(page, 'Maya Khoury')).toHaveCount(0);
  // The card is still there and can be tried again.
  await maya.getByRole('button', { name: /as Attended/ }).click();
  await expect(marked(page, 'Maya Khoury')).toContainText('Attended');
  // The mock only sees the retry (the first answer was the injected 409); it is exactly one PATCH.
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  expect(appointments.find((a) => a.id === 'apmaya')!.status).toBe('ATTENDED');
});

test('a 404 (appointment removed between the list and the tap) drops the card with a clear message', async ({ page }) => {
  const { appointments } = await mockOutcomesApi(page, fixtures());
  await page.goto('/app/outcomes');
  await expect(card(page, 'Nadine Aoun')).toBeVisible();
  // Nadine's appointment disappears between the list load and the tap.
  appointments.splice(appointments.findIndex((a) => a.id === 'apnadine'), 1);
  await card(page, 'Nadine Aoun').getByRole('button', { name: /as Attended/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'We could not find this appointment' })).toBeVisible();
  await expect(card(page, 'Nadine Aoun')).toHaveCount(0);
});

test('a server error returns the card to the queue and the retry succeeds', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, { ...fixtures(), outcomeScript: ['500'] });
  await page.goto('/app/outcomes');
  const maya = card(page, 'Maya Khoury');
  await maya.getByRole('button', { name: /as Attended/ }).click();
  await expect(maya.getByRole('alert')).toContainText('Something went wrong on our side');
  await expect(marked(page, 'Maya Khoury')).toHaveCount(0);
  await maya.getByRole('button', { name: /as Attended/ }).click();
  await expect(marked(page, 'Maya Khoury')).toContainText('Attended');
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
});

test('a double tap sends one request', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, { ...fixtures(), outcomeScript: ['slow'], slowMs: 500 });
  await page.goto('/app/outcomes');
  await card(page, 'Maya Khoury').getByRole('button', { name: /as No-show/ }).dblclick();
  await expect(marked(page, 'Maya Khoury')).toContainText('No-show');
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
});

test('two quick taps on different cards each take one off the badge (no stale left - 1)', async ({ page }) => {
  await mockOutcomesApi(page, { ...fixtures(), outcomeScript: ['slow', 'slow'], slowMs: 1500 });
  await page.goto('/app/outcomes');
  await expect(outcomesBadge(page, 2)).toBeVisible();
  await card(page, 'Maya Khoury').getByRole('button', { name: /as Attended/ }).click();
  await card(page, 'Nadine Aoun').getByRole('button', { name: /as No-show/ }).click();
  // Both requests are still in flight: the badge already counts both.
  await expect(page.getByRole('link', { name: /\d+ outcomes? to mark/ })).toHaveCount(0, { timeout: 700 });
  await expect(marked(page, 'Maya Khoury')).toContainText('Attended');
  await expect(marked(page, 'Nadine Aoun')).toContainText('No-show');
});

test('shows the empty state when nothing is waiting', async ({ page }) => {
  await mockOutcomesApi(page, { clients: [MAYA], appointments: [] });
  await page.goto('/app/outcomes');
  await expect(page.getByRole('heading', { name: 'All outcomes marked' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'All done' })).toBeVisible();
  await expect(page.getByRole('button', { name: /as Attended/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/app');
});

test('shows an error with retry when the queue cannot load', async ({ page }) => {
  await mockOutcomesApi(page, fixtures());
  // Routes registered later win, so this one answers before the mock.
  await page.route('**/api/outcomes/queue**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) }),
  );
  await page.goto('/app/outcomes');
  await expect(page.getByRole('alert').filter({ hasText: 'We could not load this' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a receptionist can mark outcomes', async ({ page }) => {
  await setRole(page, 'STAFF', DASHBOARD);
  const { calls } = await mockOutcomesApi(page, fixtures());
  await page.goto('/app/outcomes');
  await card(page, 'Maya Khoury').getByRole('button', { name: /as Attended/ }).click();
  await expect(marked(page, 'Maya Khoury')).toContainText('Attended');
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
});

test('RTL: Arabic outcomes screen, no horizontal scroll, times stay left-to-right', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, fixtures());
  await page.goto('/app/outcomes');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('اكتمل كل شيء').or(page.getByText('2 متبقٍ'))).toBeVisible();
  await expect(page.getByRole('button', { name: /^سجّل Maya Khoury/ }).first()).toBeVisible();
  await expect(page.locator('bdi[dir="ltr"]').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the client-name link in the outcome queue is a 44 px tap target', async ({ page }) => {
  await mockOutcomesApi(page, fixtures());
  await page.goto('/app/outcomes');
  const link = page.getByRole('link', { name: /Open the appointment of Maya Khoury/ }).first();
  await expect(link).toBeVisible();
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
