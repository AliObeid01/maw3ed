import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { trackIntlErrors } from '../helpers/intlErrors';
import { expectNoHorizontalOverflow, expectNoPageOverflow } from '../helpers/layout';
import { setRole } from '../helpers/mockApi';
import { appt, client, mockOutcomesApi } from '../helpers/outcomesMock';

// F69-C: "Edit contact details" on the appointment page. Everything is answered by page.route (no database).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

let intl: string[] = [];
test.beforeEach(async ({ page }) => {
  intl = trackIntlErrors(page);
  await setRole(page, 'STAFF', DASHBOARD);
});
test.afterEach(() => {
  expect(intl).toEqual([]);
});

const MAYA = client('clmaya', 'Maya Khoury', '+96171234567', { attended: 4 });
const EDIT = 'Edit contact details';
const editDialog = (page: Page) => page.getByRole('dialog', { name: EDIT });

test('pre-filled, note shown, save sends only the changed fields and refreshes "Reminders go to"', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: 'maya.record@example.test' }],
    appointments: [appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya@gmial.test', source: 'FRONT_DESK' })],
  });
  await page.goto('/app/appointments/apone');
  await expect(page.getByTestId('reminders-go-to')).toContainText('maya@gmial.test');
  const open = page.getByRole('button', { name: EDIT });
  expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await open.click();
  const dialog = editDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'This changes this booking only, not the client’s saved record. The phone cannot be changed here: cancel and book again if it is wrong.',
  );
  await expect(dialog.getByLabel('Email for this booking')).toHaveValue('maya@gmial.test');
  // F69-D: only this booking's own override is pre-filled. This one has an email override but no name override,
  // so the name starts empty and the hint says what is used now.
  await expect(dialog.getByLabel('Name for this booking')).toHaveValue('');
  await expect(dialog).toContainText('Currently shown as Maya Khoury.');
  await expect(dialog.getByLabel(/phone/i)).toHaveCount(0);
  await expectNoPageOverflow(page);
  await expectNoHorizontalOverflow(dialog, 'edit contact sheet');
  for (const b of await dialog.getByRole('button').all()) {
    expect((await b.boundingBox())!.height, 'tap target').toBeGreaterThanOrEqual(44);
  }

  await dialog.getByLabel('Email for this booking').fill('  Maya.Fixed@Gmail.test ');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Contact details updated' }).first()).toBeAttached();
  await expect(page.getByTestId('reminders-go-to')).toContainText('Reminders go to maya.fixed@gmail.test');
  const sent = calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/contact'));
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body).toEqual({ contactEmail: 'maya.fixed@gmail.test' });
});

test('F69-D: a front-desk booking with NO override starts empty, shows what reminders use, and an untouched save sends nothing', async ({
  page,
}) => {
  const { calls } = await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: 'maya.record@example.test' }],
    appointments: [appt('apone', 'clmaya', 180, 30, { source: 'FRONT_DESK' })],
  });
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: EDIT }).click();
  const dialog = editDialog(page);
  await expect(dialog.getByLabel('Email for this booking')).toHaveValue('');
  await expect(dialog.getByLabel('Name for this booking')).toHaveValue('');
  await expect(dialog).toContainText('Reminders currently go to maya.record@example.test.');
  await expect(dialog).toContainText('Currently shown as Maya Khoury.');
  // Nothing to clear: no hint about clearing, and saving the untouched form changes nothing.
  await expect(dialog).not.toContainText('Clear this field');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
});

test('F69-D: no override and no email on file says no reminders are sent', async ({ page }) => {
  await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: null }],
    appointments: [appt('apone', 'clmaya', 180, 30, { source: 'FRONT_DESK' })],
  });
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: EDIT }).click();
  await expect(editDialog(page)).toContainText('No email is on file, so no reminders are sent for this booking.');
});

test('F69-D: a front-desk booking WITH an override can clear it (back to the saved address) and is told so', async ({
  page,
}) => {
  const { calls } = await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: 'maya.record@example.test' }],
    appointments: [
      appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya@gmial.test', contactName: 'Maya K.', source: 'FRONT_DESK' }),
    ],
  });
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: EDIT }).click();
  const dialog = editDialog(page);
  await expect(dialog.getByLabel('Email for this booking')).toHaveValue('maya@gmial.test');
  await expect(dialog.getByLabel('Name for this booking')).toHaveValue('Maya K.');
  await expect(dialog).toContainText('Clear this field to use the client’s saved email again.');
  await dialog.getByLabel('Email for this booking').fill('');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  const sent = calls.filter((c) => c.method === 'PATCH' && c.path.endsWith('/contact'));
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body).toEqual({ contactEmail: null });
  await expect(page.getByTestId('reminders-go-to')).toContainText('maya.record@example.test');
});

test('inline validation: bad email, empty name, and a public booking cannot drop its email', async ({ page }) => {
  const { calls } = await mockOutcomesApi(page, {
    clients: [{ ...MAYA }],
    appointments: [
      appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya@example.test', contactName: 'Maya K.', source: 'PUBLIC' }),
    ],
  });
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: EDIT }).click();
  const dialog = editDialog(page);
  const email = dialog.getByLabel('Email for this booking');
  await email.fill('not-an-email');
  await dialog.getByLabel('Name for this booking').fill('  ');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toContainText('Enter a valid email address.');
  await expect(dialog).toContainText('Enter a name.');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await email.fill('');
  await dialog.getByLabel('Name for this booking').fill('Maya Khoury');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toContainText('This booking was made online, so it needs an email address.');
  expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
});

test('a 409 says it can no longer be edited, and the button is gone after the reload', async ({ page }) => {
  const { appointments } = await mockOutcomesApi(page, {
    clients: [{ ...MAYA }],
    appointments: [appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya@example.test', source: 'FRONT_DESK' })],
    contactScript: ['409'],
  });
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: EDIT }).click();
  const dialog = editDialog(page);
  await dialog.getByLabel('Email for this booking').fill('maya.new@example.test');
  appointments[0]!.status = 'CANCELLED'; // what the server now knows
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('This appointment can no longer be edited.').first()).toBeAttached();
  await expect(page.getByRole('button', { name: EDIT })).toHaveCount(0);
});

test('a server 500 shows an error and the form stays open for another try', async ({ page }) => {
  await mockOutcomesApi(page, {
    clients: [{ ...MAYA }],
    appointments: [appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya@example.test', source: 'FRONT_DESK' })],
    contactScript: ['500', 'ok'],
  });
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: EDIT }).click();
  const dialog = editDialog(page);
  await dialog.getByLabel('Name for this booking').fill('Maya K.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Something went wrong on our side');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
});

for (const [id, extra, start] of [
  ['past', {}, -180],
  ['cancelled', { status: 'CANCELLED' }, 180],
  ['attended', { status: 'ATTENDED' }, -180],
] as const) {
  test(`hidden for a ${id} appointment`, async ({ page }) => {
    await mockOutcomesApi(page, {
      clients: [{ ...MAYA }],
      appointments: [appt('apone', 'clmaya', start, 30, { ...extra })],
    });
    await page.goto('/app/appointments/apone');
    await expect(page.getByRole('region', { name: 'Client' })).toBeVisible();
    await expect(page.getByRole('button', { name: EDIT })).toHaveCount(0);
  });
}

test('Arabic: rtl sheet, no sideways scroll, the address field stays left-to-right', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
  await mockOutcomesApi(page, {
    clients: [{ ...MAYA, email: 'maya.record@example.test' }],
    appointments: [
      appt('apone', 'clmaya', 180, 30, { contactEmail: 'maya.booking.long.address@example.test', source: 'FRONT_DESK' }),
    ],
  });
  await page.goto('/app/appointments/apone');
  await page.getByRole('button', { name: 'تعديل بيانات التواصل' }).click();
  const dialog = page.getByRole('dialog', { name: 'تعديل بيانات التواصل' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(dialog.locator('input[name=contactEmail]')).toHaveAttribute('dir', 'ltr');
  await expectNoPageOverflow(page);
  await expectNoHorizontalOverflow(dialog, 'edit contact sheet (ar)');
});
