import { expect, test } from '../helpers/test';
import { trackIntlErrors } from '../helpers/intlErrors';
import { setRole } from '../helpers/mockApi';
import { appt, client, mockOutcomesApi, SERVICES, STAFF } from '../helpers/outcomesMock';
import { paint, tokenRgb } from '../helpers/tokens';

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

const setup = (extra: Parameters<typeof appt>[4] = {}, startMinutes = -120, duration = 30) =>
  ({
    clients: [{ ...MAYA }, { ...NADINE }],
    appointments: [appt('apone', 'clmaya', startMinutes, duration, extra)],
  });

test('shows the details: time, service, staff, source, status, client with call and WhatsApp', async ({ page }) => {
  await mockOutcomesApi(page, setup({ status: 'CONFIRMED', source: 'PUBLIC' }, 180, 30));
  await page.goto('/app/appointments/apone');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Appointment');
  const details = page.getByRole('region', { name: 'Appointment details' });
  // Each Latin name is its own first-strong isolate (FSI ... PDI), so it can never reorder its neighbours.
  await expect(details).toContainText('⁨Haircut⁩ · with ⁨Karim⁩ · booked online');
  await expect(details).toContainText('Confirmed by client');
  await expect(details.locator('bdi')).toContainText(/^\d{1,2}:\d{2} – \d{1,2}:\d{2}$/);
  const who = page.getByRole('region', { name: 'Client' });
  await expect(who).toContainText('Maya Khoury');
  await expect(who).toContainText('+961 71 234 567');
  await expect(who).toContainText('0 no-shows');
  await expect(who.getByRole('link', { name: 'Call Maya Khoury' })).toHaveAttribute('href', 'tel:+96171234567');
  const wa = who.getByRole('link', { name: /WhatsApp chat with Maya Khoury/ });
  await expect(wa).toHaveAttribute('href', 'https://wa.me/96171234567');
  await expect(wa).toHaveAttribute('rel', /noopener/);
  // F68-A: WhatsApp is solid deep green (white text), Call is an outlined Royal Blue button; both 44 px.
  const w = await paint(wa);
  expect(w.background).toBe(await tokenRgb(page, 'whatsapp'));
  expect(w.color).toBe('rgb(255, 255, 255)');
  const call = who.getByRole('link', { name: 'Call Maya Khoury' });
  const c = await paint(call);
  expect(c.background).toBe('rgb(255, 255, 255)');
  expect(c.color).toBe(await tokenRgb(page, 'brand'));
  expect(c.border).toBe(await tokenRgb(page, 'brand'));
  for (const l of [wa, call]) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(who.getByRole('link', { name: 'See the history of Maya Khoury' })).toHaveAttribute(
    'href',
    '/app/clients/clmaya',
  );
});

test('upcoming: outcome buttons are disabled with the reason; cancel is offered', async ({ page }) => {
  await mockOutcomesApi(page, setup({}, 180, 30));
  await page.goto('/app/appointments/apone');
  const outcome = page.getByRole('region', { name: 'Outcome' });
  await expect(outcome).toContainText('You can mark the outcome once the appointment starts');
  for (const name of [/as Attended/, /as No-show/, /as Late cancel/]) {
    await expect(outcome.getByRole('button', { name })).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'Cancel for client' })).toBeVisible();
  await expect(page.getByText('The slot is offered to the waitlist straight away.')).toBeVisible();
});

test('in progress: Attended waits for the end, No-show and Late cancel are available', async ({ page }) => {
  await mockOutcomesApi(page, setup({}, -10, 30));
  await page.goto('/app/appointments/apone');
  const outcome = page.getByRole('region', { name: 'Outcome' });
  await expect(outcome).toContainText('Attended can be marked after');
  const attended = outcome.getByRole('button', { name: /as Attended/ });
  await expect(attended).toBeDisabled();
  await expect(attended).toHaveAccessibleDescription(/Attended can be marked after/);
  await expect(outcome.getByRole('button', { name: /as No-show/ })).toBeEnabled();
  await expect(outcome.getByRole('button', { name: /as Late cancel/ })).toBeEnabled();
  // Cancelling a started appointment is not offered.
  await expect(page.getByRole('button', { name: 'Cancel for client' })).toHaveCount(0);
});

test('ended: marking records the outcome, updates the status and allows a correction', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, setup());
  await page.goto('/app/appointments/apone');
  const outcome = page.getByRole('region', { name: 'Outcome' });
  await expect(outcome).toContainText('Did Maya Khoury come?');
  await outcome.getByRole('button', { name: /as No-show/ }).click();
  await expect(outcome).toContainText('Recorded as No-show');
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('No-show');
  await expect(outcome.getByRole('button', { name: /as No-show/ })).toBeDisabled();
  await outcome.getByRole('button', { name: /as Attended/ }).click();
  await expect(outcome).toContainText('Recorded as Attended');
  expect(calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body])).toEqual([
    ['/api/appointments/apone/outcome', { outcome: 'NO_SHOW' }],
    ['/api/appointments/apone/outcome', { outcome: 'ATTENDED' }],
  ]);
});

test('a repeat no-show client carries the badge', async ({ page }) => {
  await mockOutcomesApi(page, {
    clients: [{ ...NADINE }],
    appointments: [appt('apone', 'clnadine', 120, 30, { serviceId: SERVICES.colour.id, staffId: STAFF.lina.id, source: 'WAITLIST' })],
  });
  await page.goto('/app/appointments/apone');
  const who = page.getByRole('region', { name: 'Client' });
  await expect(who).toContainText('2 no-shows');
  await expect(who).toContainText('1 late cancel');
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('from the waitlist');
});

test('cancel asks for confirmation; keeping it sends nothing, confirming cancels and closes the outcome card', async ({
  page,
}) => {
  const { calls } = await mockOutcomesApi(page, setup({}, 180, 30));
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: 'Cancel for client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel this appointment?' });
  await expect(dialog).toContainText('Maya Khoury');
  await dialog.getByRole('button', { name: 'Keep it' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.filter((c) => c.path.endsWith('/cancel'))).toHaveLength(0);

  await page.getByRole('button', { name: 'Cancel for client' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, cancel it' }).dblclick();
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Cancelled');
  await expect(page.getByRole('status').filter({ hasText: "Maya Khoury's appointment was cancelled" })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Outcome' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel for client' })).toHaveCount(0);
  expect(calls.filter((c) => c.path === '/api/appointments/apone/cancel' && c.method === 'POST')).toHaveLength(1);
});

test('a cancelled appointment has no outcome buttons', async ({ page }) => {
  await mockOutcomesApi(page, setup({ status: 'CANCELLED' }));
  await page.goto('/app/appointments/apone');
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Cancelled');
  await expect(page.getByRole('region', { name: 'Outcome' })).toHaveCount(0);
});

test('an id that is not in this business shows a friendly not-found state', async ({ page }) => {
  await mockOutcomesApi(page, setup());
  await page.goto('/app/appointments/someoneelses');
  await expect(page.getByRole('heading', { name: 'Appointment not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/app');
  await expect(page.getByText('Maya Khoury')).toHaveCount(0);
});

test('a server error offers a retry', async ({ page }) => {
  await mockOutcomesApi(page, setup());
  await page.route('**/api/appointments/apone', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) }),
  );
  await page.goto('/app/appointments/apone');
  await expect(page.getByRole('alert').filter({ hasText: 'We could not load this' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

const GONE = client('cldeleted', 'Deleted client', 'deleted:cldeleted9x8y7z6w5v4u', { attended: 0 });

test('an anonymised client: no tombstone text, no tel or WhatsApp link, no link to the history that would 404', async ({
  page,
}) => {
  await mockOutcomesApi(page, { clients: [{ ...GONE }], appointments: [appt('apgone', 'cldeleted', -120, 30)] });
  await page.goto('/app/appointments/apgone');
  const who = page.getByRole('region', { name: 'Client' });
  await expect(who).toContainText('Deleted client');
  await expect(who.locator('bdi[dir="ltr"]')).toHaveText('—');
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /history of/ })).toHaveCount(0);
  await expect(page.locator('a[href^="/app/clients/"]')).toHaveCount(0);
  await expect(who.getByRole('link')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('deleted:');
  // The outcome can still be recorded for a past appointment.
  await expect(page.getByRole('region', { name: 'Outcome' })).toContainText('Did Deleted client come?');
});

test('an anonymised client in Arabic shows the localized name', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, { clients: [{ ...GONE }], appointments: [appt('apgone', 'cldeleted', -120, 30)] });
  await page.goto('/app/appointments/apgone');
  await expect(page.getByRole('region', { name: 'العميل' })).toContainText('عميل محذوف');
  expect(await page.locator('body').innerText()).not.toContain('deleted:');
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
});

test('a late cancel is final: Attended and No-show are locked with the reason, Late cancel stays as recorded', async ({
  page,
}) => {
  await mockOutcomesApi(page, setup({ status: 'LATE_CANCEL', cancelledVia: 'LINK' }));
  await page.goto('/app/appointments/apone');
  const outcome = page.getByRole('region', { name: 'Outcome' });
  const attended = outcome.getByRole('button', { name: /as Attended/ });
  await expect(attended).toBeDisabled();
  await expect(attended).toHaveAccessibleDescription(/A late cancel is final/);
  await expect(outcome.getByRole('button', { name: /as No-show/ })).toBeDisabled();
  await expect(outcome.getByRole('button', { name: /as Late cancel/ })).toHaveAttribute('aria-pressed', 'true');
});

test('a 409 CONFLICT reloads the appointment so the page shows what the server knows', async ({ page }) => {
  const { appointments, calls } = await mockOutcomesApi(page, setup());
  await page.goto('/app/appointments/apone');
  const outcome = page.getByRole('region', { name: 'Outcome' });
  await expect(outcome).toBeVisible();
  // Cancelled by someone else after this page loaded.
  appointments.find((a) => a.id === 'apone')!.status = 'CANCELLED';
  const loadsBefore = calls.filter((c) => c.method === 'GET' && c.path === '/api/appointments/apone').length;
  await outcome.getByRole('button', { name: /as No-show/ }).click();
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Cancelled');
  await expect(page.getByRole('region', { name: 'Outcome' })).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'GET' && c.path === '/api/appointments/apone').length).toBeGreaterThan(
    loadsBefore,
  );
});

test('a booking waiting for payment says so instead of "Booked"', async ({ page }) => {
  await mockOutcomesApi(page, setup({ status: 'PENDING_PAYMENT' }, 180, 30));
  await page.goto('/app/appointments/apone');
  const details = page.getByRole('region', { name: 'Appointment details' });
  await expect(details).toContainText('Awaiting payment');
  await expect(details).not.toContainText('Booked');
  await expect(page.getByRole('region', { name: 'Outcome' })).toHaveCount(0);
});

test('RTL: Arabic appointment page, back chevron mirrored, phone left-to-right', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, setup());
  await page.goto('/app/appointments/apone');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('region', { name: 'تفاصيل الموعد' })).toBeVisible();
  await expect(page.locator('bdi[dir="ltr"]', { hasText: '+961 71 234 567' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'رجوع' }).locator('svg')).toHaveClass(/rtl:-scale-x-100/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Reminders go to: the address for this booking, with a hint when it differs from the record', async ({ page }) => {
  await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: 'maya.record@example.test' }],
    appointments: [appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya.booking@example.test' })],
  });
  await page.goto('/app/appointments/apone');
  const line = page.getByTestId('reminders-go-to');
  await expect(line).toContainText('Reminders go to maya.booking@example.test');
  await expect(line).toContainText("Different from the client's record email");
  // The address is its own left-to-right isolate.
  await expect(line.locator('bdi')).toHaveAttribute('dir', 'ltr');
});

test('Reminders go to: the record email as the fallback shows no hint', async ({ page }) => {
  await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: 'maya.record@example.test' }],
    appointments: [appt('apone', 'clmaya', 180, 30)],
  });
  await page.goto('/app/appointments/apone');
  const line = page.getByTestId('reminders-go-to');
  await expect(line).toContainText('Reminders go to maya.record@example.test');
  await expect(line).not.toContainText('Different from');
});

test('Reminders go to: no email says so and keeps WhatsApp available', async ({ page }) => {
  await mockOutcomesApi(page, setup({}, 180, 30));
  await page.goto('/app/appointments/apone');
  await expect(page.getByTestId('reminders-go-to')).toHaveText(
    'No email on this booking, so no reminder emails are sent. WhatsApp reminders are still available.',
  );
});

test('Reminders go to in Arabic: rtl, the address stays left-to-right and the page does not scroll sideways', async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: 'maya.record@example.test' }],
    appointments: [appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya.booking.long.address@example.test' })],
  });
  await page.goto('/app/appointments/apone');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const line = page.getByTestId('reminders-go-to');
  await expect(line).toContainText('التذكيرات تُرسل إلى');
  await expect(line).toContainText('يختلف عن البريد المسجّل للعميل');
  const address = line.locator('bdi');
  await expect(address).toHaveAttribute('dir', 'ltr');
  await expect(address).toHaveText('maya.booking.long.address@example.test');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
