import { expect, test } from '../helpers/test';
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

const DAY = 24 * 60;
const NADINE = client('clnadine', 'Nadine Aoun', '+96176418902', {
  email: 'nadine@example.com',
  attended: 7,
  noShows: 2,
  lateCancels: 1,
});
const MAYA = client('clmaya', 'Maya Khoury', '+96171234567', { attended: 4 });

function setup() {
  return {
    clients: [{ ...NADINE }, { ...MAYA }],
    appointments: [
      appt('hupcoming', 'clnadine', 2 * DAY, 90, { serviceId: SERVICES.colour.id, staffId: STAFF.lina.id }),
      appt('hnoshow', 'clnadine', -17 * DAY, 30, { status: 'NO_SHOW' }),
      appt('hattended', 'clnadine', -33 * DAY, 30, { status: 'ATTENDED' }),
      appt('hlate', 'clnadine', -52 * DAY, 30, { status: 'LATE_CANCEL', staffId: STAFF.lina.id }),
      appt('hmaya', 'clmaya', -DAY, 30, { status: 'ATTENDED' }),
    ],
  };
}

test('shows contact, the three counters, the repeat note and the history newest first with status chips', async ({
  page,
}) => {
  await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clnadine');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Client');
  const contact = page.getByRole('region', { name: 'Contact details' });
  await expect(contact).toContainText('Nadine Aoun');
  await expect(contact.getByRole('link', { name: /\+961 76 418 902/ })).toHaveAttribute('href', 'tel:+96176418902');
  await expect(contact.getByRole('link', { name: 'nadine@example.com' })).toHaveAttribute('href', 'mailto:nadine@example.com');
  const counters = page.getByRole('group', { name: 'Attendance' });
  await expect(counters.getByText('Attended', { exact: true }).locator('xpath=..')).toContainText('7');
  await expect(counters.getByText('No-shows', { exact: true }).locator('xpath=..')).toContainText('2');
  await expect(counters.getByText('Late cancels', { exact: true }).locator('xpath=..')).toContainText('1');
  await expect(page.getByText('Repeat no-show. This badge shows on every booking for this client.')).toBeVisible();

  const history = page.getByRole('region', { name: 'History' }).getByRole('listitem');
  await expect(history).toHaveCount(4);
  await expect(history.nth(0)).toContainText('Booked');
  await expect(history.nth(0)).toContainText(/Hair colour[^A-Za-z]*Lina/);
  await expect(history.nth(1)).toContainText('No-show');
  await expect(history.nth(2)).toContainText('Attended');
  await expect(history.nth(3)).toContainText('Late cancel');
  await expect(page.getByText('Maya')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Book again' })).toHaveAttribute('href', '/app/book');
});

test('a client without repeat no-shows has no warning and no email line', async ({ page }) => {
  await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clmaya');
  await expect(page.getByRole('region', { name: 'Contact details' })).toContainText('Maya Khoury');
  await expect(page.getByText('Repeat no-show.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /@/ })).toHaveCount(0);
});

test('owner: Delete client data explains what happens, then deletes, returns to the list and confirms with a toast', async ({
  page,
}) => {
  const { calls, appointments } = await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clnadine');
  await page.getByRole('button', { name: 'Delete client data' }).click();
  const dialog = page.getByRole('dialog', { name: "Delete Nadine Aoun's data?" });
  await expect(dialog).toContainText('anonymises the client');
  await expect(dialog).toContainText('upcoming appointments are cancelled');
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Delete client data' }).dblclick();

  await expect(page).toHaveURL(/\/app\/clients$/);
  await expect(page.getByRole('status').filter({ hasText: 'Deleted the data of Nadine Aoun' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the history of Nadine Aoun' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open the history of Maya Khoury' })).toBeVisible();
  const deletes = calls.filter((c) => c.method === 'DELETE');
  expect(deletes).toHaveLength(1);
  expect(deletes[0]!.path).toBe('/api/clients/clnadine');
  expect(appointments.find((a) => a.id === 'hupcoming')!.status).toBe('CANCELLED');
});

test('Keep client closes the dialog without deleting', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clnadine');
  await page.getByRole('button', { name: 'Delete client data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep client' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/clients\/clnadine$/);
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
});

test('a failed delete keeps the dialog open with the reason', async ({ page }) => {
  await mockOutcomesApi(page, setup());
  await page.route('**/api/clients/clnadine', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) })
      : route.fallback(),
  );
  await page.goto('/app/clients/clnadine');
  await page.getByRole('button', { name: 'Delete client data' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete client data' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Something went wrong on our side');
  await expect(page).toHaveURL(/\/app\/clients\/clnadine$/);
});

test('a receptionist sees the history but no delete action', async ({ page }) => {
  await setRole(page, 'STAFF', DASHBOARD);
  await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clnadine');
  await expect(page.getByRole('region', { name: 'Contact details' })).toContainText('Nadine Aoun');
  await expect(page.getByRole('region', { name: 'History' }).getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Delete client data' })).toHaveCount(0);
});

test('an unknown client id shows a friendly not-found state', async ({ page }) => {
  await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/otherbusinessclient');
  await expect(page.getByRole('heading', { name: 'Client not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to clients' })).toHaveAttribute('href', '/app/clients');
});

test('history rows open the appointment', async ({ page }) => {
  await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clnadine');
  await page.getByRole('region', { name: 'History' }).getByRole('listitem').nth(1).getByRole('link').click();
  await expect(page).toHaveURL(/\/app\/appointments\/hnoshow$/);
  await expect(page.getByRole('region', { name: 'Appointment details' })).toBeVisible();
});

test('RTL: Arabic client history, back chevron mirrored, phone and email left-to-right', async ({ page }) => {
  await page.context().addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clnadine');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('region', { name: 'السجل' })).toBeVisible();
  await expect(page.locator('bdi[dir="ltr"]', { hasText: '+961 76 418 902' })).toBeVisible();
  await expect(page.locator('bdi[dir="ltr"]', { hasText: 'nadine@example.com' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'العودة إلى العملاء' }).locator('svg')).toHaveClass(/rtl:-scale-x-100/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('each history row link is a 44 px tap target', async ({ page }) => {
  await mockOutcomesApi(page, setup());
  await page.goto('/app/clients/clnadine');
  const rows = page.getByRole('link', { name: /^Open the appointment/ });
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
